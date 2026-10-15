import { useCallback, useEffect, useRef, useState } from "react";

export type OrientPerm = "unsupported" | "prompt" | "granted" | "denied";

// iOS exposes a fused true-north compass heading on the event; Android needs alpha.
interface IOSOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface RequestableDOE {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** Shortest-arc exponential smoothing for a circular angle (degrees). */
function smoothAngle(prev: number | null, next: number, k: number): number {
  if (prev === null) return next;
  const d = ((next - prev + 540) % 360) - 180;
  return (prev + d * k + 360) % 360;
}

/**
 * Live device heading (deg true, 0=N) + pitch (deg above horizon when the phone is held
 * upright in portrait, camera facing the sky). Values are exposed via refs because the
 * consumer reads them at animation rate. iOS requires an explicit permission gesture:
 * call `start()` from a click/tap handler.
 */
export function useDeviceOrientation() {
  const [perm, setPerm] = useState<OrientPerm>(() => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined")
      return "unsupported";
    const doe = DeviceOrientationEvent as unknown as RequestableDOE;
    return typeof doe.requestPermission === "function" ? "prompt" : "granted";
  });
  const headingRef = useRef<number | null>(null);
  const pitchRef = useRef<number | null>(null);
  const hasCompassRef = useRef(false);
  const listeningRef = useRef(false);

  const handler = useCallback((e: DeviceOrientationEvent) => {
    const iosHeading = (e as IOSOrientationEvent).webkitCompassHeading;
    let h: number | null = null;
    if (typeof iosHeading === "number" && !Number.isNaN(iosHeading)) {
      h = iosHeading; // already degrees clockwise from true north
      hasCompassRef.current = true;
    } else if (e.alpha !== null) {
      h = (360 - e.alpha) % 360; // device yaw -> compass-style heading
      if (e.absolute) hasCompassRef.current = true;
    }
    if (h !== null) headingRef.current = smoothAngle(headingRef.current, h, 0.25);

    if (e.beta !== null) {
      // Portrait, screen toward the user: beta 90 = camera at the horizon.
      const p = Math.max(-30, Math.min(89, e.beta - 90));
      pitchRef.current = pitchRef.current === null ? p : pitchRef.current + (p - pitchRef.current) * 0.25;
    }
  }, []);

  const attach = useCallback(() => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    // Chrome/Android fires the "absolute" variant; iOS only the plain one.
    window.addEventListener("deviceorientationabsolute", handler as EventListener, true);
    window.addEventListener("deviceorientation", handler, true);
  }, [handler]);

  const start = useCallback(async () => {
    if (perm === "unsupported") return;
    const doe = DeviceOrientationEvent as unknown as RequestableDOE;
    if (typeof doe.requestPermission === "function") {
      try {
        const res = await doe.requestPermission();
        setPerm(res === "granted" ? "granted" : "denied");
        if (res === "granted") attach();
      } catch {
        setPerm("denied");
      }
    } else {
      attach();
    }
  }, [perm, attach]);

  // Android / desktop: no permission needed, attach immediately.
  useEffect(() => {
    if (perm === "granted") attach();
    return () => {
      if (listeningRef.current) {
        window.removeEventListener("deviceorientationabsolute", handler as EventListener, true);
        window.removeEventListener("deviceorientation", handler, true);
        listeningRef.current = false;
      }
    };
  }, [perm, attach, handler]);

  return { perm, start, headingRef, pitchRef, hasCompassRef };
}
