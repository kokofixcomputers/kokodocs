"""Full-text search over what people have written: document text, spreadsheet cell values, slide text and notes.
Results only include files the person was shared directly (owner, direct share, or a shared folder); public-link
files never show up in someone else's search."""
import re

from fastapi import APIRouter, Depends

from . import access
from .db import get_db
from .routes import must_user

router = APIRouter(prefix="/api")


def fts_query(q: str) -> str | None:
    toks = re.findall(r"[\w][\w'-]*", q, re.UNICODE)[:8]
    return " ".join(f'"{t}"*' for t in toks) if toks else None


@router.get("/search")
def search(q: str = "", limit: int = 30, user=Depends(must_user), db=Depends(get_db)):
    m = fts_query(q.strip())
    if not m:
        return []
    rows = db.execute(
        """SELECT f.doc_id, snippet(doc_fts, 2, '[[', ']]', '…', 14) AS body_snip, snippet(doc_fts, 1, '[[', ']]', '…', 10) AS title_snip, bm25(doc_fts, 0, 6, 1) AS rank
           FROM doc_fts f WHERE doc_fts MATCH ? ORDER BY rank LIMIT 300""", (m,)).fetchall()
    out = []
    for r in rows:
        doc = db.execute("SELECT d.*, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.deleted_at IS NULL", (r["doc_id"],)).fetchone()
        if not doc:
            continue
        mine = doc["owner_id"] == user["id"]
        shared = db.execute("SELECT 1 FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], user["email"])).fetchone()
        if not (mine or shared or (doc["folder_id"] and access.folder_role(db, user, doc["folder_id"], links=False))):
            continue
        snip = r["body_snip"] if "[[" in (r["body_snip"] or "") else ""
        out.append({"id": doc["id"], "title": doc["title"], "kind": doc["kind"], "owner": "Me" if mine else doc["owner_name"], "updated_at": doc["updated_at"],
                    "title_match": "[[" in (r["title_snip"] or ""), "snippet": snip})
        if len(out) >= min(max(limit, 1), 50):
            break
    return out
