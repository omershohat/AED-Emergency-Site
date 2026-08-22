// ============================================================================
//  SEED SCRIPT   (Requirement #9 - "pre-populate ~50 dummy users")
// ============================================================================
//  Run once, after the schema exists:   npm run seed     (from the project root)
//
//  It fills BOTH databases in one pass, and that is the point:
//
//    MySQL   - 50 responders + their devices, the admin account (micha/1234),
//              the editable marketing blocks, the MDA link and the LoRa shops.
//    MongoDB - a few position heartbeats per responder around Yarkon Park,
//              each with a batteryLevel and is_operational reading
//              (Requirement #1), realistic rssi / hop counts, and a
//              cellCoverage flag - the field that decides whether a rescue
//              reaches them by SMS, by LoRa, or not at all.
//
//  The script is idempotent: it wipes what it seeded before re-seeding, so you
//  can run it as many times as you like during development.
// ============================================================================
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Each service owns its own .env; the seeder needs both, so it loads both.
dotenv.config({ path: path.join(root, 'api', '.env') });
dotenv.config({ path: path.join(root, 'mesh', '.env') });

// ---------------------------------------------------------------------------
//  Simulation area: Yarkon Park, Tel Aviv.
//  Chosen because it is dense with real cycle paths, so the bicycle router
//  returns a visibly winding route instead of something that looks straight.
// ---------------------------------------------------------------------------
const CENTER = { lat: 32.1010, lng: 34.8090 };
const SPREAD_DEG = 0.028;            // roughly a 3 km box around the centre
const RESPONDER_COUNT = 50;

const FIRST_NAMES = [
  'דנה', 'יואב', 'מיכל', 'איתי', 'נועה', 'אורי', 'שירה', 'תומר', 'ליאור', 'רון',
  'תמר', 'עומר', 'יעל', 'אלון', 'הילה', 'גיא', 'מאיה', 'ניר', 'אביב', 'רותם',
  'עידן', 'סיון', 'ארז', 'טל', 'אסף', 'קרן', 'דור', 'ענבר', 'שחר', 'מור',
];
const LAST_NAMES = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'שפירא', 'אזולאי',
  'גבאי', 'חדד', 'סגל', 'ברק', 'רוזן', 'נחום', 'שרון', 'אלמוג', 'בן דוד', 'טולדנו',
];
const AED_MODELS = ['Philips HeartStart HS1', 'ZOLL AED Plus', 'Cardiac Science G5', 'Defibtech Lifeline'];
const LORA_MODELS = ['Heltec V3 433MHz', 'LilyGO T-Beam 433MHz', 'RAK WisBlock 433MHz', 'Station G2 433MHz'];

// --- small deterministic-ish helpers ---------------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => min + Math.random() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));

/** A Meshtastic-style node id: "!" plus 8 hex characters. */
function makeLoraId(index) {
  return `!${(0xa00000 + index * 7919).toString(16).padStart(8, '0').slice(-8)}`;
}

// ===========================================================================
//  1. MySQL
// ===========================================================================
async function seedMySql() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'field_defib',
  });

  console.log('[seed] clearing previous data...');
  // Order matters because of the foreign keys: children before parents.
  await conn.execute('DELETE FROM devices');
  await conn.execute('DELETE FROM responders');
  await conn.execute('DELETE FROM refresh_tokens');
  await conn.execute('DELETE FROM admins');
  await conn.execute('DELETE FROM content_blocks');
  await conn.execute('DELETE FROM external_links');

  // --- the simulator admin (requirement #11) -------------------------------
  // The password from the assignment is 1234, but what reaches the database is
  // a bcrypt hash. Even the person who seeds the data cannot read it back.
  const username = process.env.ADMIN_USERNAME || 'micha';
  const password = process.env.ADMIN_PASSWORD || '1234';
  const hash = await bcrypt.hash(password, 10);   // 10 = cost factor (2^10 rounds)
  const [adminRes] = await conn.execute(
    'INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
    [username, hash, 'מיכה - מנהל המערכת', 'admin'],
  );
  console.log(`[seed] admin "${username}" created (password: ${password})`);

  // --- 50 responders + devices ---------------------------------------------
  const responders = [];
  for (let i = 0; i < RESPONDER_COUNT; i += 1) {
    // Distribution on purpose:
    //   ~40% AED + LoRa   - the ideal responder
    //   ~25% AED only     - reachable only where there is cellular coverage
    //   ~35% LoRa only    - no defibrillator, but can relay and start CPR
    const roll = Math.random();
    const hasAed = roll < 0.65;
    const hasLora = roll < 0.40 || roll >= 0.65;

    const loraId = hasLora ? makeLoraId(i) : null;
    const firstName = pick(FIRST_NAMES);
    // Requirement #6: last name is optional - ~15% of the seed data omits it,
    // so the UI is forced to handle the null case instead of pretending.
    const lastName = Math.random() < 0.85 ? pick(LAST_NAMES) : null;
    const phone = `05${intBetween(0, 8)}${String(1000000 + i * 13337).slice(-7)}`;

    const [res] = await conn.execute(
      `INSERT INTO responders (first_name, last_name, phone, lora_id, city, consent_at, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW() - INTERVAL ? DAY)`,
      [firstName, lastName, phone, loraId, 'תל אביב-יפו', intBetween(0, 400)],
    );
    const id = res.insertId;

    if (hasAed) {
      await conn.execute(
        'INSERT INTO devices (responder_id, kind, model, serial, frequency_mhz) VALUES (?, ?, ?, ?, NULL)',
        [id, 'AED', pick(AED_MODELS), `AED-${1000 + i}`],
      );
    }
    if (hasLora) {
      await conn.execute(
        'INSERT INTO devices (responder_id, kind, model, serial, frequency_mhz) VALUES (?, ?, ?, ?, 433)',
        [id, 'LORA_NODE', pick(LORA_MODELS), `LR-${2000 + i}`],
      );
    }

    responders.push({ id, loraId, hasAed, hasLora });
  }
  console.log(`[seed] ${responders.length} responders created`
    + ` (${responders.filter((r) => r.hasAed).length} with an AED,`
    + ` ${responders.filter((r) => r.hasLora).length} with a LoRa node)`);

  // --- editable marketing copy (requirement #12) ---------------------------
  const content = [
    ['home', 'hero', 'דפיברילטורים בשטח - מיזם התנדבותי',
      'דום לב בשטח הוא מרוץ נגד הזמן: חלון הזהב למתן שוק חשמלי הוא 0-4 דקות. אנחנו ממפים דפיברילטורים ניידים בזמן אמת, ומגייסים את מי שנמצא הכי קרוב.',
      'להצטרפות למערך המתנדבים', '/register'],
    ['home', 'lora_explainer', 'מה זה LoRa בשלוש שורות',
      'LoRa היא טכנולוגיית רדיו לטווח ארוך ובהספק נמוך, שמשדרת בישראל בתדר 433MHz.\n'
      + 'מכשירי Meshtastic מעבירים הודעה ביניהם בקפיצות (mesh), כך שהיא מגיעה גם ללא רשת סלולרית.\n'
      + 'קריאת מצוקה מגיעה כך למכשיר של המתנדב הקרוב, מצפצפת ומהבהבת - גם באמצע הטבע.',
      null, null],
    ['home', 'how_it_works', 'איך קריאת מצוקה מגיעה למתנדב',
      'שני מסלולים במקביל: ערוץ LoRa/Meshtastic שמעביר את נקודת ה-GPS דרך רשת המש, וערוץ סלולרי ששולח SMS עם המיקום ומספר הטלפון של הנפגע.',
      null, null],
    ['buy', 'intro', 'רכישת ציוד LoRa',
      'כדי להיות זמינים גם ללא קליטה סלולרית, נדרש מכשיר LoRa שעובד בתדר 433MHz - התדר החופשי לשימוש בישראל.',
      null, null],
    ['about', 'maintenance', 'תחזוקה ובדיקות תקופתיות',
      'דפיברילטור נייד דורש בדיקת סוללה ואלקטרודות. מומלץ לעדכן את המערכת פעם ברבעון שהציוד תקין וזמין.',
      'לעדכון פרטים', '/register'],
  ];
  for (const [pageKey, sectionKey, title, body, ctaLabel, ctaUrl] of content) {
    await conn.execute(
      `INSERT INTO content_blocks (page_key, section_key, title, body, cta_label, cta_url, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [pageKey, sectionKey, title, body, ctaLabel, ctaUrl, adminRes.insertId],
    );
  }

  // --- external links: MDA map (#13) + LoRa vendors (#14) -------------------
  const links = [
    ['OFFICIAL_MAP', 'מגן דוד אדום', 'מפת הדפיברילטורים הקבועים של מד"א',
      'https://defi.co.il/#/map', null,
      'מפה רשמית של מד"א ובה מיקומי הדפיברילטורים הציבוריים הקבועים בישראל.', 1],
    ['BUY_LORA', 'Heltec', 'Heltec WiFi LoRa 32 V3 - 433MHz',
      'https://heltec.org/project/wifi-lora-32-v3/', '433MHz - התדר לשימוש בישראל',
      'מודול פופולרי, זול ונתמך היטב ב-Meshtastic. ודאו שאתם מזמינים את גרסת 433MHz.', 1],
    ['BUY_LORA', 'LilyGO', 'LilyGO T-Beam - 433MHz עם GPS',
      'https://lilygo.cc/products/t-beam-v1-1-esp32-lora-module', '433MHz + GPS מובנה',
      'כולל מקלט GPS וסוללה - הבחירה הנוחה למי שרוכב או מטייל.', 2],
    ['BUY_LORA', 'RAK Wireless', 'RAK WisBlock Meshtastic Starter Kit - 433MHz',
      'https://store.rakwireless.com/collections/wisblock', '433MHz',
      'ערכת מודולים להרכבה, מתאימה למי שרוצה לבנות שער (gateway) קבוע.', 3],
    ['LEARN', 'Meshtastic', 'הפרויקט הפתוח Meshtastic',
      'https://meshtastic.org/', '433MHz / 868MHz',
      'התיעוד הרשמי של פרוטוקול המש שעליו מבוססת המערכת.', 1],
  ];
  for (const [category, vendor, label, url, frequencyNote, description, sortOrder] of links) {
    await conn.execute(
      `INSERT INTO external_links (category, vendor, label, url, frequency_note, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [category, vendor, label, url, frequencyNote, description, sortOrder],
    );
  }
  console.log(`[seed] ${content.length} content blocks, ${links.length} external links`);

  await conn.end();
  return responders;
}

// ===========================================================================
//  Ask the mesh service to raise maintenance alerts for the seeded batteries
// ===========================================================================
//  The seed writes telemetry straight into MongoDB, bypassing POST /telemetry,
//  so the low-battery hook never fires for seeded data. This closes the gap.
//  If the mesh service is not running the seed still succeeds - the alerts are
//  raised the moment someone calls POST /maintenance/reconcile, or on the next
//  real heartbeat.
// ===========================================================================
async function requestMaintenanceReconcile() {
  const meshUrl = process.env.MESH_URL || 'http://localhost:5000';
  try {
    const res = await fetch(`${meshUrl}/maintenance/reconcile`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = await res.json();
    console.log(`[seed] maintenance alerts: ${summary.created} raised, ${summary.resolved} resolved`);
  } catch (err) {
    console.log(`[seed] mesh service not reachable (${err.message}) - maintenance alerts will be`);
    console.log('[seed] raised on the next heartbeat, or run: curl -X POST http://localhost:5000/maintenance/reconcile');
  }
}

// ===========================================================================
//  2. MongoDB
// ===========================================================================
async function seedMongo(responders) {
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db(process.env.MONGO_DB || 'field_defib');

  await db.collection('telemetry').deleteMany({});
  await db.collection('alerts').deleteMany({});
  await db.collection('mesh_events').deleteMany({});

  // The 2dsphere index must exist before the radius search can run. The mesh
  // server creates it on startup too - doing it here means the data is usable
  // even if you seed before ever starting the server.
  await db.collection('telemetry').createIndex({ loc: '2dsphere' });

  // Requirement: a portion of the seeded fleet must sit BELOW the 20% low-battery
  // threshold so maintenance alerts can be demonstrated immediately, without
  // waiting for a battery to drain. Every 6th responder is forced into the
  // 10-19% band - deterministic rather than random, so the demo cannot roll a
  // dataset with no low batteries in it.
  const LOW_BATTERY_EVERY = 6;

  const docs = [];
  for (const [index, r] of responders.entries()) {
    // Coverage is a property of WHERE the person is, so it is stored with the
    // position, not with the person. Roughly 55% have a cellular signal - the
    // rest are exactly the case this project exists for.
    const cellCoverage = Math.random() < 0.55;

    // Requirement #1: is_operational is a self-test result for the AED itself,
    // not the radio's battery. It is decided ONCE per responder here, not per
    // heartbeat - a defibrillator does not pass and fail its self-test every
    // few minutes. ~85% operational, so a handful of the ~30 AED owners come
    // up broken and give the dispatch algorithm something real to route around.
    // null (not true) for anyone without an AED - the field does not apply.
    const isOperational = r.hasAed ? Math.random() < 0.85 : null;

    // A device that is low on battery stays low across its recent heartbeats -
    // batteries drain, they do not flicker. Deciding this per RESPONDER rather
    // than per heartbeat is what makes the maintenance alert stable instead of
    // opening and resolving on alternate readings.
    const forcedLowBattery = index % LOW_BATTERY_EVERY === 0;

    // 1-4 heartbeats per device, newest between 0 and 120 minutes ago.
    const beats = intBetween(1, 4);
    const newestAgeMin = between(0, 120);

    for (let b = 0; b < beats; b += 1) {
      const ageMin = newestAgeMin + b * between(20, 60);
      docs.push({
        responderId: r.id,
        loraId: r.loraId,
        loc: {
          type: 'Point',
          coordinates: [
            CENTER.lng + between(-SPREAD_DEG, SPREAD_DEG),
            CENTER.lat + between(-SPREAD_DEG, SPREAD_DEG),
          ],
        },
        // 0-100%, per the requirement. Forced low devices land in 10-19% (below
        // the 20% maintenance threshold); everyone else sits at 25-100%, safely
        // above it, so the "needs charging" list contains exactly the devices
        // we intended and not a random extra few.
        batteryLevel: forcedLowBattery ? intBetween(10, 19) : intBetween(25, 100),
        isOperational,
        // RSSI: signal strength in dBm. -60 is strong, -120 is barely there.
        rssi: r.hasLora ? -intBetween(65, 118) : null,
        snr: r.hasLora ? Number(between(-8, 11).toFixed(1)) : null,
        // How many nodes the packet passed through to reach the gateway.
        hops: r.hasLora ? intBetween(1, 3) : null,
        cellCoverage,
        ts: new Date(Date.now() - ageMin * 60 * 1000),
      });
    }
  }

  await db.collection('telemetry').insertMany(docs);
  console.log(`[seed] ${docs.length} telemetry heartbeats for ${responders.length} devices`);
  console.log(`[seed] area: Yarkon Park (${CENTER.lat}, ${CENTER.lng}), spread ~3km`);

  const lowCount = Math.ceil(responders.length / LOW_BATTERY_EVERY);
  console.log(`[seed] ${lowCount} devices seeded below 20% battery (maintenance alerts)`);

  await client.close();

  // The alerts themselves are raised by the mesh service, which owns that logic.
  // We ask it to reconcile rather than writing alert documents here - one
  // implementation of the rule, not two that could disagree.
  await requestMaintenanceReconcile();
}

// ===========================================================================
//  run
// ===========================================================================
try {
  const responders = await seedMySql();
  await seedMongo(responders);
  console.log('\n[seed] done. Both databases are ready.');
  console.log('[seed] admin login: micha / 1234');
  process.exit(0);
} catch (err) {
  console.error('\n[seed] FAILED:', err.message);
  console.error('[seed] check that MySQL and MongoDB are running, and that');
  console.error('[seed] you ran "npm run db:schema" first.');
  process.exit(1);
}
