"""North-America-wide traffic: a slow, polite tile sweep that complements the LAX poller.

The open ADS-B APIs only answer point+radius queries (max 250 nm), so the continent is
tiled with overlapping circles and fetched one tile at a time at ~1 req/s. Every aircraft
seen is merged into a hex-keyed table (newest position wins) and aged out when no tile has
reported it for a while. The result is a "wide" picture refreshed every ~1.5-2 minutes,
fully enriched with the same pipeline as the LAX snapshot (type, operator, traffic
categories, country/state), and served via GET /api/wide with server-side filtering.

The LAX picture (7 s loop, alerts, runway logic) is untouched; the client overlays it on
top of this layer.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import datetime, timezone

import httpx

from app.config import Settings
from app.constants import KLAX_LAT, KLAX_LON
from app.domain.geo import haversine_nm
from app.models import Aircraft, RawAircraft, WideSnapshot
from app.pipeline import enrich, traffic_counts
from app.sources.adsb import AdsbClient

log = logging.getLogger("hwl.wide")

# Tile rows: (latitude, west lon, east lon). Each row is covered with 250 nm circles whose
# centres are spaced so adjacent circles overlap (spacing <= r*sqrt2). Longitude extents
# follow the land mass so we don't burn requests on open ocean.
_ROWS: list[tuple[float, float, float]] = [
    (16.5, -100.0, -88.0),  # southern Mexico / Yucatan
    (21.5, -106.0, -87.0),  # central Mexico
    (26.5, -113.0, -97.0),  # northern Mexico / Baja / south Texas
    (26.5, -83.0, -80.0),  # south Florida
    (31.5, -119.0, -80.0),  # US south: SoCal -> Georgia
    (36.5, -123.5, -75.5),  # US mid: Bay Area -> Carolinas
    (41.5, -125.0, -70.0),  # US north: Oregon -> New England
    (46.5, -125.0, -60.0),  # border + southern Canada
    (51.5, -130.0, -56.0),  # southern Canada
    (57.0, -136.0, -62.0),  # central Canada / Hudson Bay
    (62.5, -166.0, -66.0),  # Alaska + northern Canada
    (68.5, -165.0, -95.0),  # Arctic Alaska / NWT (sparse)
]


def build_tiles(radius_nm: float) -> list[tuple[float, float]]:
    """Return (lat, lon) tile centres covering North America for the given radius."""
    tiles: list[tuple[float, float]] = []
    step_deg = (radius_nm / 60.0) * math.sqrt(2) * 0.95  # a touch inside the limit
    for lat, w, e in _ROWS:
        lon_step = step_deg / max(0.2, math.cos(math.radians(lat)))
        n = max(1, int(math.ceil((e - w) / lon_step)))
        actual = (e - w) / n
        for i in range(n + 1):
            tiles.append((round(lat, 2), round(w + i * actual, 2)))
    return tiles


class WidePoller:
    def __init__(self, settings: Settings, local_radius_nm: float):
        self.settings = settings
        self.local_radius_nm = local_radius_nm
        self._http = httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self.adsb = AdsbClient(settings, client=self._http, sources=settings.wide_source_list)
        self.tiles = build_tiles(settings.wide_tile_radius_nm)
        self._raw: dict[str, tuple[float, RawAircraft]] = {}  # hex -> (seen_at, raw)
        self._latest: WideSnapshot | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._sweep_started: float = 0.0
        self._last_sweep_seconds: float | None = None
        self._tile_status: dict[str, int] = {"ok": 0, "failed": 0}
        self._source_status: dict[str, str] = {}

    @property
    def latest(self) -> WideSnapshot | None:
        return self._latest

    # -- merge -----------------------------------------------------------------------------

    def _merge(self, aircraft: list[RawAircraft]) -> None:
        now = time.time()
        for ac in aircraft:
            if ac.lat is None or ac.lon is None:
                continue
            seen_at = now - (ac.seen_seconds or 0.0)
            prev = self._raw.get(ac.hex)
            if prev is None or seen_at >= prev[0]:
                self._raw[ac.hex] = (seen_at, ac)

    def _expire(self) -> None:
        cutoff = time.time() - self.settings.wide_max_age_seconds
        stale = [h for h, (t, _) in self._raw.items() if t < cutoff]
        for h in stale:
            del self._raw[h]

    def _rebuild(self) -> None:
        """Enrich the merged table into a WideSnapshot (cheap: pure Python, no I/O)."""
        self._expire()
        now = time.time()
        items = sorted(self._raw.values(), key=lambda kv: -kv[0])[: self.settings.wide_max_aircraft]
        enriched: list[Aircraft] = []
        for seen_at, raw in items:
            # Report true staleness relative to now so the client can fade old tracks.
            raw = raw.model_copy(update={"seen_seconds": round(max(0.0, now - seen_at), 1)})
            enriched.append(enrich(raw, "west", self.settings))

        counts = {"total": len(enriched), **traffic_counts(enriched)}
        self._latest = WideSnapshot(
            generated_at=datetime.now(timezone.utc),
            aircraft=enriched,
            counts=counts,
            coverage={
                "tiles": len(self.tiles),
                "tile_radius_nm": self.settings.wide_tile_radius_nm,
                "last_sweep_seconds": self._last_sweep_seconds,
                "tiles_ok": self._tile_status["ok"],
                "tiles_failed": self._tile_status["failed"],
                "sources": dict(self._source_status),
            },
            stale=self._tile_status["ok"] == 0 and bool(enriched),
        )

    # -- loop ------------------------------------------------------------------------------

    async def _sweep(self) -> None:
        started = time.monotonic()
        ok = failed = 0
        for i, (lat, lon) in enumerate(self.tiles):
            if self._stop.is_set():
                return
            # Rate-limited everywhere? Wait it out instead of burning tiles on "cooling-down".
            wait = self.adsb.all_cooling_down()
            if wait > 0:
                log.info("wide sweep paused %.0fs: all sources rate-limited", wait)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=min(wait, 90.0) + 0.5)
                    return
                except asyncio.TimeoutError:
                    pass
            try:
                aircraft, status = await self.adsb.fetch(
                    lat, lon, self.settings.wide_tile_radius_nm, use_cache=False
                )
                self._source_status = status
                if any(v.startswith("ok") for v in status.values()):
                    ok += 1
                    self._merge(aircraft)
                else:
                    failed += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                log.warning("wide tile %d (%.1f, %.1f) failed: %s", i, lat, lon, e)
            # Refresh the served picture a few times mid-sweep so clients see progress.
            # Enriching thousands of tracks takes a few hundred ms -> keep it off the loop.
            if i % 12 == 11:
                self._tile_status = {"ok": ok, "failed": failed}
                await asyncio.to_thread(self._rebuild)
            await asyncio.sleep(self.settings.wide_tile_interval_seconds)
        self._last_sweep_seconds = round(time.monotonic() - started, 1)
        self._tile_status = {"ok": ok, "failed": failed}
        await asyncio.to_thread(self._rebuild)
        log.info(
            "wide sweep done: %d tiles ok, %d failed, %d aircraft, %.0fs",
            ok, failed, len(self._raw), self._last_sweep_seconds,
        )

    async def _run(self) -> None:
        log.info("wide poller started (%d tiles, %.1fs apart)", len(self.tiles), self.settings.wide_tile_interval_seconds)
        while not self._stop.is_set():
            try:
                await self._sweep()
            except Exception as e:  # noqa: BLE001
                log.exception("wide sweep failed: %s", e)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.settings.wide_sweep_pause_seconds)
            except asyncio.TimeoutError:
                pass

    async def start(self) -> None:
        if self._task is None and self.settings.wide_enabled:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None
        await self._http.aclose()

    # -- querying ----------------------------------------------------------------------------

    def query(
        self,
        country: str | None = None,
        state: str | None = None,
        traffic: str | None = None,
        exclude_local: bool = True,
        limit: int | None = None,
    ) -> tuple[list[Aircraft], dict[str, int]]:
        """Filter the latest wide picture. Returns (aircraft, counts-after-filtering)."""
        snap = self._latest
        if snap is None:
            return [], {}
        out: list[Aircraft] = []
        inner = self.local_radius_nm - 5.0  # tiny overlap so nothing falls in a gap
        for a in snap.aircraft:
            if country and a.country != country:
                continue
            if state and a.state != state:
                continue
            if traffic and traffic != "all" and traffic not in a.categories:
                continue
            if exclude_local and a.lat is not None and a.lon is not None:
                if haversine_nm(a.lat, a.lon, KLAX_LAT, KLAX_LON) <= inner:
                    continue
            out.append(a)
        if limit is not None:
            out = out[:limit]
        counts = {"total": len(out), **traffic_counts(out)}
        return out, counts
