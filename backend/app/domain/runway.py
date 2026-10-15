"""Likely landing runway + ETA estimate.

Deliberately simple and heuristic (documented in the README):

  1. Active flow (west/east) decides the landing direction (24/25 vs 06/07).
  2. North vs south complex is chosen by which side of the extended runway centerline
     the aircraft currently sits (signed cross-track distance through the airport along
     the runway bearing).
  3. Within a complex we assume the standard LAX split: arrivals on the OUTBOARD runway
     (west: 24R/25L, east: 06L/07R).
  4. ETA = distance to the assigned threshold / ground speed.

This does NOT know ATC intent, wake separation, or gate assignment, so treat the runway
as a best guess for the side of the field, not gospel.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.constants import (
    ARRIVAL_RUNWAYS,
    KLAX_LAT,
    KLAX_LON,
    RWY_HEADING_WEST,
    runway_end,
)
from app.domain.geo import (
    cross_track_distance_nm,
    eta_minutes,
    haversine_nm,
    initial_bearing,
)


@dataclass(frozen=True)
class RunwayEstimate:
    flow: str
    complex: str  # "north" | "south"
    runway: str  # e.g. "24R"
    distance_to_airport_nm: float
    distance_to_threshold_nm: float
    bearing_to_airport: float
    cross_track_nm: float  # >=0 north of centerline, <0 south
    eta_minutes: float | None


def assign_complex(lat: float, lon: float) -> tuple[str, float]:
    """Return ("north"|"south", signed_cross_track_nm) for a position.

    Cross-track is measured along the fixed west landing heading (250.7) through the
    airport reference so the result is independent of the active flow direction.
    Calibrated by unit test: a point due north of the field yields "north".
    """
    xt = cross_track_distance_nm(lat, lon, KLAX_LAT, KLAX_LON, RWY_HEADING_WEST)
    return ("north" if xt >= 0 else "south"), xt


def estimate_runway(lat: float, lon: float, ground_speed_kt: float | None, flow: str) -> RunwayEstimate:
    flow = flow.lower()
    complex_side, xt = assign_complex(lat, lon)
    runway = ARRIVAL_RUNWAYS[flow][complex_side]
    thr = runway_end(runway)

    dist_arp = haversine_nm(lat, lon, KLAX_LAT, KLAX_LON)
    dist_thr = haversine_nm(lat, lon, thr.lat, thr.lon)
    brg = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    eta = eta_minutes(dist_thr, ground_speed_kt or 0.0)

    return RunwayEstimate(
        flow=flow,
        complex=complex_side,
        runway=runway,
        distance_to_airport_nm=round(dist_arp, 1),
        distance_to_threshold_nm=round(dist_thr, 1),
        bearing_to_airport=round(brg, 1),
        cross_track_nm=round(xt, 1),
        eta_minutes=round(eta, 1) if eta is not None else None,
    )
