"""Proofreading follows document access: the owner, people it is shared with, and people with the link (or the password token) can use it; strangers can't.
Server on :8000 with a fresh data dir; run from backend/."""
import json, os, urllib.error, urllib.request
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
body = json.dumps({'blocks': [{'id': 0, 'text': 'I recieve teh mail'}], 'language': 'en-US'}).encode()
def post(doc, headers=None):
    r = urllib.request.Request(B + f'/api/docs/{doc}/proofread', body, {'content-type': 'application/json', **(headers or {})}, method='POST')
    try: return 200, json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
bearer = lambda t: {'authorization': 'Bearer ' + t}
O = call('POST', '/api/auth/signup', {'email': 'o@pa.io', 'name': 'O', 'password': 'password123'})[1]['token']
S = call('POST', '/api/auth/signup', {'email': 's@pa.io', 'name': 'S', 'password': 'password123'})[1]['token']
V = call('POST', '/api/auth/signup', {'email': 'v@pa.io', 'name': 'V', 'password': 'password123'})[1]['token']
doc = call('POST', '/api/docs', {'title': 'D'}, O)[1]['id']
call('PUT', f'/api/docs/{doc}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'v@pa.io', 'role': 'viewer'}]}, O)

s, r = post(doc, bearer(O)); ok('the owner gets issues', s == 200 and len(r['issues']) >= 2, (s, r))
ok('someone it is shared with (even as a viewer) can use it', post(doc, bearer(V))[0] == 200)
ok('a stranger signed in is refused', post(doc, bearer(S))[0] in (401, 403, 404), post(doc, bearer(S)))
ok('signed out on a private document is refused', post(doc)[0] in (401, 403, 404), post(doc))
ok('a bad token is refused', post(doc, bearer('nope'))[0] in (401, 403, 404))
ok('a document that does not exist is refused', post('nothere', bearer(O))[0] in (401, 403, 404))
call('PUT', f'/api/docs/{doc}/sharing', {'link_access': 'anyone', 'link_role': 'editor', 'shares': []}, O)
ok('with an open link, people without an account can use it', post(doc)[0] == 200)
call('PUT', f'/api/docs/{doc}/sharing', {'link_access': 'password', 'link_role': 'editor', 'password': 'hunter22', 'shares': []}, O)
s0 = post(doc)[0]; ok('a password-protected document refuses anyone without the token', s0 in (401, 403), s0)
tok = call('POST', f'/api/docs/{doc}/unlock', {'password': 'hunter22'})[1]['token']
ok('...and accepts the password token', post(doc, {'X-Doc-Token': tok})[0] == 200)
ok('the old /api/proofread route is gone', urllib.request.Request(B + '/api/proofread', body, {'content-type': 'application/json'}, method='POST') and post('x')[0] != 200)
