import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types";
import { wsUrl } from "../api";

export type ConnState = "connecting" | "open" | "closed";

/** Subscribe to the live snapshot WebSocket with auto-reconnect + backoff. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let closedByUs = false;

    const connect = () => {
      setConn("connecting");
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConn("open");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as Snapshot;
          if (data.type === "snapshot") setSnapshot(data);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConn("closed");
        if (closedByUs) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByUs = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { snapshot, conn };
}
