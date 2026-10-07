"""Self-service account deletion (run with a fresh server on :8000). See the checks in the session log; mirrors test_quota helpers."""
src = open(__file__.replace('test_delete_account', 'test_quota')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c: print(('PASS ' if c else 'FAIL ') + n)
_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'K', 'password': 'password123'}); A = a['token']
_, u = call('POST', '/api/auth/signup', {'email': 'del@x.io', 'name': 'D', 'password': 'password123'}); U = u['token']
_, d = call('POST', '/api/docs', {'title': 'bye', 'kind': 'doc'}, U); upload(d['id'], U, png())
s, _ = call('POST', '/api/auth/delete', {'email': 'wrong@x.io', 'password': 'password123'}, U); ok('wrong email refused', s == 400)
s, _ = call('POST', '/api/auth/delete', {'email': 'del@x.io', 'password': 'nope'}, U); ok('wrong password refused', s == 400)
s, _ = call('POST', '/api/auth/delete', {'email': 'koko@kokodev.cc', 'password': 'password123'}, A); ok('built-in admin protected', s == 400)
s, _ = call('POST', '/api/auth/delete', {'email': 'del@x.io', 'password': 'password123'}, U); ok('deleted', s == 200)
s, _ = call('POST', '/api/auth/login', {'email': 'del@x.io', 'password': 'password123'}); ok('cannot sign in again', s == 401)
s, r = call('GET', '/api/admin/files', None, A); ok('docs gone', not any(x['id'] == d['id'] for x in r))
