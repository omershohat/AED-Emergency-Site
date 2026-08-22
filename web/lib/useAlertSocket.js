'use client';
// ============================================================================
//  useAlertSocket - the live channel behind the emergency page
// ============================================================================
//  A custom hook, so the WebSocket lifecycle (open, subscribe, receive, close)
//  lives in one place and the page component stays about rendering.
//
//  The rule that makes this correct: whatever the effect opens, the effect's
//  cleanup function must close. Without that, navigating away would leave the
//  socket open and every visit would add another one.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { MESH_WS } from './config.js';

export function useAlertSocket(alertId, { onRoute } = {}) {
  const [connected, setConnected] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [finished, setFinished] = useState(false);

  // A ref, not state: changing it must not trigger a re-render, and the value
  // has to survive between renders.
  const socketRef = useRef(null);
  // Keeping the callback in a ref lets the effect depend only on alertId - so a
  // parent re-render does not tear down and rebuild the socket.
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;

  useEffect(() => {
    if (!alertId) return undefined;

    setTimeline([]);
    setFinished(false);

    const socket = new WebSocket(MESH_WS);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      // Tell the server which alert this browser wants to hear about, so it
      // does not receive events belonging to other calls.
      socket.send(JSON.stringify({ type: 'SUBSCRIBE', alertId }));
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;                            // ignore anything that is not JSON
      }

      if (msg.type === 'TIMELINE' && msg.entry) {
        // Append immutably: React compares by reference, so mutating the old
        // array with push() would not re-render the list.
        setTimeline((prev) => [...prev, msg.entry]);
      } else if (msg.type === 'ROUTE') {
        onRouteRef.current?.(msg.route, msg.responderId);
      } else if (msg.type === 'DONE') {
        setFinished(true);
      }
    };

    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);

    // Cleanup: runs when alertId changes or the page unmounts.
    return () => {
      socket.onclose = null;               // avoid a setState after unmount
      socket.close();
      socketRef.current = null;
    };
  }, [alertId]);

  return { connected, timeline, finished };
}
