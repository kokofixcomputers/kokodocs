"""Profile pictures. Fresh data folder; needs Pillow."""
import io, json, sys, urllib.error, urllib.request, os
B = "http://127.0.0.1:8000"
fails = 0
def ok(name, cond, *extra):
    global fails
    print(("PASS " if cond else "FAIL ") + name, *([] if cond else extra)); fails += 0 if cond else 1
def call(method, path, body=None, tok=None, raw=None, ctype=None):
    h = {}
    if tok: h["authorization"] = "Bearer " + tok
    data = raw
    if raw is None and body is not None: data = json.dumps(body).encode(); h["content-type"] = "application/json"
    if ctype: h["content-type"] = ctype
    req = urllib.request.Request(B + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req) as r: b = r.read(); return r.status, (json.loads(b) if b[:1] in (b"{", b"[") else b), r.headers
    except urllib.error.HTTPError as e:
        b = e.read(); return e.code, (json.loads(b) if b[:1] in (b"{", b"[") else b), e.headers
def upload(tok, data, name="a.png"):
    bd = "----k1"; body = (f'--{bd}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + data + f"\r\n--{bd}--\r\n".encode()
    return call("POST", "/api/me/avatar", tok=tok, raw=body, ctype=f"multipart/form-data; boundary={bd}")
from PIL import Image
buf = io.BytesIO(); Image.new("RGB", (600, 300), (200, 30, 30)).save(buf, "PNG"); png = buf.getvalue()
A = call("POST", "/api/auth/signup", {"email": "a@x.io", "name": "Ann", "password": "password123"})[1]["token"]
me = call("GET", "/api/auth/me", tok=A)[1]
ok("no avatar at first", me["avatar"] is None)
s, r, _ = upload(A, png)
ok("upload works", s == 200 and r["avatar"].startswith(f"/api/avatars/{me['id']}?v="), s, r)
s, img, h = call("GET", r["avatar"])
im = Image.open(io.BytesIO(img))
ok("served as a 256 square webp, public and cacheable", s == 200 and im.size == (256, 256) and im.format == "WEBP" and "immutable" in h["cache-control"], im.size, h.get("cache-control"))
ok("me shows it", call("GET", "/api/auth/me", tok=A)[1]["avatar"] == r["avatar"])
d = call("POST", "/api/docs", {"title": "T"}, A)[1]["id"]
cid = call("POST", f"/api/docs/{d}/comments", {"body": "hi", "quote": "", "mentions": []}, A)
lst = call("GET", f"/api/docs/{d}/comments", tok=A)[1]
ok("comments carry it", lst and lst[0]["avatar"] == r["avatar"], cid[:2], lst)
x = call("GET", f"/api/docs/{d}", tok=A); ok("doc info has owner avatar", x[0] == 200 and x[1]["owner_avatar"] == r["avatar"])
ok("not an image is refused", upload(A, b"not a picture")[0] == 422)
ok("too big is refused", upload(A, b"x" * (9 * 1024 * 1024))[0] == 413)
ok("signed out can't upload", upload(None, png)[0] == 401)
s, r2, _ = call("DELETE", "/api/me/avatar", tok=A)
ok("remove works", s == 200 and call("GET", "/api/auth/me", tok=A)[1]["avatar"] is None and call("GET", r["avatar"])[0] == 404)
print("fails", fails); sys.exit(1 if fails else 0)
