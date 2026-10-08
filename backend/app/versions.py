import json

from fastapi import APIRouter, Depends, HTTPException, Header, Response
from pydantic import BaseModel, Field

from . import access
from .collab import rooms
from .db import get_db
from .routes import ctx
from .snapshots import BrokenVersion, build, take_snapshot

router = APIRouter(prefix="/api")


def view(r) -> dict:
    return {
        "id": r["id"], "created_at": r["created_at"], "kind": r["kind"], "label": r["label"],
        "authors": json.loads(r["authors"]), "words": r["words"], "preview": r["preview"],
    }


@router.get("/docs/{doc_id}/versions")
def list_versions(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = access.require(db, doc_id, *c, minimum="editor")
    access.zk_unsupported(doc, "Version history")
    rows = db.execute(
        "SELECT id, created_at, kind, label, authors, words, preview FROM versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 300",
        (doc_id,),
    ).fetchall()
    return [view(r) for r in rows]


class NewVersion(BaseModel):
    label: str | None = Field(None, max_length=120)


@router.post("/docs/{doc_id}/versions")
def create_version(doc_id: str, body: NewVersion, c=Depends(ctx), db=Depends(get_db)):
    doc, acc = access.require(db, doc_id, *c, minimum="editor")
    access.zk_unsupported(doc, "Version history")
    room = rooms.get(doc_id)
    blob = room.doc.get_update() if room else (bytes(doc["ydoc"]) if doc["ydoc"] else None)
    if not blob:
        raise HTTPException(409, "Nothing to save yet")
    authors = [acc.user["name"]] if acc.user else ["Guest"]
    try:
        return take_snapshot(doc_id, blob, "manual", body.label, authors, skip_duplicate=False)
    except HTTPException as e:
        if e.status_code == 413 and acc.role != "owner":   # say whose storage it is
            raise HTTPException(413, {"code": "quota_exceeded", "message": "The document's owner is out of storage. Ask them to free up space."})
        raise


@router.get("/docs/{doc_id}/versions/{vid}/data")
def version_data(doc_id: str, vid: str, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = access.require(db, doc_id, *c, minimum="editor")
    access.zk_unsupported(doc, "Version history")
    if not db.execute("SELECT 1 FROM versions WHERE id = ? AND doc_id = ?", (vid, doc_id)).fetchone():
        raise HTTPException(404, "Version not found")
    try:
        data = build(db, vid)
    except BrokenVersion as e:
        raise HTTPException(500, f"This version can't be rebuilt ({e}).")
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "private, max-age=3600"})


@router.patch("/docs/{doc_id}/versions/{vid}")
def rename_version(doc_id: str, vid: str, body: NewVersion, c=Depends(ctx), db=Depends(get_db)):
    access.require(db, doc_id, *c, minimum="editor")
    cur = db.execute("UPDATE versions SET label = ? WHERE id = ? AND doc_id = ?", ((body.label or "").strip() or None, vid, doc_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "Version not found")
    return {"ok": True}
