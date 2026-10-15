"""ICAO type designator -> friendly aircraft info, and the target/heavy classification.

The "target" set (747 family + A380) and the "other heavies" set are both configurable
on the client; this module just provides the canonical membership + decode used to
enrich each aircraft.
"""

from __future__ import annotations

from dataclasses import dataclass

PASSENGER = "passenger"
FREIGHTER = "freighter"

# --- The target set: 747 family + A380 ---
B747_FAMILY: set[str] = {
    "B741",  # 747-100
    "B742",  # 747-200
    "B743",  # 747-300
    "B744",  # 747-400
    "B748",  # 747-8 (Intercontinental or -8F)
    "B74R",  # 747SR
    "B74S",  # 747SP
    "B74F",  # 747-400 Freighter
    "BLCF",  # 747-400 LCF "Dreamlifter"
}
A380_TYPES: set[str] = {"A388"}  # A380-800
TARGET_TYPES: set[str] = B747_FAMILY | A380_TYPES

# --- Other heavies / widebodies that can be highlighted via a toggle ---
OTHER_HEAVY_TYPES: set[str] = {
    # 777
    "B772", "B773", "B77W", "B77L", "B77F",
    # 787
    "B788", "B789", "B78X",
    # A350
    "A359", "A35K",
    # 767
    "B762", "B763", "B764",
    # A330 / A340
    "A332", "A333", "A338", "A339", "A342", "A343", "A345", "A346",
    # Other heavy iron worth a look
    "MD11", "B752", "B753", "IL76", "A124", "C5M", "B703", "DC10",
}

_NAMES: dict[str, tuple[str, str, str, str | None]] = {
    # type: (manufacturer, friendly_name, variant, role|None)
    "B741": ("Boeing", "747-100", "747-100", PASSENGER),
    "B742": ("Boeing", "747-200", "747-200", PASSENGER),
    "B743": ("Boeing", "747-300", "747-300", PASSENGER),
    "B744": ("Boeing", "747-400", "747-400", PASSENGER),
    "B748": ("Boeing", "747-8", "747-8", None),  # -8I pax or -8F freighter; refine by operator
    "B74R": ("Boeing", "747SR", "747SR", PASSENGER),
    "B74S": ("Boeing", "747SP", "747SP", PASSENGER),
    "B74F": ("Boeing", "747-400F", "747-400F", FREIGHTER),
    "BLCF": ("Boeing", "747-400 Dreamlifter (LCF)", "747 LCF", FREIGHTER),
    "A388": ("Airbus", "A380-800", "A380-800", PASSENGER),
    "B772": ("Boeing", "777-200", "777-200", PASSENGER),
    "B773": ("Boeing", "777-300", "777-300", PASSENGER),
    "B77W": ("Boeing", "777-300ER", "777-300ER", PASSENGER),
    "B77L": ("Boeing", "777-200LR", "777-200LR", PASSENGER),
    "B77F": ("Boeing", "777F", "777F", FREIGHTER),
    "B788": ("Boeing", "787-8", "787-8", PASSENGER),
    "B789": ("Boeing", "787-9", "787-9", PASSENGER),
    "B78X": ("Boeing", "787-10", "787-10", PASSENGER),
    "A359": ("Airbus", "A350-900", "A350-900", PASSENGER),
    "A35K": ("Airbus", "A350-1000", "A350-1000", PASSENGER),
    "B762": ("Boeing", "767-200", "767-200", PASSENGER),
    "B763": ("Boeing", "767-300", "767-300", PASSENGER),
    "B764": ("Boeing", "767-400", "767-400", PASSENGER),
    "A332": ("Airbus", "A330-200", "A330-200", PASSENGER),
    "A333": ("Airbus", "A330-300", "A330-300", PASSENGER),
    "A338": ("Airbus", "A330-800neo", "A330-800", PASSENGER),
    "A339": ("Airbus", "A330-900neo", "A330-900", PASSENGER),
    "A342": ("Airbus", "A340-200", "A340-200", PASSENGER),
    "A343": ("Airbus", "A340-300", "A340-300", PASSENGER),
    "A345": ("Airbus", "A340-500", "A340-500", PASSENGER),
    "A346": ("Airbus", "A340-600", "A340-600", PASSENGER),
    "B752": ("Boeing", "757-200", "757-200", PASSENGER),
    "B753": ("Boeing", "757-300", "757-300", PASSENGER),
    "B703": ("Boeing", "707", "707", None),
    "DC10": ("McDonnell Douglas", "DC-10", "DC-10", None),
    "MD11": ("McDonnell Douglas", "MD-11", "MD-11", None),
    "IL76": ("Ilyushin", "Il-76", "Il-76", FREIGHTER),
    "A124": ("Antonov", "An-124", "An-124", FREIGHTER),
    "C5M": ("Lockheed", "C-5M Super Galaxy", "C-5M", FREIGHTER),
}


@dataclass(frozen=True)
class AircraftTypeInfo:
    icao_type: str
    manufacturer: str
    friendly_name: str
    variant: str
    role: str | None  # PASSENGER / FREIGHTER / None when ambiguous
    is_target: bool  # 747 family or A380
    is_heavy: bool  # target OR another widebody / heavy
    family: str  # "747" | "A380" | "heavy" | "other"


def classify_type(icao_type: str | None) -> AircraftTypeInfo:
    t = (icao_type or "").strip().upper()
    is_target = t in TARGET_TYPES
    is_heavy = is_target or t in OTHER_HEAVY_TYPES

    if t in B747_FAMILY:
        family = "747"
    elif t in A380_TYPES:
        family = "A380"
    elif t in OTHER_HEAVY_TYPES:
        family = "heavy"
    else:
        family = "other"

    if t in _NAMES:
        manufacturer, friendly, variant, role = _NAMES[t]
    else:
        manufacturer, friendly, variant, role = ("", t or "Unknown", t or "Unknown", None)

    return AircraftTypeInfo(
        icao_type=t,
        manufacturer=manufacturer,
        friendly_name=friendly,
        variant=variant,
        role=role,
        is_target=is_target,
        is_heavy=is_heavy,
        family=family,
    )
