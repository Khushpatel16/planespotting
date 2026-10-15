"""The core pipeline: raw tracks -> enrichment -> geo-compute -> Snapshot.

Pure transformation (no I/O): given the raw aircraft list, the METAR, and an optional
manual flow override, produce the fully-enriched Snapshot that gets pushed to clients.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.config import Settings
from app.constants import KLAX_LAT, KLAX_LON, RWY_HEADING_EAST, RWY_HEADING_WEST
from app.domain.aircraft_types import classify_type
from app.domain.approach import assess_inbound
from app.domain.flow import infer_flow, manual_flow
from app.domain.geo import haversine_nm, initial_bearing
from app.domain.operators import decode_operator
from app.domain.spotting import recommend_spot
from app.sources.routes import Route
from app.models import (
    Aircraft,
    Alert,
    FlowInfo,
    MetarInfo,
    OperatorInfoModel,
    RawAircraft,
    RunwayEstimateModel,
    Snapshot,
    TypeInfo,
)


def resolve_role(type_role: str | None, is_heavy: bool, operator_is_cargo: bool) -> str | None:
    """Resolve passenger vs freighter from the type (if unambiguous) + operator hint."""
    if type_role is not None:
        return type_role
    if operator_is_cargo:
        return "freighter"
    return "passenger" if is_heavy else None


def _type_label(friendly: str, family: str, role: str | None) -> str:
    if family == "A380":
        label = "A380"
    else:
        label = friendly
    if role == "freighter" and not label.endswith("F") and "Freighter" not in label and "(F)" not in label:
        label += " (F)"
    return label


def compute_flow(metar: MetarInfo | None, flow_override: str | None) -> FlowResult:
    if flow_override:
        return manual_flow(flow_override)
    if metar is None:
        return infer_flow(None, None)
    return infer_flow(metar.wind_dir_deg, metar.wind_speed_kt, variable=metar.wind_variable)


def enrich(raw: RawAircraft, flow: str, settings: Settings, route: Route | None = None) -> Aircraft:
    tinfo = classify_type(raw.type_code)
    op = decode_operator(raw.callsign)
    role = resolve_role(tinfo.role, tinfo.is_heavy, op.is_cargo)

    distance = bearing = None
    inbound = assess = None
    if raw.lat is not None and raw.lon is not None:
        distance = round(haversine_nm(raw.lat, raw.lon, KLAX_LAT, KLAX_LON), 1)
        bearing = round(initial_bearing(raw.lat, raw.lon, KLAX_LAT, KLAX_LON), 1)
        assess = assess_inbound(
            lat=raw.lat,
            lon=raw.lon,
            altitude_ft=raw.altitude_ft,
            vertical_rate_fpm=raw.vertical_rate_fpm,
            ground_speed_kt=raw.ground_speed_kt,
            track_deg=raw.track_deg,
            flow=flow,
            alert_radius_nm=settings.alert_radius_nm,
            max_altitude_ft=settings.inbound_max_altitude_ft,
            descent_rate_fpm=settings.inbound_descent_rate_fpm,
        )

    runway_model = None
    if assess and assess.runway is not None:
        rwy = assess.runway
        runway_model = RunwayEstimateModel(
            flow=rwy.flow,
            complex=rwy.complex,
            runway=rwy.runway,
            distance_to_airport_nm=rwy.distance_to_airport_nm,
            distance_to_threshold_nm=rwy.distance_to_threshold_nm,
            bearing_to_airport=rwy.bearing_to_airport,
            cross_track_nm=rwy.cross_track_nm,
            eta_minutes=rwy.eta_minutes,
        )

    return Aircraft(
        hex=raw.hex,
        callsign=raw.callsign,
        registration=raw.registration,
        type_code=raw.type_code,
        type=TypeInfo(**tinfo.__dict__),
        operator=OperatorInfoModel(code=op.code, name=op.name, country=op.country, is_cargo=op.is_cargo),
        role=role,
        lat=raw.lat,
        lon=raw.lon,
        altitude_ft=raw.altitude_ft,
        ground_speed_kt=raw.ground_speed_kt,
        track_deg=raw.track_deg,
        vertical_rate_fpm=raw.vertical_rate_fpm,
        squawk=raw.squawk,
        on_ground=raw.on_ground,
        distance_nm=distance,
        bearing_to_airport=bearing,
        is_inbound=bool(assess and assess.is_inbound),
        eta_minutes=assess.eta_minutes if assess else None,
        runway=runway_model,
        inbound_reason=assess.reason if assess else None,
        origin=route.origin if route else None,
        destination=route.destination if route else None,
        seen_seconds=raw.seen_seconds,
        source=raw.source,
    )


def build_alert(ac: Aircraft, flow: str) -> Alert:
    type_label = _type_label(ac.type.friendly_name, ac.type.family, ac.role)
    operator_label = ac.operator.name or ac.operator.code or "Unknown operator"
    runway = ac.runway.runway if ac.runway else None
    complex_side = ac.runway.complex if ac.runway else None

    spot_name = spot_id = None
    rec = recommend_spot(flow, "arrival", side=complex_side, distance_nm=ac.distance_nm)
    spot_name = rec.primary.name
    spot_id = rec.primary.id

    eta_txt = f"~{ac.eta_minutes:.0f} min out" if ac.eta_minutes is not None else "inbound"
    cs = ac.callsign or ac.registration or ac.hex.upper()
    rwy_txt = f" - likely landing {runway}" if runway else ""
    spot_txt = f" - head to {spot_name}" if spot_name else ""
    message = f"{cs} ({type_label}, {operator_label}) {eta_txt}{rwy_txt}{spot_txt}."

    return Alert(
        hex=ac.hex,
        callsign=ac.callsign,
        type_label=type_label,
        operator_label=operator_label,
        eta_minutes=ac.eta_minutes,
        distance_nm=ac.distance_nm,
        runway=runway,
        spot_name=spot_name,
        spot_id=spot_id,
        message=message,
    )


def build_snapshot(
    raw_aircraft: list[RawAircraft],
    metar: MetarInfo | None,
    sources_status: dict[str, str],
    settings: Settings,
    flow_override: str | None = None,
    routes: dict[str, Route] | None = None,
) -> Snapshot:
    flow_result = compute_flow(metar, flow_override)
    flow = flow_result.flow

    routes = routes or {}
    enriched = [
        enrich(r, flow, settings, routes.get((r.callsign or "").strip().upper()))
        for r in raw_aircraft
    ]

    # Sort targets first, then heavies, then by distance, so the client/map can lean on order.
    def sort_key(a: Aircraft):
        rank = 0 if a.type.is_target else (1 if a.type.is_heavy else 2)
        return (rank, a.distance_nm if a.distance_nm is not None else 1e9)

    enriched.sort(key=sort_key)

    alerts = [
        build_alert(a, flow)
        for a in enriched
        if a.type.is_target and a.is_inbound and not a.on_ground
    ]
    alerts.sort(key=lambda al: (al.eta_minutes if al.eta_minutes is not None else 1e9))

    counts = {
        "total": len(enriched),
        "targets": sum(1 for a in enriched if a.type.is_target),
        "heavies": sum(1 for a in enriched if a.type.is_heavy),
        "inbound_targets": len(alerts),
        "b747": sum(1 for a in enriched if a.type.family == "747"),
        "a380": sum(1 for a in enriched if a.type.family == "A380"),
    }

    flow_info = FlowInfo(
        flow=flow_result.flow,
        confidence=flow_result.confidence,
        reason=flow_result.reason,
        headwind_kt_west=flow_result.headwind_kt_west,
        source=flow_result.source,
        runway_heading=RWY_HEADING_WEST if flow == "west" else RWY_HEADING_EAST,
    )

    return Snapshot(
        generated_at=datetime.now(timezone.utc),
        metar=metar,
        flow=flow_info,
        aircraft=enriched,
        alerts=alerts,
        counts=counts,
        sources_status=sources_status,
    )
