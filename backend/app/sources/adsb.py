"""ADS-B ingestion with polite polling, multi-source fallback, and caching.

Primary source is adsb.lol (ODbL); fallbacks are the ADSBExchange-compatible adsb.fi
open-data API and airplanes.live (which now needs prior approval), and, as a last resort,
OpenSky. All are normalized to RawAircraft. On total failure we serve the last good
snapshot marked stale so the UI never goes dark.
"""

from __future__ import annotations

import logging
import math
import time

import httpx

from app.config import Settings
from app.models import RawAircraft

log = logging.getLogger("hwl.adsb")

M_TO_FT = 3.28084
MPS_TO_KT = 1.943844
MPS_TO_FPM = 196.850394


def _to_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize_adsbexchange(raw: dict, source: str) -> RawAircraft | None:
    """Normalize an adsb.lol / airplanes.live aircraft object (ADSBExchange schema)."""
    hexid = raw.get("hex")
    if not hexid:
        return None

    alt = raw.get("alt_baro")
    on_ground = False
    altitude_ft: float | None
    if isinstance(alt, str) and alt.lower() == "ground":
        on_ground = True
        altitude_ft = 0.0
    else:
        altitude_ft = _to_float(alt)

    vrate = raw.get("baro_rate")
    if vrate is None:
        vrate = raw.get("geom_rate")

    callsign = raw.get("flight")
    callsign = callsign.strip() if isinstance(callsign, str) else None

    return RawAircraft(
        hex=str(hexid).strip().lower(),
        callsign=callsign or None,
        registration=(raw.get("r") or None),
        type_code=(raw.get("t") or None),
        lat=_to_float(raw.get("lat")),
        lon=_to_float(raw.get("lon")),
        altitude_ft=altitude_ft,
        ground_speed_kt=_to_float(raw.get("gs")),
        track_deg=_to_float(raw.get("track")),
        vertical_rate_fpm=_to_float(vrate),
        squawk=(raw.get("squawk") or None),
        on_ground=on_ground,
        seen_seconds=_to_float(raw.get("seen")),
        source=source,
        desc=(raw.get("desc") or None),
        own_op=(raw.get("ownOp") or None),
    )


def _normalize_opensky_state(s: list, source: str) -> RawAircraft | None:
    # OpenSky /states/all rows have no type code or registration -> heavy detection
    # is impossible from this source. Included only as a last-resort position feed.
    try:
        hexid = s[0]
    except (IndexError, TypeError):
        return None
    if not hexid:
        return None
    callsign = (s[1] or "").strip() if len(s) > 1 else ""
    return RawAircraft(
        hex=str(hexid).strip().lower(),
        callsign=callsign or None,
        registration=None,
        type_code=None,
        lat=_to_float(s[6]) if len(s) > 6 else None,
        lon=_to_float(s[5]) if len(s) > 5 else None,
        altitude_ft=(_to_float(s[7]) or 0) * M_TO_FT if len(s) > 7 and s[7] is not None else None,
        ground_speed_kt=(_to_float(s[9]) or 0) * MPS_TO_KT if len(s) > 9 and s[9] is not None else None,
        track_deg=_to_float(s[10]) if len(s) > 10 else None,
        vertical_rate_fpm=(_to_float(s[11]) or 0) * MPS_TO_FPM if len(s) > 11 and s[11] is not None else None,
        squawk=(s[14] if len(s) > 14 else None),
        on_ground=bool(s[8]) if len(s) > 8 else False,
        seen_seconds=None,
        source=source,
    )


class AdsbClient:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | None = None,
        sources: list[str] | None = None,
    ):
        self.settings = settings
        self._client = client or httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self._owns_client = client is None
        # Source order is overridable so the wide sweep can prefer a different provider
        # (and keep its own cooldown bookkeeping) without touching the LAX poller's chain.
        self._sources = sources
        self._last_good: list[RawAircraft] = []
        self._last_good_at: float = 0.0
        # naive per-source cooldown after a rate-limit / error
        self._cooldown_until: dict[str, float] = {}

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _cooling_down(self, name: str) -> bool:
        return time.monotonic() < self._cooldown_until.get(name, 0.0)

    def _cooldown(self, name: str, seconds: float) -> None:
        self._cooldown_until[name] = time.monotonic() + seconds

    def all_cooling_down(self) -> float:
        """Seconds until at least one configured source is usable again (0 = now)."""
        now = time.monotonic()
        remaining = [self._cooldown_until.get(n, 0.0) - now for n in self.sources]
        if not remaining or min(remaining) <= 0:
            return 0.0
        return min(remaining)

    def _check(self, name: str, r: httpx.Response) -> None:
        """Translate rate-limit / access-denied responses into cooldowns + clear errors."""
        if r.status_code == 429:
            retry_after = _to_float(r.headers.get("retry-after"))
            secs = retry_after if retry_after else self.settings.adsb_ratelimit_cooldown_seconds
            self._cooldown(name, min(max(secs, 5.0), 300.0))
            raise RuntimeError(f"{name} rate-limited (429)")
        if r.status_code in (401, 403):
            # The source is refusing us outright (e.g. airplanes.live now requires prior
            # approval). Back off for a long while instead of retrying every tick.
            self._cooldown(name, self.settings.adsb_forbidden_cooldown_seconds)
            raise RuntimeError(f"{name} access denied ({r.status_code}) - see source's access policy")
        r.raise_for_status()

    @staticmethod
    def _aircraft_list(data: dict) -> list:
        # ADSBExchange-style feeds use "ac"; adsb.fi's open-data API uses "aircraft".
        return data.get("ac") or data.get("aircraft") or []

    async def _fetch_adsblol(self, lat: float, lon: float, dist: float) -> list[RawAircraft]:
        url = f"{self.settings.adsblol_base}/lat/{lat}/lon/{lon}/dist/{int(dist)}"
        r = await self._client.get(url)
        self._check("adsblol", r)
        return [
            ac
            for raw in self._aircraft_list(r.json())
            if (ac := _normalize_adsbexchange(raw, "adsblol")) is not None
        ]

    async def _fetch_adsbfi(self, lat: float, lon: float, dist: float) -> list[RawAircraft]:
        # adsb.fi open data: same schema as adsb.lol; radius capped at 250 nm; ~1 req/s.
        radius = min(int(dist), 250)
        url = f"{self.settings.adsbfi_base}/lat/{lat}/lon/{lon}/dist/{radius}"
        r = await self._client.get(url)
        self._check("adsbfi", r)
        return [
            ac
            for raw in self._aircraft_list(r.json())
            if (ac := _normalize_adsbexchange(raw, "adsbfi")) is not None
        ]

    async def _fetch_airplaneslive(self, lat: float, lon: float, dist: float) -> list[RawAircraft]:
        # airplanes.live caps radius at 250 nm.
        radius = min(int(dist), 250)
        url = f"{self.settings.airplaneslive_base}/point/{lat}/{lon}/{radius}"
        r = await self._client.get(url)
        self._check("airplaneslive", r)
        return [
            ac
            for raw in self._aircraft_list(r.json())
            if (ac := _normalize_adsbexchange(raw, "airplaneslive")) is not None
        ]

    async def _fetch_opensky(self, lat: float, lon: float, dist: float) -> list[RawAircraft]:
        # Convert radius to a bounding box (~1 deg lat = 60 nm).
        dlat = dist / 60.0
        dlon = dist / (60.0 * max(0.1, abs(math.cos(math.radians(lat)))))
        params = {
            "lamin": lat - dlat, "lamax": lat + dlat,
            "lomin": lon - dlon, "lomax": lon + dlon,
        }
        auth = None
        if self.settings.opensky_username:
            auth = (self.settings.opensky_username, self.settings.opensky_password)
        r = await self._client.get(f"{self.settings.opensky_base}/states/all", params=params, auth=auth)
        self._check("opensky", r)
        data = r.json()
        return [
            ac
            for s in (data.get("states") or [])
            if (ac := _normalize_opensky_state(s, "opensky")) is not None
        ]

    @property
    def sources(self) -> list[str]:
        return self._sources if self._sources is not None else self.settings.adsb_source_list

    async def fetch(
        self, lat: float, lon: float, dist_nm: float, use_cache: bool = True
    ) -> tuple[list[RawAircraft], dict[str, str]]:
        """Try each configured source in order. Returns (aircraft, status-per-source).

        use_cache=False skips the last-good fallback (for callers that query many
        different areas, where "the previous answer" would be the wrong place).
        """
        fetchers = {
            "adsblol": self._fetch_adsblol,
            "adsbfi": self._fetch_adsbfi,
            "airplaneslive": self._fetch_airplaneslive,
            "opensky": self._fetch_opensky,
        }
        status: dict[str, str] = {}
        for name in self.sources:
            fn = fetchers.get(name)
            if fn is None:
                status[name] = "unknown source"
                continue
            if self._cooling_down(name):
                status[name] = "cooling-down"
                continue
            try:
                aircraft = await fn(lat, lon, dist_nm)
                status[name] = f"ok ({len(aircraft)})"
                if use_cache:
                    self._last_good = aircraft
                    self._last_good_at = time.time()
                return aircraft, status
            except Exception as e:  # noqa: BLE001 - we want to fall through to the next source
                log.warning("ADS-B source %s failed: %s", name, e)
                status[name] = f"error: {type(e).__name__}"

        # All sources failed -> serve last good (if any), flagged stale.
        if use_cache and self._last_good:
            age = time.time() - self._last_good_at
            status["cache"] = f"stale ({age:.0f}s)"
            return self._last_good, status
        status["cache"] = "empty"
        return [], status
