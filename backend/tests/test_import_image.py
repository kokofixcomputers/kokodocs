"""Fetching pictures that arrive as links when pasting from Google Docs or the web. Needs the server on :8000 started with KOKO_IMPORT_ALLOW_PRIVATE=1 (so it can reach this test's own local server)."""
import asyncio, base64, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        p = self.path
        if p == '/a.png': self.send_response(200); self.send_header('content-type', 'image/png'); self.end_headers(); self.wfile.write(PNG)
        elif p == '/noext': self.send_response(200); self.end_headers(); self.wfile.write(PNG)          # no content type: judged by the bytes
        elif p == '/r1': self.send_response(302); self.send_header('location', '/r2'); self.end_headers()
        elif p == '/r2': self.send_response(302); self.send_header('location', '/a.png'); self.end_headers()
        elif p == '/loop': self.send_response(302); self.send_header('location', '/loop'); self.end_headers()
        elif p == '/page.html': self.send_response(200); self.send_header('content-type', 'image/png'); self.end_headers(); self.wfile.write(b'<html>not a picture</html>')   # lies about its type
        elif p == '/big': self.send_response(200); self.end_headers(); self.wfile.write(b'\x89PNG\r\n\x1a\n' + b'0' * (13 * 1024 * 1024))
        else: self.send_response(404); self.end_headers()
srv = HTTPServer(('127.0.0.1', 8765), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:8765'
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
TO, TV = signup('o@im.io', 'O'), signup('v@im.io', 'V')
did = call('POST', '/api/docs', {'kind': 'doc'}, TO)[1]['id']
call('PUT', f'/api/docs/{did}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'v@im.io', 'role': 'viewer'}]}, TO)
imp = lambda url, tok=TO, doc=None: call('POST', f'/api/docs/{doc or did}/images/import', {'url': url}, tok)

s, r = imp(U + '/a.png'); ok('a picture link is fetched and stored', s == 200 and r['url'].startswith('/api/images/') and r['url'].endswith('.png'), (s, r))
ok('the stored copy is served back', urllib_ok := (__import__('urllib.request').request.urlopen(B + r['url']).read() == PNG))
ok('it counts toward the owner\'s storage', call('GET', '/api/me/storage', None, TO)[1]['images'] >= len(PNG))
ok('the file type comes from the bytes, not the server\'s say-so', imp(U + '/noext')[0] == 200)
ok('redirects are followed', imp(U + '/r1')[0] == 200)
ok('redirect loops stop', imp(U + '/loop')[0] == 422)
ok('a page pretending to be a picture is refused', imp(U + '/page.html')[0] == 415)
ok('a missing picture gives a clear error', imp(U + '/nope.png')[0] == 422)
ok('over 12 MB is refused', imp(U + '/big')[0] == 413)
ok('only web addresses', imp('file:///etc/passwd')[0] == 422 and imp('ftp://x/y.png')[0] == 422 and imp('javascript:alert(1)')[0] == 422 and imp('http://user:pw@127.0.0.1:8765/a.png')[0] == 422)
ok('viewers cannot add pictures', imp(U + '/a.png', TV)[0] == 403)
ok('signed-out people cannot', imp(U + '/a.png', None)[0] in (401, 403))

# without the test switch, nothing internal can be reached (this is the real behaviour)
os.environ.pop('KOKO_IMPORT_ALLOW_PRIVATE', None)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from fastapi import HTTPException
from app.routes import assert_public
def blocked(url):
    try: asyncio.run(assert_public(url)); return False
    except HTTPException: return True
ok('loopback, private, link-local, cloud-metadata and reserved addresses are refused', all(blocked(u) for u in ['http://127.0.0.1/a.png', 'http://localhost/a.png', 'http://10.0.0.5/a.png', 'http://192.168.1.1/a.png', 'http://172.16.0.1/a.png', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.png', 'http://0.0.0.0/a.png', 'http://100.64.0.1/a.png']))
ok('a public address passes the check', not blocked('https://8.8.8.8/a.png'))
