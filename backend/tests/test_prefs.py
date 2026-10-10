"""Per-person settings that follow them between devices (snippets, writing helpers). Server on :8000 with a fresh data dir."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
A = call('POST', '/api/auth/signup', {'email': 'a@pf.io', 'name': 'A', 'password': 'password123'})[1]['token']
UB = call('POST', '/api/auth/signup', {'email': 'b@pf.io', 'name': 'B', 'password': 'password123'})[1]['token']
ok('nothing stored at first', call('GET', '/api/me/prefs', None, A)[1] == {})
ok('needs a sign-in', call('GET', '/api/me/prefs')[0] in (401, 403))
sn = [{'trigger': ';sig', 'text': 'Best,\nAnn'}, {'trigger': ';addr', 'text': '1 Main St'}]
ok('snippets are stored', call('PUT', '/api/me/prefs/snippets', {'value': sn}, A)[0] == 200)
ok('and come back', call('GET', '/api/me/prefs', None, A)[1]['snippets'] == sn)
ok("and are one person's own", call('GET', '/api/me/prefs', None, UB)[1] == {})
ok('a trigger needs 2 or more characters', call('PUT', '/api/me/prefs/snippets', {'value': [{'trigger': ';', 'text': 'x'}]}, A)[0] == 422)
ok('and no spaces', call('PUT', '/api/me/prefs/snippets', {'value': [{'trigger': ';a b', 'text': 'x'}]}, A)[0] == 422)
ok('and no repeats', call('PUT', '/api/me/prefs/snippets', {'value': [{'trigger': ';a', 'text': 'x'}, {'trigger': ';a', 'text': 'y'}]}, A)[0] == 422)
ok('the wrong shape is refused', call('PUT', '/api/me/prefs/snippets', {'value': 'nope'}, A)[0] == 422)
ok('an unknown setting is refused', call('PUT', '/api/me/prefs/other', {'value': 1}, A)[0] == 404)
ok('the writing helpers are stored', call('PUT', '/api/me/prefs/writing', {'value': {'autocomplete': True, 'engine': 'device'}}, A)[0] == 200 and call('GET', '/api/me/prefs', None, A)[1]['writing']['autocomplete'] is True)
ok('too much is refused', call('PUT', '/api/me/prefs/writing', {'value': {'x': 'a' * 70000}}, A)[0] == 413)
ok('an update replaces the old one', call('PUT', '/api/me/prefs/snippets', {'value': []}, A)[0] == 200 and call('GET', '/api/me/prefs', None, A)[1]['snippets'] == [])
