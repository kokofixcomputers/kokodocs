"""Meetings: rooms, guests, both providers (RealtimeKit and TURN against a mock Cloudflare), and the signalling socket.
Needs the server on :8000 with a fresh data dir, started with KOKO_CF_API=http://127.0.0.1:8767/client/v4 KOKO_TURN_API=http://127.0.0.1:8767/v1/turn/keys"""
import json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from websockets.sync.client import connect as wsconnect
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))

SEEN = []; CREATED = []
class CF(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        SEEN.append((self.command, self.path, self.headers.get('authorization'), body))
        if self.headers.get('authorization') != 'Bearer cf-token':
            code, out = 403, {'success': False, 'errors': [{'message': 'bad token'}]}
        elif self.path.endswith('/generate-ice-servers'):
            code, out = 201, {'iceServers': [{'urls': ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53']},
                                              {'urls': ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], 'username': 'u1', 'credential': 'c1'}]}
        elif self.command == 'POST' and re.fullmatch(r'/client/v4/accounts/acc/realtime/kit/app1/meetings', self.path):
            CREATED.append(body); code, out = 201, {'success': True, 'data': {'id': f'mtg-{len(CREATED)}', 'status': 'ACTIVE'}}
        elif self.command == 'POST' and re.fullmatch(r'/client/v4/accounts/acc/realtime/kit/app1/meetings/mtg-\d+/participants', self.path):
            code, out = 201, {'success': True, 'data': {'id': 'p1', 'token': 'tok-' + body['preset_name'] + '-' + body['custom_participant_id'][:2]}}
        elif self.command == 'PATCH':
            code, out = 200, {'success': True, 'data': {'status': 'INACTIVE'}}
        else:
            code, out = 404, {'success': False, 'errors': [{'message': 'nope ' + self.path}]}
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
    do_POST = do_PATCH = do_GET = _go
srv = HTTPServer(('127.0.0.1', 8767), CF); threading.Thread(target=srv.serve_forever, daemon=True).start()

_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Koko', 'password': 'password123'}); A = a['token']
_, u = call('POST', '/api/auth/signup', {'email': 'bob@x.io', 'name': 'Bob', 'password': 'password123'}); U = u['token']

# ---- rooms and guests (mesh is the default provider)
s, c = call('GET', '/api/meet/config')
ok('public config: on, guests allowed', s == 200 and c == {'enabled': True, 'guests': True}, s, c)
ok('creating needs a sign-in', call('POST', '/api/meet', {})[0] == 401)
s, m = call('POST', '/api/meet', {'title': 'Standup'}, A)
ok('a meeting is created with a hard-to-guess code', s == 200 and re.fullmatch(r'[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}', m['code']) and m['is_host'] and m['provider'] == 'mesh', s, m)
code = m['code']
s, i = call('GET', f'/api/meet/{code}')
ok('anyone with the link sees it, as a non-host', s == 200 and not i['is_host'] and i['can_join'] and i['title'] == 'Standup' and i['host_name'] == 'Koko', i)
ok('codes are case-insensitive', call('GET', f'/api/meet/{code.upper()}')[0] == 200)
ok('unknown code is a 404', call('GET', '/api/meet/abc-defg-hij')[0] == 404)
s, j = call('POST', f'/api/meet/{code}/join', {})
ok('a guest must give a name', s == 422, s, j)
s, j = call('POST', f'/api/meet/{code}/join', {'name': 'Guest Gail'})
ok('a guest gets mesh join details with STUN', s == 200 and j['provider'] == 'mesh' and j['ice_servers'][0]['urls'][0].startswith('stun:') and not j['host'] and j['name'] == 'Guest Gail', s, j)
s, j = call('POST', f'/api/meet/{code}/join', {}, A)
ok('the host joins as host, with their account name', s == 200 and j['host'] and j['name'] == 'Koko', j)
s, j = call('POST', f'/api/meet/{code}/join', {}, U)
ok('a signed-in guest is not host', s == 200 and not j['host'] and j['name'] == 'Bob', j)
s, m2 = call('POST', '/api/meet', {'title': 'Private', 'guests': False}, A)
s, i = call('GET', f"/api/meet/{m2['code']}")
ok('"signed-in only" meetings say guests cannot join', i['can_join'] is False and i['guests'] is False, i)
ok('and refuse a guest', call('POST', f"/api/meet/{m2['code']}/join", {'name': 'x'})[0] == 401)
ok('but let a signed-in person in', call('POST', f"/api/meet/{m2['code']}/join", {}, U)[0] == 200)
s, mine = call('GET', '/api/meet', None, A)
ok('the host sees their open meetings', s == 200 and {x['code'] for x in mine} == {code, m2['code']}, mine)
ok("others don't see them", call('GET', '/api/meet', None, U)[1] == [])

# ---- the signalling socket
def ws(code, tok=None, name=None):
    q = '&'.join(x for x in [f'token={tok}' if tok else '', f'name={name}' if name else ''] if x)
    return wsconnect(f'ws://127.0.0.1:8000/ws/meet/{code}' + (f'?{q}' if q else ''), open_timeout=5, legacy=True)
def rx(w, t=None, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        try: m = json.loads(w.recv(timeout=max(0.1, end - time.time())))
        except TimeoutError: break
        if t is None or m['t'] == t: return m
    return None
h = ws(code, A); wh = rx(h, 'welcome')
ok('the host is welcomed alone, as host', wh and wh['host'] and wh['peers'] == [] and wh['id'], wh)
g = ws(code, None, 'Gail'); wg = rx(g, 'welcome')
ok('a guest is welcomed and sees the host', wg and not wg['host'] and [p['name'] for p in wg['peers']] == ['Koko'], wg)
jn = rx(h, 'joined')
ok('the host is told someone joined', jn and jn['peer']['name'] == 'Gail' and jn['peer']['id'] == wg['id'], jn)
g.send(json.dumps({'t': 'signal', 'to': wh['id'], 'data': {'type': 'offer', 'sdp': 'x'}}))
sg = rx(h, 'signal')
ok('signals are relayed to the target only, with the sender', sg and sg['from'] == wg['id'] and sg['data']['type'] == 'offer', sg)
g.send(json.dumps({'t': 'signal', 'to': 'nobody', 'data': {'a': 1}})); g.send(json.dumps({'t': 'signal', 'to': wg['id'], 'data': {'a': 1}}))
ok('signals to unknown peers or yourself go nowhere', rx(g, 'signal', 0.6) is None)
g.send(json.dumps({'t': 'state', 'audio': True, 'video': False, 'screen': True}))
st = rx(h, 'state')
ok('mic/camera/screen state is shared', st and st['id'] == wg['id'] and st['audio'] and not st['video'] and st['screen'], st)
g.send(json.dumps({'t': 'chat', 'text': '  hello <b>there</b>  '}))
ch = rx(h, 'chat'); ch2 = rx(g, 'chat')
ok('chat reaches everyone including the sender, trimmed, as plain text', ch and ch['text'] == 'hello <b>there</b>' and ch['name'] == 'Gail' and ch2 and ch2['text'] == ch['text'], ch)
for _ in range(12): g.send(json.dumps({'t': 'chat', 'text': 'spam'}))
time.sleep(0.5); got = 0
while rx(h, 'chat', 0.3): got += 1
ok('chat is rate limited', got <= 8, got)
g.send(json.dumps({'t': 'mute', 'to': wh['id']})); g.send(json.dumps({'t': 'kick', 'to': wh['id']})); g.send(json.dumps({'t': 'end'}))
ok('a guest cannot mute, remove or end', rx(h, 'mute', 0.6) is None and rx(h, 'kicked', 0.2) is None)
h.send(json.dumps({'t': 'mute', 'to': wg['id']}))
ok('the host can ask someone to mute', rx(g, 'mute') is not None)
late = ws(code, U); wl = rx(late, 'welcome')
ok('late joiners get the recent chat', wl and wl['chat'] and wl['chat'][0]['text'] == 'hello <b>there</b>' and len(wl['peers']) == 2, wl)
h.send(json.dumps({'t': 'kick', 'to': wl['id']}))
ok('the host can remove someone', rx(late, 'kicked') is not None)
lf = rx(h, 'left'); ok('and everyone hears they left', lf and lf['id'] == wl['id'], lf)
bw = wsconnect('ws://127.0.0.1:8000/ws/meet/' + m2['code'] + '?name=Sneaky', open_timeout=5, legacy=True)
try: bw.recv(timeout=2); r = 'open'
except Exception as e: r = type(e).__name__ + str(getattr(getattr(e, 'rcvd', None), 'code', ''))
ok('a guest cannot open a signed-in-only meeting', '4403' in r or 'Closed' in r, r)
nw = wsconnect('ws://127.0.0.1:8000/ws/meet/' + code, open_timeout=5, legacy=True)
try: nw.recv(timeout=2); r = 'open'
except Exception as e: r = type(e).__name__ + str(getattr(getattr(e, 'rcvd', None), 'code', ''))
ok('a guest without a name is refused', 'Closed' in r, r)
crowd = [ws(code, None, f'p{i}') for i in range(6)]
for w in crowd: rx(w, 'welcome')
extra = ws(code, None, 'toomany')
fm = rx(extra, 'full')
ok('the room is capped (8) and says so', fm and fm['max'] == 8, fm)
for w in crowd + [late, extra]:
    try: w.close()
    except Exception: pass

# ---- end for everyone
ok('only the host can end it', call('POST', f'/api/meet/{code}/end', {}, U)[0] == 403)
s, _ = call('POST', f'/api/meet/{code}/end', {}, A)
em = rx(g, 'ended'); eh = rx(h, 'ended')
ok('the host ends it: everyone is told', s == 200 and em and eh, s, em, eh)
ok('an ended meeting can no longer be joined', call('POST', f'/api/meet/{code}/join', {'name': 'x'})[0] == 410)
ok('and no longer appears in the host list', code not in [x['code'] for x in call('GET', '/api/meet', None, A)[1]])

# ---- admin settings
s, ad = call('GET', '/api/admin/meet', None, A)
ok('admin sees the settings, with providers', s == 200 and ad['provider'] == 'mesh' and {p['id'] for p in ad['providers']} == {'mesh', 'realtimekit'}, ad)
ok('non-admins cannot read or change them', call('GET', '/api/admin/meet', None, U)[0] == 403 and call('PUT', '/api/admin/meet', {'enabled': False}, U)[0] == 403)
s, r = call('POST', '/api/admin/meet/test', {}, A)
ok('mesh test works with STUN only and says so', s == 200 and r['ok'] and not r['turn'], r)
base = 'http://127.0.0.1:8767'
s, ad = call('PUT', '/api/admin/meet', {'turn': {'mode': 'cloudflare', 'key_id': 'K1', 'token': 'cf-token'}}, A)
ok('the TURN token is saved but never returned', s == 200 and ad['turn']['token_set'] and 'cf-token' not in json.dumps(ad), ad)
s, r = call('POST', '/api/admin/meet/test', {}, A)
ok('Cloudflare TURN credentials are fetched', s == 200 and r['turn'], r)
call('PUT', '/api/admin/meet', {'turn': {'token': ''}}, A)
ok('an empty token keeps the stored one', call('GET', '/api/admin/meet', None, A)[1]['turn']['token_set'])
s, m3 = call('POST', '/api/meet', {}, A); s, j = call('POST', f"/api/meet/{m3['code']}/join", {'name': 'G'})
turn = [x for x in j['ice_servers'] if x.get('username')]
ok('people get the relay servers, port 53 left out, with credentials', turn and turn[0]['username'] == 'u1' and turn[0]['credential'] == 'c1' and all(':53' not in u for x in j['ice_servers'] for u in x['urls']), j)
ok('the mock saw the bearer token', any(p.endswith('/K1/credentials/generate-ice-servers') and a_ == 'Bearer cf-token' for _, p, a_, _ in SEEN))
call('PUT', '/api/admin/meet', {'turn': {'token': 'wrong'}}, A)
call('PUT', '/api/admin/meet', {'turn': {'mode': 'custom', 'urls': 'turn:relay.example.com:3478\nturns:relay.example.com:443', 'user': 'me', 'password': 'pw'}}, A)
s, j = call('POST', f"/api/meet/{m3['code']}/join", {'name': 'G'})
cu = [x for x in j['ice_servers'] if x.get('username') == 'me']
ok('a custom TURN server is passed on', cu and cu[0]['credential'] == 'pw' and len(cu[0]['urls']) == 2, j)
call('PUT', '/api/admin/meet', {'turn': {'mode': 'none'}}, A)

# ---- RealtimeKit
s, r = call('PUT', '/api/admin/meet', {'provider': 'realtimekit'}, A)
ok('choosing RealtimeKit without credentials reports what is missing', s == 200 and r['problem'] and 'account id' in r['problem'], r)
ok('and meetings cannot be started yet', call('POST', '/api/meet', {}, A)[0] == 409)
ok('the test explains too', call('POST', '/api/admin/meet/test', {}, A)[0] == 422)
call('PUT', '/api/admin/meet', {'rtk': {'account': 'acc', 'app': 'app1', 'token': 'wrong'}}, A)
s, r = call('POST', '/api/admin/meet/test', {}, A)
ok('a rejected token is explained', s == 502 and 'rejected the token' in json.dumps(r), s, r)
call('PUT', '/api/admin/meet', {'rtk': {'token': 'cf-token'}}, A)
s, r = call('POST', '/api/admin/meet/test', {}, A)
ok('a good connection creates and closes a test meeting', s == 200 and r['ok'] and any(c_ == 'PATCH' for c_, *_ in SEEN), s, r)
SEEN.clear(); CREATED.clear()
s, rk = call('POST', '/api/meet', {'title': 'Big one'}, A)
ok('a RealtimeKit meeting is created (nothing is asked of Cloudflare until someone joins)', s == 200 and rk['provider'] == 'realtimekit' and not CREATED, s, rk)
s, jh = call('POST', f"/api/meet/{rk['code']}/join", {}, A)
ok('the host gets a token for the host preset; the meeting is created once at Cloudflare', s == 200 and jh['provider'] == 'realtimekit' and jh['auth_token'].startswith('tok-group_call_host-u:') and len(CREATED) == 1 and CREATED[0]['title'] == 'Big one', s, jh, CREATED)
s, jg = call('POST', f"/api/meet/{rk['code']}/join", {'name': 'Gail'})
ok('a guest gets the participant preset, and the same meeting is reused', s == 200 and 'group_call_participant' in jg['auth_token'] and len(CREATED) == 1, jg)
parts = [b for c_, p, a_, b in SEEN if p.endswith('/participants')]
ok('Cloudflare was sent the name and a unique id per person', len(parts) == 2 and parts[1]['name'] == 'Gail' and parts[0]['custom_participant_id'] != parts[1]['custom_participant_id'], parts)
ok('the token never reaches the browser', 'cf-token' not in json.dumps([jh, jg]))
# the mesh meeting that already existed keeps working after the switch
s, j = call('POST', f"/api/meet/{m3['code']}/join", {'name': 'G'})
ok('meetings started with another provider keep that provider', s == 200 and j['provider'] == 'mesh', s, j)
s, _ = call('POST', f"/api/meet/{rk['code']}/end", {}, A)
ok('ending closes it at Cloudflare too', s == 200 and any(c_ == 'PATCH' and p.endswith(f'/meetings/mtg-1') and b.get('status') == 'INACTIVE' for c_, p, a_, b in SEEN), SEEN[-2:])

# ---- off switch
call('PUT', '/api/admin/meet', {'provider': 'mesh', 'enabled': False}, A)
ok('with meetings off nothing works', call('POST', '/api/meet', {}, A)[0] == 403 and call('GET', f"/api/meet/{m3['code']}")[0] == 403 and call('GET', '/api/meet/config')[1]['enabled'] is False)
call('PUT', '/api/admin/meet', {'enabled': True, 'guests': False}, A)
s, i = call('GET', f"/api/meet/{m3['code']}")
ok('with guests off only signed-in people can join, whatever the meeting says', i['can_join'] is False and call('POST', f"/api/meet/{m3['code']}/join", {'name': 'x'})[0] == 401)
print('ALL PASSED' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
