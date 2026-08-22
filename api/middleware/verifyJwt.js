// ============================================================================
//  Route-specific middleware: the guard on every /admin route.
// ============================================================================
//  A middleware is a function (req, res, next) that sits between the request
//  and the route handler. It either calls next() to let the request continue,
//  or ends the request itself. Here it answers one question:
//  "does this request carry a valid, unexpired access token?"
// ============================================================================
import { verifyAccessToken } from '../lib/tokens.js';

export function verifyJwt(req, res, next) {
  // The convention is:  Authorization: Bearer <token>
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    // 401 = "I do not know who you are" (no credentials supplied)
    return res.status(401).json({ error: 'נדרשת התחברות', code: 'NO_TOKEN' });
  }

  try {
    // verify() checks the signature AND the exp claim. Both failures throw.
    const payload = verifyAccessToken(token);
    req.admin = { id: payload.sub, username: payload.username, role: payload.role };
    return next();   // the "bridge" to the next function in the chain
  } catch (err) {
    // We separate these two on purpose: the React client reacts to
    // TOKEN_EXPIRED by silently calling /auth/refresh, while an invalid
    // signature means something is wrong and the user is sent back to login.
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'תוקף ההתחברות פג' : 'טוקן לא תקין',
      code: expired ? 'TOKEN_EXPIRED' : 'BAD_TOKEN',
    });
  }
}

/**
 * Authorization (not authentication): the token proved WHO you are, this
 * checks WHAT you are allowed to do. Kept separate so the difference is
 * visible in the code, exactly as in the lecture's hotel analogy.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      // 403 = "I know who you are, and you still may not do this"
      return res.status(403).json({ error: 'אין הרשאה לפעולה זו', code: 'FORBIDDEN' });
    }
    next();
  };
}
