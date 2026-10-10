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
    if old and old["kind"] == kind:   # blank secret fields mean "keep what is saved"
        prev = config_of(old)
        for k in SECRET_FIELDS[kind]:
            if not cfg.get(k):
                cfg[k] = prev.get(k, "")
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


def _move_files(db, row, owner_id: str) -> int:
    b, moved = backend_of(row), 0
    for u in db.execute("SELECT name, size FROM uploads WHERE owner_id = ? AND remote = 0", (owner_id,)).fetchall():
        p = UPLOAD_DIR / u["name"]
        if not p.exists():
            continue
        data = p.read_bytes()
        b.put(file_key("uploads", u["name"]), data)
        if b.size(file_key("uploads", u["name"])) != len(data):
            raise backends.StorageError("The storage did not keep a picture intact")
        db.execute("UPDATE uploads SET remote = 1 WHERE name = ?", (u["name"],)); db.commit()
        p.unlink(missing_ok=True); moved += 1
    for f in db.execute("SELECT f.id, f.stored FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 0", (owner_id,)).fetchall():
        p = FORM_FILES_DIR / f["stored"]
        if not p.exists():
            continue
        data = p.read_bytes()
        b.put(file_key("form", f["stored"]), data)
        if b.size(file_key("form", f["stored"])) != len(data):
            raise backends.StorageError("The storage did not keep an attachment intact")
        db.execute("UPDATE form_files SET remote = 1 WHERE id = ?", (f["id"],)); db.commit()
        p.unlink(missing_ok=True); moved += 1
    return moved


def bring_files_back(db, row, owner_id: str) -> int:
    b, n = backend_of(row), 0
    for u in db.execute("SELECT name FROM uploads WHERE owner_id = ? AND remote = 1", (owner_id,)).fetchall():
        data = b.get(file_key("uploads", u["name"]))
        if data is None:
            raise backends.StorageError(f"A picture ({u['name']}) is missing from your storage")
        (UPLOAD_DIR / u["name"]).write_bytes(data)
        db.execute("UPDATE uploads SET remote = 0 WHERE name = ?", (u["name"],)); db.commit(); n += 1
    for f in db.execute("SELECT f.id, f.stored FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", (owner_id,)).fetchall():
        data = b.get(file_key("form", f["stored"]))
        if data is None:
            raise backends.StorageError("An attachment is missing from your storage")
        (FORM_FILES_DIR / f["stored"]).write_bytes(data)
        db.execute("UPDATE form_files SET remote = 0 WHERE id = ?", (f["id"],)); db.commit(); n += 1
    return n


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
            b.put(key, blob)
            sha = hashlib.sha256(blob).hexdigest()
            back = b.get(key)
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
            data = backend_of(row).get(d["remote_key"] or doc_key(doc_id))
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
def sweep_user(db, row, uid: str) -> dict:
    out = {"moved": 0, "cleared": 0, "files": 0}
    now = time.time(); idle = max(1, row["idle_minutes"]) * 60
    if row["move_now"]:
        idle_new = idle_cached = 0
    else:
        idle_new, idle_cached = GRACE_NEW, idle
    try:   # pictures and attachments first, so a form's file list is saved already marked as moved
        out["files"] = _move_files(db, row, uid)
    except backends.StorageError as e:
        db.execute("UPDATE storage_connections SET last_error = ? WHERE user_id = ?", (str(e), uid)); db.commit()
        return out
    docs = db.execute("SELECT id, updated_at, remote_state FROM documents WHERE owner_id = ? AND zk = 0 AND deleted_at IS NULL AND (remote_state IS NULL OR remote_state = 'cached')", (uid,)).fetchall()
    for d in docs:
        last = max(_touch.get(d["id"], 0), d["updated_at"] or 0)
        if now - last < (idle_cached if d["remote_state"] == "cached" else idle_new):
            continue
        try:
            r = offload_doc(db, d["id"])
        except backends.StorageError as e:
            db.execute("UPDATE storage_connections SET last_error = ? WHERE user_id = ?", (str(e), uid)); db.commit()
            return out
        if r in ("moved", "cleared"):
            out[r] += 1
    db.execute("UPDATE storage_connections SET last_ok = ?, last_error = '', move_now = 0 WHERE user_id = ?", (now, uid)); db.commit()
    return out


def loop() -> None:
    while True:
        time.sleep(LOOP_EVERY)
        try:
            with connect() as db:
                for row in db.execute("SELECT * FROM storage_connections WHERE enabled = 1").fetchall():
                    if row["user_id"] in jobs and jobs[row["user_id"]].get("running"):
                        continue
                    sweep_user(db, row, row["user_id"])
        except Exception:
            pass


def start() -> None:
    threading.Thread(target=loop, daemon=True, name="extstore").start()


# ── bring everything back, and the numbers ──
def restore_all(uid: str) -> None:
    job = jobs[uid] = {"running": True, "done": 0, "total": 0, "error": ""}
    try:
        with connect() as db:
            row = row_for(db, uid)
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE owner_id = ? AND remote_state = 'remote'", (uid,))]
            files = db.execute("SELECT COUNT(*) FROM uploads WHERE owner_id = ? AND remote = 1", (uid,)).fetchone()[0] + db.execute("SELECT COUNT(*) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ? AND f.remote = 1", (uid,)).fetchone()[0]
            job["total"] = len(ids) + (1 if files else 0)
            for i in ids:
                hydrate(db, i); job["done"] += 1
            if files and row:
                bring_files_back(db, row, uid); job["done"] += 1
            db.execute("UPDATE documents SET remote_state = NULL, remote_fp = NULL WHERE owner_id = ? AND remote_state = 'cached'", (uid,))   # they are whole on this server again
            db.execute("UPDATE storage_connections SET enabled = 0 WHERE user_id = ?", (uid,))
            db.commit()
    except HTTPException as e:
        job["error"] = str(e.detail)
    except backends.StorageError as e:
        job["error"] = str(e)
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
