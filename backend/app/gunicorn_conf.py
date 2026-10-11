"""How KokoDocs runs in production: gunicorn with ONE worker (open documents live in the process), and a watcher that reloads it by itself.

When a .py file under backend/ changes, the master waits until the files stop changing (an upload of many files takes a moment), checks that every
file still compiles (a half-uploaded or broken file must never take the site down), then does a graceful reload: the new worker starts before the old
one stops, so no request is refused and open pages reconnect on their own. Turn it off with KOKO_AUTORELOAD=0.

Use:  gunicorn -c app/gunicorn_conf.py app.main:app      (from the backend folder)      (run.py does exactly this when gunicorn is installed)"""
import os
import signal
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # backend/
port = os.environ.get("PORT") or os.environ.get("SERVER_PORT") or "8000"
bind = os.environ.get("KOKO_BIND", f"0.0.0.0:{port}")
workers = 1
worker_class = "uvicorn.workers.UvicornWorker"
graceful_timeout = 10
timeout = 60
forwarded_allow_ips = os.environ.get("KOKO_FORWARDED_ALLOW_IPS", "*")
accesslog = None

SETTLE = 2.0   # seconds without further changes before reloading


def _snapshot() -> dict[str, tuple[int, int]]:
    out = {}
    for base in (ROOT / "app", ROOT / "main.py"):
        files = [base] if base.is_file() else base.rglob("*.py") if base.exists() else []
        for f in files:
            if "__pycache__" in f.parts:
                continue
            try:
                st = f.stat()
                out[str(f)] = (st.st_mtime_ns, st.st_size)
            except OSError:
                pass
    return out


def _broken(paths) -> str | None:
    for p in sorted(paths):
        if not os.path.exists(p):
            continue
        try:
            compile(Path(p).read_bytes(), p, "exec")
        except SyntaxError as e:
            return f"{p}, line {e.lineno}: {e.msg}"
        except Exception as e:   # noqa: BLE001  (unreadable for a moment while being uploaded: try again at the next change)
            return f"{p}: {e}"
    return None


def _watch(master_pid: int) -> None:
    state = {"seen": _snapshot(), "pending": set(), "last": 0.0}
    while True:
        time.sleep(1)
        try:
            now = _snapshot()
            changed = {p for p in set(now) | set(state["seen"]) if now.get(p) != state["seen"].get(p)}
            state["seen"] = now
            if changed:
                state["pending"] |= changed
                state["last"] = time.time()
            if state["pending"] and time.time() - state["last"] >= SETTLE:
                bad = _broken(state["pending"])
                if bad:
                    print(f"KokoDocs: code changed but NOT reloaded (the new code doesn't compile): {bad}", flush=True)
                else:
                    print(f"KokoDocs: {len(state['pending'])} file(s) changed, reloading with no downtime", flush=True)
                    os.kill(master_pid, signal.SIGHUP)
                state["pending"] = set()
        except Exception as e:   # noqa: BLE001  (the watcher must never die)
            print(f"KokoDocs: autoreload check failed: {e}", flush=True)


def on_starting(server):
    if os.environ.get("KOKO_AUTORELOAD", "1") != "0":
        threading.Thread(target=_watch, args=(os.getpid(),), daemon=True, name="koko-autoreload").start()
