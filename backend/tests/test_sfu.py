"""Cloudflare SFU provider: admin settings, the session proxy (the app secret stays here, people can only use their own session and pull from their own
meeting). Server on :8000 with a fresh data dir, started with KOKO_NO_TEST_TURN=1 KOKO_SFU_API=http://127.0.0.1:8768/v1."""
import json, os, re, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from websockets.sync.client import connect as wsconnect
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
SEEN = []; N = [0]
class CF(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        SEEN.append((self.command, self.path, self.headers.get('authorization'), body))
        if self.headers.get('authorization') != 'Bearer s3cret': code, out = 401, {'errorCode': 'unauthorized'}
        elif self.command == 'POST' and self.path == '/v1/apps/app1/sessions/new': N[0] += 1; code, out = 200, {'sessionId': f'sess-{N[0]}'}
        elif self.command == 'POST' and re.fullmatch(r'/v1/apps/app1/sessions/sess-\d+/tracks/new', self.path): code, out = 200, {'sessionDescription': {'type': 'answer', 'sdp': 'x'}, 'tracks': [{'mid': '0', 'trackName': 'mic'}]}
        elif self.command == 'PUT' and self.path.endswith('/renegotiate'): code, out = 200, {}
        elif self.path.startswith('/api/sfu/mapp'):
            if self.command == 'POST' and self.path == '/api/sfu/mapp/session/new': N[0] += 1; code, out = 200, {'sessionId': f'msess-{N[0]}', 'sessionDescription': {'type': 'answer', 'sdp': 'x'}}
            elif self.command == 'POST' and re.fullmatch(r'/api/sfu/mapp/session/msess-\d+/track/(publish|subscribe)', self.path): code, out = 200, {'sessionDescription': {'type': 'answer', 'sdp': 'x'}, 'immediateRenegotiationRequired': True}
            elif self.command == 'PUT' and self.path.endswith('/renegotiate'): code, out = 200, {}
            elif self.command == 'GET' and self.path == '/api/sfu/mapp/sessions': code, out = 200, []
            elif self.command == 'GET' and re.fullmatch(r'/api/sfu/mapp/session/msess-\d+/tracks', self.path): code, out = 200, [{'trackId': 'tid-1', 'customTrackName': 'mic', 'mid': '1', 'trackKind': 'audio'}]
            else: code, out = 404, {}
        else: code, out = 404, {'errorCode': 'nope'}
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
    do_POST = do_PUT = do_GET = _go
threading.Thread(target=HTTPServer(('127.0.0.1', 8768), CF).serve_forever, daemon=True).start()
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Koko', 'password': 'password123'})[1]['token']
ok('the SFU is one of the choices', 'sfu' in [p['id'] for p in call('GET', '/api/admin/meet', None, A)[1]['providers']])
s, r = call('PUT', '/api/admin/meet', {'provider': 'sfu'}, A)
ok('without credentials it says what is missing', s == 200 and 'app id' in (r['problem'] or ''), r)
ok('and the test is refused', call('POST', '/api/admin/meet/test', None, A)[0] == 422)
s, r = call('PUT', '/api/admin/meet', {'sfu': {'app': 'app1', 'secret': 'wrong'}}, A)
ok('the secret is never sent back', s == 200 and r['sfu'] == {'app': 'app1', 'secret_set': True} and 'wrong' not in json.dumps(r))
ok('a wrong secret is explained', 'rejected' in str(call('POST', '/api/admin/meet/test', None, A)[1]))
call('PUT', '/api/admin/meet', {'sfu': {'app': 'app1', 'secret': 's3cret'}}, A)
s, r = call('POST', '/api/admin/meet/test', None, A); ok('the test creates a session', s == 200 and r['ok'], s, r)
ok('with the secret as a bearer token', SEEN[-1][2] == 'Bearer s3cret')
call('PUT', '/api/admin/meet', {'guests': True}, A)
def mk(): return call('POST', '/api/meet', {'title': 'SFU', 'settings': {'guests': True}}, A)[1]['code']
def ws(code, jt): return wsconnect(f'ws://127.0.0.1:8000/ws/meet/{code}?jt={jt}', open_timeout=5, legacy=True)
def welcome(w):
    end = time.time() + 4
    while time.time() < end:
        try: m = json.loads(w.recv(timeout=1))
        except Exception: continue
        if m['t'] == 'welcome': return m
code = mk(); code2 = mk()
j1 = call('POST', f'/api/meet/{code}/join', {}, A)[1]; w1 = ws(code, j1['jt']); welcome(w1)
j2 = call('POST', f'/api/meet/{code}/join', {'name': 'Guest'})[1]; w2 = ws(code, j2['jt']); welcome(w2)
j3 = call('POST', f'/api/meet/{code2}/join', {}, A)[1]; w3 = ws(code2, j3['jt']); welcome(w3)
s, mc = call('POST', f'/api/meet/{code}/media', {'jt': j1['jt']})
ok('media credentials say sfu, with a STUN server, no secret', s == 200 and mc['provider'] == 'sfu' and any('stun.cloudflare.com' in str(x['urls']) for x in mc['ice_servers']) and 's3cret' not in json.dumps(mc), mc)
ok('a session needs a ticket', call('POST', f'/api/meet/{code}/sfu/session', {'jt': 'bad'})[0] == 401)
s, a = call('POST', f'/api/meet/{code}/sfu/session', {'jt': j1['jt']}); ok('a person gets a session', s == 200 and a['sessionId'].startswith('sess-'), s, a)
s, b = call('POST', f'/api/meet/{code}/sfu/session', {'jt': j2['jt']}); ok('and so does the second', s == 200 and b['sessionId'] != a['sessionId'])
s, c = call('POST', f'/api/meet/{code2}/sfu/session', {'jt': j3['jt']})
off = {'tracks': [{'location': 'local', 'mid': '0', 'trackName': 'mic'}], 'sessionDescription': {'type': 'offer', 'sdp': 'v=0'}}
s, r = call('POST', f"/api/meet/{code}/sfu/{a['sessionId']}/tracks", {'jt': j1['jt'], 'body': off}); ok('sending tracks is forwarded', s == 200 and r['sessionDescription']['type'] == 'answer', s, r)
ok('exactly as asked', SEEN[-1][3] == off and SEEN[-1][1].endswith(f"{a['sessionId']}/tracks/new"))
ok("nobody can use someone else's session", call('POST', f"/api/meet/{code}/sfu/{a['sessionId']}/tracks", {'jt': j2['jt'], 'body': off})[0] == 403)
pull = {'tracks': [{'location': 'remote', 'sessionId': a['sessionId'], 'trackName': 'mic'}]}
ok('pulling a person in the same meeting works', call('POST', f"/api/meet/{code}/sfu/{b['sessionId']}/tracks", {'jt': j2['jt'], 'body': pull})[0] == 200)
pull2 = {'tracks': [{'location': 'remote', 'sessionId': c['sessionId'], 'trackName': 'mic'}]}
ok('pulling from another meeting is refused', call('POST', f"/api/meet/{code}/sfu/{b['sessionId']}/tracks", {'jt': j2['jt'], 'body': pull2})[0] == 403)
ok('pulling an unknown session is refused', call('POST', f"/api/meet/{code}/sfu/{b['sessionId']}/tracks", {'jt': j2['jt'], 'body': {'tracks': [{'location': 'remote', 'sessionId': 'guess', 'trackName': 'x'}]}})[0] == 403)
ok('renegotiating your own session works', call('PUT', f"/api/meet/{code}/sfu/{b['sessionId']}/renegotiate", {'jt': j2['jt'], 'body': {'sessionDescription': {'type': 'answer', 'sdp': 'v=0'}}})[0] == 200)
ok("not someone else's", call('PUT', f"/api/meet/{code}/sfu/{a['sessionId']}/renegotiate", {'jt': j2['jt'], 'body': {}})[0] == 403)
call('PUT', '/api/admin/meet', {'provider': 'mesh'}, A)
code3 = mk(); j4 = call('POST', f'/api/meet/{code3}/join', {}, A)[1]; w4 = ws(code3, j4['jt']); welcome(w4)
ok('a meeting that does not use the SFU refuses its sessions', call('POST', f'/api/meet/{code3}/sfu/session', {'jt': j4['jt']})[0] == 409)
# ---- Metered
call('PUT', '/api/admin/meet', {'provider': 'metered', 'metered': {'app': 'mapp', 'secret': 's3cret'}}, A)
ok('Metered is a choice and works', 'metered' in [p['id'] for p in call('GET', '/api/admin/meet', None, A)[1]['providers']] and call('POST', '/api/admin/meet/test', None, A)[1]['ok'])
ok('its secret is not sent back', call('GET', '/api/admin/meet', None, A)[1]['metered'] == {'app': 'mapp', 'secret_set': True})
cm = mk(); jm = call('POST', f'/api/meet/{cm}/join', {}, A)[1]; wm = ws(cm, jm['jt']); welcome(wm)
jm2 = call('POST', f'/api/meet/{cm}/join', {'name': 'G'})[1]; wm2 = ws(cm, jm2['jt']); welcome(wm2)
s, mc = call('POST', f'/api/meet/{cm}/media', {'jt': jm['jt']}); ok('media credentials say metered with its STUN', s == 200 and mc['provider'] == 'metered' and any('stun.metered.ca' in str(x['urls']) for x in mc['ice_servers']), mc)
s, a = call('POST', f'/api/meet/{cm}/sfu/session', {'jt': jm['jt'], 'body': {'sessionDescription': {'type': 'offer', 'sdp': 'v=0'}}}); ok('a session starts with an offer', s == 200 and a['sessionId'].startswith('msess-') and a['sessionDescription']['type'] == 'answer', s, a)
ok('and is refused without one', call('POST', f'/api/meet/{cm}/sfu/session', {'jt': jm2['jt'], 'body': {}})[0] == 422)
s, b = call('POST', f'/api/meet/{cm}/sfu/session', {'jt': jm2['jt'], 'body': {'sessionDescription': {'type': 'offer', 'sdp': 'v=0'}}})
pub = {'op': 'publish', 'sessionDescription': {'type': 'offer', 'sdp': 'v=0'}, 'tracks': [{'trackId': 't1', 'mid': '0'}]}
s, r = call('POST', f"/api/meet/{cm}/sfu/{a['sessionId']}/tracks", {'jt': jm['jt'], 'body': pub}); ok('publishing goes to track/publish without the op field', s == 200 and SEEN[-1][1].endswith('/track/publish') and 'op' not in SEEN[-1][3] and SEEN[-1][3]['tracks'][0]['trackId'] == 't1', s, r)
sub = {'op': 'subscribe', 'tracks': [{'remoteSessionId': a['sessionId'], 'remoteTrackId': 't1'}]}
ok('subscribing to someone in the meeting works', call('POST', f"/api/meet/{cm}/sfu/{b['sessionId']}/tracks", {'jt': jm2['jt'], 'body': sub})[0] == 200 and SEEN[-1][1].endswith('/track/subscribe'))
ok('but not to a stranger', call('POST', f"/api/meet/{cm}/sfu/{b['sessionId']}/tracks", {'jt': jm2['jt'], 'body': {'op': 'subscribe', 'tracks': [{'remoteSessionId': 'guess', 'remoteTrackId': 't'}]}})[0] == 403)
ok("or with someone else's session", call('POST', f"/api/meet/{cm}/sfu/{a['sessionId']}/tracks", {'jt': jm2['jt'], 'body': sub})[0] == 403)
s, r = call('POST', f"/api/meet/{cm}/sfu/{b['sessionId']}/tracks", {'jt': jm2['jt'], 'body': {'op': 'list', 'sessionId': a['sessionId']}})
ok("listing someone's tracks works (an array comes back as items)", s == 200 and r['items'][0]['trackId'] == 'tid-1' and SEEN[-1][0] == 'GET', s, r)
ok("but not a stranger's", call('POST', f"/api/meet/{cm}/sfu/{b['sessionId']}/tracks", {'jt': jm2['jt'], 'body': {'op': 'list', 'sessionId': 'guess'}})[0] == 403)
ok('an unknown operation is refused', call('POST', f"/api/meet/{cm}/sfu/{a['sessionId']}/tracks", {'jt': jm['jt'], 'body': {'op': 'delete'}})[0] == 422)
ok('renegotiating works', call('PUT', f"/api/meet/{cm}/sfu/{b['sessionId']}/renegotiate", {'jt': jm2['jt'], 'body': {'sessionDescription': {'type': 'answer', 'sdp': 'v=0'}}})[0] == 200 and SEEN[-1][1].endswith('/session/' + b['sessionId'] + '/renegotiate'))
call('PUT', '/api/admin/meet', {'provider': 'mesh'}, A)
print('FAILED' if bad else 'ALL OK')
