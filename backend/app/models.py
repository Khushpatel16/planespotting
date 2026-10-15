"""Pydantic models = the contract between the backend pipeline, the WebSocket, and the
React client. Kept flat and JSON-friendly so the frontend types mirror them 1:1.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RawAircraft(BaseModel):
    """Normalized raw track from any ADS-B source, before enrichment."""

    hex: str
    callsign: str | None = None
    registration: str | None = None
    type_code: str | None = None
    lat: float | None = None
    lon: float | None = None
    altitude_ft: float | None = None
    ground_speed_kt: float | None = None
    track_deg: float | None = None
    vertical_rate_fpm: float | None = None
    squawk: str | None = None
    on_ground: bool = False
    seen_seconds: float | None = None  # how stale the position is
    source: str = "unknown"


class TypeInfo(BaseModel):
    icao_type: str
    manufacturer: str
    friendly_name: str
    variant: str
    role: str | None
    is_target: bool
    is_heavy: bool
    family: str


class OperatorInfoModel(BaseModel):
    code: str | None
    name: str | None
    country: str | None
    is_cargo: bool


class RunwayEstimateModel(BaseModel):
    flow: str
    complex: str
    runway: str
    distance_to_airport_nm: float
    distance_to_threshold_nm: float
    bearing_to_airport: float
    cross_track_nm: float
    eta_minutes: float | None


class Aircraft(BaseModel):
    """Fully enriched aircraft pushed to the client."""

    hex: str
    callsign: str | None
    registration: str | None
    type_code: str | None
    type: TypeInfo
    operator: OperatorInfoModel
    role: str | None  # resolved pax/freighter (type + operator hints)

    lat: float | None
    lon: float | None
    altitude_ft: float | None
    ground_speed_kt: float | None
    track_deg: float | None
    vertical_rate_fpm: float | None
    squawk: str | None
    on_ground: bool

    distance_nm: float | None
    bearing_to_airport: float | None

    is_inbound: bool = False
    eta_minutes: float | None = None
    runway: RunwayEstimateModel | None = None
    inbound_reason: str | None = None

    origin: str | None = None
    destination: str | None = None

    seen_seconds: float | None = None
    source: str


class MetarInfo(BaseModel):
    station: str
    observed_at: datetime | None
    raw: str
    wind_dir_deg: float | None
    wind_speed_kt: float | None
    wind_gust_kt: float | None
    wind_variable: bool
    visibility: str | None
    flight_category: str | None
    temp_c: float | None
    altimeter_hpa: float | None


class FlowInfo(BaseModel):
    flow: str
    confidence: str
    reason: str
    headwind_kt_west: float
    source: str
    runway_heading: float  # true heading aircraft fly while landing in this flow


class Alert(BaseModel):
    """An inbound-target alert card."""

    hex: str
    callsign: str | None
    type_label: str  # e.g. "A380" / "747-8F"
    operator_label: str  # e.g. "Emirates"
    eta_minutes: float | None
    distance_nm: float | None
    runway: str | None
    spot_name: str | None
    spot_id: str | None
    message: str


class Snapshot(BaseModel):
    """The full live picture broadcast to clients each poll."""

    type: str = "snapshot"
    generated_at: datetime
    metar: MetarInfo | None
    flow: FlowInfo
    aircraft: list[Aircraft]
    alerts: list[Alert]
    counts: dict[str, int]
    sources_status: dict[str, str]


# --- Logbook models ---


class SightingCreate(BaseModel):
    type_code: str | None = None
    type_label: str | None = None
    variant: str | None = None
    registration: str | None = None
    operator: str | None = None
    callsign: str | None = None
    hex: str | None = None
    flow: str | None = None
    runway: str | None = None
    spot_id: str | None = None
    notes: str | None = None
    seen_at: datetime | None = None  # defaults to now server-side


class Sighting(SightingCreate):
    id: int
    created_at: datetime
    seen_at: datetime
    photo_url: str | None = None
    family: str | None = None  # "747" | "A380" | "heavy" | "other"


class StatsResponse(BaseModel):
    total: int
    a380_by_operator: dict[str, int]
    b747_variants: dict[str, int]
    by_family: dict[str, int]
    by_operator: dict[str, int]
    rarest: list[Sighting]
    over_time: dict[str, int]  # ISO date -> count
    hour_heatmap: dict[int, int]  # local hour 0-23 -> count
