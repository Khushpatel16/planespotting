#!/usr/bin/env bash
# Local dev: FastAPI backend (:8000) + Vite frontend (:5173, proxies /api + /ws).
# Usage: ./dev.sh   then open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")"

# --- backend ---
cd backend
if [ ! -d .venv ]; then
  echo "Creating Python venv + installing deps..."
  python3 -m venv .venv
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
