// ============================================================================
//  /content - PUBLIC read access to the admin-editable marketing copy
//             and to the external links.   (Requirements #12, #13, #14)
// ============================================================================
//  Reading is public (the landing page needs it), writing lives in
//  admin.routes.js behind the JWT guard. Same tables, two different doors.
// ============================================================================
import express from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../middleware/common.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /content/:pageKey - every editable block of one page, keyed by section
// ---------------------------------------------------------------------------
router.get('/:pageKey', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT section_key, title, body, cta_label, cta_url, updated_at
       FROM content_blocks WHERE page_key = ?`,
    [req.params.pageKey],
  );

  // Returned as an object keyed by section so the React page can write
  //   content.hero.title
  // instead of searching an array on every render.
  const blocks = {};
  for (const r of rows) {
    blocks[r.section_key] = {
      title: r.title, body: r.body,
      ctaLabel: r.cta_label, ctaUrl: r.cta_url,
      updatedAt: r.updated_at,
    };
  }
  res.json({ pageKey: req.params.pageKey, blocks });
}));

// ---------------------------------------------------------------------------
// GET /content/links/:category  - BUY_LORA | OFFICIAL_MAP | LEARN
// ---------------------------------------------------------------------------
router.get('/links/:category', asyncHandler(async (req, res) => {
  const category = req.params.category.toUpperCase();
  if (!['BUY_LORA', 'OFFICIAL_MAP', 'LEARN'].includes(category)) {
    return res.status(400).json({ error: 'קטגוריה לא חוקית' });
  }

  const rows = await query(
    `SELECT id, vendor, label, url, frequency_note, description
       FROM external_links
      WHERE category = ? AND is_active = 1
      ORDER BY sort_order, id`,
    [category],
  );

  res.json(rows.map((r) => ({
    id: r.id, vendor: r.vendor, label: r.label, url: r.url,
    frequencyNote: r.frequency_note, description: r.description,
  })));
}));

export default router;
