// ============================================================================
//  How recently must a device have transmitted to count as "there"?
// ============================================================================
//  ONE definition, imported by everything that cares. The dispatch engine and
//  the map must agree: a device the map draws as present must be a device the
//  dispatcher is willing to send, and vice versa. Two separate thresholds
//  would eventually drift and produce a map that lies.
//
//  A LoRa node reports every few minutes; a phone reports when the app is open.
//  Three hours is generous enough to survive a dead spot on a trail, and short
//  enough that a position is still worth acting on.
// ============================================================================

export const MAX_HEARTBEAT_AGE_MIN = Number(process.env.MAX_HEARTBEAT_AGE_MIN || 180);

/** The oldest timestamp that still counts as "transmitting", as a Date. */
export function freshnessCutoff() {
  return new Date(Date.now() - MAX_HEARTBEAT_AGE_MIN * 60 * 1000);
}
