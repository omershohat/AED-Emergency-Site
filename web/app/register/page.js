'use client';
// ============================================================================
//  Registration page (Requirements #6, #7, #8, #15)
// ============================================================================
//  A CLIENT component, because it holds form state and reacts to typing.
//
//  Requirement #15 - no password anywhere on this page. The visitor gives a
//  name, a mobile number and what equipment they carry, and that is the entire
//  process. Every field is explained next to it, so nobody has to guess what a
//  "LoRa ID" is.
//
//  The validation below MIRRORS the server's rules in api/lib/validate.js. It
//  exists for speed and courtesy, not for safety: the server validates again
//  and its answer is the one that counts.
// ============================================================================
import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

const EMPTY = {
  firstName: '', lastName: '', phone: '', city: '',
  hasAed: false, hasLora: false, loraId: '', aedModel: '', loraModel: '',
};

export default function RegisterPage() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [serverError, setServerError] = useState(null);

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear this field's error as soon as the user starts fixing it - leaving
    // red text under a field being corrected is just noise.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  /** Same rules as the server, so the user is told before the round trip. */
  function validateLocally() {
    const e = {};
    if (form.firstName.trim().length < 2) e.firstName = 'שם פרטי הוא שדה חובה';
    if (!/^0(5\d)[- ]?\d{7}$/.test(form.phone.replace(/\s/g, ''))) {
      e.phone = 'מספר נייד לא תקין (למשל 0501234567)';
    }
    if (!form.hasAed && !form.hasLora) {
      e.equipment = 'ניתן להירשם רק כבעלי דפיברילטור נייד ו/או מכשיר LoRa';
    }
    if (form.hasLora && !form.loraId.trim()) {
      e.loraId = 'בעלי מכשיר LoRa חייבים להזין מזהה';
    }
    return e;
  }

  /** Asks the server whether this number is already registered. */
  async function checkPhone() {
    const phone = form.phone.trim();
    if (!phone) return;
    try {
      const { taken } = await api.phoneTaken(phone);
      if (taken) setErrors((prev) => ({ ...prev, phone: 'מספר הנייד הזה כבר רשום במערכת' }));
    } catch {
      // A failed availability check must not block the form - the server will
      // catch a duplicate on submit anyway, with its UNIQUE constraint.
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();          // stop the browser's own form submission
    setServerError(null);

    const localErrors = validateLocally();
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.register(form);
      setDone(result);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);       // field-level messages straight from the server
      } else {
        setServerError(err.message);
      }
    } finally {
      setSubmitting(false);          // runs whether we succeeded or failed
    }
  }

  // ---- success screen ------------------------------------------------------
  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">{done.message}</h1>
        <p className="mt-3 leading-relaxed text-slate-600">
          מעכשיו, כשתיפתח קריאת מצוקה בקרבתכם, המערכת תדגום אתכם ותשלח התראה -
          בערוץ הסלולרי אם יש קליטה, וברשת ה-LoRa אם אין.
        </p>
        {done.loraId && (
          <p className="mt-2 text-slate-600">
            מזהה ה-LoRa שנשמר: <span className="ltr-num font-mono font-semibold">{done.loraId}</span>
          </p>
        )}
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className="btn-secondary">חזרה לדף הראשי</Link>
          <Link href="/simulator" className="btn-primary">לראות איך זה עובד</Link>
        </div>
      </div>
    );
  }

  // ---- the form ------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">הרשמה למערך המתנדבים</h1>
      <p className="mt-3 leading-relaxed text-slate-600">
        ההרשמה אורכת פחות מדקה, <strong>ללא סיסמה וללא פתיחת חשבון</strong>.
        אנחנו שומרים רק את מה שנדרש כדי להגיע אליכם בזמן אמת.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
        {/* ---------- personal details ---------- */}
        <fieldset className="card space-y-4">
          <legend className="px-2 text-lg font-bold text-slate-900">פרטים אישיים</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="שם פרטי" required error={errors.firstName}
              hint="כך נציג אתכם למוקד ולמתנדבים האחרים"
            >
              <input
                type="text" value={form.firstName} onChange={update('firstName')}
                className={`input ${errors.firstName ? 'input-error' : ''}`}
                placeholder="לדוגמה: דנה" autoComplete="given-name"
              />
            </Field>

            <Field label="שם משפחה" error={errors.lastName} hint="לא חובה">
              <input
                type="text" value={form.lastName} onChange={update('lastName')}
                className={`input ${errors.lastName ? 'input-error' : ''}`}
                placeholder="לדוגמה: כהן" autoComplete="family-name"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="טלפון נייד" required error={errors.phone}
              hint="לשליחת התראת SMS עם מיקום הנפגע"
            >
              <input
                type="tel" value={form.phone} onChange={update('phone')} onBlur={checkPhone}
                className={`input ltr-num ${errors.phone ? 'input-error' : ''}`}
                placeholder="0501234567" autoComplete="tel" inputMode="numeric"
              />
            </Field>

            <Field label="יישוב" hint="לא חובה - עוזר לנו להבין פריסה">
              <input
                type="text" value={form.city} onChange={update('city')}
                className="input" placeholder="תל אביב-יפו"
              />
            </Field>
          </div>
        </fieldset>

        {/* ---------- equipment: this is requirement #8 ---------- */}
        <fieldset className="card space-y-4">
          <legend className="px-2 text-lg font-bold text-slate-900">הציוד שברשותכם</legend>
          <p className="text-sm leading-relaxed text-slate-600">
            אפשר להירשם כבעלי דפיברילטור נייד, כבעלי מכשיר LoRa, או כשניהם.
            בלי אחד מהם אין מה שנוכל לשלוח לזירה.
          </p>

          {errors.equipment && (
            <p className="rounded-xl bg-emergency-light px-4 py-3 text-sm font-medium text-emergency">
              {errors.equipment}
            </p>
          )}

          <Check
            checked={form.hasAed} onChange={update('hasAed')}
            title="יש ברשותי דפיברילטור נייד (AED)"
            body="מכשיר החייאה נייד שאתם נושאים איתכם ברכיבה, בטיול או ברכב."
          />
          {form.hasAed && (
            <div className="ps-8">
              <Field label="דגם הדפיברילטור" hint="לא חובה">
                <input
                  type="text" value={form.aedModel} onChange={update('aedModel')}
                  className="input" placeholder="לדוגמה: ZOLL AED Plus"
                />
              </Field>
            </div>
          )}

          <Check
            checked={form.hasLora} onChange={update('hasLora')}
            title="יש ברשותי מכשיר LoRa בתדר 433MHz"
            body="מכשיר Meshtastic קטן שמקבל קריאות מצוקה גם בלי קליטה סלולרית."
          />
          {form.hasLora && (
            <div className="grid gap-4 ps-8 sm:grid-cols-2">
              <Field
                label="מזהה LoRa" required error={errors.loraId}
                hint="המזהה שמופיע באפליקציית Meshtastic, למשל ‎!a3f2c1b4"
              >
                <input
                  type="text" value={form.loraId} onChange={update('loraId')}
                  className={`input ltr-num font-mono ${errors.loraId ? 'input-error' : ''}`}
                  placeholder="!a3f2c1b4"
                />
              </Field>
              <Field label="דגם המכשיר" hint="לא חובה">
                <input
                  type="text" value={form.loraModel} onChange={update('loraModel')}
                  className="input" placeholder="לדוגמה: Heltec V3 433MHz"
                />
              </Field>
            </div>
          )}
        </fieldset>

        {serverError && (
          <p className="rounded-xl bg-emergency-light px-4 py-3 font-medium text-emergency">
            {serverError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'שולח...' : 'סיימתי - שמרו אותי במערך'}
          </button>
          <p className="text-sm text-slate-500">
            אין צורך בסיסמה. בכל שלב אפשר לפנות אלינו כדי להסיר את הפרטים.
          </p>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Small presentational helpers, kept in this file because nothing else uses them
// ---------------------------------------------------------------------------
function Field({ label, required, hint, error, children }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ms-1 text-emergency">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="field-error block">{error}</span>}
    </label>
  );
}

function Check({ checked, onChange, title, body }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
      checked ? 'border-emergency bg-emergency-light/40' : 'border-slate-200 hover:bg-slate-50'
    }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 h-5 w-5 accent-emergency" />
      <span>
        <span className="block font-semibold text-slate-900">{title}</span>
        <span className="block text-sm leading-relaxed text-slate-600">{body}</span>
      </span>
    </label>
  );
}
