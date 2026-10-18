import { useEffect, useRef, useState } from "react";
import type { WideSnapshot } from "../types";
import { api } from "../api";

export type WideState = "off" | "loading" | "ok" | "waiting" | "error";

/**
 * Poll the North-America-wide layer. The backend sweeps the continent slowly (~2 min per
 * pass) so polling every ~20 s is plenty; filters are applied server-side to keep the
 * payload small. Returns null while disabled or before the first sweep has data.
 */
export function useWide(
  enabled: boolean,
  params: { country?: string; state?: string; traffic?: string },
  intervalMs = 20000,
) {
  const [wide, setWide] = useState<WideSnapshot | null>(null);
  const [state, setState] = useState<WideState>(enabled ? "loading" : "off");
  const key = `${params.country ?? ""}|${params.state ?? ""}|${params.traffic ?? ""}`;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (!enabled) {
      setWide(null);
      setState("off");
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let ctrl: AbortController | null = null;

    const tick = async () => {
      ctrl = new AbortController();
      try {
        const snap = await api.getWide(paramsRef.current, ctrl.signal);
        if (cancelled) return;
        setWide(snap);
        setState("ok");
      } catch (e) {
        if (cancelled) return;
        // 503 = sweep hasn't produced data yet; anything else is a real error.
        setState(String(e).includes("503") ? "waiting" : "error");
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, intervalMs);
      }
    };
    setState((s) => (s === "ok" ? s : "loading"));
    tick();

    return () => {
      cancelled = true;
      ctrl?.abort();
      if (timer) window.clearTimeout(timer);
    };
    // Re-fetch immediately when the server-side filter params change.
  }, [enabled, key, intervalMs]);

  return { wide, wideState: state };
}
