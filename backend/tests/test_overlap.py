"""Two server processes saving the same document (an update being rolled out) must not overwrite each other. Runs in-process on a temp database."""
import os, sys, tempfile
os.environ["KOKO_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pycrdt import Doc, Text
from app import db as dbm, collab
dbm.init_db()
fails = 0
def ok(n, c):
    global fails; print(("PASS " if c else "FAIL ") + n); fails += 0 if c else 1
with dbm.connect() as c:
    c.execute("INSERT INTO users (id,email,name,password_hash,color,created_at) VALUES ('u','a@x.io','A','x','#000',0)")
    c.execute("INSERT INTO documents (id,owner_id,created_at,updated_at) VALUES ('d','u',0,0)")
    c.commit()
def stored():
    with dbm.connect() as c: return bytes(c.execute("SELECT ydoc FROM documents WHERE id='d'").fetchone()["ydoc"])
def text(blob):
    d = Doc(); d["t"] = t = Text(); d.apply_update(blob); return str(t)
# the old server and the new one start from the same document
base = Doc(); base["t"] = bt = Text(); bt += "hello"
collab._write("d", base.get_update())
old = Doc(); old.apply_update(base.get_update()); old["t"] = ot = Text()
new = Doc(); new.apply_update(base.get_update()); new["t"] = nt = Text()
ot += " from old"
collab._last_written["d"] = b"old process"      # (what the old process remembers is irrelevant here: the point is the second writer)
collab._write("d", old.get_update())
# the "new" server, a separate process, only knows what it wrote before; simulate by clearing the memory of this one
collab._last_written.pop("d", None)
nt += " + new"
collab._write("d", new.get_update())
ok("both edits survive when two writers save", text(stored()) in ("hello from old + new", "hello + new from old", "hello + newfrom old", "hellofrom old + new") or ("from old" in text(stored()) and "+ new" in text(stored())))
# the normal case: one writer whose copy already holds everything just saves it again
m = Doc(); m["t"] = Text(); m.apply_update(stored())
collab._write("d", m.get_update()); collab._write("d", m.get_update())
ok("one writer saving repeatedly keeps the document", "+ new" in text(stored()) and "from old" in text(stored()))
print("fails", fails); sys.exit(1 if fails else 0)
