"""Folders, moving documents, and the recycle bin."""
import re
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import access
from .collab import refresh_access, refresh_all
from . import quota, tagdb
from .db import get_db
from .routes import ctx, current_user, doc_summary, must_user, sealed_for

router = APIRouter(prefix="/api")
PURGE_DAYS = 30


# ───────────────────────── folders ─────────────────────────
def folder_view(f, shared: int = 0, tags: list[str] | None = None) -> dict:
    return {"tags": tags or [], "id": f["id"], "name": f["name"], "parent_id": f["parent_id"], "created_at": f["created_at"],
            "shared": shared, "link_access": f["link_access"], "link_role": f["link_role"], "color": f["color"]}


def owned_folder(db, user, fid: str | None):
    if fid is None:
        return None
    f = db.execute("SELECT * FROM folders WHERE id = ? AND owner_id = ?", (fid, user["id"])).fetchone()
    if not f:
        raise HTTPException(404, "Folder not found")
    return f


def descendants(db, user, fid: str) -> list[str]:
    ids, frontier = [fid], [fid]
    while frontier:
        q = ",".join("?" * len(frontier))
        rows = db.execute(f"SELECT id FROM folders WHERE owner_id = ? AND parent_id IN ({q})", (user["id"], *frontier)).fetchall()
        frontier = [r["id"] for r in rows]
        ids += frontier
    return ids


@router.get("/folders")
def list_folders(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute(
        """SELECT f.*, (SELECT COUNT(*) FROM folder_shares s WHERE s.folder_id = f.id) AS n
           FROM folders f WHERE f.owner_id = ? ORDER BY lower(f.name)""", (user["id"],)).fetchall()
    tags = tagdb.tag_map(db, "folder", user["id"])
    return [folder_view(r, r["n"], tags.get(r["id"])) for r in rows]


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None


@router.post("/folders")
def create_folder(body: FolderIn, user=Depends(must_user), db=Depends(get_db)):
    owned_folder(db, user, body.parent_id)
    fid = uuid.uuid4().hex[:16]
    db.execute("INSERT INTO folders (id, owner_id, parent_id, name, created_at) VALUES (?,?,?,?,?)",
               (fid, user["id"], body.parent_id, body.name.strip(), time.time()))
    return folder_view(db.execute("SELECT * FROM folders WHERE id = ?", (fid,)).fetchone())


class FolderPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    parent_id: str | None = None
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")  # send null to clear
    move: bool = False  # true = apply parent_id (null means move to top level)


@router.patch("/folders/{fid}")
async def patch_folder(fid: str, body: FolderPatch, user=Depends(must_user), db=Depends(get_db)):
    owned_folder(db, user, fid)
    if body.name:
        db.execute("UPDATE folders SET name = ? WHERE id = ?", (body.name.strip(), fid))
    if "color" in body.model_fields_set:
        db.execute("UPDATE folders SET color = ? WHERE id = ?", (body.color, fid))
        db.commit()
    if body.move:
        owned_folder(db, user, body.parent_id)
        if body.parent_id and body.parent_id in descendants(db, user, fid):
            raise HTTPException(422, "A folder can't be moved into itself")
        db.execute("UPDATE folders SET parent_id = ? WHERE id = ?", (body.parent_id, fid))
        db.commit()
        await refresh_all()
    return folder_view(db.execute("SELECT * FROM folders WHERE id = ?", (fid,)).fetchone())


@router.delete("/folders/{fid}")
async def delete_folder(fid: str, user=Depends(must_user), db=Depends(get_db)):
    """Deletes the folder and its subfolders; the documents inside go to the recycle bin."""
    owned_folder(db, user, fid)
    ids = descendants(db, user, fid)
    q = ",".join("?" * len(ids))
    gone = [r["id"] for r in db.execute(
        f"SELECT id FROM documents WHERE owner_id = ? AND deleted_at IS NULL AND folder_id IN ({q})", (user["id"], *ids))]
    now = time.time()
    db.execute(f"UPDATE documents SET deleted_at = ? WHERE owner_id = ? AND deleted_at IS NULL AND folder_id IN ({q})", (now, user["id"], *ids))
    db.execute(f"UPDATE documents SET folder_id = NULL WHERE owner_id = ? AND folder_id IN ({q})", (user["id"], *ids))
    db.execute(f"DELETE FROM folders WHERE owner_id = ? AND id IN ({q})", (user["id"], *ids))
    db.commit()
    for d in gone:
        await refresh_access(d)
    await refresh_all()
    return {"ok": True, "trashed": len(gone)}


# ───────────────────────── moving documents ─────────────────────────
class MoveIn(BaseModel):
    folder_id: str | None = None


@router.post("/docs/{doc_id}/move")
async def move_doc(doc_id: str, body: MoveIn, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c, minimum="owner")
    owned_folder(db, user, body.folder_id)
    db.execute("UPDATE documents SET folder_id = ? WHERE id = ?", (body.folder_id, doc_id))
    db.commit()
    await refresh_access(doc_id)  # moving in/out of a shared folder changes who can open it
    return {"ok": True}


# ───────────────────────── recycle bin ─────────────────────────
def purge_old(db) -> None:
    quota.drop_uploads(db, "deleted_at IS NOT NULL AND deleted_at < ?", (time.time() - PURGE_DAYS * 86400,))
    db.execute("DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?", (time.time() - PURGE_DAYS * 86400,))


@router.get("/trash")
def list_trash(user=Depends(must_user), db=Depends(get_db)):
    purge_old(db)
    rows = db.execute("SELECT * FROM documents WHERE owner_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC", (user["id"],)).fetchall()
    return {"purge_days": PURGE_DAYS, "docs": [{**doc_summary(d, "owner", user["name"], sealed=sealed_for(db, user, d)), "deleted_at": d["deleted_at"]} for d in rows]}


def trashed_doc(db, user, doc_id: str):
    d = db.execute("SELECT * FROM documents WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL", (doc_id, user["id"])).fetchone()
    if not d:
        raise HTTPException(404, "Not in the recycle bin")
    return d


@router.post("/docs/{doc_id}/restore")
def restore_doc(doc_id: str, user=Depends(must_user), db=Depends(get_db)):
    d = trashed_doc(db, user, doc_id)
    folder = d["folder_id"]
    if folder and not db.execute("SELECT 1 FROM folders WHERE id = ?", (folder,)).fetchone():
        folder = None
    db.execute("UPDATE documents SET deleted_at = NULL, folder_id = ?, updated_at = ? WHERE id = ?", (folder, time.time(), doc_id))
    return {"ok": True}


@router.delete("/docs/{doc_id}/permanent")
def delete_forever(doc_id: str, user=Depends(must_user), db=Depends(get_db)):
    trashed_doc(db, user, doc_id)
    from .extstore import service as ext
    ext.forget_doc(db, user["id"], doc_id)   # its file in the person's own storage goes too
    quota.drop_uploads(db, "id = ?", (doc_id,))
    db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    return {"ok": True}


@router.post("/trash/empty")
def empty_trash(user=Depends(must_user), db=Depends(get_db)):
    from .extstore import service as ext
    for r in db.execute("SELECT id FROM documents WHERE owner_id = ? AND deleted_at IS NOT NULL", (user["id"],)).fetchall():
        ext.forget_doc(db, user["id"], r["id"])
    quota.drop_uploads(db, "owner_id = ? AND deleted_at IS NOT NULL", (user["id"],))
    cur = db.execute("DELETE FROM documents WHERE owner_id = ? AND deleted_at IS NOT NULL", (user["id"],))
    return {"deleted": cur.rowcount}


# ───────────────────────── sharing whole folders ─────────────────────────
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class FolderShareEntry(BaseModel):
    email: str
    role: Literal["viewer", "editor"]


class FolderSharingIn(BaseModel):
    shares: list[FolderShareEntry] = []
    link_access: Literal["restricted", "anyone"] = "restricted"
    link_role: Literal["viewer", "editor"] = "viewer"


def folder_sharing_view(db, fid: str) -> dict:
    rows = db.execute(
        """SELECT s.email, s.role, u.name FROM folder_shares s LEFT JOIN users u ON u.email = s.email
           WHERE s.folder_id = ? ORDER BY s.created_at""", (fid,)).fetchall()
    f = db.execute("SELECT link_access, link_role FROM folders WHERE id = ?", (fid,)).fetchone()
    return {"link_access": f["link_access"], "link_role": f["link_role"],
            "shares": [{"email": r["email"], "role": r["role"], "name": r["name"]} for r in rows]}


@router.get("/folders/{fid}/sharing")
def get_folder_sharing(fid: str, user=Depends(must_user), db=Depends(get_db)):
    owned_folder(db, user, fid)
    return folder_sharing_view(db, fid)


@router.put("/folders/{fid}/sharing")
async def put_folder_sharing(fid: str, body: FolderSharingIn, user=Depends(must_user), db=Depends(get_db)):
    """Share a folder (and everything inside it, including subfolders) with specific people."""
    owned_folder(db, user, fid)
    seen: dict[str, str] = {}
    for s in body.shares:
        email = s.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(422, f"'{s.email}' is not a valid email address")
        if email != user["email"]:
            seen[email] = s.role
    db.execute("UPDATE folders SET link_access = ?, link_role = ? WHERE id = ?", (body.link_access, body.link_role, fid))
    db.execute("DELETE FROM folder_shares WHERE folder_id = ?", (fid,))
    now = time.time()
    db.executemany("INSERT INTO folder_shares (folder_id, email, role, created_at) VALUES (?,?,?,?)", [(fid, e, r, now) for e, r in seen.items()])
    db.commit()
    await refresh_all()  # anyone who just lost (or changed) access to a document inside is re-checked
    return folder_sharing_view(db, fid)


def shared_trail(db, user, fid: str):
    """Role on the folder plus the path from the highest folder that grants this visitor access down to `fid`."""
    own = db.execute("SELECT 1 FROM folders WHERE id = ? AND owner_id = ?", (fid, user["id"])).fetchone() if user else None
    role = "owner" if own else access.folder_role(db, user, fid)
    if not role:
        return None, []
    chain, cur, hops = [], fid, 0
    while cur and hops < 50:
        f = db.execute("SELECT * FROM folders WHERE id = ?", (cur,)).fetchone()
        if not f:
            break
        chain.insert(0, f)
        cur, hops = f["parent_id"], hops + 1
    start = 0 if own else next((i for i, f in enumerate(chain) if access.folder_grant(db, user, f["id"])), 0)
    return role, [{"id": f["id"], "name": f["name"]} for f in chain[start:]]


@router.get("/shared/folders")
def shared_roots(user=Depends(must_user), db=Depends(get_db)):
    """Folders other people shared directly with me (nested shares are reached through their parent)."""
    rows = db.execute(
        """SELECT f.*, s.role, u.name AS owner_name FROM folder_shares s
           JOIN folders f ON f.id = s.folder_id JOIN users u ON u.id = f.owner_id
           WHERE s.email = ? ORDER BY lower(f.name)""", (user["email"],)).fetchall()
    out = []
    for f in rows:
        parent = f["parent_id"]
        if parent and access.folder_role(db, user, parent, links=False):
            continue  # already visible inside an ancestor that was shared with me directly
        out.append({"id": f["id"], "name": f["name"], "role": f["role"], "owner": f["owner_name"], "created_at": f["created_at"]})
    return out


@router.get("/shared/folders/{fid}")
def open_shared_folder(fid: str, user=Depends(current_user), db=Depends(get_db)):
    """Browse a folder shared with me by email or by link (signed-out visitors allowed for link folders)."""
    role, trail = shared_trail(db, user, fid)
    if not role:
        if user is None and db.execute("SELECT 1 FROM folders WHERE id = ?", (fid,)).fetchone():
            raise HTTPException(401, {"code": "login_required", "message": "Sign in to open this folder"})
        raise HTTPException(404, {"code": "not_found", "message": "Folder not found"})
    f = db.execute("SELECT f.*, u.name AS owner_name FROM folders f JOIN users u ON u.id = f.owner_id WHERE f.id = ?", (fid,)).fetchone()
    subs = db.execute("SELECT * FROM folders WHERE parent_id = ? AND owner_id = ? ORDER BY lower(name)", (fid, f["owner_id"])).fetchall()
    docs = db.execute("SELECT * FROM documents WHERE folder_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC", (fid, f["owner_id"])).fetchall()
    tagmap = tagdb.tag_map(db, "doc", user["id"]) if user else {}
    return {
        "id": fid, "name": f["name"], "role": role, "owner": f["owner_name"], "trail": trail,
        "folders": [{"id": s["id"], "name": s["name"], "created_at": s["created_at"]} for s in subs],
        "docs": [doc_summary(d, role, f["owner_name"], tags=(tagmap.get(d["id"]) if user else None), sealed=sealed_for(db, user, d)) for d in docs],
    }
