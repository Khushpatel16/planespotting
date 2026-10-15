from app.constants import KLAX_LAT, KLAX_LON
from app.domain.runway import assign_complex, estimate_runway


def test_assign_complex_north_and_south():
    north_side, xt_n = assign_complex(KLAX_LAT + 0.2, KLAX_LON)
    south_side, xt_s = assign_complex(KLAX_LAT - 0.2, KLAX_LON)
    assert north_side == "north"
    assert south_side == "south"
    assert xt_n > 0 and xt_s < 0


def test_west_flow_runway_assignment():
    north = estimate_runway(KLAX_LAT + 0.2, KLAX_LON, 250.0, "west")
    south = estimate_runway(KLAX_LAT - 0.2, KLAX_LON, 250.0, "west")
    assert north.runway == "24R"  # outboard north arrival
    assert south.runway == "25L"  # outboard south arrival


def test_east_flow_runway_assignment():
    north = estimate_runway(KLAX_LAT + 0.2, KLAX_LON, 250.0, "east")
    south = estimate_runway(KLAX_LAT - 0.2, KLAX_LON, 250.0, "east")
    assert north.runway == "06L"
    assert south.runway == "07R"


def test_eta_and_distance_fields():
    # ~30 nm north of the field at 300 kt.
    est = estimate_runway(KLAX_LAT + 0.5, KLAX_LON, 300.0, "west")
    assert 28 < est.distance_to_airport_nm < 32
    assert est.eta_minutes is not None
    assert 4 < est.eta_minutes < 8
    assert 0.0 <= est.bearing_to_airport < 360.0


def test_eta_none_when_slow():
    est = estimate_runway(KLAX_LAT + 0.5, KLAX_LON, 0.0, "west")
    assert est.eta_minutes is None
