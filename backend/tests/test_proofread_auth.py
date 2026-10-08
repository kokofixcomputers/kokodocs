"""Proofreading is open to people without an account, but only from our own pages (checked by Origin / Referer). Server on :8000 with a fresh data dir; run from backend/."""
import json, os, urllib.error, urllib.request
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
body = json.dumps({'blocks': [{'id': 0, 'text': 'I recieve teh mail'}], 'language': 'en-US'}).encode()
def post(headers):
    r = urllib.request.Request(B + '/api/proofread', body, {'content-type': 'application/json', **headers}, method='POST')
    try: return 200, json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
host = B.split('//')[1]
s, r = post({'Origin': B}); ok('our own pages can use it without signing in', s == 200 and len(r['issues']) >= 2, (s, r))
s, r = post({'Referer': B + '/d/abc'}); ok('a Referer from our site is enough when there is no Origin', s == 200, (s, r))
ok('no Origin or Referer is refused', post({})[0] == 403)
ok('another website is refused', post({'Origin': 'https://evil.example'})[0] == 403)
ok('a lookalike host is refused', post({'Origin': B + '.evil.example'})[0] == 403 and post({'Origin': 'http://x' + host})[0] == 403)
ok('"null" origin is refused', post({'Origin': 'null'})[0] == 403)
ok('behind a proxy: the forwarded host counts', post({'Origin': 'https://docs.example.com', 'X-Forwarded-Host': 'docs.example.com'})[0] == 200)
ok('...but only if the origin matches it', post({'Origin': 'https://evil.example', 'X-Forwarded-Host': 'docs.example.com'})[0] == 403)
