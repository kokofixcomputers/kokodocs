"""Per-user storage quota. Counts what a person owns: document and spreadsheet data, saved versions and uploaded images.
The limit is a server-wide default (500 MB) that an admin can change, with an optional override per user (0 = unlimited)."""
from fastapi import HTTPException

from .db import settings_get

DEFAULT_MB = 500
MB = 1024 * 1024


def default_mb(db) -> int:
    try:
        return max(0, int(settings_get(db, "default_quota_mb", str(DEFAULT_MB))))
    except ValueError:
        return DEFAULT_MB


def limit_bytes(db, user) -> int:
    """0 means unlimited."""
    mb = user["quota_mb"] if user["quota_mb"] is not None else default_mb(db)
    return int(mb) * MB


def zk_bytes(db, uid: str) -> int:
    """What a person's encrypted documents take up (their updates and snapshots)."""
    a = db.execute("SELECT COALESCE(SUM(LENGTH(u.blob)), 0) FROM zk_updates u JOIN documents d ON d.id = u.doc_id WHERE d.owner_id = ?", (uid,)).fetchone()[0]
    b = db.execute("SELECT COALESCE(SUM(LENGTH(c.blob)), 0) FROM zk_checkpoints c JOIN documents d ON d.id = c.doc_id WHERE d.owner_id = ?", (uid,)).fetchone()[0]
    return a + b


def breakdown(db, uid: str) -> dict:
    docs = db.execute("SELECT COALESCE(SUM(LENGTH(ydoc)), 0) FROM documents WHERE owner_id = ?", (uid,)).fetchone()[0] + zk_bytes(db, uid)
    versions = db.execute("SELECT COALESCE(SUM(LENGTH(v.ydoc)), 0) FROM versions v JOIN documents d ON d.id = v.doc_id WHERE d.owner_id = ?", (uid,)).fetchone()[0]
    images = db.execute("SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = ?", (uid,)).fetchone()[0]
    files = db.execute("SELECT COALESCE(SUM(f.size), 0) FROM form_files f JOIN documents d ON d.id = f.form_id WHERE d.owner_id = ?", (uid,)).fetchone()[0]
    return {"documents": docs, "versions": versions, "images": images, "files": files, "total": docs + versions + images + files}


def per_document(db, uid: str) -> dict:
    """What each file the person owns takes up, split the same way as the totals, largest first. Pictures that belong to no file any more are listed apart."""
    rows = db.execute("""SELECT d.id, d.title, d.kind, d.deleted_at, COALESCE(LENGTH(d.ydoc), 0) + (SELECT COALESCE(SUM(LENGTH(u.blob)), 0) FROM zk_updates u WHERE u.doc_id = d.id) + (SELECT COALESCE(SUM(LENGTH(c.blob)), 0) FROM zk_checkpoints c WHERE c.doc_id = d.id) AS text,
        (SELECT COALESCE(SUM(LENGTH(v.ydoc)), 0) FROM versions v WHERE v.doc_id = d.id) AS versions,
        (SELECT COALESCE(SUM(u.size), 0) FROM uploads u WHERE u.doc_id = d.id AND u.owner_id = d.owner_id) AS images,
        (SELECT COALESCE(SUM(f.size), 0) FROM form_files f WHERE f.form_id = d.id) AS files
        FROM documents d WHERE d.owner_id = ?""", (uid,)).fetchall()
    items = [{"id": r["id"], "title": r["title"], "kind": r["kind"], "trashed": r["deleted_at"] is not None, "text": r["text"], "versions": r["versions"], "images": r["images"], "files": r["files"],
              "total": r["text"] + r["versions"] + r["images"] + r["files"]} for r in rows]
    items.sort(key=lambda i: i["total"], reverse=True)
    total_images = db.execute("SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = ?", (uid,)).fetchone()[0]
    return {"items": items, "unattached_images": max(0, total_images - sum(i["images"] for i in items))}


def usage_all(db) -> dict[str, int]:
    out: dict[str, int] = {}
    for q in ("SELECT owner_id AS u, SUM(LENGTH(ydoc)) AS n FROM documents GROUP BY owner_id",
              "SELECT d.owner_id AS u, SUM(LENGTH(v.ydoc)) AS n FROM versions v JOIN documents d ON d.id = v.doc_id GROUP BY d.owner_id",
              "SELECT owner_id AS u, SUM(size) AS n FROM uploads GROUP BY owner_id",
              "SELECT d.owner_id AS u, SUM(LENGTH(z.blob)) AS n FROM zk_updates z JOIN documents d ON d.id = z.doc_id GROUP BY d.owner_id",
              "SELECT d.owner_id AS u, SUM(LENGTH(z.blob)) AS n FROM zk_checkpoints z JOIN documents d ON d.id = z.doc_id GROUP BY d.owner_id",
              "SELECT d.owner_id AS u, SUM(f.size) AS n FROM form_files f JOIN documents d ON d.id = f.form_id GROUP BY d.owner_id"):
        for r in db.execute(q):
            out[r["u"]] = out.get(r["u"], 0) + (r["n"] or 0)
    return out


def status(db, user) -> dict:
    b = breakdown(db, user["id"])
    return {**b, "limit": limit_bytes(db, user), "used": b["total"]}


def check(db, owner_id: str, extra: int = 0, who: str = "This account") -> None:
    """Raises 413 if adding `extra` bytes would put the owner over their limit."""
    u = db.execute("SELECT * FROM users WHERE id = ?", (owner_id,)).fetchone()
    if not u:
        return
    lim = limit_bytes(db, u)
    if lim and breakdown(db, owner_id)["total"] + extra > lim:
        raise HTTPException(413, {"code": "quota_exceeded", "message": f"{who} is out of storage ({lim // MB} MB). Delete some files or ask an admin for more space."})


def drop_uploads(db, where: str, args: tuple = ()) -> None:
    """Delete uploaded images (rows and files) belonging to the documents matched by `where`. Call before deleting them."""
    from .db import FORM_FILES_DIR, UPLOAD_DIR
    for r in db.execute(f"SELECT stored FROM form_files WHERE form_id IN (SELECT id FROM documents WHERE {where})", args).fetchall():
        try:
            (FORM_FILES_DIR / r["stored"]).unlink(missing_ok=True)
        except OSError:
            pass
    db.execute(f"DELETE FROM form_files WHERE form_id IN (SELECT id FROM documents WHERE {where})", args)
    # a picture can be used by several files (identical pictures are stored once): only remove it when no file uses it any more
    gone = f"SELECT id FROM documents WHERE {where}"
    cand = {r["name"] for r in db.execute(f"SELECT name FROM upload_refs WHERE doc_id IN ({gone})", args)} | {r["name"] for r in db.execute(f"SELECT name FROM uploads WHERE doc_id IN ({gone})", args)}
    db.execute(f"DELETE FROM upload_refs WHERE doc_id IN ({gone})", args)
    for n in cand:
        keep = db.execute("SELECT doc_id FROM upload_refs WHERE name = ? LIMIT 1", (n,)).fetchone()
        if keep:
            db.execute("UPDATE uploads SET doc_id = ? WHERE name = ?", (keep["doc_id"], n))   # now counted under a file that still uses it
            continue
        try:
            (UPLOAD_DIR / n).unlink(missing_ok=True)
        except OSError:
            pass
        db.execute("DELETE FROM uploads WHERE name = ?", (n,))
        db.execute("DELETE FROM image_aliases WHERE target = ?", (n,))
