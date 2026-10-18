import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { atcCaptionsWsUrl } from "../api";
import { findFeed } from "../lib/atcFeeds";
import type { CaptionEngineState, CaptionLine, CaptionStatus, CaptionStreamState } from "../types";

export interface FeedCaptionState {
  mount: string;
  stream: CaptionStreamState | "socket"; // "socket" = we haven't heard from the server yet
  engine: CaptionEngineState;
  model?: string;
  detail?: string | null;
  backlog: number;
  lineCount: number;
}

const MAX_LINES = 400;

/**
 * Live captions for whatever ATC feeds are currently playing.
 *
 * One WebSocket per playing mount (/ws/atc/{mount}); the backend pulls its own copy of
 * the LiveATC stream and runs Whisper on it, so this hook only has to collect lines.
 * Lives at App level (like the audio) so captions keep accumulating while the user is on
 * another tab. Lines survive a feed being stopped - they're cleared only by the user.
 */
export function useAtcTranscript(mounts: string[], enabled = true) {
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [feeds, setFeeds] = useState<Record<string, FeedCaptionState>>({});
  const socketsRef = useRef<Map<string, { ws: WebSocket; timer: number | null; attempt: number; closed: boolean }>>(
    new Map(),
  );
  const seenIdsRef = useRef<Set<number>>(new Set());

  const key = mounts.slice().sort().join("|");

  const addLines = useCallback((incoming: CaptionLine[]) => {
    const fresh = incoming.filter((l) => !seenIdsRef.current.has(l.id));
    if (fresh.length === 0) return;
    for (const l of fresh) seenIdsRef.current.add(l.id);
    setLines((prev) => {
      const next = [...prev, ...fresh].sort((a, b) => a.t - b.t || a.id - b.id);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const patchFeed = useCallback((mount: string, patch: Partial<FeedCaptionState>) => {
    setFeeds((prev) => {
      const base: FeedCaptionState = prev[mount] ?? { mount, stream: "socket", engine: "idle", backlog: 0, lineCount: 0 };
      return { ...prev, [mount]: { ...base, ...patch } };
    });
  }, []);

  useEffect(() => {
    const wanted = new Set(enabled ? key.split("|").filter(Boolean) : []);
    const sockets = socketsRef.current;

    // Close sockets for feeds that stopped playing.
    for (const [mount, entry] of Array.from(sockets.entries())) {
      if (!wanted.has(mount)) {
        entry.closed = true;
        if (entry.timer) window.clearTimeout(entry.timer);
        entry.ws.close();
        sockets.delete(mount);
        patchFeed(mount, { stream: "stopped" });
      }
    }

    function open(mount: string, attempt: number) {
      const hit = findFeed(mount);
      const hint = hit ? `${hit.airport.name} ${hit.feed.name}` : undefined;
      const ws = new WebSocket(atcCaptionsWsUrl(mount, hint));
      const entry = { ws, timer: null as number | null, attempt, closed: false };
      sockets.set(mount, entry);
      patchFeed(mount, { stream: "socket" });

      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        const m = msg as { type?: string };
        if (m.type === "atc_status") {
          const s = msg as CaptionStatus;
          patchFeed(mount, {
            stream: s.stream,
            engine: s.engine,
            model: s.model,
            detail: s.detail ?? null,
            backlog: s.backlog ?? 0,
          });
          entry.attempt = 0;
        } else if (m.type === "atc_line") {
          const line = (msg as { line: CaptionLine }).line;
          addLines([line]);
          setFeeds((prev) => {
            const cur = prev[mount];
            return cur ? { ...prev, [mount]: { ...cur, lineCount: cur.lineCount + 1 } } : prev;
          });
        } else if (m.type === "atc_lines") {
          addLines((msg as { lines: CaptionLine[] }).lines);
        }
      };
      ws.onclose = () => {
        if (entry.closed || sockets.get(mount) !== entry) return;
        // Server went away (reload in dev, network blip): reconnect with backoff.
        const delay = Math.min(10000, 1000 * 2 ** Math.min(entry.attempt, 4));
        patchFeed(mount, { stream: "socket" });
        entry.timer = window.setTimeout(() => {
          if (sockets.get(mount) === entry) open(mount, entry.attempt + 1);
        }, delay);
      };
      ws.onerror = () => {
        // onclose follows; nothing to do here.
      };
    }

    for (const mount of wanted) {
      if (!sockets.has(mount)) open(mount, 0);
    }
  }, [key, enabled, addLines, patchFeed]);

  // Tear down on unmount.
  useEffect(() => {
    const sockets = socketsRef.current;
    return () => {
      for (const entry of sockets.values()) {
        entry.closed = true;
        if (entry.timer) window.clearTimeout(entry.timer);
        entry.ws.close();
      }
      sockets.clear();
    };
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    seenIdsRef.current.clear();
    setFeeds((prev) => {
      const next: Record<string, FeedCaptionState> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, lineCount: 0 };
      return next;
    });
  }, []);

  const active = useMemo(() => mounts.map((m) => feeds[m]).filter(Boolean) as FeedCaptionState[], [mounts, feeds]);

  return { lines, feeds: active, clear };
}
