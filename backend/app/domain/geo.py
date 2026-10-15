"""Great-circle geospatial math.

Pure functions, no I/O, fully unit-tested. Distances are in nautical miles unless a
function name says otherwise; bearings are degrees true in [0, 360).
"""

from __future__ import annotations

import math

EARTH_RADIUS_NM = 3440.065  # mean Earth radius in nautical miles
NM_PER_DEG_LAT = 60.0


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(min(1.0, math.sqrt(a)))


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial true bearing (deg) of the great circle from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlmb = math.radians(lon2 - lon1)
    y = math.sin(dlmb) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlmb)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination_point(lat: float, lon: float, bearing_deg: float, distance_nm: float) -> tuple[float, float]:
    """Point reached starting at (lat, lon) traveling distance_nm along bearing_deg."""
    ang = distance_nm / EARTH_RADIUS_NM
    brg = math.radians(bearing_deg)
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(ang) + math.cos(p1) * math.sin(ang) * math.cos(brg))
    l2 = l1 + math.atan2(
        math.sin(brg) * math.sin(ang) * math.cos(p1),
        math.cos(ang) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), (math.degrees(l2) + 540.0) % 360.0 - 180.0


def angular_difference(a: float, b: float) -> float:
    """Smallest absolute difference between two bearings, in [0, 180]."""
    d = abs((a - b) % 360.0)
    return min(d, 360.0 - d)


def cross_track_distance_nm(
    lat: float,
    lon: float,
    path_lat: float,
    path_lon: float,
    path_bearing_deg: float,
) -> float:
    """Signed perpendicular distance (nm) from a point to a great-circle path.

    The path is defined by an origin point and a bearing. Positive = point lies to
    the LEFT of the path direction, negative = to the RIGHT. Used to measure how far
    an aircraft is off an extended runway centerline.
    """
    d13 = haversine_nm(path_lat, path_lon, lat, lon) / EARTH_RADIUS_NM
    brg13 = math.radians(initial_bearing(path_lat, path_lon, lat, lon))
    brg12 = math.radians(path_bearing_deg)
    xt = math.asin(math.sin(d13) * math.sin(brg13 - brg12))
    return xt * EARTH_RADIUS_NM


def eta_minutes(distance_nm: float, ground_speed_kt: float) -> float | None:
    """Naive ETA in minutes from distance and ground speed. None if not moving."""
    if ground_speed_kt is None or ground_speed_kt < 30.0:
        return None
    return distance_nm / ground_speed_kt * 60.0
