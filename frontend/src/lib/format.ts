import type { Aircraft } from "../types";
import { CAT } from "./colors";

export function fmtAlt(ft: number | null): string {
  if (ft === null) return "—";
  if (ft <= 0) return "ground";
  return `${Math.round(ft).toLocaleString()} ft`;
}

export function fmtSpeed(kt: number | null): string {
  return kt === null ? "—" : `${Math.round(kt)} kt`;
}

export function fmtDist(nm: number | null): string {
  return nm === null ? "—" : `${nm.toFixed(0)} nm`;
}

export function fmtEta(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "<1 min";
  return `${Math.round(min)} min`;
}

export function fmtVrate(fpm: number | null): string {
  if (fpm === null) return "—";
  const arrow = fpm > 100 ? "▲" : fpm < -100 ? "▼" : "•";
  return `${arrow} ${Math.abs(Math.round(fpm)).toLocaleString()} fpm`;
}

export function aircraftLabel(a: Aircraft): string {
  return a.callsign || a.registration || a.hex.toUpperCase();
}

export function categoryColor(a: Aircraft): string {
  if (a.type.family === "A380") return CAT.a380;
  if (a.type.family === "747") return CAT.b747;
  if (a.type.is_heavy) return CAT.heavy;
  return CAT.other;
}

export function roleBadge(role: string | null): string {
  if (role === "freighter") return "FREIGHTER";
  if (role === "passenger") return "PAX";
  return "";
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
