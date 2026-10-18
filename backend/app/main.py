"""Heavy Watch LAX - FastAPI app: live snapshot WebSocket + REST + logbook + static UI."""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import asyncio

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.atc_transcribe import MOUNT_RE, AtcTranscriber
from app.config import get_settings
from app.constants import (
    KLAX_LAT,
    KLAX_LON,
    RUNWAYS,
    RWY_HEADING_EAST,
    RWY_HEADING_WEST,
    SPOTS,
)
from app.domain.aircraft_types import OTHER_HEAVY_TYPES, TARGET_TYPES, A380_TYPES, B747_FAMILY
from app.domain.regions import COUNTRY_NAMES, get_region_index
from app.domain.spotting import recommend_spot
from app.domain.traffic import TRAFFIC_CATEGORIES, TRAFFIC_CATEGORY_IDS
from app.models import Sighting, SightingCreate, StatsResponse
from app.poller import Poller
from app.sources.photos import PhotoClient
from app import store
from app.wide import WidePoller
from app.ws import ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("hwl.main")

settings = get_settings()
manager = ConnectionManager()
poller = Poller(settings, manager)
wide = WidePoller(settings, local_radius_nm=settings.search_radius_nm)
photos = PhotoClient(settings)
atc = AtcTranscriber(settings)
_terrain_http = httpx.AsyncClient(timeout=12.0, follow_redirects=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.uploads_dir, exist_ok=True)
    await store.init_db()
    get_region_index()  # load boundary data up front
    await poller.start()
    await wide.start()
    atc.start()
    log.info("Heavy Watch LAX backend ready")
    try:
        yield
    finally:
        atc.stop()
        await poller.stop()
        await wide.stop()
        await _terrain_http.aclose()
        await photos.aclose()
        await store.dispose()


app = FastAPI(title="Heavy Watch LAX", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# The continental picture is a few MB of JSON uncompressed; gzip takes it down ~6x.
app.add_middleware(GZipMiddleware, minimum_size=2048)


# --------------------------------------------------------------------------- API


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "clients": manager.count,
        "has_snapshot": poller.latest is not None,
        "flow_override": poller.flow_override,
        "wide": {
            "enabled": settings.wide_enabled,
            "has_data": wide.latest is not None,
            "aircraft": len(wide.latest.aircraft) if wide.latest else 0,
            "coverage": wide.latest.coverage if wide.latest else None,
        },
        "atc_captions": atc.status(),
    }


@app.get("/api/atc/captions/status")
async def atc_captions_status():
    """Whisper engine state + which feeds are being captioned right now."""
    return atc.status()


@app.get("/api/terrain/{z}/{x}/{y}")
async def terrain_tile(z: int, x: int, y: int):
    """Proxy AWS Terrarium DEM tiles (the S3 bucket has no CORS, MapLibre needs one)."""
    if z < 0 or z > 15 or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
        raise HTTPException(404)
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
    try:
        r = await _terrain_http.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"terrain upstream: {e}") from e
    if r.status_code != 200:
        raise HTTPException(404 if r.status_code == 404 else 502)
    return Response(
        content=r.content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@app.get("/api/config")
async def config():
    """Bootstrap data for the frontend: airport, runways, spots, type sets, defaults."""
    return {
        "airport": {"icao": "KLAX", "lat": KLAX_LAT, "lon": KLAX_LON},
        "runway_heading": {"west": RWY_HEADING_WEST, "east": RWY_HEADING_EAST},
        "runways": [
            {
                "pair": r.pair,
                "complex": r.complex,
                "ends": {
                    name: {"name": e.name, "lat": e.lat, "lon": e.lon, "heading": e.landing_heading}
                    for name, e in r.ends.items()
                },
            }
            for r in RUNWAYS
        ],
        "spots": [
            {
                "id": s.id,
                "name": s.name,
                "address": s.address,
                "lat": s.lat,
                "lon": s.lon,
                "notes": s.notes,
                "good_for": s.good_for,
            }
            for s in SPOTS
        ],
        "type_sets": {
            "b747_family": sorted(B747_FAMILY),
            "a380": sorted(A380_TYPES),
            "targets": sorted(TARGET_TYPES),
            "other_heavies": sorted(OTHER_HEAVY_TYPES),
        },
        "defaults": {
            "alert_radius_nm": settings.alert_radius_nm,
            "search_radius_nm": settings.search_radius_nm,
            "poll_interval_seconds": settings.poll_interval_seconds,
        },
        # Filter vocabularies for the redesigned Filters panel.
        "traffic_categories": [
            {"id": cid, "label": label, "group": group} for cid, label, group in TRAFFIC_CATEGORIES
        ],
        "countries": [{"code": c, "name": n} for c, n in COUNTRY_NAMES.items()],
        "us_states": [{"code": c, "name": n} for c, n in get_region_index().us_states()],
        "wide": {
            "enabled": settings.wide_enabled,
            "tiles": len(wide.tiles),
            "tile_radius_nm": settings.wide_tile_radius_nm,
            "refresh_hint_seconds": 20,
        },
        "atc_captions": {
            "available": atc.available,
            "model": settings.atc_transcribe_model,
            "max_sessions": settings.atc_max_sessions,
        },
    }


@app.get("/api/snapshot")
async def snapshot():
    if poller.latest is None:
        raise HTTPException(status_code=503, detail="no snapshot yet")
    return JSONResponse(content=poller.latest.model_dump(mode="json"))


@app.get("/api/wide")
async def wide_snapshot(
    country: str | None = None,
    state: str | None = None,
    traffic: str | None = None,
    include_local: bool = False,
    limit: int | None = None,
):
    """North-America-wide traffic (slow sweep), filtered server-side.

    country: USA | CAN | MEX; state: US postal code (implies USA); traffic: a category id
    from /api/config.traffic_categories. By default aircraft inside the LAX search radius
    are omitted because the live WebSocket snapshot already carries them (fresher).
    """
    if country is not None:
        country = country.strip().upper()
        if country not in COUNTRY_NAMES:
            raise HTTPException(status_code=400, detail=f"country must be one of {sorted(COUNTRY_NAMES)}")
    if state is not None:
        state = state.strip().upper()
        if state not in get_region_index().state_names:
            raise HTTPException(status_code=400, detail="unknown US state code")
        country = country or "USA"
    if traffic is not None and traffic not in TRAFFIC_CATEGORY_IDS:
        raise HTTPException(status_code=400, detail="unknown traffic category")
    if wide.latest is None:
        raise HTTPException(status_code=503, detail="wide sweep has not produced data yet")

    aircraft, counts = wide.query(
        country=country, state=state, traffic=traffic, exclude_local=not include_local, limit=limit
    )
    body = wide.latest.model_copy(update={"aircraft": aircraft, "counts": counts}).model_dump_json()
    return Response(content=body, media_type="application/json")


@app.post("/api/flow")
async def set_flow(body: dict):
    flow = body.get("flow")
    if flow not in (None, "west", "east"):
        raise HTTPException(status_code=400, detail="flow must be 'west', 'east', or null")
    poller.set_flow_override(flow)
    return {"flow_override": flow}


@app.get("/api/recommend")
async def recommend(flow: str, phase: str, side: str | None = None, distance_nm: float | None = None):
    if flow not in ("west", "east"):
        raise HTTPException(status_code=400, detail="flow must be 'west' or 'east'")
    if phase not in ("arrival", "departure"):
        raise HTTPException(status_code=400, detail="phase must be 'arrival' or 'departure'")
    rec = recommend_spot(flow, phase, side=side, distance_nm=distance_nm)
    return {
        "flow": rec.flow,
        "phase": rec.phase,
        "side": rec.side,
        "appears_from": rec.appears_from,
        "altitude_hint": rec.altitude_hint,
        "reason": rec.reason,
        "primary": {"id": rec.primary.id, "name": rec.primary.name, "notes": rec.primary.notes,
                    "lat": rec.primary.lat, "lon": rec.primary.lon},
        "alternates": [{"id": s.id, "name": s.name} for s in rec.alternates],
    }


@app.get("/api/photo/{hex_id}")
async def aircraft_photo(hex_id: str, reg: str | None = None):
    """Thumbnail + credit for an airframe (planespotters.net, cached server-side)."""
    photo = await photos.lookup(hex_id, reg)
    if photo is None:
        raise HTTPException(status_code=404, detail="no photo found")
    return photo


# --------------------------------------------------------------------------- Logbook


@app.get("/api/sightings", response_model=list[Sighting])
async def get_sightings(limit: int = 200):
    return await store.list_sightings(limit=limit)


@app.post("/api/sightings", response_model=Sighting)
async def create_sighting(payload: SightingCreate):
    return await store.add_sighting(payload)


@app.post("/api/sightings/{sighting_id}/photo", response_model=Sighting)
async def upload_photo(sighting_id: int, file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="unsupported image type")
    fname = f"{sighting_id}-{uuid.uuid4().hex[:8]}{ext}"
    dest = Path(settings.uploads_dir) / fname
    dest.write_bytes(await file.read())
    updated = await store.set_photo(sighting_id, f"/uploads/{fname}")
    if updated is None:
        raise HTTPException(status_code=404, detail="sighting not found")
    return updated


@app.delete("/api/sightings/{sighting_id}")
async def remove_sighting(sighting_id: int):
    ok = await store.delete_sighting(sighting_id)
    if not ok:
        raise HTTPException(status_code=404, detail="sighting not found")
    return {"deleted": sighting_id}


@app.get("/api/stats", response_model=StatsResponse)
async def stats():
    return await store.compute_stats()


# --------------------------------------------------------------------------- WebSocket


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send the current picture immediately so the client isn't blank.
        if poller.latest is not None:
            await ws.send_text(poller.latest.model_dump_json())
        while True:
            # We don't expect client messages; this keeps the socket open / detects close.
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:  # noqa: BLE001
        await manager.disconnect(ws)


@app.websocket("/ws/atc/{mount}")
async def ws_atc_captions(ws: WebSocket, mount: str, hint: str | None = None):
    """Live captions for one LiveATC mount.

    Server -> client messages:
      {"type":"atc_status", stream, engine, model, detail, backlog, ...}
      {"type":"atc_lines", "lines":[...]}   (history on connect)
      {"type":"atc_line",  "line": {id, mount, t, duration, text, confidence, low, latency}}
    The client sends nothing (anything it does send is ignored); closing the socket is the
    unsubscribe. The feed keeps being captioned for a short grace period after the last
    listener leaves so a tab switch / reconnect doesn't lose the model's warm state.
    """
    await ws.accept()
    mount = mount.lower()
    if not MOUNT_RE.match(mount):
        await ws.send_json({"type": "atc_status", "mount": mount, "stream": "error", "engine": "error", "detail": "invalid mount"})
        await ws.close(code=1008)
        return
    if not atc.available:
        await ws.send_json(
            {
                "type": "atc_status",
                "mount": mount,
                "stream": "stopped",
                "engine": "unavailable",
                "model": settings.atc_transcribe_model,
                "detail": (
                    "captions disabled (HWL_ATC_TRANSCRIBE_ENABLED=false)"
                    if not settings.atc_transcribe_enabled
                    else "install faster-whisper and av in the backend environment to enable captions"
                ),
            }
        )
        # Keep the socket open so the client doesn't hammer reconnects; it closes when done.
        try:
            while True:
                await ws.receive_text()
        except Exception:  # noqa: BLE001
            return
        return

    try:
        session, q = atc.subscribe(mount, hint)
    except RuntimeError as e:
        await ws.send_json({"type": "atc_status", "mount": mount, "stream": "error", "engine": atc.worker.status, "detail": str(e)})
        await ws.close(code=1013)
        return

    async def _reader() -> None:
        # We never expect client payloads; this just surfaces the disconnect.
        while True:
            await ws.receive_text()

    reader_task = asyncio.ensure_future(_reader())
    try:
        await ws.send_json(session.status_message())
        if session.history:
            await ws.send_json({"type": "atc_lines", "mount": mount, "lines": list(session.history)})
        while True:
            get_task = asyncio.ensure_future(q.get())
            done, _ = await asyncio.wait({get_task, reader_task}, return_when=asyncio.FIRST_COMPLETED, timeout=15.0)
            if get_task in done:
                await ws.send_text(get_task.result())
            else:
                get_task.cancel()
                await asyncio.sleep(0)
                # Cancelling a Queue.get() that just completed would drop that line; rescue it.
                if get_task.done() and not get_task.cancelled():
                    await ws.send_text(get_task.result())
            if reader_task in done:
                break
            if get_task not in done:
                await ws.send_json(session.status_message())  # heartbeat + fresh engine state
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:  # noqa: BLE001
        log.exception("atc captions socket failed for %s", mount)
    finally:
        reader_task.cancel()
        atc.unsubscribe(session, q)


# --------------------------------------------------------------------------- Static UI

# Serve uploaded photos.
os.makedirs(settings.uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

# In single-service production builds, serve the compiled frontend at "/".
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
    log.info("serving frontend from %s", _frontend_dist)
