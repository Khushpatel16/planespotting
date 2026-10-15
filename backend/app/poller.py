"""Background poll loop: fetch ADS-B + METAR, build a Snapshot, broadcast it.

Holds the latest snapshot so REST callers and freshly-connected WebSocket clients get an
immediate picture without waiting for the next tick.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.config import Settings
from app.constants import KLAX_LAT, KLAX_LON
from app.domain.aircraft_types import OTHER_HEAVY_TYPES, TARGET_TYPES
from app.models import Snapshot
from app.pipeline import build_snapshot
from app.sources.adsb import AdsbClient
from app.sources.metar import MetarClient
from app.sources.routes import RouteClient
from app.ws import ConnectionManager

log = logging.getLogger("hwl.poller")


class Poller:
    def __init__(self, settings: Settings, manager: ConnectionManager):
        self.settings = settings
        self.manager = manager
        self._http = httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self.adsb = AdsbClient(settings, client=self._http)
        self.metar = MetarClient(settings, client=self._http)
        self.routes = RouteClient(settings, client=self._http)
        self._latest: Snapshot | None = None
        self._flow_override: str | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()

    @property
    def latest(self) -> Snapshot | None:
        return self._latest

    @property
    def flow_override(self) -> str | None:
        return self._flow_override

    def set_flow_override(self, flow: str | None) -> None:
        self._flow_override = flow
        self._wake.set()  # rebuild on the next loop iteration immediately

    async def _tick(self) -> None:
        raw, status = await self.adsb.fetch(KLAX_LAT, KLAX_LON, self.settings.search_radius_nm)
        metar = await self.metar.fetch()
        # Route lookups only for widebodies/targets: keeps the batch small and polite,
        # and they're the aircraft spotters (and watchlist destination rules) care about.
        heavy_types = TARGET_TYPES | OTHER_HEAVY_TYPES
        heavies = [r for r in raw if (r.type_code or "").strip().upper() in heavy_types]
        routes = await self.routes.lookup(heavies)
        snapshot = build_snapshot(raw, metar, status, self.settings, self._flow_override, routes)
        self._latest = snapshot
        await self.manager.broadcast_text(snapshot.model_dump_json())

    async def _run(self) -> None:
        log.info("poller started (interval=%.1fs)", self.settings.poll_interval_seconds)
        while not self._stop.is_set():
            try:
                await self._tick()
            except Exception as e:  # noqa: BLE001 - keep the loop alive no matter what
                log.exception("poll tick failed: %s", e)
            # Sleep until the interval elapses or someone wakes us (e.g. flow override).
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.settings.poll_interval_seconds)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()

    async def start(self) -> None:
        if self._task is None:
            # Prime an initial snapshot before serving so the first client isn't empty.
            try:
                await self._tick()
            except Exception as e:  # noqa: BLE001
                log.warning("initial poll failed: %s", e)
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._task is not None:
            await self._task
            self._task = None
        await self._http.aclose()
