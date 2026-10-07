"""Search index maintenance (kept separate from the HTTP routes so the collaboration server can use it without import cycles)."""
import html
import re
import threading

from pycrdt import Array, Doc, Map, XmlFragment

from .db import connect

MAX_TEXT = 300_000
_ws = re.compile(r"\s+")


def extract_text(blob: bytes | None, kind: str) -> str:
    if not blob:
        return ""
    try:
        d = Doc()
        d.apply_update(bytes(blob))
        parts: list[str] = []
        if kind == "sheet":
            tabs = d.get("tabs", type=Map)
            for t in tabs.values():
                t = dict(t) if hasattr(t, "keys") else {}
                tid = str(t.get("id", ""))
                if t.get("name"):
                    parts.append(str(t["name"]))
                if not tid:
                    continue
                for cell in d.get("cells:" + tid, type=Map).values():
                    v = cell.get("v") if hasattr(cell, "get") else None
                    if isinstance(v, str) and v and not v.startswith("="):
                        parts.append(v)
        elif kind == "slides":
            order, slides = d.get("order", type=Array), d.get("slides", type=Map)
            for sid in list(order):
                sl = slides.get(str(sid))
                if sl is None or not hasattr(sl, "get"):
                    continue
                els = sl.get("els")
                for e in (els.values() if els is not None else []):
                    if hasattr(e, "get") and isinstance(e.get("text"), str):
                        parts.append(e.get("text"))
                if isinstance(sl.get("notes"), str):
                    parts.append(sl.get("notes"))
        elif kind == "form":
            items = d.get("items", type=Map)
            for it in items.values():
                if isinstance(it, dict):
                    parts += [str(it.get(k)) for k in ("title", "help") if it.get(k)] + [str(o) for o in it.get("options", []) if isinstance(o, str)]
            desc = d.get("meta", type=Map).get("description")
            if isinstance(desc, str):
                parts.append(desc)
        elif kind == "wiki":
            for pid, ent in d.get("tree", type=Map).items():
                if isinstance(ent, dict) and ent.get("title"):
                    parts.append(str(ent["title"]))
                if isinstance(ent, dict) and ent.get("t") == "page":
                    parts.append(html.unescape(re.sub(r"<[^>]+>", " ", str(d.get("p:" + str(pid), type=XmlFragment)))))
        else:
            parts.append(html.unescape(re.sub(r"<[^>]+>", " ", str(d.get("default", type=XmlFragment)))))
        return _ws.sub(" ", " ".join(parts)).strip()[:MAX_TEXT]
    except Exception:
        return ""


def index_doc(db, doc_id: str, blob: bytes | None = None, title: str | None = None, kind: str | None = None) -> None:
    row = db.execute("SELECT title, kind, ydoc FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not row:
        return
    body = extract_text(blob if blob is not None else row["ydoc"], kind or row["kind"])
    db.execute("DELETE FROM doc_fts WHERE doc_id = ?", (doc_id,))
    db.execute("INSERT INTO doc_fts (doc_id, title, body) VALUES (?,?,?)", (doc_id, title or row["title"], body))


def drop_doc(db, doc_id: str) -> None:
    db.execute("DELETE FROM doc_fts WHERE doc_id = ?", (doc_id,))


def backfill() -> None:
    """Index files that predate the search feature (runs once in the background at start-up)."""
    try:
        with connect() as db:
            db.execute("DELETE FROM doc_fts WHERE doc_id NOT IN (SELECT id FROM documents)")
            ids = [r["id"] for r in db.execute("SELECT d.id FROM documents d WHERE d.id NOT IN (SELECT doc_id FROM doc_fts)")]
            for i in ids:
                index_doc(db, i)
                db.commit()
    except Exception:
        pass


def start_backfill() -> None:
    threading.Thread(target=backfill, daemon=True).start()
