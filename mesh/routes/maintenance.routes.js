// ============================================================================
//  /maintenance - the low-battery work queue
// ============================================================================
//  Read-only for the admin panel, plus a reconcile trigger used after seeding.
// ============================================================================
import express from 'express';
import { asyncHandler } from '../middleware/common.js';
import { collections } from '../db/mongo.js';
import { listOpenAlerts, reconcileAllBatteries, LOW_BATTERY_THRESHOLD } from '../lib/maintenance.js';
import { MAX_HEARTBEAT_AGE_MIN, freshnessCutoff } from '../lib/freshness.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /maintenance/alerts - devices currently needing attention
// ---------------------------------------------------------------------------
router.get('/alerts', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const alerts = await listOpenAlerts(limit);

  res.json({
    threshold: LOW_BATTERY_THRESHOLD,
    openCount: alerts.length,
    alerts,
  });
}));

// ---------------------------------------------------------------------------
// GET /maintenance/history - resolved alerts too, for the audit trail
// ---------------------------------------------------------------------------
router.get('/history', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const alerts = await collections.maintenanceAlerts()
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  res.json({ threshold: LOW_BATTERY_THRESHOLD, alerts });
}));

// ---------------------------------------------------------------------------
// POST /maintenance/reconcile - re-evaluate every device from its latest fix
//
//     Needed because the seed script writes telemetry directly into MongoDB
//     rather than through POST /telemetry, so seeded low batteries never pass
//     the ingest hook. Idempotent: running it twice changes nothing.
// ---------------------------------------------------------------------------
router.post('/reconcile', asyncHandler(async (_req, res) => {
  const summary = await reconcileAllBatteries();
  console.log('[mesh] maintenance reconcile:', JSON.stringify(summary));
  res.json({ threshold: LOW_BATTERY_THRESHOLD, ...summary });
}));

// ---------------------------------------------------------------------------
// GET /maintenance/telemetry-health
//
//     Diagnoses whether seed data has gone stale. Dispatch silently returns
//     zero candidates when ALL heartbeats are older than MAX_HEARTBEAT_AGE_MIN
//     (default: 3 hours). This endpoint surfaces that before it bites.
// ---------------------------------------------------------------------------
router.get('/telemetry-health', asyncHandler(async (_req, res) => {
  const cutoff = freshnessCutoff();
  const total = await collections.telemetry().countDocuments();
  const fresh = await collections.telemetry().countDocuments({ ts: { $gte: cutoff } });
  const stale = total - fresh;
  const newest = await collections.telemetry()
    .find({}, { projection: { ts: 1 } })
    .sort({ ts: -1 })
    .limit(1)
    .toArray();

  const newestTs = newest[0]?.ts ?? null;
  const ageMinutes = newestTs
    ? Math.round((Date.now() - new Date(newestTs).getTime()) / 60000)
    : null;

  const ok = fresh > 0;

  if (!ok) {
    console.warn(`[mesh] telemetry-health: ALL ${total} docs are stale (newest is ${ageMinutes} min old). Run POST /maintenance/refresh-telemetry.`);
  }

  res.status(ok ? 200 : 503).json({
    ok,
    total,
    fresh,
    stale,
    freshnessWindowMin: MAX_HEARTBEAT_AGE_MIN,
    newestTs,
    newestAgeMinutes: ageMinutes,
    advice: ok ? null : 'All telemetry is stale. POST /maintenance/refresh-telemetry to fix, or run npm run seed.',
  });
}));

// ---------------------------------------------------------------------------
// POST /maintenance/refresh-telemetry
//
//     Simulator-only convenience: bumps every heartbeat's timestamp so it
//     falls within the freshness window. This is safe because the positions
//     are seeded dummy data - no real-world reading is being falsified.
//
//     Without this, the seed must be re-run every 3 hours, which resets the
//     admin, content and links tables too. This endpoint only touches ts.
// ---------------------------------------------------------------------------
router.post('/refresh-telemetry', asyncHandler(async (_req, res) => {
  const telemetry = collections.telemetry();
  const total = await telemetry.countDocuments();
  if (total === 0) {
    return res.status(404).json({ error: 'No telemetry documents found. Run npm run seed first.' });
  }

  // Fetch all docs with their age-offset so we can rebase them around "now".
  // We preserve the relative spacing between heartbeats (newest stays newest,
  // oldest stays oldest) - only the absolute timestamps shift forward.
  const docs = await telemetry
    .find({}, { projection: { _id: 1, ts: 1 } })
    .sort({ ts: -1 })
    .toArray();

  const newestOriginal = new Date(docs[0].ts).getTime();
  const now = Date.now();
  // The newest heartbeat becomes "5 minutes ago"; everything else keeps
  // the same relative distance behind it.
  const shift = now - newestOriginal - 5 * 60 * 1000;

  const ops = docs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { ts: new Date(new Date(doc.ts).getTime() + shift) } },
    },
  }));

  const result = await telemetry.bulkWrite(ops, { ordered: false });
  console.log(`[mesh] refresh-telemetry: shifted ${result.modifiedCount} heartbeats by ${Math.round(shift / 60000)} minutes`);

  res.json({
    ok: true,
    updated: result.modifiedCount,
    shiftedByMinutes: Math.round(shift / 60000),
    message: 'Telemetry timestamps refreshed. Dispatch will now find candidates.',
  });
}));

export default router;
