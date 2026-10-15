from app.constants import KLAX_LAT, KLAX_LON
from app.domain.approach import assess_inbound
from app.domain.geo import destination_point, initial_bearing

DEFAULTS = dict(alert_radius_nm=60.0, max_altitude_ft=13000.0, descent_rate_fpm=-150.0)


def _point_from_klax(bearing_deg: float, dist_nm: float):
    return destination_point(KLAX_LAT, KLAX_LON, bearing_deg, dist_nm)


def test_classic_west_flow_arrival_is_inbound():
    # 25 nm due east of the field, descending, tracking back toward LAX.
    lat, lon = _point_from_klax(90.0, 25.0)
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=6000, vertical_rate_fpm=-900,
        ground_speed_kt=280, track_deg=track, flow="west", **DEFAULTS,
    )
    assert a.is_inbound
    assert a.runway is not None
    assert a.eta_minutes is not None
    assert 20 < a.distance_nm < 30


def test_far_away_not_inbound():
    lat, lon = _point_from_klax(90.0, 120.0)  # outside 60 nm radius
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=8000, vertical_rate_fpm=-800,
        ground_speed_kt=300, track_deg=track, flow="west", **DEFAULTS,
    )
    assert not a.is_inbound
    assert not a.within_radius


def test_wrong_side_for_flow_not_inbound():
    # West of the field in WEST flow = departure side, not the arrival corridor.
    lat, lon = _point_from_klax(270.0, 20.0)
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=6000, vertical_rate_fpm=-500,
        ground_speed_kt=250, track_deg=track, flow="west", **DEFAULTS,
    )
    assert not a.is_inbound
    assert not a.in_corridor


def test_climbing_high_not_inbound():
    lat, lon = _point_from_klax(90.0, 25.0)
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=30000, vertical_rate_fpm=+2000,
        ground_speed_kt=400, track_deg=track, flow="west", **DEFAULTS,
    )
    assert not a.is_inbound
    assert not a.low_or_descending


def test_flying_away_not_aligned():
    # Positioned east but tracking further east (away from the field).
    lat, lon = _point_from_klax(90.0, 25.0)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=6000, vertical_rate_fpm=-300,
        ground_speed_kt=250, track_deg=90.0, flow="west", **DEFAULTS,
    )
    assert not a.is_inbound
    assert not a.aligned


def test_east_flow_arrival_from_ocean():
    # West of the field, low over the water, tracking east toward LAX.
    lat, lon = _point_from_klax(270.0, 18.0)
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    a = assess_inbound(
        lat=lat, lon=lon, altitude_ft=4000, vertical_rate_fpm=-700,
        ground_speed_kt=240, track_deg=track, flow="east", **DEFAULTS,
    )
    assert a.is_inbound
    assert a.runway is not None


def test_no_position():
    a = assess_inbound(
        lat=None, lon=None, altitude_ft=4000, vertical_rate_fpm=-700,
        ground_speed_kt=240, track_deg=90, flow="west", **DEFAULTS,
    )
    assert not a.is_inbound
