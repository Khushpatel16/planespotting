"""Origin/destination lookup per callsign.

Uses the VRS standing-data static dataset published by adsb.lol
(https://vrs-standing-data.adsb.lol/routes/{CS[:2]}/{CS}.json): one small CDN-cached
JSON per callsign with "airport_codes" like "OMDB-KLAX" (ICAO, "-"-separated legs).
The interactive routeset API was flaky in testing, and static files are politer anyway.
Results are cached per callsign (positive + negative TTLs) and fresh lookups are capped
per tick.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.models import RawAircraft

log = logging.getLogger("hwl.routes")

UNKNOWN_TOKENS = {"", "UNKNOWN", "NONE", "XXXX", "ZZZZ"}

# Airline-style callsigns only (dataset is keyed by 2+ letter prefix); GA tail numbers
# like N12AB aren't in the route dataset.
CALLSIGN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{1,6}$")


@dataclass(frozen=True)
class Route:
    origin: str | None
    destination: str | None


def parse_route_record(rec: dict) -> tuple[str, Route] | None:
    """Parse one route record into (callsign, Route). None when unusable."""
    callsign = str(rec.get("callsign") or "").strip().upper()
    if not callsign:
        return None
    codes = str(rec.get("airport_codes") or "").strip().upper()
    legs = [c for c in codes.split("-") if c and c not in UNKNOWN_TOKENS]
    if len(legs) < 2:
        return callsign, Route(origin=None, destination=None)
    # Multi-leg routes (A-B-C): the first leg is the origin, the last is the destination.
    return callsign, Route(origin=legs[0], destination=legs[-1])


class RouteClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = client or httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self._owns_client = client is None
        # callsign -> (Route | None, expires_at). None = negative-cached unknown.
        self._cache: dict[str, tuple[Route | None, float]] = {}

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _cached(self, callsign: str) -> tuple[bool, Route | None]:
        hit = self._cache.get(callsign)
        if hit is None:
            return False, None
        route, expires = hit
        if time.monotonic() > expires:
            del self._cache[callsign]
            return False, None
        return True, route

    def _store(self, callsign: str, route: Route | None) -> None:
        ttl = (
            self.settings.route_cache_ttl_seconds
            if route is not None and route.destination
            else self.settings.route_negative_ttl_seconds
        )
        self._cache[callsign] = (route, time.monotonic() + ttl)
        # Bounded cache: drop the soonest-expiring entries when it grows too large.
        if len(self._cache) > 4000:
            for key in sorted(self._cache, key=lambda k: self._cache[k][1])[:1000]:
                del self._cache[key]

    async def _fetch_one(self, cs: str, routes: dict[str, Route], sem: asyncio.Semaphore) -> None:
        url = f"{self.settings.route_base}/{cs[:2]}/{cs}.json"
        try:
            async with sem:
                r = await self._client.get(url)
        except Exception as e:  # noqa: BLE001 - routes are optional enrichment
            log.debug("route fetch failed for %s: %s", cs, e)
            return  # transport error: don't cache, retry next tick
        if r.status_code == 404:
            self._store(cs, None)
            return
        if r.status_code != 200:
            return
        try:
            rec = r.json()
        except ValueError:
            self._store(cs, None)
            return
        parsed = parse_route_record(rec if isinstance(rec, dict) else {})
        route = parsed[1] if parsed else None
        if route and route.destination:
            self._store(cs, route)
            routes[cs] = route
        else:
            self._store(cs, None)

    async def lookup(self, aircraft: list[RawAircraft]) -> dict[str, Route]:
        """Return {callsign: Route} for the given aircraft, cache-first."""
        if not self.settings.route_lookup_enabled:
            return {}

        routes: dict[str, Route] = {}
        to_fetch: list[str] = []
        seen: set[str] = set()
        for ac in aircraft:
            cs = (ac.callsign or "").strip().upper()
            if not cs or cs in seen or not CALLSIGN_RE.match(cs):
                continue
            seen.add(cs)
            hit, route = self._cached(cs)
            if hit:
                if route is not None:
                    routes[cs] = route
            elif len(to_fetch) < self.settings.route_max_new_per_tick:
                to_fetch.append(cs)

        if to_fetch:
            sem = asyncio.Semaphore(8)
            await asyncio.gather(*(self._fetch_one(cs, routes, sem) for cs in to_fetch))
        return routes
