"""Branching: fork a document into a new one the caller owns. Fresh data folder."""
import json, sys, urllib.error, urllib.request
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

A, V = signup("a@x.io"), signup("v@x.io")
d = call("POST", "/api/docs", {"title": "Spec"}, A)[1]["id"]
s, r = call("POST", f"/api/docs/{d}/branch", {}, A)
ok("owner can branch", s == 200 and r["title"] == "Spec (branch)" and r["role"] == "owner", s, r)
info = call("GET", f"/api/docs/{r['id']}", tok=A)[1]
ok("branch knows its origin", info["branch"] and info["branch"]["id"] == d, info.get("branch"))
ok("original has no origin", call("GET", f"/api/docs/{d}", tok=A)[1]["branch"] is None)
call("PUT", f"/api/docs/{d}/sharing", {"link_access": "anyone", "link_role": "viewer"}, A)
s, r2 = call("POST", f"/api/docs/{d}/branch", {"title": "Mine"}, V)
ok("a viewer can fork the current document into their own", s == 200 and r2["title"] == "Mine", s, r2)
ok("…and sees where it came from", call("GET", f"/api/docs/{r2['id']}", tok=V)[1]["branch"]["id"] == d)
ok("a viewer can't branch at a version", call("POST", f"/api/docs/{d}/branch", {"version_id": "nope"}, V)[0] == 403)
ok("unknown version is a 404", call("POST", f"/api/docs/{d}/branch", {"version_id": "nope"}, A)[0] == 404)
f = call("POST", "/api/docs", {"title": "F", "kind": "form"}, A)[1]["id"]
ok("forms can't be branched", call("POST", f"/api/docs/{f}/branch", {}, A)[0] == 409)
print("fails", fails); sys.exit(1 if fails else 0)
