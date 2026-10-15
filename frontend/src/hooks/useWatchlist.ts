import { useEffect, useMemo, useRef } from "react";
import type { Aircraft, Snapshot, WatchRule } from "../types";
import { playChime } from "../lib/chime";

type Perm = NotificationPermission | "unsupported";

const U = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** Does this rule constrain anything? A rule with no criteria would match everything. */
export function ruleHasCriteria(rule: WatchRule): boolean {
  return Boolean(
    (rule.family && rule.family !== "any") ||
      rule.operator.trim() ||
      rule.typeCode.trim() ||
      rule.registration.trim() ||
      rule.callsign.trim() ||
      rule.destination.trim(),
  );
}

/** True when an aircraft satisfies every non-empty criterion of a rule. */
export function ruleMatches(rule: WatchRule, ac: Aircraft): boolean {
  if (rule.inboundOnly && !ac.is_inbound) return false;
  if (rule.family && rule.family !== "any" && ac.type.family !== rule.family) return false;

  const op = U(rule.operator);
  if (op && !(U(ac.operator.name).includes(op) || U(ac.operator.code).includes(op))) return false;

  const tc = U(rule.typeCode);
  if (tc && U(ac.type.icao_type) !== tc && U(ac.type_code) !== tc) return false;

  const reg = U(rule.registration);
  if (reg && !U(ac.registration).includes(reg)) return false;

  const cs = U(rule.callsign);
  if (cs && !U(ac.callsign).includes(cs)) return false;

  const dest = U(rule.destination);
  if (dest && !U(ac.destination).includes(dest)) return false;

  return true;
}

export interface WatchMatch {
  ac: Aircraft;
  rule: WatchRule;
}

function describe(m: WatchMatch): string {
  const cs = m.ac.callsign || m.ac.registration || m.ac.hex.toUpperCase();
  const label = m.ac.type.family === "A380" ? "A380" : m.ac.type.friendly_name;
  const op = m.ac.operator.name || m.ac.operator.code || "Unknown operator";
  const where =
    m.ac.is_inbound && m.ac.eta_minutes != null
      ? `inbound ~${Math.round(m.ac.eta_minutes)} min out`
      : m.ac.distance_nm != null
        ? `${m.ac.distance_nm.toFixed(0)} nm out`
        : "in range";
  return `${cs} (${label}, ${op}) — ${where}.`;
}

/**
 * Evaluate watchlist rules against the latest snapshot. Returns the live matches (sorted
 * inbound-first, then nearest) and the set of matched hexes (for map highlighting), and
 * fires a browser notification once per (rule, aircraft) the first time it appears.
 */
export function useWatchlist(
  snapshot: Snapshot | null,
  rules: WatchRule[],
  enabled: boolean,
  perm: Perm,
  sound = false,
) {
  const matches = useMemo<WatchMatch[]>(() => {
    if (!snapshot) return [];
    const active = rules.filter((r) => r.enabled && ruleHasCriteria(r));
    if (active.length === 0) return [];
    const out: WatchMatch[] = [];
    for (const ac of snapshot.aircraft) {
      const rule = active.find((r) => ruleMatches(r, ac));
      if (rule) out.push({ ac, rule });
    }
    out.sort(
      (a, b) =>
        Number(b.ac.is_inbound) - Number(a.ac.is_inbound) ||
        (a.ac.distance_nm ?? 1e9) - (b.ac.distance_nm ?? 1e9),
    );
    return out;
  }, [snapshot, rules]);

  const matchedHexes = useMemo(() => new Set(matches.map((m) => m.ac.hex)), [matches]);

  // Notify once per (rule, aircraft). Forget pairs that leave so they can re-alert later.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const key = (m: WatchMatch) => `${m.rule.id}:${m.ac.hex}`;
    const canNotify = enabled && perm === "granted";
    if (!canNotify && !sound) {
      matches.forEach((m) => seen.current.add(key(m)));
      return;
    }
    let chimed = false;
    for (const m of matches) {
      const k = key(m);
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      if (sound && !chimed) {
        playChime("watchlist");
        chimed = true;
      }
      if (!canNotify) continue;
      try {
        new Notification(`\u2605 Watchlist: ${m.rule.label}`, { body: describe(m), tag: k });
      } catch {
        /* notifications may be blocked at the OS level */
      }
    }
    const live = new Set(matches.map(key));
    for (const k of [...seen.current]) if (!live.has(k)) seen.current.delete(k);
  }, [matches, enabled, perm, sound]);

  return { matches, matchedHexes };
}
