"""Infer the active runway flow (west vs east) at KLAX from the wind.

Aircraft take off and land into the wind. KLAX runways run ~070/250 true:
  - WEST flow  (prevailing, ~95%): land to the WEST on 24/25, approach from the EAST
    over the city, depart west over the Pacific. Favoured by a westerly wind (~250).
  - EAST flow  ("Santa Ana"/offshore easterlies or low-vis): land to the EAST on 06/07,
    approach from the WEST over the ocean, depart east over the city. Favoured by an
    easterly wind (~070).

Heuristic: compute the headwind component for a landing to the west (runway heading
250.7). If it is positive the west runways have a headwind -> west flow; if negative the
east runways have a headwind -> east flow. Light/calm/variable winds can't decide, so we
fall back to the prevailing WEST flow and flag low confidence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.constants import RWY_HEADING_WEST

# Winds at or below this speed (kt) are treated as too light to decide direction.
LIGHT_WIND_KT = 5.0


@dataclass(frozen=True)
class FlowResult:
    flow: str  # "west" | "east"
    confidence: str  # "high" | "low"
    reason: str
    headwind_kt_west: float  # headwind component for a westbound (24/25) landing
    source: str  # "metar" | "manual" | "default"


def infer_flow(
    wind_dir_deg: float | None,
    wind_speed_kt: float | None,
    variable: bool = False,
) -> FlowResult:
    """Infer flow from wind. `variable` flags a METAR VRB wind direction."""
    speed = wind_speed_kt or 0.0

    if wind_dir_deg is None or variable or speed <= LIGHT_WIND_KT:
        why = "calm/variable wind" if (variable or wind_dir_deg is None) else f"light wind {speed:.0f}kt"
        return FlowResult(
            flow="west",
            confidence="low",
            reason=f"{why} - defaulting to prevailing west flow",
            headwind_kt_west=0.0,
            source="metar" if wind_dir_deg is not None else "default",
        )

    # Headwind component for landing to the west (flying runway heading 250.7).
    # Wind direction is the bearing the wind blows FROM, so a wind from ~250 is a
    # headwind for an aircraft heading ~250.
    delta = math.radians(wind_dir_deg - RWY_HEADING_WEST)
    headwind_west = speed * math.cos(delta)

    if headwind_west >= 0:
        flow = "west"
        reason = f"wind {wind_dir_deg:.0f}@{speed:.0f}kt gives {headwind_west:+.0f}kt headwind on 24/25"
    else:
        flow = "east"
        reason = f"wind {wind_dir_deg:.0f}@{speed:.0f}kt favours 06/07 ({headwind_west:+.0f}kt on 24/25)"

    # Near-perpendicular winds (small along-runway component) are low confidence.
    confidence = "high" if abs(headwind_west) >= 3.0 else "low"
    return FlowResult(
        flow=flow,
        confidence=confidence,
        reason=reason,
        headwind_kt_west=round(headwind_west, 1),
        source="metar",
    )


def manual_flow(flow: str) -> FlowResult:
    """Build a FlowResult for a user override."""
    flow = flow.lower()
    if flow not in ("west", "east"):
        raise ValueError("flow must be 'west' or 'east'")
    return FlowResult(
        flow=flow,
        confidence="high",
        reason="manual override",
        headwind_kt_west=0.0,
        source="manual",
    )
