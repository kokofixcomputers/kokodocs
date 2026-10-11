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

def run_gunicorn() -> None:
    """The preferred way: gunicorn with one worker and a watcher that reloads it, with no downtime, whenever the backend's code changes (backend/gunicorn_conf.py).
    exec replaces this process, so gunicorn is the container's main process (docker kill -s HUP <container> also reloads it)."""
    os.execv(sys.executable, [sys.executable, "-m", "gunicorn", "-c", "app/gunicorn_conf.py", "app.main:app"])


if __name__ == "__main__":
    if os.name == "posix" and os.environ.get("KOKO_NO_GUNICORN") != "1":
        try:
            import gunicorn  # noqa: F401
        except ImportError:
            print("KokoDocs: gunicorn is not installed, so updates will restart the server (pip install gunicorn to reload with no downtime)", flush=True)
        else:
            if (ROOT / "backend" / "app" / "gunicorn_conf.py").exists():
                run_gunicorn()
            print("KokoDocs: app/gunicorn_conf.py is missing, starting without the no-downtime reload", flush=True)
    port = int(os.environ.get("PORT") or os.environ.get("SERVER_PORT") or 8000)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="*")
