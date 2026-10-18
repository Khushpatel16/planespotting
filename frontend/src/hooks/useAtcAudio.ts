import { useCallback, useEffect, useRef, useState } from "react";
import { streamUrl } from "../lib/atcFeeds";

export type PlayerStatus = "connecting" | "playing" | "error";

export interface AtcPlayer {
  mount: string;
  status: PlayerStatus;
  volume: number; // 0..1
  error?: string;
}

const VOL_KEY = "hwl.atc.volumes";

function loadVolumes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOL_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Owns the <audio> elements for live ATC feeds. Lives at App level so streams keep playing
 * while the user switches tabs or airports; several feeds can play at once (e.g. both LAX
 * tower frequencies), each with its own volume.
 */
export function useAtcAudio() {
  const elsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const volumesRef = useRef<Record<string, number>>(loadVolumes());
  const [players, setPlayers] = useState<AtcPlayer[]>([]);

  const update = useCallback((mount: string, patch: Partial<AtcPlayer>) => {
    setPlayers((ps) => ps.map((p) => (p.mount === mount ? { ...p, ...patch } : p)));
  }, []);

  const stop = useCallback((mount: string) => {
    const el = elsRef.current.get(mount);
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load(); // drop the live connection
      elsRef.current.delete(mount);
    }
    setPlayers((ps) => ps.filter((p) => p.mount !== mount));
  }, []);

  const play = useCallback(
    (mount: string) => {
      if (elsRef.current.has(mount)) return;
      const el = new Audio();
      el.preload = "none";
      el.volume = volumesRef.current[mount] ?? 0.9;
      el.addEventListener("playing", () => update(mount, { status: "playing", error: undefined }));
      el.addEventListener("waiting", () => update(mount, { status: "connecting" }));
      el.addEventListener("stalled", () => update(mount, { status: "connecting" }));
      el.addEventListener("error", () => {
        const code = el.error?.code;
        update(mount, {
          status: "error",
          error:
            code === 4
              ? "Feed offline or blocked (try LiveATC's player)"
              : code === 2
                ? "Network error - stream dropped"
                : "Playback error",
        });
      });
      // Cache-bust so a reconnect never resumes a stale buffered chunk.
      el.src = `${streamUrl(mount)}?nocache=${Date.now()}`;
      elsRef.current.set(mount, el);
      setPlayers((ps) => [...ps, { mount, status: "connecting", volume: el.volume }]);
      el.play().catch((e: unknown) => {
        update(mount, {
          status: "error",
          error: e instanceof Error && e.name === "NotAllowedError" ? "Tap play again to allow audio" : "Could not start stream",
        });
      });
    },
    [update],
  );

  const toggle = useCallback(
    (mount: string) => {
      if (elsRef.current.has(mount)) stop(mount);
      else play(mount);
    },
    [play, stop],
  );

  const stopAll = useCallback(() => {
    for (const mount of Array.from(elsRef.current.keys())) stop(mount);
  }, [stop]);

  const setVolume = useCallback(
    (mount: string, volume: number) => {
      const v = Math.min(1, Math.max(0, volume));
      volumesRef.current[mount] = v;
      try {
        localStorage.setItem(VOL_KEY, JSON.stringify(volumesRef.current));
      } catch {
        /* ignore */
      }
      const el = elsRef.current.get(mount);
      if (el) el.volume = v;
      update(mount, { volume: v });
    },
    [update],
  );

  const retry = useCallback(
    (mount: string) => {
      stop(mount);
      play(mount);
    },
    [play, stop],
  );

  // Tear everything down on unmount (full page navigation).
  useEffect(() => {
    const els = elsRef.current;
    return () => {
      for (const el of els.values()) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      els.clear();
    };
  }, []);

  const isPlaying = useCallback((mount: string) => elsRef.current.has(mount), []);

  return { players, play, stop, toggle, stopAll, setVolume, retry, isPlaying };
}
