// ============================================================================
//  TEST: low-battery maintenance alerts
// ============================================================================
//  Run with the mesh and api services up:
//      node scripts/test_maintenance_alert.js
//
//  Drives the REAL ingest path (POST /telemetry) with a synthetic device and
//  asserts the full state machine:
//
//      healthy (80%)  ->  no alert
//      low (15%)      ->  alert CREATED, owner notified once
//      still low (12%)->  same alert updated, NOT notified again
//      recovered (65%)->  alert RESOLVED
//
//  The "not notified again" case is the one that matters: a LoRa node reports
//  every few minutes, so a missing deduplication check would text the owner
//  dozens of times before the battery died.
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
const TEST_ID = 900101;
const TEST_PHONE = '0509001010';
const ORIGIN = { lat: 32.1010, lng: 34.8090 };

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}

/** Sends one heartbeat through the real ingest endpoint. */
async function sendHeartbeat(batteryLevel) {
  const res = await fetch(`${MESH_URL}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      responderId: TEST_ID,
      loraId: '!t9001010',
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      batteryLevel,
      isOperational: true,
      cellCoverage: true,
    }),
  });
  if (!res.ok) throw new Error(`POST /telemetry returned ${res.status}`);
  return res.json();
}

async function main() {
  const mongo = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB || 'field_defib');
  const tel = db.collection('telemetry');
  const maint = db.collection('maintenance_alerts');

  const sql = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'field_defib',
  });

  async function cleanup() {
    await tel.deleteMany({ responderId: TEST_ID });
    await maint.deleteMany({ responderId: TEST_ID });
    await sql.query('DELETE FROM devices WHERE responder_id = ?', [TEST_ID]);
    await sql.query('DELETE FROM responders WHERE id = ?', [TEST_ID]);
  }

  const openAlert = () => maint.findOne({ responderId: TEST_ID, type: 'LOW_BATTERY', status: 'OPEN' });

  try {
    await cleanup();

    // The owner must exist in MySQL so the notification can reach a phone -
    // this also exercises the mesh -> api lookup inside the alert path.
    await sql.execute(
      `INSERT INTO responders (id, first_name, last_name, phone, lora_id, is_active, consent_at)
       VALUES (?, 'בדיקת', 'תחזוקה', ?, '!t9001010', 1, NOW())`,
      [TEST_ID, TEST_PHONE],
    );
    await sql.execute(
      'INSERT INTO devices (responder_id, kind, frequency_mhz) VALUES (?, ?, 433)', [TEST_ID, 'LORA_NODE'],
    );

    // ---- 1. healthy battery: nothing should happen ----------------------
    console.log('\n=== 1. Healthy battery (80%) ===');
    let r = await sendHeartbeat(80);
    assert('response reports lowBattery = false', r.lowBattery === false);
    assert('no maintenance alert raised', (await openAlert()) === null);

    // ---- 2. drops below the threshold -----------------------------------
    console.log('\n=== 2. Battery drops to 15% (below the 20% threshold) ===');
    r = await sendHeartbeat(15);
    assert('response reports lowBattery = true', r.lowBattery === true);
    assert('threshold reported as 20', r.threshold === 20);
    assert('state machine reports CREATED', r.maintenance === 'CREATED');
    assert('owner was notified', r.notified === true);

    const created = await openAlert();
    assert('an OPEN alert exists in maintenance_alerts', Boolean(created));
    assert('alert records the triggering level', created?.batteryLevel === 15);
    assert('alert is typed LOW_BATTERY', created?.type === 'LOW_BATTERY');
    assert('owner resolved from MySQL', created?.owner?.phone === TEST_PHONE);
    assert('notification recorded as SMS', created?.notification?.channel === 'SMS');
    assert('notification carries a message body', Boolean(created?.notification?.message));

    // ---- 3. still low: must NOT notify a second time ---------------------
    console.log('\n=== 3. Still low (12%) - deduplication ===');
    r = await sendHeartbeat(12);
    assert('state machine reports ALREADY_OPEN', r.maintenance === 'ALREADY_OPEN');
    assert('owner was NOT notified again', r.notified === false);

    const stillOpen = await openAlert();
    assert('still exactly one OPEN alert',
      (await maint.countDocuments({ responderId: TEST_ID, status: 'OPEN' })) === 1);
    assert('lowest level tracked (12%)', stillOpen?.lowestBatteryLevel === 12);
    assert('reading counter incremented', stillOpen?.readingsWhileOpen === 2);
    assert('original notification timestamp unchanged',
      String(stillOpen?.notification?.sentAt) === String(created?.notification?.sentAt));

    // ---- 4. recovery ------------------------------------------------------
    console.log('\n=== 4. Battery recovers to 65% ===');
    r = await sendHeartbeat(65);
    assert('response reports lowBattery = false', r.lowBattery === false);
    assert('state machine reports RESOLVED', r.maintenance === 'RESOLVED');
    assert('no OPEN alert remains', (await openAlert()) === null);

    const resolved = await maint.findOne({ responderId: TEST_ID, status: 'RESOLVED' });
    assert('resolved alert retained for the audit trail', Boolean(resolved));
    assert('resolution level recorded', resolved?.resolvedAtLevel === 65);

    // ---- 5. it appears in the admin-facing feed --------------------------
    console.log('\n=== 5. Visibility through /maintenance/alerts ===');
    await sendHeartbeat(11);            // go low again so there is something to list
    const feed = await (await fetch(`${MESH_URL}/maintenance/alerts`)).json();
    assert('endpoint reports the threshold', feed.threshold === 20);
    assert('our device appears in the open queue',
      feed.alerts.some((a) => a.responderId === TEST_ID));
    const listed = feed.alerts.find((a) => a.responderId === TEST_ID);
    assert('queue entry exposes the owner phone for the operator',
      listed?.owner?.phone === TEST_PHONE);
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
