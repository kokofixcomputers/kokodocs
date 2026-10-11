"""Link expiry: choose 7 days / 30 days / never; an expired link stops working and goes back to restricted. Fresh data folder."""
import json, os, sqlite3, sys, time, urllib.error, urllib.request
B = "http://127.0.0.1:8000"
fails = 0
def ok(name, cond, *extra):
    global fails
    print(("PASS " if cond else "FAIL ") + name, *([] if cond else extra)); fails += 0 if cond else 1
def call(method, path, body=None, tok=None):
    h = {"content-type": "application/json"}
    if tok: h["authorization"] = "Bearer " + tok
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        b = e.read(); return e.code, (json.loads(b) if b[:1] in (b"{", b"[") else b)
def signup(e): return call("POST", "/api/auth/signup", {"email": e, "name": e.split("@")[0], "password": "password123"})[1]["token"]
DB = "data/kokodocs.sqlite3"
def sql(q, *a):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: r = c.execute(q, a).fetchall(); c.commit(); return r
    finally: c.close()

T = signup("own@x.io")
d = call("POST", "/api/docs", {"title": "Shared"}, T)[1]["id"]
ok("anonymous blocked at first", call("GET", f"/api/docs/{d}")[0] in (401, 403))
s, r = call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer", "expires": "7d"}, T)
ok("7d sets expiry", s == 200 and abs(r["link_expires_at"] - (time.time() + 7 * 86400)) < 60, s, r)
ok("anonymous can open", call("GET", f"/api/docs/{d}")[0] == 200)
s, r = call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer"}, T)
ok("keep leaves expiry", abs(r["link_expires_at"] - (time.time() + 7 * 86400)) < 60)
s, r = call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer", "expires": "30d"}, T)
ok("30d", abs(r["link_expires_at"] - (time.time() + 30 * 86400)) < 60)
s, r = call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer", "expires": "never"}, T)
ok("never clears", r["link_expires_at"] is None)
call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer", "expires": "7d"}, T)
sql("UPDATE documents SET link_expires_at = ? WHERE id = ?", time.time() - 5, d)
ok("expired link no longer opens (before the sweep)", call("GET", f"/api/docs/{d}")[0] in (401, 403))
ok("owner info reports restricted", call("GET", f"/api/docs/{d}", tok=T)[1]["link"]["access"] == "restricted")
from importlib import import_module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("KOKO_DATA", "data")
c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
sys.argv = ["x"]
from app import expiry
changed = expiry.sweep(c); c.close()
ok("sweep reports it", changed == [d], changed)
row = sql("SELECT link_access, link_expires_at FROM documents WHERE id = ?", d)[0]
ok("sweep restricts and clears", row["link_access"] == "restricted" and row["link_expires_at"] is None)
ok("owner notified", any("expired" in n["text"] for n in call("GET", "/api/notifications", tok=T)[1].get("items", call("GET", "/api/notifications", tok=T)[1]) if isinstance(n, dict)) if True else False)
# folders
f = call("POST", "/api/folders", {"name": "F"}, T)[1]["id"]
s, r = call("PUT", f"/api/folders/{f}/sharing", {"link_access": "anyone", "link_role": "viewer", "expires": "30d"}, T)
ok("folder expiry", s == 200 and r["link_expires_at"] and r["link_access"] == "anyone", s, r)
s, r = call("PUT", f"/api/folders/{f}/sharing", {"link_access": "restricted"}, T)
ok("restricted clears folder expiry", r["link_expires_at"] is None)
# request edit access
call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer"}, T)
V = signup("viewer@x.io")
ok("anonymous can't request", call("POST", f"/api/docs/{d}/request-access", {"message": ""})[0] == 401)
s, r = call("POST", f"/api/docs/{d}/request-access", {"message": "please?"}, V)
ok("viewer can request", s == 200, s, r)
ok("owner can't (already edits)", call("POST", f"/api/docs/{d}/request-access", {"message": ""}, T)[0] == 409)
n = call("GET", "/api/notifications", tok=T)[1]
n = n if isinstance(n, list) else n.get("items", n.get("notifications", []))
ok("owner notified of request", any(x["kind"] == "access" and x["text"] == "please?" for x in n), n)
for _ in range(3): s, _r = call("POST", f"/api/docs/{d}/request-access", {"message": ""}, V)
ok("rate limited", s == 429, s)
print("fails", fails); sys.exit(1 if fails else 0)
