"""Logbook persistence + stats.

SQLAlchemy async. Local dev uses SQLite (sqlite+aiosqlite); set HWL_DATABASE_URL to a
postgresql+asyncpg://... URL for managed Postgres in production - no code change.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, String, Text, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import get_settings
from app.domain.aircraft_types import classify_type
from app.models import Sighting, SightingCreate, StatsResponse

LA_TZ = ZoneInfo("America/Los_Angeles")


class Base(DeclarativeBase):
    pass


class SightingRow(Base):
    __tablename__ = "sightings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    seen_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    type_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    type_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    variant: Mapped[str | None] = mapped_column(String(64), nullable=True)
    family: Mapped[str | None] = mapped_column(String(16), nullable=True)
    registration: Mapped[str | None] = mapped_column(String(16), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(64), nullable=True)
    callsign: Mapped[str | None] = mapped_column(String(16), nullable=True)
    hex: Mapped[str | None] = mapped_column(String(8), nullable=True)
    flow: Mapped[str | None] = mapped_column(String(8), nullable=True)
    runway: Mapped[str | None] = mapped_column(String(8), nullable=True)
    spot_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(256), nullable=True)


_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def normalize_db_url(url: str) -> tuple[str, bool]:
    """Make a managed-Postgres URL work with the async (asyncpg) driver.

    Neon/Supabase/Render hand out `postgres://...` or `postgresql://...?sslmode=require`.
    SQLAlchemy-async needs the `postgresql+asyncpg://` scheme, and asyncpg rejects libpq
    query params like sslmode/channel_binding. Returns (url, ssl_required).
    """
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://") and "+asyncpg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    ssl_required = False
    parts = urlsplit(url)
    if parts.query:
        q = dict(parse_qsl(parts.query))
        if q.pop("sslmode", "") in ("require", "verify-full", "verify-ca", "prefer"):
            ssl_required = True
        q.pop("channel_binding", None)
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
    return url, ssl_required


def _ensure_engine():
    global _engine, _sessionmaker
    if _engine is None:
        url, ssl_required = normalize_db_url(get_settings().database_url)
        connect_args = {"ssl": True} if (ssl_required and "asyncpg" in url) else {}
        _engine = create_async_engine(url, future=True, connect_args=connect_args)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine, _sessionmaker


async def init_db() -> None:
    engine, _ = _ensure_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _row_to_model(row: SightingRow) -> Sighting:
    return Sighting(
        id=row.id,
        created_at=row.created_at,
        seen_at=row.seen_at,
        type_code=row.type_code,
        type_label=row.type_label,
        variant=row.variant,
        family=row.family,
        registration=row.registration,
        operator=row.operator,
        callsign=row.callsign,
        hex=row.hex,
        flow=row.flow,
        runway=row.runway,
        spot_id=row.spot_id,
        notes=row.notes,
        photo_url=row.photo_url,
    )


async def add_sighting(payload: SightingCreate, photo_url: str | None = None) -> Sighting:
    _, sm = _ensure_engine()
    assert sm is not None
    family = classify_type(payload.type_code).family if payload.type_code else None
    seen_at = payload.seen_at or datetime.now(timezone.utc)
    if seen_at.tzinfo is None:
        seen_at = seen_at.replace(tzinfo=timezone.utc)
    async with sm() as session:
        row = SightingRow(
            seen_at=seen_at,
            type_code=payload.type_code,
            type_label=payload.type_label,
            variant=payload.variant,
            family=family,
            registration=payload.registration,
            operator=payload.operator,
            callsign=payload.callsign,
            hex=payload.hex,
            flow=payload.flow,
            runway=payload.runway,
            spot_id=payload.spot_id,
            notes=payload.notes,
            photo_url=photo_url,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _row_to_model(row)


async def set_photo(sighting_id: int, photo_url: str) -> Sighting | None:
    _, sm = _ensure_engine()
    assert sm is not None
    async with sm() as session:
        row = await session.get(SightingRow, sighting_id)
        if row is None:
            return None
        row.photo_url = photo_url
        await session.commit()
        await session.refresh(row)
        return _row_to_model(row)


async def list_sightings(limit: int = 200) -> list[Sighting]:
    _, sm = _ensure_engine()
    assert sm is not None
    async with sm() as session:
        result = await session.execute(
            select(SightingRow).order_by(SightingRow.seen_at.desc()).limit(limit)
        )
        return [_row_to_model(r) for r in result.scalars().all()]


async def delete_sighting(sighting_id: int) -> bool:
    _, sm = _ensure_engine()
    assert sm is not None
    async with sm() as session:
        result = await session.execute(delete(SightingRow).where(SightingRow.id == sighting_id))
        await session.commit()
        return result.rowcount > 0


def _as_la(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LA_TZ)


async def compute_stats() -> StatsResponse:
    _, sm = _ensure_engine()
    assert sm is not None
    async with sm() as session:
        rows = list((await session.execute(select(SightingRow))).scalars().all())

    total = len(rows)
    a380_by_operator: Counter[str] = Counter()
    b747_variants: Counter[str] = Counter()
    by_family: Counter[str] = Counter()
    by_operator: Counter[str] = Counter()
    over_time: Counter[str] = Counter()
    hour_heatmap: Counter[int] = Counter()
    type_freq: Counter[str] = Counter()

    for r in rows:
        fam = r.family or "other"
        by_family[fam] += 1
        if r.operator:
            by_operator[r.operator] += 1
        if fam == "A380" and r.operator:
            a380_by_operator[r.operator] += 1
        if fam == "747":
            b747_variants[r.variant or r.type_label or r.type_code or "747"] += 1
        if r.type_code:
            type_freq[r.type_code] += 1
        la = _as_la(r.seen_at)
        over_time[la.date().isoformat()] += 1
        hour_heatmap[la.hour] += 1

    # Rarest = sightings whose type is least common in the log.
    rarity = {code: cnt for code, cnt in type_freq.items()}
    rarest_rows = sorted(
        rows,
        key=lambda r: (rarity.get(r.type_code or "", 9999), -(r.seen_at.timestamp())),
    )[:8]

    return StatsResponse(
        total=total,
        a380_by_operator=dict(a380_by_operator),
        b747_variants=dict(b747_variants),
        by_family=dict(by_family),
        by_operator=dict(by_operator),
        rarest=[_row_to_model(r) for r in rarest_rows],
        over_time=dict(sorted(over_time.items())),
        hour_heatmap={h: hour_heatmap.get(h, 0) for h in range(24)},
    )


async def dispose() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
