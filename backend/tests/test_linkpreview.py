"""Link previews: reads OpenGraph data, refuses private addresses, needs a login, caches.
Run twice: plainly (private addresses refused), then with KOKO_IMPORT_ALLOW_PRIVATE=1 on both the server and this script (reading a local test page)."""
import http.server, json, os, threading, urllib.request, urllib.error, urllib.parse
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
hits = {"n": 0}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        hits["n"] += 1
        if self.path == "/img": self.send_response(200); self.send_header("content-type", "image/png"); self.end_headers(); self.wfile.write(b"x"); return
        if self.path == "/redir": self.send_response(302); self.send_header("location", "/page"); self.end_headers(); return
        self.send_response(200); self.send_header("content-type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(b'<html><head><title>Plain title</title><meta property="og:title" content="A &amp; B"><meta property="og:description" content="Hello world"><meta property="og:image" content="/pic.png"><meta property="og:site_name" content="Example"><link rel="icon" href="/f.ico"></head><body>hi</body></html>')
srv = http.server.HTTPServer(("127.0.0.1", 9911), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
u = call("POST", "/api/auth/signup", {"email": "a@x.io", "name": "A", "password": "password123"})[1]["token"]
q = lambda url: "/api/link-preview?url=" + urllib.parse.quote(url, safe="")
check("needs a login", call("GET", q("http://127.0.0.1:9911/page"))[0] in (401, 403))
if os.environ.get("KOKO_IMPORT_ALLOW_PRIVATE") != "1":
    check("refuses a private address", call("GET", q("http://127.0.0.1:9911/page"), tok=u)[0] == 422)
check("refuses non-web schemes", call("GET", q("file:///etc/passwd"), tok=u)[0] == 422)
if os.environ.get("KOKO_IMPORT_ALLOW_PRIVATE") == "1":
    s, r = call("GET", q("http://127.0.0.1:9911/page"), tok=u)
    check("reads the card", s == 200 and r["title"] == "A & B" and r["description"] == "Hello world" and r["site"] == "Example", r)
    check("makes picture and icon absolute", r["image"] == "http://127.0.0.1:9911/pic.png" and r["favicon"] == "http://127.0.0.1:9911/f.ico", r)
    n = hits["n"]; call("GET", q("http://127.0.0.1:9911/page"), tok=u)
    check("repeat asks are cached", hits["n"] == n)
    s, r = call("GET", q("http://127.0.0.1:9911/redir"), tok=u)
    check("follows a redirect", s == 200 and r["title"] == "A & B", (s, r))
    check("a non-page is refused", call("GET", q("http://127.0.0.1:9911/img"), tok=u)[0] == 422)
print("ALL OK" if not fails else f"{fails} FAILED")
