// ============================================================================
//  TEST: geo-fencing, freshness and responder prioritisation
// ============================================================================
//  Run with the mesh and api services up:   node scripts/test_geofencing.js
//
//  Rather than trusting the seeded data to happen to contain the interesting
//  cases, this builds them: synthetic responders are inserted at known
//  distances with known equipment, the real dispatch pipeline is exercised
//  through POST /alerts, and the results are asserted.
//
//  All synthetic data uses ids from 900000 up and is removed afterwards, so a
//  run leaves the database exactly as it found it.
// ============================================================================
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, 'api', '.env') });
dotenv.config({ path: path.join(root, 'mesh', '.env') });

const MESH_URL = process.env.MESH_URL || 'http://localhost:5000';

// Deliberately FAR from the seeded fleet (Yarkon Park, ~32.101/34.809, spread
// ~3 km). If the test ran on top of the seed data, a real responder could win
// the prioritisation check and the assertions would pass without proving
// anything about the ranking logic. Out here the only candidates are the ones
// this file created, so the outcome is fully determined by the scenarios below.
const ORIGIN = { lat: 32.6000, lng: 35.3000 };
const RADIUS_M = 1000;

// Roughly 0.001 degrees of longitude ~= 94 m at this latitude.
const EAST = (metres) => ORIGIN.lng + (metres / 94) * 0.001;

// --- the scenarios, each an id we can assert on ----------------------------
const CASES = [
  { id: 900001, name: 'קרוב מאוד, ללא דפיברילטור', distanceM: 150, hasAed: false, isOperational: null, ageMin: 5, expectInRadius: true },
  { id: 900002, name: 'דפיברילטור תקין, בינוני', distanceM: 400, hasAed: true, isOperational: true, ageMin: 5, expectInRadius: true },
  { id: 900003, name: 'דפיברילטור לא תקין, קרוב', distanceM: 200, hasAed: true, isOperational: false, ageMin: 5, expectInRadius: true },
  { id: 900004, name: 'דפיברילטור תקין, רחוק מהרדיוס', distanceM: 3000, hasAed: true, isOperational: true, ageMin: 5, expectInRadius: false },
  { id: 900005, name: 'בתוך הרדיוס אך שקט 10 שעות', distanceM: 300, hasAed: true, isOperational: true, ageMin: 600, expectInRadius: false },
];

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
async function main() {
  const mongo = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
  await mongo.connect();
  const tel = mongo.db(process.env.MONGO_DB || 'field_defib').collection('telemetry');

  const sql = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'field_defib',
  });

  const ids = CASES.map((c) => c.id);

  async function cleanup() {
    await tel.deleteMany({ responderId: { $in: ids } });
    await sql.query('DELETE FROM devices WHERE responder_id IN (?)', [ids]);
    await sql.query('DELETE FROM responders WHERE id IN (?)', [ids]);
  }

  try {
    console.log('\n=== SETUP: inserting synthetic responders ===');
    await cleanup();

    for (const c of CASES) {
      // MySQL: the person and their equipment
      await sql.execute(
        `INSERT INTO responders (id, first_name, phone, lora_id, is_active, consent_at)
         VALUES (?, ?, ?, ?, 1, NOW())`,
        [c.id, c.name, `05${String(c.id).slice(-8)}`, `!t${String(c.id).slice(-7)}`],
      );
      if (c.hasAed) {
        await sql.execute(
          'INSERT INTO devices (responder_id, kind, frequency_mhz) VALUES (?, ?, NULL)', [c.id, 'AED'],
        );
      }
      await sql.execute(
        'INSERT INTO devices (responder_id, kind, frequency_mhz) VALUES (?, ?, 433)', [c.id, 'LORA_NODE'],
      );

      // MongoDB: where they are and when they last spoke
      await tel.insertOne({
        responderId: c.id,
        loraId: `!t${String(c.id).slice(-7)}`,
        loc: { type: 'Point', coordinates: [EAST(c.distanceM), ORIGIN.lat] },
        batteryLevel: 80,
        isOperational: c.isOperational,
        cellCoverage: true,
        ts: new Date(Date.now() - c.ageMin * 60 * 1000),
      });
    }
    console.log(`  inserted ${CASES.length} synthetic responders`);

    // ---------------------------------------------------------------------
    console.log(`\n=== DISPATCH: distress call at ${ORIGIN.lat},${ORIGIN.lng}, radius ${RADIUS_M} m ===`);
    const res = await fetch(`${MESH_URL}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: ORIGIN,
        radiusM: RADIUS_M,
        sampleSize: 25,
        victim: { name: 'בדיקת גיאופנסינג', phone: '0500000000' },
      }),
    });
    if (!res.ok) throw new Error(`POST /alerts returned ${res.status}`);
    const alert = await res.json();

    const returned = new Set(alert.candidates.map((c) => c.responderId));
    const mine = alert.candidates.filter((c) => ids.includes(c.responderId));
    console.log(`  alert ${alert.alertId}: ${alert.stats.found} candidates total, ${mine.length} of them synthetic`);

    // The whole point of the remote origin - if a seeded responder appeared
    // here, the prioritisation assertions below would prove nothing.
    assert('only synthetic responders are in range (test is isolated)',
      alert.candidates.length === mine.length,
      `${alert.candidates.length - mine.length} unexpected real responders in range`);

    // ---- 1. geo-fence: only devices inside the radius --------------------
    console.log('\n=== 1. Geo-fencing ($geoNear + 2dsphere) ===');
    for (const c of CASES) {
      assert(
        `${c.expectInRadius ? 'inside' : 'outside'} radius: ${c.name}`,
        returned.has(c.id) === c.expectInRadius,
        `id ${c.id} was ${returned.has(c.id) ? 'returned' : 'omitted'}`,
      );
    }
    assert(
      'every returned candidate is within the radius',
      alert.candidates.every((c) => c.distanceM <= RADIUS_M),
      `max distance seen: ${Math.max(...alert.candidates.map((c) => c.distanceM))}`,
    );

    // ---- 2. freshness ----------------------------------------------------
    console.log('\n=== 2. Heartbeat freshness (MAX_HEARTBEAT_AGE_MIN) ===');
    assert('device silent for 10 hours is excluded', !returned.has(900005));
    assert(
      'no candidate has a stale heartbeat',
      alert.candidates.every((c) => c.lastSeenMinutes <= Number(process.env.MAX_HEARTBEAT_AGE_MIN || 180)),
    );

    // ---- 3. cross-server join -------------------------------------------
    console.log('\n=== 3. Cross-server join (MongoDB geo + MySQL profile) ===');
    const withAed = mine.find((c) => c.responderId === 900002);
    assert('profile data joined from MySQL (name present)', Boolean(withAed?.name));
    assert('profile data joined from MySQL (phone present)', Boolean(withAed?.phone));
    assert('hasAed resolved from the devices table', withAed?.hasAed === true);
    assert('hasLora resolved from the devices table', withAed?.hasLora === true);
    assert('isOperational carried from telemetry', withAed?.isOperational === true);

    // ---- 4. prioritisation ----------------------------------------------
    console.log('\n=== 4. Responder selection & prioritisation ===');
    const primary = alert.candidates.find((c) => c.responderId === alert.primaryResponderId);
    console.log(`  selected: ${primary?.name} (${primary?.distanceM} m, aed=${primary?.hasAed}, operational=${primary?.isOperational})`);

    // 900002 is the operational AED at 400 m. It must beat BOTH the closer
    // no-AED responder (900001, 150 m) and the closer broken AED (900003,
    // 200 m) - equipment outranks proximity, which is the rule under test.
    assert('the operational defibrillator at 400 m was selected',
      primary?.responderId === 900002,
      `selected ${primary?.responderId} instead`);
    assert('the CLOSER responder without a defibrillator was passed over',
      primary?.responderId !== 900001 && returned.has(900001));
    assert('the CLOSER responder with a BROKEN defibrillator was passed over',
      primary?.responderId !== 900003 && returned.has(900003));
    assert('the selected responder carries an operational AED',
      primary?.hasAed === true && primary?.isOperational === true);

    // ---- 5. required response fields -------------------------------------
    console.log('\n=== 5. Response payload completeness ===');
    const sample = alert.candidates[0];
    for (const field of ['distanceM', 'channel', 'isOperational', 'batteryLevel', 'lastSeen', 'lowBattery']) {
      assert(`candidate exposes "${field}"`, field in sample);
    }
    assert('channel is one of LORA / SMS / NONE',
      alert.candidates.every((c) => ['LORA', 'SMS', 'NONE'].includes(c.channel)));
    assert('alert carries a bicycle route', Boolean(alert.route?.coordinates?.length));

    // ---- cleanup ---------------------------------------------------------
    await mongo.db(process.env.MONGO_DB || 'field_defib').collection('alerts')
      .deleteOne({ alertId: alert.alertId });
    await mongo.db(process.env.MONGO_DB || 'field_defib').collection('mesh_events')
      .deleteMany({ alertId: alert.alertId });
  } finally {
    await cleanup();
    await sql.end();
    await mongo.close();
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(52));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n[test] ERROR:', err.message);
  console.error('[test] are the api and mesh services running? (npm run dev)');
  process.exit(1);
});
