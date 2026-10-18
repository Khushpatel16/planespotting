"""Traffic categories: the spotter-facing filter taxonomy (passenger / cargo / per-family).

Each aircraft is tagged with a set of category ids (see TRAFFIC_CATEGORIES). The client's
"Traffic" filter picks one id and keeps aircraft whose set contains it. Classification
combines the ICAO type designator with the operator (cargo airline?) and the free-text
aircraft description some ADS-B feeds carry (e.g. "BOEING 737-7 BBJ", "BOEING 767-300F").
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# --- Category ids + labels (order = order shown in the UI) -------------------------------

TRAFFIC_CATEGORIES: list[tuple[str, str, str]] = [
    # id, label, group
    ("all", "All Traffic", "General"),
    ("passenger", "Passenger", "General"),
    ("cargo", "Cargo", "General"),
    ("a300_cargo", "A300 Cargo", "Airbus"),
    ("a320", "A320 (family)", "Airbus"),
    ("a320_cargo", "A320 Cargo", "Airbus"),
    ("a330", "A330 (family)", "Airbus"),
    ("a330_cargo", "A330 Cargo", "Airbus"),
    ("a350", "A350s", "Airbus"),
    ("a350_cargo", "A350 Cargo", "Airbus"),
    ("a380", "A380s", "Airbus"),
    ("b737", "B737 (family)", "Boeing"),
    ("b737_cargo", "B737 Cargo", "Boeing"),
    ("b747", "B747s", "Boeing"),
    ("b757", "B757s", "Boeing"),
    ("b767", "B767s", "Boeing"),
    ("b777", "B777s", "Boeing"),
    ("b747_cargo", "Cargo B747s", "Boeing"),
    ("b757_cargo", "Cargo B757s", "Boeing"),
    ("b767_cargo", "Cargo B767s", "Boeing"),
    ("b777_cargo", "Cargo B777s", "Boeing"),
    ("bbj", "BBJ (Boeing Business Jet)", "Boeing"),
    ("md", "MD (McDonnell Douglas)", "McDonnell Douglas"),
]
TRAFFIC_CATEGORY_IDS: frozenset[str] = frozenset(c[0] for c in TRAFFIC_CATEGORIES)

# --- Type-designator families -------------------------------------------------------------

A300_FAMILY = {"A306", "A30B", "A310", "A3ST"}
A320_FAMILY = {"A318", "A319", "A320", "A321", "A19N", "A20N", "A21N"}
A330_FAMILY = {"A332", "A333", "A338", "A339", "A337"}
A350_FAMILY = {"A359", "A35K"}
A380_FAMILY = {"A388"}
B737_FAMILY = {"B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
               "B37M", "B38M", "B39M", "B3XM", "B73X"}
B747_FAMILY = {"B741", "B742", "B743", "B744", "B748", "B74R", "B74S", "B74F", "BLCF", "B74D"}
B757_FAMILY = {"B752", "B753"}
B767_FAMILY = {"B762", "B763", "B764"}
B777_FAMILY = {"B772", "B773", "B77W", "B77L", "B77F", "B778", "B779"}
B787_FAMILY = {"B788", "B789", "B78X"}
MD_FAMILY = {"MD11", "MD1F", "MD81", "MD82", "MD83", "MD87", "MD88", "MD90",
             "DC10", "DC91", "DC92", "DC93", "DC94", "DC95", "DC85", "DC86", "DC87"}

# Designators that are freighters by definition (no passenger variant shares the code).
FREIGHTER_TYPES = {"B77F", "B74F", "BLCF", "A3ST", "A337", "MD1F", "B74D", "DC85", "DC86", "DC87"}

# Regional / other airliners: counted as "passenger" when not flown by a cargo operator.
REGIONAL_AIRLINERS = {
    "E170", "E75S", "E75L", "E190", "E195", "E290", "E295", "E135", "E145", "E45X",
    "CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX", "DH8A", "DH8B", "DH8C", "DH8D",
    "AT43", "AT45", "AT72", "AT75", "AT76", "B712", "BCS1", "BCS3", "SU95",
    "F100", "F70", "B461", "B462", "B463", "RJ85", "RJ1H", "SF34", "D328", "J328",
    "B703", "B720", "B721", "B722", "L101", "IL62", "IL96", "T204", "A124", "IL76",
    "A342", "A343", "A345", "A346",
}
AIRLINER_TYPES = (
    A300_FAMILY | A320_FAMILY | A330_FAMILY | A350_FAMILY | A380_FAMILY | B737_FAMILY
    | B747_FAMILY | B757_FAMILY | B767_FAMILY | B777_FAMILY | B787_FAMILY | MD_FAMILY
    | REGIONAL_AIRLINERS
)

# Boeing airframes that exist in a corporate/VIP "BBJ" configuration.
BBJ_CANDIDATE_TYPES = B737_FAMILY | B787_FAMILY | {"B77L", "B77W", "B772", "B748", "B744", "B763", "B752"}

# Free-text hints in the ADS-B "desc" field (tar1090 aircraft DB style).
_CARGO_DESC_RE = re.compile(
    r"(freighter|cargo|\bBCF\b|\bBDSF\b|\bP2F\b|\bPCF\b|\bSF\b|-\d{3}[A-Z]{0,2}F\b|-8F\b)",
    re.IGNORECASE,
)
_BBJ_DESC_RE = re.compile(r"\bBBJ\b|business jet", re.IGNORECASE)
# ICAO airline callsign: 3 letters + digits (e.g. UAE215); registrations/private don't match.
_AIRLINE_CS_RE = re.compile(r"^[A-Z]{3}\d")


@dataclass(frozen=True)
class TrafficInfo:
    categories: frozenset[str]
    is_cargo: bool
    is_passenger: bool
    is_bbj: bool


def _family_tags(t: str, cargo: bool) -> set[str]:
    tags: set[str] = set()

    def fam(types: set[str], pax_id: str | None, cargo_id: str | None) -> None:
        if t not in types:
            return
        if pax_id:
            tags.add(pax_id)
        if cargo and cargo_id:
            tags.add(cargo_id)

    # A300: no passenger A300s left in NA service -> the family is "cargo" by nature.
    if t in A300_FAMILY:
        tags.add("a300_cargo")
    fam(A320_FAMILY, "a320", "a320_cargo")
    fam(A330_FAMILY, "a330", "a330_cargo")
    fam(A350_FAMILY, "a350", "a350_cargo")
    fam(A380_FAMILY, "a380", None)
    fam(B737_FAMILY, "b737", "b737_cargo")
    fam(B747_FAMILY, "b747", "b747_cargo")
    fam(B757_FAMILY, "b757", "b757_cargo")
    fam(B767_FAMILY, "b767", "b767_cargo")
    fam(B777_FAMILY, "b777", "b777_cargo")
    fam(MD_FAMILY, "md", None)
    return tags


def classify_traffic(
    type_code: str | None,
    type_role: str | None,
    operator_is_cargo: bool,
    operator_known: bool,
    callsign: str | None = None,
    desc: str | None = None,
) -> TrafficInfo:
    """Tag an aircraft with every traffic category it belongs to.

    type_role: PASSENGER/FREIGHTER from the type table when unambiguous, else None.
    operator_known: the callsign decoded to a known airline (scheduled operator).
    """
    t = (type_code or "").strip().upper()
    d = desc or ""
    cs = (callsign or "").strip().upper()

    is_freighter_type = t in FREIGHTER_TYPES or type_role == "freighter"
    desc_says_cargo = bool(_CARGO_DESC_RE.search(d)) if d else False
    cargo = bool(is_freighter_type or operator_is_cargo or desc_says_cargo)

    # BBJ: explicit in the description, or a Boeing airliner flying without an airline
    # callsign (private / corporate) - the usual tell for a BBJ on the radar.
    has_airline_cs = bool(_AIRLINE_CS_RE.match(cs))
    bbj = bool(_BBJ_DESC_RE.search(d)) or (
        t in BBJ_CANDIDATE_TYPES and not has_airline_cs and not cargo and not operator_known
    )
    if bbj:
        cargo = False

    passenger = (not cargo) and (not bbj) and (
        t in AIRLINER_TYPES or (operator_known and not operator_is_cargo)
    )

    tags = {"all"} | _family_tags(t, cargo)
    if cargo:
        tags.add("cargo")
    if passenger:
        tags.add("passenger")
    if bbj:
        tags.add("bbj")
    return TrafficInfo(categories=frozenset(tags), is_cargo=cargo, is_passenger=passenger, is_bbj=bbj)
