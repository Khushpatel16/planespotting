"""Aircraft photo lookup via the public planespotters.net API.

Proxied through the backend because the API requires a descriptive User-Agent (browsers
can't set one) and so results can be cached server-side. Photographer credit + a link
back to planespotters.net are part of their usage terms and are passed to the client.
"""

from __future__ import annotations

import logging
import time

import httpx

from app.config import Settings

log = logging.getLogger("hwl.photos")


def parse_photo_response(data: dict) -> dict | None:
    """Extract the first photo from a planespotters /pub/photos response."""
    photos = data.get("photos")
    if not isinstance(photos, list) or not photos:
        return None
    p = photos[0]
    thumb = (p.get("thumbnail_large") or p.get("thumbnail") or {}).get("src")
    if not thumb:
        return None
    return {
        "url": thumb,
        "photographer": p.get("photographer") or "unknown",
        "link": p.get("link") or "https://www.planespotters.net",
    }


class PhotoClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = client or httpx.AsyncClient(
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
        )
        self._owns_client = client is None
        # cache key -> (payload | None, expires_at). None = no photo found.
        self._cache: dict[str, tuple[dict | None, float]] = {}

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get(self, path: str) -> dict | None:
        r = await self._client.get(f"{self.settings.photo_base}{path}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return parse_photo_response(r.json())

    async def lookup(self, hex_id: str, registration: str | None = None) -> dict | None:
        """Best photo for an airframe: try the ICAO hex first, then the registration."""
        key = f"{hex_id.lower()}|{(registration or '').upper()}"
        hit = self._cache.get(key)
        if hit is not None:
            payload, expires = hit
            if time.monotonic() < expires:
                return payload
            del self._cache[key]

        payload: dict | None = None
        try:
            payload = await self._get(f"/photos/hex/{hex_id.lower()}")
            if payload is None and registration:
                payload = await self._get(f"/photos/reg/{registration.upper()}")
        except Exception as e:  # noqa: BLE001 - photos are optional enrichment
            log.warning("photo lookup failed for %s: %s", hex_id, e)
            return None  # don't cache transport errors

        self._cache[key] = (payload, time.monotonic() + self.settings.photo_cache_ttl_seconds)
        if len(self._cache) > 2000:
            for k in sorted(self._cache, key=lambda k: self._cache[k][1])[:500]:
                del self._cache[k]
        return payload
