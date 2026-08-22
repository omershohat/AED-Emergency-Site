'use client';
// ============================================================================
//  The simulator (Requirements #1, #9, #10)
// ============================================================================
//  Requirement #1 - the whole distress scenario is a WEB simulator. Nothing on
//  this page transmits on any radio; it drives the same server code a real
//  gateway would call.
//
//  Requirement #10 - the "Radius" control. The circle drawn on the map is the
//  exact value sent to the server as maxDistance, so what you see is what was
//  searched.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { mesh, ApiError } from '@/lib/api';
import { DEFAULT_CENTER, DEFAULT_ZOOM, DEFAULT_RADIUS_M, DEFAULT_SAMPLE_SIZE } from '@/lib/config';
import { deviceHealthPopupLine } from '@/lib/deviceHealth';

// Leaflet reaches for `window` the moment it is imported, and Next renders
// components on the server first. `ssr: false` keeps this component out of the
// server render entirely - the standard way to load a browser-only library.
const MapCanvas = dynamic(() => import('@/components/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
      טוען מפה...
    </div>
  ),
});

export default function SimulatorPage() {
  const router = useRouter();

  const [origin, setOrigin] = useState(DEFAULT_CENTER);
  const [radiusM, setRadiusM] = useState(DEFAULT_RADIUS_M);
  const [sampleSize, setSampleSize] = useState(DEFAULT_SAMPLE_SIZE);
  const [victimName, setVictimName] = useState('רוכב אופניים');
  const [victimPhone, setVictimPhone] = useState('0501234567');

  const [devices, setDevices] = useState([]);
  const [fleet, setFleet] = useState(null);   // counts + the freshness threshold
  const [loadError, setLoadError] = useState(null);
  const [firing, setFiring] = useState(false);
  const [error, setError] = useState(null);

  // Load the currently-transmitting fleet, so the map is not empty before
  // anything happens. Devices that have gone silent are deliberately NOT
  // returned by the server - see the counts banner below, which reports how
  // many were withheld rather than letting the map quietly show fewer dots.
  useEffect(() => {
    let cancelled = false;
    mesh.latestTelemetry()
      .then((data) => {
        if (cancelled) return;
        setDevices(data.devices);
        setFleet({ counts: data.counts, maxAgeMinutes: data.maxAgeMinutes });
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, []);

  // useMemo keeps this array referentially stable between renders. Without it a
  // new array on every keystroke in the victim-name field would make MapCanvas
  // clear and redraw every marker.
  const markers = useMemo(() => {
    const list = devices.map((d) => ({
      id: d.responderId,
      lat: d.lat,
      lng: d.lng,
      kind: 'device',
      label: `מתנדב #${d.responderId}`,
      popup: `<strong>מתנדב #${d.responderId}</strong><br/>`
        + `${d.loraId ? `LoRa: ${d.loraId}<br/>` : 'ללא מכשיר LoRa<br/>'}`
        + `${d.cellCoverage ? 'יש קליטה סלולרית' : 'אין קליטה סלולרית'}<br/>`
        + `${deviceHealthPopupLine(d.batteryLevel, d.isOperational)}<br/>`
        + `שידור אחרון: לפני ${d.minutesAgo} דק׳`,
    }));
    list.push({ id: 'victim', lat: origin.lat, lng: origin.lng, kind: 'victim', label: 'מקור הקריאה' });
    return list;
  }, [devices, origin.lat, origin.lng]);

  const circle = useMemo(
    () => ({ lat: origin.lat, lng: origin.lng, radiusM }),
    [origin.lat, origin.lng, radiusM],
  );

  async function fireAlert() {
    setFiring(true);
    setError(null);
    try {
      const alert = await mesh.createAlert({
        origin,
        radiusM,
        sampleSize,
        victim: { name: victimName, phone: victimPhone },
      });
      // Straight to the emergency page, which subscribes to the WebSocket and
      // watches the rest of the propagation arrive live.
      router.push(`/emergency?alert=${alert.alertId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'שגיאה בשיגור הקריאה');
      setFiring(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">סימולטור קריאת מצוקה</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-slate-600">
        בחרו נקודה על המפה, קבעו רדיוס חיפוש, ושגרו קריאה. המערכת תדגום מתנדבים
        מתוך מסד הנתונים, תחליט לכל אחד מהם אם לפנות אליו ברשת ה-LoRa או ב-SMS,
        ותחשב מסלול רכיבה אמיתי למתנדב הנבחר.
      </p>

      {loadError && (
        <p className="mt-6 rounded-xl bg-emergency-light px-4 py-3 text-emergency">
          לא ניתן לטעון את מיקומי המתנדבים ({loadError}). ודאו ששרת ה-mesh ומסד MongoDB פועלים.
        </p>
      )}

      {/* Only devices that broadcast recently are drawn. Saying so out loud
          beats letting the map quietly show fewer dots than the database holds -
          and it makes the freshness rule visible instead of hidden in a query. */}
      {fleet && (
        <p className="mt-6 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          מוצגים <span className="ltr-num font-semibold">{fleet.counts.transmitting}</span> מתוך{' '}
          <span className="ltr-num font-semibold">{fleet.counts.total}</span> מכשירים רשומים —
          רק מי ששידר ב-<span className="ltr-num">{fleet.maxAgeMinutes}</span> הדקות האחרונות.
          {fleet.counts.silent > 0 && (
            // Hebrew inflects for one vs. many, so "1 מכשירים" reads as broken
            // text rather than as a number. Singular gets its own phrasing.
            <>
              {fleet.counts.silent === 1 ? (
                <> מכשיר אחד שתק מעבר לסף ואינו מוצג — המערכת לא תשגר אליו קריאה.</>
              ) : (
                <>
                  {' '}<span className="ltr-num font-semibold">{fleet.counts.silent}</span> מכשירים
                  שתקו מעבר לסף ואינם מוצגים — המערכת לא תשגר אליהם קריאה.
                </>
              )}
            </>
          )}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ------------------------------- map ------------------------------- */}
        <div>
          <MapCanvas
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            markers={markers}
            circle={circle}
            onMapClick={setOrigin}
            className="h-[520px] w-full overflow-hidden rounded-2xl border border-slate-200"
          />
          <p className="mt-2 text-sm text-slate-500">
            לחיצה על המפה מזיזה את מקור הקריאה. כרגע:{' '}
            <span className="ltr-num font-mono">
              {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
            </span>
          </p>
        </div>

        {/* ---------------------------- controls ---------------------------- */}
        <aside className="space-y-4">
          <div className="card space-y-5">
            <h2 className="text-lg font-bold text-slate-900">הגדרות הסימולציה</h2>

            <Slider
              label="רדיוס חיפוש" value={radiusM} min={200} max={5000} step={100}
              onChange={setRadiusM}
              display={`${radiusM.toLocaleString('he-IL')} מ׳`}
              hint="נשלח לשרת כ-maxDistance בשאילתת ה-$geoNear"
            />

            <Slider
              label="כמה מתנדבים לדגום" value={sampleSize} min={1} max={15} step={1}
              onChange={setSampleSize}
              display={String(sampleSize)}
              hint="דגימה אקראית ($sample) מתוך מי שנמצא ברדיוס"
            />

            <label className="block">
              <span className="label">שם הקורא/ת</span>
              <input value={victimName} onChange={(e) => setVictimName(e.target.value)} className="input" />
            </label>

            <label className="block">
              <span className="label">טלפון הקורא/ת</span>
              <input
                value={victimPhone} onChange={(e) => setVictimPhone(e.target.value)}
                className="input ltr-num" inputMode="numeric"
              />
              <span className="mt-1 block text-xs text-slate-500">
                נשלח בגוף ה-SMS יחד עם המיקום
              </span>
            </label>

            {error && <p className="field-error">{error}</p>}

            <button type="button" onClick={fireAlert} disabled={firing} className="btn-primary w-full text-lg">
              {firing ? 'משגר...' : '🆘 שגרו קריאת מצוקה'}
            </button>
          </div>

          <div className="card bg-slate-50">
            <h3 className="font-bold text-slate-900">מה קורה ברגע השיגור</h3>
            <ol className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">
              <li><strong>1.</strong> שאילתה גאוגרפית ב-MongoDB מאתרת מי שידר מהאזור לאחרונה.</li>
              <li><strong>2.</strong> שרת ה-mesh שואל את שרת הרישום (MySQL) מי האנשים האלה.</li>
              <li><strong>3.</strong> לכל מתנדב נבחר ערוץ: LoRa אם אין קליטה, SMS אם יש.</li>
              <li><strong>4.</strong> מחושב מסלול אופניים אמיתי מהמתנדב הנבחר אל הנפגע.</li>
              <li><strong>5.</strong> ההפצה משודרת חיה לדף החירום דרך WebSocket.</li>
            </ol>
          </div>

          <div className="card border-r-4 border-r-slate-300 bg-white text-sm leading-relaxed text-slate-600">
            <strong className="block text-slate-900">זו סימולציה בלבד</strong>
            אף שידור רדיו לא מתבצע, ואף SMS לא נשלח. כל &quot;קפיצה&quot; ברשת נרשמת
            כמסמך במסד הנתונים ומשודרת לדפדפן.
          </div>
        </aside>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display, hint }) {
  return (
    <label className="block">
      <span className="label flex items-center justify-between">
        <span>{label}</span>
        <span className="ltr-num font-mono text-slate-900">{display}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emergency"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
