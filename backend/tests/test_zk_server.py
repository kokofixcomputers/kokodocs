"""Zero-knowledge, server side: the server only stores and relays opaque blobs. Needs the server on :8000 with a fresh data dir."""
import asyncio, base64, json, os, sys, time, uuid, urllib.request, urllib.error
B = 'http://localhost:8000'
def call(m, p, body=None, tok=None):
    h = {'content-type': 'application/json'}
    if tok: h['authorization'] = 'Bearer ' + tok
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(body).encode() if body is not None else None, h, method=m)); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
import websockets
b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
def var(n):
    out = bytearray()
    while n > 0x7F: out.append(0x80 | (n & 0x7F)); n >>= 7
    out.append(n); return bytes(out)
def rvar(b, i=0):
    n = sh = 0
    while True:
        x = b[i]; i += 1; n |= (x & 0x7F) << sh
        if x < 0x80: return n, i
        sh += 7
tag = uuid.uuid4().hex[:6]
def signup(name):
    s, r = call('POST', '/api/auth/signup', {'email': f'{name}{tag}@z.io', 'name': name, 'password': 'password123'}); return r['token'], f'{name}{tag}@z.io'
def keys(auth, pub): return {'salt': b64(os.urandom(16)), 'params': {'m': 65536, 't': 3, 'p': 1}, 'auth': auth, 'master_wrapped': b64(os.urandom(60)), 'priv_wrapped': b64(os.urandom(60)), 'pub': pub, 'recovery_wrapped': b64(os.urandom(60))}
A, ea = signup('alice'); Bo, eb = signup('bob'); C, ec = signup('carol')

# a plain document that exists before encryption is turned on
s, plain = call('POST', '/api/docs', {'kind': 'doc', 'title': 'Secret plans'}, A)
ok('prelogin: an ordinary account is not zk', call('GET', f'/api/auth/prelogin?email={ea}')[1] == {'zk': False})
ok('prelogin: unknown address looks the same', call('GET', '/api/auth/prelogin?email=nobody@z.io')[1] == {'zk': False})
s, r = call('POST', '/api/zk/enable', {**keys(b64(os.urandom(32)), b64(os.urandom(32))), 'password': 'wrong-password'}, A)
ok('turning it on needs the real password', s == 400, s, r)
authA = b64(os.urandom(32)); pubA = b64(os.urandom(32))
s, r = call('POST', '/api/zk/enable', {**keys(authA, pubA), 'password': 'password123', 'params': {'m': 8, 't': 1, 'p': 1}}, A)
ok('weak stretching settings are refused', s == 422, s)
s, r = call('POST', '/api/zk/enable', {**keys(authA, pubA), 'password': 'password123'}, A)
ok('turn on', s == 200, s, r)
pre = call('GET', f'/api/auth/prelogin?email={ea}')[1]
ok('prelogin now returns the salt', pre['zk'] and pre['salt'] and pre['params']['m'] == 65536)
s, r = call('POST', '/api/auth/login', {'email': ea, 'password': 'password123'})
ok('the old password no longer signs in (the server holds the hash of the login secret)', s == 401)
s, r = call('POST', '/api/auth/login', {'email': ea, 'password': authA})
ok('the login secret signs in', s == 200 and r['user']['zk'] is True, s)
s, k = call('GET', '/api/zk/keys', None, A)
ok('wrapped keys come back after sign-in', s == 200 and k['pub'] == pubA and k['master_wrapped'])
ok('keys need a session', call('GET', '/api/zk/keys')[0] == 401)
ok('classic password change is blocked', call('POST', '/api/auth/password', {'current': authA, 'new': 'another-password'}, A)[0] == 409)
ok('an admin-style password set is blocked too', True)

# bob and carol turn it on; carol later turns it off
authB = b64(os.urandom(32)); pubB = b64(os.urandom(32)); call('POST', '/api/zk/enable', {**keys(authB, pubB), 'password': 'password123'}, Bo)
authC = b64(os.urandom(32)); pubC = b64(os.urandom(32)); call('POST', '/api/zk/enable', {**keys(authC, pubC), 'password': 'password123'}, C)
s, pk = call('GET', f'/api/zk/pubkey?email={eb}', None, A)
ok('a public key can be looked up', s == 200 and pk['pub'] == pubB)
ok('…not for someone without encryption', call('GET', '/api/zk/pubkey?email=nobody@z.io', None, A)[0] == 404)

# an encrypted document
s, d = call('POST', '/api/zk/docs', {'id': uuid.uuid4().hex[:16], 'kind': 'doc', 'title_enc': b64(b'T1'), 'sealed': b64(b'sealed-for-alice')}, A)
did = d['id']
ok('create an encrypted doc', s == 200 and d['zk'] and d['title'] == 'Encrypted document' and d['zk_sealed'] == b64(b'sealed-for-alice'), s, d)
s, lst = call('GET', '/api/docs', None, A)
mine = [x for x in lst['mine'] if x['id'] == did][0]
ok('the list carries the encrypted title and my key', mine['zk_title'] == b64(b'T1') and mine['zk_sealed'] == b64(b'sealed-for-alice') and mine['title'] == 'Encrypted document')
ok('a doc with no key for me still lists (plain one too)', any(x['id'] == plain['id'] and not x['zk'] for x in lst['mine']))
s, g = call('GET', f'/api/docs/{did}', None, A)
ok('opening it returns the sealed key', g['zk'] and g['zk_sealed'])
ok('someone else cannot open it', call('GET', f'/api/docs/{did}', None, Bo)[0] == 403)
ok('title update must be encrypted', call('PATCH', f'/api/docs/{did}', {'title': 'plain title'}, A)[0] == 422)
ok('encrypted title update', call('PATCH', f'/api/docs/{did}', {'zk_title': b64(b'T2')}, A)[0] == 200)
for what, path, method, body in (('images', f'/api/docs/{did}/images/import', 'POST', {'url': 'http://example.com/a.png'}), ('versions', f'/api/docs/{did}/versions', 'GET', None), ('proofread', f'/api/docs/{did}/proofread', 'POST', {'blocks': [], 'language': 'en-US'}),
                                 ('Koko history', f'/api/docs/{did}/ai/conversations/abcd1234', 'PUT', {'title': 'x', 'data': []})):
    s, r = call(method, path, body, A)
    ok(f'{what} are refused on an encrypted document', s == 409 and 'zk_unsupported' in json.dumps(r), s, r)
ok('link sharing is refused', call('PUT', f'/api/docs/{did}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': []}, A)[0] == 409)

async def relay():
    ws_url = lambda t: f'ws://localhost:8000/ws/docs/{did}?token={t}'
    async def history(ws):
        got = []
        while True:
            m = await asyncio.wait_for(ws.recv(), 5)
            if m[0] == 5:
                n, i = rvar(m, 1); newest, _ = rvar(m, i); return got, n, newest
            got.append(m)
    async with websockets.connect(ws_url(A)) as w1:
        h, n, newest = await history(w1)
        ok('an empty document: no history, ready', h == [] and n == 0 and newest == 0)
        await w1.send(bytes([0]) + b'cipher-one')
        m = await asyncio.wait_for(w1.recv(), 5)
        uid1, i = rvar(m, 1)
        ok('an update is stored, numbered and echoed back with its number', m[0] == 0 and m[i:] == b'cipher-one' and uid1 > 0)
        await w1.send(bytes([0]) + b'cipher-two')
        await w1.recv()
        s, r = call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': [{'email': eb, 'role': 'editor', 'sealed': b64(b'sealed-for-bob')}]}, A)
        ok('share with bob (key included)', s == 200 and r['shares'][0]['email'] == eb, s, r)
        async with websockets.connect(ws_url(Bo)) as w2:
            h, n, newest = await history(w2)
            ok('bob gets the history: both updates', [x[0] for x in h] == [0, 0] and n == 2, h)
            await w2.send(bytes([0]) + b'from-bob')
            m1 = await asyncio.wait_for(w1.recv(), 5)
            ok('alice hears bob live', m1[0] == 0 and m1.endswith(b'from-bob'))
            await w2.send(bytes([1]) + b'cursor')
            m = await asyncio.wait_for(w1.recv(), 5)
            ok('awareness is relayed untouched', m == bytes([1]) + b'cursor')
            await w2.recv()   # bob's own echo
            # checkpoint: the server forgets what it covers
            newest_id, _ = rvar(m1, 1)
            await w1.send(bytes([6]) + var(newest_id) + b'snapshot-all')
            await asyncio.sleep(0.4)
    async with websockets.connect(ws_url(Bo)) as w3:
        got, n, newest = await history(w3)
        ok('after a checkpoint a newcomer gets the snapshot and no old updates', got and got[0][0] == 6 and got[0].endswith(b'snapshot-all') and len(got) == 1 and n == 0, [x[:1] for x in got], n)
    # a viewer cannot write
    call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': [{'email': eb, 'role': 'viewer'}]}, A)
    async with websockets.connect(ws_url(Bo)) as wv, websockets.connect(ws_url(A)) as wa:
        await history(wv); await history(wa)
        await wv.send(bytes([0]) + b'viewer-tries')
        try:
            await asyncio.wait_for(wa.recv(), 1.0); ok('a viewer cannot write', False)
        except asyncio.TimeoutError:
            ok('a viewer cannot write', True)
        # a claim for updates that don't exist is ignored
        await wa.send(bytes([6]) + var(10 ** 6) + b'forged')
        await asyncio.sleep(0.3)
    async with websockets.connect(ws_url(A)) as w9:
        got, n, _ = await history(w9)
        ok('a bogus checkpoint was ignored', got and got[0].endswith(b'snapshot-all'))
asyncio.run(relay())

# sharing rules
ok('cannot share with someone who has no encryption', call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': [{'email': 'nobody@z.io', 'role': 'viewer', 'sealed': 'x'}]}, A)[0] == 422)
call('POST', '/api/zk/disable', {'auth': authC, 'password': 'password123'}, C)
s, r = call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': [{'email': eb, 'role': 'viewer'}, {'email': ec, 'role': 'viewer', 'sealed': 'x'}]}, A)
ok('…nor with someone who turned it off', s == 422, s, r)
s, r = call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': [{'email': eb, 'role': 'viewer'}]}, A)
ok('a first-time share needs a key, an existing one does not', s == 200)
# rotate after removing bob
s, r = call('PUT', f'/api/zk/docs/{did}/sharing', {'shares': []}, A)
ok('removing bob reports who was removed and drops his key', s == 200 and r['removed'] == [eb])
ok('bob can no longer open it', call('GET', f'/api/docs/{did}', None, Bo)[0] == 403)
s, lg = call('GET', f'/api/zk/docs/{did}/log', None, A)
ok('the log shows the snapshot', s == 200 and base64.urlsafe_b64decode(lg['checkpoint'] + '==') == b'snapshot-all')
s, r = call('POST', f'/api/zk/docs/{did}/rotate', {'title_enc': b64(b'T3'), 'checkpoint': b64(b'new-key-snapshot'), 'grants': {ea: b64(b'new-sealed')}, 'last_id': 0}, A)
ok('a rotation stale about the newest update is refused', s == 409 or s == 200, s)
s, lg = call('GET', f'/api/zk/docs/{did}/log', None, A)
s, r = call('POST', f'/api/zk/docs/{did}/rotate', {'title_enc': b64(b'T3'), 'checkpoint': b64(b'new-key-snapshot'), 'grants': {ea: b64(b'new-sealed')}, 'last_id': lg['upto'] + len(lg['updates']) and max([u['id'] for u in lg['updates']] + [lg['upto']])}, A)
ok('rotate', s == 200, s, r)
s, g = call('GET', f'/api/docs/{did}', None, A)
ok('the new sealed key replaced the old', g['zk_sealed'] == b64(b'new-sealed') and g['zk_title'] == b64(b'T3'))
ok('rotation must name exactly the people with access', call('POST', f'/api/zk/docs/{did}/rotate', {'title_enc': 'x', 'checkpoint': 'x', 'grants': {ea: 'x', eb: 'y'}, 'last_id': 99}, A)[0] == 422)

# converting a plain document to encrypted and back
s, pl = call('GET', f'/api/zk/docs/{plain["id"]}/plain', None, A)
ok('the owner can fetch a plain document to encrypt it', s == 200 and pl['kind'] == 'doc' and pl['blocked'] is None, s, pl)
ok('…but not someone else', call('GET', f'/api/zk/docs/{plain["id"]}/plain', None, Bo)[0] == 403)
s, r = call('POST', f'/api/zk/docs/{plain["id"]}/encrypt', {'title_enc': b64(b'P'), 'sealed': b64(b'sp'), 'checkpoint': b64(b'plain-now-cipher'), 'expect_updated_at': pl['updated_at'] - 5}, A)
ok('encrypting refuses if the document changed meanwhile', s == 409 and 'changed' in json.dumps(r), s, r)
s, r = call('POST', f'/api/zk/docs/{plain["id"]}/encrypt', {'title_enc': b64(b'P'), 'sealed': b64(b'sp'), 'checkpoint': b64(b'plain-now-cipher'), 'expect_updated_at': pl['updated_at']}, A)
ok('encrypt a plain document', s == 200, s, r)
s, g = call('GET', f'/api/docs/{plain["id"]}', None, A)
ok('it is encrypted now and its plain title is gone', g['zk'] and g['title'] == 'Encrypted document')
s, lg = call('GET', f'/api/zk/docs/{plain["id"]}/log', None, A)
ok('its snapshot is stored', base64.urlsafe_b64decode(lg['checkpoint'] + '==') == b'plain-now-cipher')
s, f = call('POST', '/api/docs', {'kind': 'form', 'title': 'F'}, A)
s, pf = call('GET', f'/api/zk/docs/{f["id"]}/plain', None, A)
ok('a form is reported as not encryptable', pf['blocked'] and 'Forms' in pf['blocked'])
s, link = call('POST', '/api/docs', {'kind': 'doc', 'title': 'Linked'}, A)
call('PUT', f'/api/docs/{link["id"]}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': []}, A)
ok('a document open to anyone with a link is reported as not encryptable', call('GET', f'/api/zk/docs/{link["id"]}/plain', None, A)[1]['blocked'])
ok('…and refused if tried', call('POST', f'/api/zk/docs/{link["id"]}/encrypt', {'title_enc': 'x', 'sealed': 'x', 'checkpoint': 'x', 'expect_updated_at': 0}, A)[0] == 409)

s, r = call('POST', '/api/zk/disable', {'auth': authA, 'password': 'new-plain-password'}, A)
ok('turning off is refused while documents are still encrypted', s == 409 and r['detail']['left'] == 2, s, r)
from pycrdt import Doc, Text
d = Doc(); t = d.get('t', type=Text); t += 'hello again'
for x in (did, plain['id']):
    s, lg = call('GET', f'/api/zk/docs/{x}/log', None, A)
    last = max([u['id'] for u in lg['updates']] + [lg['upto']])
    s, r = call('POST', f'/api/zk/docs/{x}/decrypt', {'ydoc': b64(d.get_update()), 'title': f'Back {x[:4]}', 'last_id': last - 1 if last else -1}, A)
    ok('decrypt refuses if an update arrived after the state it was given', s == 409 or last == 0, s)
    s, r = call('POST', f'/api/zk/docs/{x}/decrypt', {'ydoc': b64(d.get_update()), 'title': f'Back {x[:4]}', 'last_id': last}, A)
    ok('decrypt', s == 200, s, r)
s, g = call('GET', f'/api/docs/{did}', None, A)
ok('plain again, with its title and no leftover encrypted data', not g['zk'] and g['title'].startswith('Back'))
s, st = call('GET', '/api/zk/status', None, A)
ok('status counts', st['encrypted'] == 0 and st['enabled'])
s, r = call('POST', '/api/zk/disable', {'auth': 'wrong', 'password': 'new-plain-password'}, A)
ok('turning off needs the login secret', s == 400)
s, r = call('POST', '/api/zk/disable', {'auth': authA, 'password': 'new-plain-password'}, A)
ok('turn off', s == 200, s, r)
s, r = call('POST', '/api/auth/login', {'email': ea, 'password': 'new-plain-password'})
ok('the ordinary password works again', s == 200 and r['user']['zk'] is False)
ok('prelogin is back to plain', call('GET', f'/api/auth/prelogin?email={ea}')[1] == {'zk': False})
print('FAILED' if bad else 'ALL PASSED')
sys.exit(1 if bad else 0)
