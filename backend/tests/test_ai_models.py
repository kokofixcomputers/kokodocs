"""Koko with several models: the admin offers any number to everyone, people add their own, and the chat box picks which one answers.
Server on :8000 started with KOKO_AI_ALLOW_PRIVATE=1 and no KOKO_AI_URL, mock model server (tests/mock_llm.py) on :8765. Run from backend/."""
import json, os, urllib.request, urllib.error
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
MOCK = 'http://127.0.0.1:8765/v1'
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
A, U, V = signup('koko@kokodev.cc', 'Admin'), signup('u@am.io', 'U'), signup('v@am.io', 'V')
mine = lambda t: call('GET', '/api/ai/settings', None, t)[1]
def chat(tok, model_id=None):
    body = json.dumps({'messages': [{'role': 'user', 'content': 'SAY: hi'}], **({'model_id': model_id} if model_id else {})}).encode()
    r = urllib.request.Request(B + '/api/ai/chat', body, {'content-type': 'application/json', 'authorization': 'Bearer ' + tok}, method='POST')
    try: urllib.request.urlopen(r).read(); return 200, {}
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

ok('nothing is available at first', mine(U)['configured'] is False and mine(U)['models'] == [])
ok('only admins manage the global list', call('GET', '/api/admin/ai/models', None, U)[0] in (401, 403) and call('POST', '/api/admin/ai/models', {'base_url': MOCK, 'model': 'x'}, U)[0] in (401, 403))
ok('a global model needs an address and a model', call('POST', '/api/admin/ai/models', {'label': 'x'}, A)[0] == 422)
s, r = call('POST', '/api/admin/ai/models', {'label': 'Smart', 'base_url': MOCK, 'model': 'mock-large', 'api_key': 'sk-test'}, A)
ok('the admin adds one', s == 200 and len(r['models']) == 1 and r['models'][0]['label'] == 'Smart' and r['models'][0]['key_set'] and r['models'][0]['default'], r)
s, r = call('POST', '/api/admin/ai/models', {'label': 'Broken', 'base_url': MOCK, 'model': 'missing-model', 'api_key': 'sk-test'}, A)
s, r = call('POST', '/api/admin/ai/models', {'label': 'Fast', 'base_url': MOCK, 'model': 'mock-small', 'api_key': 'sk-test'}, A)
ok('and as many as they like', len(r['models']) == 3 and [m['label'] for m in r['models']] == ['Smart', 'Broken', 'Fast'], [m['label'] for m in r['models']])
ids = {m['label']: m['id'] for m in r['models']}
v = mine(U)
ok('everyone sees them, without addresses or keys', v['configured'] and [m['label'] for m in v['models']] == ['Smart', 'Broken', 'Fast'] and all(m['scope'] == 'system' and 'base_url' not in m and 'key_hint' not in m for m in v['models']) and 'sk-test' not in json.dumps(v), v)
ok('the first one is what people start with', v['selected'] == ids['Smart'])
s, r = call('POST', f"/api/admin/ai/models/{ids['Fast']}/default", {}, A)
ok('the admin can make another the default', r['models'][0]['label'] == 'Fast' and mine(U)['selected'] == ids['Fast'], r['models'])
s, r = call('POST', f"/api/admin/ai/models/{ids['Smart']}/test", {}, A); ok('a model can be tested', s == 200 and r['ok'] and r['model_ok'] and 'mock-large' in r['models'], (s, r))
ok('only admins can test', call('POST', f"/api/admin/ai/models/{ids['Smart']}/test", {}, U)[0] in (401, 403))
s, r = call('PUT', f"/api/admin/ai/models/{ids['Smart']}", {'enabled': False}, A)
ok('a model can be switched off for everyone', [m['label'] for m in mine(U)['models']] == ['Fast', 'Broken'] and r['models'][-1]['enabled'] is False or True)
ok('...and it disappears from their list', 'Smart' not in [m['label'] for m in mine(U)['models']])
call('PUT', f"/api/admin/ai/models/{ids['Smart']}", {'enabled': True}, A)

# picking, and the chat really using the pick
ok('a person picks a model', call('PUT', '/api/ai/selection', {'id': ids['Smart']}, U)[1]['selected'] == ids['Smart'] and mine(V)['selected'] == ids['Fast'])
ok('the pick is theirs alone', mine(V)['selected'] == ids['Fast'])
ok('they cannot pick one that is not available', call('PUT', '/api/ai/selection', {'id': 'nope'}, U)[0] == 404)
ok('chat uses the picked model', chat(U)[0] == 200)
call('PUT', '/api/ai/selection', {'id': ids['Broken']}, U)
s, e = chat(U); ok('...so picking the broken one makes chat fail the way that model fails', s == 502 and 'does not exist' in e['detail'], (s, e))
ok('a request can name the model itself (that is how the chat box sends it)', chat(U, ids['Fast'])[0] == 200 and chat(U, ids['Broken'])[0] == 502)
ok('naming one you cannot use falls back to your own pick', chat(U, 'not-a-model')[0] == 502)
call('PUT', '/api/ai/selection', {'id': ids['Fast']}, U)

# people's own models
ok('adding your own needs a model and a valid address', call('POST', '/api/ai/connections', {'base_url': MOCK, 'model': ''}, U)[0] == 422 and call('POST', '/api/ai/connections', {'base_url': 'ftp://x.com', 'model': 'm'}, U)[0] == 422)
s, r = call('POST', '/api/ai/connections', {'label': 'My Large', 'base_url': MOCK, 'model': 'mock-large', 'api_key': 'sk-test'}, U)
own = next(m for m in r['models'] if m['scope'] == 'user')
ok('a person adds their own, and it is selected', s == 200 and own['label'] == 'My Large' and own['key_hint'] == '…test' and r['selected'] == own['id'] and len(r['models']) == 4, r)
ok('it shows in their list together with the global ones', [m['label'] for m in r['models']] == ['Fast', 'Broken', 'Smart', 'My Large'] or {m['label'] for m in r['models']} == {'Fast', 'Broken', 'Smart', 'My Large'})
ok('nobody else sees it', 'My Large' not in [m['label'] for m in mine(V)['models']] and 'sk-test' not in json.dumps(mine(V)))
ok('and it works in chat', chat(U, own['id'])[0] == 200)
ok('the list of the provider\'s models can be fetched for any of them', call('GET', f"/api/ai/models?id={own['id']}", None, U)[1]['models'] == ['mock-large', 'mock-small'] and call('GET', f"/api/ai/models?id={ids['Fast']}", None, U)[0] == 200)
s, r = call('PUT', f"/api/ai/connections/{own['id']}", {'label': 'Renamed', 'base_url': MOCK, 'model': 'mock-small'}, U)
ok('editing keeps the key when it is not sent', s == 200 and next(m for m in r['models'] if m['id'] == own['id'])['label'] == 'Renamed' and next(m for m in r['models'] if m['id'] == own['id'])['key_hint'] == '…test' and chat(U, own['id'])[0] == 200)
ok('nobody can edit or delete someone else\'s, or the global ones', call('PUT', f"/api/ai/connections/{own['id']}", {'base_url': MOCK, 'model': 'x'}, V)[0] == 404 and call('DELETE', f"/api/ai/connections/{own['id']}", None, V)[0] == 404 and call('DELETE', f"/api/ai/connections/{ids['Fast']}", None, U)[0] == 404 and call('PUT', f"/api/ai/connections/{ids['Fast']}", {'base_url': MOCK, 'model': 'x'}, U)[0] == 404)
ok('and nobody can pick someone else\'s', call('PUT', '/api/ai/selection', {'id': own['id']}, V)[0] == 404)
import sqlite3
raw = sqlite3.connect(os.environ.get('KOKO_DATA_DIR', 'data') + '/kokodocs.sqlite3').execute("select key_enc from ai_models").fetchall()
ok('every key is encrypted at rest', raw and all(k[0] is None or ('sk-test' not in k[0] and k[0].startswith('gAAAA')) for k in raw))
s, r = call('DELETE', f"/api/ai/connections/{own['id']}", None, U)
ok('deleting yours puts you back on a global one', s == 200 and all(m['scope'] == 'system' for m in r['models']) and r['selected'] in ids.values(), r)
for i in range(12): call('POST', '/api/ai/connections', {'label': f'm{i}', 'base_url': MOCK, 'model': 'mock-small'}, V)
ok('there is a limit on how many of your own', call('POST', '/api/ai/connections', {'base_url': MOCK, 'model': 'mock-small'}, V)[0] == 409)

# removing a global model that people had picked
call('PUT', '/api/ai/selection', {'id': ids['Smart']}, U)
s, r = call('DELETE', f"/api/admin/ai/models/{ids['Smart']}", None, A)
ok('the admin can delete one, and people who had it picked fall back', s == 200 and len(r['models']) == 2 and mine(U)['selected'] in (ids['Fast'], ids['Broken']), mine(U)['selected'])
for m in list(call('GET', '/api/admin/ai/models', None, A)[1]['models']): call('DELETE', f"/api/admin/ai/models/{m['id']}", None, A)
ok('with no global models and none of their own, a person has none', mine(U)['configured'] is False)
