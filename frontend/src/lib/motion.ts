import type { Aircraft } from "../types";
import { angleDelta, destinationPoint } from "./geo";

/** How far we'll coast on the last speed/heading before freezing (seconds). */
const MAX_COAST_S = 22;
/** Snap instead of blending if the new fix is this far from what we were showing. */
const SNAP_NM = 6;
const BLEND_MS = 1100;
const MIN_GS_KT = 35;

export interface Pose {
  lat: number;
  lon: number;
  alt: number | null;
  track: number;
}

interface Track {
  hex: string;
  fixLat: number;
  fixLon: number;
  fixAlt: number | null;
  fixTrack: number;
  gs: number;
  vs: number;
  onGround: boolean;
  stale: boolean;
  /** Estimated epoch-ms of the ADS-B position (now - seen_seconds). */
  fixAt: number;
  blendFrom: Pose | null;
  blendStart: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return (a + angleDelta(b, a) * t + 360) % 360;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function nm2(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Cheap equirectangular in nm — plenty for the snap threshold.
  const dlat = (lat2 - lat1) * 60;
  const dlon = (lon2 - lon1) * 60 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dlat, dlon);
}

function coast(t: Track, now: number): Pose {
  const rawDt = (now - t.fixAt) / 1000;
  if (t.onGround || t.stale || t.gs < MIN_GS_KT || rawDt <= 0) {
    return { lat: t.fixLat, lon: t.fixLon, alt: t.fixAlt, track: t.fixTrack };
  }
  const dt = Math.min(rawDt, MAX_COAST_S);
  const [lon, lat] = destinationPoint(t.fixLat, t.fixLon, t.fixTrack, (t.gs * dt) / 3600);
  const alt =
    t.fixAlt == null ? null : Math.max(0, t.fixAlt + (t.vs * dt) / 60);
  return { lat, lon, alt, track: t.fixTrack };
}

/**
 * Per-aircraft dead-reckoning between ADS-B snapshots. The open feeds only refresh every
 * few seconds; we keep each icon flying along its last speed/heading and blend when a
 * new fix arrives so the map never jumps.
 */
export class MotionField {
  private tracks = new Map<string, Track>();

  ingest(aircraft: Aircraft[], now = performance.now()): void {
    const seen = new Set<string>();
    for (const a of aircraft) {
      if (a.lat == null || a.lon == null) continue;
      seen.add(a.hex);
      const ageS = a.seen_seconds ?? 0;
      const stale = ageS > 50 || (a.source === "wide" && ageS > 25);
      const gs = a.ground_speed_kt ?? 0;
      const track = a.track_deg ?? 0;
      const vs = a.vertical_rate_fpm ?? 0;
      const fixAt = now - ageS * 1000;
      const prev = this.tracks.get(a.hex);
      const next: Track = {
        hex: a.hex,
        fixLat: a.lat,
        fixLon: a.lon,
        fixAlt: a.altitude_ft,
        fixTrack: track,
        gs,
        vs,
        onGround: a.on_ground,
        stale,
        fixAt,
        blendFrom: null,
        blendStart: now,
      };
      if (prev) {
        const shown = this.poseOf(prev, now);
        const target = coast(next, now);
        const jump = nm2(shown.lat, shown.lon, target.lat, target.lon);
        if (jump < SNAP_NM && !a.on_ground) {
          next.blendFrom = shown;
          next.blendStart = now;
        }
      }
      this.tracks.set(a.hex, next);
    }
    for (const hex of Array.from(this.tracks.keys())) {
      if (!seen.has(hex)) this.tracks.delete(hex);
    }
  }

  poseOf(t: Track, now: number): Pose {
    const target = coast(t, now);
    if (!t.blendFrom) return target;
    const u = (now - t.blendStart) / BLEND_MS;
    if (u >= 1) {
      t.blendFrom = null;
      return target;
    }
    const k = ease(Math.max(0, u));
    return {
      lat: lerp(t.blendFrom.lat, target.lat, k),
      lon: lerp(t.blendFrom.lon, target.lon, k),
      alt:
        t.blendFrom.alt == null || target.alt == null
          ? (target.alt ?? t.blendFrom.alt)
          : lerp(t.blendFrom.alt, target.alt, k),
      track: lerpAngle(t.blendFrom.track, target.track, k),
    };
  }

  pose(hex: string, now = performance.now()): Pose | null {
    const t = this.tracks.get(hex);
    return t ? this.poseOf(t, now) : null;
  }

  /** Return a new aircraft list with lat/lon/alt/track replaced by the live pose. */
  applyTo(aircraft: Aircraft[], now = performance.now()): Aircraft[] {
    const out: Aircraft[] = new Array(aircraft.length);
    for (let i = 0; i < aircraft.length; i++) {
      const a = aircraft[i];
      const t = this.tracks.get(a.hex);
      if (!t || a.lat == null || a.lon == null) {
        out[i] = a;
        continue;
      }
      const p = this.poseOf(t, now);
      if (p.lat === a.lat && p.lon === a.lon) {
        out[i] = a;
        continue;
      }
      out[i] = {
        ...a,
        lat: p.lat,
        lon: p.lon,
        altitude_ft: p.alt,
        track_deg: p.track,
      };
    }
    return out;
  }
}
