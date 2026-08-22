// ============================================================================
//  Guard for the mesh service's /internal routes - server-to-server only.
// ============================================================================
//  The mirror image of api/middleware/serviceKey.js. Until now the traffic ran
//  one way: mesh asked api "who are these responder ids?". The admin panel adds
//  the return direction - api asks mesh "when did these devices last transmit?"
//  - so this service needs the same door.
//
//  Deliberately duplicated rather than shared: the two servers are independent
//  processes that must be able to start and deploy on their own. Twenty lines
//  is the cheaper price.
// ============================================================================
import crypto from 'node:crypto';

const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

export function requireServiceKey(req, res, next) {
  const provided = req.headers['x-service-key'];

  if (!SERVICE_KEY || typeof provided !== 'string' || provided.length !== SERVICE_KEY.length) {
    return res.status(401).json({ error: 'internal route: bad service key' });
  }

  // Constant-time comparison, so an attacker cannot learn the key one
  // character at a time by measuring how fast we answer.
  const ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(SERVICE_KEY));
  if (!ok) return res.status(401).json({ error: 'internal route: bad service key' });

  next();
}
