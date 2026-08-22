// ============================================================================
//  THE DISPATCH ENGINE - what happens when someone presses the distress button
// ============================================================================
//  Requirements #9 (sample the seeded users on the map, show their location and
//  last broadcast time) and #10 (a Radius parameter + bicycle navigation).
//
//  The five steps, in order:
//
//    1. GEOGRAPHY  (MongoDB)  $geoNear on `telemetry` -> who was inside the
//                             radius, and how long ago did they last broadcast?
//    2. IDENTITY   (MySQL)    one HTTP call to the api service turns those ids
//                             into names, phones and equipment.
//    3. CHANNEL               per responder: LoRa mesh, cellular SMS, or
//                             unreachable - this is the whole point of the
//                             hybrid design.
//    4. NAVIGATION            a real bicycle route for the chosen responder.
//    5. PROPAGATION           the alert travels hop by hop, pushed live to the
//                             emergency page over the WebSocket.
// ============================================================================
import crypto from 'node:crypto';
import { collections } from '../db/mongo.js';
import { getBikeRoute } from './routing.js';
import { broadcastToAlert, broadcastGlobal } from './realtime.js';
import { MAX_HEARTBEAT_AGE_MIN, freshnessCutoff } from './freshness.js';
import { isLowBattery } from './maintenance.js';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

// ---------------------------------------------------------------------------
//  STEP 1 - the geo query
// ---------------------------------------------------------------------------
/**
 * Finds the latest heartbeat of every device inside `radiusM`, then takes a
 * random sample of them (requirement #9).
 */
async function findCandidatesNearby(origin, radiusM, sampleSize) {
  const cutoff = freshnessCutoff();

  return collections.telemetry().aggregate([
    // $geoNear MUST be the first stage of the pipeline. It uses the 2dsphere
    // index and writes each document's own distance into `distanceM`.
    //
    // NOTE - there is deliberately NO maxDistance here, and the reason matters:
    // $geoNear filters individual HEARTBEATS, but we need to filter RESPONDERS
    // by where they are NOW. Constraining the radius at this stage would keep a
    // responder's old heartbeat that happened to fall inside the circle while
    // discarding their newer one outside it - and the $group below would then
    // report that stale position as current. A responder who left the area an
    // hour ago would be dispatched as if they were standing on the casualty.
    // So: annotate every fresh heartbeat with its distance, reduce to the
    // latest one per responder, and only THEN apply the radius.
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [origin.lng, origin.lat] },
        distanceField: 'distanceM',
        spherical: true,
        query: { ts: { $gte: cutoff } }, // ignore devices that went silent long ago
      },
    },
    // A device sends many heartbeats. Keep only the newest per responder:
    // sort by time, then $first inside a $group.
    { $sort: { ts: -1 } },
    {
      $group: {
        _id: '$responderId',
        latest: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$latest' } },
    // The Radius parameter of the simulator, applied to the position each
    // responder is ACTUALLY at - `distanceM` here belongs to the surviving
    // (newest) heartbeat, because $geoNear annotated it individually.
    { $match: { distanceM: { $lte: radiusM } } },
    // Safety ceiling, now measured in responders rather than raw heartbeats.
    // It sits after the $match so it can never discard someone who is in range.
    { $limit: 500 },
    // Requirement #9: "randomly sample these users". $sample does it inside the
    // database, so we never pull 50 documents into Node to throw most away.
    { $sample: { size: sampleSize } },
    { $sort: { distanceM: 1 } },
  ]).toArray();
}

// ---------------------------------------------------------------------------
//  STEP 2 - the cross-database join
// ---------------------------------------------------------------------------
/**
 * MongoDB knows WHERE, MySQL knows WHO. This is the one place the two halves
 * of the system meet, and it costs exactly one HTTP request per alert.
 */
async function fetchResponderDetails(responderIds) {
  if (!responderIds.length) return new Map();

  const url = `${API_URL}/internal/responders?ids=${responderIds.join(',')}`;
  const response = await fetch(url, { headers: { 'x-service-key': SERVICE_KEY } });

  if (!response.ok) {
    throw Object.assign(new Error(`api /internal/responders failed: ${response.status}`), { status: 502 });
  }

  const list = await response.json();
  return new Map(list.map((r) => [r.id, r]));   // Map for O(1) lookup while merging
}

// ---------------------------------------------------------------------------
//  STEP 3 - channel selection: the hybrid communication decision
// ---------------------------------------------------------------------------
/**
 * This tiny function is the argument for the whole project.
 *
 *   cellular coverage + no LoRa  -> SMS carrying the location and phone number
 *   no coverage      + LoRa      -> the 433MHz mesh reaches them anyway
 *   no coverage      + no LoRa   -> unreachable. Shown on purpose, because that
 *                                   empty seat is what the LoRa node solves.
 *
 * (A push notification is the same cellular channel with a different transport,
 *  so it is not modelled separately - one code path, one thing to explain.)
 */
function chooseChannel({ hasLora, cellCoverage }) {
  if (cellCoverage) return 'SMS';
  if (hasLora) return 'LORA';
  return 'NONE';
}

// ---------------------------------------------------------------------------
//  Creating an alert
// ---------------------------------------------------------------------------
/**
 * @param {object} input
 * @param {{lat:number,lng:number}} input.origin   where the victim is
 * @param {number} input.radiusM                   simulator "Radius" parameter
 * @param {number} input.sampleSize                how many responders to sample
 * @param {{name?:string, phone?:string}} input.victim
 */
export async function createAlert({ origin, radiusM, sampleSize, victim }) {
  const alertId = `ALR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const createdAt = new Date();

  // --- 1. geography ---------------------------------------------------------
  const nearby = await findCandidatesNearby(origin, radiusM, sampleSize);

  // --- 2. identity ----------------------------------------------------------
  const details = await fetchResponderDetails(nearby.map((t) => t.responderId));

  // --- 3. merge + channel ---------------------------------------------------
  const candidates = nearby
    .filter((t) => details.has(t.responderId))    // skip anyone deactivated in MySQL
    .map((t) => {
      const person = details.get(t.responderId);
      const channel = chooseChannel({ hasLora: person.hasLora, cellCoverage: t.cellCoverage });
      return {
        responderId: person.id,
        name: [person.firstName, person.lastName].filter(Boolean).join(' '),
        phone: person.phone,
        loraId: person.loraId,
        hasAed: person.hasAed,
        hasLora: person.hasLora,
        cellCoverage: Boolean(t.cellCoverage),
        channel,
        position: { lat: t.loc.coordinates[1], lng: t.loc.coordinates[0] },
        distanceM: Math.round(t.distanceM),
        // Requirement #9 explicitly asks to display the last broadcast time.
        lastSeen: t.ts,
        lastSeenMinutes: Math.round((createdAt - new Date(t.ts)) / 60000),
        // Requirement #1: device health, carried alongside the broadcast time
        // it was measured at. batteryLevel is the radio/phone's own battery;
        // isOperational is whether the DEFIBRILLATOR itself is ready to use -
        // the two are independent, because a charged phone can be paired with
        // an AED that failed its self-test.
        batteryLevel: t.batteryLevel ?? null,
        // Flagged for the dispatcher's screen: a responder whose radio is about
        // to die may stop being reachable mid-rescue, which the operator needs
        // to see before relying on them.
        lowBattery: isLowBattery(t.batteryLevel),
        isOperational: t.isOperational ?? null,
        rssi: t.rssi ?? null,
        hops: t.hops ?? null,
        status: 'PENDING',
        ack: false,
      };
    });

  // --- 4. navigation for the responder we are actually sending --------------
  // Preference order, expressed as a score (higher wins), then distance:
  //   2 - carries an AED that is confirmed operational (or health unknown -
  //       we do not penalise a device that has simply never reported)
  //   1 - carries an AED that reported isOperational === false
  //   0 - no AED at all, can still help with CPR
  //
  // A dead-on-arrival defibrillator is worse than reachable-but-equipment-free
  // information would suggest, so a CONFIRMED-broken AED is deliberately
  // ranked BELOW an operational one - but still above no AED, because an
  // out-of-order AED plus a phone is still a responder worth sending.
  const score = (c) => (c.hasAed ? (c.isOperational === false ? 1 : 2) : 0);

  const primary = [...candidates]
    .filter((c) => c.channel !== 'NONE')
    .sort((a, b) => score(b) - score(a) || a.distanceM - b.distanceM)[0] || null;

  let route = null;
  if (primary) {
    route = await getBikeRoute(primary.position, origin);
    primary.status = 'SELECTED';
    primary.etaSec = route.durationSec;
    primary.routeDistanceM = route.distanceM;
    // Surfaced directly on the alert so the UI can warn without recomputing
    // the same logic - the emergency page should not have to re-derive it.
    primary.operationalConcern = primary.hasAed && primary.isOperational === false;
  }

  // --- build and store the alert document -----------------------------------
  const alert = {
    alertId,
    createdAt,
    status: 'DISPATCHING',
    origin: { type: 'Point', coordinates: [origin.lng, origin.lat] },
    victim: {
      name: victim?.name || 'קורא/ת במצוקה',
      phone: victim?.phone || null,
    },
    config: { radiusM, sampleSize, maxHeartbeatAgeMin: MAX_HEARTBEAT_AGE_MIN },
    stats: {
      found: candidates.length,
      viaLora: candidates.filter((c) => c.channel === 'LORA').length,
      viaSms: candidates.filter((c) => c.channel === 'SMS').length,
      unreachable: candidates.filter((c) => c.channel === 'NONE').length,
    },
    candidates,
    primaryResponderId: primary?.responderId ?? null,
    route,                                   // GeoJSON coordinates + distance + ETA
    timeline: [{ t: 0, event: 'CREATED', text: 'קריאת מצוקה נפתחה' }],
  };

  await collections.alerts().insertOne(alert);

  await collections.meshEvents().insertOne({
    alertId, channel: 'SYSTEM', event: 'ALERT_CREATED',
    radiusM, found: candidates.length, at: createdAt,
  });

  broadcastGlobal({ type: 'NEW_ALERT', alertId, origin, found: candidates.length });

  // Step 5 runs in the background: we answer the HTTP request immediately and
  // the propagation continues to stream over the WebSocket. `void` documents
  // that not awaiting this is deliberate.
  void simulatePropagation(alertId);

  return alert;
}

// ---------------------------------------------------------------------------
//  STEP 5 - the simulated radio propagation
// ---------------------------------------------------------------------------
/**
 * Replays a plausible timeline in real time, one event at a time, so the
 * emergency page shows a rescue unfolding instead of a finished table.
 *
 * Requirement #1: this is a WEB simulator. No radio is transmitted anywhere -
 * every "hop" below is a document written to mesh_events plus a WebSocket frame.
 */
async function simulatePropagation(alertId) {
  const alerts = collections.alerts();
  const alert = await alerts.findOne({ alertId });
  if (!alert) return;

  const t0 = Date.now();
  const elapsed = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const push = async (event, text, extra = {}) => {
    const entry = { t: elapsed(), event, text, ...extra };
    await alerts.updateOne({ alertId }, { $push: { timeline: entry } });
    broadcastToAlert(alertId, { type: 'TIMELINE', entry });
  };

  try {
    await wait(600);
    await push('GATEWAY_TX', 'הקריאה נשלחה לשערי ה-LoRa באזור (433MHz)');

    for (const candidate of alert.candidates) {
      await wait(400 + Math.random() * 700);   // radios do not answer in lockstep

      if (candidate.channel === 'NONE') {
        await collections.meshEvents().insertOne({
          alertId, channel: 'NONE', responderId: candidate.responderId,
          status: 'UNREACHABLE', at: new Date(),
        });
        await push('UNREACHABLE',
          `${candidate.name} ללא קליטה סלולרית וללא מכשיר LoRa - לא ניתן ליצור קשר`,
          { responderId: candidate.responderId });
        await alerts.updateOne(
          { alertId, 'candidates.responderId': candidate.responderId },
          { $set: { 'candidates.$.status': 'UNREACHABLE' } },
        );
        continue;
      }

      const isLora = candidate.channel === 'LORA';

      await collections.meshEvents().insertOne({
        alertId,
        channel: candidate.channel,
        responderId: candidate.responderId,
        loraId: candidate.loraId,
        hop: isLora ? (candidate.hops ?? 1) : null,
        rssi: isLora ? candidate.rssi : null,
        status: 'DELIVERED',
        at: new Date(),
      });

      await push('NOTIFIED',
        isLora
          ? `${candidate.name} קיבל/ה התראה ברשת ה-LoRa (${candidate.hops ?? 1} קפיצות, ${candidate.rssi ?? '-'}dBm)`
          : `${candidate.name} קיבל/ה SMS עם המיקום ומספר הטלפון של הנפגע`,
        { responderId: candidate.responderId, channel: candidate.channel });

      await alerts.updateOne(
        { alertId, 'candidates.responderId': candidate.responderId },
        { $set: { 'candidates.$.status': 'NOTIFIED' } },
      );
    }

    // The selected responder confirms and starts riding.
    if (alert.primaryResponderId) {
      await wait(900);
      const primary = alert.candidates.find((c) => c.responderId === alert.primaryResponderId);
      await alerts.updateOne(
        { alertId, 'candidates.responderId': alert.primaryResponderId },
        { $set: { 'candidates.$.status': 'EN_ROUTE', 'candidates.$.ack': true } },
      );
      await alerts.updateOne({ alertId }, { $set: { status: 'EN_ROUTE' } });
      await push('ACK',
        `${primary?.name ?? 'מתנדב'} אישר/ה יציאה - ניווט במסלולי אופניים, ${Math.round((alert.route?.distanceM ?? 0))} מ' / כ-${Math.round((alert.route?.durationSec ?? 0) / 60)} דק'`,
        { responderId: alert.primaryResponderId });
      broadcastToAlert(alertId, { type: 'ROUTE', route: alert.route, responderId: alert.primaryResponderId });
    } else {
      await alerts.updateOne({ alertId }, { $set: { status: 'NO_RESPONDER' } });
      await push('NO_RESPONDER', 'לא נמצא מתנדב זמין ברדיוס שהוגדר - נסו להגדיל את הרדיוס');
    }

    broadcastToAlert(alertId, { type: 'DONE' });
  } catch (err) {
    console.error('[mesh] propagation failed:', err);
    broadcastToAlert(alertId, { type: 'ERROR', message: 'שגיאה בסימולציית ההפצה' });
  }
}

export async function getAlert(alertId) {
  return collections.alerts().findOne({ alertId }, { projection: { _id: 0 } });
}

export async function listAlerts(limit = 20) {
  return collections.alerts()
    .find({}, { projection: { _id: 0, alertId: 1, createdAt: 1, status: 1, origin: 1, stats: 1, victim: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
