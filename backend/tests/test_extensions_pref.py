"""Extensions are stored in the account's synced prefs, with limits. Fresh data folder."""
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
T = call("POST", "/api/auth/signup", {"email": "e@x.io", "name": "E", "password": "password123"})[1]["token"]
ext = lambda **k: {"id": "abc123", "name": "Mine", "code": "koko.toast('hi')", "enabled": True, **k}
put = lambda v: call("PUT", "/api/me/prefs/extensions", {"value": v}, T)[0]
ok("saves", put({"items": [ext()], "theme": ""}) == 200)
ok("syncs back", call("GET", "/api/me/prefs", tok=T)[1]["extensions"]["items"][0]["code"] == "koko.toast('hi')")
ok("100 KB code limit", put({"items": [ext(code="a" * 110000)], "theme": ""}) == 422)
ok("at most 20", put({"items": [ext(id=f"x{i}") for i in range(21)], "theme": ""}) == 422)
ok("duplicate ids refused", put({"items": [ext(), ext()], "theme": ""}) == 422)
ok("name required", put({"items": [ext(name="")], "theme": ""}) == 422)
ok("bad shape refused", put({"items": "nope"}) == 422)
print("fails", fails); sys.exit(1 if fails else 0)
