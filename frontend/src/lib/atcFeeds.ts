// Live ATC audio catalog.
//
// There is no government-run public ATC audio service in the US: the FAA does not stream
// its frequencies. Every "live ATC" app you have seen is relaying LiveATC.net, a volunteer
// network of scanner receivers. The catalog below (feed names, stream mount ids, published
// frequencies) was captured from LiveATC's airport pages; the audio itself streams from
// LiveATC's servers straight into the browser's <audio> element.
//
// LiveATC's terms: "Audio streams may not be used in any third-party products." This panel
// is meant for personal, in-browser listening; every feed also links to LiveATC's own player.

import catalog from "../data/atcFeeds.json";

export type FeedKind =
  | "tower"
  | "ground"
  | "clearance"
  | "atis"
  | "approach"
  | "departure"
  | "center"
  | "other";

export interface AtcFrequency {
  facility: string;
  mhz: string;
}

export interface AtcFeed {
  mount: string; // LiveATC stream mount id, e.g. "klax3"
  name: string; // e.g. "KLAX Tower (North) #1"
  kind: FeedKind;
  runways: string[]; // runway ends this feed covers (LAX only; west-flow names)
  freqs: AtcFrequency[];
}

export interface AtcAirport {
  icao: string;
  name: string;
  city: string;
  region: string;
  country: string;
  feeds: AtcFeed[];
}

interface Catalog {
  source: string;
  airports: AtcAirport[];
}

export const ATC_CATALOG = catalog as Catalog;
export const ATC_AIRPORTS: AtcAirport[] = ATC_CATALOG.airports;

export const KIND_ORDER: FeedKind[] = [
  "tower",
  "ground",
  "clearance",
  "atis",
  "approach",
  "departure",
  "center",
  "other",
];

export const KIND_LABEL: Record<FeedKind, string> = {
  tower: "Tower",
  ground: "Ground",
  clearance: "Clearance delivery",
  atis: "ATIS / weather",
  approach: "Approach / arrivals",
  departure: "Departure",
  center: "Center (en-route)",
  other: "Other",
};

export function findAirport(icao: string): AtcAirport | undefined {
  const u = icao.toUpperCase();
  return ATC_AIRPORTS.find((a) => a.icao === u);
}

export function findFeed(mount: string): { airport: AtcAirport; feed: AtcFeed } | undefined {
  for (const airport of ATC_AIRPORTS) {
    const feed = airport.feeds.find((f) => f.mount === mount);
    if (feed) return { airport, feed };
  }
  return undefined;
}

/** Direct audio stream (MP3 over HTTP). */
export function streamUrl(mount: string): string {
  return `https://d.liveatc.net/${encodeURIComponent(mount)}`;
}

/** LiveATC's own browser player for this feed. */
export function liveAtcPlayerUrl(mount: string, icao: string): string {
  return `https://www.liveatc.net/hlisten.php?mount=${encodeURIComponent(mount)}&icao=${encodeURIComponent(icao.toLowerCase())}`;
}

/** LiveATC airport page (lists every feed, incl. airports not in our catalog). */
export function liveAtcAirportUrl(icao: string): string {
  return `https://www.liveatc.net/search/?icao=${encodeURIComponent(icao.toLowerCase())}`;
}

/**
 * LAX runway names flip with the flow: the north complex is 24L/24R in west flow and
 * 06L/06R in east flow; the south complex is 25L/25R vs 07L/07R. Same pavement, same
 * tower frequency - only the name the controllers use changes.
 */
export function runwayLabelForFlow(rwy: string, flow: "west" | "east"): string {
  if (flow === "west") return rwy;
  const map: Record<string, string> = { "24L": "06R", "24R": "06L", "25L": "07R", "25R": "07L" };
  return map[rwy] ?? rwy;
}

export function groupFeeds(feeds: AtcFeed[]): { kind: FeedKind; feeds: AtcFeed[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, feeds: feeds.filter((f) => f.kind === kind) })).filter(
    (g) => g.feeds.length > 0,
  );
}
