"""Detect whether a target aircraft is inbound to KLAX on an approach.

An aircraft counts as inbound when ALL of:
  - it is within the alert radius (default 60 nm),
  - it is low or descending (altitude <= max OR vertical rate <= descent threshold),
  - its track points roughly at the airport (heading toward the field), and
  - it sits in the approach corridor for the active flow (east of the field in west
    flow, west of the field in east flow).

Everything is a generous heuristic so we catch aircraft on downwind/base as well as
those established on final. Documented in the README.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.constants import KLAX_LAT, KLAX_LON
from app.domain.geo import angular_difference, eta_minutes, haversine_nm, initial_bearing
from app.domain.runway import RunwayEstimate, estimate_runway

# How closely the track must point at the field (deg) to count as "heading inbound".
TRACK_ALIGNMENT_DEG = 55.0
# Half-width of the approach corridor measured from the field (deg of bearing).
CORRIDOR_HALF_WIDTH_DEG = 80.0

# Bearing FROM the airport toward the side arrivals come from, per flow.
_APPROACH_SIDE_BEARING = {"west": 90.0, "east": 270.0}  # east of field / west of field


@dataclass(frozen=True)
class InboundAssessment:
    is_inbound: bool
    distance_nm: float
    bearing_to_airport: float
    within_radius: bool
    low_or_descending: bool
    aligned: bool
    in_corridor: bool
    eta_minutes: float | None
    runway: RunwayEstimate | None
    reason: str


def assess_inbound(
    *,
    lat: float | None,
    lon: float | None,
    altitude_ft: float | None,
    vertical_rate_fpm: float | None,
    ground_speed_kt: float | None,
    track_deg: float | None,
    flow: str,
    alert_radius_nm: float,
    max_altitude_ft: float,
    descent_rate_fpm: float,
) -> InboundAssessment:
    flow = flow.lower()
    if lat is None or lon is None:
        return InboundAssessment(
            is_inbound=False,
            distance_nm=float("inf"),
            bearing_to_airport=0.0,
            within_radius=False,
            low_or_descending=False,
            aligned=False,
            in_corridor=False,
            eta_minutes=None,
            runway=None,
            reason="no position",
        )

    distance = haversine_nm(lat, lon, KLAX_LAT, KLAX_LON)
    bearing_to_airport = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    bearing_from_airport = initial_bearing(KLAX_LAT, KLAX_LON, lat, lon)

    within_radius = distance <= alert_radius_nm

    descending = vertical_rate_fpm is not None and vertical_rate_fpm <= descent_rate_fpm
    low = altitude_ft is not None and altitude_ft <= max_altitude_ft
    low_or_descending = bool(descending or low)

    aligned = track_deg is not None and angular_difference(track_deg, bearing_to_airport) <= TRACK_ALIGNMENT_DEG

    corridor_center = _APPROACH_SIDE_BEARING.get(flow, 90.0)
    in_corridor = angular_difference(bearing_from_airport, corridor_center) <= CORRIDOR_HALF_WIDTH_DEG

    is_inbound = bool(within_radius and low_or_descending and aligned and in_corridor)

    runway = None
    eta = None
    if is_inbound:
        runway = estimate_runway(lat, lon, ground_speed_kt, flow)
        eta = runway.eta_minutes
    else:
        eta = eta_minutes(distance, ground_speed_kt or 0.0) if aligned else None

    if is_inbound:
        reason = "inbound: within range, descending/low, tracking the field, in the approach corridor"
    else:
        missing = []
        if not within_radius:
            missing.append(f">{alert_radius_nm:.0f}nm out")
        if not low_or_descending:
            missing.append("not low/descending")
        if not aligned:
            missing.append("not tracking the field")
        if not in_corridor:
            missing.append("outside approach corridor")
        reason = "not inbound: " + ", ".join(missing) if missing else "not inbound"

    return InboundAssessment(
        is_inbound=is_inbound,
        distance_nm=round(distance, 1),
        bearing_to_airport=round(bearing_to_airport, 1),
        within_radius=within_radius,
        low_or_descending=low_or_descending,
        aligned=aligned,
        in_corridor=in_corridor,
        eta_minutes=round(eta, 1) if eta is not None else None,
        runway=runway,
        reason=reason,
    )
