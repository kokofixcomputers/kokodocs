"""Server on :8000 with a fresh data dir."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n)
TA = call('POST', '/api/auth/signup', {'email': 'a@star.io', 'name': 'TA', 'password': 'password123'})[1]['token']
TB = call('POST', '/api/auth/signup', {'email': 'b@star.io', 'name': 'TB', 'password': 'password123'})[1]['token']
d1 = call('POST', '/api/docs', {'title': 'One', 'kind': 'doc'}, TA)[1]['id']; d2 = call('POST', '/api/docs', {'title': 'Two', 'kind': 'sheet'}, TA)[1]['id']
ok('not starred by default', all(not d['starred'] for d in call('GET', '/api/docs', None, TA)[1]['mine']))
s, r = call('PUT', f'/api/docs/{d1}/star', None, TA); ok('star works', s == 200 and r['starred'])
ok('listed as starred', [d['starred'] for d in call('GET', '/api/docs', None, TA)[1]['mine'] if d['id'] == d1] == [True])
s, _ = call('PUT', f'/api/docs/{d1}/star', None, TB); ok('cannot star a file you cannot open', s in (401, 403))
call('PUT', f'/api/docs/{d2}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'b@star.io', 'role': 'viewer'}]}, TA)
call('PUT', f'/api/docs/{d2}/star', None, TB); ok('stars are per person', not any(d['starred'] for d in call('GET', '/api/docs', None, TA)[1]['mine'] if d['id'] == d2))
bshared = call('GET', '/api/docs', None, TB)[1]['shared']; ok('shared file shows my star', bshared and bshared[0]['starred'] is True)
s, r = call('DELETE', f'/api/docs/{d1}/star', None, TA); ok('unstar', s == 200 and not any(d['starred'] for d in call('GET', '/api/docs', None, TA)[1]['mine'] if d['id'] == d1))
ok('recent empty at first', call('GET', '/api/recent', None, TB)[1] == [])
call('GET', f'/api/docs/{d2}', None, TB); call('GET', f'/api/docs/{d1}', None, TA); call('GET', f'/api/docs/{d2}', None, TA)
rb = call('GET', '/api/recent', None, TB)[1]; ok('opening a file records it', [d['id'] for d in rb] == [d2])
ra = call('GET', '/api/recent', None, TA)[1]; ok('most recent first', [d['id'] for d in ra] == [d2, d1], str([d['title'] for d in ra]))
call('PUT', f'/api/docs/{d2}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': []}, TA)
ok('unshared files drop out of recent', call('GET', '/api/recent', None, TB)[1] == [])
call('DELETE', f'/api/docs/{d1}', None, TA); ok('deleted files drop out of recent', [d['id'] for d in call('GET', '/api/recent', None, TA)[1]] == [d2])
