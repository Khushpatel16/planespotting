from app.domain.flow import infer_flow, manual_flow


def test_westerly_wind_gives_west_flow():
    r = infer_flow(250.0, 12.0)
    assert r.flow == "west"
    assert r.confidence == "high"
    assert r.headwind_kt_west > 0


def test_easterly_wind_gives_east_flow():
    r = infer_flow(70.0, 15.0)  # classic Santa Ana easterly
    assert r.flow == "east"
    assert r.confidence == "high"
    assert r.headwind_kt_west < 0


def test_calm_defaults_to_west_low_confidence():
    r = infer_flow(None, 0.0)
    assert r.flow == "west"
    assert r.confidence == "low"


def test_variable_wind_defaults_to_west():
    r = infer_flow(250.0, 3.0, variable=True)
    assert r.flow == "west"
    assert r.confidence == "low"


def test_light_wind_defaults_to_west():
    r = infer_flow(80.0, 4.0)  # easterly but too light to commit
    assert r.flow == "west"
    assert r.confidence == "low"


def test_crosswind_is_low_confidence():
    # Wind from ~340 is nearly perpendicular to the 250/070 runways.
    r = infer_flow(340.0, 10.0)
    assert r.confidence == "low"


def test_manual_override():
    r = manual_flow("east")
    assert r.flow == "east"
    assert r.source == "manual"
    assert r.confidence == "high"
