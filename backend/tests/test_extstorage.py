"""Extended storage: a person's own storage (folder, WebDAV, S3) takes their files off this server, and opening a file brings it back.
Start the server with: KOKO_STORAGE_ALLOW_PRIVATE=1 KOKO_STORAGE_FOLDER_ROOT=/tmp/kokostore  (a fresh data folder)."""
import base64, hashlib, http.server, io, json, os, sqlite3, struct, sys, threading, time, urllib.error, urllib.request, zipfile, zlib, shutil
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
B = "http://127.0.0.1:8000"
fails = 0
def ok(name, cond, *extra):
    global fails
    print(("PASS " if cond else "FAIL ") + name, *([] if cond else extra))
    fails += 0 if cond else 1
def call(method, path, body=None, tok=None, raw=False, headers=None):
    data = body if isinstance(body, (bytes, bytearray)) else (json.dumps(body).encode() if body is not None else None)
    h = {"authorization": "Bearer " + tok} if tok else {}
    if not isinstance(body, (bytes, bytearray)): h["content-type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(B + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req) as r: b = r.read(); return r.status, (b if raw else json.loads(b or b"null"))
    except urllib.error.HTTPError as e:
        b = e.read(); return e.code, (b if raw else (json.loads(b) if b[:1] in (b"{", b"[") else b))
def multipart(path, fname, data, tok):
    bd = "----k" + os.urandom(4).hex()
    body = (f'--{bd}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + data + f"\r\n--{bd}--\r\n".encode()
    return call("POST", path, body, tok, headers={"content-type": f"multipart/form-data; boundary={bd}"})
def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def ch(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")
DB = "data/kokodocs.sqlite3"
def q(sql, *a):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: return c.execute(sql, a).fetchall()
    finally: c.close()

# ── mock WebDAV and S3 servers ──
class Mock:
    def __init__(self, kind):
        self.kind, self.files, self.cols, self.puts, self.down, self.corrupt, self.fail_put = kind, {}, {"/"}, 0, False, False, set()
        mock = self
        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def _body(self): n = int(self.headers.get("content-length") or 0); return self.rfile.read(n) if n else b""
            def _reply(self, code, body=b"", headers=None):
                self.send_response(code); hs = headers or {}; [self.send_header(k, v) for k, v in hs.items()]
                if "content-length" not in hs: self.send_header("content-length", str(len(body)))
                self.end_headers(); self.wfile.write(body)
            def _auth(self, body):
                if mock.down: self._reply(503); return False
                if mock.kind == "webdav":
                    want = "Basic " + base64.b64encode(b"alice:secret").decode()
                    if self.headers.get("authorization") != want: self._reply(401); return False
                else:
                    a = self.headers.get("authorization", "")
                    if not a.startswith("AWS4-HMAC-SHA256 Credential=AKIATEST/") or "/us-east-1/s3/aws4_request" not in a: self._reply(403); return False
                    if self.headers.get("x-amz-content-sha256") != hashlib.sha256(body).hexdigest(): self._reply(400, b"bad payload hash"); return False
                return True
            def handle_any(self):
                body = self._body()
                if not self._auth(body): return
                p = self.path.split("?")[0]
                m = self.command
                if mock.kind == "s3":
                    if not p.startswith("/bucket1/"): return self._reply(404)
                    p = p[len("/bucket1"):]
                if m == "MKCOL":
                    if p.rstrip("/") in mock.cols: return self._reply(405)
                    mock.cols.add(p.rstrip("/")); return self._reply(201)
                if m == "PUT":
                    if any(x in p for x in mock.fail_put): return self._reply(500, b"boom")
                    parent = p.rsplit("/", 1)[0] or "/"
                    if mock.kind == "webdav" and parent not in mock.cols: return self._reply(409)
                    mock.files[p] = body; mock.puts += 1; return self._reply(201)
                if m in ("GET", "HEAD"):
                    if p not in mock.files: return self._reply(404)
                    d = mock.files[p]
                    if mock.corrupt and m == "GET" and "docs/" in p: d = d[:-5] + b"XXXXX"
                    return self._reply(200, d if m == "GET" else b"", {"content-length": str(len(d))} if m == "HEAD" else None)
                if m == "DELETE":
                    mock.files.pop(p, None); return self._reply(204)
                self._reply(405)
            do_GET = do_PUT = do_DELETE = do_HEAD = do_MKCOL = handle_any
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
dav, s3 = Mock("webdav"), Mock("s3")
shutil.rmtree("/tmp/kokostore", ignore_errors=True); os.makedirs("/tmp/kokostore")
CONFIGS = {
    "folder": {"kind": "folder", "config": {"path": "mine"}},
    "webdav": {"kind": "webdav", "config": {"url": f"http://127.0.0.1:{dav.port}/remote.php", "username": "alice", "password": "secret", "prefix": "koko"}},
    "s3": {"kind": "s3", "config": {"endpoint": f"http://127.0.0.1:{s3.port}", "region": "us-east-1", "bucket": "bucket1", "access_key": "AKIATEST", "secret_key": "sekrit", "prefix": "koko"}},
}
def stored(kind, path):
    if kind == "folder": p = os.path.join("/tmp/kokostore/mine", path); return open(p, "rb").read() if os.path.exists(p) else None
    if kind == "webdav": return dav.files.get(f"/remote.php/koko/{path}")
    return s3.files.get(f"/koko/{path}")
def wait(cond, secs=25):
    t = time.time()
    while time.time() - t < secs:
        if cond(): return True
        time.sleep(0.4)
    return False
def signup(email):
    return call("POST", "/api/auth/signup", {"email": email, "name": email.split("@")[0], "password": "password123"})[1]["token"]
def doc_text(doc_id, text):
    from pycrdt import Doc, Text
    d = Doc(); d["default"] = Text(text)   # (any bytes will do as the document's state)
    c = sqlite3.connect(DB); c.execute("UPDATE documents SET ydoc = ? WHERE id = ?", (d.get_update(), doc_id)); c.commit(); c.close()
    return d.get_update()

# unit: address checks
os.environ.pop("KOKO_STORAGE_ALLOW_PRIVATE", None)
from app.extstore import backends
for bad in ("http://example.com/x", "https://127.0.0.1/x", "https://user:pw@example.com/", "ftp://example.com"):
    try: backends.check_url(bad); ok("refuses " + bad, False)
    except backends.StorageError: ok("refuses " + bad, True)

IMG = png(40, 30, (200, 40, 90))
for kind in ("folder", "webdav", "s3"):
    print("=====", kind)
    T = signup(f"{kind}@x.io"); OTHER = signup(f"{kind}-b@x.io")
    s, d = call("POST", "/api/docs", {"title": f"Report {kind}", "kind": "doc"}, T); doc = d["id"]
    state = doc_text(doc, f"Secret plans for {kind}")
    call("PUT", f"/api/docs/{doc}/sharing", {"link_access": "restricted", "link_role": "viewer", "shares": [{"email": f"{kind}-b@x.io", "role": "editor"}]}, T)
    s, c = call("POST", f"/api/docs/{doc}/comments", {"body": "First comment about plans", "quote": "Secret"}, T); ok("a comment is made", s == 200, s, c)
    s, v = call("POST", f"/api/docs/{doc}/versions", {"label": "v1"}, T); ok("a version is saved", s == 200, s, v)
    s, im = multipart(f"/api/docs/{doc}/images", "a.png", IMG, T); iname = im["url"].split("/")[-1] if s == 200 else ""
    ok("a picture is uploaded", s == 200 and os.path.exists("data/uploads/" + iname), s, im)
    s, r = call("PUT", "/api/storage", {**CONFIGS[kind], "enabled": True, "idle_minutes": 5, "keep_search": False}, T)
    ok("the storage is connected after a test file round trip", s == 200 and "Connected" in r.get("message", ""), s, r)
    strings = []
    def walk(x):
        if isinstance(x, dict): [walk(v) for v in x.values()]
        elif isinstance(x, list): [walk(v) for v in x]
        elif isinstance(x, str): strings.append(x)
    walk(r)
    ok("its password or key is never sent back", not any(v in ("secret", "sekrit") for v in strings) and "password" not in r["connection"]["config"] and "secret_key" not in r["connection"]["config"], r)
    ok("someone else sees no storage", call("GET", "/api/storage", None, OTHER)[1]["connection"] is None)
    s, r = call("POST", "/api/storage/move", None, T); ok("move now", s == 200)
    ok("the document leaves this server", wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote"), q("SELECT remote_state, remote_error FROM documents WHERE id = ?", doc)[0][:])
    row = q("SELECT ydoc FROM documents WHERE id = ?", doc)[0]
    ok("its text is gone from the database", row["ydoc"] is None)
    ok("and its comments and versions", not q("SELECT 1 FROM comments WHERE doc_id = ?", doc) and not q("SELECT 1 FROM versions WHERE doc_id = ?", doc))
    ok("and its search text", (q("SELECT body FROM doc_fts WHERE doc_id = ?", doc) or [[""]])[0][0] == "")
    ok("the title and sharing stay", q("SELECT title FROM documents WHERE id = ?", doc)[0][0] == f"Report {kind}" and len(q("SELECT 1 FROM shares WHERE doc_id = ?", doc)) == 1)
    ok("the picture file left the server", wait(lambda: not os.path.exists("data/uploads/" + iname)) and q("SELECT remote FROM uploads WHERE name = ?", iname)[0][0] == 1)
    blob = stored(kind, f"docs/{doc}.kokodocs")
    ok("the document is in the storage as a .kokodocs file", blob is not None and blob[:2] == b"PK", None if blob is None else blob[:4])
    z = zipfile.ZipFile(io.BytesIO(blob)); man = json.loads(z.read("manifest.json"))
    ok("which is a zip with a manifest, a type marker and the state", z.namelist()[0] == "mimetype" and z.read("mimetype") == b"application/x-kokodocs" and man["format"] == "kokodocs" and man["doc"]["id"] == doc and z.read("state.ydoc") == state, z.namelist())
    ok("and the picture is stored beside it", stored(kind, f"files/uploads/{iname}") == IMG)
    s, got = call("GET", f"/api/images/{iname}", None, None, raw=True); ok("the picture is still shown (fetched from the storage)", s == 200 and got == IMG, s)
    # opening it brings it back
    s, info = call("GET", f"/api/docs/{doc}", None, OTHER); ok("someone it is shared with opens it", s == 200 and info["title"] == f"Report {kind}", s, info)
    ok("it is back on the server", q("SELECT remote_state, length(ydoc) FROM documents WHERE id = ?", doc)[0][0] == "cached" and q("SELECT length(ydoc) FROM documents WHERE id = ?", doc)[0][0] == len(state))
    s, cs = call("GET", f"/api/docs/{doc}/comments", None, T); ok("with its comments", s == 200 and any("First comment" in c["body"] for c in cs), cs)
    s, vs = call("GET", f"/api/docs/{doc}/versions", None, T); ok("and its versions", s == 200 and any(x.get("label") == "v1" for x in vs), vs)
    # unchanged: moving again does not upload again
    puts = (dav if kind == "webdav" else s3).puts
    call("POST", "/api/storage/move", None, T)
    ok("moving it again, unchanged, sends nothing", wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote") and (kind == "folder" or (dav if kind == "webdav" else s3).puts == puts), (dav if kind == "webdav" else s3).puts, puts)
    # changed: a new comment goes into the file
    call("GET", f"/api/docs/{doc}", None, T)
    call("POST", f"/api/docs/{doc}/comments", {"body": "Second comment, added later", "quote": ""}, T)
    call("POST", "/api/storage/move", None, T)
    ok("an edited document is saved again", wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote"))
    z = zipfile.ZipFile(io.BytesIO(stored(kind, f"docs/{doc}.kokodocs")))
    ok("with the new comment in it", "Second comment" in z.read("tables/comments.json").decode())
    # a .kokodocs file to take away, and to open
    s, kd = call("GET", f"/api/docs/{doc}/kokodocs", None, T, raw=True)
    z2 = zipfile.ZipFile(io.BytesIO(kd)) if s == 200 else None
    ok("a .kokodocs file can be downloaded, with its picture inside", s == 200 and f"files/uploads/{iname}" in z2.namelist() and z2.read(f"files/uploads/{iname}") == IMG, s)
    s, new = multipart("/api/import/kokodocs", "Report.kokodocs", kd, T)
    ok("and opened as a new document", s == 200 and new["title"] == f"Report {kind}" and new["id"] != doc, s, new)
    if s == 200:
        ok("with its text, comments and picture", bytes(q("SELECT ydoc FROM documents WHERE id = ?", new["id"])[0][0]) == state and len(q("SELECT 1 FROM comments WHERE doc_id = ?", new["id"])) == 2 and len(q("SELECT 1 FROM upload_refs WHERE doc_id = ?", new["id"])) >= 1)
    s, bad = multipart("/api/import/kokodocs", "x.kokodocs", b"not a zip at all", T); ok("a file that isn't a KokoDocs file is refused", s == 422, s, bad)
    # damaged / unreachable storage
    mock = dav if kind == "webdav" else s3 if kind == "s3" else None
    if mock:
        call("POST", "/api/storage/move", None, T); wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote")
        mock.down = True
        s, e = call("GET", f"/api/docs/{doc}", None, T); ok("storage down: opening says so instead of showing an empty file", s == 503 and "storage" in json.dumps(e).lower(), s, e)
        ok("and nothing was lost meanwhile", q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote")
        mock.down = False
        s, e = call("GET", f"/api/docs/{doc}", None, T); ok("and it opens once the storage is back", s == 200)
        call("POST", f"/api/docs/{doc}/comments", {"body": "Third comment, while the storage is misbehaving", "quote": ""}, T)
        mock.corrupt = True
        call("POST", "/api/storage/move", None, T); time.sleep(3)
        ok("if the storage returns something different, nothing is removed from this server", q("SELECT length(ydoc) FROM documents WHERE id = ?", doc)[0][0] == len(state) and q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] != "remote" and len(q("SELECT 1 FROM comments WHERE doc_id = ?", doc)) == 3, q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][:])
        ok("and the person is told", "intact" in call("GET", "/api/storage", None, T)[1]["connection"]["last_error"], call("GET", "/api/storage", None, T)[1]["connection"]["last_error"])
        mock.corrupt = False
    # cannot disconnect with files only in the storage, then bring everything back
    call("POST", "/api/storage/move", None, T); wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", doc)[0][0] == "remote")
    s, e = call("DELETE", "/api/storage", None, T); ok("can't disconnect while files are only in the storage", s == 409, s, e)
    call("POST", "/api/storage/restore", None, T)
    ok("bring everything back finishes", wait(lambda: not (call("GET", "/api/storage", None, T)[1]["job"] or {}).get("running", True) and (call("GET", "/api/storage", None, T)[1]["job"] or {}).get("done", 0) >= 1))
    ok("the text, comments and picture are on this server again", q("SELECT length(ydoc) FROM documents WHERE id = ?", doc)[0][0] == len(state) and len(q("SELECT 1 FROM comments WHERE doc_id = ?", doc)) >= 2 and os.path.exists("data/uploads/" + iname) and q("SELECT remote FROM uploads WHERE name = ?", iname)[0][0] == 0)
    st = call("GET", "/api/storage", None, T)[1]
    ok("and the storage is switched off", st["connection"]["enabled"] is False and st["stats"]["docs_remote"] == 0 and st["stats"]["files_remote"] == 0, st)
    s, e = call("DELETE", "/api/storage", None, T); ok("now it can be disconnected", s == 200 and call("GET", "/api/storage", None, T)[1]["connection"] is None, s, e)
    # a wrong password is caught when connecting
    if kind == "webdav":
        bad = json.loads(json.dumps(CONFIGS[kind])); bad["config"]["password"] = "wrong"
        s, e = call("PUT", "/api/storage", bad, T); ok("a wrong password is caught when connecting", s == 422 and "password" in json.dumps(e).lower(), s, e)

# ── an error does not stop the rest, and progress is reported ──
print("===== errors and progress (webdav)")
T = signup("prog@x.io")
ids = []
for i in range(3):
    s_, d_ = call("POST", "/api/docs", {"title": f"Doc {i}", "kind": "doc"}, T); ids.append(d_["id"]); doc_text(d_["id"], f"Words in document number {i} " * 20)
    call("POST", f"/api/docs/{d_['id']}/comments", {"body": f"comment {i}", "quote": ""}, T)
bad = ids[1]
dav.fail_put.add(bad)
call("PUT", "/api/storage", {**CONFIGS["webdav"], "enabled": True, "idle_minutes": 5, "keep_search": False}, T)
call("POST", "/api/storage/move", None, T)
ok("the others are moved even though one fails", wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", ids[0])[0][0] == "remote" and q("SELECT remote_state FROM documents WHERE id = ?", ids[2])[0][0] == "remote", 40))
wait(lambda: not ((call("GET", "/api/storage", None, T)[1]["progress"] or {}).get("running", True)), 40)
st = call("GET", "/api/storage", None, T)[1]; pr = st["progress"]
ok("the one that failed stays on this server, untouched", q("SELECT remote_state FROM documents WHERE id = ?", bad)[0][0] is None and q("SELECT length(ydoc) FROM documents WHERE id = ?", bad)[0][0] > 0 and len(q("SELECT 1 FROM comments WHERE doc_id = ?", bad)) == 1)
ok("progress says how much was there and how much is done", pr and pr["docs_total"] == 3 and pr["docs_done"] == 3 and pr["bytes_total"] > 0 and pr["bytes_done"] > 0 and pr["running"] is False and pr["phase"] == "done", pr)
ok("and lists what failed, and why", len(pr["failed"]) == 1 and pr["failed"][0]["what"] == "Doc 1" and "500" in pr["failed"][0]["error"], pr["failed"])
ok("the person is told", "500" in st["connection"]["last_error"], st["connection"]["last_error"])
dav.fail_put.clear()
call("POST", "/api/storage/move", None, T)
ok("when the storage works again, trying again moves it", wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", bad)[0][0] == "remote", 30))
st = call("GET", "/api/storage", None, T)[1]
ok("and the failure list is cleared", st["progress"]["failed"] == [] and st["connection"]["last_error"] == "", st["progress"])
# bring back with one file missing: the rest still come back and the storage stays on
dav.files.pop(f"/remote.php/koko/docs/{ids[2]}.kokodocs")
call("POST", "/api/storage/restore", None, T)
wait(lambda: not (call("GET", "/api/storage", None, T)[1]["job"] or {}).get("running", True), 40)
st = call("GET", "/api/storage", None, T)[1]
ok("bringing back carries on past a missing file", q("SELECT length(ydoc) FROM documents WHERE id = ?", ids[0])[0][0] and q("SELECT length(ydoc) FROM documents WHERE id = ?", bad)[0][0], st["job"])
ok("the missing one is listed and the storage stays on so it can be retried", len(st["job"]["failed"]) == 1 and "missing" in st["job"]["failed"][0]["error"] and st["connection"]["enabled"] is True, st["job"])

# ── switching it off, and getting out of a stuck storage ──
print("===== switches and disconnecting")
s_, st = call("PATCH", "/api/storage", {"enabled": False}, T)
ok("the switch changes without re-sending the address", s_ == 200 and st["connection"]["enabled"] is False and st["connection"]["config"]["url"].endswith("/remote.php"), s_, st)
s_, st = call("PATCH", "/api/storage", {"idle_minutes": 15, "keep_search": True}, T)
ok("so do the idle time and the search setting", s_ == 200 and st["connection"]["idle_minutes"] == 15 and st["connection"]["keep_search"] is True and st["connection"]["enabled"] is False)
s_, e = call("PUT", "/api/storage", {"kind": "webdav", "config": {"password": ""}, "enabled": True, "idle_minutes": 5, "keep_search": False}, T)
ok("saving with blank fields keeps what was saved", s_ == 200 and st["connection"]["config"]["url"] and call("GET", "/api/storage", None, T)[1]["connection"]["config"]["username"] == "alice", s_, e)
call("POST", "/api/storage/move", None, T); wait(lambda: q("SELECT remote_state FROM documents WHERE id = ?", ids[0])[0][0] == "remote")
s_, e = call("DELETE", "/api/storage", None, T); ok("disconnecting normally is refused while files are only there", s_ == 409)
dav.down = True
s_, e = call("DELETE", "/api/storage?force=true", None, T)
ok("but it can be forced when the storage has gone", s_ == 200 and call("GET", "/api/storage", None, T)[1]["connection"] is None, s_, e)
s_, e = call("GET", f"/api/docs/{ids[0]}", None, T)
ok("a document that was only there says the storage must be reconnected", s_ == 503 and "no longer connected" in json.dumps(e), s_, e)
dav.down = False
call("PUT", "/api/storage", {**CONFIGS["webdav"], "enabled": True, "idle_minutes": 5, "keep_search": False}, T)
ok("and opens again once it is reconnected", call("GET", f"/api/docs/{ids[0]}", None, T)[0] == 200)
print("ALL OK" if not fails else f"{fails} FAILED")
