import { useCallback, useEffect, useRef, useState } from "react";
import type { Alert, Filters } from "../types";
import { playChime } from "../lib/chime";

type Perm = NotificationPermission | "unsupported";

/** Fire a browser notification (and optional chime) when a NEW qualifying inbound alert appears. */
export function useNotifications(alerts: Alert[], filters: Filters, enabled: boolean, sound = false) {
  const [perm, setPerm] = useState<Perm>(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  // Remember which alerts we've already notified about (by hex) to avoid spamming.
  const seen = useRef<Set<string>>(new Set());

  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p);
  }, []);

  const qualifies = useCallback(
    (a: Alert) => {
      const label = a.type_label.toUpperCase();
      const isA380 = label.includes("A380");
      const is747 = label.includes("747");
      if (isA380 && filters.alertOnA380) return true;
      if (is747 && filters.alertOn747) return true;
      if (!isA380 && !is747 && filters.alertOnHeavies) return true;
      return false;
    },
    [filters],
  );

  useEffect(() => {
    const canNotify = enabled && perm === "granted";
    if (!canNotify && !sound) {
      // Still track seen so re-enabling doesn't replay the backlog.
      alerts.forEach((a) => seen.current.add(a.hex));
      return;
    }
    let chimed = false;
    for (const a of alerts) {
      if (seen.current.has(a.hex)) continue;
      seen.current.add(a.hex);
      if (!qualifies(a)) continue;
      if (sound && !chimed) {
        playChime("inbound");
        chimed = true; // one chime per batch, not per aircraft
      }
      if (!canNotify) continue;
      try {
        new Notification("✈️ Heavy inbound to LAX", {
          body: a.message,
          tag: a.hex,
        });
      } catch {
        /* notifications may be blocked at the OS level */
      }
    }
    // Forget aircraft that are no longer inbound so they can re-alert later.
    const live = new Set(alerts.map((a) => a.hex));
    for (const hex of [...seen.current]) if (!live.has(hex)) seen.current.delete(hex);
  }, [alerts, enabled, perm, qualifies, sound]);

  return { perm, request };
}
