// ============================================================================
//  LOW BATTERY MAINTENANCE ALERTS
// ============================================================================
//  A defibrillator that is present but flat is worse than no defibrillator at
//  all: the map shows a rescuer who cannot rescue. So when a device reports a
//  battery below the threshold, the system raises a maintenance alert and
//  notifies the owner - the same volunteer who registered it - asking them to
//  charge or service the unit BEFORE anyone needs it.
//
//  THE STATE MACHINE, and why alerts are stored rather than derived:
//
//    battery drops below 20%  ->  OPEN alert created, owner notified ONCE
//    stays below 20%          ->  existing alert updated, NO second notification
//    recovers to >= 20%       ->  alert RESOLVED, no further nagging
//
//  Deduplication is the whole point. A LoRa node reports every few minutes; a
//  naive implementation would text the owner every heartbeat until the battery
//  died. The unique partial index in db/mongo.js enforces "at most one OPEN
//  alert per responder per type" at the database level, so even two heartbeats
//  arriving simultaneously cannot produce two notifications.
//
//  Note the split of concerns: the low-battery *status* shown in the UI is
//  DERIVED on read (batteryLevel < threshold, always current), while an alert
//  RECORD is written only when a notification actually goes out. Storing the
//  status too would give us two sources of truth that could disagree.
// ============================================================================
import { collections } from '../db/mongo.js';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

/** Below this percentage a device needs charging or servicing. */
export const LOW_BATTERY_THRESHOLD = Number(process.env.LOW_BATTERY_THRESHOLD || 20);

/**
 * The single definition of "low battery", used by the API, both maps and the
 * admin panel. null (never reported) is NOT low - it is unknown, and marking
 * an unreported device as needing maintenance would be a false alarm.
 */
export function isLowBattery(batteryLevel) {
  return typeof batteryLevel === 'number' && batteryLevel < LOW_BATTERY_THRESHOLD;
}

/**
 * Looks up the owner so the notification can name them and reach their phone.
 * Degrades to null rather than throwing - a maintenance alert is still worth
 * recording even if the registry is momentarily unreachable.
 */
async function fetchOwner(responderId) {
  try {
    const res = await fetch(`${API_URL}/internal/responders?ids=${responderId}`, {
      headers: { 'x-service-key': SERVICE_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const list = await res.json();
    return list[0] ?? null;
  } catch (err) {
    console.warn('[mesh] maintenance: owner lookup failed:', err.message);
    return null;
  }
}

/**
 * The simulated outbound notification (Requirement: "simulated Push / SMS").
 *
 * Nothing is sent to a carrier - exactly like the distress-call channels, this
 * is a web simulator. What IS real is the decision of which channel would carry
 * it and the record that it happened, so swapping in a real SMS gateway means
 * replacing this one function.
 */
function sendMaintenanceNotification(owner, batteryLevel) {
  if (!owner?.phone) {
    return { channel: 'NONE', phone: null, message: null, sentAt: new Date() };
  }

  // A maintenance reminder is not an emergency: it goes over the cellular
  // network, never over the LoRa mesh. Mesh airtime is a shared, duty-cycle
  // limited resource that must stay clear for actual distress traffic.
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'מתנדב/ת';
  const message = `שלום ${name}, סוללת המכשיר שלך ברמה ${batteryLevel}% `
    + `(מתחת ל-${LOW_BATTERY_THRESHOLD}%). נא להטעין כדי להישאר זמין/ה לקריאות מצוקה.`;

  console.log(`[mesh] MAINTENANCE SMS -> ${owner.phone}: ${message}`);

  return { channel: 'SMS', phone: owner.phone, message, sentAt: new Date() };
}

/**
 * Evaluates one telemetry reading and moves the alert state machine.
 *
 * Called on every ingested heartbeat. Safe to call with any battery value,
 * including null.
 *
 * @returns {Promise<{action: string, alertId?: any, notified?: boolean}>}
 */
export async function evaluateBattery({ responderId, loraId, batteryLevel }) {
  if (responderId == null || batteryLevel == null) return { action: 'SKIPPED_NO_DATA' };

  const alerts = collections.maintenanceAlerts();
  const open = await alerts.findOne({ responderId, type: 'LOW_BATTERY', status: 'OPEN' });

  // ---- battery is healthy -------------------------------------------------
  if (!isLowBattery(batteryLevel)) {
    if (!open) return { action: 'OK' };

    await alerts.updateOne(
      { _id: open._id },
      { $set: { status: 'RESOLVED', resolvedAt: new Date(), resolvedAtLevel: batteryLevel } },
    );
    console.log(`[mesh] maintenance: responder ${responderId} recovered to ${batteryLevel}% - alert resolved`);
    return { action: 'RESOLVED', alertId: open._id };
  }

  // ---- still low, already reported: update, do NOT notify again -----------
  if (open) {
    await alerts.updateOne(
      { _id: open._id },
      {
        $set: { lastBatteryLevel: batteryLevel, lastSeenAt: new Date() },
        $min: { lowestBatteryLevel: batteryLevel },
        $inc: { readingsWhileOpen: 1 },
      },
    );
    return { action: 'ALREADY_OPEN', alertId: open._id, notified: false };
  }

  // ---- newly low: raise the alert and notify the owner once ---------------
  const owner = await fetchOwner(responderId);
  const notification = sendMaintenanceNotification(owner, batteryLevel);

  const doc = {
    responderId,
    loraId: loraId ?? null,
    type: 'LOW_BATTERY',
    status: 'OPEN',
    threshold: LOW_BATTERY_THRESHOLD,
    batteryLevel,                  // the reading that triggered it
    lastBatteryLevel: batteryLevel,
    lowestBatteryLevel: batteryLevel,
    readingsWhileOpen: 1,
    owner: owner
      ? { name: [owner.firstName, owner.lastName].filter(Boolean).join(' '), phone: owner.phone }
      : null,
    notification,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    resolvedAt: null,
  };

  try {
    const result = await alerts.insertOne(doc);
    return { action: 'CREATED', alertId: result.insertedId, notified: notification.channel !== 'NONE' };
  } catch (err) {
    // The unique partial index rejected a duplicate - two heartbeats raced and
    // the other one won. That is the index doing its job, not an error.
    if (err.code === 11000) return { action: 'ALREADY_OPEN', notified: false };
    throw err;
  }
}

/**
 * Re-evaluates EVERY device from its most recent heartbeat.
 *
 * The seed script writes telemetry straight into MongoDB rather than through
 * POST /telemetry, so seeded low batteries never pass through evaluateBattery().
 * This endpoint closes that gap: it brings the alert table in line with whatever
 * the telemetry currently says. Idempotent - running it twice changes nothing.
 */
export async function reconcileAllBatteries() {
  const latest = await collections.telemetry().aggregate([
    { $sort: { ts: -1 } },
    { $group: { _id: '$responderId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
  ]).toArray();

  const summary = { scanned: latest.length, created: 0, resolved: 0, alreadyOpen: 0, ok: 0 };

  for (const t of latest) {
    const { action } = await evaluateBattery({
      responderId: t.responderId,
      loraId: t.loraId,
      batteryLevel: t.batteryLevel,
    });
    if (action === 'CREATED') summary.created += 1;
    else if (action === 'RESOLVED') summary.resolved += 1;
    else if (action === 'ALREADY_OPEN') summary.alreadyOpen += 1;
    else if (action === 'OK') summary.ok += 1;
  }

  return summary;
}

/** Open maintenance alerts, newest first - the admin panel's work queue. */
export async function listOpenAlerts(limit = 100) {
  return collections.maintenanceAlerts()
    .find({ status: 'OPEN' }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
