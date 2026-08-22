'use client';
// ============================================================================
//  The emergency page (Requirement #5)
// ============================================================================
//  "A dedicated, highly visible page displaying an active distress call,
//   mapping the emergency surroundings, and pinpointing the distress source."
//
//  Three live pieces on one screen:
//    * the map      - source of the call, everyone sampled around it, and the
//                     bicycle route of the responder actually on the way,
//    * the roster   - who was reached, through which channel, how far away and
//                     when they last broadcast (requirement #9),
//    * the timeline - streamed over the WebSocket as the mesh propagates.
// ============================================================================
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { mesh } from '@/lib/api';
import { useAlertSocket } from '@/lib/useAlertSocket';
import { CHANNELS, DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/config';
import { batteryIcon, batteryLabel, operationalStatus, batteryClass } from '@/lib/deviceHealth';

const MapCanvas = dynamic(() => import('@/components/MapCanvas'), {
  ssr: false,
  loading: () => <div className="h-[480px] w-full animate-pulse rounded-2xl bg-slate-200" />,
});

// useSearchParams() reads the URL on the client, so Next requires the component
// using it to sit inside a Suspense boundary - otherwise the whole route would
// be forced out of static rendering.
export default function EmergencyPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-slate-500">טוען...</div>}>
      <EmergencyView />
    </Suspense>
  );
}

function EmergencyView() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get('alert');

  const [alert, setAlert] = useState(null);
  const [alertId, setAlertId] = useState(requestedId);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The socket hands us the route the moment the server picks a responder.
  // useCallback keeps the identity stable so the hook does not resubscribe.
  const handleRoute = useCallback((incoming) => setRoute(incoming), []);
  const { connected, timeline, finished } = useAlertSocket(alertId, { onRoute: handleRoute });

  // Load the requested alert, or fall back to the most recent one.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let id = requestedId;
        if (!id) {
          const recent = await mesh.listAlerts(1);
          id = recent[0]?.alertId ?? null;
        }
        if (!id) {
          if (!cancelled) { setAlert(null); setLoading(false); }
          return;
        }
        const data = await mesh.getAlert(id);
        if (!cancelled) {
          setAlert(data);
          setAlertId(id);
          setRoute(data.route || null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [requestedId]);

  const origin = alert
    ? { lat: alert.origin.coordinates[1], lng: alert.origin.coordinates[0] }
    : DEFAULT_CENTER;

  // Statuses arrive over the socket; merge them onto the candidates we loaded
  // so a marker turns green the moment its responder acknowledges.
  const notifiedIds = useMemo(() => {
    const ids = new Set();
    for (const entry of timeline) {
      if (entry.responderId && (entry.event === 'NOTIFIED' || entry.event === 'ACK')) {
        ids.add(entry.responderId);
      }
    }
    return ids;
  }, [timeline]);

  const markers = useMemo(() => {
    if (!alert) return [];
    const list = alert.candidates.map((c) => ({
      id: c.responderId,
      lat: c.position.lat,
      lng: c.position.lng,
      kind: c.responderId === alert.primaryResponderId ? 'selected' : c.channel,
      label: c.name,
      popup: `<strong>${c.name}</strong><br/>`
        + `${CHANNELS[c.channel]?.label ?? c.channel}<br/>`
        + `מרחק אווירי: ${c.distanceM} מ׳<br/>`
        + `${c.hasAed ? `🫀 נושא/ת דפיברילטור${operationalStatus(c.isOperational) ? ` (${operationalStatus(c.isOperational).text})` : ''}<br/>` : ''}`
        + `${batteryIcon(c.batteryLevel)} סוללה: ${batteryLabel(c.batteryLevel)}<br/>`
        + `שידור אחרון: לפני ${c.lastSeenMinutes} דק׳`,
    }));
    list.push({ id: 'victim', lat: origin.lat, lng: origin.lng, kind: 'victim', label: 'מקור הקריאה' });
    return list;
  }, [alert, origin.lat, origin.lng]);

  // ---- empty / error states ------------------------------------------------
  if (loading) {
    return <div className="p-16 text-center text-slate-500">טוען קריאת מצוקה...</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-900">לא ניתן לטעון את קריאת המצוקה</h1>
        <p className="mt-3 text-slate-600">{error}</p>
        <p className="mt-1 text-sm text-slate-500">ודאו ששרת ה-mesh ומסד MongoDB פועלים.</p>
        <Link href="/simulator" className="btn-primary mt-6">לסימולטור</Link>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-5xl">🟢</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">אין כרגע קריאת מצוקה פעילה</h1>
        <p className="mt-3 leading-relaxed text-slate-600">
          כשתיפתח קריאה, המסך הזה יציג אותה בזמן אמת: מקור הקריאה, המתנדבים שנדגמו
          סביבו, וההתקדמות של מי שיצא לדרך.
        </p>
        <Link href="/simulator" className="btn-primary mt-6">להרצת סימולציה</Link>
      </div>
    );
  }

  const primary = alert.candidates.find((c) => c.responderId === alert.primaryResponderId);

  return (
    <div>
      {/* ================= the loud banner ================= */}
      <div className="bg-emergency text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-white" />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold sm:text-3xl">קריאת מצוקה פעילה</h1>
              <p className="text-sm text-red-100">
                מזהה <span className="ltr-num font-mono">{alert.alertId}</span> ·{' '}
                {alert.victim?.name}
                {alert.victim?.phone && (
                  <> · <a href={`tel:${alert.victim.phone}`} className="ltr-num underline">{alert.victim.phone}</a></>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-300' : 'bg-red-200'}`} />
            {connected ? 'מחובר לשידור חי' : finished ? 'השידור הסתיים' : 'מנותק'}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* ================= summary tiles ================= */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile value={alert.stats.found} label="נדגמו ברדיוס" />
          <Tile value={alert.stats.viaLora} label="דרך רשת LoRa" tone="text-lora" />
          <Tile value={alert.stats.viaSms} label="דרך SMS" tone="text-cell" />
          <Tile value={alert.stats.unreachable} label="ללא אפשרות קשר" tone="text-offline" />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* ================= map ================= */}
          <div>
            <MapCanvas
              center={origin}
              zoom={DEFAULT_ZOOM}
              markers={markers}
              circle={{ lat: origin.lat, lng: origin.lng, radiusM: alert.config.radiusM }}
              route={route}
              className="h-[480px] w-full overflow-hidden rounded-2xl border border-slate-200"
            />

            {route && (
              <p className="mt-2 text-sm text-slate-600">
                {route.fallback ? (
                  <span className="text-amber-700">
                    ⚠ שירות הניווט לא היה זמין - המסלול המוצג הוא קו אווירי ולא מסלול אופניים.
                  </span>
                ) : (
                  <>
                    מסלול אופניים מחושב ({route.engine}):{' '}
                    <span className="ltr-num font-semibold">{route.distanceM.toLocaleString('he-IL')} מ׳</span>
                    {' · '}
                    <span className="font-semibold">{formatEta(route.durationSec)}</span>
                  </>
                )}
              </p>
            )}

            {/* ---------- the roster (requirement #9) ---------- */}
            <h2 className="mt-8 text-xl font-bold text-slate-900">המתנדבים שנדגמו</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-start text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-2 text-start font-medium">מתנדב/ת</th>
                    <th className="p-2 text-start font-medium">ערוץ</th>
                    <th className="p-2 text-start font-medium">מרחק</th>
                    <th className="p-2 text-start font-medium">שידור אחרון</th>
                    <th className="p-2 text-start font-medium">ציוד</th>
                    <th className="p-2 text-start font-medium">מצב מכשיר</th>
                  </tr>
                </thead>
                <tbody>
                  {alert.candidates.map((c) => {
                    const op = operationalStatus(c.isOperational);
                    return (
                      <tr
                        key={c.responderId}
                        className={`border-b border-slate-100 ${
                          c.responderId === alert.primaryResponderId ? 'bg-green-50' : ''
                        }`}
                      >
                        <td className="p-2">
                          <span className="font-medium text-slate-900">{c.name}</span>
                          {c.responderId === alert.primaryResponderId && (
                            <span className="ms-2 rounded-full bg-green-600 px-2 py-0.5 text-xs text-white">בדרך</span>
                          )}
                          {notifiedIds.has(c.responderId) && c.responderId !== alert.primaryResponderId && (
                            <span className="ms-2 text-xs text-slate-500">✓ עודכן</span>
                          )}
                          <span className="ltr-num block text-xs text-slate-500">{c.phone}</span>
                        </td>
                        <td className="p-2">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${CHANNELS[c.channel]?.badge}`}>
                            {CHANNELS[c.channel]?.label ?? c.channel}
                          </span>
                        </td>
                        {/* Only the number is an LTR island - "מ׳" is Hebrew and
                            belongs outside it, and the class must not sit on the
                            <td> itself. See the note on .ltr-num in globals.css. */}
                        <td className="p-2"><span className="ltr-num">{c.distanceM}</span> מ׳</td>
                        <td className="p-2 text-slate-600">לפני {c.lastSeenMinutes} דק׳</td>
                        <td className="p-2">
                          {c.hasAed && <span title="דפיברילטור">🫀</span>}
                          {c.hasLora && <span title="מכשיר LoRa" className="ms-1">📡</span>}
                        </td>
                        <td className="p-2">
                          {/* Red below the maintenance threshold: the operator
                              needs to know a responder's radio may die mid-rescue. */}
                          <span className={`ltr-num text-xs ${batteryClass(c.batteryLevel)}`}>
                            {batteryIcon(c.batteryLevel)} {batteryLabel(c.batteryLevel)}
                          </span>
                          {/* Requirement #1: is_operational, shown only when the responder
                              actually carries an AED - null for everyone else, on purpose,
                              so "no defibrillator" is never drawn as "broken defibrillator". */}
                          {op && (
                            <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-semibold ${op.className}`}>
                              {op.text}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ================= live timeline ================= */}
          <aside className="space-y-4">
            {primary && (
              <div className={`card border-r-4 ${primary.operationalConcern ? 'border-r-amber-500' : 'border-r-green-600'}`}>
                <h2 className="text-lg font-bold text-slate-900">המתנדב שבדרך</h2>
                <p className="mt-1 text-slate-900">{primary.name}</p>
                <a href={`tel:${primary.phone}`} className="ltr-num text-emergency underline">{primary.phone}</a>
                <dl className="mt-3 space-y-1 text-sm text-slate-600">
                  <Row term="ערוץ" value={CHANNELS[primary.channel]?.label} />
                  <Row term="מרחק אווירי" value={`${primary.distanceM} מ׳`} />
                  {primary.routeDistanceM != null && (
                    <Row term="מסלול רכיבה" value={`${primary.routeDistanceM.toLocaleString('he-IL')} מ׳`} />
                  )}
                  {primary.etaSec != null && (
                    <Row term="זמן הגעה משוער" value={formatEta(primary.etaSec)} />
                  )}
                  <Row term="דפיברילטור" value={primary.hasAed ? 'כן' : 'לא'} />
                  <Row term="סוללת המכשיר" value={`${batteryIcon(primary.batteryLevel)} ${batteryLabel(primary.batteryLevel)}`} />
                </dl>

                {/* Requirement #1 driving an actual decision, not just a display:
                    dispatch.js already prefers an operational AED when one exists
                    within reach - this banner only fires when NONE did, and the
                    algorithm had to fall back to a responder whose AED reported
                    failed. The team on the ground needs to know before they arrive. */}
                {primary.operationalConcern && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    ⚠ הדפיברילטור של המתנדב/ת דיווח כלא תקין. זהו המתנדב הזמין הקרוב ביותר -
                    שקלו לשלוח גיבוי או להיערך להחייאה ללא שוק חשמלי.
                  </p>
                )}
              </div>
            )}

            <div className="card">
              <h2 className="flex items-center justify-between text-lg font-bold text-slate-900">
                יומן ההפצה
                {!finished && connected && (
                  <span className="text-xs font-normal text-slate-500">משודר עכשיו...</span>
                )}
              </h2>

              <ol className="mt-3 space-y-3">
                {/* What the server already stored before we connected... */}
                {alert.timeline.map((entry, i) => (
                  <TimelineItem key={`stored-${i}`} entry={entry} />
                ))}
                {/* ...and what has arrived over the socket since. */}
                {timeline.map((entry, i) => (
                  <TimelineItem key={`live-${i}`} entry={entry} live />
                ))}
              </ol>

              {timeline.length === 0 && alert.timeline.length <= 1 && (
                <p className="mt-3 text-sm text-slate-500">ממתין לאירועים...</p>
              )}
            </div>

            <Link href="/simulator" className="btn-secondary w-full">שיגור קריאה חדשה</Link>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Tile({ value, label, tone = 'text-slate-900' }) {
  return (
    <div className="card text-center">
      <div className={`ltr-num text-3xl font-extrabold ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-600">{label}</div>
    </div>
  );
}

/**
 * Formats a duration in Hebrew. A responder 80 metres away has an ETA under a
 * minute, and "כ-0 דק׳" reads like a bug rather than like good news.
 */
function formatEta(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return 'פחות מדקה';
  return `כ-${Math.round(seconds / 60)} דק׳`;
}

function Row({ term, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{term}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function TimelineItem({ entry, live }) {
  const ICONS = {
    CREATED: '🆘', GATEWAY_TX: '📡', NOTIFIED: '✅',
    UNREACHABLE: '⚠️', ACK: '🚴', NO_RESPONDER: '❌',
  };
  return (
    // Events that arrived over the socket while we were watching get a marker
    // line, so it is obvious which part of the log is live.
    <li className={`flex gap-3 ${live ? 'border-e-2 border-e-emergency pe-3' : ''}`}>
      <span className="text-lg leading-none" aria-hidden="true">{ICONS[entry.event] ?? '•'}</span>
      <div className="flex-1">
        <p className="text-sm leading-relaxed text-slate-800">{entry.text}</p>
        <span className="ltr-num text-xs text-slate-400">t+{entry.t}s</span>
      </div>
    </li>
  );
}
