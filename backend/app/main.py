"""Heavy Watch LAX - FastAPI app: live snapshot WebSocket + REST + logbook + static UI."""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

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
from app.domain.spotting import recommend_spot
from app.models import Sighting, SightingCreate, StatsResponse
from app.poller import Poller
from app.sources.photos import PhotoClient
from app import store
from app.ws import ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("hwl.main")

settings = get_settings()
manager = ConnectionManager()
poller = Poller(settings, manager)
photos = PhotoClient(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.uploads_dir, exist_ok=True)
    await store.init_db()
    await poller.start()
    log.info("Heavy Watch LAX backend ready")
    try:
        yield
    finally:
        await poller.stop()
        await photos.aclose()
        await store.dispose()


app = FastAPI(title="Heavy Watch LAX", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- API


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "clients": manager.count,
        "has_snapshot": poller.latest is not None,
        "flow_override": poller.flow_override,
    }


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
    }


@app.get("/api/snapshot")
async def snapshot():
    if poller.latest is None:
        raise HTTPException(status_code=503, detail="no snapshot yet")
    return JSONResponse(content=poller.latest.model_dump(mode="json"))


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


# --------------------------------------------------------------------------- Static UI

# Serve uploaded photos.
os.makedirs(settings.uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

# In single-service production builds, serve the compiled frontend at "/".
_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
    log.info("serving frontend from %s", _frontend_dist)
