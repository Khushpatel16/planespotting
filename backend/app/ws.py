"""Minimal WebSocket fan-out manager: track clients, broadcast JSON snapshots."""

from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocket

log = logging.getLogger("hwl.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        log.info("client connected (%d total)", len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        log.info("client disconnected (%d total)", len(self._connections))

    @property
    def count(self) -> int:
        return len(self._connections)

    async def broadcast_text(self, message: str) -> None:
        async with self._lock:
            targets = list(self._connections)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001 - client vanished mid-send
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)
