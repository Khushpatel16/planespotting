// Mirrors backend/app/models.py — the WebSocket + REST contract.

export interface TypeInfo {
  icao_type: string;
  manufacturer: string;
  friendly_name: string;
  variant: string;
  role: string | null;
  is_target: boolean;
  is_heavy: boolean;
  family: "747" | "A380" | "heavy" | "other";
}

export interface OperatorInfo {
  code: string | null;
  name: string | null;
  country: string | null;
  is_cargo: boolean;
}

export interface RunwayEstimate {
  flow: string;
  complex: "north" | "south";
  runway: string;
  distance_to_airport_nm: number;
  distance_to_threshold_nm: number;
  bearing_to_airport: number;
  cross_track_nm: number;
  eta_minutes: number | null;
}

export interface Aircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type_code: string | null;
  type: TypeInfo;
  operator: OperatorInfo;
  role: string | null;
  lat: number | null;
  lon: number | null;
  altitude_ft: number | null;
  ground_speed_kt: number | null;
  track_deg: number | null;
  vertical_rate_fpm: number | null;
  squawk: string | null;
  on_ground: boolean;
  distance_nm: number | null;
  bearing_to_airport: number | null;
  is_inbound: boolean;
  eta_minutes: number | null;
  runway: RunwayEstimate | null;
  inbound_reason: string | null;
  origin: string | null;
  destination: string | null;
  seen_seconds: number | null;
  source: string;
}

export interface MetarInfo {
  station: string;
  observed_at: string | null;
  raw: string;
  wind_dir_deg: number | null;
  wind_speed_kt: number | null;
  wind_gust_kt: number | null;
  wind_variable: boolean;
  visibility: string | null;
  flight_category: string | null;
  temp_c: number | null;
  altimeter_hpa: number | null;
}

export interface FlowInfo {
  flow: "west" | "east";
  confidence: "high" | "low";
  reason: string;
  headwind_kt_west: number;
  source: "metar" | "manual" | "default";
  runway_heading: number;
}

export interface Alert {
  hex: string;
  callsign: string | null;
  type_label: string;
  operator_label: string;
  eta_minutes: number | null;
  distance_nm: number | null;
  runway: string | null;
  spot_name: string | null;
  spot_id: string | null;
  message: string;
}

export interface Snapshot {
  type: "snapshot";
  generated_at: string;
  metar: MetarInfo | null;
  flow: FlowInfo;
  aircraft: Aircraft[];
  alerts: Alert[];
  counts: Record<string, number>;
  sources_status: Record<string, string>;
}

export interface RunwayEnd {
  name: string;
  lat: number;
  lon: number;
  heading: number;
}
export interface RunwayConfig {
  pair: string;
  complex: "north" | "south";
  ends: Record<string, RunwayEnd>;
}
export interface Spot {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  notes: string;
  good_for: string[];
}
export interface AppConfig {
  airport: { icao: string; lat: number; lon: number };
  runway_heading: { west: number; east: number };
  runways: RunwayConfig[];
  spots: Spot[];
  type_sets: {
    b747_family: string[];
    a380: string[];
    targets: string[];
    other_heavies: string[];
  };
  defaults: {
    alert_radius_nm: number;
    search_radius_nm: number;
    poll_interval_seconds: number;
  };
}

export interface Sighting {
  id: number;
  created_at: string;
  seen_at: string;
  type_code: string | null;
  type_label: string | null;
  variant: string | null;
  family: string | null;
  registration: string | null;
  operator: string | null;
  callsign: string | null;
  hex: string | null;
  flow: string | null;
  runway: string | null;
  spot_id: string | null;
  notes: string | null;
  photo_url: string | null;
}

export interface Stats {
  total: number;
  a380_by_operator: Record<string, number>;
  b747_variants: Record<string, number>;
  by_family: Record<string, number>;
  by_operator: Record<string, number>;
  rarest: Sighting[];
  over_time: Record<string, number>;
  hour_heatmap: Record<string, number>;
}

// A user-defined watchlist alert rule. All non-empty criteria must match (AND); empty
// fields are wildcards. Evaluated client-side against every aircraft in the snapshot.
export interface WatchRule {
  id: string;
  label: string;
  enabled: boolean;
  operator: string; // matches operator name or ICAO code (contains, case-insensitive)
  family: "any" | "A380" | "747" | "heavy" | "other";
  typeCode: string; // exact ICAO type designator, e.g. "A388"
  registration: string; // tail number (contains), e.g. "D-AIMB"
  callsign: string; // callsign (contains/prefix), e.g. "DLH456"
  destination: string; // destination ICAO/IATA when the feed provides it (contains)
  inboundOnly: boolean; // only fire when the aircraft is inbound to LAX
}

// Client-side filter state.
export interface Filters {
  showTargets: boolean; // 747 + A380
  showOtherHeavies: boolean;
  showAllTraffic: boolean;
  alertRadiusNm: number;
  alertOn747: boolean;
  alertOnA380: boolean;
  alertOnHeavies: boolean;
}
