"""Single entrypoint for hosts that just run `python run.py` (panels, containers).

Keep the folder layout from the archive:  run.py, backend/app/..., frontend/dist/...
Port comes from PORT or SERVER_PORT (default 8000).
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")

import uvicorn  # noqa: E402

try:
    import websockets  # noqa: F401
except ImportError:
    try:
        import wsproto  # noqa: F401
    except ImportError:
        sys.exit("Missing WebSocket support (live editing needs it). Run: pip install websockets")

if __name__ == "__main__":
    port = int(os.environ.get("PORT") or os.environ.get("SERVER_PORT") or 8000)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="*")
