# Heavy Watch LAX — single-service image.
# Stage 1 builds the React frontend; Stage 2 serves it from the FastAPI backend,
# which also runs the ADS-B poll loop and the WebSocket push.

# ---------- Stage 1: build frontend ----------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: backend runtime ----------
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
# main.py serves /app/frontend/dist at "/" when present.
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# Default to a writable uploads volume; override DATABASE_URL for managed Postgres.
ENV HWL_UPLOADS_DIR=/data/uploads
ENV PORT=8000
EXPOSE 8000

WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
