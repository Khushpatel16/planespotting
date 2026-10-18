"""Traffic-category classifier, country/state locator, and the wide tile sweep."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.domain.regions import locate
from app.domain.traffic import TRAFFIC_CATEGORIES, TRAFFIC_CATEGORY_IDS, classify_traffic
from app.models import RawAircraft
from app.pipeline import enrich, traffic_counts
from app.wide import WidePoller, build_tiles


# --- traffic -----------------------------------------------------------------------------


def cats(*args, **kw) -> set[str]:
    return set(classify_traffic(*args, **kw).categories)


def test_user_requested_categories_all_present():
    ids = [c[0] for c in TRAFFIC_CATEGORIES]
    for wanted in [
        "all", "passenger", "cargo", "a300_cargo", "a320", "a320_cargo", "a330", "a330_cargo",
        "a350", "a350_cargo", "a380", "b737", "b737_cargo", "b747", "b757", "b767", "b777",
        "b747_cargo", "b757_cargo", "b767_cargo", "b777_cargo", "bbj", "md",
    ]:
        assert wanted in ids
    assert len(ids) == len(set(ids)) == 23
    assert TRAFFIC_CATEGORY_IDS == frozenset(ids)


def test_freighter_type_is_cargo_family():
    assert cats("B77F", "freighter", False, True, "FDX123") >= {"all", "cargo", "b777", "b777_cargo"}
    assert "passenger" not in cats("B77F", "freighter", False, True, "FDX123")


def test_passenger_airline_widebody():
    c = cats("B744", "passenger", False, True, "BAW283")
    assert c == {"all", "passenger", "b747"}


def test_cargo_operator_resolves_ambiguous_type():
    c = cats("B748", None, True, True, "GTI8120")
    assert {"cargo", "b747", "b747_cargo"} <= c and "passenger" not in c


def test_description_hint_marks_converted_freighter():
    c = cats("B763", "passenger", False, False, "N123AB", desc="BOEING 767-300 BDSF")
    assert {"cargo", "b767", "b767_cargo"} <= c


def test_bbj_from_description_and_private_callsign():
    assert "bbj" in cats("B738", None, False, False, "N737ER", desc="BOEING 737-7 BBJ")
    assert "bbj" in cats("B738", None, False, False, "N1KE")  # private 737 without airline callsign
    assert "bbj" not in cats("B738", None, False, True, "SWA123")  # scheduled airline


def test_a300_always_cargo_family_and_md_family():
    assert {"a300_cargo", "cargo"} <= cats("A306", None, True, True, "FDX1")
    assert {"md", "cargo"} <= cats("MD11", None, True, True, "UPS1")
    assert "md" in cats("MD88", "passenger", False, True, "DAL1")


def test_regional_jet_is_passenger_but_no_family():
    c = cats("E75L", None, False, True, "SKW1")
    assert c == {"all", "passenger"}


def test_general_aviation_only_all():
    assert cats("C172", None, False, False, "N12345") == {"all"}


# --- regions -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "lat,lon,country,state",
    [
        (33.94, -118.41, "USA", "CA"),  # LAX
        (33.85, -118.75, "USA", "CA"),  # Santa Monica Bay (offshore -> snapped)
        (40.64, -73.78, "USA", "NY"),
        (61.17, -150.0, "USA", "AK"),
        (21.32, -157.92, "USA", "HI"),
        (49.19, -123.18, "CAN", None),
        (43.68, -79.63, "CAN", None),
        (19.43, -99.13, "MEX", None),
        (32.54, -116.97, "MEX", None),  # Tijuana, right on the border
        (31.81, -106.38, "USA", "TX"),  # El Paso, right on the border
    ],
)
def test_locate(lat, lon, country, state):
    r = locate(lat, lon)
    assert (r.country, r.state) == (country, state)


def test_locate_open_ocean_and_bad_input():
    assert locate(30.0, -140.0).country is None
    assert locate(None, -118.0).country is None
    assert locate(95.0, 0.0).country is None


# --- pipeline wiring --------------------------------------------------------------------


def test_enrich_populates_categories_region_desc():
    raw = RawAircraft(
        hex="abc123", callsign="GTI8120", type_code="B748", lat=34.5, lon=-117.0,
        altitude_ft=35000, desc="BOEING 747-8F", source="test",
    )
    ac = enrich(raw, "west", Settings())
    assert ac.country == "USA" and ac.state == "CA"
    assert {"cargo", "b747", "b747_cargo"} <= set(ac.categories)
    assert ac.role == "freighter"
    assert ac.desc == "BOEING 747-8F"
    counts = traffic_counts([ac])
    assert counts["cat:b747_cargo"] == 1 and counts["country:USA"] == 1


# --- wide sweep --------------------------------------------------------------------------


def test_tiles_cover_key_cities():
    from app.domain.geo import haversine_nm

    tiles = build_tiles(250)
    assert 50 < len(tiles) < 120
    for name, lat, lon in [
        ("LAX", 33.94, -118.41), ("JFK", 40.64, -73.78), ("YVR", 49.19, -123.18),
        ("YYZ", 43.68, -79.63), ("MEX", 19.43, -99.13), ("ANC", 61.17, -150.0),
        ("MIA", 25.79, -80.29), ("CUN", 21.04, -86.87), ("YUL", 45.47, -73.74),
    ]:
        assert any(haversine_nm(lat, lon, t[0], t[1]) <= 250 for t in tiles), name


def test_wide_merge_expire_and_query():
    s = Settings(wide_max_age_seconds=1000, wide_enabled=False)
    wp = WidePoller(s, local_radius_nm=250)
    local = RawAircraft(hex="l1", callsign="UAL1", type_code="B738", lat=33.9, lon=-118.5, seen_seconds=0)
    far_tx = RawAircraft(hex="t1", callsign="FDX1", type_code="B77F", lat=32.9, lon=-97.0, seen_seconds=0)
    far_can = RawAircraft(hex="c1", callsign="ACA1", type_code="B789", lat=49.2, lon=-123.2, seen_seconds=0)
    wp._merge([local, far_tx, far_can])
    wp._rebuild()
    assert wp.latest is not None and wp.latest.counts["total"] == 3

    out, counts = wp.query()  # default excludes the LAX radius
    assert {a.hex for a in out} == {"t1", "c1"}
    out, _ = wp.query(exclude_local=False)
    assert len(out) == 3
    out, _ = wp.query(country="CAN")
    assert [a.hex for a in out] == ["c1"]
    out, _ = wp.query(state="TX", traffic="b777_cargo")
    assert [a.hex for a in out] == ["t1"]
    out, _ = wp.query(traffic="a380")
    assert out == []

    # Newer position for the same hex wins; older is ignored.
    wp._merge([RawAircraft(hex="t1", type_code="B77F", lat=33.0, lon=-96.0, seen_seconds=500)])
    assert wp._raw["t1"][1].lon == -97.0
