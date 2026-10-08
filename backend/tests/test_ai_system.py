"""A system-wide assistant connection set by the admin: everyone uses it by default; with none, people bring their own; people with their own can choose.
Server on :8000 with a fresh data dir and NO KOKO_AI_URL; the mock model server on :8765 (tests/mock_llm.py) running. Run from backend/."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
MOCK = 'http://127.0.0.1:8765/v1'
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@sy.io', 'name': 'U', 'password': 'password123'})[1]['token']
OWN = call('POST', '/api/auth/signup', {'email': 'own@sy.io', 'name': 'Own', 'password': 'password123'})[1]['token']
mine = lambda t: call('GET', '/api/ai/settings', None, t)[1]
admin = lambda: call('GET', '/api/admin/settings', None, A)[1]['ai']
put = lambda b, t=A: call('PUT', '/api/admin/settings', b, t)
chat = lambda t: call('POST', '/api/ai/chat', {'messages': [{'role': 'user', 'content': 'SAY: hi'}]}, t, raw=True)[0] if False else None

ok('nothing is configured to begin with', mine(U)['configured'] is False and admin()['active']['available'] is False)
ok('only admins can set it', put({'ai_url': MOCK}, U)[0] in (401, 403))
ok('an address that is not http(s) is refused', put({'ai_url': 'ftp://x.example.com/v1'})[0] == 422)
s, r = put({'ai_url': MOCK, 'ai_model': 'mock-large', 'ai_key': 'sk-test'})
ok('the admin sets it', s == 200 and r['ai']['url'].startswith('http') and r['ai']['model'] == 'mock-large' and r['ai']['key_set'] is True and r['ai']['active']['from'] == 'admin', (s, r.get('ai')))
ok('the key is never sent back', 'sk-test' not in str(call('GET', '/api/admin/settings', None, A)[1]))
import sqlite3
raw = sqlite3.connect(os.environ.get('KOKO_DATA_DIR', 'data') + '/kokodocs.sqlite3').execute("select value from app_settings where key = 'ai_sys_key'").fetchone()
ok('and it is encrypted at rest', raw and 'sk-test' not in raw[0] and raw[0].startswith('gAAAA'), raw)
v = mine(U)
ok('everyone now has an assistant without doing anything', v['configured'] and v['source'] == 'server' and v['system']['available'] and v['own_saved'] is False and v['use_own'] is False, v)
ok('they are not shown the key or the full address, just the model and host', 'sk-test' not in str(v) and v['system']['model'] == 'mock-large' and v['system']['host'] == '127.0.0.1')
s, r = call('GET', '/api/ai/models', None, U); ok('they can list models through it', s == 200 and 'mock-large' in r['models'], (s, r))
s, r = call('POST', '/api/admin/ai/test', {}, A); ok('the admin can test it', s == 200 and r['ok'] and 'mock-large' in r['models'], (s, r))
ok('only admins can test it', call('POST', '/api/admin/ai/test', {}, U)[0] in (401, 403))

# someone who brings their own
s, r = call('PUT', '/api/ai/settings', {'base_url': MOCK, 'model': 'mock-small', 'api_key': 'sk-mine'}, OWN)
ok('saving your own connection makes you use it', s == 200 and r['source'] == 'user' and r['use_own'] and r['own_saved'] and r['model'] == 'mock-small' and r['key_hint'] == '…mine', r)
s, r = call('PUT', '/api/ai/source', {'use': 'system'}, OWN)
ok('they can switch back to the system one and keep their own saved', s == 200 and r['source'] == 'server' and r['own_saved'] and r['use_own'] is False and r['model'] == 'mock-small', r)
s, r = call('PUT', '/api/ai/source', {'use': 'own'}, OWN); ok('and back again', s == 200 and r['source'] == 'user' and r['use_own'])
ok('choosing "own" with nothing saved is refused', call('PUT', '/api/ai/source', {'use': 'own'}, U)[0] == 409)
ok('choosing "system" works for someone with no own', call('PUT', '/api/ai/source', {'use': 'system'}, U)[0] == 200)
call('PUT', '/api/ai/source', {'use': 'system'}, OWN)
ok('removing your own keeps you on the system one', call('DELETE', '/api/ai/settings', None, OWN)[1]['source'] == 'server')

# switching it off for everyone
s, r = put({'ai_enabled': False}); ok('the admin can stop offering it', s == 200 and r['ai']['enabled'] is False and r['ai']['active']['available'] is False and r['ai']['url'] != '', r.get('ai'))
ok('then people without their own have none', mine(U)['configured'] is False and mine(U)['system']['available'] is False)
call('PUT', '/api/ai/settings', {'base_url': MOCK, 'model': 'mock-small', 'api_key': 'sk-mine'}, OWN)
ok('and people with their own are unaffected', mine(OWN)['configured'] and mine(OWN)['source'] == 'user')
put({'ai_enabled': True}); ok('switching it back on restores it for everyone', mine(U)['configured'] and mine(U)['source'] == 'server')
s, r = put({'ai_clear_key': True}); ok('the key can be removed', s == 200 and r['ai']['key_set'] is False)
s, r = put({'ai_url': ''}); ok('and the whole connection cleared', s == 200 and r['ai']['active']['available'] is False and mine(U)['configured'] is False)
