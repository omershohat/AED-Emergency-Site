// ============================================================================
//  /responders - PUBLIC registration    (Requirements #6, #8, #15)
// ============================================================================
//  There is no verifyJwt on this router, and that is intentional:
//  requirement #15 says a citizen registers without a password and without an
//  account. The only thing standing between the form and the database is
//  validation.
// ============================================================================
import express from 'express';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/common.js';
import { validateRegistration, normalisePhone } from '../lib/validate.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /responders - register a new volunteer responder
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const result = validateRegistration(req.body);
  if (!result.ok) {
    // 422 = the request was understood but the content is invalid.
    // We return a map of field -> message so the form can mark the exact input.
    return res.status(422).json({ error: 'קיימות שגיאות בטופס', fields: result.errors });
  }

  const v = result.value;

  // One transaction for two tables: a responder without their devices would be
  // invisible to the dispatcher, so we never want half of this to land.
  const responderId = await withTransaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO responders (first_name, last_name, phone, lora_id, city, consent_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [v.firstName, v.lastName, v.phone, v.loraId, v.city],
    );
    const id = insert.insertId;

    if (v.hasAed) {
      await conn.execute(
        'INSERT INTO devices (responder_id, kind, model, frequency_mhz) VALUES (?, ?, ?, NULL)',
        [id, 'AED', v.aedModel],
      );
    }
    if (v.hasLora) {
      await conn.execute(
        'INSERT INTO devices (responder_id, kind, model, frequency_mhz) VALUES (?, ?, ?, 433)',
        [id, 'LORA_NODE', v.loraModel],
      );
    }
    return id;
  });

  res.status(201).json({
    id: responderId,
    message: 'ההרשמה הושלמה. תודה שאתם חלק ממערך ההצלה!',
    loraId: v.loraId,
  });
}));

// ---------------------------------------------------------------------------
// GET /responders/phone-taken?phone=05... - live check for the registration form
// ---------------------------------------------------------------------------
router.get('/phone-taken', asyncHandler(async (req, res) => {
  const phone = normalisePhone(String(req.query.phone ?? ''));
  if (!phone) return res.json({ taken: false });

  const rows = await query('SELECT 1 FROM responders WHERE phone = ? LIMIT 1', [phone]);
  // We answer only true/false - never "this number belongs to Dana Levi".
  res.json({ taken: rows.length > 0 });
}));

// ---------------------------------------------------------------------------
// GET /responders/stats - harmless aggregate numbers for the landing page
// ---------------------------------------------------------------------------
router.get('/stats', asyncHandler(async (_req, res) => {
  const rows = await query(`
    SELECT
      COUNT(DISTINCT r.id) AS responders,
      COUNT(DISTINCT CASE WHEN d.kind = 'AED'       THEN r.id END) AS aed_owners,
      COUNT(DISTINCT CASE WHEN d.kind = 'LORA_NODE' THEN r.id END) AS lora_owners
    FROM responders r
    LEFT JOIN devices d ON d.responder_id = r.id
    WHERE r.is_active = 1
  `);
  res.json(rows[0]);
}));

export default router;
