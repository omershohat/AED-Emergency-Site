// ============================================================================
//  /route - bicycle routing proxy   (Requirement #10)
// ============================================================================
//  The browser asks us, we ask BRouter. See lib/routing.js for why the call
//  does not happen directly from the client.
// ============================================================================
import express from 'express';
import { getBikeRoute } from '../lib/routing.js';
import { asyncHandler } from '../middleware/common.js';

const router = express.Router();

// GET /route?fromLat=&fromLng=&toLat=&toLng=
router.get('/', asyncHandler(async (req, res) => {
  const nums = ['fromLat', 'fromLng', 'toLat', 'toLng'].map((k) => Number(req.query[k]));
  if (nums.some((n) => !Number.isFinite(n))) {
    return res.status(422).json({ error: 'חסרות קואורדינטות למסלול' });
  }

  const [fromLat, fromLng, toLat, toLng] = nums;
  const route = await getBikeRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  res.json(route);
}));

export default router;
