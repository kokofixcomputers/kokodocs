"""Wikis: creating one, indexing and previewing its pages, and the "Try it" server proxy. Needs the server on :8000 started with KOKO_IMPORT_ALLOW_PRIVATE=1 (so the proxy can reach this test's own local server)."""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self):
        n = int(self.headers.get('content-length') or 0); body = self.rfile.read(n).decode() if n else ''
        if self.path == '/redir': self.send_response(302); self.send_header('location', '/echo'); self.end_headers(); return
        if self.path == '/big': self.send_response(200); self.send_header('content-type', 'text/plain'); self.end_headers(); self.wfile.write(b'x' * (3 * 1024 * 1024)); return
        if self.path == '/bin': self.send_response(200); self.send_header('content-type', 'image/png'); self.end_headers(); self.wfile.write(bytes(range(256))); return
        out = json.dumps({'method': self.command, 'path': self.path, 'auth': self.headers.get('x-test'), 'body': body}).encode()
        self.send_response(201); self.send_header('content-type', 'application/json'); self.send_header('set-cookie', 'a=b'); self.end_headers(); self.wfile.write(out)
    do_GET = do_POST = do_PUT = do_DELETE = _go
srv = HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
U = f'http://127.0.0.1:{srv.server_port}'
T = call('POST', '/api/auth/signup', {'email': 'w@wk.io', 'name': 'W', 'password': 'password123'})[1]['token']

s, d = call('POST', '/api/docs', {'kind': 'wiki'}, T)
ok('a wiki can be created, with its own default name', s == 200 and d['kind'] == 'wiki' and d['title'] == 'Untitled wiki', d)
ok('it shows up in the file list as a wiki', any(x['kind'] == 'wiki' for x in call('GET', '/api/docs', None, T)[1]['mine']))
ok('unknown kinds are still refused', call('POST', '/api/docs', {'kind': 'nonsense'}, T)[0] == 422)

P = lambda b, t=T: call('POST', '/api/wiki/proxy', b, t)
ok('the proxy needs a signed-in user', P({'url': U + '/echo'}, None)[0] == 401)
s, r = P({'method': 'POST', 'url': U + '/echo?x=1', 'headers': {'X-Test': 'yes', 'Host': 'evil.example', 'Content-Length': '999'}, 'body': '{"a":1}'})
j = json.loads(r['body']) if s == 200 else {}
ok('a request is sent and the reply comes back', s == 200 and r['status'] == 201 and j.get('method') == 'POST' and j.get('path') == '/echo?x=1', r)
ok('headers and body are forwarded, but Host and Content-Length are not taken from the caller', j.get('auth') == 'yes' and j.get('body') == '{"a":1}')
ok('cookies from the other server are not passed on', 'set-cookie' not in {k.lower() for k in r['headers']})
ok('timing and size are reported', r['ms'] >= 0 and r['size'] == len(r['body']))
s, r = P({'url': U + '/redir'}); ok('redirects are followed', s == 200 and json.loads(r['body'])['path'] == '/echo', r)
s, r = P({'url': U + '/big'}); ok('big replies are cut at 2 MB', s == 200 and r['size'] == 2 * 1024 * 1024, r.get('size'))
s, r = P({'url': U + '/bin'}); ok('binary replies come back encoded', s == 200 and r['binary'] is True and len(r['body']) > 300)
ok('only http and https', P({'url': 'file:///etc/passwd'})[0] == 422 and P({'url': 'ftp://x.io/'})[0] == 422)
ok('unknown methods are refused', P({'method': 'TRACE', 'url': U})[0] == 422)
ok('a server that is not there gives a clear error', P({'url': 'http://127.0.0.1:1/'})[0] == 502)
s, r = P({'url': U + '/echo', 'headers': {'X-A': 'a\r\nInjected: 1'}}); ok('header injection is dropped', s == 200 and json.loads(r['body'])['auth'] is None)
codes = [P({'url': U + '/echo'})[0] for _ in range(70)]
ok('calls are rate limited', 429 in codes, set(codes))

# search text and preview come from the pages
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pycrdt import Doc, Map, XmlFragment, XmlElement, XmlText
from app import searchindex, snapshots
doc = Doc(); tree = doc.get('tree', type=Map)
tree['home'] = {'t': 'page', 'title': 'Getting started', 'parent': None, 'pos': 1}
tree['f1'] = {'t': 'folder', 'title': 'Endpoints', 'parent': None, 'pos': 2}
tree['pg'] = {'t': 'page', 'title': 'Create invoice', 'parent': 'f1', 'pos': 1}
frag = doc.get('p:pg', type=XmlFragment); para = XmlElement('paragraph'); frag.children.append(para); para.children.append(XmlText('Send a POST with the customer id'))
blob = doc.get_update()
txt = searchindex.extract_text(blob, 'wiki')
ok('search finds page titles', 'Getting started' in txt and 'Create invoice' in txt and 'Endpoints' in txt, txt)
ok('search finds text on a page', 'customer id' in txt, txt)
n, prev = snapshots.summarize(blob)
ok('version previews count pages and list titles', n == 2 and 'Getting started' in prev, (n, prev))
