// ============================================================================
//  MongoDB connection layer (the NoSQL half of the project)
// ============================================================================
//  WHY THIS DATA IS NOT IN MySQL:
//
//   telemetry   - a position heartbeat per device, arriving constantly. It is
//                 time-series data, and it is queried geographically
//                 ("who is within 1500 metres of this point?"). MongoDB answers
//                 that with a 2dsphere index and $geoNear, in the database.
//                 In SQL we would have to pull rows out and compute the
//                 haversine distance in JavaScript for every candidate.
//
//   alerts      - one document per distress call, holding nested arrays
//                 (candidates, timeline) whose length is unknown in advance.
//                 In SQL this is three more tables and three more joins.
//
//   mesh_events - an append-only radio log. Different channels carry different
//                 fields (a LoRa hop has rssi/snr, an SMS has none). A document
//                 store absorbs that without a schema migration.
//
//  We use the official driver, not Mongoose, for the same reason we use no ORM
//  on the SQL side: the queries stay visible.
// ============================================================================
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGO_DB || 'field_defib';

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
let db = null;

export async function connectMongo() {
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes();
  return db;
}

export function getDb() {
  if (!db) throw new Error('MongoDB is not connected yet - call connectMongo() first');
  return db;
}

export const collections = {
  telemetry: () => getDb().collection('telemetry'),
  alerts: () => getDb().collection('alerts'),
  meshEvents: () => getDb().collection('mesh_events'),
  maintenanceAlerts: () => getDb().collection('maintenance_alerts'),
};

/**
 * Indexes are created on startup, not by hand, so a fresh clone of the repo
 * behaves identically. Creating an index that already exists is a no-op.
 */
async function ensureIndexes() {
  // 2dsphere is what makes $geoNear / $geoWithin possible. Without it the
  // radius query in dispatch.js simply errors out.
  await collections.telemetry().createIndex({ loc: '2dsphere' });

  // Supports "the latest heartbeat per responder": filter by responder, newest first.
  await collections.telemetry().createIndex({ responderId: 1, ts: -1 });
  await collections.telemetry().createIndex({ loraId: 1, ts: -1 });

  await collections.alerts().createIndex({ alertId: 1 }, { unique: true });
  await collections.alerts().createIndex({ origin: '2dsphere' });
  await collections.alerts().createIndex({ createdAt: -1 });

  await collections.meshEvents().createIndex({ alertId: 1, at: 1 });

  // At most ONE open maintenance alert per responder per type. The partial
  // filter is what makes this work: the uniqueness applies only to rows still
  // OPEN, so a responder can accumulate a history of resolved alerts while
  // never holding two live ones. That is the deduplication guarantee - enforced
  // by the database rather than by a check-then-insert race in application code.
  await collections.maintenanceAlerts().createIndex(
    { responderId: 1, type: 1 },
    { unique: true, partialFilterExpression: { status: 'OPEN' } },
  );
  await collections.maintenanceAlerts().createIndex({ status: 1, createdAt: -1 });
}

export async function closeMongo() {
  await client.close();
}

/** Fails fast on startup with a readable message instead of on first request. */
export async function assertMongoReachable() {
  await getDb().command({ ping: 1 });
}
