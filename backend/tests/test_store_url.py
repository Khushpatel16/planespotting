from app.store import normalize_db_url


def test_sqlite_passthrough():
    url, ssl = normalize_db_url("sqlite+aiosqlite:///./x.db")
    assert url == "sqlite+aiosqlite:///./x.db"
    assert ssl is False


def test_render_postgres_scheme():
    url, ssl = normalize_db_url("postgres://u:p@host:5432/db")
    assert url == "postgresql+asyncpg://u:p@host:5432/db"
    assert ssl is False


def test_neon_sslmode_stripped_and_flagged():
    url, ssl = normalize_db_url("postgresql://u:p@ep.neon.tech/db?sslmode=require&channel_binding=require")
    assert url.startswith("postgresql+asyncpg://")
    assert "sslmode" not in url
    assert "channel_binding" not in url
    assert ssl is True
