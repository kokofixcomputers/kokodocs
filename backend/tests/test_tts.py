"""Read aloud: the public config, the administrator's settings, and the Cloudflare MeloTTS voice against a mock (:8770).
Server on :8000 with a fresh data dir, started with KOKO_CF_AI_API=http://127.0.0.1:8770/client/v4 (and no CLOUDFLARE_* variables)."""
import base64, json, os, threading, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
MP3 = b'\xff\xfb\x90\x00' + b'x' * 600
SEEN = []; MODE = ['json']
class CF(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        SEEN.append((self.path, self.headers.get('authorization'), body))
        if self.headers.get('authorization') != 'Bearer cf-tok': code, out, ct = 403, b'{}', 'application/json'
        elif MODE[0] == 'json': code, out, ct = 200, json.dumps({'success': True, 'result': {'audio': base64.b64encode(MP3).decode()}}).encode(), 'application/json'
        else: code, out, ct = 200, MP3, 'audio/mpeg'
        self.send_response(code); self.send_header('content-type', ct); self.end_headers(); self.wfile.write(out)
threading.Thread(target=HTTPServer(('127.0.0.1', 8770), CF).serve_forever, daemon=True).start()
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Koko', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@x.io', 'name': 'U', 'password': 'password123'})[1]['token']
ok('by default the browser reads', call('GET', '/api/tts/config')[1]['engine'] == 'browser')
ok('the server voice refuses when it is off', call('POST', '/api/tts', {'text': 'Hello there.'}, U)[0] == 409)
ok('only admins see the settings', call('GET', '/api/admin/tts', None, U)[0] == 403 and call('PUT', '/api/admin/tts', {'engine': 'cloudflare'}, U)[0] == 403)
s, r = call('PUT', '/api/admin/tts', {'engine': 'cloudflare'}, A)
ok('switching it on without credentials says what is missing', s == 200 and 'account id' in (r['problem'] or ''), r)
ok('and the browser still reads until it is set up', call('GET', '/api/tts/config')[1]['engine'] == 'browser')
ok('bad engine names are refused', call('PUT', '/api/admin/tts', {'engine': 'robot'}, A)[0] == 422)
s, r = call('PUT', '/api/admin/tts', {'account': 'acc123', 'token': 'wrong'}, A)
ok('the token is never sent back', s == 200 and r['token_set'] and 'wrong' not in json.dumps(r), r)
ok('a wrong token is explained', 'rejected' in str(call('POST', '/api/admin/tts/test', None, A)[1]))
call('PUT', '/api/admin/tts', {'token': 'cf-tok'}, A)
s, r = call('POST', '/api/admin/tts/test', None, A); ok('the test works', s == 200 and r['ok'], s, r)
ok('and asked the right model, with the token', SEEN[-1][0] == '/client/v4/accounts/acc123/ai/run/@cf/myshell-ai/melotts' and SEEN[-1][1] == 'Bearer cf-tok' and SEEN[-1][2]['lang'] == 'en')
ok('now the server voice is offered', call('GET', '/api/tts/config')[1]['engine'] == 'cloudflare')
def raw(text, tok, lang=None):
    req = urllib.request.Request('http://127.0.0.1:8000/api/tts', data=json.dumps({'text': text, **({'lang': lang} if lang else {})}).encode(), headers={'content-type': 'application/json', **({'authorization': 'Bearer ' + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req) as x: return x.status, x.headers.get('content-type'), x.read()
    except urllib.error.HTTPError as e: return e.code, None, b''
ok('it needs a signed-in person', raw('Hello.', None)[0] in (401, 403))
n0 = len(SEEN)
s, ct, b = raw('Hello there, this is a sentence.', U); ok('speech comes back as mp3', s == 200 and ct == 'audio/mpeg' and b == MP3, s, ct)
ok('asking again is served from memory (one paid request)', raw('Hello there, this is a sentence.', U)[2] == MP3 and len(SEEN) == n0 + 1)
MODE[0] = 'raw'; ok('a raw mp3 reply works too', raw('Another sentence here.', U)[2] == MP3)
raw('Hola, ¿cómo estás?', U, 'ES'); ok('the language is passed on', SEEN[-1][2]['lang'] == 'es')
raw('Something else entirely.', U, 'xx'); ok('an unknown language falls back to English', SEEN[-1][2]['lang'] == 'en')
ok('text with nothing to say is refused', raw('...  ---', U)[0] == 422)
ok('and so is a huge request', raw('a ' * 1000, U)[0] == 422)
print('FAILED' if bad else 'ALL OK')
