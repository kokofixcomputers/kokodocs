"""Share links that expire: once the date passes, the link goes back to Restricted (access.py already ignores an expired link at once; this tidies the stored setting and tells the owner)."""
import asyncio
import logging
import threading
import time

from .db import connect
from . import notifications

log = logging.getLogger("uvicorn.error")
EVERY = 60


def sweep(db) -> list[str]:
    """Flip every expired link to restricted. Returns the ids of the documents that changed."""
    now = time.time()
    changed = []
    for d in db.execute("SELECT * FROM documents WHERE link_expires_at IS NOT NULL AND link_expires_at <= ?", (now,)).fetchall():
        db.execute("UPDATE documents SET link_access = 'restricted', link_expires_at = NULL WHERE id = ?", (d["id"],))
        if d["link_access"] != "restricted":
            notifications.add(db, d["owner_id"], "share", d, "KokoDocs", f"The link to “{d['title']}” expired, so it is back to Restricted.")
        changed.append(d["id"])
    for f in db.execute("SELECT * FROM folders WHERE link_expires_at IS NOT NULL AND link_expires_at <= ?", (now,)).fetchall():
        db.execute("UPDATE folders SET link_access = 'restricted', link_expires_at = NULL WHERE id = ?", (f["id"],))
        if f["link_access"] != "restricted":
            notifications.add(db, f["owner_id"], "share", {"id": "", "title": f["name"]}, "KokoDocs", f"The link to the folder “{f['name']}” expired, so it is back to Restricted.", link="/")
    db.commit()
    return changed


def loop() -> None:
    from . import collab
    while True:
        time.sleep(EVERY)
        try:
            with connect() as db:
                changed = sweep(db)
            if changed and collab._loop:
                asyncio.run_coroutine_threadsafe(collab.refresh_all(), collab._loop)   # people still connected through the old link are re-checked
        except Exception:   # noqa: BLE001
            log.exception("link expiry sweep failed")


def start() -> None:
    threading.Thread(target=loop, daemon=True, name="link-expiry").start()
