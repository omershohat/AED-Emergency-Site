// ============================================================================
//  /alerts - the simulator's distress calls
// ============================================================================
import express from 'express';
import { createAlert, getAlert, listAlerts } from '../lib/dispatch.js';
import { asyncHandler } from '../middleware/common.js';
import { collections } from '../db/mongo.js';

const router = express.Router();

/** Guards against a request that would scan half the country or the whole DB. */
const MAX_RADIUS_M = 20000;
const MAX_SAMPLE = 25;

// ---------------------------------------------------------------------------
// POST /alerts - trigger the distress signal (the simulator's red button)
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const lat = Number(req.body?.origin?.lat);
  const lng = Number(req.body?.origin?.lng);

  // Latitude and longitude have hard physical limits - checking them here means
  // an impossible point never reaches the $geoNear stage, which would throw a
  // driver error the user could not understand.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(422).json({ error: 'נקודת מוצא לא תקינה' });
  }

  const radiusM = Math.min(MAX_RADIUS_M, Math.max(100, Number(req.body.radiusM) || 1500));
  const sampleSize = Math.min(MAX_SAMPLE, Math.max(1, Number(req.body.sampleSize) || 8));

  const alert = await createAlert({
    origin: { lat, lng },
    radiusM,
    sampleSize,
    victim: {
      name: String(req.body?.victim?.name ?? '').trim().slice(0, 60) || null,
      phone: String(req.body?.victim?.phone ?? '').trim().slice(0, 15) || null,
    },
  });

  // 201 Created + the whole document, so the emergency page can render
  // immediately and then keep updating from the WebSocket.
  res.status(201).json({ ...alert, _id: undefined });
}));

// ---------------------------------------------------------------------------
// GET /alerts - recent calls (the admin dashboard list)
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json(await listAlerts(limit));
}));

// ---------------------------------------------------------------------------
// GET /alerts/:alertId - one call, with its candidates, route and timeline
// ---------------------------------------------------------------------------
router.get('/:alertId', asyncHandler(async (req, res) => {
  const alert = await getAlert(req.params.alertId);
  if (!alert) return res.status(404).json({ error: 'קריאת המצוקה לא נמצאה' });
  res.json(alert);
}));

// ---------------------------------------------------------------------------
// GET /alerts/:alertId/events - the raw radio log behind the pretty timeline
// ---------------------------------------------------------------------------
router.get('/:alertId/events', asyncHandler(async (req, res) => {
  const events = await collections.meshEvents()
    .find({ alertId: req.params.alertId }, { projection: { _id: 0 } })
    .sort({ at: 1 })
    .toArray();
  res.json(events);
}));

export default router;
