"""Search filters: type, owner (me / shared), and date; filters alone list files."""
import json, sqlite3, time, urllib.request, urllib.error, urllib.parse
B = "http://127.0.0.1:8000"
fails = 0
def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else " " + str(extra)))
    fails += 0 if cond else 1
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json", **({"authorization": "Bearer " + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")
A = call("POST", "/api/auth/signup", {"email": "a@x.io", "name": "A", "password": "password123"})[1]["token"]
U = call("POST", "/api/auth/signup", {"email": "b@x.io", "name": "B", "password": "password123"})[1]["token"]
mk = lambda t, kind, tok: call("POST", "/api/docs", {"title": t, "kind": kind}, tok)[1]["id"]
d1, d2, d3 = mk("Zebra plan", "doc", A), mk("Zebra budget", "sheet", A), mk("Zebra talk", "slides", U)
call("PUT", f"/api/docs/{d3}/sharing", {"link_access": "restricted", "link_role": "viewer", "shares": [{"email": "a@x.io", "role": "viewer"}]}, U)
old = mk("Zebra history", "doc", A)
c0 = sqlite3.connect("data/kokodocs.sqlite3")   # (files are indexed when someone edits them, or at start-up; index these titles now)
for i, t in ((d1, "Zebra plan"), (d2, "Zebra budget"), (d3, "Zebra talk"), (old, "Zebra history")): c0.execute("INSERT INTO doc_fts (doc_id, title, body) VALUES (?,?,?)", (i, t, ""))
c0.commit(); c0.close()
q = lambda **p: call("GET", "/api/search?" + urllib.parse.urlencode(p), tok=A)[1]
ids = lambda r: {x["id"] for x in r}
check("all four match the word", ids(q(q="zebra")) >= {d1, d2, d3, old}, q(q="zebra"))
check("type: only spreadsheets", ids(q(q="zebra", kind="sheet")) == {d2})
check("type: documents and slides", ids(q(q="zebra", kind="doc,slides")) == {d1, d3, old})
check("owner: me", ids(q(q="zebra", owner="me")) == {d1, d2, old})
check("owner: shared with me", ids(q(q="zebra", owner="shared")) == {d3})
check("filters work without words", ids(q(kind="sheet")) == {d2} and ids(q(owner="shared")) == {d3})
check("no words and no filters finds nothing", q() == [])
check("an unknown type is ignored", ids(q(q="zebra", kind="nonsense")) >= {d1, d2, d3})
check("recent: all are within a day", ids(q(q="zebra", days=1)) >= {d1, d2, d3, old})
# age one file by 10 days directly in the database
import glob
paths = ["data/kokodocs.sqlite3"]
done = False
for p in paths:
    try:
        c = sqlite3.connect(p); c.execute("UPDATE documents SET updated_at = ? WHERE id = ?", (time.time() - 10 * 86400, old)); c.commit(); done = c.total_changes > 0; c.close()
        if done: break
    except sqlite3.Error: pass
check("(aged one file in the database)", done, paths)
if done:
    check("last 7 days leaves the old one out", old not in ids(q(q="zebra", days=7)) and d1 in ids(q(q="zebra", days=7)))
    check("last 30 days brings it back", old in ids(q(q="zebra", days=30)))
    check("filters alone are newest first", [x["id"] for x in q(days=30)][-1] == old)
check("a stranger's private file never shows", d3 not in ids(call("GET", "/api/search?q=zebra", tok=call("POST", "/api/auth/signup", {"email": "c@x.io", "name": "C", "password": "password123"})[1]["token"])[1]))
print("ALL OK" if not fails else f"{fails} FAILED")
