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
    # adsb.lol is primary (ADSBExchange-compatible, ODbL). adsb.fi is a key-less open-data
    # mirror with the same schema. airplanes.live now requires prior approval by email
    # (returns 403 otherwise) so it is kept last; it works once your IP is allow-listed.
    adsb_sources: str = "adsblol,adsbfi,airplaneslive"
    adsblol_base: str = "https://api.adsb.lol/v2"
    adsbfi_base: str = "https://opendata.adsb.fi/api/v2"
    airplaneslive_base: str = "https://api.airplanes.live/v2"
    # How long to skip a source after it rejects us outright (403) vs. rate-limits us (429).
    adsb_forbidden_cooldown_seconds: float = 600.0
    adsb_ratelimit_cooldown_seconds: float = 30.0
    # Upstream APIs (planespotters.net especially) require a contact URL or email in the
    # User-Agent. Set HWL_USER_AGENT with YOUR real contact; this default is a placeholder.
    user_agent: str = "HeavyWatchLAX/1.0 (contact: set-HWL_USER_AGENT@example.com)"

    # --- North-America-wide coverage (slow tile sweep, separate from the LAX poller) ---
    # The continent is covered by ~70 overlapping 250 nm tiles fetched one at a time at a
    # polite pace, so a full sweep takes ~1.5-2 min. The LAX picture stays on its own fast
    # 7 s loop; the wide layer is merged on the client for everything outside that radius.
    wide_enabled: bool = True
    wide_sources: str = "adsbfi,adsblol"  # tried in order per tile (own cooldown state)
    wide_tile_interval_seconds: float = 1.5  # adsb.fi asks for <= 1 req/s per IP (shared with the LAX poller)
    wide_sweep_pause_seconds: float = 8.0  # breather between sweeps
    wide_tile_radius_nm: float = 250.0
    wide_max_age_seconds: float = 360.0  # drop aircraft not seen by any tile for this long
    wide_max_aircraft: int = 6000  # hard cap on the merged wide picture

    # --- Live ATC captions (server-side Whisper on the LiveATC stream being played) ---
    # The backend pulls its own copy of the stream, cuts it into transmissions on squelch
    # silence and transcribes each with faster-whisper. medium.en is the sweet spot for
    # radio phraseology (callsigns/runways mostly right) and runs ~2x real time on an
    # 8-core CPU; use small.en on weak machines, large-v3-turbo if you have a GPU.
    atc_transcribe_enabled: bool = True
    atc_transcribe_model: str = "medium.en"
    atc_transcribe_device: str = "cpu"  # "cuda" with a CTranslate2 CUDA build
    atc_transcribe_compute: str = "int8"  # int8 | int8_float16 | float16 | float32
    atc_transcribe_threads: int = 0  # 0 = auto (min(8, cores))
    atc_transcribe_beam: int = 5
    atc_transcribe_preload: bool = True  # load the model at boot (first run downloads it)
    atc_transcribe_history: int = 200  # lines replayed to a client that (re)connects
    atc_transcribe_max_backlog: int = 8  # pending transmissions before we start dropping
    atc_transcribe_max_lag_seconds: float = 60.0  # skip audio older than this
    atc_idle_stop_seconds: float = 20.0  # keep captioning this long after the last listener
    atc_max_sessions: int = 6  # feeds captioned at once (each is one extra LiveATC listener)
    atc_stream_base: str = "https://d.liveatc.net"
    # LiveATC returns 403 to non-browser clients; a browser UA is all it checks.
    atc_stream_user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.4 Safari/605.1.15"
    )

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
    def wide_source_list(self) -> list[str]:
        return [s.strip() for s in self.wide_sources.split(",") if s.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
