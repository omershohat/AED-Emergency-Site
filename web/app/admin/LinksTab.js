'use client';
// ============================================================================
//  Managing the external links (Requirements #13, #14)
// ============================================================================
//  The MDA map link and the LoRa vendors live in one table with a category, so
//  one screen maintains both.
//
//  Rows are edited IN PLACE. The earlier version only offered add and delete,
//  which meant changing a URL required deleting the row and retyping it - and
//  every field you did not retype came back empty. That is exactly how the MDA
//  link lost its description. Editing in place makes a one-field change a
//  one-field change.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

const CATEGORIES = [
  { key: 'BUY_LORA', label: 'ספקי ציוד LoRa' },
  { key: 'OFFICIAL_MAP', label: 'מפות רשמיות (מד״א)' },
  { key: 'LEARN', label: 'קישורי לימוד' },
];

const EMPTY = { vendor: '', label: '', url: '', frequencyNote: '', description: '', sortOrder: 0 };

export default function LinksTab() {
  const [category, setCategory] = useState('BUY_LORA');
  const [links, setLinks] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Which row is open for editing, and the working copy of its values. Keeping
  // the edits in a SEPARATE object means cancelling costs nothing - we simply
  // throw the copy away and the row still holds what the server sent.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The ADMIN listing: includes deactivated links, which the public
      // endpoint filters out. Without this an admin could hide a link and
      // then never find it again.
      setLinks(await api.adminLinks(category));
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  // Leaving the category cancels any half-finished edit, so a save can never
  // land on a row the user is no longer looking at.
  useEffect(() => { setEditingId(null); setFieldErrors({}); }, [category]);

  function startEdit(link) {
    setEditingId(link.id);
    setFieldErrors({});
    setStatus(null);
    setEditForm({
      vendor: link.vendor ?? '',
      label: link.label ?? '',
      url: link.url ?? '',
      frequencyNote: link.frequencyNote ?? '',
      description: link.description ?? '',
      sortOrder: link.sortOrder ?? 0,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setFieldErrors({});
  }

  async function saveEdit(id) {
    setSaving(true);
    setStatus(null);
    setFieldErrors({});
    try {
      await api.updateLink(id, editForm);
      setEditingId(null);
      setStatus({ ok: true, message: 'הקישור עודכן' });
      load();
    } catch (err) {
      // The server returns per-field messages for empty required fields; show
      // them on the inputs rather than as one anonymous banner.
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      else setStatus({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(link) {
    setStatus(null);
    try {
      await api.updateLink(link.id, { isActive: !link.isActive });
      load();
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    }
  }

  async function add() {
    setStatus(null);
    if (!draft.vendor || !draft.label || !draft.url) {
      setStatus({ ok: false, message: 'ספק, תווית וכתובת הם שדות חובה' });
      return;
    }
    try {
      await api.createLink({ ...draft, category });
      setDraft(EMPTY);
      setShowAdd(false);
      setStatus({ ok: true, message: 'הקישור נוסף' });
      load();
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    }
  }

  async function remove(id) {
    if (!window.confirm('למחוק את הקישור? אם המטרה היא רק להסתיר אותו מהאתר, עדיף להשהות.')) return;
    await api.deleteLink(id);
    load();
  }

  const draftField = (field) => (e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }));
  const editField = (field) => (e) => setEditForm((prev) => ({ ...prev, [field]: e.target.value }));

  const activeCount = links.filter((l) => l.isActive).length;

  return (
    <div>
      <label className="block max-w-xs">
        <span className="label">קטגוריה</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>

      {category === 'BUY_LORA' && (
        <p className="mt-3 rounded-xl bg-lora-light px-4 py-3 text-sm text-slate-700">
          דרישת הפרויקט: לפחות שלושה ספקים פעילים, עם הדגשה ברורה של תדר{' '}
          <span className="ltr-num font-semibold">433MHz</span>. כרגע פעילים{' '}
          <span className="ltr-num font-semibold">{activeCount}</span>.
          {activeCount < 3 && (
            <strong className="block text-emergency">שימו לב: פחות משלושה ספקים פעילים.</strong>
          )}
        </p>
      )}

      {status && (
        <p className={`mt-4 rounded-xl px-4 py-3 text-sm ${
          status.ok ? 'bg-green-100 text-green-800' : 'bg-emergency-light text-emergency'
        }`}
        >
          {status.message}
        </p>
      )}

      {/* ---------------- existing links ---------------- */}
      <div className="mt-6 space-y-3">
        {loading && <p className="text-slate-500">טוען...</p>}

        {!loading && links.length === 0 && (
          <p className="text-slate-500">אין קישורים בקטגוריה הזו.</p>
        )}

        {!loading && links.map((link) => (
          <div
            key={link.id}
            className={`card ${link.isActive ? '' : 'border-dashed bg-slate-50 opacity-70'}`}
          >
            {editingId === link.id ? (
              /* ---------- edit mode ---------- */
              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EditInput
                    label="ספק / גוף" value={editForm.vendor} onChange={editField('vendor')}
                    error={fieldErrors.vendor} required
                  />
                  <EditInput
                    label="תווית להצגה" value={editForm.label} onChange={editField('label')}
                    error={fieldErrors.label} required
                  />
                  <div className="sm:col-span-2">
                    <EditInput
                      label="כתובת (URL)" value={editForm.url} onChange={editField('url')}
                      error={fieldErrors.url} required ltr
                    />
                  </div>
                  <EditInput
                    label="הערת תדר" value={editForm.frequencyNote} onChange={editField('frequencyNote')}
                    hint="מוצג כתגית. השאירו ריק כשלא רלוונטי (למשל קישור למפה)."
                  />
                  <EditInput
                    label="סדר הצגה" value={editForm.sortOrder} onChange={editField('sortOrder')}
                    type="number" ltr
                  />
                  <label className="block sm:col-span-2">
                    <span className="label">תיאור</span>
                    <textarea
                      value={editForm.description} onChange={editField('description')}
                      rows={2} className="input"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => saveEdit(link.id)} disabled={saving} className="btn-primary">
                    {saving ? 'שומר...' : 'שמירה'}
                  </button>
                  <button type="button" onClick={cancelEdit} className="btn-secondary">ביטול</button>
                </div>
              </div>
            ) : (
              /* ---------- read mode ---------- */
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">{link.vendor}</span>
                    {!link.isActive && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        מושהה — לא מוצג באתר
                      </span>
                    )}
                    <span className="ltr-num text-xs text-slate-400">#{link.sortOrder}</span>
                  </div>
                  <div className="font-bold text-slate-900">{link.label}</div>
                  <a
                    href={link.url} target="_blank" rel="noopener noreferrer"
                    className="block truncate text-xs text-slate-500 hover:text-slate-800"
                  >
                    <span className="ltr-num">{link.url}</span>
                  </a>
                  {link.frequencyNote ? (
                    <span className="mt-2 inline-block rounded-full bg-lora-light px-2 py-0.5 text-xs font-semibold text-lora">
                      {link.frequencyNote}
                    </span>
                  ) : null}
                  {link.description ? (
                    <p className="mt-2 text-sm text-slate-600">{link.description}</p>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-400">אין תיאור</p>
                  )}
                </div>

                <div className="flex shrink-0 gap-3 text-sm">
                  <button type="button" onClick={() => startEdit(link)} className="text-slate-600 hover:text-slate-900">
                    עריכה
                  </button>
                  <button type="button" onClick={() => toggleActive(link)} className="text-slate-600 hover:text-slate-900">
                    {link.isActive ? 'השהיה' : 'הפעלה'}
                  </button>
                  <button type="button" onClick={() => remove(link.id)} className="text-emergency hover:underline">
                    מחיקה
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---------------- add a new one ---------------- */}
      {!showAdd ? (
        <button type="button" onClick={() => setShowAdd(true)} className="btn-secondary mt-6">
          + הוספת קישור
        </button>
      ) : (
        <div className="card mt-8">
          <h3 className="text-lg font-bold text-slate-900">הוספת קישור</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <EditInput label="ספק / גוף" value={draft.vendor} onChange={draftField('vendor')} required placeholder="Heltec" />
            <EditInput label="תווית להצגה" value={draft.label} onChange={draftField('label')} required placeholder="Heltec V3 - 433MHz" />
            <div className="sm:col-span-2">
              <EditInput label="כתובת (URL)" value={draft.url} onChange={draftField('url')} required ltr placeholder="https://..." />
            </div>
            <EditInput label="הערת תדר" value={draft.frequencyNote} onChange={draftField('frequencyNote')} placeholder="433MHz - התדר לשימוש בישראל" />
            <EditInput label="סדר הצגה" value={draft.sortOrder} onChange={draftField('sortOrder')} type="number" ltr />
            <label className="block sm:col-span-2">
              <span className="label">תיאור</span>
              <textarea value={draft.description} onChange={draftField('description')} rows={2} className="input" />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={add} className="btn-primary">הוספה</button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setDraft(EMPTY); }}
              className="btn-secondary"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EditInput({ label, value, onChange, error, hint, required, ltr, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ms-1 text-emergency">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`input ${ltr ? 'ltr-num' : ''} ${error ? 'input-error' : ''}`}
      />
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="field-error block">{error}</span>}
    </label>
  );
}
