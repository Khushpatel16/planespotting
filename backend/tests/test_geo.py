import math

from app.constants import KLAX_LAT, KLAX_LON
from app.domain.geo import (
    angular_difference,
    cross_track_distance_nm,
    destination_point,
    eta_minutes,
    haversine_nm,
    initial_bearing,
)


def test_haversine_zero():
    assert haversine_nm(33.9, -118.4, 33.9, -118.4) == 0.0


def test_haversine_one_degree_latitude_is_60nm():
    # One degree of latitude is ~60 nm by definition.
    d = haversine_nm(33.0, -118.0, 34.0, -118.0)
    assert abs(d - 60.0) < 0.5


def test_haversine_known_distance_lax_jfk():
    # KLAX -> KJFK is ~2145 nm great-circle.
    d = haversine_nm(33.9416, -118.4085, 40.6413, -73.7781)
    assert abs(d - 2145) < 25


def test_initial_bearing_due_north():
    assert abs(initial_bearing(33.0, -118.0, 34.0, -118.0) - 0.0) < 0.01


def test_initial_bearing_due_east():
    b = initial_bearing(0.0, 0.0, 0.0, 1.0)
    assert abs(b - 90.0) < 0.01


def test_bearing_in_range():
    b = initial_bearing(33.0, -118.0, 30.0, -120.0)
    assert 0.0 <= b < 360.0


def test_destination_point_roundtrip():
    # Going distance d along bearing b should land d away at that bearing.
    lat, lon = destination_point(33.9416, -118.4085, 70.0, 50.0)
    back = haversine_nm(33.9416, -118.4085, lat, lon)
    assert abs(back - 50.0) < 0.1
    assert abs(initial_bearing(33.9416, -118.4085, lat, lon) - 70.0) < 0.5


def test_angular_difference_wraps():
    assert angular_difference(350.0, 10.0) == 20.0
    assert angular_difference(10.0, 350.0) == 20.0
    assert angular_difference(0.0, 180.0) == 180.0
    assert angular_difference(90.0, 90.0) == 0.0


def test_cross_track_sign_north_vs_south():
    # Relative to the west landing heading through KLAX, a point due north should be
    # on the opposite side from a point due south.
    north = cross_track_distance_nm(KLAX_LAT + 0.2, KLAX_LON, KLAX_LAT, KLAX_LON, 250.7)
    south = cross_track_distance_nm(KLAX_LAT - 0.2, KLAX_LON, KLAX_LAT, KLAX_LON, 250.7)
    assert math.copysign(1, north) != math.copysign(1, south)


def test_eta_minutes():
    assert eta_minutes(60.0, 360.0) == 10.0  # 60 nm at 360 kt = 10 min
    assert eta_minutes(100.0, 0.0) is None
    assert eta_minutes(100.0, 10.0) is None  # below the moving threshold
