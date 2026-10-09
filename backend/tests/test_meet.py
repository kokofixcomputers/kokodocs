"""Meetings: rooms, guests, passcodes, the waiting room, co-hosts, reactions, polls, permanent meetings, and both providers (RealtimeKit and TURN against a mock
Cloudflare). Needs the server on :8000 with a fresh data dir, started with KOKO_CF_API=http://127.0.0.1:8767/client/v4 KOKO_TURN_API=http://127.0.0.1:8767/v1/turn/keys"""
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
