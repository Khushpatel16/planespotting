import { useEffect, useMemo, useRef, useState } from "react";
import type { Aircraft } from "../types";
import { categoryColor, fmtAlt, fmtDist, fmtEta, fmtSpeed } from "../lib/format";
import {
  FT_TO_M,
  NM_TO_M,
  angleDelta,
  destinationPoint,
  haversineNm,
  initialBearing,
} from "../lib/geo";
import { useDeviceOrientation } from "../hooks/useDeviceOrientation";

interface Props {
  aircraft: Aircraft[];
  generatedAt: string | null;
  onClose: () => void;
  onShowOnMap: (hex: string) => void;
}

// Assumed camera field of view (portrait vertical). Real phone cameras vary ~50-70°;
// the drag-to-calibrate offset absorbs the difference well enough for spotting.
const V_FOV = 58;
const MAX_DIST_NM = 60; // beyond this you can't see it anyway
const MAX_MARKERS = 25;

const DEFAULT_OBS = { lat: 33.9416, lon: -118.4085, altM: 40 }; // KLAX area

interface SkyMarker {
  hex: string;
  x: number;
  y: number;
  color: string;
  isTarget: boolean;
  label: string;
  sub: string;
}

interface RibbonItem {
  hex: string;
  dAz: number;
  color: string;
  isTarget: boolean;
}

function typeShort(a: Aircraft): string {
  return a.type.family === "A380" ? "A380" : a.type.friendly_name;
}

/** Dead-reckon an aircraft forward along its track so markers don't lag the real sky. */
function reckon(a: Aircraft, ageS: number): { lat: number; lon: number } {
  const lat = a.lat as number;
  const lon = a.lon as number;
  if (
    ageS <= 0 ||
    a.track_deg === null ||
    a.ground_speed_kt === null ||
    a.ground_speed_kt < 30
  ) {
    return { lat, lon };
  }
  const nm = (a.ground_speed_kt * Math.min(ageS, 60)) / 3600;
  const [lon2, lat2] = destinationPoint(lat, lon, a.track_deg, nm);
  return { lat: lat2, lon: lon2 };
}

export default function SkyView({ aircraft, generatedAt, onClose, onShowOnMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [markers, setMarkers] = useState<SkyMarker[]>([]);
  const [ribbon, setRibbon] = useState<RibbonItem[]>([]);
  const [headingDisp, setHeadingDisp] = useState(90);
  const [usingDefaultLoc, setUsingDefaultLoc] = useState(true);

  const { perm, start, headingRef, pitchRef, hasCompassRef } = useDeviceOrientation();
  const [sensorsRequested, setSensorsRequested] = useState(false);

  const obsRef = useRef({ ...DEFAULT_OBS });
  // Manual look direction (no sensors) + calibration offsets (with sensors).
  const manualRef = useRef({ heading: 90, pitch: 12 });
  const offsetRef = useRef({ heading: 0, pitch: 0 });
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const generatedAtRef = useRef(generatedAt);
  generatedAtRef.current = generatedAt;

  // Camera preview (needs HTTPS or localhost; falls back to a virtual sky).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no mediaDevices");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamera("on");
      } catch {
        if (!cancelled) setCamera("off");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Observer position (one shot; spotters stand still).
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        obsRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          altM: pos.coords.altitude ?? DEFAULT_OBS.altM,
        };
        setUsingDefaultLoc(false);
      },
      () => setUsingDefaultLoc(true),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  // Kick off sensors on mount where no explicit permission gesture is needed (Android).
  useEffect(() => {
    if (perm === "granted" && !sensorsRequested) {
      setSensorsRequested(true);
      void start();
    }
  }, [perm, sensorsRequested, start]);

  // Drag to look around (no sensors) or fine-tune alignment (with sensors).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      // Ignore drags that start on interactive chrome (buttons, card).
      if ((e.target as HTMLElement).closest("button, .sky-card")) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      const hFov = 2 * (Math.atan(Math.tan((V_FOV * Math.PI) / 360) * (w / h)) * 180) / Math.PI;
      const dH = (-(e.clientX - lastX) / w) * hFov;
      const dP = ((e.clientY - lastY) / h) * V_FOV;
      lastX = e.clientX;
      lastY = e.clientY;
      if (headingRef.current !== null) {
        offsetRef.current.heading = Math.max(-60, Math.min(60, offsetRef.current.heading + dH));
        offsetRef.current.pitch = Math.max(-30, Math.min(30, offsetRef.current.pitch + dP));
      } else {
        manualRef.current.heading = (manualRef.current.heading + dH + 360) % 360;
        manualRef.current.pitch = Math.max(-10, Math.min(80, manualRef.current.pitch + dP));
      }
    };
    const up = () => (dragging = false);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [headingRef]);

  // Projection loop (~10 Hz): aircraft -> az/el -> screen markers + compass ribbon.
  useEffect(() => {
    const tick = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      const hFov = 2 * (Math.atan(Math.tan((V_FOV * Math.PI) / 360) * (w / h)) * 180) / Math.PI;

      const heading =
        headingRef.current !== null
          ? (headingRef.current + offsetRef.current.heading + 360) % 360
          : manualRef.current.heading;
      const pitch =
        pitchRef.current !== null
          ? pitchRef.current + offsetRef.current.pitch
          : manualRef.current.pitch;

      const obs = obsRef.current;
      const genAt = generatedAtRef.current;
      const baseAge = genAt ? Math.max(0, (Date.now() - Date.parse(genAt)) / 1000) : 0;

      const seen: { m: SkyMarker; dist: number }[] = [];
      const rib: RibbonItem[] = [];
      for (const a of aircraftRef.current) {
        if (a.on_ground || a.lat === null || a.lon === null || a.altitude_ft === null) continue;
        if (a.altitude_ft <= 0) continue;
        const pos = reckon(a, baseAge + (a.seen_seconds ?? 0));
        const distNm = haversineNm(obs.lat, obs.lon, pos.lat, pos.lon);
        if (distNm > MAX_DIST_NM) continue;
        const az = initialBearing(obs.lat, obs.lon, pos.lat, pos.lon);
        const elevDeg =
          (Math.atan2(a.altitude_ft * FT_TO_M - obs.altM, Math.max(50, distNm * NM_TO_M)) * 180) /
          Math.PI;
        const dAz = angleDelta(az, heading);
        const dEl = elevDeg - pitch;
        const color = categoryColor(a);

        if (Math.abs(dAz) <= 75) {
          rib.push({ hex: a.hex, dAz, color, isTarget: a.type.is_target });
        }
        if (Math.abs(dAz) <= hFov / 2 + 4 && Math.abs(dEl) <= V_FOV / 2 + 4) {
          seen.push({
            dist: distNm,
            m: {
              hex: a.hex,
              x: w / 2 + (dAz / (hFov / 2)) * (w / 2),
              y: h / 2 - (dEl / (V_FOV / 2)) * (h / 2),
              color,
              isTarget: a.type.is_target,
              label: a.callsign || a.registration || a.hex.toUpperCase(),
              sub: `${typeShort(a)} · ${fmtAlt(a.altitude_ft)} · ${fmtDist(distNm)}`,
            },
          });
        }
      }
      seen.sort((p, q) => Number(q.m.isTarget) - Number(p.m.isTarget) || p.dist - q.dist);
      setMarkers(seen.slice(0, MAX_MARKERS).map((s) => s.m));
      setRibbon(rib.slice(0, 60));
      setHeadingDisp(Math.round(heading));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [headingRef, pitchRef]);

  const selected = useMemo(
    () => aircraft.find((a) => a.hex === selectedHex) ?? null,
    [aircraft, selectedHex],
  );

  const compassLabel = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round(headingDisp / 45) % 8
  ];
  const needsSensorGesture = perm === "prompt";
  const noSensors = perm === "unsupported" || perm === "denied";

  return (
    <div className="skyview" ref={containerRef}>
      <video ref={videoRef} className="sky-video" playsInline muted />
      {camera !== "on" && <div className="sky-fallback" />}

      {/* Heads-up top bar */}
      <div className="sky-top">
        <button className="sky-close" onClick={onClose} aria-label="close sky view">
          ✕
        </button>
        <div className="sky-heading">
          {headingDisp}° {compassLabel}
        </div>
        <div className="sky-count">{markers.length} in view</div>
      </div>

      {/* Center crosshair */}
      <div className="sky-cross">+</div>

      {/* Aircraft markers */}
      {markers.map((m) => (
        <button
          key={m.hex}
          className={`sky-marker ${m.isTarget ? "target" : ""} ${selectedHex === m.hex ? "sel" : ""}`}
          style={{ left: m.x, top: m.y, "--mc": m.color } as React.CSSProperties}
          onClick={() => setSelectedHex(m.hex)}
        >
          <span className="sky-dot" />
          <span className="sky-lbl">
            {m.label}
            <em>{m.sub}</em>
          </span>
        </button>
      ))}

      {/* Hints / permissions */}
      <div className="sky-hints">
        {needsSensorGesture && (
          <button
            className="sky-enable"
            onClick={() => {
              setSensorsRequested(true);
              void start();
            }}
          >
            🧭 Enable compass
          </button>
        )}
        {noSensors && <span className="sky-pill">no compass — drag to look around</span>}
        {!noSensors && !needsSensorGesture && !hasCompassRef.current && (
          <span className="sky-pill">compass may be relative — drag to align</span>
        )}
        {camera === "off" && (
          <span className="sky-pill">camera unavailable{window.isSecureContext ? "" : " (needs HTTPS)"} — virtual sky</span>
        )}
        {usingDefaultLoc && <span className="sky-pill">using LAX as your location</span>}
        <span className="sky-pill dim">drag to fine-tune alignment</span>
      </div>

      {/* Selected aircraft card */}
      {selected && (
        <div className="sky-card">
          <div className="sky-card-head">
            <div>
              <b>{selected.callsign || selected.registration || selected.hex.toUpperCase()}</b>
              <span className="sky-card-sub">
                {typeShort(selected)} · {selected.operator.name || selected.operator.code || "—"}
              </span>
            </div>
            <button className="x" onClick={() => setSelectedHex(null)} aria-label="close">
              ✕
            </button>
          </div>
          <div className="sky-card-rows">
            <span>{fmtAlt(selected.altitude_ft)}</span>
            <span>{fmtSpeed(selected.ground_speed_kt)}</span>
            <span>{fmtDist(selected.distance_nm)} from LAX</span>
            {(selected.origin || selected.destination) && (
              <span>
                {selected.origin || "?"} → {selected.destination || "?"}
              </span>
            )}
            {selected.is_inbound && (
              <span className="sky-inbound">
                inbound {fmtEta(selected.eta_minutes)}
                {selected.runway ? ` · ${selected.runway.runway}` : ""}
              </span>
            )}
          </div>
          <button
            className="btn-primary sky-map-btn"
            onClick={() => {
              onShowOnMap(selected.hex);
              onClose();
            }}
          >
            Show on map
          </button>
        </div>
      )}

      {/* Compass ribbon */}
      <div className="sky-ribbon">
        <div className="sky-ribbon-center" />
        {[...Array(25)].map((_, i) => {
          const deg = i * 15;
          const d = angleDelta(deg, headingDisp);
          if (Math.abs(d) > 70) return null;
          const major = deg % 45 === 0;
          const names: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
          return (
            <div key={deg} className={`sky-tick ${major ? "major" : ""}`} style={{ left: `${50 + (d / 70) * 50}%` }}>
              {major ? names[deg % 360] ?? deg : ""}
            </div>
          );
        })}
        {ribbon.map((r) => (
          <span
            key={r.hex}
            className={`sky-rib-dot ${r.isTarget ? "target" : ""}`}
            style={{ left: `${50 + (r.dAz / 70) * 50}%`, background: r.color }}
          />
        ))}
      </div>
    </div>
  );
}
