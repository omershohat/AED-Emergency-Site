// ============================================================================
//  Formatting helpers for Requirement #1's device-health fields.
// ============================================================================
//  Two independent readings travel with every telemetry heartbeat:
//    batteryLevel  - 0-100%, the radio/phone's own battery
//    isOperational - whether the DEFIBRILLATOR itself passed its self-test
//                    (null when the responder does not carry one - the field
//                    does not apply, and must not be drawn as "broken")
//
//  Kept in one file because the simulator map, the emergency map and the
//  emergency roster all need to render the same two fields identically -
//  a battery icon that means something different on each page would be its
//  own bug.
// ============================================================================

/**
 * Must match LOW_BATTERY_THRESHOLD in mesh/lib/maintenance.js. The server is the
 * authority - it sends a `lowBattery` boolean and the UI prefers that - but the
 * constant is needed for styling values the server has already flagged.
 */
export const LOW_BATTERY_THRESHOLD = 20;

export function isLowBattery(level) {
  return typeof level === 'number' && level < LOW_BATTERY_THRESHOLD;
}

/** A dying battery is exactly the case worth calling out, not averaging away. */
export function batteryIcon(level) {
  if (level == null) return '🔋';
  return isLowBattery(level) ? '🪫' : '🔋';
}

/** Tailwind classes for a battery reading: red below the maintenance threshold. */
export function batteryClass(level) {
  if (level == null) return 'text-slate-400';
  return isLowBattery(level) ? 'text-emergency font-semibold' : 'text-slate-600';
}

export function batteryLabel(level) {
  if (level == null) return 'לא דווח';
  return `${level}%`;
}

/**
 * @param {boolean|null} isOperational
 * @returns {{ text: string, className: string } | null}   null = not applicable (no AED)
 */
export function operationalStatus(isOperational) {
  if (isOperational === null || isOperational === undefined) return null;
  return isOperational
    ? { text: 'תקין', className: 'bg-green-100 text-green-800' }
    : { text: 'לא תקין', className: 'bg-emergency-light text-emergency' };
}

/**
 * "When did this device last transmit?" in Hebrew, scaled to the age.
 *
 * Minutes are useful for a live rescue; a device silent for three days should
 * not be reported as "לפני 4320 דק׳", which nobody can read at a glance.
 *
 * @param {number|null} minutes  null = has never transmitted at all
 */
export function formatLastSeen(minutes) {
  if (minutes === null || minutes === undefined) return 'מעולם לא שידר';
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;

  // FLOOR, not round. Elapsed time reads as "at least this long ago", and
  // rounding breaks the freshness boundary: with Math.round, 179 minutes and
  // 181 minutes both render "לפני 3 שע׳" while sitting on opposite sides of the
  // 180-minute threshold - so two rows show identical text but only one is
  // tagged שקט. Flooring gives 2 and 3 hours, and the display stops contradicting
  // the badge next to it.
  const hours = Math.floor(minutes / 60);
  // Hebrew inflects for one vs. many - "לפני 1 שע׳" reads as broken text.
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שע׳`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'לפני יום' : `לפני ${days} ימים`;
}

/** One HTML line for a Leaflet popup - used identically on both maps. */
export function deviceHealthPopupLine(batteryLevel, isOperational) {
  const battery = `${batteryIcon(batteryLevel)} סוללה: ${batteryLabel(batteryLevel)}`;
  const op = operationalStatus(isOperational);
  return op ? `${battery} · דפיברילטור: ${op.text}` : battery;
}
