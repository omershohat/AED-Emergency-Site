// ============================================================================
//  /admin - the maintenance panel API   (Requirements #3, #12)
// ============================================================================
//  Every route here is behind verifyJwt, which is applied once in server.js
//  when this router is mounted. That is the difference between "global" and
//  "route-specific" middleware in practice.
// ============================================================================
import express from 'express';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/common.js';
import { parsePaging, normalisePhone, normaliseLoraId } from '../lib/validate.js';

const router = express.Router();

const MESH_URL = process.env.MESH_URL || 'http://localhost:5000';
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

/**
 * Asks the mesh service when each of these devices last transmitted.
 *
 * This is the SAME cross-database join the dispatcher performs, running in the
 * opposite direction: registrations live in MySQL, heartbeats live in MongoDB,
 * and neither server opens the other's database. One request covers the whole
 * page of ids rather than one per row.
 *
 * It NEVER throws. The admin panel's job is managing registrations, which is
 * entirely MySQL work - it must not stop working because the telemetry service
 * is down. On failure the column simply reports "unknown" and the rest of the
 * table behaves exactly as before.
 *
 * @returns {Promise<Map<number, object>>} responderId -> health, empty if unavailable
 */
async function fetchLastSeen(responderIds) {
  if (!responderIds.length) return new Map();

  try {
    const url = `${MESH_URL}/internal/last-seen?ids=${responderIds.join(',')}`;
    const response = await fetch(url, {
      headers: { 'x-service-key': SERVICE_KEY },
      // Without a timeout, a hung mesh service would hang the admin page too.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return new Map();

    const data = await response.json();
    return new Map(data.devices.map((d) => [d.responderId, d]));
  } catch (err) {
    console.warn('[api] last-seen lookup unavailable:', err.message);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// GET /admin/responders?search=&type=&page=&limit=
//     The registration database, searchable and paged.
// ---------------------------------------------------------------------------
router.get('/responders', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query);
  const search = String(req.query.search ?? '').trim();
  const type = String(req.query.type ?? '').trim();   // '', 'AED', 'LORA_NODE'

  // The WHERE clause is built from a whitelist of conditions and an array of
  // parameters. The user's text never touches the SQL string itself.
  const where = [];
  const params = [];

  if (search) {
    where.push('(r.first_name LIKE ? OR r.last_name LIKE ? OR r.phone LIKE ? OR r.lora_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (type === 'AED' || type === 'LORA_NODE') {
    where.push('EXISTS (SELECT 1 FROM devices d2 WHERE d2.responder_id = r.id AND d2.kind = ?)');
    params.push(type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // GROUP_CONCAT collapses the 1:N devices into one column, so the table can be
  // rendered from a single query instead of N+1 round trips.
  //
  // LIMIT/OFFSET are interpolated rather than bound: MySQL's prepared-statement
  // protocol rejects placeholders there. It is safe *only* because parsePaging()
  // ran Number.parseInt and clamped both values - they are integers by
  // construction and can never carry user text. Every other value is still bound.
  const rows = await query(`
    SELECT r.id, r.first_name, r.last_name, r.phone, r.lora_id, r.city,
           r.is_active, r.created_at,
           GROUP_CONCAT(d.kind ORDER BY d.kind SEPARATOR ',') AS devices
      FROM responders r
      LEFT JOIN devices d ON d.responder_id = r.id
      ${whereSql}
     GROUP BY r.id
     ORDER BY r.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM responders r ${whereSql}`, params,
  );

  // Only the ids on THIS page are looked up - 20 rows, one HTTP call.
  const lastSeen = await fetchLastSeen(rows.map((r) => r.id));

  res.json({
    page, limit, total: countRows[0].total,
    // Tells the UI whether the telemetry column can be trusted, so it can show
    // "unavailable" rather than rendering every responder as if silent.
    telemetryAvailable: lastSeen.size > 0 || rows.length === 0,
    rows: rows.map((r) => {
      const health = lastSeen.get(r.id) || null;
      return {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        phone: r.phone,
        loraId: r.lora_id,
        city: r.city,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        devices: r.devices ? r.devices.split(',') : [],
        // null when this responder has never sent a heartbeat at all, which is
        // a different thing from "transmitted a long time ago".
        lastSeen: health?.lastSeen ?? null,
        lastSeenMinutes: health?.minutesAgo ?? null,
        isTransmitting: health?.isTransmitting ?? false,
        // Device health, so the administrator can spot equipment needing
        // maintenance without opening a second screen.
        batteryLevel: health?.batteryLevel ?? null,
        lowBattery: health?.lowBattery ?? false,
        isOperational: health?.isOperational ?? null,
      };
    }),
  });
}));

// ---------------------------------------------------------------------------
// PATCH /admin/responders/:id - edit a registration
// ---------------------------------------------------------------------------
router.patch('/responders/:id', asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });

  // Only these columns may ever be written from the panel. A whitelist, not a
  // loop over req.body - otherwise a crafted request could set any column.
  const allowed = {
    firstName: 'first_name',
    lastName: 'last_name',
    phone: 'phone',
    loraId: 'lora_id',
    city: 'city',
    isActive: 'is_active',
  };

  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (!(key in req.body)) continue;
    let value = req.body[key];
    if (key === 'phone') value = normalisePhone(String(value));
    if (key === 'loraId') value = normaliseLoraId(String(value ?? ''));
    if (key === 'isActive') value = value ? 1 : 0;
    sets.push(`${column} = ?`);
    params.push(value === '' ? null : value);
  }

  if (!sets.length) return res.status(400).json({ error: 'לא נשלחו שדות לעדכון' });

  params.push(id);
  const result = await query(`UPDATE responders SET ${sets.join(', ')} WHERE id = ?`, params);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'הרשומה לא נמצאה' });

  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// DELETE /admin/responders/:id
//     The devices rows disappear with it thanks to ON DELETE CASCADE - the
//     database enforces that, not application code that could be forgotten.
// ---------------------------------------------------------------------------
router.delete('/responders/:id', asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const result = await query('DELETE FROM responders WHERE id = ?', [id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'הרשומה לא נמצאה' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// PUT /admin/content/:pageKey/:sectionKey - edit marketing copy (req #12)
//     "INSERT ... ON DUPLICATE KEY UPDATE" = create the block if the admin is
//     editing it for the first time, otherwise update it. One round trip.
// ---------------------------------------------------------------------------
router.put('/content/:pageKey/:sectionKey', asyncHandler(async (req, res) => {
  const { pageKey, sectionKey } = req.params;
  const { title = null, body = null, ctaLabel = null, ctaUrl = null } = req.body;

  await query(`
    INSERT INTO content_blocks (page_key, section_key, title, body, cta_label, cta_url, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      title = VALUES(title), body = VALUES(body),
      cta_label = VALUES(cta_label), cta_url = VALUES(cta_url),
      updated_by = VALUES(updated_by)`,
    [pageKey, sectionKey, title, body, ctaLabel, ctaUrl, req.admin.id],
  );

  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// GET /admin/links?category= - the FULL rows, for the maintenance screen
//
//     Deliberately NOT the public /content/links/:category endpoint. That one
//     filters `is_active = 1` and omits sort_order, which is right for visitors
//     but wrong here: an administrator who deactivates a link would watch it
//     vanish from their own panel with no way to bring it back. The admin needs
//     to see everything it can edit.
// ---------------------------------------------------------------------------
router.get('/links', asyncHandler(async (req, res) => {
  const category = String(req.query.category ?? '').toUpperCase();

  const where = [];
  const params = [];
  if (['BUY_LORA', 'OFFICIAL_MAP', 'LEARN'].includes(category)) {
    where.push('category = ?');
    params.push(category);
  }

  const rows = await query(
    `SELECT id, category, vendor, label, url, frequency_note, description, sort_order, is_active
       FROM external_links
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY sort_order, id`,
    params,
  );

  res.json(rows.map((r) => ({
    id: r.id,
    category: r.category,
    vendor: r.vendor,
    label: r.label,
    url: r.url,
    // Normalised to '' rather than null so a controlled React input never flips
    // between uncontrolled and controlled when the field is empty.
    frequencyNote: r.frequency_note ?? '',
    description: r.description ?? '',
    sortOrder: r.sort_order,
    isActive: Boolean(r.is_active),
  })));
}));

// ---------------------------------------------------------------------------
// External links CRUD - the LoRa shops (#14) and the MDA map link (#13)
// ---------------------------------------------------------------------------
router.post('/links', asyncHandler(async (req, res) => {
  const { category, vendor, label, url, frequencyNote = null, description = null, sortOrder = 0 } = req.body;
  if (!['BUY_LORA', 'OFFICIAL_MAP', 'LEARN'].includes(category)) {
    return res.status(400).json({ error: 'קטגוריה לא חוקית' });
  }
  if (!vendor || !label || !url) return res.status(400).json({ error: 'ספק, תווית וכתובת הם שדות חובה' });

  // Empty optional fields become NULL, matching PATCH and the seed script, so
  // "no value" has exactly one representation in the table.
  const blankToNull = (v) => String(v ?? '').trim() || null;

  const result = await query(
    `INSERT INTO external_links (category, vendor, label, url, frequency_note, description, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [category, String(vendor).trim(), String(label).trim(), String(url).trim(),
      blankToNull(frequencyNote), blankToNull(description), Number(sortOrder) || 0],
  );
  res.status(201).json({ id: result.insertId });
}));

router.patch('/links/:id', asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });

  const allowed = {
    vendor: 'vendor', label: 'label', url: 'url',
    frequencyNote: 'frequency_note', description: 'description',
    sortOrder: 'sort_order', isActive: 'is_active',
  };

  // vendor, label and url are NOT NULL in the schema and carry the link's
  // meaning. Blanking one leaves a row that renders as an empty card, so an
  // empty value is rejected rather than written - the same rule POST enforces.
  const required = ['vendor', 'label', 'url'];

  const sets = [];
  const params = [];
  const errors = {};

  for (const [key, column] of Object.entries(allowed)) {
    if (!(key in req.body)) continue;      // absent = "leave this column alone"

    let value = req.body[key];

    if (required.includes(key)) {
      value = String(value ?? '').trim();
      if (!value) {
        errors[key] = 'שדה חובה';
        continue;
      }
    } else if (key === 'isActive') {
      value = value ? 1 : 0;
    } else if (key === 'sortOrder') {
      value = Number.parseInt(value, 10) || 0;
    } else {
      // frequency_note and description are optional. Store NULL rather than an
      // empty string so "no value" has ONE representation in the database -
      // mixing '' and NULL is what made an empty description hard to spot.
      value = String(value ?? '').trim() || null;
    }

    sets.push(`${column} = ?`);
    params.push(value);
  }

  if (Object.keys(errors).length) {
    return res.status(422).json({ error: 'קיימות שגיאות בטופס', fields: errors });
  }
  if (!sets.length) return res.status(400).json({ error: 'לא נשלחו שדות לעדכון' });

  params.push(id);
  const result = await query(`UPDATE external_links SET ${sets.join(', ')} WHERE id = ?`, params);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'הקישור לא נמצא' });

  res.json({ ok: true });
}));

router.delete('/links/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM external_links WHERE id = ?', [Number.parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

export default router;
