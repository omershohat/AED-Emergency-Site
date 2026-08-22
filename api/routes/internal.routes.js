// ============================================================================
//  /internal - server-to-server only. Guarded by the shared service key.
// ============================================================================
//  THIS IS THE JOIN BETWEEN THE TWO DATABASES.
//
//  During a distress call the mesh service asks MongoDB "who was near this
//  point recently?" and gets back a list of responder ids - geography only.
//  It then calls this route to turn those ids into people: names, phones and
//  what equipment they carry, which lives in MySQL.
//
//  Because we chose to split the data, we own the join. It happens here, at
//  the service layer, over one HTTP call with an IN (...) query - not one
//  query per responder.
// ============================================================================
import express from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../middleware/common.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /internal/responders?ids=17,23,41
// ---------------------------------------------------------------------------
router.get('/responders', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isInteger)
    .slice(0, 200);                    // hard ceiling: one alert cannot ask for more

  if (!ids.length) return res.json([]);

  // An IN clause needs one placeholder per value, so we build "?,?,?" to match
  // the array length. The values themselves are still bound, never inlined.
  const placeholders = ids.map(() => '?').join(',');

  const rows = await query(`
    SELECT r.id, r.first_name, r.last_name, r.phone, r.lora_id, r.city,
           MAX(d.kind = 'AED')       AS has_aed,
           MAX(d.kind = 'LORA_NODE') AS has_lora
      FROM responders r
      LEFT JOIN devices d ON d.responder_id = r.id
     WHERE r.id IN (${placeholders}) AND r.is_active = 1
     GROUP BY r.id`,
    ids,
  );

  res.json(rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    loraId: r.lora_id,
    city: r.city,
    hasAed: Boolean(Number(r.has_aed)),
    hasLora: Boolean(Number(r.has_lora)),
  })));
}));

// ---------------------------------------------------------------------------
// GET /internal/responders/all - used by the seeding script and by the mesh
//     service when it needs the whole roster (50 simulator users).
// ---------------------------------------------------------------------------
router.get('/responders/all', asyncHandler(async (_req, res) => {
  const rows = await query(`
    SELECT r.id, r.first_name, r.last_name, r.phone, r.lora_id,
           MAX(d.kind = 'AED')       AS has_aed,
           MAX(d.kind = 'LORA_NODE') AS has_lora
      FROM responders r
      LEFT JOIN devices d ON d.responder_id = r.id
     WHERE r.is_active = 1
     GROUP BY r.id`);

  res.json(rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    loraId: r.lora_id,
    hasAed: Boolean(Number(r.has_aed)),
    hasLora: Boolean(Number(r.has_lora)),
  })));
}));

export default router;
