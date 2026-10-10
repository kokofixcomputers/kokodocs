"""Full-text search over what people have written: document text, spreadsheet cell values, slide text and notes.
Results only include files the person was shared directly (owner, direct share, or a shared folder); public-link
files never show up in someone else's search."""
import re
import time

from fastapi import APIRouter, Depends

from . import access
from .db import get_db
from .routes import must_user

router = APIRouter(prefix="/api")


def fts_query(q: str) -> str | None:
    toks = re.findall(r"[\w][\w'-]*", q, re.UNICODE)[:8]
    return " ".join(f'"{t}"*' for t in toks) if toks else None


KINDS = {"doc", "sheet", "slides", "form", "wiki", "board"}


@router.get("/search")
def search(q: str = "", limit: int = 30, kind: str = "", owner: str = "", days: int = 0, user=Depends(must_user), db=Depends(get_db)):
    """Filters (all optional): kind = comma-separated kinds, owner = me | shared, days = changed within that many days.
    With filters but no words, it lists the matching files, newest first."""
    kinds = {k for k in kind.split(",") if k in KINDS}
    owner = owner if owner in ("me", "shared") else ""
    since = time.time() - min(max(days, 0), 3650) * 86400 if days > 0 else 0
    filtered = bool(kinds or owner or since)
    m = fts_query(q.strip())
    if not m and not filtered:
        return []
    if m:
        rows = db.execute(
            """SELECT f.doc_id, snippet(doc_fts, 2, '[[', ']]', '…', 14) AS body_snip, snippet(doc_fts, 1, '[[', ']]', '…', 10) AS title_snip, bm25(doc_fts, 0, 6, 1) AS rank
               FROM doc_fts f WHERE doc_fts MATCH ? ORDER BY rank LIMIT 300""", (m,)).fetchall()
    else:   # just the filters: newest first
        rows = [{"doc_id": d["id"], "body_snip": "", "title_snip": ""} for d in db.execute(
            """SELECT id FROM documents WHERE deleted_at IS NULL AND (owner_id = ? OR folder_id IS NOT NULL OR id IN (SELECT doc_id FROM shares WHERE email = ?))
               ORDER BY updated_at DESC LIMIT 600""", (user["id"], user["email"])).fetchall()]
    out = []
    for r in rows:
        doc = db.execute("SELECT d.*, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.deleted_at IS NULL", (r["doc_id"],)).fetchone()
        if not doc:
            continue
        mine = doc["owner_id"] == user["id"]
        if (kinds and doc["kind"] not in kinds) or (since and doc["updated_at"] < since) or (owner == "me" and not mine) or (owner == "shared" and mine):
            continue
        shared = db.execute("SELECT 1 FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], user["email"])).fetchone()
        if not (mine or shared or (doc["folder_id"] and access.folder_role(db, user, doc["folder_id"], links=False))):
            continue
        snip = r["body_snip"] if "[[" in (r["body_snip"] or "") else ""
        out.append({"id": doc["id"], "title": doc["title"], "kind": doc["kind"], "owner": "Me" if mine else doc["owner_name"], "updated_at": doc["updated_at"],
                    "title_match": "[[" in (r["title_snip"] or ""), "snippet": snip})
        if len(out) >= min(max(limit, 1), 50):
            break
    return out
