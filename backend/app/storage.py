"""Extended storage: connect your own storage, move files there, bring them back, and take a document away as a `.kokodocs` file."""
import re
import threading
import time
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import access, quota
from .db import FORM_FILES_DIR, UPLOAD_DIR, get_db
from .extstore import backends, container, service
from .routes import ctx, must_user
from .security import RateLimiter

router = APIRouter(prefix="/api")
limiter = RateLimiter(20, 60)
MAX_IMPORT = 256 * 1024 * 1024
FIELDS = {"s3": ("endpoint", "region", "bucket", "access_key", "secret_key", "prefix"), "webdav": ("url", "username", "password", "prefix"), "folder": ("path",)}


def _clean(kind: str, cfg: dict) -> dict:
    if kind not in FIELDS:
        raise HTTPException(422, "Choose where to store your files")
    return {k: str(cfg.get(k, "") or "").strip()[:500] for k in FIELDS[kind]}


def _state(db, user) -> dict:
    row = service.row_for(db, user["id"])
    out = {"available": [k for k in backends.KINDS if k != "folder" or backends.folder_root()], "connection": None, "stats": service.stats(db, user["id"]), "job": service.jobs.get(user["id"])}
    if row:
        cfg = {}
        try:
            cfg = service.public_config(row["kind"], service.config_of(row))
        except Exception:
            pass
        out["connection"] = {"kind": row["kind"], "config": cfg, "enabled": bool(row["enabled"]), "idle_minutes": row["idle_minutes"], "keep_search": bool(row["keep_search"]),
                             "last_ok": row["last_ok"], "last_error": row["last_error"], "moving_now": bool(row["move_now"])}
    return out


@router.get("/storage")
def get_storage(user=Depends(must_user), db=Depends(get_db)):
    return _state(db, user)


class ConnIn(BaseModel):
    kind: Literal["s3", "webdav", "folder"]
    config: dict = Field(default_factory=dict)
    enabled: bool = True
    idle_minutes: int = Field(5, ge=1, le=1440)
    keep_search: bool = False


def _fail(e: Exception):
    raise HTTPException(422, str(e))


@router.post("/storage/test")
def test_storage(body: ConnIn, user=Depends(must_user), db=Depends(get_db)):
    if not limiter.allow(f"storage:{user['id']}"):
        raise HTTPException(429, "Too many tries. Wait a minute.")
    cfg = _clean(body.kind, body.config)
    old = service.row_for(db, user["id"])
    if old and old["kind"] == body.kind:   # a blank secret means the saved one
        prev = service.config_of(old)
        for k in service.SECRET_FIELDS[body.kind]:
            if not cfg.get(k):
                cfg[k] = prev.get(k, "")
    try:
        return {"ok": True, "message": backends.make(body.kind, cfg).test()}
    except backends.StorageError as e:
        _fail(e)


@router.put("/storage")
def put_storage(body: ConnIn, user=Depends(must_user), db=Depends(get_db)):
    if not limiter.allow(f"storage:{user['id']}"):
        raise HTTPException(429, "Too many tries. Wait a minute.")
    try:
        msg = service.save_connection(db, user["id"], body.kind, _clean(body.kind, body.config), enabled=body.enabled, idle_minutes=body.idle_minutes, keep_search=body.keep_search)
    except backends.StorageError as e:
        _fail(e)
    return {**_state(db, user), "message": msg}


@router.post("/storage/move")
def move_now(user=Depends(must_user), db=Depends(get_db)):
    """Don't wait for files to be idle: move everything that is not open right now."""
    row = service.row_for(db, user["id"])
    if not row or not row["enabled"]:
        raise HTTPException(409, "Connect your storage and switch it on first")
    db.execute("UPDATE storage_connections SET move_now = 1 WHERE user_id = ?", (user["id"],)); db.commit()
    threading.Thread(target=lambda: _sweep(user["id"]), daemon=True).start()
    return {"ok": True}


def _sweep(uid: str) -> None:
    from .db import connect
    with connect() as db:
        row = service.row_for(db, uid)
        if row and row["enabled"]:
            service.sweep_user(db, row, uid)


@router.post("/storage/restore")
def restore_everything(user=Depends(must_user), db=Depends(get_db)):
    """Bring every file back to this server and switch the storage off."""
    if not service.row_for(db, user["id"]):
        raise HTTPException(409, "No storage is connected")
    j = service.jobs.get(user["id"])
    if j and j.get("running"):
        return {"ok": True}
    threading.Thread(target=service.restore_all, args=(user["id"],), daemon=True).start()
    time.sleep(0.05)
    return {"ok": True}


@router.delete("/storage")
def disconnect(user=Depends(must_user), db=Depends(get_db)):
    st = service.stats(db, user["id"])
    if st["docs_remote"] or st["files_remote"]:
        raise HTTPException(409, f"{st['docs_remote']} files and {st['files_remote']} pictures and attachments are only in your storage. Bring them back first.")
    db.execute("UPDATE documents SET remote_state = NULL, remote_fp = NULL WHERE owner_id = ? AND remote_state = 'cached'", (user["id"],))
    db.execute("DELETE FROM storage_connections WHERE user_id = ?", (user["id"],))
    return {"ok": True}


# ── a document as a .kokodocs file ──
def _file_reader(db, owner_id: str):
    def read(kind: str, name: str):
        p = (UPLOAD_DIR if kind == "uploads" else FORM_FILES_DIR) / name
        if p.exists():
            return p.read_bytes()
        return service.fetch_file(db, owner_id, kind, name)
    return read


@router.get("/docs/{doc_id}/kokodocs")
def export_kokodocs(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = access.require(db, doc_id, *c, minimum="editor")
    access.zk_unsupported(doc, "Saving as a .kokodocs file")
    data = container.pack(db, doc_id, files=_file_reader(db, doc["owner_id"]))
    name = re.sub(r"[^\w .-]+", "_", doc["title"] or "Untitled").strip() or "Untitled"
    return Response(data, media_type=container.MIME, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}.kokodocs", "Cache-Control": "private, no-store"})


@router.post("/import/kokodocs")
async def import_kokodocs(file: UploadFile = File(...), folder_id: str | None = None, user=Depends(must_user), db=Depends(get_db)):
    data = await file.read(MAX_IMPORT + 1)
    if len(data) > MAX_IMPORT:
        raise HTTPException(413, "That file is larger than 256 MB")
    try:
        manifest, z = container.read(data)
    except container.ContainerError as e:
        raise HTTPException(422, str(e))
    if folder_id and not db.execute("SELECT 1 FROM folders WHERE id = ? AND owner_id = ?", (folder_id, user["id"])).fetchone():
        folder_id = None
    quota.check(db, user["id"], len(data), "Your account")

    def write(kind: str, name: str, blob: bytes) -> None:
        if kind == "uploads" and not re.fullmatch(r"[0-9a-f]{32}\.(png|jpg|gif|webp)", name):
            return
        if kind == "form" and not re.fullmatch(r"[0-9a-f]{32}", name):
            return
        (UPLOAD_DIR if kind == "uploads" else FORM_FILES_DIR).joinpath(name).write_bytes(blob)
    new = container.import_as_new(db, user["id"], z, manifest, folder_id=folder_id, write_file=write)
    try:
        from . import searchindex
        searchindex.index_doc(db, new)
    except Exception:
        pass
    row = db.execute("SELECT id, title, kind FROM documents WHERE id = ?", (new,)).fetchone()
    return {"id": row["id"], "title": row["title"], "kind": row["kind"]}
