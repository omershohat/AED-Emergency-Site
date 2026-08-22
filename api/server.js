// ============================================================================
//  IDENTITY & REGISTRY SERVICE     Express + MySQL + JWT      http://localhost:4000
// ============================================================================
//  This is the server the course requires to be built with Node.js & Express.
//  It owns the RELATIONAL half of the system: admins, sessions, registered
//  responders, their equipment, and the admin-editable site content.
//
//  It never talks to MongoDB. Geography and telemetry belong to the mesh
//  service (port 5000), which asks this server for the human details it needs
//  through the /internal routes.
// ============================================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { assertDbReachable } from './db/pool.js';
import { requestLogger, notFound, errorHandler } from './middleware/common.js';
import { verifyJwt } from './middleware/verifyJwt.js';
import { requireServiceKey } from './middleware/serviceKey.js';

import authRoutes from './routes/auth.routes.js';
import respondersRoutes from './routes/responders.routes.js';
import adminRoutes from './routes/admin.routes.js';
import contentRoutes from './routes/content.routes.js';
import internalRoutes from './routes/internal.routes.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

// ---------------------------------------------------------------------------
//  GLOBAL MIDDLEWARE - runs for every request, in the order written below.
//  Order matters: a response sent by an earlier middleware means the later
//  ones never run.
// ---------------------------------------------------------------------------

// CORS. The browser blocks cross-origin calls by default; our React app runs on
// :3000 and this API on :4000, which are different origins. We open it to that
// one origin only - never origin:'*' - because `credentials: true` is required
// for the refresh cookie to travel, and the browser refuses to combine
// credentials with a wildcard origin.
app.use(cors({
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-service-key'],
}));

app.use(express.json({ limit: '100kb' }));   // parses application/json into req.body
app.use(cookieParser());                     // parses Cookie: header into req.cookies
app.use(requestLogger);

// ---------------------------------------------------------------------------
//  ROUTES
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ service: 'api', status: 'up', time: new Date() }));

// Public - no token required
app.use('/auth', authRoutes);
app.use('/responders', respondersRoutes);   // registration (#15: no password)
app.use('/content', contentRoutes);         // read-only marketing content

// Protected - verifyJwt is applied to the whole router in one place, so no
// individual admin route can be forgotten.
app.use('/admin', verifyJwt, adminRoutes);

// Machine-to-machine - the mesh service, authenticated by a shared secret.
app.use('/internal', requireServiceKey, internalRoutes);

// ---------------------------------------------------------------------------
//  TAIL MIDDLEWARE - must be registered last
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);   // four arguments => Express treats it as the error handler

// ---------------------------------------------------------------------------
//  STARTUP - verify the database before we accept traffic, so a bad password
//  in .env fails loudly on start instead of on the first user's registration.
// ---------------------------------------------------------------------------
try {
  await assertDbReachable();
  console.log('[api] MySQL connection OK');
} catch (err) {
  console.error('[api] cannot reach MySQL. Check api/.env and that the server is running.');
  console.error(err.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`[api] Identity & Registry service listening on http://localhost:${PORT}`);
});
