"""KLAX domain constants.

Coordinates are decimal degrees (WGS84). Runway thresholds and spotting locations
are encoded from published data and the brief's seeds; they are approximate but good
enough for the explicitly-heuristic ETA / runway / recommendation model.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Airport reference point (ARP).
KLAX_LAT = 33.9416
KLAX_LON = -118.4085
KLAX_ELEV_FT = 125.0

# All four runways are physically parallel. True bearings (not magnetic):
#   landing to the WEST (24/25 direction) ~= 250.7 deg true
#   landing to the EAST (06/07 direction) ~=  70.7 deg true
RWY_HEADING_WEST = 250.7
RWY_HEADING_EAST = 70.7


@dataclass(frozen=True)
class RunwayEnd:
    name: str  # e.g. "24R"
    lat: float
    lon: float
    landing_heading: float  # true bearing an aircraft flies while landing on this end


@dataclass(frozen=True)
class Runway:
    pair: str  # e.g. "06L/24R"
    complex: str  # "north" or "south"
    ends: dict[str, RunwayEnd]


# North-to-south, the four runways are:
#   06L/24R (north, outboard)  -> outboard north complex
#   06R/24L (north, inboard)
#   07L/25R (south, inboard)
#   07R/25L (south, outboard)  -> outboard south complex
RUNWAYS: list[Runway] = [
    Runway(
        pair="06L/24R",
        complex="north",
        ends={
            "06L": RunwayEnd("06L", 33.94858, -118.43130, RWY_HEADING_EAST),
            "24R": RunwayEnd("24R", 33.95548, -118.40160, RWY_HEADING_WEST),
        },
    ),
    Runway(
        pair="06R/24L",
        complex="north",
        ends={
            "06R": RunwayEnd("06R", 33.94690, -118.43480, RWY_HEADING_EAST),
            "24L": RunwayEnd("24L", 33.95540, -118.39850, RWY_HEADING_WEST),
        },
    ),
    Runway(
        pair="07L/25R",
        complex="south",
        ends={
            "07L": RunwayEnd("07L", 33.93503, -118.41942, RWY_HEADING_EAST),
            "25R": RunwayEnd("25R", 33.94322, -118.37861, RWY_HEADING_WEST),
        },
    ),
    Runway(
        pair="07R/25L",
        complex="south",
        ends={
            "07R": RunwayEnd("07R", 33.93683, -118.42517, RWY_HEADING_EAST),
            "25L": RunwayEnd("25L", 33.94440, -118.39210, RWY_HEADING_WEST),
        },
    ),
]

# Standard LAX configuration: arrivals use the OUTBOARD runways, departures the
# INBOARD ones. This is the heuristic mapping used for runway estimates.
#   west flow:  arrivals  24R (north) / 25L (south);  departures 24L / 25R
#   east flow:  arrivals  06L (north) / 07R (south);  departures 06R / 07L
ARRIVAL_RUNWAYS = {
    "west": {"north": "24R", "south": "25L"},
    "east": {"north": "06L", "south": "07R"},
}
DEPARTURE_RUNWAYS = {
    "west": {"north": "24L", "south": "25R"},
    "east": {"north": "06R", "south": "07L"},
}


def runway_end(name: str) -> RunwayEnd:
    for rwy in RUNWAYS:
        if name in rwy.ends:
            return rwy.ends[name]
    raise KeyError(f"unknown runway end {name!r}")


@dataclass(frozen=True)
class SpottingSpot:
    id: str
    name: str
    address: str
    lat: float
    lon: float
    notes: str
    # tags describe what each spot is good for, used by the recommender:
    #   flow:west / flow:east, phase:arrival / phase:departure, side:north / side:south
    good_for: list[str] = field(default_factory=list)


SPOTS: list[SpottingSpot] = [
    SpottingSpot(
        id="in-n-out",
        name="In-N-Out Burger (LAX)",
        address="9149 S Sepulveda Blvd, Los Angeles, CA 90045",
        lat=33.9520,
        lon=-118.3950,
        notes="Directly under final to the north complex (24R/25L). Low overhead passes "
        "in west flow. Iconic LAX spot, food on site.",
        good_for=["flow:west", "phase:arrival", "side:north"],
    ),
    SpottingSpot(
        id="imperial-hill",
        name="Imperial Hill / Clutter's Park",
        address="Imperial Hwy & Hangar Pl, El Segundo, CA",
        lat=33.9300,
        lon=-118.3880,
        notes="Elevated south-side park with a panoramic view of the south complex "
        "(25L/25R). The best all-rounder for both arrivals and departures.",
        good_for=[
            "flow:west",
            "flow:east",
            "phase:arrival",
            "phase:departure",
            "side:south",
        ],
    ),
    SpottingSpot(
        id="proud-bird",
        name="The Proud Bird",
        address="11022 Aviation Blvd, Los Angeles, CA 90045",
        lat=33.9450,
        lon=-118.3780,
        notes="South-side aviation-themed food hall right under final to 25R. Close-in "
        "views of south-complex traffic.",
        good_for=["flow:west", "phase:arrival", "side:south"],
    ),
    SpottingSpot(
        id="dockweiler",
        name="Dockweiler State Beach / Vista del Mar",
        address="Vista Del Mar, Playa del Rey, CA",
        lat=33.9200,
        lon=-118.4350,
        notes="West/ocean side. Best for west-flow departures climbing out over the "
        "Pacific, and east-flow arrivals coming in low over the water.",
        good_for=["flow:west", "phase:departure", "flow:east", "phase:arrival"],
    ),
]


def spot_by_id(spot_id: str) -> SpottingSpot:
    for s in SPOTS:
        if s.id == spot_id:
            return s
    raise KeyError(f"unknown spot {spot_id!r}")
