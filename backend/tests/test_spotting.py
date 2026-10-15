from app.domain.spotting import recommend_spot


def test_west_arrival_north_recommends_in_n_out():
    r = recommend_spot("west", "arrival", side="north", distance_nm=4)
    assert r.primary.id == "in-n-out"
    assert "east" in r.appears_from
    assert "very low" in r.altitude_hint


def test_west_arrival_south_recommends_imperial_hill():
    r = recommend_spot("west", "arrival", side="south")
    assert r.primary.id == "imperial-hill"


def test_west_departure_recommends_dockweiler():
    r = recommend_spot("west", "departure")
    assert r.primary.id == "dockweiler"
    assert "Pacific" in r.appears_from or "west" in r.appears_from
    assert "climbing" in r.altitude_hint


def test_east_arrival_recommends_dockweiler_over_water():
    r = recommend_spot("east", "arrival")
    assert r.primary.id == "dockweiler"
    assert "ocean" in r.appears_from or "west" in r.appears_from


def test_east_departure_recommends_imperial_hill():
    r = recommend_spot("east", "departure")
    assert r.primary.id == "imperial-hill"
    assert "east" in r.appears_from


def test_alternates_present():
    r = recommend_spot("west", "arrival", side="south")
    assert len(r.alternates) >= 1
    assert r.primary.id not in [a.id for a in r.alternates]
