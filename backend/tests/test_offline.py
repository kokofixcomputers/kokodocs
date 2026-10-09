"""Server on :8000 with a fresh data dir. Client-chosen document ids, /api/ping, and the whole-document state download used by the offline copy."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
import urllib.request
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n)
TA = call('POST', '/api/auth/signup', {'email': 'a@off.io', 'name': 'TA', 'password': 'password123'})[1]['token']
TB = call('POST', '/api/auth/signup', {'email': 'b@off.io', 'name': 'TB', 'password': 'password123'})[1]['token']
ok('ping', call('GET', '/api/ping')[1] == {'ok': True})
s, r = call('POST', '/api/docs', {'id': '0123456789abcdef', 'title': 'Made offline', 'kind': 'doc'}, TA)
ok('client id is used', s == 200 and r['id'] == '0123456789abcdef' and r['title'] == 'Made offline')
s, r2 = call('POST', '/api/docs', {'id': '0123456789abcdef', 'title': 'Again', 'kind': 'doc'}, TA)
ok('creating again is harmless', s == 200 and r2['id'] == r['id'] and r2['title'] == 'Made offline')
ok('only one copy', len([d for d in call('GET', '/api/docs', None, TA)[1]['mine'] if d['id'] == r['id']]) == 1)
s, _ = call('POST', '/api/docs', {'id': '0123456789abcdef', 'title': 'Steal', 'kind': 'doc'}, TB)
ok("someone else's id is refused", s == 409)
s, _ = call('POST', '/api/docs', {'id': 'not-hex', 'title': 'x'}, TA); ok('bad id refused', s == 422)
def raw(path, tok):
    req = urllib.request.Request('http://127.0.0.1:8000' + path, headers={'Authorization': f'Bearer {tok}'} if tok else {})
    try:
        with urllib.request.urlopen(req) as x: return x.status, x.read()
    except urllib.error.HTTPError as e: return e.code, b''
s, b = raw(f"/api/docs/{r['id']}/state", TA); ok('state downloads', s == 200 and isinstance(b, bytes))
s, _ = raw(f"/api/docs/{r['id']}/state", TB); ok('state needs access', s in (401, 403))
s, _ = raw(f"/api/docs/{r['id']}/state", None); ok('state needs sign-in', s in (401, 403))
