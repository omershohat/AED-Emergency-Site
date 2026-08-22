// ============================================================================
//  /internal - server-to-server only. The mirror of api's /internal routes.
// ============================================================================
//  THE OTHER HALF OF THE CROSS-DATABASE JOIN.
//
//  During a dispatch, mesh asks api to turn responder ids into people.
//  Here the traffic runs the other way: the admin panel lists registrations
//  out of MySQL, and needs to show when each of those devices last transmitted
//  - a fact that only exists in MongoDB.
//
//  Same rule as the dispatch join: ONE request for the whole page of ids, not
//  one request per row.
// ============================================================================
import express from 'express';
import { collections } from '../db/mongo.js';
import { asyncHandler } from '../middleware/common.js';
import { MAX_HEARTBEAT_AGE_MIN, freshnessCutoff } from '../lib/freshness.js';
import { isLowBattery } from '../lib/maintenance.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /internal/last-seen?ids=17,23,41
// ---------------------------------------------------------------------------
router.get('/last-seen', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isInteger)
    .slice(0, 200);            // hard ceiling - one admin page cannot ask for more

  if (!ids.length) return res.json({ maxAgeMinutes: MAX_HEARTBEAT_AGE_MIN, devices: [] });

  const cutoff = freshnessCutoff();

  // Reduce each requested device to its newest heartbeat. Responders who have
  // never transmitted simply do not appear here - the caller treats a missing
  // id as "never", which is different from "transmitted long ago".
  const rows = await collections.telemetry().aggregate([
    { $match: { responderId: { $in: ids } } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$responderId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
    { $project: { _id: 0, responderId: 1, ts: 1, batteryLevel: 1, isOperational: 1 } },
  ]).toArray();

  res.json({
    maxAgeMinutes: MAX_HEARTBEAT_AGE_MIN,
    devices: rows.map((t) => ({
      responderId: t.responderId,
      lastSeen: t.ts,
      minutesAgo: Math.round((Date.now() - new Date(t.ts)) / 60000),
      // The same threshold the map and the dispatcher use, so the admin panel
      // agrees with both about who is currently reachable.
      isTransmitting: t.ts >= cutoff,
      batteryLevel: t.batteryLevel ?? null,
      // Derived here so the admin panel does not have to know the threshold.
      lowBattery: isLowBattery(t.batteryLevel),
      isOperational: t.isOperational ?? null,
    })),
  });
}));

export default router;
