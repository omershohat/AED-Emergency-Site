// ============================================================================
//  /auth - admin login, silent refresh, logout   (Requirement #11)
// ============================================================================
//  THE FULL FLOW, end to end:
//
//   1. POST /auth/login    username+password -> bcrypt.compare
//                          -> access token (15m, in the JSON body)
//                          -> refresh token (7d, httpOnly cookie + hash in DB)
//
//   2. any admin request   Authorization: Bearer <access token>
//
//   3. access token expires after 15 minutes -> the client gets 401
//      TOKEN_EXPIRED and calls:
//      POST /auth/refresh  cookie -> signature check -> DB whitelist check
//                          -> ROTATION: old row revoked, new token issued
//
//   4. POST /auth/logout   revokes the row and clears the cookie
// ============================================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/common.js';
import { verifyJwt } from '../middleware/verifyJwt.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, clearCookieOptions,
  hashToken, refreshCookieOptions, REFRESH_COOKIE, REFRESH_TTL_DAYS,
} from '../lib/tokens.js';

const router = express.Router();

/** Stores the hash of a freshly issued refresh token (the whitelist entry). */
async function storeRefreshToken(conn, adminId, token, userAgent) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await conn.execute(
    `INSERT INTO refresh_tokens (admin_id, token_hash, user_agent, expires_at)
     VALUES (?, ?, ?, ?)`,
    [adminId, hashToken(token), (userAgent || '').slice(0, 255), expiresAt],
  );
}

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
router.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');

  if (!username || !password) {
    return res.status(400).json({ error: 'נא למלא שם משתמש וסיסמה' });
  }

  const rows = await query(
    'SELECT id, username, password_hash, display_name, role FROM admins WHERE username = ? LIMIT 1',
    [username],
  );
  const admin = rows[0];

  // Deliberately the SAME message for "no such user" and "wrong password".
  // Different messages would let an attacker discover valid usernames.
  const passwordOk = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!admin || !passwordOk) {
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }

  const accessToken = signAccessToken(admin);
  const refreshToken = signRefreshToken(admin);

  await withTransaction((conn) => storeRefreshToken(conn, admin.id, refreshToken, req.headers['user-agent']));

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json({
    accessToken,
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role },
  });
}));

// ---------------------------------------------------------------------------
// POST /auth/refresh   - the silent renewal
// ---------------------------------------------------------------------------
router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'אין טוקן רענון', code: 'NO_REFRESH' });

  // --- check 1: signature and expiry (is this token ours, and still valid?) --
  // We do not need the payload here - the identity comes from the database row
  // below, which is the source of truth. This call is purely a gate: it throws
  // if the token was tampered with or has expired.
  try {
    verifyRefreshToken(token);
  } catch {
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    return res.status(401).json({ error: 'טוקן רענון לא תקין', code: 'BAD_REFRESH' });
  }

  // --- check 2: the whitelist (was this specific token revoked?) ------------
  const tokenHash = hashToken(token);
  const rows = await query(
    `SELECT rt.id, rt.revoked_at, rt.expires_at, a.id AS admin_id, a.username, a.display_name, a.role
       FROM refresh_tokens rt
       JOIN admins a ON a.id = rt.admin_id
      WHERE rt.token_hash = ? LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];

  if (!row) {
    // A correctly signed token that is not in the table = it was already
    // rotated away. Treat as replay and force a fresh login.
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    return res.status(401).json({ error: 'טוקן רענון אינו מוכר', code: 'UNKNOWN_REFRESH' });
  }

  if (row.revoked_at) {
    // REUSE DETECTION: someone is using a token we already retired. Either the
    // user's cookie was stolen or a stale tab replayed it. The safe response is
    // to kill every session of this admin.
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE admin_id = ? AND revoked_at IS NULL',
      [row.admin_id]);
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    return res.status(401).json({ error: 'זוהה שימוש חוזר בטוקן - כל ההתחברויות בוטלו', code: 'REUSED_REFRESH' });
  }

  if (new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: 'טוקן הרענון פג', code: 'EXPIRED_REFRESH' });
  }

  // --- rotation: retire the old token, issue a new pair ---------------------
  const admin = { id: row.admin_id, username: row.username, role: row.role };
  const newRefresh = signRefreshToken(admin);

  await withTransaction(async (conn) => {
    await conn.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [row.id]);
    await storeRefreshToken(conn, admin.id, newRefresh, req.headers['user-agent']);
  });

  res.cookie(REFRESH_COOKIE, newRefresh, refreshCookieOptions());
  res.json({
    accessToken: signAccessToken(admin),
    admin: { id: row.admin_id, username: row.username, displayName: row.display_name, role: row.role },
  });
}));

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    // Revoking the row is what actually ends the session. Clearing the cookie
    // alone would not: a copy of the token would still work.
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
      [hashToken(token)]);
  }
  res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// GET /auth/me - lets the admin UI confirm the token it holds is still good
// ---------------------------------------------------------------------------
router.get('/me', verifyJwt, (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
