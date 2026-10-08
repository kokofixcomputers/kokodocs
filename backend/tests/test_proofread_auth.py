"""Proofreading needs an account. Server on :8000 with a fresh data dir; run from backend/."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
body = {'blocks': [{'id': 0, 'text': 'I recieve teh mail'}], 'language': 'en-US'}
s, r = call('POST', '/api/proofread', body); ok('signed-out requests are refused', s == 401, (s, r))
s, r = call('POST', '/api/proofread', body, 'not-a-real-token'); ok('a bad token is refused', s == 401, (s, r))
T = call('POST', '/api/auth/signup', {'email': 'p@pf.io', 'name': 'P', 'password': 'password123'})[1]['token']
s, r = call('POST', '/api/proofread', body, T); ok('signed-in people get their issues', s == 200 and len(r['issues']) >= 2, (s, r))
