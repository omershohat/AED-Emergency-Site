'use client';
// ============================================================================
//  Editing the marketing copy (Requirement #12, first half)
// ============================================================================
//  Whatever the admin saves here lands in the content_blocks table, and the
//  public pages read it on their next server render. No redeploy, no developer.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

// The blocks the site actually renders. Listing them here means the admin sees
// an empty editable box for a block nobody has written yet, instead of having
// to guess the key names.
const PAGES = [
  {
    key: 'home',
    label: 'דף הבית',
    sections: [
      { key: 'hero', label: 'כותרת ראשית + קריאה לפעולה' },
      { key: 'lora_explainer', label: 'הסבר LoRa (שורה לכל שורת הסבר)' },
      { key: 'how_it_works', label: 'איך זה עובד' },
    ],
  },
  {
    key: 'buy',
    label: 'עמוד רכישה',
    sections: [{ key: 'intro', label: 'פתיח עמוד הרכישה' }],
  },
  {
    key: 'about',
    label: 'תחזוקה והסברים',
    sections: [{ key: 'maintenance', label: 'תחזוקה ובדיקות' }],
  },
];

export default function ContentTab() {
  const [pageKey, setPageKey] = useState('home');
  const [blocks, setBlocks] = useState({});
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.content(pageKey);
      setBlocks(data.blocks || {});
    } catch {
      setBlocks({});
    } finally {
      setLoading(false);
    }
  }, [pageKey]);

  useEffect(() => { load(); }, [load]);

  const page = PAGES.find((p) => p.key === pageKey);

  function updateBlock(sectionKey, field, value) {
    setBlocks((prev) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], [field]: value },
    }));
  }

  async function save(sectionKey) {
    setStatus(null);
    try {
      const b = blocks[sectionKey] || {};
      await api.saveContent(pageKey, sectionKey, {
        title: b.title || null,
        body: b.body || null,
        ctaLabel: b.ctaLabel || null,
        ctaUrl: b.ctaUrl || null,
      });
      setStatus({ ok: true, message: 'נשמר. רעננו את הדף הציבורי כדי לראות את השינוי.' });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">עמוד</span>
          <select value={pageKey} onChange={(e) => setPageKey(e.target.value)} className="input">
            {PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {status && (
        <p className={`mt-4 rounded-xl px-4 py-3 text-sm ${
          status.ok ? 'bg-green-100 text-green-800' : 'bg-emergency-light text-emergency'
        }`}
        >
          {status.message}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-slate-500">טוען...</p>
      ) : (
        <div className="mt-6 space-y-6">
          {page.sections.map((section) => {
            const block = blocks[section.key] || {};
            return (
              <div key={section.key} className="card">
                <h3 className="text-lg font-bold text-slate-900">{section.label}</h3>
                <p className="ltr-num mt-0.5 font-mono text-xs text-slate-400">
                  {pageKey}.{section.key}
                </p>

                <label className="mt-4 block">
                  <span className="label">כותרת</span>
                  <input
                    value={block.title || ''}
                    onChange={(e) => updateBlock(section.key, 'title', e.target.value)}
                    className="input"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="label">תוכן</span>
                  <textarea
                    value={block.body || ''}
                    onChange={(e) => updateBlock(section.key, 'body', e.target.value)}
                    rows={section.key === 'lora_explainer' ? 4 : 3}
                    className="input"
                  />
                  {section.key === 'lora_explainer' && (
                    <span className="mt-1 block text-xs text-slate-500">
                      כל שורה כאן מוצגת כשלב ממוספר בדף הבית. שלוש שורות = שלושה שלבים.
                    </span>
                  )}
                </label>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">טקסט כפתור</span>
                    <input
                      value={block.ctaLabel || ''}
                      onChange={(e) => updateBlock(section.key, 'ctaLabel', e.target.value)}
                      className="input"
                    />
                  </label>
                  <label className="block">
                    <span className="label">קישור הכפתור</span>
                    <input
                      value={block.ctaUrl || ''}
                      onChange={(e) => updateBlock(section.key, 'ctaUrl', e.target.value)}
                      className="input ltr-num"
                      placeholder="/register"
                    />
                  </label>
                </div>

                <button type="button" onClick={() => save(section.key)} className="btn-primary mt-4">
                  שמירת הבלוק
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
