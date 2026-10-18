"""Country (USA / Canada / Mexico) + US-state lookup for a lat/lon.

Point-in-polygon against vendored Natural Earth 1:110m boundaries (public domain). The
110m set is deliberately coarse (~10 km at coastlines), so a position that misses every
polygon is snapped to the nearest boundary vertex within SNAP_DEG - that keeps arrivals
over Santa Monica Bay or the Gulf flagged as USA instead of "offshore". Results are
memoised on a 0.1 deg grid because aircraft cluster heavily and a tick may hold thousands.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "data" / "na_boundaries.json"

SNAP_DEG = 1.0  # ~60 nm: how far offshore we still attribute a position to the coast
COUNTRY_NAMES = {"USA": "United States", "CAN": "Canada", "MEX": "Mexico"}


@dataclass(frozen=True)
class Region:
    country: str | None  # "USA" | "CAN" | "MEX" | None
    state: str | None  # US postal code, e.g. "CA"; None outside the US


NOWHERE = Region(country=None, state=None)


@dataclass
class _Shape:
    code: str
    name: str
    country: str
    rings: list[list[list[float]]]  # outer rings only ([lon, lat] points)
    bboxes: list[tuple[float, float, float, float]]  # per ring: minlon, minlat, maxlon, maxlat


def _ring_bbox(ring: list[list[float]]) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def _point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray-casting test (even-odd) against one closed ring."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


class RegionIndex:
    def __init__(self, path: Path = _DATA):
        raw = json.loads(path.read_text())
        self.states: list[_Shape] = [
            _Shape(
                code=s["code"],
                name=s["name"],
                country="USA",
                rings=[poly[0] for poly in s["polys"]],
                bboxes=[_ring_bbox(poly[0]) for poly in s["polys"]],
            )
            for s in raw["states"]
        ]
        self.countries: list[_Shape] = [
            _Shape(
                code=c["code"],
                name=c["name"],
                country=c["code"],
                rings=[poly[0] for poly in c["polys"]],
                bboxes=[_ring_bbox(poly[0]) for poly in c["polys"]],
            )
            for c in raw["countries"]
        ]
        self.state_names: dict[str, str] = {s.code: s.name for s in self.states}
        self._memo: dict[tuple[int, int], Region] = {}

    # -- exact tests -------------------------------------------------------------------

    @staticmethod
    def _hit(shape: _Shape, lon: float, lat: float) -> bool:
        for ring, (x0, y0, x1, y1) in zip(shape.rings, shape.bboxes):
            if x0 <= lon <= x1 and y0 <= lat <= y1 and _point_in_ring(lon, lat, ring):
                return True
        return False

    def _exact(self, lon: float, lat: float) -> Region:
        for s in self.states:
            if self._hit(s, lon, lat):
                return Region(country="USA", state=s.code)
        for c in self.countries:
            if self._hit(c, lon, lat):
                return Region(country=c.code, state=None)
        return NOWHERE

    def _nearest(self, lon: float, lat: float) -> Region:
        """Snap to the closest boundary vertex within SNAP_DEG (coarse coastline fix)."""
        best = SNAP_DEG * SNAP_DEG
        best_region = NOWHERE
        coslat = max(0.2, math.cos(math.radians(lat)))
        for shape in (*self.states, *self.countries):
            for ring, (x0, y0, x1, y1) in zip(shape.rings, shape.bboxes):
                if lon < x0 - SNAP_DEG or lon > x1 + SNAP_DEG or lat < y0 - SNAP_DEG or lat > y1 + SNAP_DEG:
                    continue
                for px, py in ring:
                    dx = (px - lon) * coslat
                    dy = py - lat
                    d2 = dx * dx + dy * dy
                    if d2 < best:
                        best = d2
                        best_region = Region(
                            country=shape.country,
                            state=shape.code if shape.country == "USA" else None,
                        )
        return best_region

    # -- public -------------------------------------------------------------------------

    def locate(self, lat: float | None, lon: float | None) -> Region:
        if lat is None or lon is None or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return NOWHERE
        key = (int(round(lat * 10)), int(round(lon * 10)))
        hit = self._memo.get(key)
        if hit is not None:
            return hit
        region = self._exact(lon, lat)
        if region.country is None:
            region = self._nearest(lon, lat)
        if len(self._memo) > 200_000:
            self._memo.clear()
        self._memo[key] = region
        return region

    def us_states(self) -> list[tuple[str, str]]:
        return sorted(self.state_names.items(), key=lambda kv: kv[1])


@lru_cache
def get_region_index() -> RegionIndex:
    return RegionIndex()


def locate(lat: float | None, lon: float | None) -> Region:
    return get_region_index().locate(lat, lon)
