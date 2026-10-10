"""On startup, find pictures a person stored more than once (identical bytes) and keep a single copy.

Documents refer to pictures by address (/api/images/<name>), so an address that is already out there must keep working. Each
duplicate therefore becomes an alias that points at the surviving copy: its file is deleted, its row is removed (so the person's
storage drops by that much) and the files that used it are now counted under the surviving copy."""
import threading

from .db import UPLOAD_DIR, connect


def merge_duplicates() -> dict:
    merged = saved = 0
    with connect() as db:
        groups = db.execute("SELECT owner_id, hash, size FROM uploads WHERE remote = 0 AND hash IS NOT NULL AND hash != '-' GROUP BY owner_id, hash, size HAVING COUNT(*) > 1").fetchall()
    for g in groups:
        doomed: list = []
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")   # nothing else adds or removes pictures while this group is being merged
            rows = db.execute("SELECT name FROM uploads WHERE remote = 0 AND owner_id = ? AND hash = ? AND size = ? ORDER BY created_at, name", (g["owner_id"], g["hash"], g["size"])).fetchall()
            canon, data = None, b""
            for r in rows:   # the oldest copy that still has its file survives
                try:
                    data = (UPLOAD_DIR / r["name"]).read_bytes()
                    canon = r["name"]
                    break
                except OSError:
                    continue
            if canon is None:
                continue
            for r in rows:
                n = r["name"]
                if n == canon:
                    continue
                path = UPLOAD_DIR / n
                if path.exists():
                    try:
                        if path.read_bytes() != data:   # same fingerprint but different bytes: leave it alone
                            continue
                    except OSError:
                        continue
                for ref in db.execute("SELECT doc_id FROM upload_refs WHERE name = ?", (n,)).fetchall():
                    db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)", (canon, ref["doc_id"]))
                db.execute("DELETE FROM upload_refs WHERE name = ?", (n,))
                db.execute("UPDATE image_aliases SET target = ? WHERE target = ?", (canon, n))
                db.execute("INSERT OR REPLACE INTO image_aliases (name, target) VALUES (?,?)", (n, canon))
                db.execute("DELETE FROM uploads WHERE name = ?", (n,))
                doomed.append(path)
                merged += 1
                saved += g["size"]
        for p in doomed:   # only after the database change is committed
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
    return {"merged": merged, "bytes": saved}


def start_merge() -> threading.Thread:
    def run():
        try:
            r = merge_duplicates()
            if r["merged"]:
                print(f"KokoDocs: merged {r['merged']} duplicate picture(s), freeing {r['bytes']:,} bytes", flush=True)
        except Exception as e:  # never stop the app from starting over housekeeping
            print("KokoDocs: picture merge skipped:", e, flush=True)
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t
