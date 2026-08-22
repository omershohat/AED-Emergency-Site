// ============================================================================
//  The HTTP client for both servers, and the silent-refresh logic.
// ============================================================================
//  WHERE THE ACCESS TOKEN LIVES:
//  in this module's memory - a plain variable. Not in localStorage and not in
//  sessionStorage, because any injected script on the page can read those. A
//  module variable dies when the tab is closed or reloaded, and the admin is
//  signed back in silently from the httpOnly refresh cookie, which JavaScript
//  cannot read at all.
// ============================================================================
import { API_URL, MESH_URL } from './config.js';

let accessToken = null;

export function setAccessToken(token) { accessToken = token; }
export function getAccessToken() { return accessToken; }

/** An error that carries the server's status and its field-level messages. */
export class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields || null;
  }
}

// ---------------------------------------------------------------------------
//  Silent refresh
// ---------------------------------------------------------------------------
//  If three requests fail with TOKEN_EXPIRED at the same moment, we must not
//  fire three refreshes - the second and third would arrive with a token the
//  first one already rotated away, and the server would read that as a replay
//  and log the admin out. So the in-flight refresh is shared: whoever asks
//  while one is running waits for the same promise.
// ---------------------------------------------------------------------------
let refreshInFlight = null;

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',      // required for the httpOnly cookie to travel
        });
        if (!res.ok) return null;
        const data = await res.json();
        setAccessToken(data.accessToken);
        return data;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;        // let the next failure start a fresh one
      }
    })();
  }
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
//  The single request function every call in the app goes through
// ---------------------------------------------------------------------------
async function request(baseUrl, path, { method = 'GET', body, auth = false, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  // Credentials (the refresh cookie) are sent ONLY to the identity service.
  // Sending them to the mesh service would be worse than pointless: a
  // credentialed cross-origin request is blocked by the browser unless the
  // server answers with Access-Control-Allow-Credentials, and the mesh service
  // has no cookies to receive, so it correctly does not set that header.
  const credentials = baseUrl === API_URL ? 'include' : 'same-origin';

  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials,
    });
  } catch {
    // fetch only rejects on a NETWORK failure - a 404 or 500 is a resolved
    // promise. So reaching this branch means the server is genuinely unreachable.
    throw new ApiError('לא ניתן להתחבר לשרת. ודאו שהשרתים פועלים.', { status: 0 });
  }

  // 204 No Content has no body to parse.
  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.ok) return data;

  // The access token expired mid-session: renew once, then replay the request.
  // `retry` guards against an infinite loop if the refresh itself keeps failing.
  if (res.status === 401 && auth && retry && (data?.code === 'TOKEN_EXPIRED' || data?.code === 'NO_TOKEN')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request(baseUrl, path, { method, body, auth, retry: false });
  }

  throw new ApiError(data?.error || `שגיאה ${res.status}`, {
    status: res.status,
    code: data?.code,
    fields: data?.fields,
  });
}

// ---------------------------------------------------------------------------
//  api service (:4000) - identity, registration, content
// ---------------------------------------------------------------------------
export const api = {
  // --- auth ---
  login: (username, password) =>
    request(API_URL, '/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request(API_URL, '/auth/logout', { method: 'POST' }),
  refresh: () => refreshAccessToken(),
  me: () => request(API_URL, '/auth/me', { auth: true }),

  // --- public ---
  register: (payload) => request(API_URL, '/responders', { method: 'POST', body: payload }),
  phoneTaken: (phone) => request(API_URL, `/responders/phone-taken?phone=${encodeURIComponent(phone)}`),
  stats: () => request(API_URL, '/responders/stats'),
  content: (pageKey) => request(API_URL, `/content/${pageKey}`),
  links: (category) => request(API_URL, `/content/links/${category}`),

  // --- admin (every one of these carries the Bearer token) ---
  adminResponders: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined),
    ).toString();
    return request(API_URL, `/admin/responders?${qs}`, { auth: true });
  },
  updateResponder: (id, patch) =>
    request(API_URL, `/admin/responders/${id}`, { method: 'PATCH', body: patch, auth: true }),
  deleteResponder: (id) =>
    request(API_URL, `/admin/responders/${id}`, { method: 'DELETE', auth: true }),
  saveContent: (pageKey, sectionKey, block) =>
    request(API_URL, `/admin/content/${pageKey}/${sectionKey}`, { method: 'PUT', body: block, auth: true }),
  // The admin listing, unlike the public one, includes deactivated links and
  // the sort order - everything the maintenance screen can edit.
  adminLinks: (category) =>
    request(API_URL, `/admin/links?category=${encodeURIComponent(category || '')}`, { auth: true }),
  createLink: (link) => request(API_URL, '/admin/links', { method: 'POST', body: link, auth: true }),
  updateLink: (id, patch) =>
    request(API_URL, `/admin/links/${id}`, { method: 'PATCH', body: patch, auth: true }),
  deleteLink: (id) => request(API_URL, `/admin/links/${id}`, { method: 'DELETE', auth: true }),
};

// ---------------------------------------------------------------------------
//  mesh service (:5000) - telemetry, alerts, routing
// ---------------------------------------------------------------------------
export const mesh = {
  latestTelemetry: () => request(MESH_URL, '/telemetry/latest'),
  createAlert: (payload) => request(MESH_URL, '/alerts', { method: 'POST', body: payload }),
  getAlert: (alertId) => request(MESH_URL, `/alerts/${alertId}`),
  listAlerts: (limit = 20) => request(MESH_URL, `/alerts?limit=${limit}`),
  alertEvents: (alertId) => request(MESH_URL, `/alerts/${alertId}/events`),
  maintenanceAlerts: () => request(MESH_URL, '/maintenance/alerts'),
  reconcileMaintenance: () => request(MESH_URL, '/maintenance/reconcile', { method: 'POST' }),
  telemetryHealth: () => request(MESH_URL, '/maintenance/telemetry-health'),
  refreshTelemetry: () => request(MESH_URL, '/maintenance/refresh-telemetry', { method: 'POST' }),
  route: (from, to) =>
    request(MESH_URL, `/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`),
};

