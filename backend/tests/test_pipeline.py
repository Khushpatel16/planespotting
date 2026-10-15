from app.config import get_settings
from app.constants import KLAX_LAT, KLAX_LON
from app.domain.geo import destination_point, initial_bearing
from app.models import RawAircraft
from app.pipeline import _type_label, build_snapshot, enrich, resolve_role

SETTINGS = get_settings()


def test_resolve_role_from_type():
    assert resolve_role("freighter", True, False) == "freighter"
    assert resolve_role("passenger", True, False) == "passenger"


def test_resolve_role_cargo_operator_makes_ambiguous_a_freighter():
    # B748 has no fixed role; a cargo operator resolves it to freighter.
    assert resolve_role(None, True, True) == "freighter"
    assert resolve_role(None, True, False) == "passenger"


def test_type_label():
    assert _type_label("A380-800", "A380", "passenger") == "A380"
    assert _type_label("747-400F", "747", "freighter") == "747-400F"
    assert _type_label("747-8", "747", "freighter") == "747-8 (F)"


def test_enrich_b748_cargo_operator_is_freighter():
    raw = RawAircraft(hex="abc", callsign="GTI8896", type_code="B748", lat=34.0, lon=-118.0)
    ac = enrich(raw, "west", SETTINGS)
    assert ac.type.family == "747"
    assert ac.operator.name == "Atlas Air"
    assert ac.role == "freighter"


def test_build_snapshot_generates_inbound_alert():
    # An Emirates A380, 25 nm east of LAX, descending, tracking the field -> inbound alert.
    lat, lon = destination_point(KLAX_LAT, KLAX_LON, 90.0, 25.0)
    track = initial_bearing(lat, lon, KLAX_LAT, KLAX_LON)
    raw = [
        RawAircraft(
            hex="a388ek",
            callsign="UAE215",
            registration="A6-EUA",
            type_code="A388",
            lat=lat,
            lon=lon,
            altitude_ft=6000,
            vertical_rate_fpm=-900,
            ground_speed_kt=280,
            track_deg=track,
            source="test",
        )
    ]
    snap = build_snapshot(raw, metar=None, sources_status={}, settings=SETTINGS, flow_override="west")
    assert snap.flow.flow == "west"
    assert snap.counts["a380"] == 1
    assert snap.counts["inbound_targets"] == 1
    assert len(snap.alerts) == 1
    msg = snap.alerts[0].message
    assert "A380" in msg
    assert "Emirates" in msg
    assert "head to" in msg
    assert snap.alerts[0].runway in {"24R", "25L"}


def test_build_snapshot_applies_routes():
    from app.sources.routes import Route

    raw = [RawAircraft(hex="abc", callsign="uae215 ", type_code="A388", lat=34.0, lon=-118.0)]
    routes = {"UAE215": Route(origin="OMDB", destination="KLAX")}
    snap = build_snapshot(raw, metar=None, sources_status={}, settings=SETTINGS, flow_override="west", routes=routes)
    assert snap.aircraft[0].origin == "OMDB"
    assert snap.aircraft[0].destination == "KLAX"


def test_build_snapshot_sorts_targets_first():
    raw = [
        RawAircraft(hex="ga1", callsign="N12AB", type_code="C172", lat=34.0, lon=-118.0),
        RawAircraft(hex="a388", callsign="QFA12", type_code="A388", lat=34.0, lon=-118.2),
    ]
    snap = build_snapshot(raw, metar=None, sources_status={}, settings=SETTINGS, flow_override="west")
    assert snap.aircraft[0].type.is_target  # A380 sorted ahead of the Cessna
