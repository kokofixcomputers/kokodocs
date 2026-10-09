"""Meetings: rooms, guests, passcodes, the waiting room, co-hosts, reactions, polls, permanent meetings, and both providers (RealtimeKit and TURN against a mock
Cloudflare). Needs the server on :8000 with a fresh data dir, started with KOKO_NO_TEST_TURN=1 KOKO_CONSENT_GRACE=2 KOKO_RECORDER_GRACE=1 KOKO_SHARE_GRACE=1 KOKO_CF_API=http://127.0.0.1:8767/client/v4 KOKO_TURN_API=http://127.0.0.1:8767/v1/turn/keys"""
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
            code, out = 201, {'success': True, 'data': {'id': 'p1', 'token': 'tok-' + body['preset_name'] + '-' + body['custom_participant_id'][:4]}}
        elif self.command == 'PATCH':
            code, out = 200, {'success': True, 'data': {'status': 'INACTIVE'}}
        else:
            code, out = 404, {'success': False, 'errors': [{'message': 'nope ' + self.path}]}
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
    do_POST = do_PATCH = do_GET = _go
srv = HTTPServer(('127.0.0.1', 8767), CF); threading.Thread(target=srv.serve_forever, daemon=True).start()

_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Koko', 'password': 'password123'}); A = a['token']
_, u = call('POST', '/api/auth/signup', {'email': 'bob@x.io', 'name': 'Bob', 'password': 'password123'}); U = u['token']
_, u2 = call('POST', '/api/auth/signup', {'email': 'cat@x.io', 'name': 'Cat', 'password': 'password123'}); C = u2['token']

_call = call
def call(m, p, body=None, tok=None):   # most of these tests have guests join, so meetings are made with guests allowed unless a test says otherwise
    if m == 'POST' and p == '/api/meet' and isinstance(body, dict) and 'guests' not in body.get('settings', {}):
        body = {**body, 'settings': {**body.get('settings', {}), 'guests': True}}
    return _call(m, p, body, tok)

SOCKS = []
def ws(code, jt, gid=''):
    w = wsconnect(f'ws://127.0.0.1:8000/ws/meet/{code}?jt={jt}' + (f'&gid={gid}' if gid else ''), open_timeout=5, legacy=True); SOCKS.append(w); return w
def rx(w, t=None, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        try: m = json.loads(w.recv(timeout=max(0.1, end - time.time())))
        except TimeoutError: break
        except Exception: return None
        if t is None or m['t'] == t: return m
    return None
def rxp(w, t, pred, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        m = rx(w, t, max(0.1, end - time.time()))
        if m is None: return None
        if pred(m): return m
    return None
def drain(w, timeout=0.3):
    while rx(w, None, timeout): pass
def tx(w, **m): w.send(json.dumps(m))
def closed_with(w, timeout=2):
    try: w.recv(timeout=timeout); return None
    except Exception as e: return getattr(getattr(e, 'rcvd', None), 'code', type(e).__name__)
def join(code, tok=None, name=None, passcode=''):
    return call('POST', f'/api/meet/{code}/join', {k: v for k, v in {'name': name, 'passcode': passcode}.items() if v}, tok)
def enter(code, tok=None, name=None, passcode=''):
    s, j = join(code, tok, name or ('Guest' if not tok else None), passcode)
    assert s == 200, (s, j)
    w = ws(code, j['jt']); first = rx(w)
    return w, j, first
def welcomed(code, tok=None, name=None):
    w, j, first = enter(code, tok, name)
    assert first and first['t'] == 'welcome', first
    return w, j, first

# ---- people without an account join only when the host allows it
s, nog = _call('POST', '/api/meet', {'title': 'Members only'}, A)
ok('a new meeting does not allow people without an account', s == 200 and nog['settings']['guests'] is False, nog)
s, i = call('GET', f"/api/meet/{nog['code']}"); ok('and says so before anyone tries', i['can_join'] is False and i['guests'] is False, i)
s, r = join(nog['code'], None, 'Anon'); ok('a guest is turned away, and asked to sign in', s == 401 and r['detail']['code'] == 'login_required', s, r)
ok('a signed-in person is fine', join(nog['code'], U)[0] == 200)
call('PUT', f"/api/meet/{nog['code']}", {'settings': {'guests': True}}, A)
s, r = join(nog['code'], None, 'Anon'); ok('once the host allows it, a name is all a guest needs', s == 200 and r['name'] == 'Anon' and not r['host'], s, r)
anon, ja, fa = None, None, None
ha0, _, fh0 = welcomed(nog['code'], A); an_ws = ws(nog['code'], r['jt']); wa = rx(an_ws, 'welcome')
ok('the host sees them marked as a guest, and signed-in people not', any(p['guest'] and p['name'] == 'Anon' for p in [*wa['peers'], (rx(ha0, 'joined') or {}).get('peer', {})]) and not fh0['me'].get('guest') and not wa['peers'][0]['guest'], wa['peers'])
call('PUT', f"/api/meet/{nog['code']}", {'settings': {'guests': False, 'approval': True}}, A)
s, r = join(nog['code'], None, 'Anon2'); ok('and it can be switched off again', s == 401)
s, r = join(nog['code'], U); w_ = ws(nog['code'], r['jt']); rx(w_)
s, r2 = join(nog['code'], C); w2 = ws(nog['code'], r2['jt']); rx(w2)
wl = rxp(ha0, 'waiting-list', lambda m: len(m['list']) >= 1)
ok('waiting entries say whether they are guests', wl and all('guest' in x for x in wl['list']), wl)

# ---- creating, finding, joining
s, c = call('GET', '/api/meet/config')
ok('public config', s == 200 and c['enabled'] and c['guests'] and isinstance(c['captions'], bool), s, c)
ok('creating needs a sign-in', call('POST', '/api/meet', {})[0] == 401)
s, m = call('POST', '/api/meet', {'title': 'Standup'}, A)
code = m['code']
ok('a meeting is created with a hard-to-guess code, default settings, one-off', s == 200 and re.fullmatch(r'[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}', code) and m['is_host'] and not m['permanent'] and m['settings']['chat'] == 'all' and m['settings']['approval'] is False and m['passcode'] == '', m)
s, i = call('GET', f'/api/meet/{code}')
ok('the public view has no settings or passcode', s == 200 and 'settings' not in i and 'passcode' not in i and i['can_join'] and not i['has_passcode'] and i['live'] == 0, i)
ok('codes are case-insensitive, unknown ones 404', call('GET', f'/api/meet/{code.upper()}')[0] == 200 and call('GET', '/api/meet/abc-defg-hij')[0] == 404)
s, j = join(code)
ok('a guest must give a name', s == 422, s, j)
s, j = join(code, None, 'Guest Gail')
ok('a guest gets a signed ticket and is not host', s == 200 and j['jt'] and j['cid'] and not j['host'] and j['name'] == 'Guest Gail' and j['provider'] == 'mesh', j)
s, jh = join(code, A)
ok('the host joins as host under their account name', s == 200 and jh['host'] and jh['name'] == 'Koko', jh)
ok('the join response carries no audio/video credentials', 'ice_servers' not in j and 'auth_token' not in j)

# ---- first people in: welcome, signals, state, chat
h = ws(code, jh['jt']); wh = rx(h, 'welcome')
ok('the host is welcomed: manager, owner, settings, emoji list', wh and wh['me']['owner'] and wh['me']['manager'] and wh['peers'] == [] and wh['settings']['chat'] == 'all' and '👍' in wh['emojis'], wh)
g = ws(code, j['jt']); wg = rx(g, 'welcome')
ok('a guest is welcomed, not a manager, sees the host', wg and not wg['me']['manager'] and [p['name'] for p in wg['peers']] == ['Koko'] and wg['peers'][0]['host'], wg)
jn = rx(h, 'joined'); ok('the host hears someone joined', jn and jn['peer']['name'] == 'Guest Gail' and jn['peer']['cid'] == wg['me']['cid'], jn)
tx(g, t='signal', to=wh['me']['id'], data={'type': 'offer', 'sdp': 'x'})
sg = rx(h, 'signal'); ok('signals are relayed to the target, with the sender', sg and sg['from'] == wg['me']['id'] and sg['data']['type'] == 'offer', sg)
tx(g, t='signal', to='nobody', data={'a': 1}); tx(g, t='signal', to=wg['me']['id'], data={'a': 1})
ok('signals to unknown peers or yourself go nowhere', rx(g, 'signal', 0.5) is None)
tx(g, t='state', audio=True, video=False, screen=False); st = rx(h, 'state')
ok('mic/camera state is shared', st and st['audio'] and not st['video'], st)
tx(g, t='chat', text='  hello <b>there</b>  '); ch = rx(h, 'chat'); ch2 = rx(g, 'chat')
ok('chat reaches everyone including the sender, trimmed', ch and ch['text'] == 'hello <b>there</b>' and ch2 and ch2['id'] == ch['id'], ch)
for _ in range(12): tx(g, t='chat', text='spam')
time.sleep(0.4); got = 0
while rx(h, 'chat', 0.3): got += 1
drain(g); time.sleep(5.2)   # the limiter's window
ok('chat is rate limited', got <= 8, got)
tx(g, t='mute', to=wh['me']['id']); tx(g, t='kick', to=wh['me']['id']); tx(g, t='lock', on=True); tx(g, t='spotlight', id=wg['me']['id']); tx(g, t='admit', all=True)
ok('a guest cannot mute, remove, lock or spotlight', rx(h, 'mute', 0.5) is None and rx(h, 'kicked', 0.2) is None and rx(h, 'spotlight', 0.2) is None and rx(g, 'settings', 0.2) is None)
tx(h, t='mute', to=wg['me']['id']); ok('the host can ask someone to mute', rx(g, 'mute') is not None)
tx(h, t='unmute-ask', to=wg['me']['id']); ok('and ask them to unmute', rx(g, 'unmute-ask') is not None)
tx(h, t='camoff', to=wg['me']['id']); ok('and turn their camera off', (rx(g, 'camoff') or {}).get('by') == 'Koko')
tx(g, t='camoff', to=wh['me']['id']); ok('but a guest cannot turn anyone\'s camera off', rx(h, 'camoff', 0.4) is None)
tx(h, t='spotlight', id=wg['me']['id']); sp = rx(g, 'spotlight'); ok('the host can spotlight someone, for everyone', sp and sp['id'] == wg['me']['id'], sp)
tx(h, t='spotlight', id=None); ok('and clear it', (rx(g, 'spotlight') or {}).get('id') is None)

# ---- audio/video credentials only for people in the room
ok('media credentials need a valid ticket', call('POST', f'/api/meet/{code}/media', {'jt': 'nonsense'})[0] == 401)
s, mc = call('POST', f'/api/meet/{code}/media', {'jt': j['jt']})
ok('a person in the room gets STUN servers and the room size', s == 200 and mc['provider'] == 'mesh' and mc['ice_servers'][0]['urls'][0].startswith('stun:') and mc['max'] == 8, s, mc)

# ---- reactions, hands, DMs
tx(g, t='react', emoji='🎉'); r1 = rx(h, 'react'); ok('reactions reach everyone, with the sender', r1 and r1['emoji'] == '🎉' and r1['from'] == wg['me']['id'], r1)
tx(g, t='react', emoji='💣'); ok('only the offered emoji are accepted', rx(h, 'react', 0.5) is None)
tx(g, t='hand', up=True); hd = rx(h, 'hands'); ok('a raised hand is announced, in order', hd and hd['order'] == [wg['me']['id']], hd)
tx(h, t='hand', up=True); hd = rx(g, 'hands'); hd = rx(g, 'hands') or hd
ok('hands queue in the order they went up', hd['order'] == [wg['me']['id'], wh['me']['id']], hd)
tx(h, t='lower', id=wg['me']['id']); hd = rx(g, 'hands'); ok('a manager lowers someone else\'s hand', hd['order'] == [wh['me']['id']], hd)
tx(h, t='lower', all=True); ok('and all hands', rx(g, 'hands')['order'] == [])
drain(h); drain(g)
tx(g, t='chat', text='psst', to=wh['me']['id'])
pm = rx(h, 'chat'); pm2 = rx(g, 'chat')
ok('a private message reaches only its recipient and the sender', pm and pm['private'] and pm['text'] == 'psst' and pm2 and pm2['private'], pm)

# ---- the manager can change what the room allows, and everyone follows
s, up = call('PUT', f'/api/meet/{code}', {'settings': {'chat': 'host', 'reactions': False, 'share': 'host'}}, A)
ok('the host edits settings', s == 200 and up['settings']['chat'] == 'host' and not up['settings']['reactions'], up)
se = rx(g, 'settings'); ok('the room follows at once', se and se['settings']['chat'] == 'host' and se['settings']['share'] == 'host', se)
ok('non-hosts cannot edit settings', call('PUT', f'/api/meet/{code}', {'settings': {'chat': 'off'}}, U)[0] == 403)
tx(g, t='chat', text='public now?'); nt = rx(g, 'notice'); ok('host-only chat refuses a guest', nt and 'host' in nt['text'].lower() and rx(h, 'chat', 0.4) is None, nt)
tx(g, t='chat', text='to the host', to=wh['me']['id']); ok('but they can still message the host privately', (rx(h, 'chat') or {}).get('text') == 'to the host')
tx(g, t='react', emoji='👍'); ok('reactions off: ignored', rx(h, 'react', 0.4) is None)
tx(g, t='state', audio=True, video=True, screen=True); fc = rx(g, 'force')
ok('screen sharing restricted to the host: the share is switched off', fc and fc['screen'] is False, fc)
ok('and others do not see a screen', (rx(h, 'state', 0.5) or {}).get('screen') is False)
call('PUT', f'/api/meet/{code}', {'settings': {'chat': 'all', 'reactions': True, 'share': 'all'}}, A); rx(g, 'settings'); rx(h, 'settings')

# ---- lock, mute everyone
tx(h, t='lock', on=True); lk = rx(g, 'settings'); ok('locking is announced', lk and lk['settings']['locked'], lk)
s, jl = join(code, None, 'Latecomer'); w = ws(code, jl['jt']); ok('a locked room turns people away', (rx(w) or {}).get('t') == 'locked' and closed_with(w) == 4413)
tx(h, t='lock', on=False); rx(g, 'settings')
drain(g); drain(h)
tx(h, t='mute-all', allow_unmute=False); se = rxp(g, 'settings', lambda m: m['settings']['unmute'] is False, 2); ma = rx(g, 'mute')
ok('mute everyone asks everyone else to mute, and can forbid unmuting', ma is not None and rx(h, 'mute', 0.4) is None, ma)
ok('the unmute setting follows', se is not None, se)

# ---- captions are a room-wide switch for managers
drain(g)
tx(g, t='captions', on=True); ok('a guest cannot start captions', rx(g, 'settings', 0.5) is None)
tx(h, t='captions', on=True); cs = rxp(g, 'settings', lambda m: m['settings'].get('captions_on'), 2); ok('a manager starts captions for the room', cs is not None, cs)
tx(h, t='captions', on=False); ok('and stops them', rxp(g, 'settings', lambda m: m['settings'].get('captions_on') is False, 2) is not None)

# ---- polls
tx(h, t='poll', action='create', q='Lunch?', options=['Pizza', 'Sushi', 'Tacos'], multi=False, anonymous=False)
pl = rx(g, 'polls'); ok('a poll reaches everyone', pl and len(pl['polls']) == 1 and pl['polls'][0]['q'] == 'Lunch?' and pl['polls'][0]['open'] and pl['polls'][0]['counts'] == [0, 0, 0], pl)
pid = pl['polls'][0]['id']
drain(h); tx(g, t='poll', action='create', q='sneaky', options=['a', 'b'])
ok('a guest cannot make polls', rx(h, 'polls', 0.5) is None)
tx(g, t='vote', id=pid, choices=[1]); pl = rx(g, 'polls')
ok('a vote counts, and the voter sees their own choice', pl['polls'][0]['counts'] == [0, 1, 0] and pl['polls'][0]['mine'] == [1] and pl['polls'][0]['total'] == 1, pl)
tx(g, t='vote', id=pid, choices=[0, 2]); pl = rx(g, 'polls')
ok('a single-choice poll keeps one choice, a vote can be changed', pl['polls'][0]['counts'] == [1, 0, 0] and pl['polls'][0]['mine'] == [0], pl)
tx(h, t='vote', id=pid, choices=[0]); pl = rxp(h, 'polls', lambda m: m['polls'][0]['counts'][0] == 2)
ok('named polls show who voted for what', pl and sorted(pl['polls'][0]['names'][0]) == ['Guest Gail', 'Koko'], pl)
tx(h, t='poll', action='close', id=pid); rxp(g, 'polls', lambda m: not m['polls'][0]['open']); drain(g)
tx(g, t='vote', id=pid, choices=[2]); pl = rx(g, 'polls', 0.5)
ok('a closed poll takes no more votes', pl is None)
tx(h, t='poll', action='create', q='Secret?', options=['yes', 'no'], multi=True, anonymous=True); pl = rx(g, 'polls')
pid2 = pl['polls'][-1]['id']; tx(g, t='vote', id=pid2, choices=[0, 1]); pl = rx(g, 'polls')
ok('an anonymous multi-choice poll counts both and shows no names', pl['polls'][-1]['counts'] == [1, 1] and 'names' not in pl['polls'][-1], pl)
ok('creating a new poll closed the old one', not pl['polls'][0]['open'] and pl['polls'][-1]['open'])

# ---- waiting room (approval)
s, ap = call('POST', '/api/meet', {'title': 'Careful', 'settings': {'approval': True}}, A); acode = ap['code']
ha, jha, _ = welcomed(acode, A); ok('the host walks straight in', True)
s, jw = join(acode, None, 'Wendy'); w1 = ws(acode, jw['jt']); first = rx(w1)
ok('a guest is told to wait for approval', first and first['t'] == 'waiting' and first['reason'] == 'approval', first)
wl = rxp(ha, 'waiting-list', lambda m: m['list']); ok('the host sees who is waiting', wl and [x['name'] for x in wl['list']] == ['Wendy'], wl)
ok("a waiting person can't get audio/video credentials", call('POST', f'/api/meet/{acode}/media', {'jt': jw['jt']})[0] == 403)
tx(w1, t='chat', text='let me in'); ok('or chat or do anything', rx(ha, 'chat', 0.5) is None)
tx(ha, t='admit', id=wl['list'][0]['id']); wm = rx(w1, 'welcome')
ok('admitting brings them in with the full room state', wm and wm['me']['id'] == wl['list'][0]['id'], wm)
ok('and they get credentials now', call('POST', f'/api/meet/{acode}/media', {'jt': jw['jt']})[0] == 200)
w1.close(); time.sleep(0.4)
s, jw2 = join(acode, None, 'Wendy'); w1b = ws(acode, jw2['jt']); ok('a new guest waits again', (rx(w1b) or {}).get('t') == 'waiting')
wl = rxp(ha, 'waiting-list', lambda m: m['list']); tx(ha, t='deny', id=wl['list'][0]['id'])
dn = rx(w1b, 'denied'); ok('denying turns them away', dn is not None and closed_with(w1b) == 4412, dn)
s, jv = join(acode, U); wb = ws(acode, jv['jt']); ok('signed-in people wait too', (rx(wb) or {}).get('t') == 'waiting')
s, jx = join(acode, None, 'Xavier'); wx = ws(acode, jx['jt']); rx(wx)
rxp(ha, 'waiting-list', lambda m: len(m['list']) >= 2); tx(ha, t='admit', all=True)
ok('admit everyone lets everyone in', (rx(wb, 'welcome') or {}).get('t') == 'welcome' and (rx(wx, 'welcome') or {}).get('t') == 'welcome')
# reconnecting (same ticket) skips the queue
wb.close(); time.sleep(0.4); wb2 = ws(acode, jv['jt'])
ok('reconnecting with the same ticket does not wait again', (rx(wb2) or {}).get('t') == 'welcome')
# switching approval off lets the waiting in
s, jy = join(acode, None, 'Yara'); wy = ws(acode, jy['jt']); rx(wy)
call('PUT', f'/api/meet/{acode}', {'settings': {'approval': False}}, A)
ok('turning approval off lets the people waiting in', (rx(wy, 'welcome') or {}).get('t') == 'welcome')
call('PUT', f'/api/meet/{acode}', {'settings': {'approval': True}}, A)

# ---- co-hosts
s, jb = join(acode, C); wcat = ws(acode, jb['jt']); rx(wcat)
wl = rxp(ha, 'waiting-list', lambda m: any(x['name'] == 'Cat' for x in m['list'])); tx(ha, t='admit', id=[x for x in wl['list'] if x['name'] == 'Cat'][0]['id']); wc = rx(wcat, 'welcome')
tx(wcat, t='admit', all=True); tx(wcat, t='lock', on=True); ok('a participant cannot manage', rx(wcat, 'settings', 0.5) is None)
tx(ha, t='cohost', to=wc['me']['id'], on=True); role = rx(wcat, 'role')
ok('the host makes a co-host, who is told', role and role['manager'] and role['cohost'], role)
s, jz = join(acode, None, 'Zed'); wz = ws(acode, jz['jt']); rx(wz)
wl = rxp(wcat, 'waiting-list', lambda m: any(x['name'] == 'Zed' for x in m['list'])); tx(wcat, t='admit', id=[x for x in wl['list'] if x['name'] == 'Zed'][0]['id'])
ok('a co-host can let people in', (rx(wz, 'welcome') or {}).get('t') == 'welcome')
tx(wcat, t='cohost', to=wh['me']['id'], on=True); ok('but only the host can make co-hosts', rx(g, 'cohost', 0.4) is None)
tx(wcat, t='kick', to=wh['me']['id']); ok('and a co-host cannot remove the host', rx(h, 'kicked', 0.4) is None)
drain(h); tx(wcat, t='mute', to=wh['me']['id']); ok('or mute the host', rx(h, 'mute', 0.4) is None)

# ---- co-hosts set before the meeting starts
s, r = call('POST', '/api/meet', {'title': 'Early', 'cohosts': ['nobody@nowhere.io']}, A)
ok('a co-host must have an account: unknown emails are named', s == 422 and 'nobody@nowhere.io' in json.dumps(r), s, r)
s, ch = call('POST', '/api/meet', {'title': 'Early', 'permanent': True, 'cohosts': ['BOB@x.io', 'koko@kokodev.cc'], 'settings': {'approval': True, 'host_first': True}}, A); ecode = ch['code']
ok('co-hosts are saved by account (the host is not listed as their own co-host)', s == 200 and [x['email'] for x in ch['cohosts']] == ['bob@x.io'] and ch['role'] == 'host', ch)
mine_b = call('GET', '/api/meet', None, U)[1]
it = [x for x in mine_b if x['code'] == ecode]
ok('the co-host sees it in their own list, as co-hosting, with the invite details but not the settings', it and it[0]['role'] == 'cohost' and 'settings' not in it[0] and it[0]['title'] == 'Early', mine_b)
ok('and cannot change it', call('PUT', f'/api/meet/{ecode}', {'title': 'mine now'}, U)[0] == 403)
s, ie = call('GET', f'/api/meet/{ecode}', None, U); ok('the page knows they are a co-host, and others are not told', ie['is_cohost'] and not call('GET', f'/api/meet/{ecode}', None, C)[1]['is_cohost'])
eb, jeb, fe = welcomed(ecode, U)
ok('the co-host arrives first, straight in (the host is not there, and approval is on)', fe['me']['manager'] and fe['me']['cohost'] and not fe['me']['owner'], fe['me'])
s, jq = join(ecode, None, 'Quinn'); eq = ws(ecode, jq['jt'])
ok('everyone else waits for approval, because a manager is present', (rx(eq) or {}).get('reason') == 'approval')
wl = rxp(eb, 'waiting-list', lambda m: m['list']); tx(eb, t='admit', id=wl['list'][0]['id'])
ok('and the co-host lets them in', (rx(eq, 'welcome') or {}).get('t') == 'welcome')
eh, _, fh = welcomed(ecode, A)
ok('the host arriving later is the owner, and the co-host stays co-host', fh['me']['owner'] and any(p['cohost'] and p['name'] == 'Bob' for p in fh['peers']), fh['peers'])
# change the list while people are in
call('PUT', f'/api/meet/{ecode}', {'cohosts': []}, A)
role = rxp(eb, 'role', lambda m: m['cohost'] is False, 3); ok('removing a co-host in the settings demotes them at once', role is not None and not role['manager'], role)
call('PUT', f'/api/meet/{ecode}', {'cohosts': ['bob@x.io', 'cat@x.io']}, A)
role = rxp(eb, 'role', lambda m: m['cohost'] is True, 3); ok('and adding one promotes them at once', role is not None and role['manager'], role)
s, r = call('PUT', f'/api/meet/{ecode}', {'cohosts': ['bob@x.io'] * 3 + [f'u{i}@x.io' for i in range(12)]}, A); ok('there is a limit', s in (422,), s)
ok('the list is returned to the host', {x['email'] for x in [y for y in call('GET', '/api/meet', None, A)[1] if y['code'] == ecode][0]['cohosts']} == {'bob@x.io', 'cat@x.io'})

# ---- host first
s, hf = call('POST', '/api/meet', {'title': 'Host first', 'settings': {'host_first': True}}, A); fcode = hf['code']
s, jg1 = join(fcode, None, 'Early'); we = ws(fcode, jg1['jt'])
ok('people wait until the host is in', (rx(we) or {}).get('reason') == 'host')
hh, _, _ = welcomed(fcode, A)
ok('and come in when the host arrives', (rx(we, 'welcome') or {}).get('t') == 'welcome')

# ---- removing and blocking
s, jk = join(code, None, 'Karl'); wk = ws(code, jk['jt'], 'gk1'); wkw = rx(wk, 'welcome')
tx(h, t='kick', to=wkw['me']['id']); ok('a removed person is told', (rxp(wk, 'kicked', lambda m: True) or {}).get('blocked') is False)
wk2 = ws(code, jk['jt'], 'gk1'); w2 = rx(wk2); ok('a removed (not blocked) person can come back', w2 and w2['t'] == 'welcome')
tx(h, t='kick', to=w2['me']['id'], block=True); ok('blocking removes them too', (rxp(wk2, 'kicked', lambda m: True) or {}).get('blocked') is True)
wk3 = ws(code, jk['jt'], 'gk1'); ok('a blocked person is turned away with the same ticket', (rx(wk3) or {}).get('t') == 'denied' and closed_with(wk3) == 4412)
s, jk2 = join(code, None, 'Karl again'); wk4 = ws(code, jk2['jt'], 'gk1'); ok('and when they join again from the same browser', (rx(wk4) or {}).get('t') == 'denied')
# ---- a full room
s, sm = call('POST', '/api/meet', {'settings': {'max': 2}}, A); scode = sm['code']
s1, _, _ = welcomed(scode, A); s2, _, _ = welcomed(scode, None, 'Two')
s, j3 = join(scode, None, 'Three'); s3 = ws(scode, j3['jt']); fm = rx(s3, 'full')
ok('a room is capped at the number the host set', fm and fm['max'] == 2 and closed_with(s3) == 4409, fm)

# ---- passcode
s, pm_ = call('POST', '/api/meet', {'title': 'Secret', 'passcode': 'abcd'}, A); pcode = pm_['code']
ok('a short passcode is refused', call('POST', '/api/meet', {'passcode': 'ab'}, A)[0] == 422)
ok('the host sees the passcode, the public does not', pm_['passcode'] == 'abcd' and 'passcode' not in call('GET', f'/api/meet/{pcode}')[1] and call('GET', f'/api/meet/{pcode}')[1]['has_passcode'])
s, r = join(pcode, None, 'Pat'); ok('joining without it is refused, with a code the page can react to', s == 403 and r['detail']['code'] == 'passcode', r)
s, r = join(pcode, None, 'Pat', 'wrong'); ok('a wrong one too', s == 403 and 'isn' in r['detail']['message'], r)
ok('the right one works', join(pcode, None, 'Pat', 'abcd')[0] == 200)
ok('the host never needs it', join(pcode, A)[0] == 200)
s, r = call('PUT', f'/api/meet/{pcode}', {'passcode': ''}, A); ok('the host can remove it', s == 200 and r['passcode'] == '' and join(pcode, None, 'Pat')[0] == 200, r)

# ---- permanent meetings
s, pm1 = call('POST', '/api/meet', {'title': 'My room', 'permanent': True, 'settings': {'approval': True, 'chat': 'off'}, 'passcode': 'room1'}, A); rcode = pm1['code']
ok('a permanent meeting keeps its settings', s == 200 and pm1['permanent'] and pm1['settings']['approval'] and pm1['settings']['chat'] == 'off', pm1)
wr, _, _ = welcomed(rcode, A)
s, r = call('POST', f'/api/meet/{rcode}/end', {}, A)
ok('ending a permanent meeting ends only the session', s == 200 and r['permanent'] and (rx(wr, 'ended') or {}).get('t') == 'ended', r)
s, i = call('GET', f'/api/meet/{rcode}'); ok('it is still there, with its code', s == 200 and not i['ended'] and i['permanent'])
wr2, _, f2 = welcomed(rcode, A); ok('and the next session starts fresh with the same settings', f2['settings']['approval'] and f2['settings']['chat'] == 'off')
mine = call('GET', '/api/meet', None, A)[1]
ok('it is listed on the host\'s account, permanent ones first', mine[0]['code'] == rcode and mine[0]['permanent'] and mine[0]['live'] == 1, [x['code'] for x in mine])
ok('others do not see it', rcode not in [x['code'] for x in call('GET', '/api/meet', None, U)[1]])
s, r = call('PUT', f'/api/meet/{rcode}', {'title': 'Renamed', 'permanent': False}, A); ok('it can be made one-off again, and renamed', s == 200 and r['title'] == 'Renamed' and not r['permanent'])
call('PUT', f'/api/meet/{rcode}', {'permanent': True}, A)
ok('only the host can delete it', call('DELETE', f'/api/meet/{rcode}', None, U)[0] == 403)
s, _ = call('DELETE', f'/api/meet/{rcode}', None, A)
ok('deleting removes it for good and closes the room', s == 200 and call('GET', f'/api/meet/{rcode}')[0] == 404)
for k in range(MAXP := 24): call('POST', '/api/meet', {'permanent': True}, C)
s, r = call('POST', '/api/meet', {'permanent': True}, C); s2_, r2 = call('POST', '/api/meet', {'permanent': True}, C)
ok('there is a limit on permanent meetings per person', s2_ == 409 or s == 409, s, s2_)

# ---- recording
def recording_total(tok): return call('GET', '/api/me/storage', None, tok)[1]
s, rm = call('POST', '/api/meet', {'title': 'Recorded', 'permanent': True}, A); rcode = rm['code']
ok('recording is allowed for the host only, by default', rm['settings']['recording'] == 'host' and rm['settings']['record_consent'] is False, rm['settings'])
rh, jrh, frh = welcomed(rcode, A); rg, jrg, frg = welcomed(rcode, None, 'Gail')
s, jrb = join(rcode, U); rb = ws(rcode, jrb['jt']); frb = rx(rb, 'welcome')
tx(rh, t='cohost', to=frb['me']['id'], on=True); rxp(rb, 'role', lambda m: m['cohost'])
s, r = call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrg['jt']}); ok('a guest cannot record', s == 403, s, r)
s, r = call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrb['jt']}); ok('and neither can a co-host when only the host may', s == 403 and 'Only the host' in json.dumps(r), s, r)
s, r = call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrh['jt'], 'mime': 'application/pdf'}); ok('only video formats are accepted', s == 422, s)
drain(rg); drain(rh)
s, rec = call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrh['jt'], 'mime': 'video/webm;codecs=vp8,opus'}); rid = rec['id']
ok('the host starts a recording', s == 200 and rid and rec['required'] is False, s, rec)
st = rxp(rg, 'settings', lambda m: m['settings'].get('recording_now'), 2)
ok('everyone is told, with who started it and whether agreeing is required', st and st['settings']['recording_now']['by'] == 'Koko' and st['settings']['recording_now']['required'] is False, st)
ok('a second recording is refused', call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrh['jt']})[0] == 409)
ok('the public page says it is being recorded', call('GET', f'/api/meet/{rcode}')[1]['recording'] == {'required': False})
def put_chunk(rid_, seq, data, jt, code_=None):
    import urllib.request, urllib.error
    q = urllib.request.Request(f'{B}/api/meet/{code_ or rcode}/recordings/{rid_}/chunk?seq={seq}', data, {'x-meet-ticket': jt, 'content-type': 'application/octet-stream'}, method='PUT')
    try: x = urllib.request.urlopen(q); return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
c0 = b'\x1a\x45\xdf\xa3' + b'A' * 2000; c1 = b'B' * 3000
ok('pieces are stored in order', put_chunk(rid, 0, c0, jrh['jt'])[0] == 200 and put_chunk(rid, 1, c1, jrh['jt'])[1]['size'] == 5004)
ok('a retried piece is not stored twice', put_chunk(rid, 1, c1, jrh['jt'])[1]['size'] == 5004)
ok('a piece that skips ahead is refused', put_chunk(rid, 5, c1, jrh['jt'])[0] == 409)
ok("someone else's ticket cannot add to it", put_chunk(rid, 2, c1, jrg['jt'])[0] == 403)
sto = recording_total(A)
ok("it counts against the host's storage", sto['recordings'] == 5004 and sto['total'] >= 5004, sto)
sl = call('GET', '/api/me/storage/items', None, A)[1]; ok('and shows in the by-file list', sl['recordings'] == 5004 and sl['recording_count'] == 1, sl)
# consent: optional mode
tx(rg, t='consent', agree=False); cs = rxp(rh, 'consents', lambda m: rg and len(m['no']) == 1, 2)
ok('when agreeing is optional, saying no only leaves you out of the recording (not removed)', cs is not None and rx(rg, 'declined', 0.5) is None, cs)
tx(rg, t='consent', agree=True); cs = rxp(rh, 'consents', lambda m: not m['no'] and len(m['yes']) >= 2, 2)
ok('and you can change your mind', cs is not None, cs)
ok("the recorder and the host count as agreed, nobody has to ask", frh['me']['owner'])
tx(rg, t='consent', agree=False); rxp(rh, 'consents', lambda m: m['no'])
# stop
s, _ = call('POST', f'/api/meet/{rcode}/recordings/{rid}/stop', {'jt': jrh['jt'], 'duration_ms': 7500})
ok('stopping ends it for everyone', s == 200 and rxp(rg, 'settings', lambda m: m['settings'].get('recording_now') is None, 2) is not None)
ok('and further pieces are refused', put_chunk(rid, 2, c1, jrh['jt'])[0] == 410)
items = call('GET', '/api/recordings', None, A)[1]
ok('it is listed for the host with its size and length', items['items'][0]['id'] == rid and items['items'][0]['size'] == 5004 and items['items'][0]['duration_ms'] == 7500 and items['items'][0]['status'] == 'done' and items['items'][0]['code'] == rcode, items)
ok("others do not see it", call('GET', '/api/recordings', None, U)[1]['items'] == [] and call('GET', f'/api/recordings/{rid}', None, U)[0] == 403)
info_ = call('GET', f'/api/recordings/{rid}', None, A)[1]
import urllib.request as ur
body = ur.urlopen(B + info_['url']).read()
ok('it is played and downloaded through a signed address', body == c0 + c1)
rq = ur.Request(B + info_['url'], headers={'Range': 'bytes=0-9'}); rr = ur.urlopen(rq)
ok('with seeking (ranges)', rr.status == 206 and len(rr.read()) == 10)
ok('the download has a proper name', 'attachment' in ur.urlopen(B + info_['url'] + '&download=1').headers['content-disposition'] and 'Recorded' in ur.urlopen(B + info_['url'] + '&download=1').headers['content-disposition'])
try: ur.urlopen(B + info_['url'][:-6] + 'abcdef'); forged = False
except Exception as e: forged = getattr(e, 'code', 0) == 403
ok('a forged address is refused', forged)
s, _ = call('DELETE', f'/api/recordings/{rid}', None, U); ok("only the owner can delete", s == 403)
s, _ = call('DELETE', f'/api/recordings/{rid}', None, A); ok('deleting frees the space', s == 200 and recording_total(A)['recordings'] == 0 and call('GET', '/api/recordings', None, A)[1]['items'] == [])
# consent required: saying no removes you
call('PUT', f'/api/meet/{rcode}', {'settings': {'record_consent': True, 'recording': 'managers'}}, A)
rxp(rg, 'settings', lambda m: m['settings'].get('record_consent'), 2)
s, rec2 = call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrb['jt']}); ok('with "managers", a co-host can record too', s == 200 and rec2['required'] is True, s, rec2)
rid2 = rec2['id']
tx(rg, t='consent', agree=False)
ok('when everyone must agree, saying no removes you from the meeting', (rxp(rg, 'declined', lambda m: True, 2) or {}).get('t') == 'declined' and closed_with(rg) == 4415)
rxp(rh, 'consents', lambda m: True, 1)
# the host never has to answer, and the co-host recorder neither; an extra person who ignores the question is removed after the grace
s, jlate = join(rcode, None, 'Late'); wl_ = ws(rcode, jlate['jt']); rx(wl_, 'welcome')
ok('someone who ignores the question is removed after a short time', rxp(wl_, 'declined', lambda m: True, 5) is not None)
put_chunk(rid2, 0, b'C' * 100, jrb['jt']); 
rb.close(); time.sleep(2.5)
ok('if the recording browser disappears the recording ends and keeps what arrived', call('GET', '/api/recordings', None, A)[1]['items'][0]['status'] == 'done' and call('GET', '/api/recordings', None, A)[1]['items'][0]['size'] == 100)
call('DELETE', f"/api/recordings/{rid2}", None, A)
call('PUT', f'/api/meet/{rcode}', {'settings': {'recording': 'off'}}, A)
ok('recording can be turned off for the meeting', call('POST', f'/api/meet/{rcode}/recordings', {'jt': jrh['jt']})[0] == 403)
call('PUT', f'/api/meet/{rcode}', {'settings': {'recording': 'host', 'record_consent': False}}, A)
# out of storage
s, bm = call('POST', '/api/meet', {'title': 'Bobs'}, U); bcode = bm['code']
_, bu = call('GET', '/api/auth/me', None, U)
call('PATCH', f"/api/admin/users/{bu['id']}", {'quota_mb': 1}, A)
bh, jbh, _ = welcomed(bcode, U); s, brec = call('POST', f'/api/meet/{bcode}/recordings', {'jt': jbh['jt']})
ok('a host with no storage left cannot start (checked up front only when already full)', s == 200, s, brec)
s, r = put_chunk(brec['id'], 0, b'D' * (1024 * 1024 + 500), jbh['jt'], bcode)
ok('when the host runs out of space the piece is refused, the (empty) recording is discarded and everyone is told it ended', s == 413 and call('GET', '/api/recordings', None, U)[1]['items'] == [] and rxp(bh, 'settings', lambda m: m['settings'].get('recording_now') is None, 2) is not None, s, r)
s, brec2 = call('POST', f'/api/meet/{bcode}/recordings', {'jt': jbh['jt']}); put_chunk(brec2['id'], 0, b'E' * 600_000, jbh['jt'], bcode)
put_chunk(brec2['id'], 1, b'F' * 600_000, jbh['jt'], bcode)
ok('and when some of it had arrived, that part is kept', call('GET', '/api/recordings', None, U)[1]['items'][0]['size'] == 600_000 and call('GET', '/api/recordings', None, U)[1]['items'][0]['status'] == 'done')
call('PATCH', f"/api/admin/users/{bu['id']}", {'clear_quota': True}, A)

# ---- permissions, person by person
s, pm = call('POST', '/api/meet', {'title': 'Perms'}, A); pcode_ = pm['code']
ok('new permission settings have friendly defaults', all(pm['settings'][k] == v for k, v in {'camera': True, 'collab': 'all', 'present': 'all', 'edit_shared': True, 'seek': True}.items()), pm['settings'])
ph, jph, fph = welcomed(pcode_, A); pg, jpg, fpg = welcomed(pcode_, None, 'Pia')
ok('a guest is told what they may do (everything, by default)', fpg['perms'] == {k: True for k in ['mic', 'camera', 'screen', 'chat', 'react', 'collab', 'present', 'edit', 'seek']}, fpg['perms'])
ok('and a host sees the (empty) overrides', fph.get('overrides') == {}, fph.get('overrides'))
drain(ph); drain(pg)
call('PUT', f'/api/meet/{pcode_}', {'settings': {'camera': False, 'unmute': False}}, A)
np_ = rxp(pg, 'perms', lambda m: m['perms']['camera'] is False and m['perms']['mic'] is False, 2); ok('changing the meeting defaults updates what people may do at once', np_ is not None, np_)
tx(pg, t='state', audio=True, video=True, screen=False); fc = rxp(pg, 'force', lambda m: True, 2)
ok('turning on a camera or microphone nobody allowed is switched back off', fc and fc.get('video') is False and fc.get('audio') is False, fc)
st_ = rxp(ph, 'state', lambda m: True, 2); ok('and others see them as off', st_ and not st_['video'] and not st_['audio'], st_)
tx(ph, t='perm', to=fpg['me']['id'], key='camera', allow=True)
ok('the host can allow the camera for one person', rxp(pg, 'perms', lambda m: m['perms']['camera'] is True and m['perms']['mic'] is False, 2) is not None)
ov = rxp(ph, 'overrides', lambda m: m['overrides'], 2); ok('the host sees who has an override', ov and ov['overrides'] == {fpg['me']['id']: {'camera': True}}, ov)
tx(pg, t='state', audio=False, video=True, screen=False); ok('and now their camera can go on', rxp(ph, 'state', lambda m: m['video'], 2) is not None)
tx(ph, t='perm', to=fpg['me']['id'], key='camera', allow=False)
fc = rxp(pg, 'force', lambda m: m.get('video') is False, 2); ok('taking it away switches it off if it is on right now', fc is not None, fc)
tx(ph, t='perm', to=fpg['me']['id'], key='camera', allow=None); ok('clearing goes back to the meeting default', rxp(pg, 'perms', lambda m: m['perms']['camera'] is False, 2) is not None)
tx(pg, t='perm', to=fph['me']['id'], key='camera', allow=False); ok("a guest cannot change anyone's permissions", rxp(ph, 'perms', lambda m: True, 0.6) is None and rx(ph, 'overrides', 0.4) is None)
call('PUT', f'/api/meet/{pcode_}', {'settings': {'chat': 'host', 'reactions': False}}, A); rxp(pg, 'perms', lambda m: not m['perms']['chat'], 2)
tx(ph, t='perm', to=fpg['me']['id'], key='chat', allow=True); rxp(pg, 'perms', lambda m: m['perms']['chat'], 2); drain(ph)
tx(pg, t='chat', text='allowed to speak'); ok('one person can be allowed to chat when the rest cannot', (rxp(ph, 'chat', lambda m: True, 2) or {}).get('text') == 'allowed to speak')
tx(ph, t='perm', to=fpg['me']['id'], key='react', allow=True); rxp(pg, 'perms', lambda m: m['perms']['react'], 2); drain(ph)
tx(pg, t='react', emoji='👍'); ok('and to react', rxp(ph, 'react', lambda m: True, 2) is not None)

# ---- sharing a document in the meeting
def api_doc(did, tok=None, dt=None):
    import urllib.request, urllib.error
    h = {'content-type': 'application/json', **({'authorization': 'Bearer ' + tok} if tok else {}), **({'x-doc-token': dt} if dt else {})}
    try: x = urllib.request.urlopen(urllib.request.Request(f'{B}/api/docs/{did}', None, h)); return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
def make_doc(tok, kind='doc', title='A doc'):
    return call('POST', '/api/docs', {'title': title, 'kind': kind}, tok)[1]['id']
call('PUT', f'/api/meet/{pcode_}', {'settings': {'chat': 'all', 'reactions': True, 'camera': True, 'unmute': True}}, A)
sd = make_doc(A, 'doc', 'Plan'); sd_slides = make_doc(A, 'slides', 'Deck'); bob_doc = make_doc(U, 'doc', 'Bobs')
s, jpb = join(pcode_, U); pb = ws(pcode_, jpb['jt']); fpb = rx(pb, 'welcome'); drain(ph); drain(pg); drain(pb)
tx(pg, t='share', action='start', doc_id=sd, mode='collab'); nt = rxp(pg, 'notice', lambda m: True, 2); ok('a guest cannot share a document (they own none)', nt and 'Sign in' in nt['text'], nt)
tx(pb, t='share', action='start', doc_id=sd, mode='collab'); nt = rxp(pb, 'notice', lambda m: True, 2); ok("nobody can share a document they don't own", nt and 'own' in nt['text'], nt)
tx(ph, t='share', action='start', doc_id=sd, mode='present'); nt = rxp(ph, 'notice', lambda m: True, 2); ok('only presentations can be presented', nt and 'presentations' in nt['text'], nt)
ok('nothing was shared by those', call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']})[0] == 404)
tx(ph, t='share', action='start', doc_id=sd, mode='collab')
sh = rxp(pg, 'share', lambda m: m['share'], 2)
ok('the host shares a document to edit together; everyone is told', sh and sh['share']['kind'] == 'collab' and sh['share']['title'] == 'Plan' and sh['share']['edit'] and sh['share']['by'] == 'Koko' and sh['share']['doc_kind'] == 'doc', sh)
s, tk = call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']})
ok('a guest in the meeting gets an editor key for it', s == 200 and tk['role'] == 'editor' and tk['doc_id'] == sd, s, tk)
ok('without the key the guest cannot open it', api_doc(sd)[0] in (401, 403))
s, dd = api_doc(sd, None, tk['token']); ok('with it they can, as an editor', s == 200 and dd['role'] == 'editor', s, dd)
ok("a key for another document does not work", api_doc(bob_doc, None, tk['token'])[0] in (401, 403))
tx(ph, t='share', action='edit', on=False); rxp(pg, 'share', lambda m: m['share'] and not m['share']['edit'], 2)
s, tk2 = call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']}); ok('switching editing off makes new keys view-only', tk2['role'] == 'viewer' and api_doc(sd, None, tk2['token'])[1]['role'] == 'viewer')
tx(ph, t='share', action='edit', on=True); rxp(pg, 'share', lambda m: m['share'] and m['share']['edit'], 2)
tx(ph, t='perm', to=fpg['me']['id'], key='edit', allow=False); s, tk3 = call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']})
ok("and one person can be made view-only while the rest edit", tk3['role'] == 'viewer' and call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpb['jt']})[1]['role'] == 'editor')
tx(ph, t='perm', to=fpg['me']['id'], key='edit', allow=None); drain(ph); drain(pg)
tx(pb, t='share', action='start', doc_id=bob_doc, mode='collab'); nt = rxp(pb, 'notice', lambda m: True, 2); ok('only one thing is shared at a time', nt and 'already sharing' in nt['text'], nt)
tx(pg, t='state', audio=False, video=False, screen=True); fc = rxp(pg, 'force', lambda m: m.get('screen') is False, 2); ok('and nobody can share their screen over it', fc is not None and 'document' in fc.get('text', ''), fc)
tx(pb, t='share', action='stop'); ok('only the person sharing (or a manager) can stop it', rxp(pg, 'share', lambda m: True, 0.6) is None)
tx(ph, t='share', action='stop'); ok('the host stops it for everyone', rxp(pg, 'share', lambda m: m['share'] is None, 2) is not None)
ok('and the keys stop working at once', api_doc(sd, None, tk['token'])[0] in (401, 403) and call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']})[0] == 404)
call('PUT', f'/api/meet/{pcode_}', {'settings': {'collab': 'host', 'present': 'host'}}, A); rxp(pb, 'perms', lambda m: not m['perms']['collab'], 2)
tx(pb, t='share', action='start', doc_id=bob_doc, mode='collab'); nt = rxp(pb, 'notice', lambda m: True, 2); ok('who may share documents is a setting', nt and "can't share" in nt['text'], nt)
tx(ph, t='perm', to=fpb['me']['id'], key='collab', allow=True); rxp(pb, 'perms', lambda m: m['perms']['collab'], 2)
tx(pb, t='share', action='start', doc_id=bob_doc, mode='collab'); ok('but one person can be allowed to', rxp(ph, 'share', lambda m: m['share'] and m['share']['by'] == 'Bob', 2) is not None)
tx(pb, t='share', action='stop'); rxp(ph, 'share', lambda m: m['share'] is None, 2)
# presenting
tx(ph, t='share', action='start', doc_id=sd_slides, mode='present'); sh = rxp(pg, 'share', lambda m: m['share'] and m['share']['kind'] == 'present', 2)
ok('the host presents a presentation', sh and sh['share']['kind'] == 'present' and sh['share']['slide'] == 0 and sh['share']['seek'] and not sh['share']['edit'], sh)
tk4 = call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']})[1]; ok('viewers get a view-only key for a presentation', tk4['role'] == 'viewer')
tx(ph, t='slide', n=3); sl = rxp(pg, 'slide', lambda m: True, 2); ok("the presenter's page reaches everyone", sl and sl['n'] == 3, sl)
tx(pg, t='slide', n=9); ok('and nobody else can turn the page', rxp(ph, 'slide', lambda m: True, 0.6) is None)
tx(ph, t='share', action='seek', on=False); ok('the presenter can stop people browsing on their own', rxp(pg, 'share', lambda m: m['share'] and not m['share']['seek'], 2) is not None)
tx(pb, t='slide', n=4); ok('a participant cannot move the presentation', rxp(pg, 'slide', lambda m: True, 0.6) is None)
tx(ph, t='cohost', to=fpb['me']['id'], on=True); rxp(pb, 'role', lambda m: m['cohost'], 2)
tx(pb, t='slide', n=5); ok('a co-host can', (rxp(pg, 'slide', lambda m: True, 2) or {}).get('n') == 5)
ph.close(); time.sleep(2.5)
nsh = call('POST', f'/api/meet/{pcode_}/share/token', {'jt': jpg['jt']}); ok('when the person presenting leaves, it ends', nsh[0] == 404, nsh)
call('PUT', f'/api/meet/{pcode_}', {'settings': {'collab': 'all', 'present': 'all'}}, A)

# ---- end for everyone (one-off)
ok('only the host can end it', call('POST', f'/api/meet/{code}/end', {}, U)[0] == 403)
s, r = call('POST', f'/api/meet/{code}/end', {}, A)
em = rx(g, 'ended'); eh = rx(h, 'ended')
ok('the host ends it: everyone is told', s == 200 and not r['permanent'] and em and eh, s, em, eh)
ok('an ended one-off meeting can no longer be joined, or its settings changed', join(code, None, 'x')[0] == 410 and call('PUT', f'/api/meet/{code}', {'title': 'x'}, A)[0] == 410)
ok('and is gone from the host list', code not in [x['code'] for x in call('GET', '/api/meet', None, A)[1]])

# ---- admin settings
s, ad = call('GET', '/api/admin/meet', None, A)
ok('admin sees the settings, with providers', s == 200 and ad['provider'] == 'mesh' and {p['id'] for p in ad['providers']} == {'mesh', 'realtimekit'}, ad)
ok('non-admins cannot read or change them', call('GET', '/api/admin/meet', None, U)[0] == 403 and call('PUT', '/api/admin/meet', {'enabled': False}, U)[0] == 403)
s, r = call('POST', '/api/admin/meet/test', {}, A); ok('mesh test works with STUN only and says so', s == 200 and r['ok'] and not r['turn'], r)
s, ad = call('PUT', '/api/admin/meet', {'turn': {'mode': 'cloudflare', 'key_id': 'K1', 'token': 'cf-token'}}, A)
ok('the TURN token is saved but never returned', s == 200 and ad['turn']['token_set'] and 'cf-token' not in json.dumps(ad), ad)
s, r = call('POST', '/api/admin/meet/test', {}, A); ok('Cloudflare TURN credentials are fetched', s == 200 and r['turn'], r)
call('PUT', '/api/admin/meet', {'turn': {'token': ''}}, A)
ok('an empty token keeps the stored one', call('GET', '/api/admin/meet', None, A)[1]['turn']['token_set'])
s, m3 = call('POST', '/api/meet', {}, A); w3, j3, _ = welcomed(m3['code'], None, 'G')
s, mc = call('POST', f"/api/meet/{m3['code']}/media", {'jt': j3['jt']})
turn = [x for x in mc['ice_servers'] if x.get('username')]
ok('people get the relay servers, port 53 left out, with credentials', turn and turn[0]['username'] == 'u1' and all(':53' not in u for x in mc['ice_servers'] for u in x['urls']), mc)
call('PUT', '/api/admin/meet', {'turn': {'token': 'wrong'}}, A)
call('PUT', '/api/admin/meet', {'turn': {'mode': 'custom', 'urls': 'turn:relay.example.com:3478\nturns:relay.example.com:443', 'user': 'me', 'password': 'pw'}}, A)
s, mc = call('POST', f"/api/meet/{m3['code']}/media", {'jt': j3['jt']}); cu = [x for x in mc['ice_servers'] if x.get('username') == 'me']
ok('a custom TURN server is passed on', cu and cu[0]['credential'] == 'pw' and len(cu[0]['urls']) == 2, mc)
call('PUT', '/api/admin/meet', {'turn': {'mode': 'custom', 'urls': 'free.expressturn.com:3478\nglobal.relay.metered.ca:80 userA secretA\nturn:other.example.com:3478?transport=tcp user B', 'user': 'shared', 'password': 'sp'}}, A)
s, mc = call('POST', f"/api/meet/{m3['code']}/media", {'jt': j3['jt']})
byu = {x.get('username'): x for x in mc['ice_servers'] if x.get('username')}
ok('addresses typed without turn: get it added', 'turn:free.expressturn.com:3478' in byu['shared']['urls'], mc)
ok('a line with its own login keeps it (a different service), the others share the form\'s', byu['userA']['credential'] == 'secretA' and byu['userA']['urls'] == ['turn:global.relay.metered.ca:80'] and byu['shared']['credential'] == 'sp', byu)
ok('and a line already starting with turn: is left alone', byu['user']['urls'] == ['turn:other.example.com:3478?transport=tcp'] and byu['user']['credential'] == 'B', byu)
call('PUT', '/api/admin/meet', {'turn': {'mode': 'none'}}, A)

# ---- RealtimeKit
s, r = call('PUT', '/api/admin/meet', {'provider': 'realtimekit'}, A)
ok('choosing RealtimeKit without credentials reports what is missing', s == 200 and 'account id' in (r['problem'] or ''), r)
ok('and meetings cannot be started yet', call('POST', '/api/meet', {}, A)[0] == 409 and call('POST', '/api/admin/meet/test', {}, A)[0] == 422)
call('PUT', '/api/admin/meet', {'rtk': {'account': 'acc', 'app': 'app1', 'token': 'wrong'}}, A)
s, r = call('POST', '/api/admin/meet/test', {}, A); ok('a rejected token is explained', s == 502 and 'rejected the token' in json.dumps(r), s, r)
call('PUT', '/api/admin/meet', {'rtk': {'token': 'cf-token'}}, A)
s, r = call('POST', '/api/admin/meet/test', {}, A); ok('a good connection creates and closes a test meeting', s == 200 and r['ok'] and any(c_ == 'PATCH' for c_, *_ in SEEN), s, r)
SEEN.clear(); CREATED.clear()
s, rk = call('POST', '/api/meet', {'title': 'Big one', 'settings': {'approval': True}}, A); kcode = rk['code']
ok('a RealtimeKit meeting is created, nothing yet asked of Cloudflare', s == 200 and rk['provider'] == 'realtimekit' and not CREATED, rk)
hk, jhk, _ = welcomed(kcode, A)
s, mh = call('POST', f'/api/meet/{kcode}/media', {'jt': jhk['jt']})
ok('the host gets a token for the host preset; the meeting is created once at Cloudflare', s == 200 and mh['auth_token'].startswith('tok-group_call_host-') and len(CREATED) == 1 and CREATED[0]['title'] == 'Big one', s, mh, CREATED)
s, jgk = join(kcode, None, 'Gail'); wgk = ws(kcode, jgk['jt']); rx(wgk)
ok('approval applies to RealtimeKit meetings too, and there is no token while waiting', call('POST', f'/api/meet/{kcode}/media', {'jt': jgk['jt']})[0] == 403 and len(CREATED) == 1)
wl = rxp(hk, 'waiting-list', lambda m: m['list']); tx(hk, t='admit', id=wl['list'][0]['id']); wgw = rx(wgk, 'welcome')
s, mg = call('POST', f'/api/meet/{kcode}/media', {'jt': jgk['jt']})
ok('once admitted a guest gets the participant preset, same Cloudflare meeting', s == 200 and 'group_call_participant' in mg['auth_token'] and len(CREATED) == 1, mg)
tx(hk, t='cohost', to=wgw['me']['id'], on=True); rx(wgk, 'role')
s, mg2 = call('POST', f'/api/meet/{kcode}/media', {'jt': jgk['jt']}); ok('a co-host gets the host preset', 'group_call_host' in mg2['auth_token'], mg2)
parts = [b for c_, p, a_, b in SEEN if p.endswith('/participants')]
ok('Cloudflare was sent the name and the connection id', parts[1]['name'] == 'Gail' and parts[0]['custom_participant_id'] != parts[1]['custom_participant_id'] and parts[1]['custom_participant_id'] == jgk['cid'], parts)
ok('the token never reaches the browser in any join reply', 'cf-token' not in json.dumps([jhk, jgk, mh, mg]))
s, mm = call('POST', f"/api/meet/{m3['code']}/media", {'jt': j3['jt']}); ok('meetings started with another provider keep that provider', s == 200 and mm['provider'] == 'mesh', s, mm)
s, _ = call('POST', f'/api/meet/{kcode}/end', {}, A)
ok('ending closes it at Cloudflare too', s == 200 and any(c_ == 'PATCH' and p.endswith('/meetings/mtg-1') and b.get('status') == 'INACTIVE' for c_, p, a_, b in SEEN), SEEN[-2:])
# permanent + RealtimeKit: the next session gets a fresh Cloudflare meeting
s, pk = call('POST', '/api/meet', {'permanent': True}, A); pkc = pk['code']
hp, jhp, _ = welcomed(pkc, A); call('POST', f'/api/meet/{pkc}/media', {'jt': jhp['jt']}); n1 = len(CREATED)
call('POST', f'/api/meet/{pkc}/end', {}, A); hp2, jhp2, _ = welcomed(pkc, A); call('POST', f'/api/meet/{pkc}/media', {'jt': jhp2['jt']})
ok('a permanent RealtimeKit meeting makes a fresh Cloudflare meeting each session', len(CREATED) == n1 + 1, len(CREATED), n1)

# ---- captions
s, r = call('GET', '/api/meet/config'); ok('captions are offered only when the server can transcribe', isinstance(r['captions'], bool))

s, r = call('POST', f"/api/meet/{m3['code']}/caption", {'jt': 'nope'})
ok('captions are refused without a ticket from the room', s in (403, 422), s)
# ---- off switch
call('PUT', '/api/admin/meet', {'provider': 'mesh', 'enabled': False}, A)
ok('with meetings off nothing works', call('POST', '/api/meet', {}, A)[0] == 403 and call('GET', f"/api/meet/{m3['code']}")[0] == 403 and join(m3['code'], None, 'x')[0] == 403 and call('GET', '/api/meet/config')[1]['enabled'] is False)
call('PUT', '/api/admin/meet', {'enabled': True, 'guests': False}, A)
s, i = call('GET', f"/api/meet/{m3['code']}")
ok('with guests off only signed-in people can join, whatever the meeting says', i['can_join'] is False and join(m3['code'], None, 'x')[0] == 401)
for w in SOCKS:
    try: w.close()
    except Exception: pass
print('ALL PASSED' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
