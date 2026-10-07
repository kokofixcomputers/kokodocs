"""Comments anchored to text (the anchor itself is a mark inside the document), with replies, resolving and @email mentions."""
import json
import re
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import access
from .db import get_db
from . import notifications
from .routes import ctx, must_user

router = APIRouter(prefix="/api")
MENTION = re.compile(r"@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")


class NewComment(BaseModel):
    id: str | None = Field(None, max_length=40)
    body: str = Field(min_length=1, max_length=4000)
    quote: str = Field("", max_length=400)
    parent_id: str | None = None
    anchor: dict | None = None   # where a spreadsheet or slide comment points: {"sheet","r","c"} or {"slide","el"}


def view(r, names):
    return {
        "id": r["id"], "parent_id": r["parent_id"], "body": r["body"], "quote": r["quote"], "resolved": bool(r["resolved"]),
        "created_at": r["created_at"], "user_id": r["user_id"], "author": names.get(r["user_id"], "Someone"),
        "mentions": json.loads(r["mentions"]), "anchor": json.loads(r["anchor"]) if r["anchor"] else None,
    }


def names_for(db, rows):
    ids = {r["user_id"] for r in rows}
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    return {u["id"]: u["name"] for u in db.execute(f"SELECT id, name FROM users WHERE id IN ({q})", tuple(ids)).fetchall()}


@router.get("/docs/{doc_id}/comments")
def list_comments(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    rows = db.execute("SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at", (doc_id,)).fetchall()
    names = names_for(db, rows)
    return [view(r, names) for r in rows]


@router.get("/docs/{doc_id}/people")
def people(doc_id: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    """Everyone who can be @mentioned: the owner plus anyone the document (or its folder) is shared with."""
    doc, _ = access.require(db, doc_id, *c)
    out = {}
    owner = db.execute("SELECT email, name FROM users WHERE id = ?", (doc["owner_id"],)).fetchone()
    if owner:
        out[owner["email"]] = owner["name"]
    cur = db.execute("SELECT email FROM users WHERE id = ?", (user["id"],)).fetchone()
    if cur:
        out[cur["email"]] = user["name"]
    for table, key, val in (("shares", "doc_id", doc_id), ("folder_shares", "folder_id", doc["folder_id"] if "folder_id" in doc.keys() else None)):
        if val is None:
            continue
        try:
            for s in db.execute(f"SELECT email FROM {table} WHERE {key} = ?", (val,)).fetchall():
                u = db.execute("SELECT name FROM users WHERE email = ?", (s["email"],)).fetchone()
                out.setdefault(s["email"], u["name"] if u else None)
        except Exception:
            pass
    return [{"email": e, "name": n} for e, n in out.items()]


@router.post("/docs/{doc_id}/comments")
def add_comment(doc_id: str, b: NewComment, request: Request, tasks: BackgroundTasks, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    doc, _acc = access.require(db, doc_id, *c)
    parent = None
    if b.parent_id:
        parent = db.execute("SELECT * FROM comments WHERE id = ? AND doc_id = ?", (b.parent_id, doc_id)).fetchone()
        if not parent:
            raise HTTPException(404, "That thread no longer exists")
    cid = b.id if (b.id and re.fullmatch(r"[A-Za-z0-9_-]{6,40}", b.id)) else uuid.uuid4().hex[:16]
    body = b.body.strip()
    mentions = sorted({m.lower() for m in MENTION.findall(body)})
    now = time.time()
    anchor = json.dumps(b.anchor)[:500] if b.anchor else None
    db.execute("INSERT INTO comments (id, doc_id, parent_id, user_id, body, quote, mentions, anchor, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (cid, doc_id, b.parent_id, user["id"], body, b.quote, json.dumps(mentions), anchor, now, now))
    emails, skipped = notifications.on_comment(db, doc, user, body, mentions, cid, parent)
    db.commit()
    from .authx import base_url
    base = base_url(request, db)
    for to, actor, text, link in emails:
        tasks.add_task(notifications.send_mail_background, to, *notifications.mention_mail(actor, doc["title"], text, base + link))
    r = db.execute("SELECT * FROM comments WHERE id = ?", (cid,)).fetchone()
    return {**view(r, {user["id"]: user["name"]}), "skipped": skipped}


class Resolve(BaseModel):
    resolved: bool


@router.put("/docs/{doc_id}/comments/{cid}/resolved")
def resolve_comment(doc_id: str, cid: str, b: Resolve, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    db.execute("UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ? AND doc_id = ?", (int(b.resolved), time.time(), cid, doc_id))
    db.commit()
    return {"ok": True}


@router.delete("/docs/{doc_id}/comments/{cid}")
def delete_comment(doc_id: str, cid: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    doc, acc = access.require(db, doc_id, *c)
    r = db.execute("SELECT * FROM comments WHERE id = ? AND doc_id = ?", (cid, doc_id)).fetchone()
    if not r:
        return {"ok": True}
    if r["user_id"] != user["id"] and acc.role not in ("owner", "manager"):
        raise HTTPException(403, "You can only delete your own comments")
    db.execute("DELETE FROM comments WHERE id = ? OR parent_id = ?", (cid, cid))
    db.commit()
    return {"ok": True}
