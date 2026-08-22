'use client';
// ============================================================================
//  Managing the registration database (Requirement #12, second half)
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { api, mesh } from '@/lib/api';
import { formatLastSeen, batteryIcon, batteryLabel, batteryClass } from '@/lib/deviceHealth';

export default function RespondersTab() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // the row currently open for edit
  const [maintenance, setMaintenance] = useState(null);   // open low-battery alerts
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [telemetryHealth, setTelemetryHealth] = useState(null);  // null = not checked yet
  const [refreshing, setRefreshing] = useState(false);

  // The maintenance queue comes straight from the mesh service - it is device
  // health, not registration data, so it does not belong in the MySQL query.
  // Failure is silent on purpose: a missing banner must not break the panel.
  const loadMaintenance = useCallback(async () => {
    try {
      setMaintenance(await mesh.maintenanceAlerts());
    } catch {
      setMaintenance(null);
    }
  }, []);

  // Check whether seed telemetry is still within the freshness window.
  // When it is not, dispatch finds zero candidates - this banner surfaces that.
  const checkTelemetryHealth = useCallback(async () => {
    try {
      setTelemetryHealth(await mesh.telemetryHealth());
    } catch {
      setTelemetryHealth(null);
    }
  }, []);

  useEffect(() => { loadMaintenance(); checkTelemetryHealth(); }, [loadMaintenance, checkTelemetryHealth]);

  async function handleRefreshTelemetry() {
    setRefreshing(true);
    try {
      await mesh.refreshTelemetry();
      await checkTelemetryHealth();
    } catch (err) {
      alert(`שגיאה בריענון הטלמטריה: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  // useCallback so the effect below can depend on this function without
  // rebuilding it on every render.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.adminResponders({ search, type, page, limit: 20 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, type, page]);

  // Debounce: without the 350ms delay every keystroke would fire a query.
  // The cleanup cancels the pending timer, so only the last one survives.
  useEffect(() => {
    const timer = setTimeout(load, 350);
    return () => clearTimeout(timer);
  }, [load]);

  async function toggleActive(row) {
    await api.updateResponder(row.id, { isActive: !row.isActive });
    load();
  }

  async function remove(row) {
    // A native confirm is enough here and has no dependency. Deleting a
    // responder also deletes their devices, through the FK cascade.
    if (!window.confirm(`למחוק את ${row.firstName} ${row.lastName || ''}? הפעולה בלתי הפיכה.`)) return;
    await api.deleteResponder(row.id);
    load();
  }

  const pages = Math.max(1, Math.ceil(data.total / (data.limit || 20)));

  return (
    <div>
      {/* -------- stale telemetry warning: dispatch will find nobody -------- */}
      {telemetryHealth && !telemetryHealth.ok && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-red-900">
                ⚠️ נתוני הטלמטריה ישנים — קריאות מצוקה לא ימצאו מתנדבים
              </p>
              <p className="mt-1 text-sm text-red-700">
                הפעימות האחרונות נרשמו לפני{' '}
                <span className="ltr-num font-mono font-semibold">{telemetryHealth.newestAgeMinutes}</span>{' '}
                דקות. חלון הרענון הוא{' '}
                <span className="ltr-num font-mono font-semibold">{telemetryHealth.freshnessWindowMin}</span>{' '}
                דקות.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefreshTelemetry}
              disabled={refreshing}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {refreshing ? 'מרענן...' : '🔄 ריענון חותמות הזמן'}
            </button>
          </div>
        </div>
      )}

      {/* -------- maintenance queue: devices needing a charge -------- */}
      {maintenance && maintenance.openCount > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-amber-900">
              🪫 <span className="ltr-num">{maintenance.openCount}</span> מכשירים דורשים טיפול —
              סוללה מתחת ל-<span className="ltr-num">{maintenance.threshold}%</span>
            </p>
            <button
              type="button"
              onClick={() => setShowMaintenance((v) => !v)}
              className="text-sm font-semibold text-amber-900 underline"
            >
              {showMaintenance ? 'הסתרה' : 'הצגת הרשימה'}
            </button>
          </div>

          {showMaintenance && (
            <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-sm text-amber-900">
              {maintenance.alerts.map((a) => (
                <li key={`${a.responderId}-${a.createdAt}`} className="flex flex-wrap gap-x-3">
                  <span className="font-medium">{a.owner?.name || `מתנדב #${a.responderId}`}</span>
                  <span className="ltr-num">{a.owner?.phone || '—'}</span>
                  <span className="ltr-num">סוללה {a.lastBatteryLevel ?? a.batteryLevel}%</span>
                  <span className="text-amber-700">
                    {a.notification?.channel === 'SMS' ? '✓ נשלחה התראת תחזוקה' : 'לא נשלחה התראה'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- filters ---------------- */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[220px]">
          <span className="label">חיפוש</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input"
            placeholder="שם, טלפון או מזהה LoRa"
          />
        </label>

        <label className="block">
          <span className="label">סוג ציוד</span>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="input"
          >
            <option value="">הכול</option>
            <option value="AED">בעלי דפיברילטור</option>
            <option value="LORA_NODE">בעלי מכשיר LoRa</option>
          </select>
        </label>

        <div className="pb-1 text-sm text-slate-500">
          סה״כ <span className="ltr-num font-semibold text-slate-900">{data.total}</span> רשומות
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-emergency-light px-4 py-3 text-emergency">{error}</p>}

      {/* ---------------- table ---------------- */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="p-3 text-start font-medium">שם</th>
              <th className="p-3 text-start font-medium">נייד</th>
              <th className="p-3 text-start font-medium">מזהה LoRa</th>
              <th className="p-3 text-start font-medium">ציוד</th>
              <th className="p-3 text-start font-medium">שידור אחרון</th>
              <th className="p-3 text-start font-medium">סוללה</th>
              <th className="p-3 text-start font-medium">סטטוס</th>
              <th className="p-3 text-start font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-500">טוען...</td></tr>
            )}

            {!loading && data.rows.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-500">לא נמצאו רשומות</td></tr>
            )}

            {!loading && data.rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 font-medium text-slate-900">
                  {row.firstName} {row.lastName || ''}
                  {row.city && <span className="block text-xs text-slate-500">{row.city}</span>}
                </td>
                {/* The LTR isolation goes on a span INSIDE the cell, never on
                    the <td>. See the note on .ltr-num in globals.css. */}
                <td className="p-3"><span className="ltr-num">{row.phone}</span></td>
                <td className="p-3 font-mono text-xs">
                  <span className="ltr-num">{row.loraId || '—'}</span>
                </td>
                <td className="p-3">
                  {row.devices.includes('AED') && <span title="דפיברילטור">🫀</span>}
                  {row.devices.includes('LORA_NODE') && <span title="מכשיר LoRa" className="ms-1">📡</span>}
                </td>
                {/* Last transmission - the one column sourced from MongoDB rather
                    than MySQL. `telemetryAvailable` is false when the mesh service
                    could not be reached, and we say so instead of drawing every
                    responder as though they had gone silent. */}
                <td className="p-3">
                  {!data.telemetryAvailable ? (
                    <span className="text-xs text-slate-400" title="שירות הטלמטריה אינו זמין">
                      לא זמין
                    </span>
                  ) : (
                    <>
                      <span className={row.isTransmitting ? 'text-slate-700' : 'text-slate-400'}>
                        {formatLastSeen(row.lastSeenMinutes)}
                      </span>
                      {row.lastSeenMinutes !== null && !row.isTransmitting && (
                        <span
                          className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title="לא שידר בתוך חלון הזמן - לא ישוגר אליו/ה מסר"
                        >
                          שקט
                        </span>
                      )}
                    </>
                  )}
                </td>
                {/* Battery - red below the maintenance threshold, so equipment
                    needing a charge is visible at a glance. `lowBattery` comes
                    from the server rather than being recomputed here, so the
                    panel and the alert queue always agree. */}
                <td className="p-3">
                  {row.batteryLevel == null ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    <span className={`ltr-num text-sm ${batteryClass(row.batteryLevel)}`}>
                      {batteryIcon(row.batteryLevel)} {batteryLabel(row.batteryLevel)}
                    </span>
                  )}
                  {row.lowBattery && (
                    <span className="ms-2 rounded-full bg-emergency-light px-2 py-0.5 text-xs font-semibold text-emergency">
                      טעינה נדרשת
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => toggleActive(row)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      row.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {row.isActive ? 'פעיל' : 'מושהה'}
                  </button>
                </td>
                <td className="p-3">
                  <button type="button" onClick={() => setEditing(row)} className="text-slate-600 hover:text-slate-900">
                    עריכה
                  </button>
                  <button type="button" onClick={() => remove(row)} className="ms-3 text-emergency hover:underline">
                    מחיקה
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- paging ---------------- */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button" className="btn-secondary px-3 py-2 text-sm"
            disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
          >
            הקודם
          </button>
          <span className="ltr-num text-sm text-slate-600">{page} / {pages}</span>
          <button
            type="button" className="btn-secondary px-3 py-2 text-sm"
            disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
          >
            הבא
          </button>
        </div>
      )}

      {editing && (
        <EditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EditDialog({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: row.firstName,
    lastName: row.lastName || '',
    phone: row.phone,
    loraId: row.loraId || '',
    city: row.city || '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateResponder(row.id, form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    // A simple overlay. role="dialog" + aria-modal tell assistive technology
    // that the content behind it is inert.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold text-slate-900">עריכת רשומה</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">שם פרטי</span>
            <input value={form.firstName} onChange={update('firstName')} className="input" />
          </label>
          <label className="block">
            <span className="label">שם משפחה</span>
            <input value={form.lastName} onChange={update('lastName')} className="input" />
          </label>
          <label className="block">
            <span className="label">נייד</span>
            <input value={form.phone} onChange={update('phone')} className="input ltr-num" />
          </label>
          <label className="block">
            <span className="label">מזהה LoRa</span>
            <input value={form.loraId} onChange={update('loraId')} className="input ltr-num font-mono" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">יישוב</span>
            <input value={form.city} onChange={update('city')} className="input" />
          </label>
        </div>

        {error && <p className="field-error mt-3">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">ביטול</button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary">
            {busy ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}
