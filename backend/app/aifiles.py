"""Lets the assistant cross-reference a person's OTHER files, but only if they allow it. Each person chooses: off (the default),
ask (the assistant asks before each lookup) or allow. The assistant works in the browser as that person, so these endpoints are what it
calls; they refuse unless the setting isn't off, only ever reveal files the person themselves can open (their own, shared with them
directly, or through a shared folder; public-link files are left out), and only ever read."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import access, readdoc
from .db import get_db
from .routes import must_user
from .search import search as full_text_search
from .security import RateLimiter

router = APIRouter(prefix="/api")
limiter = RateLimiter(120, 60)


class Mode(BaseModel):
    mode: Literal["off", "ask", "allow"]


def mode_of(user, db) -> str:
    r = db.execute("SELECT ai_files FROM users WHERE id = ?", (user["id"],)).fetchone()
    return (r["ai_files"] if r else "off") or "off"


@router.get("/me/ai-files")
def get_mode(user=Depends(must_user), db=Depends(get_db)):
    return {"mode": mode_of(user, db)}


@router.put("/me/ai-files")
def set_mode(b: Mode, user=Depends(must_user), db=Depends(get_db)):
    db.execute("UPDATE users SET ai_files = ? WHERE id = ?", (b.mode, user["id"]))
    db.commit()
    return {"mode": b.mode}


def need_on(user, db) -> None:
    if mode_of(user, db) == "off":
        raise HTTPException(403, "Reading your other files is turned off. Turn it on in the assistant's settings.")
    if not limiter.allow(f"aif:{user['id']}"):
        raise HTTPException(429, "Slow down: too many file lookups. Try again in a minute.")


def can_open(db, user, doc) -> bool:
    if doc["owner_id"] == user["id"]:
        return True
    if db.execute("SELECT 1 FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], user["email"])).fetchone():
        return True
    return bool(doc["folder_id"] and access.folder_role(db, user, doc["folder_id"], links=False))


def entry(db, doc, user) -> dict:
    owner = db.execute("SELECT name FROM users WHERE id = ?", (doc["owner_id"],)).fetchone()
    return {"id": doc["id"], "title": doc["title"] or "Untitled", "kind": doc["kind"], "owner": "me" if doc["owner_id"] == user["id"] else (owner["name"] if owner else "someone"), "updated_at": doc["updated_at"]}


@router.get("/ai/files")
def list_files(q: str = "", exclude: str = "", limit: int = 15, user=Depends(must_user), db=Depends(get_db)):
    """Search the person's other files by what is in them, or (with no query) list the most recently changed."""
    need_on(user, db)
    limit = min(max(limit, 1), 30)
    if q.strip():
        hits = [h for h in full_text_search(q, limit + 1, user, db) if h["id"] != exclude][:limit]
        return [{"id": h["id"], "title": h["title"] or "Untitled", "kind": h["kind"], "owner": h["owner"].lower() if h["owner"] == "Me" else h["owner"], "updated_at": h["updated_at"],
                 "snippet": (h.get("snippet") or "").replace("[[", "").replace("]]", "")} for h in hits]
    rows = db.execute("SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 400").fetchall()
    out = []
    for d in rows:
        if d["id"] != exclude and not d["zk"] and can_open(db, user, d):
            out.append(entry(db, d, user))
            if len(out) >= limit:
                break
    return out


@router.get("/ai/files/{doc_id}")
def read_file(doc_id: str, user=Depends(must_user), db=Depends(get_db)):
    need_on(user, db)
    doc = db.execute("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL", (doc_id,)).fetchone()
    if not doc or not can_open(db, user, doc):
        raise HTTPException(404, "No such file, or it isn't shared with you")
    if doc["zk"]:
        raise HTTPException(409, "That file is encrypted, so the assistant can't read it")
    text, cut = readdoc.render(doc["ydoc"], doc["kind"])
    return {**entry(db, doc, user), "text": text, "truncated": cut, "empty": not text.strip()}


@router.get("/ai/files/{doc_id}/info")
def file_info(doc_id: str, user=Depends(must_user), db=Depends(get_db)):
    """Just the name and kind (what the assistant shows when it asks permission)."""
    need_on(user, db)
    doc = db.execute("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL", (doc_id,)).fetchone()
    if not doc or not can_open(db, user, doc):
        raise HTTPException(404, "No such file, or it isn't shared with you")
    return entry(db, doc, user)
