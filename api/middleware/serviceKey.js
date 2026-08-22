// ============================================================================
//  Guard for the /internal routes - server-to-server only.
// ============================================================================
//  The mesh service (port 5000) asks this service for responder details during
//  a dispatch. That call carries no user and no JWT: it is machine-to-machine.
//  We authenticate it with a shared secret header instead.
//
//  Honest scope note for the defence: a shared static key is simulator-grade.
//  A production system would use mTLS or a signed service token with a short
//  lifetime. The key here is that /internal is never reachable from a browser.
// ============================================================================
import crypto from 'node:crypto';

const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

export function requireServiceKey(req, res, next) {
  const provided = req.headers['x-service-key'];

  if (!SERVICE_KEY || typeof provided !== 'string' || provided.length !== SERVICE_KEY.length) {
    return res.status(401).json({ error: 'internal route: bad service key' });
  }

  // timingSafeEqual compares in constant time, so an attacker cannot learn the
  // key one character at a time by measuring how fast we answer.
  const ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(SERVICE_KEY));
  if (!ok) return res.status(401).json({ error: 'internal route: bad service key' });

  next();
}
