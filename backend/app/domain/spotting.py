"""Recommend the best spotting location for a situation: phase x flow x side.

The mapping is taken directly from the brief's location notes and encoded explicitly so
it's easy to read and audit:

  west flow arrival  -> aircraft come in from the EAST, low over the city
  west flow departure-> aircraft climb out to the WEST over the Pacific
  east flow arrival  -> aircraft come in from the WEST, low over the water
  east flow departure-> aircraft climb out to the EAST over the city
"""

from __future__ import annotations

from dataclasses import dataclass

from app.constants import SPOTS, SpottingSpot, spot_by_id

# Ordered preferred spot ids per (flow, phase[, side]). First = primary.
_RECS: dict[tuple[str, str], dict[str | None, list[str]]] = {
    ("west", "arrival"): {
        "north": ["in-n-out", "imperial-hill"],
        "south": ["imperial-hill", "proud-bird", "in-n-out"],
        None: ["in-n-out", "imperial-hill"],
    },
    ("west", "departure"): {
        None: ["dockweiler", "imperial-hill"],
    },
    ("east", "arrival"): {
        None: ["dockweiler", "imperial-hill"],
    },
    ("east", "departure"): {
        None: ["imperial-hill", "in-n-out"],
    },
}

# Where the aircraft visually appears, by (flow, phase).
_APPEARS_FROM = {
    ("west", "arrival"): "east (over the city)",
    ("west", "departure"): "west (climbing out over the Pacific)",
    ("east", "arrival"): "west (low over the ocean)",
    ("east", "departure"): "east (climbing out over the city)",
}


@dataclass(frozen=True)
class SpotRecommendation:
    flow: str
    phase: str
    side: str | None
    primary: SpottingSpot
    alternates: list[SpottingSpot]
    appears_from: str
    altitude_hint: str
    reason: str


def _altitude_hint(phase: str, distance_nm: float | None) -> str:
    if phase == "departure":
        return "climbing out (~1,000-6,000 ft and rising)"
    # arrival
    if distance_nm is not None and distance_nm <= 6:
        return "very low on short final (a few hundred to ~2,000 ft)"
    if distance_nm is not None and distance_nm <= 15:
        return "low on approach (~2,000-5,000 ft)"
    return "descending on approach"


def recommend_spot(
    flow: str,
    phase: str,
    side: str | None = None,
    distance_nm: float | None = None,
) -> SpotRecommendation:
    flow = flow.lower()
    phase = phase.lower()
    side = side.lower() if side else None

    table = _RECS.get((flow, phase))
    if table is None:
        # Fallback: Imperial Hill is the all-rounder.
        ids = ["imperial-hill"]
    else:
        ids = table.get(side) or table.get(None) or ["imperial-hill"]

    spots = [spot_by_id(i) for i in ids]
    primary = spots[0]
    alternates = spots[1:]
    appears = _APPEARS_FROM.get((flow, phase), "near the field")
    alt_hint = _altitude_hint(phase, distance_nm)

    side_txt = f" ({side} complex)" if side else ""
    reason = (
        f"{flow.title()} flow {phase}{side_txt}: traffic appears from the {appears}. "
        f"{primary.name} is the best vantage - {primary.notes}"
    )

    return SpotRecommendation(
        flow=flow,
        phase=phase,
        side=side,
        primary=primary,
        alternates=alternates,
        appears_from=appears,
        altitude_hint=alt_hint,
        reason=reason,
    )


def all_spots() -> list[SpottingSpot]:
    return list(SPOTS)
