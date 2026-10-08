"""Scan a page, AI provider path. Needs the server on :8000 started with KOKO_AI_ALLOW_PRIVATE=1 (fresh data dir)."""
import json, os, sys, threading, urllib.request, urllib.error, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
SEEN = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers['content-length']))); SEEN.append((self.path, self.headers.get('authorization'), b))
        parts = b['messages'][0]['content']
        has = isinstance(parts, list) and any(p.get('type') == 'image_url' and p['image_url']['url'].startswith('data:image/png;base64,') for p in parts)
        content = '```\nHello from the page\n```' if has else 'no image'
        if 'empty' in b['model']: content = 'NO_TEXT'
        code, out = (400, {'error': {'message': 'model does not support images'}}) if 'blind' in b['model'] else (200, {'choices': [{'message': {'content': content}}]})
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
srv = HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_port}/v1'
def mp(path, tok, data, fields=None, name='p.png'):
    b = uuid.uuid4().hex
    body = b''.join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in (fields or {}).items())
    body += (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + path, body, {'content-type': f'multipart/form-data; boundary={b}', **({'authorization': 'Bearer ' + tok} if tok else {})}, method='POST')
    try:
        x = urllib.request.urlopen(r); return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'K', 'password': 'password123'}); A = a['token']
_, u = call('POST', '/api/auth/signup', {'email': 'ocr@x.io', 'name': 'O', 'password': 'password123'}); U = u['token']
png_ = png()
ok('needs a sign-in', mp('/api/ocr', None, png_)[0] == 401)
s, r = mp('/api/ocr', U, png_)
ok('no model set up: says so', s == 409, s, r)
s, m = call('POST', '/api/admin/ai/models', {'label': 'Vision', 'base_url': base, 'model': 'vision-1', 'api_key': 'sk-x'}, A)
mid = m['models'][0]['id']
s, r = mp('/api/ocr', U, png_)
ok('the picture is read and the code fence removed', s == 200 and r['text'] == 'Hello from the page', s, r)
path, auth, body = SEEN[-1]
ok('sent as a picture to /chat/completions with the key', path == '/v1/chat/completions' and auth == 'Bearer sk-x' and body['stream'] is False and body['temperature'] == 0)
ok('a non-picture is refused', mp('/api/ocr', U, b'not a picture at all')[0] == 415)
ok('a huge file is refused', mp('/api/ocr', U, png_ + b'x' * (9 * 1024 * 1024))[0] == 413)
call('POST', '/api/admin/ai/models', {'label': 'Empty', 'base_url': base, 'model': 'empty-1', 'api_key': 'k'}, A)
call('POST', '/api/admin/ai/models', {'label': 'Blind', 'base_url': base, 'model': 'blind-1', 'api_key': 'k'}, A)
_, lst = call('GET', '/api/ai/settings', None, U)
by = {x['model']: x['id'] for x in lst['models']}
s, r = mp('/api/ocr', U, png_, {'model_id': by['empty-1']})
ok('a page with no text gives an empty answer, not an error', s == 200 and r['text'] == '', s, r)
s, r = mp('/api/ocr', U, png_, {'model_id': by['blind-1']})
ok('a model that cannot see pictures is explained', s == 502 and 'vision model' in json.dumps(r), s, r)
call('POST', '/api/admin/ai/models', {'label': 'CF', 'base_url': 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai', 'model': '@cf/x', 'api_key': 'k'}, A)
_, lst = call('GET', '/api/ai/settings', None, U)
cf = [x['id'] for x in lst['models'] if x['model'] == '@cf/x'][0]
s, r = mp('/api/ocr', U, png_, {'model_id': cf})
ok('a Cloudflare chat connection is refused for pictures', s == 422, s, r)
print('FAILED' if bad else 'ALL PASSED'); sys.exit(1 if bad else 0)
