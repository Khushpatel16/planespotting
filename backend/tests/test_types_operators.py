from app.domain.aircraft_types import (
    A380_TYPES,
    B747_FAMILY,
    classify_type,
)
from app.domain.operators import decode_operator


def test_all_747_family_are_targets():
    for t in B747_FAMILY:
        info = classify_type(t)
        assert info.is_target
        assert info.is_heavy
        assert info.family == "747"


def test_a380_is_target():
    info = classify_type("A388")
    assert info.is_target
    assert info.family == "A380"
    assert info.friendly_name == "A380-800"
    assert "A388" in A380_TYPES


def test_freighter_variants():
    assert classify_type("B74F").role == "freighter"
    assert classify_type("BLCF").role == "freighter"  # Dreamlifter
    assert classify_type("B744").role == "passenger"


def test_b748_role_is_ambiguous():
    # 747-8 designator covers both -8I (pax) and -8F (freighter).
    assert classify_type("B748").role is None


def test_other_heavy_not_target_but_heavy():
    info = classify_type("B77W")
    assert not info.is_target
    assert info.is_heavy
    assert info.family == "heavy"


def test_unknown_type():
    info = classify_type("C172")
    assert not info.is_target
    assert not info.is_heavy
    assert info.family == "other"


def test_case_insensitive_and_whitespace():
    assert classify_type(" b744 ").is_target
    assert classify_type(None).family == "other"


def test_operator_decode_known():
    op = decode_operator("UAE215")
    assert op.code == "UAE"
    assert op.name == "Emirates"
    assert not op.is_cargo


def test_operator_decode_cargo():
    assert decode_operator("GTI8896").name == "Atlas Air"
    assert decode_operator("GTI8896").is_cargo
    assert decode_operator("CLX455").is_cargo
    assert decode_operator("UPS2912").is_cargo


def test_operator_decode_trailing_space_callsign():
    # adsb.lol pads callsigns with spaces.
    op = decode_operator("QFA7   ")
    assert op.name == "Qantas"


def test_operator_decode_unknown_structure_keeps_code():
    op = decode_operator("ZZZ123")
    assert op.code == "ZZZ"
    assert op.name is None


def test_operator_decode_registration_is_unknown():
    # A bare registration (no airline structure) decodes to unknown.
    op = decode_operator("N123AB")
    assert op.code is None
    assert op.name is None
