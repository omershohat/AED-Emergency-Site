// ============================================================================
//  JWT helpers - Access Token + Refresh Token
// ============================================================================
//  THE MODEL (this is the part to know by heart for the defence):
//
//   Access Token   - short lived (15 minutes), signed with ACCESS_SECRET.
//                    Sent on every request in the Authorization header.
//                    Kept in React memory only - never in localStorage, because
//                    any XSS on the page could read localStorage.
//
//   Refresh Token  - long lived (7 days), signed with a DIFFERENT secret.
//                    Sent to the browser as an httpOnly cookie, so JavaScript
//                    on the page cannot read it at all.
//                    A hash of it is stored in the refresh_tokens table, which
//                    turns a stateless JWT into something we CAN revoke.
//
//  Two different secrets is not decoration: if ACCESS_SECRET ever leaks, an
//  attacker can forge 15-minute tokens, but cannot mint refresh tokens.
// ============================================================================
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
export const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
export const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 7);

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('Missing JWT_ACCESS_SECRET / JWT_REFRESH_SECRET in api/.env');
}

/**
 * The access token payload stays SMALL and non-secret.
 * A JWT is signed, not encrypted - anyone holding it can base64-decode the
 * payload and read it. So: id, username and role only. Never a password.
 */
export function signAccessToken(admin) {
  return jwt.sign(
    { sub: admin.id, username: admin.username, role: admin.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL },
  );
}

/**
 * `jti` (JWT ID) is a random value that makes every refresh token unique even
 * if the same admin logs in twice in the same second - otherwise two identical
 * tokens would collide on the UNIQUE token_hash column.
 */
export function signRefreshToken(admin) {
  return jwt.sign(
    { sub: admin.id, jti: crypto.randomUUID() },
    REFRESH_SECRET,
    { expiresIn: `${REFRESH_TTL_DAYS}d` },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);   // throws if expired or tampered
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/**
 * We store SHA-256 of the refresh token, not the token.
 *
 * Why SHA-256 here but bcrypt for passwords? bcrypt is deliberately slow to
 * make brute-forcing a human password expensive. A refresh token is a long
 * random signed string - there is nothing to brute force - and it is verified
 * on every silent refresh, so a slow hash would be wasted work.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * The attributes that identify our refresh cookie. Kept in one place because a
 * cookie can only be cleared by a response whose path and flags MATCH the ones
 * it was set with - a mismatch here silently leaves the cookie in the browser.
 */
function baseCookieOptions() {
  return {
    httpOnly: true,                                   // JS in the page cannot read it
    sameSite: 'strict',                               // not sent on cross-site requests => CSRF defence
    secure: process.env.NODE_ENV === 'production',    // HTTPS only in production
    path: '/auth',                                    // sent only to the auth routes
  };
}

/** Used when SETTING the cookie - adds how long the browser should keep it. */
export function refreshCookieOptions() {
  return { ...baseCookieOptions(), maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000 };
}

/**
 * Used when CLEARING it. Deliberately without maxAge: clearCookie expires the
 * cookie immediately by itself, and passing a lifetime to a call whose job is
 * to end one is contradictory enough that Express deprecated it.
 */
export function clearCookieOptions() {
  return baseCookieOptions();
}

export const REFRESH_COOKIE = 'fd_refresh';
