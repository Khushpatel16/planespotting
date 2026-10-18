import type { Map as MlMap } from "maplibre-gl";
import type { Aircraft, AppConfig } from "../types";
import { destinationPoint } from "./geo";
import type { Pose } from "./motion";

export type FlightPhase = "approach" | "departure" | "ground" | "cruise";

export function flightPhase(a: Aircraft): FlightPhase {
  if (a.on_ground || (a.altitude_ft != null && a.altitude_ft < 50)) return "ground";
  const vs = a.vertical_rate_fpm ?? 0;
  const dist = a.distance_nm ?? 99;
  const alt = a.altitude_ft ?? 99999;
  if (a.is_inbound && (vs < 100 || alt < 13000) && dist < 80) return "approach";
  // Climbing out of the LAX area: anything still below the high teens within ~40 nm.
  if (vs > 300 && dist < 40 && alt < 18000) return "departure";
  return "cruise";
}

/** Minimum ground speed for a ground aircraft to count as "rolling" (taxi / takeoff roll). */
const ROLLING_KT = 25;

export function cockpitCandidates(aircraft: Aircraft[]): Aircraft[] {
  const scored: { a: Aircraft; score: number }[] = [];
  for (const a of aircraft) {
    if (a.lat == null || a.lon == null) continue;
    const phase = flightPhase(a);
    if (phase === "cruise") continue;
    // Parked airframes aren't useful in the cockpit picker: only aircraft rolling at LAX.
    if (phase === "ground" && ((a.distance_nm ?? 99) > 6 || (a.ground_speed_kt ?? 0) < ROLLING_KT)) continue;
    let score = 0;
    if (phase === "approach") score = 300 - (a.eta_minutes ?? 40) - (a.distance_nm ?? 40);
    else if (phase === "departure") score = 160 - (a.distance_nm ?? 20);
    else score = 40;
    if (a.type.is_target) score += 30;
    else if (a.type.is_heavy) score += 12;
    scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.map((s) => s.a);
}

function runwayThreshold(config: AppConfig | null, name: string | null | undefined) {
  if (!config || !name) return null;
  for (const r of config.runways) {
    const end = r.ends[name];
    if (end) return end;
  }
  return null;
}

function zoomForAlt(altFt: number, phase: FlightPhase): number {
  if (phase === "ground") return 16.4;
  if (altFt < 400) return 16.1;
  if (altFt < 1200) return 15.4;
  if (altFt < 3000) return 14.6;
  if (altFt < 7000) return 13.5;
  if (altFt < 16000) return 12.4;
  return 11.4;
}

/**
 * Cockpit camera: MapLibre 4 has no free-camera API, so we lock bearing to the aircraft
 * track, pitch toward the horizon, and put the look-at a short way ahead of the nose
 * (the landing runway when we know it). Combined with 3D terrain this reads as sitting
 * up front on approach / takeoff.
 */
export function applyCockpitCamera(
  map: MlMap,
  pose: Pose,
  ac: Aircraft,
  config: AppConfig | null,
): void {
  const alt = pose.alt ?? 800;
  const track = pose.track;
  const phase = flightPhase({ ...ac, altitude_ft: pose.alt, track_deg: track, lat: pose.lat, lon: pose.lon });
  const rwy = phase === "approach" ? runwayThreshold(config, ac.runway?.runway) : null;

  let center: [number, number];
  let bearing = track;
  if (rwy) {
    center = [rwy.lon * 0.15 + pose.lon * 0.85, rwy.lat * 0.15 + pose.lat * 0.85];
    // Point at the threshold, not just along track — that's the real approach picture.
    const dx = rwy.lon - pose.lon;
    const dy = rwy.lat - pose.lat;
    bearing = ((Math.atan2(dx * Math.cos((pose.lat * Math.PI) / 180), dy) * 180) / Math.PI + 360) % 360;
  } else {
    const lookNm = phase === "departure" ? 0.55 : phase === "ground" ? 0.12 : 0.4;
    const [lon, lat] = destinationPoint(pose.lat, pose.lon, track, lookNm);
    center = [lon, lat];
  }

  map.stop();
  map.jumpTo({
    center,
    bearing,
    pitch: phase === "approach" ? 78 : phase === "ground" ? 70 : 74,
    zoom: zoomForAlt(alt, phase),
  });
}

export function setMapInteractive(map: MlMap, on: boolean): void {
  const handlers = [
    map.dragPan,
    map.scrollZoom,
    map.boxZoom,
    map.dragRotate,
    map.keyboard,
    map.doubleClickZoom,
    map.touchZoomRotate,
  ];
  for (const h of handlers) {
    if (on) h.enable();
    else h.disable();
  }
}
