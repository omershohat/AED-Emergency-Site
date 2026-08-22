// ============================================================================
//  WebSocket hub - the live channel behind the emergency page (Requirement #5)
// ============================================================================
//  WHY WEBSOCKET AND NOT setInterval + fetch:
//  In a rescue the server is the side that knows when something happened - a
//  new hop, an acknowledgement, a responder on the way. With HTTP the browser
//  can only ask repeatedly and hope it asked at the right moment. A WebSocket
//  is one connection, kept open, over which the SERVER can push the moment an
//  event exists. That is exactly the "next-generation bidirectional
//  communication" the course describes.
//
//  We use the `ws` package - the same library used in the lecture - and attach
//  it to the HTTP server Express already created, so both share port 5000.
// ============================================================================
import { WebSocketServer } from 'ws';

let wss = null;

export function initRealtime(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket, req) => {
    // Each socket carries its own state: which alert it wants to hear about.
    socket.subscribedAlertId = null;
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    console.log('[mesh] websocket client connected from', req.socket.remoteAddress);
    send(socket, { type: 'WELCOME', message: 'מחובר לערוץ החירום' });

    socket.on('message', (raw) => {
      // Everything arriving from a socket is untrusted text - parse defensively.
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'ERROR', message: 'הודעה לא תקינה' });
      }

      if (msg.type === 'SUBSCRIBE' && typeof msg.alertId === 'string') {
        socket.subscribedAlertId = msg.alertId;
        send(socket, { type: 'SUBSCRIBED', alertId: msg.alertId });
      } else if (msg.type === 'PING') {
        send(socket, { type: 'PONG', t: Date.now() });
      }
    });

    socket.on('close', () => console.log('[mesh] websocket client disconnected'));
  });

  // A browser that is closed abruptly (laptop lid, tunnel) leaves a socket that
  // looks open. Every 30s we ping; a socket that did not pong is terminated,
  // otherwise dead sockets would accumulate for the life of the process.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

/**
 * Push an event to everyone watching one alert.
 * Sockets that subscribed to a different alert are skipped, so ten open
 * dashboards do not each receive the other nine alerts.
 */
export function broadcastToAlert(alertId, payload) {
  if (!wss) return;
  const frame = JSON.stringify({ ...payload, alertId, at: new Date().toISOString() });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && socket.subscribedAlertId === alertId) {
      socket.send(frame);
    }
  }
}

/** Push to every connected client, used for "a new alert exists" banners. */
export function broadcastGlobal(payload) {
  if (!wss) return;
  const frame = JSON.stringify({ ...payload, at: new Date().toISOString() });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN) socket.send(frame);
  }
}
