#!/usr/bin/env bash
# Local dev: FastAPI backend (:8000) + Vite frontend (:5173, proxies /api + /ws).
# Usage: ./dev.sh   then open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")"

# --- backend ---
cd backend

# Pick an interpreter the pinned deps have wheels for (3.10-3.13). Newer CPython releases
# (e.g. 3.14) force greenlet/pydantic-core to build from source, which fails without a
# Rust toolchain. Override with HWL_PYTHON=/path/to/python if needed.
pick_python() {
  if [ -n "${HWL_PYTHON:-}" ]; then echo "$HWL_PYTHON"; return; fi
  for p in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$p" >/dev/null 2>&1; then echo "$p"; return; fi
  done
  echo "python3"
}

# A venv copied from another machine/user (or built against a since-removed Python) has a
# dangling interpreter symlink; detect that and rebuild instead of failing on startup.
if [ -d .venv ] && ! ./.venv/bin/python -c "import uvicorn" >/dev/null 2>&1; then
  echo "Existing .venv is broken or incomplete - rebuilding..."
  rm -rf .venv
fi
if [ ! -d .venv ]; then
  PY="$(pick_python)"
  echo "Creating Python venv with $("$PY" --version 2>&1) + installing deps..."
  "$PY" -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi
./.venv/bin/uvicorn app.main:app --reload --port 8000 &
BACK_PID=$!
cd ..

# --- frontend ---
cd frontend
if [ ! -d node_modules ]; then
  echo "Installing frontend deps..."
  npm install
fi
npm run dev &
FRONT_PID=$!
cd ..

trap 'echo "shutting down..."; kill $BACK_PID $FRONT_PID 2>/dev/null || true' INT TERM
echo ""
echo "  Backend : http://localhost:8000  (API + WebSocket)"
echo "  Frontend: http://localhost:5173  <- open this"
echo ""
wait
