// ============================================================================
//  Input validation - hand written, no validation library.
// ============================================================================
//  Everything arriving from the browser is untrusted, including data that the
//  React form already validated: a client can call the API directly with curl.
//  So the server validates again, and it is the server's answer that counts.
// ============================================================================

/** Israeli mobile numbers: 05X followed by 7 digits. Accepts 050-1234567 too. */
const PHONE_RE = /^05\d{8}$/;

/** Meshtastic node id, e.g. !a3f2c1b4 - "!" followed by 8 hex characters. */
const LORA_RE = /^![0-9a-f]{8}$/i;

/** Strips spaces, dashes and a +972 prefix, so the DB always holds 05XXXXXXXX. */
export function normalisePhone(raw) {
  if (typeof raw !== 'string') return '';
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  if (p.startsWith('972')) p = '0' + p.slice(3);
  return p;
}

export function normaliseLoraId(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return t.startsWith('!') ? t : `!${t}`;   // forgive a user who omits the "!"
}

/**
 * Validates a registration payload.
 * Returns { ok: true, value } or { ok: false, errors } - the caller decides the
 * HTTP status, this function knows nothing about HTTP.
 *
 * Field rules come straight from requirement #6, the eligibility rule from #8.
 */
export function validateRegistration(body) {
  const errors = {};

  // --- first name: required (requirement #6) ---
  const firstName = String(body.firstName ?? '').trim();
  if (firstName.length < 2) errors.firstName = 'שם פרטי הוא שדה חובה (2 תווים לפחות)';
  if (firstName.length > 60) errors.firstName = 'שם פרטי ארוך מדי';

  // --- last name: optional (requirement #6) ---
  const lastNameRaw = String(body.lastName ?? '').trim();
  const lastName = lastNameRaw.length ? lastNameRaw : null;
  if (lastName && lastName.length > 60) errors.lastName = 'שם משפחה ארוך מדי';

  // --- phone: required and must look like an Israeli mobile ---
  const phone = normalisePhone(body.phone);
  if (!PHONE_RE.test(phone)) errors.phone = 'מספר נייד לא תקין (למשל 0501234567)';

  // --- LoRa id: optional, but if given it must be a valid node id ---
  const loraId = normaliseLoraId(body.loraId);
  if (loraId && !LORA_RE.test(loraId)) {
    errors.loraId = 'מזהה LoRa לא תקין (למשל ‎!a3f2c1b4)';
  }

  // --- equipment / eligibility (requirement #8) -----------------------------
  // A registrant must be one of:
  //   * a mobile defibrillator owner (with or without a LoRa node), or
  //   * a LoRa device owner.
  // Anyone owning neither has nothing to contribute to a rescue, so we refuse
  // the registration instead of storing a row the dispatcher can never use.
  const hasAed = body.hasAed === true || body.hasAed === 'true';
  const hasLora = body.hasLora === true || body.hasLora === 'true' || Boolean(loraId);
  if (!hasAed && !hasLora) {
    errors.equipment = 'ניתן להירשם רק כבעלי דפיברילטור נייד ו/או מכשיר LoRa';
  }
  // A LoRa owner without a node id would be undetectable on the mesh.
  if (hasLora && !loraId) {
    errors.loraId = 'בעלי מכשיר LoRa חייבים להזין מזהה LoRa';
  }

  const city = String(body.city ?? '').trim().slice(0, 60) || null;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      firstName, lastName, phone, loraId, city, hasAed, hasLora,
      aedModel: String(body.aedModel ?? '').trim().slice(0, 80) || null,
      loraModel: String(body.loraModel ?? '').trim().slice(0, 80) || null,
    },
  };
}

/** Clamps a page/limit pair coming from the admin table's query string. */
export function parsePaging(qs, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, Number.parseInt(qs.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(qs.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
