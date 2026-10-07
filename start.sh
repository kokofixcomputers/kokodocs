#!/usr/bin/env bash
# Production-style: build the frontend once, then serve everything from the Python backend on :8000.
set -e
cd "$(dirname "$0")"
[ -d backend/.venv ] || { python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt; }
[ -d frontend/node_modules ] || (cd frontend && npm install)
(cd frontend && npm run build)
cd backend && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
