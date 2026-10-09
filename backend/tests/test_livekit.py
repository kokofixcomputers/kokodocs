"""LiveKit provider: admin settings, the signed join token, the connection test and closing the room (against a mock LiveKit server on :8769).
Server on :8000 with a fresh data dir, started with KOKO_NO_TEST_TURN=1."""
import json, os, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
import jwt
from websockets.sync.client import connect as wsconnect
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
SEEN = []
class LK(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        tok = (self.headers.get('authorization') or '')[7:]
        try: claims = jwt.decode(tok, 'lk-secret', algorithms=['HS256']); good = claims['iss'] == 'APIkey'
        except Exception: claims, good = {}, False
        SEEN.append((self.path, body, claims))
        code, out = (200, {'rooms': []}) if good else (401, {'code': 'unauthenticated'})
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
threading.Thread(target=HTTPServer(('127.0.0.1', 8769), LK).serve_forever, daemon=True).start()
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Koko', 'password': 'password123'})[1]['token']
ok('LiveKit is a choice', 'livekit' in [p['id'] for p in call('GET', '/api/admin/meet', None, A)[1]['providers']])
s, r = call('PUT', '/api/admin/meet', {'provider': 'livekit'}, A); ok('without settings it says what is missing', 'address' in (r['problem'] or ''), r)
ok('a bad address is refused', call('PUT', '/api/admin/meet', {'livekit': {'url': 'javascript:x'}}, A)[0] == 422)
s, r = call('PUT', '/api/admin/meet', {'livekit': {'url': 'http://127.0.0.1:8769', 'key': 'APIkey', 'secret': 'wrong'}}, A)
ok('the secret is never sent back', s == 200 and r['livekit'] == {'url': 'http://127.0.0.1:8769', 'key': 'APIkey', 'secret_set': True} and 'wrong' not in json.dumps(r), r)
ok('a wrong secret is explained', 'rejected' in str(call('POST', '/api/admin/meet/test', None, A)[1]))
call('PUT', '/api/admin/meet', {'livekit': {'secret': 'lk-secret'}}, A)
s, r = call('POST', '/api/admin/meet/test', None, A); ok('the test works', s == 200 and r['ok'], s, r)
ok('with an admin token', SEEN[-1][0].endswith('/ListRooms') and SEEN[-1][2]['video'].get('roomList') is True)
call('PUT', '/api/admin/meet', {'guests': True}, A)
code = call('POST', '/api/meet', {'title': 'LK', 'settings': {'guests': True}}, A)[1]['code']
j = call('POST', f'/api/meet/{code}/join', {}, A)[1]
w = wsconnect(f'ws://127.0.0.1:8000/ws/meet/{code}?jt={j["jt"]}', open_timeout=5, legacy=True)
end = time.time() + 4
while time.time() < end:
    try:
        if json.loads(w.recv(timeout=1))['t'] == 'welcome': break
    except Exception: pass
ok('media credentials need a ticket', call('POST', f'/api/meet/{code}/media', {'jt': 'x'})[0] == 401)
s, mc = call('POST', f'/api/meet/{code}/media', {'jt': j['jt']})
ok('credentials give the address (as ws) and a token, never the secret', s == 200 and mc['provider'] == 'livekit' and mc['url'] == 'ws://127.0.0.1:8769' and 'lk-secret' not in json.dumps(mc), mc)
c = jwt.decode(mc['token'], 'lk-secret', algorithms=['HS256'])
ok('the token is signed with the secret for this meeting', c['iss'] == 'APIkey' and c['video']['room'] == code and c['video']['roomJoin'] and c['sub'] == j['cid'] and c['name'] == 'Koko', c)
ok('it is short-lived and cannot administer rooms', c['exp'] - time.time() < 7 * 3600 and not c['video'].get('roomAdmin'))
call('POST', f'/api/meet/{code}/end', None, A)
time.sleep(0.5)
ok('ending the meeting closes the room', any(p.endswith('/DeleteRoom') and b == {'room': code} for p, b, _ in SEEN), SEEN[-2:])
print('FAILED' if bad else 'ALL OK')
