// ============================================================================
//  /telemetry - device heartbeats in, map markers out
// ============================================================================
//  In a real deployment a Meshtastic gateway would POST here every few minutes.
//  In the simulator the seed script writes the same documents, so the rest of
//  the system cannot tell the difference - which is what makes the simulator
//  honest rather than a mock.
// ============================================================================
import express from 'express';
import { collections } from '../db/mongo.js';
import { asyncHandler } from '../middleware/common.js';
import { MAX_HEARTBEAT_AGE_MIN, freshnessCutoff } from '../lib/freshness.js';
import { evaluateBattery, isLowBattery, LOW_BATTERY_THRESHOLD } from '../lib/maintenance.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /telemetry - one heartbeat
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const {
    responderId, loraId, lat, lng,
    batteryLevel, isOperational, rssi, snr, hops, cellCoverage,
  } = req.body;

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(422).json({ error: 'קואורדינטות לא תקינות' });
  }

  // batteryLevel and isOperational are Requirement #1's device-health fields.
  // They travel with every heartbeat because they change over time, exactly
  // like the position does - a device health snapshot from an hour ago is as
  // stale as a position from an hour ago, so it belongs in telemetry, not on
  // the responder's static registration row in MySQL.
  const level = Number(batteryLevel);

  const doc = {
    responderId: Number(responderId) || null,
    loraId: loraId ?? null,
    // GeoJSON order is [longitude, latitude] - the opposite of how people say
    // it. Getting this backwards puts every device in the wrong hemisphere, so
    // it is worth stating once, loudly.
    loc: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    // Clamped to the 0-100% range the requirement specifies, and null (not 0)
    // when the field was not sent - 0% is a real, alarming reading, and must
    // not be confused with "not reported."
    batteryLevel: Number.isFinite(level) ? Math.min(100, Math.max(0, level)) : null,
    // Whether the DEFIBRILLATOR itself is ready to use - independent of the
    // radio's battery. A phone or LoRa node can be fully charged while the
    // AED it is paired with has expired pads or failed its self-test.
    isOperational: typeof isOperational === 'boolean' ? isOperational : null,
    rssi: rssi ?? null,
    snr: snr ?? null,
    hops: hops ?? null,
    cellCoverage: Boolean(cellCoverage),
    ts: new Date(),
  };

  await collections.telemetry().insertOne(doc);

  // Every ingested heartbeat is checked for low battery. This is the hook a
  // real Meshtastic gateway would trigger, so maintenance alerts are raised by
  // the same path that carries live data - not by a separate cron job that
  // could drift out of step with reality.
  const maintenance = await evaluateBattery({
    responderId: doc.responderId,
    loraId: doc.loraId,
    batteryLevel: doc.batteryLevel,
  });

  res.status(201).json({
    ok: true,
    lowBattery: isLowBattery(doc.batteryLevel),
    threshold: LOW_BATTERY_THRESHOLD,
    // Lets the caller (and the test script) see exactly what the alert state
    // machine decided: CREATED, ALREADY_OPEN, RESOLVED, OK or SKIPPED_NO_DATA.
    maintenance: maintenance.action,
    notified: maintenance.notified ?? false,
  });
}));

// ---------------------------------------------------------------------------
// GET /telemetry/latest - the newest position of every device that is still
//     transmitting. Used to paint the map before any distress call.
//
//     A device is only drawn if it has broadcast within MAX_HEARTBEAT_AGE_MIN.
//     That is the SAME threshold the dispatch engine uses, imported from the
//     same module - so the map never shows a device the dispatcher would refuse
//     to send, which would be a map that lies.
//
//     Silent devices are counted rather than silently dropped, so the UI can
//     say "43 of 50 transmitting" instead of quietly showing seven fewer dots
//     than the database contains.
// ---------------------------------------------------------------------------
router.get('/latest', asyncHandler(async (_req, res) => {
  const cutoff = freshnessCutoff();

  // Reduce to each device's newest heartbeat FIRST, then judge its age. Doing
  // it the other way round (filtering heartbeats by age, then grouping) would
  // answer a different question: "the newest heartbeat that happens to be
  // recent" rather than "is this device's newest heartbeat recent?"
  const rows = await collections.telemetry().aggregate([
    { $sort: { ts: -1 } },
    { $group: { _id: '$responderId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
    { $project: { _id: 0 } },
  ]).toArray();

  const transmitting = rows.filter((t) => t.ts >= cutoff);

  res.json({
    maxAgeMinutes: MAX_HEARTBEAT_AGE_MIN,
    counts: {
      transmitting: transmitting.length,
      silent: rows.length - transmitting.length,
      total: rows.length,
    },
    devices: transmitting.map((t) => ({
      responderId: t.responderId,
      loraId: t.loraId,
      lat: t.loc.coordinates[1],
      lng: t.loc.coordinates[0],
      batteryLevel: t.batteryLevel,
      // Derived on read from the single threshold definition, so the map, the
      // admin panel and the dispatcher can never disagree about who is low.
      lowBattery: isLowBattery(t.batteryLevel),
      isOperational: t.isOperational,
      rssi: t.rssi,
      hops: t.hops,
      cellCoverage: t.cellCoverage,
      lastSeen: t.ts,
      minutesAgo: Math.round((Date.now() - new Date(t.ts)) / 60000),
    })),
  });
}));

export default router;
