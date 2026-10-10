"""Moving a person's files to and from their own storage.

A document goes through three states:
  (nothing)  only on this server (new, or never moved)
  remote     only in the person's storage: its text, versions, comments and form answers are gone from this server; only its title, owner and sharing stay
  cached     opened again: a copy is on this server as well as in the storage, until it has been idle for a while and is cleared again
Pictures and form attachments are separate files in the storage; when one is asked for, it is fetched from there.
"""
import hashlib
import json
import threading
import time
from collections import OrderedDict

from fastapi import HTTPException

from ..db import FORM_FILES_DIR, UPLOAD_DIR, connect
from ..security import decrypt_secret, encrypt_secret
from . import backends, container

SECRET_FIELDS = {"s3": ("secret_key",), "webdav": ("password",), "folder": ()}
LOOP_EVERY = 30.0
GRACE_NEW = 120.0          # seconds a document must be untouched before it is moved the first time
MAX_FILE_CACHE = 48 * 1024 * 1024

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_touch: dict[str, float] = {}
_open_check = lambda doc_id: False   # set by the collaboration server: is anyone editing it right now?
_cache: "OrderedDict[str, bytes]" = OrderedDict()
_cache_bytes = 0
_cache_lock = threading.Lock()
jobs: dict[str, dict] = {}           # user id -> what the "bring everything back" job is doing
progress: dict[str, dict] = {}       # user id -> what moving files out is doing right now (or did last)
_failed_at: dict[str, float] = {}    # what failed lately, so it is not tried again every half minute


def retry(fn, tries: int = 3):
    """Run a storage call again after a short wait when the failure may be a blip (a network drop, a busy server)."""
    for i in range(tries):
        try:
            return fn()
        except backends.StorageError as e:
            if not e.transient or i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def set_open_check(f) -> None:
    global _open_check
    _open_check = f


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def touch(doc_id: str) -> None:
    _touch[doc_id] = time.time()


# ── connections ──
def row_for(db, user_id: str):
    return db.execute("SELECT * FROM storage_connections WHERE user_id = ?", (user_id,)).fetchone()


def config_of(row) -> dict:
    return json.loads(decrypt_secret(row["config_enc"]))


def backend_of(row) -> backends.Backend:
    return backends.make(row["kind"], config_of(row))


def public_config(kind: str, cfg: dict) -> dict:
    """What the page may show: everything except the secrets, with a hint of whether one is set."""
    out = {k: v for k, v in cfg.items() if k not in SECRET_FIELDS.get(kind, ())}
    for k in SECRET_FIELDS.get(kind, ()):
        out[k + "_set"] = bool(cfg.get(k))
    return out


def save_connection(db, user_id: str, kind: str, cfg: dict, *, enabled: bool, idle_minutes: int, keep_search: bool) -> str:
    """Check the connection works, then keep it (secrets encrypted). Returns the test's message."""
    if kind not in backends.KINDS:
        raise backends.StorageError("Choose where to store your files")
    old = row_for(db, user_id)
    if old and old["kind"] == kind:   # a blank field means "keep what is saved"
        prev = config_of(old)
        for k, v in prev.items():
            if not cfg.get(k):
                cfg[k] = v
    message = backends.make(kind, cfg).test()
    now = time.time()
    enc = encrypt_secret(json.dumps(cfg))
    if old:
        db.execute("UPDATE storage_connections SET kind=?, config_enc=?, enabled=?, idle_minutes=?, keep_search=?, last_ok=?, last_error='', updated_at=? WHERE user_id=?",
                   (kind, enc, int(enabled), idle_minutes, int(keep_search), now, now, user_id))
    else:
        db.execute("INSERT INTO storage_connections (user_id, kind, config_enc, enabled, idle_minutes, keep_search, last_ok, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   (user_id, kind, enc, int(enabled), idle_minutes, int(keep_search), now, now, now))
    return message


# ── files (pictures and attachments) ──
def file_key(kind: str, name: str) -> str:
    return f"files/{kind}/{name}"


def _cache_put(key: str, data: bytes) -> None:
    global _cache_bytes
    if len(data) > MAX_FILE_CACHE // 4:
        return
    with _cache_lock:
        if key in _cache:
            _cache_bytes -= len(_cache.pop(key))
        _cache[key] = data; _cache_bytes += len(data)
        while _cache_bytes > MAX_FILE_CACHE and _cache:
            _, old = _cache.popitem(last=False); _cache_bytes -= len(old)


def fetch_file(db, owner_id: str, kind: str, name: str) -> bytes | None:
    """A picture or attachment that lives in the owner's storage."""
    key = f"{owner_id}:{kind}:{name}"
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key); return _cache[key]
    row = row_for(db, owner_id)
    if not row:
        return None
    try:
        data = backend_of(row).get(file_key(kind, name))
    except backends.StorageError as e:
        raise HTTPException(503, f"Your storage could not be reached: {e}")
    if data is not None:
        _cache_put(key, data)
    return data



def _file_work(db, owner_id: str) -> list[dict]:
    """Pictures and attachments still on this server that could be moved."""
    out = []
    for u in db.execute("SELECT name, size FROM uploads WHERE owner_id = ? AND remote = 0", (owner_id,)).fetchall():
        if (UPLOAD_DIR / u["name"]).exists():
            out.append({"kind": "uploads", "name": u["name"], "key": "u:" + u["name"], "size": u["size"], "label": "a picture"})
    for f in db.execute("SELECT f.id, f.stored, f.name, f.size FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 0", (owner_id,)).fetchall():
        if (FORM_FILES_DIR / f["stored"]).exists():
            out.append({"kind": "form", "name": f["stored"], "key": "f:" + f["stored"], "id": f["id"], "size": f["size"], "label": f"the attachment {f['name']}"})
    return out


def _move_one_file(db, b, w: dict) -> None:
    path = (UPLOAD_DIR if w["kind"] == "uploads" else FORM_FILES_DIR) / w["name"]
    data = path.read_bytes()
    key = file_key(w["kind"], w["name"])
    retry(lambda: b.put(key, data))
    if retry(lambda: b.size(key)) != len(data):
        raise backends.StorageError("The storage did not keep it intact, so it was left here")
    if w["kind"] == "uploads":
        db.execute("UPDATE uploads SET remote = 1 WHERE name = ?", (w["name"],))
    else:
        db.execute("UPDATE form_files SET remote = 1 WHERE stored = ?", (w["name"],))
    db.commit()
    path.unlink(missing_ok=True)



def bring_files_back(db, row, owner_id: str, job: dict | None = None) -> list[dict]:
    """Copy pictures and attachments back from the storage. One that can't be fetched is skipped and reported; the rest carry on."""
    b, failed = backend_of(row), []
    items = [("uploads", r["name"], "a picture") for r in db.execute("SELECT name FROM uploads WHERE owner_id = ? AND remote = 1", (owner_id,)).fetchall()]
    items += [("form", r["stored"], "an attachment") for r in db.execute("SELECT f.stored FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", (owner_id,)).fetchall()]
    for kind, name, label in items:
        try:
            data = retry(lambda: b.get(file_key(kind, name)))
            if data is None:
                raise backends.StorageError(f"{label} is missing from your storage")
            (UPLOAD_DIR if kind == "uploads" else FORM_FILES_DIR).joinpath(name).write_bytes(data)
            db.execute("UPDATE uploads SET remote = 0 WHERE name = ?" if kind == "uploads" else "UPDATE form_files SET remote = 0 WHERE stored = ?", (name,)); db.commit()
            if job is not None:
                job["done"] += 1; job["bytes_done"] += len(data)
        except Exception as e:   # noqa: BLE001
            failed.append({"what": label, "error": str(e)})
            if job is not None:
                job["done"] += 1
    return failed


# ── documents ──
def doc_key(prefix_doc_id: str) -> str:
    return f"docs/{prefix_doc_id}.kokodocs"


def offload_doc(db, doc_id: str, *, force: bool = False) -> str:
    """Move one document to its owner's storage. Returns 'moved', 'cleared' (the copy there was already current) or why it was left ('open', 'busy', 'no storage'…)."""
    with _lock("doc:" + doc_id):
        d = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not d or d["zk"] or d["remote_state"] == "remote":
            return "skipped"
        row = row_for(db, d["owner_id"])
        if not row or not row["enabled"]:
            return "no storage"
        if _open_check(doc_id):
            return "open"
        b = backend_of(row)
        fp = container.fingerprint(db, doc_id)
        key = doc_key(doc_id)
        if not (d["remote_state"] == "cached" and d["remote_fp"] == fp):
            blob = container.pack(db, doc_id)
            retry(lambda: b.put(key, blob))
            sha = hashlib.sha256(blob).hexdigest()
            back = retry(lambda: b.get(key))
            if back is None or hashlib.sha256(back).hexdigest() != sha:
                raise backends.StorageError("The storage did not keep the document intact, so nothing was removed from this server")
            if container.fingerprint(db, doc_id) != fp:   # edited while it was being saved: leave it, it will be moved next time
                return "busy"
            db.execute("UPDATE documents SET remote_sha = ?, remote_fp = ?, remote_key = ?, remote_at = ?, remote_error = NULL WHERE id = ?", (sha, fp, key, time.time(), doc_id))
            outcome = "moved"
        else:
            outcome = "cleared"
        db.execute("UPDATE documents SET ydoc = NULL, remote_state = 'remote' WHERE id = ?", (doc_id,))
        for table, col in container.TABLES.items():
            db.execute(f"DELETE FROM {table} WHERE {col} = ?", (doc_id,))
        if not row["keep_search"]:
            db.execute("UPDATE doc_fts SET body = '' WHERE doc_id = ?", (doc_id,))
        db.commit()
        return outcome


def hydrate(db, doc_id: str) -> None:
    """Fetch a document back from its owner's storage so it can be opened."""
    with _lock("doc:" + doc_id):
        d = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not d or d["remote_state"] != "remote":
            return
        row = row_for(db, d["owner_id"])
        if not row:
            raise HTTPException(503, "This document is kept in storage that is no longer connected. Reconnect it in Settings → Extended storage.")
        try:
            data = retry(lambda: backend_of(row).get(d["remote_key"] or doc_key(doc_id)))
        except backends.StorageError as e:
            db.execute("UPDATE documents SET remote_error = ? WHERE id = ?", (str(e), doc_id)); db.commit()
            raise HTTPException(503, f"This document is kept in your own storage, which could not be reached: {e}")
        if data is None:
            raise HTTPException(503, "This document's file is missing from the owner's storage.")
        if d["remote_sha"] and hashlib.sha256(data).hexdigest() != d["remote_sha"]:
            raise HTTPException(503, "This document's file in the owner's storage has been changed or damaged, so it was not opened.")
        try:
            _, z = container.read(data)
            container.restore(db, doc_id, z)
        except container.ContainerError as e:
            raise HTTPException(503, f"This document's file in the owner's storage could not be read: {e}")
        db.execute("UPDATE documents SET remote_state = 'cached', remote_error = NULL WHERE id = ?", (doc_id,))
        db.commit()
        touch(doc_id)
        try:
            from .. import searchindex
            searchindex.index_doc(db, doc_id)
            db.commit()
        except Exception:
            pass


def ensure_local(db, doc_id: str) -> None:
    """Called wherever a document is about to be read: brings it back if it is in the owner's storage, and notes that it is in use."""
    r = db.execute("SELECT remote_state FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if r and r["remote_state"]:
        touch(doc_id)
        if r["remote_state"] == "remote":
            hydrate(db, doc_id)


def forget_doc(db, owner_id: str, doc_id: str) -> None:
    """A document was deleted for good: remove its file from the storage too."""
    row = row_for(db, owner_id)
    if not row:
        return
    try:
        backend_of(row).delete(doc_key(doc_id))
    except backends.StorageError:
        pass


# ── the background loop ──

_sweeping: set[str] = set()


def sweep_user(db, row, uid: str) -> dict:
    """Move what is ready to the person's storage, showing progress, and carry on past anything that fails (it is listed, and tried again later)."""
    if uid in _sweeping:
        return {}
    _sweeping.add(uid)
    try:
        return _sweep(db, row, uid)
    finally:
        _sweeping.discard(uid)


def _sweep(db, row, uid: str) -> dict:
    now = time.time(); manual = bool(row["move_now"])
    idle = max(1, row["idle_minutes"]) * 60
    idle_new, idle_cached = (0, 0) if manual else (GRACE_NEW, idle)
    skip = lambda key: not manual and now - _failed_at.get(f"{uid}:{key}", 0) < 120   # failed a moment ago: not again straight away
    files = [w for w in _file_work(db, uid) if not skip(w["key"])]
    docs = []
    for d in db.execute("SELECT id, title, updated_at, remote_state, COALESCE(LENGTH(ydoc), 0) + (SELECT COALESCE(SUM(LENGTH(v.ydoc)), 0) FROM versions v WHERE v.doc_id = documents.id) AS bytes FROM documents "
                        "WHERE owner_id = ? AND zk = 0 AND deleted_at IS NULL AND (remote_state IS NULL OR remote_state = 'cached')", (uid,)).fetchall():
        last = max(_touch.get(d["id"], 0), d["updated_at"] or 0)
        if now - last >= (idle_cached if d["remote_state"] == "cached" else idle_new) and not skip("d:" + d["id"]):
            docs.append(d)
    out = {"moved": 0, "cleared": 0, "files": 0}
    if not files and not docs:
        db.execute("UPDATE storage_connections SET move_now = 0 WHERE user_id = ?", (uid,)); db.commit()
        return out
    P = progress[uid] = {"running": True, "phase": "files", "docs_total": len(docs), "docs_done": 0, "files_total": len(files), "files_done": 0,
                         "bytes_total": sum(w["size"] for w in files) + sum(d["bytes"] for d in docs), "bytes_done": 0, "current": "", "failed": [], "started_at": now, "finished_at": None}
    b = backend_of(row)

    def fail(key: str, what: str, e: Exception) -> None:
        _failed_at[f"{uid}:{key}"] = time.time()
        P["failed"].append({"what": what, "error": str(e) if isinstance(e, backends.StorageError) else f"Something went wrong ({type(e).__name__})"})
        del P["failed"][:-50]

    try:
        for w in files:   # pictures and attachments first, so a form's file list is saved already marked as moved
            P["current"] = w["label"]
            try:
                _move_one_file(db, b, w); out["files"] += 1; P["bytes_done"] += w["size"]
            except Exception as e:   # noqa: BLE001
                fail(w["key"], w["label"], e)
            P["files_done"] += 1
        P["phase"] = "documents"
        for d in docs:
            P["current"] = d["title"] or "Untitled"
            try:
                r = offload_doc(db, d["id"])
                if r in ("moved", "cleared"):
                    out[r] += 1
                P["bytes_done"] += d["bytes"]
            except Exception as e:   # noqa: BLE001
                fail("d:" + d["id"], d["title"] or "a document", e)
                try:
                    db.execute("UPDATE documents SET remote_error = ? WHERE id = ?", (P["failed"][-1]["error"], d["id"])); db.commit()
                except Exception:   # noqa: BLE001
                    pass
            P["docs_done"] += 1
    finally:
        P.update(running=False, phase="done", current="", finished_at=time.time(), moved_docs=out["moved"] + out["cleared"], moved_files=out["files"])
        last_error = P["failed"][-1]["error"] if P["failed"] else ""
        try:
            db.execute("UPDATE storage_connections SET last_ok = ?, last_error = ?, move_now = 0 WHERE user_id = ?", (time.time() if (out["files"] or out["moved"] or out["cleared"] or not P["failed"]) else row["last_ok"], last_error, uid)); db.commit()
        except Exception:   # noqa: BLE001
            pass
    return out


def loop() -> None:
    while True:
        time.sleep(LOOP_EVERY)
        try:
            with connect() as db:
                for row in db.execute("SELECT * FROM storage_connections WHERE enabled = 1").fetchall():
                    if row["user_id"] in jobs and jobs[row["user_id"]].get("running"):
                        continue
                    try:
                        sweep_user(db, row, row["user_id"])
                    except Exception:   # noqa: BLE001  (one person's trouble must not stop the others, or the loop)
                        pass
        except Exception:
            pass


def start() -> None:
    threading.Thread(target=loop, daemon=True, name="extstore").start()


# ── bring everything back, and the numbers ──

def restore_all(uid: str) -> None:
    """Bring everything back and switch the storage off, carrying on past anything that can't be fetched (it is listed, and the storage stays on so it can be tried again)."""
    job = jobs[uid] = {"running": True, "done": 0, "total": 0, "bytes_done": 0, "error": "", "failed": []}
    try:
        with connect() as db:
            row = row_for(db, uid)
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE owner_id = ? AND remote_state = 'remote'", (uid,))]
            nfiles = db.execute("SELECT COUNT(*) FROM uploads WHERE owner_id = ? AND remote = 1", (uid,)).fetchone()[0] + db.execute("SELECT COUNT(*) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", (uid,)).fetchone()[0]
            job["total"] = len(ids) + nfiles
            for i in ids:
                try:
                    hydrate(db, i)
                except HTTPException as e:
                    t = db.execute("SELECT title FROM documents WHERE id = ?", (i,)).fetchone()
                    job["failed"].append({"what": (t["title"] if t else "a document") or "a document", "error": str(e.detail)})
                except Exception as e:   # noqa: BLE001
                    job["failed"].append({"what": "a document", "error": f"Something went wrong ({type(e).__name__})"})
                job["done"] += 1
            if row and nfiles:
                job["failed"] += bring_files_back(db, row, uid, job)
            if job["failed"]:
                job["error"] = f"{len(job['failed'])} could not be brought back. The storage is still on; try again."
            else:
                db.execute("UPDATE documents SET remote_state = NULL, remote_fp = NULL WHERE owner_id = ? AND remote_state = 'cached'", (uid,))   # they are whole on this server again
                db.execute("UPDATE storage_connections SET enabled = 0 WHERE user_id = ?", (uid,))
                db.commit()
    except Exception as e:   # noqa: BLE001
        job["error"] = f"Something went wrong: {type(e).__name__}"
    finally:
        job["running"] = False


def stats(db, uid: str) -> dict:
    g = lambda q, *a: db.execute(q, a).fetchone()[0]
    return {
        "docs_remote": g("SELECT COUNT(*) FROM documents WHERE owner_id = ? AND remote_state = 'remote'", uid),
        "docs_cached": g("SELECT COUNT(*) FROM documents WHERE owner_id = ? AND remote_state = 'cached'", uid),
        "docs_local": g("SELECT COUNT(*) FROM documents WHERE owner_id = ? AND remote_state IS NULL AND zk = 0 AND deleted_at IS NULL", uid),
        "docs_encrypted": g("SELECT COUNT(*) FROM documents WHERE owner_id = ? AND zk = 1", uid),
        "files_remote": g("SELECT COUNT(*) FROM uploads WHERE owner_id = ? AND remote = 1", uid) + g("SELECT COUNT(*) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", uid),
        "files_local": g("SELECT COUNT(*) FROM uploads WHERE owner_id = ? AND remote = 0", uid) + g("SELECT COUNT(*) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 0", uid),
        "bytes_remote": g("SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = ? AND remote = 1", uid) + g("SELECT COALESCE(SUM(f.size), 0) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", uid),
    }
