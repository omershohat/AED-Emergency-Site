// ============================================================================
//  DISPATCH & TELEMETRY SERVICE    Express + ws + MongoDB   http://localhost:5000
// ============================================================================
//  The second server of the system. It owns the DOCUMENT half: device
//  heartbeats, alert documents and the mesh event log, plus the WebSocket
//  channel that drives the live emergency page.
//
//  It never opens a MySQL connection. When it needs to know who a responder is,
//  it asks the api service over HTTP - see lib/dispatch.js, step 2.
// ============================================================================
import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';

import { connectMongo, assertMongoReachable, closeMongo } from './db/mongo.js';
import { initRealtime } from './lib/realtime.js';
import { requestLogger, notFound, errorHandler } from './middleware/common.js';
import { requireServiceKey } from './middleware/serviceKey.js';

import alertsRoutes from './routes/alerts.routes.js';
import telemetryRoutes from './routes/telemetry.routes.js';
import routeRoutes from './routes/route.routes.js';
import internalRoutes from './routes/internal.routes.js';
import maintenanceRoutes from './routes/maintenance.routes.js';

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors({
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(requestLogger);

app.get('/health', (_req, res) => res.json({ service: 'mesh', status: 'up', time: new Date() }));

app.use('/alerts', alertsRoutes);
app.use('/telemetry', telemetryRoutes);
app.use('/route', routeRoutes);
app.use('/maintenance', maintenanceRoutes);

// Machine-to-machine - the api service asking when devices last transmitted.
// Authenticated by the same shared secret, never reachable from a browser.
app.use('/internal', requireServiceKey, internalRoutes);

app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------------
//  STARTUP
// ---------------------------------------------------------------------------
//  We create the HTTP server ourselves instead of using app.listen(), because
//  the WebSocket server has to attach to that same server object. That is what
//  lets HTTP and WebSocket share port 5000: a WebSocket connection begins as an
//  ordinary HTTP request carrying "Upgrade: websocket".
// ---------------------------------------------------------------------------
try {
  await connectMongo();
  await assertMongoReachable();
  console.log('[mesh] MongoDB connection OK');
} catch (err) {
  console.error('[mesh] cannot reach MongoDB. Is mongod running? Check mesh/.env');
  console.error(err.message);
  process.exit(1);
}

const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, () => {
  console.log(`[mesh] Dispatch & Telemetry service listening on http://localhost:${PORT}`);
  console.log(`[mesh] WebSocket ready on ws://localhost:${PORT}`);

  // Deferred startup check: warn if seed telemetry has gone stale.
  // This is the most common reason dispatch returns "0 candidates found".
  // We wait 1s so MongoDB is fully ready before we query it.
  setTimeout(async () => {
    try {
      const { freshnessCutoff, MAX_HEARTBEAT_AGE_MIN } = await import('./lib/freshness.js');
      const { getDb } = await import('./db/mongo.js');
      const fresh = await getDb().collection('telemetry').countDocuments({ ts: { $gte: freshnessCutoff() } });
      const total = await getDb().collection('telemetry').countDocuments();

      if (total === 0) {
        console.warn('[mesh] ⚠️  WARNING: No telemetry data found. Run: npm run seed');
      } else if (fresh === 0) {
        console.warn(`[mesh] ⚠️  WARNING: All ${total} telemetry heartbeats are older than ${MAX_HEARTBEAT_AGE_MIN} minutes.`);
        console.warn('[mesh] ⚠️  Dispatch will find ZERO candidates until you either:');
        console.warn('[mesh]      1. Run: npm run seed   (resets everything)');
        console.warn(`[mesh]      2. POST http://localhost:${PORT}/maintenance/refresh-telemetry   (timestamps only)`);
      } else {
        console.log(`[mesh] ✓ Telemetry OK: ${fresh}/${total} heartbeats within the ${MAX_HEARTBEAT_AGE_MIN}-minute window`);
      }
    } catch {
      // Non-fatal - the server is already listening, this is just a hint.
    }
  }, 1000);
});

// Ctrl+C should close the Mongo connection instead of leaving it to time out.
process.on('SIGINT', async () => {
  console.log('\n[mesh] shutting down...');
  server.close();
  await closeMongo();
  process.exit(0);
});
