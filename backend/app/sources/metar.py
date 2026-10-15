"""KLAX METAR from the public aviationweather.gov data API, parsed into MetarInfo.

The wind direction/speed drive flow inference. Results are cached for the configured
interval (METARs only update ~hourly) and the last good observation is reused on error.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import httpx

from app.config import Settings
from app.models import MetarInfo

log = logging.getLogger("hwl.metar")


def _to_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_metar(raw: dict) -> MetarInfo:
    """Parse one aviationweather.gov JSON METAR record into MetarInfo."""
    wdir_raw = raw.get("wdir")
    variable = False
    wind_dir: float | None = None
    if isinstance(wdir_raw, str) and wdir_raw.upper() == "VRB":
        variable = True
    else:
        wind_dir = _to_float(wdir_raw)

    obs_epoch = raw.get("obsTime")
    observed_at = (
        datetime.fromtimestamp(obs_epoch, tz=timezone.utc) if isinstance(obs_epoch, (int, float)) else None
    )

    visib = raw.get("visib")
    return MetarInfo(
        station=raw.get("icaoId") or "KLAX",
        observed_at=observed_at,
        raw=raw.get("rawOb") or "",
        wind_dir_deg=wind_dir,
        wind_speed_kt=_to_float(raw.get("wspd")),
        wind_gust_kt=_to_float(raw.get("wgst")),
        wind_variable=variable,
        visibility=str(visib) if visib is not None else None,
        flight_category=raw.get("fltCat"),
        temp_c=_to_float(raw.get("temp")),
        altimeter_hpa=_to_float(raw.get("altim")),
    )


class MetarClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None, station: str = "KLAX"):
        self.settings = settings
        self.station = station
        self._client = client or httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self._owns_client = client is None
        self._cached: MetarInfo | None = None
        self._cached_at: float = 0.0

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def fetch(self, force: bool = False) -> MetarInfo | None:
        age = time.monotonic() - self._cached_at
        if not force and self._cached is not None and age < self.settings.metar_interval_seconds:
            return self._cached
        try:
            url = f"{self.settings.metar_base}/metar"
            r = await self._client.get(url, params={"ids": self.station, "format": "json"})
            r.raise_for_status()
            data = r.json()
            if not data:
                return self._cached
            self._cached = parse_metar(data[0])
            self._cached_at = time.monotonic()
            return self._cached
        except Exception as e:  # noqa: BLE001
            log.warning("METAR fetch failed: %s", e)
            return self._cached  # last good (possibly None)
