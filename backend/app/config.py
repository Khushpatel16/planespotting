"""Application settings, loaded from environment variables (with sensible defaults).

Everything spotter-tunable lives here so the same image runs locally (SQLite) and
in production (managed Postgres) by changing env vars only.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HWL_", env_file=".env", extra="ignore")

    # --- Polling / ingestion ---
    poll_interval_seconds: float = 7.0  # adsb.lol: poll politely (~5-10s)
    metar_interval_seconds: float = 120.0  # METAR updates ~hourly; refresh cheaply
    search_radius_nm: float = 250.0  # how far out we ask the ADS-B source for traffic
    http_timeout_seconds: float = 12.0

    # --- ADS-B data sources (tried in order; first success wins) ---
    # adsb.lol is primary (ADSBExchange-compatible, ODbL). Fallbacks are compatible APIs.
    adsb_sources: str = "adsblol,airplaneslive"
    adsblol_base: str = "https://api.adsb.lol/v2"
    airplaneslive_base: str = "https://api.airplanes.live/v2"
    # Upstream APIs (planespotters.net especially) require a contact URL or email in the
    # User-Agent. Set HWL_USER_AGENT with YOUR real contact; this default is a placeholder.
    user_agent: str = "HeavyWatchLAX/1.0 (contact: set-HWL_USER_AGENT@example.com)"

    # --- OpenSky (optional final fallback; anonymous is heavily rate-limited) ---
    opensky_base: str = "https://opensky-network.org/api"
    opensky_username: str = ""
    opensky_password: str = ""

    # --- METAR ---
    metar_base: str = "https://aviationweather.gov/api/data"

    # --- Route lookup (origin/destination per callsign) via VRS standing data ---
    route_base: str = "https://vrs-standing-data.adsb.lol/routes"
    route_lookup_enabled: bool = True
    route_cache_ttl_seconds: float = 1800.0  # remember a callsign's route for 30 min
    route_negative_ttl_seconds: float = 600.0  # don't re-ask about unknown callsigns for 10 min
    route_max_new_per_tick: int = 50  # polite cap on fresh lookups per poll

    # --- Aircraft photos (planespotters.net, proxied so we can send a proper UA) ---
    photo_base: str = "https://api.planespotters.net/pub"
    photo_cache_ttl_seconds: float = 21600.0  # 6 h

    # --- Alerts / inbound detection defaults (overridable per-client) ---
    alert_radius_nm: float = 60.0
    inbound_max_altitude_ft: float = 13000.0
    inbound_descent_rate_fpm: float = -150.0  # vertical rate at/under this counts as descending

    # --- Storage ---
    # Local default = file-backed SQLite. In prod, set HWL_DATABASE_URL to a
    # postgresql+asyncpg://... URL (Neon/Supabase) and uploads_dir to a volume.
    database_url: str = "sqlite+aiosqlite:///./heavywatch.db"
    uploads_dir: str = "./uploads"

    # --- Server ---
    cors_origins: str = "*"  # comma-separated; "*" for local dev

    @property
    def adsb_source_list(self) -> list[str]:
        return [s.strip() for s in self.adsb_sources.split(",") if s.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
