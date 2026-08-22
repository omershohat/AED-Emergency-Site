// ============================================================================
//  Bicycle routing   (Requirement #10 - "routed for bicycle paths, not
//  straight air-lines")
// ============================================================================
//  A straight line between the responder and the victim is useless: it crosses
//  the river, the highway and the fence. We ask a real routing engine for a
//  path a bicycle can actually ride.
//
//  Engine: BRouter (brouter.de) with the "trekking" profile, which prefers
//  cycle paths and quiet roads. It is free, needs no API key, and returns
//  GeoJSON - which is exactly what Leaflet draws.
//
//  This runs on the SERVER, not in the browser, for three reasons:
//    1. no CORS problem,
//    2. the fallback logic lives in one place,
//    3. the client cannot be blamed if the external service is slow.
// ============================================================================

const BROUTER_URL = process.env.BROUTER_URL || 'https://brouter.de/brouter';
const TIMEOUT_MS = Number(process.env.ROUTING_TIMEOUT_MS || 6000);

/** Average cycling speed used to convert metres into an ETA, in m/s (~18 km/h). */
const BIKE_SPEED_MS = 5;

/**
 * @param {{lat:number,lng:number}} from  the responder
 * @param {{lat:number,lng:number}} to    the victim
 * @returns {Promise<{coordinates:[number,number][], distanceM:number, durationSec:number, engine:string, fallback:boolean}>}
 */
export async function getBikeRoute(from, to) {
  try {
    // BRouter wants lon,lat pairs separated by "|" - note the order: LON first.
    const lonlats = `${from.lng},${from.lat}|${to.lng},${to.lat}`;
    const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=trekking&alternativeidx=0&format=geojson`;

    // AbortController is how fetch gets a timeout - it has no timeout option of
    // its own. Without this, a hanging external service would hang our dispatch.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`BRouter responded ${response.status}`);

    const geo = await response.json();
    const feature = geo?.features?.[0];
    if (!feature?.geometry?.coordinates?.length) throw new Error('BRouter returned no geometry');

    // BRouter reports its numbers as strings inside feature.properties.
    const distanceM = Number(feature.properties?.['track-length']) || null;
    const durationSec = Number(feature.properties?.['total-time']) || null;

    return {
      coordinates: feature.geometry.coordinates,      // [[lng,lat], ...]
      distanceM: distanceM ?? straightLineMetres(from, to),
      durationSec: durationSec ?? Math.round(straightLineMetres(from, to) / BIKE_SPEED_MS),
      engine: 'brouter/trekking',
      fallback: false,
    };
  } catch (err) {
    // The demo must never die because an external website is down. We return a
    // straight line and mark it fallback:true, and the UI shows it dashed with
    // a visible warning - an honest degradation, not a silent lie.
    console.warn('[mesh] routing fallback:', err.message);
    const distanceM = straightLineMetres(from, to);
    return {
      coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
      distanceM,
      durationSec: Math.round(distanceM / BIKE_SPEED_MS),
      engine: 'straight-line',
      fallback: true,
    };
  }
}

/**
 * Haversine distance in metres - the great-circle distance between two points
 * on a sphere. Used for the fallback and for sanity-checking Mongo's numbers.
 */
export function straightLineMetres(a, b) {
  const R = 6371000;                       // Earth radius in metres
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
