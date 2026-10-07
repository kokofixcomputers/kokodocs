"""Version snapshots of a document (full Yjs state at a point in time)."""
import hashlib
import html
import json
import re
import threading
import time
import uuid

from pycrdt import Array, Doc, Map, XmlFragment, merge_updates

from . import quota
from .db import connect, settings_get, settings_set

AUTO_INTERVAL = 10 * 60   # seconds of editing between automatic versions
CLOSE_MIN_GAP = 60        # snapshot when a session ends, if the last one is at least this old
AUTO_KEEP = 80            # automatic versions kept per document (named versions are never pruned)


def summarize(blob: bytes) -> tuple[int, str]:
    """(count, preview): word count + text for documents; cell count + sheet names for spreadsheets."""
    try:
        d = Doc()
        d.apply_update(blob)
        xml = str(d.get("default", type=XmlFragment))
        tabs = d.get("tabs", type=Map)
        tab_list = [dict(v) if hasattr(v, "keys") else v for v in tabs.values()] if len(tabs) else []
    except Exception:
        return 0, ""
    try:
        fitems = d.get("items", type=Map)
        if len(fitems):
            names = [str(i.get("title", "")).strip() for i in fitems.values() if isinstance(i, dict) and i.get("type") not in ("page", "section", "info", "media")]
            return len(names), " · ".join(n for n in names[:4] if n)[:140]
    except Exception:
        pass
    try:
        tree = d.get("tree", type=Map)
        if len(tree):
            pages = [e for e in tree.values() if isinstance(e, dict) and e.get("t") == "page"]
            return len(pages), " · ".join(str(e.get("title", "")) for e in pages[:4] if e.get("title"))[:140]
    except Exception:
        pass
    try:
        tree = d.get("tree", type=Map)
        if len(tree):
            pages = [e for e in tree.values() if isinstance(e, dict) and e.get("t") == "page"]
            return len(pages), " · ".join(str(e.get("title", "")) for e in pages[:4] if e.get("title"))[:140]
    except Exception:
        pass
    try:
        order = d.get("order", type=Array)
        if len(order):
            slides = d.get("slides", type=Map)
            titles = []
            for sid in list(order)[:4]:
                sl = slides.get(str(sid))
                els = sl.get("els") if sl is not None and hasattr(sl, "get") else None
                texts = [str(e.get("text", "")).strip() for e in els.values() if hasattr(e, "get") and e.get("role") == "title"] if els is not None else []
                titles.append(next((t for t in texts if t), "Untitled"))
            return len(order), " · ".join(titles)[:140]
    except Exception:
        pass
    text = html.unescape(re.sub(r"<[^>]+>", " ", xml))
    words = text.split()
    if words or not tab_list:
        return len(words), " ".join(words)[:140]
    cells, names = 0, []
    for t in sorted(tab_list, key=lambda x: x.get("order", 0)):
        names.append(str(t.get("name", "")))
        try:
            cells += len(d.get("cells:" + str(t.get("id")), type=Map))
        except Exception:
            pass
    return cells, ", ".join(names)[:140]


def latest_time(doc_id: str) -> float:
    with connect() as db:
        row = db.execute("SELECT MAX(created_at) AS t FROM versions WHERE doc_id = ?", (doc_id,)).fetchone()
    return row["t"] or 0.0


# ── how versions are stored ────────────────────────────────────────────────────
# A version is either a FULL copy of the document state, or a DELTA: only what changed since the version before it
# (Yjs already records edits that way). Opening a version replays its chain of deltas on top of the nearest full copy,
# and a full copy is stored every KEYFRAME_EVERY versions so a chain never gets long. `sv` is the state vector each
# version must rebuild to, which is checked every time, so a damaged chain is noticed instead of silently trusted.
KEYFRAME_EVERY = 20
DELTA_WORTH = 0.7   # only store a delta if it is clearly smaller than a full copy


class BrokenVersion(Exception):
    pass


def _state_of(blob: bytes) -> bytes:
    d = Doc()
    d.apply_update(blob)
    return d.get_state()


def _chain(db, vid: str) -> list:
    """The version and its ancestors back to (and including) the nearest full copy, newest first."""
    rows, cur = [], vid
    while cur and len(rows) <= KEYFRAME_EVERY * 4:
        r = db.execute("SELECT id, parent_id, form, ydoc, sv FROM versions WHERE id = ?", (cur,)).fetchone()
        if r is None:
            raise BrokenVersion("a version in the chain is missing")
        rows.append(r)
        if r["form"] == "full":
            return rows
        cur = r["parent_id"]
    raise BrokenVersion("the chain does not reach a full copy")


def build(db, vid: str) -> bytes:
    """The complete document state for a version, however it is stored."""
    rows = _chain(db, vid)
    if len(rows) == 1:
        return bytes(rows[0]["ydoc"])
    d = Doc()
    for r in reversed(rows):
        d.apply_update(bytes(r["ydoc"]))
    want = rows[0]["sv"]
    if want is not None and d.get_state() != bytes(want):
        raise BrokenVersion("this version failed its integrity check")
    return d.get_update()


def _depth(db, vid: str) -> int:
    return len(_chain(db, vid)) - 1


def take_snapshot(doc_id: str, blob: bytes, kind: str, label: str | None = None, authors: list[str] | None = None,
                  skip_duplicate: bool = True) -> dict | None:
    digest = hashlib.sha1(blob).hexdigest()
    words, preview = summarize(blob)
    full = Doc()
    full.apply_update(blob)
    sv = full.get_state()
    vid, now = uuid.uuid4().hex[:16], time.time()
    with connect() as db:
        last = db.execute("SELECT id, hash, form, sv, ydoc FROM versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1", (doc_id,)).fetchone()
        if skip_duplicate and last and last["hash"] == digest:
            return None
        form, parent, payload = "full", None, blob
        if last:
            try:
                last_sv = bytes(last["sv"]) if last["sv"] is not None else (_state_of(bytes(last["ydoc"])) if last["form"] == "full" else None)
                if last["sv"] is None and last_sv is not None:
                    db.execute("UPDATE versions SET sv = ? WHERE id = ?", (last_sv, last["id"]))
                if last_sv is not None and _depth(db, last["id"]) < KEYFRAME_EVERY:
                    delta = full.get_update(last_sv)
                    if len(delta) < len(blob) * DELTA_WORTH:
                        # prove it rebuilds to exactly this state before trusting it; otherwise keep a full copy
                        check = Doc()
                        check.apply_update(build(db, last["id"]))
                        check.apply_update(delta)
                        if check.get_state() == sv:
                            form, parent, payload = "delta", last["id"], delta
            except BrokenVersion:
                pass   # the previous chain is damaged: start a fresh one with a full copy
        owner = db.execute("SELECT owner_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if owner:
            try:
                quota.check(db, owner["owner_id"], len(payload))
            except Exception:
                if kind == "auto":
                    return None   # automatic history never pushes an owner over their storage limit
                raise
        db.execute(
            "INSERT INTO versions (id, doc_id, created_at, kind, label, authors, words, preview, hash, ydoc, parent_id, form, sv) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (vid, doc_id, now, kind, (label or "").strip() or None, json.dumps(sorted(set(authors or []))), words, preview, digest, payload, parent, form, sv),
        )
        old = db.execute(
            """SELECT id FROM versions WHERE doc_id = ? AND kind = 'auto' AND label IS NULL AND id NOT IN
               (SELECT id FROM versions WHERE doc_id = ? AND kind = 'auto' AND label IS NULL ORDER BY created_at DESC LIMIT ?)
               ORDER BY created_at""",
            (doc_id, doc_id, AUTO_KEEP),
        ).fetchall()
        for r in old:
            drop_version(db, r["id"])
    return {"id": vid, "created_at": now}


def drop_version(db, vid: str) -> None:
    """Delete one version without breaking the versions built on top of it: its changes are folded into the next one."""
    r = db.execute("SELECT id, parent_id, form, ydoc FROM versions WHERE id = ?", (vid,)).fetchone()
    if r is None:
        return
    for ch in db.execute("SELECT id, form, ydoc FROM versions WHERE parent_id = ?", (vid,)).fetchall():
        if ch["form"] == "delta" and r["form"] == "delta":
            db.execute("UPDATE versions SET ydoc = ?, parent_id = ? WHERE id = ?", (merge_updates(bytes(r["ydoc"]), bytes(ch["ydoc"])), r["parent_id"], ch["id"]))
        elif ch["form"] == "delta":   # we are a full copy: the child becomes the full copy instead
            db.execute("UPDATE versions SET form = 'full', ydoc = ?, parent_id = NULL WHERE id = ?", (build(db, ch["id"]), ch["id"]))
        else:
            db.execute("UPDATE versions SET parent_id = ? WHERE id = ?", (r["parent_id"], ch["id"]))
    db.execute("DELETE FROM versions WHERE id = ?", (vid,))


def compact_legacy() -> int:
    """One-time: turn the old one-full-copy-per-version history into deltas. Each result is verified before it replaces anything.
    Returns the number of versions converted."""
    converted = 0
    with connect() as db:
        if settings_get(db, "versions_compacted") == "1":
            return 0
        docs = [r["doc_id"] for r in db.execute("SELECT DISTINCT doc_id FROM versions WHERE sv IS NULL")]
    for doc_id in docs:
        with connect() as db:
            rows = db.execute("SELECT id, ydoc, sv FROM versions WHERE doc_id = ? ORDER BY created_at", (doc_id,)).fetchall()
            prev_id, prev_sv, depth = None, None, 0
            for r in rows:
                if r["sv"] is not None:   # already in the new format (made while this was running)
                    prev_id, prev_sv, depth = r["id"], bytes(r["sv"]), _depth(db, r["id"])
                    continue
                blob = bytes(r["ydoc"])
                d = Doc()
                d.apply_update(blob)
                sv = d.get_state()
                done = False
                if prev_id and prev_sv is not None and depth < KEYFRAME_EVERY:
                    delta = d.get_update(prev_sv)
                    if len(delta) < len(blob) * DELTA_WORTH:
                        try:
                            check = Doc()
                            check.apply_update(build(db, prev_id))
                            check.apply_update(delta)
                            ok = check.get_state() == sv
                        except BrokenVersion:
                            ok = False
                        if ok:
                            db.execute("UPDATE versions SET form = 'delta', parent_id = ?, ydoc = ?, sv = ? WHERE id = ?", (prev_id, delta, sv, r["id"]))
                            converted += 1
                            depth += 1
                            done = True
                if not done:
                    db.execute("UPDATE versions SET form = 'full', parent_id = NULL, sv = ? WHERE id = ?", (sv, r["id"]))
                    depth = 0
                prev_id, prev_sv = r["id"], sv
    with connect() as db:
        settings_set(db, "versions_compacted", "1")
    return converted


def start_compaction() -> None:
    def run():
        try:
            compact_legacy()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()
