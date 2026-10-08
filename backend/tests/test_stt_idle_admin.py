"""Whether speech models are dropped from memory when idle, and after how long, is set in the admin dashboard. Server on :8000 with a fresh data dir; run from backend/."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@id.io', 'name': 'U', 'password': 'password123'})[1]['token']
view = lambda: call('GET', '/api/admin/settings', None, A)[1]['stt']
put = lambda b, t=A: call('PUT', '/api/admin/settings', b, t)

v = view(); ok('by default models are dropped after 3 minutes', v['idle_unload'] is True and v['idle_minutes'] == 3, v)
ok('the admin sees which models are in memory', isinstance(v['loaded'], list))
s, r = put({'stt_idle_minutes': 10}); ok('the time can be changed', s == 200 and view()['idle_minutes'] == 10, (s, r))
s, r = put({'stt_idle_unload': False}); ok('unloading can be switched off', s == 200 and view()['idle_unload'] is False, (s, r))
ok('the time is kept while it is off', view()['idle_minutes'] == 10)
put({'stt_idle_unload': True}); ok('and on again', view()['idle_unload'] is True and view()['idle_minutes'] == 10)
ok('0 minutes is refused', put({'stt_idle_minutes': 0})[0] == 422)
ok('more than a day is refused', put({'stt_idle_minutes': 5000})[0] == 422)
ok('only admins can change it', put({'stt_idle_unload': False}, U)[0] in (401, 403) and view()['idle_unload'] is True)
