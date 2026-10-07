"""Server on :8000 with a fresh data dir (backend/data)."""
import os, sqlite3, time
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
from pycrdt import Array, Doc, Map
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n)
DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'kokodocs.sqlite3')
TA = call('POST', '/api/auth/signup', {'email': 'a@form.io', 'name': 'FA', 'password': 'password123'})[1]['token']
TB = call('POST', '/api/auth/signup', {'email': 'b@form.io', 'name': 'FB', 'password': 'password123'})[1]['token']
TC = call('POST', '/api/auth/signup', {'email': 'c@form.io', 'name': 'FC', 'password': 'password123'})[1]['token']
fid = call('POST', '/api/docs', {'kind': 'form'}, TA)[1]['id']
ok('form created with a form title', call('GET', f'/api/docs/{fid}', None, TA)[1]['title'] == 'Untitled form')

def put_form(items, meta=None):
    d = Doc(); d['meta'] = m = Map(); d['order'] = o = Array(); d['items'] = im = Map()
    for k, v in (meta or {}).items(): m[k] = v
    for it in items:
        o.append(it['id']); im[it['id']] = {k: v for k, v in it.items() if k != 'id'}
    with sqlite3.connect(DB) as c: c.execute('UPDATE documents SET ydoc = ? WHERE id = ?', (d.get_update(), fid))
put_form([
    {'id': 'n', 'type': 'short', 'title': 'Name', 'required': True, 'minLen': 2, 'maxLen': 10},
    {'id': 'p', 'type': 'page', 'title': 'Page 2'},
    {'id': 'e', 'type': 'email', 'title': 'Email'},
    {'id': 'a', 'type': 'number', 'title': 'Age', 'min': 18, 'max': 99, 'integer': True},
    {'id': 'c', 'type': 'radio', 'title': 'Colour', 'options': ['Red', 'Blue'], 'required': True},
    {'id': 't', 'type': 'checkbox', 'title': 'Tags', 'options': ['x', 'y', 'z'], 'minSel': 1, 'maxSel': 2},
    {'id': 's', 'type': 'select', 'title': 'Size', 'options': ['S', 'M']},
    {'id': 'k', 'type': 'short', 'title': 'Code', 'pattern': '^[A-Z]{3}$', 'patternMsg': 'Three capitals'},
    {'id': 'd', 'type': 'date', 'title': 'Day', 'min': '2020-01-01', 'max': '2030-01-01'},
    {'id': 'g', 'type': 'scale', 'title': 'Rate', 'scaleMin': 1, 'scaleMax': 5},
    {'id': 'h', 'type': 'section', 'title': 'Just text'},
], {'description': 'Hello', 'confirmation': 'Thanks!'})

s, f = call('GET', f'/api/forms/{fid}', None, TA); ok('owner reads the schema', s == 200 and len(f['items']) == 11 and f['description'] == 'Hello' and f['accepting'])
ok('stranger cannot read', call('GET', f'/api/forms/{fid}', None, TB)[0] == 403)
ok('anonymous gets login_required', call('GET', f'/api/forms/{fid}')[0] == 401)
good = {'n': 'Alice', 'c': 'Red', 'e': 'a@b.co', 'a': '30', 't': ['x'], 's': 'M', 'k': 'ABC', 'd': '2024-05-05', 'g': 4}
ok('stranger cannot submit', call('POST', f'/api/forms/{fid}/responses', {'answers': good}, TB)[0] == 403)

# share with B as viewer => B fills out. link editing is not possible.
call('PUT', f'/api/docs/{fid}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'b@form.io', 'role': 'viewer'}, {'email': 'c@form.io', 'role': 'editor'}]}, TA)
ok('viewer can read the form', call('GET', f'/api/forms/{fid}', None, TB)[0] == 200)
s, r = call('POST', f'/api/forms/{fid}/responses', {'answers': good}, TB); ok('viewer can submit', s == 200, str(r))
ok('viewer cannot see responses', call('GET', f'/api/forms/{fid}/responses', None, TB)[0] == 403)
ok('viewer cannot edit title', call('PATCH', f'/api/docs/{fid}', {'title': 'x'}, TB)[0] == 403)
ok('editor sees responses', len(call('GET', f'/api/forms/{fid}/responses', None, TC)[1]['responses']) == 1)

def bad(over, key, msg=None):
    s, r = call('POST', f'/api/forms/{fid}/responses', {'answers': {**good, **over}}, TB)
    return s == 422 and key in r['detail']['errors'] and (msg is None or msg in r['detail']['errors'][key])
ok('required missing', bad({'n': ''}, 'n', 'required'))
ok('min length', bad({'n': 'A'}, 'n', 'at least 2'))
ok('max length', bad({'n': 'A' * 11}, 'n', 'at most 10'))
ok('bad email', bad({'e': 'nope'}, 'e'))
ok('number below min', bad({'a': '5'}, 'a', 'at least 18'))
ok('number not whole', bad({'a': '20.5'}, 'a', 'whole'))
ok('number text', bad({'a': 'abc'}, 'a'))
ok('radio not an option', bad({'c': 'Green'}, 'c'))
ok('too few checks', bad({'t': []}, 't') is False and True)  # empty & optional is fine
ok('too many checks', bad({'t': ['x', 'y', 'z']}, 't', 'at most 2'))
ok('unknown checkbox', bad({'t': ['q']}, 't'))
ok('select not an option', bad({'s': 'XL'}, 's'))
ok('pattern mismatch uses custom message', bad({'k': 'abc'}, 'k', 'Three capitals'))
ok('date out of range', bad({'d': '2040-01-01'}, 'd', 'on or before'))
ok('scale out of range', bad({'g': 9}, 'g'))
ok('answers must be an object', call('POST', f'/api/forms/{fid}/responses', {'answers': []}, TB)[0] == 422)
ok('unknown ids are dropped', call('POST', f'/api/forms/{fid}/responses', {'answers': {**good, 'zzz': 'x'}}, TB)[0] == 200)
rows = call('GET', f'/api/forms/{fid}/responses', None, TC)[1]['responses']
ok('stored cleanly', len(rows) == 3 and 'zzz' not in rows[0]['answers'] and rows[0]['email'] == 'b@form.io')

# link access: anyone with link => anonymous can fill; link cannot grant edit
s, sh = call('PUT', f'/api/docs/{fid}/sharing', {'link_access': 'anyone', 'link_role': 'editor', 'shares': []}, TA)
ok('link role forced to viewer', sh['link_role'] == 'viewer')
ok('anonymous reads via link', call('GET', f'/api/forms/{fid}')[0] == 200)
ok('anonymous cannot edit via link', call('PATCH', f'/api/docs/{fid}', {'title': 'hack'})[0] in (401, 403))
ok('anonymous cannot see responses', call('GET', f'/api/forms/{fid}/responses')[0] in (401, 403))
ok('info says link is viewer', call('GET', f'/api/docs/{fid}')[1]['role'] == 'viewer')
ok('anonymous submits', call('POST', f'/api/forms/{fid}/responses', {'answers': good})[0] == 200)

# settings
put_form([{'id': 'n', 'type': 'short', 'title': 'Name'}], {'requireLogin': True})
ok('requireLogin blocks anonymous', call('POST', f'/api/forms/{fid}/responses', {'answers': {'n': 'x'}})[0] == 401)
ok('requireLogin allows signed in', call('POST', f'/api/forms/{fid}/responses', {'answers': {'n': 'x'}}, TB)[0] == 200)
put_form([{'id': 'n', 'type': 'short', 'title': 'Name'}], {'oneResponse': True})
ok('one response: first', call('POST', f'/api/forms/{fid}/responses', {'answers': {'n': 'x'}}, TC)[0] == 200)
s, r = call('POST', f'/api/forms/{fid}/responses', {'answers': {'n': 'x'}}, TC); ok('one response: second blocked', s == 409)
ok('submitted flag', call('GET', f'/api/forms/{fid}', None, TC)[1]['submitted'] is True)
put_form([{'id': 'n', 'type': 'short', 'title': 'Name'}], {'accepting': False})
ok('closed form rejects', call('POST', f'/api/forms/{fid}/responses', {'answers': {'n': 'x'}}, TB)[0] == 403)

# colour question and accent colour
put_form([{'id': 'c', 'type': 'color', 'title': 'Favourite colour', 'required': True}], {'accent': '#1f6feb'})
ok('accent colour reaches fillers', call('GET', f'/api/forms/{fid}', None, TA)[1]['accent'] == '#1f6feb')
put_form([{'id': 'c', 'type': 'color', 'title': 'Favourite colour', 'required': True}], {'accent': 'red;background:url(x)'})
ok('an invalid accent is never passed on', call('GET', f'/api/forms/{fid}', None, TA)[1]['accent'] == '')
s, r = call('POST', f'/api/forms/{fid}/responses', {'answers': {'c': '#ABCDEF'}}, TB); ok('colour answer accepted', s == 200, r)
ok('stored in lower case', call('GET', f'/api/forms/{fid}/responses', None, TA)[1]['responses'][0]['answers']['c'] == '#abcdef')
for bad_value in ('blue', '#12345', '#12345g', 'javascript:alert(1)', 42):
    ok(f'colour {bad_value!r} rejected', call('POST', f'/api/forms/{fid}/responses', {'answers': {'c': bad_value}}, TB)[0] == 422)
ok('required colour enforced', call('POST', f'/api/forms/{fid}/responses', {'answers': {}}, TB)[0] == 422)

# media blocks: hostile links are blanked before they reach fillers
put_form([{'id': 'm1', 'type': 'media', 'media': 'image', 'src': 'javascript:alert(1)'}, {'id': 'm2', 'type': 'media', 'media': 'video', 'src': 'https://youtu.be/dQw4w9WgXcQ'}, {'id': 'm3', 'type': 'media', 'media': 'image', 'src': 'data:text/html,x'}, {'id': 'm4', 'type': 'media', 'media': 'image', 'src': '/api/images/' + 'a' * 32 + '.png'}])
its = {i['id']: i['src'] for i in call('GET', f'/api/forms/{fid}', None, TA)[1]['items']}
ok('media src sanitised', its['m1'] == '' and its['m3'] == '' and its['m2'].startswith('https://youtu.be') and its['m4'].startswith('/api/images/'))
call('POST', f'/api/forms/{fid}/responses', {'answers': {'m2': 'x'}}, TA)
ok('media blocks take no answers', call('GET', f'/api/forms/{fid}/responses', None, TA)[1]['responses'][0]['answers'] == {})

# logic parity with frontend/src/forms/flow.ts
import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app.forms import compute_flow, validate_all
Q = lambda id, type, **o: {'id': id, 'type': type, 'title': id, **o}
vis = lambda items, a: ','.join(sorted(compute_flow(items, a)))
SI = lambda match, *rules: {'match': match, 'rules': [{'q': q, 'op': op, 'v': v} for q, op, v in rules]}
L1 = [Q('a', 'radio', options=['yes', 'no']), Q('b', 'short', showIf=SI('all', ('a', 'is', 'yes')))]
ok('logic: showIf is', vis(L1, {'a': 'yes'}) == 'a,b' and vis(L1, {'a': 'no'}) == 'a' and vis(L1, {}) == 'a')
L2 = [Q('a', 'checkbox', options=['x', 'y']), Q('b', 'short', showIf=SI('all', ('a', 'is', 'y'))), Q('c', 'short', showIf=SI('all', ('b', 'filled', '')))]
ok('logic: checkbox + chains', vis(L2, {'a': ['x', 'y'], 'b': 'hi'}) == 'a,b,c' and vis(L2, {'a': ['x'], 'b': 'hi'}) == 'a')
L3 = [Q('n', 'number'), Q('b', 'short', showIf=SI('any', ('n', 'gt', '10'), ('n', 'lt', '0')))]
ok('logic: numeric any-of', vis(L3, {'n': '11'}) == 'b,n' and vis(L3, {'n': '-1'}) == 'b,n' and vis(L3, {'n': '5'}) == 'n' and vis(L3, {'n': 'abc'}) == 'n')
L4 = [Q('t', 'short'), Q('b', 'short', showIf=SI('all', ('t', 'contains', 'KO'), ('t', 'isnot', 'koko')))]
ok('logic: contains/isnot', vis(L4, {'t': 'kokos'}) == 'b,t' and vis(L4, {'t': 'koko'}) == 't')
ok('logic: deleted source ignored', vis([Q('b', 'short', showIf=SI('all', ('gone', 'is', 'x')))], {}) == 'b')
P = [Q('a', 'radio', options=['one', 'two', 'end'], jumps={'two': 'p3', 'end': 'submit'}), Q('p2', 'page'), Q('x', 'short'), Q('p3', 'page'), Q('y', 'short')]
ok('logic: jumps', vis(P, {'a': 'one'}) == 'a,x,y' and vis(P, {'a': 'two'}) == 'a,y' and vis(P, {'a': 'end'}) == 'a' and vis(P, {}) == 'a,x,y')
P2 = [Q('a', 'radio', options=['s']), Q('p2', 'page', showIf=SI('all', ('a', 'is', 'zzz'))), Q('x', 'short'), Q('p3', 'page'), Q('y', 'short')]
ok('logic: hidden page', vis(P2, {'a': 's'}) == 'a,y')
ok('logic: all-hidden page', vis([Q('a', 'radio', options=['s']), Q('p2', 'page'), Q('x', 'short', showIf=SI('all', ('a', 'is', 'no'))), Q('p3', 'page'), Q('y', 'short')], {'a': 's'}) == 'a,y')
ok('logic: bad jump target', vis([Q('a', 'radio', options=['s'], jumps={'s': 'gone'}), Q('p2', 'page'), Q('x', 'short')], {'a': 's'}) == 'a,x')
ok('logic: skipped page answers dropped', vis([Q('a', 'radio', options=['s'], jumps={'s': 'p3'}), Q('p2', 'page'), Q('x', 'short'), Q('p3', 'page'), Q('z', 'short', showIf=SI('all', ('x', 'empty', '')))], {'a': 's', 'x': 'ignored'}) == 'a,z')
# validation honours it: a hidden required question is not required, and its answer is not stored
RQ = [Q('a', 'radio', options=['yes', 'no'], required=True), Q('b', 'short', required=True, showIf=SI('all', ('a', 'is', 'yes')))]
c, e = validate_all(RQ, {'a': 'no'}); ok('logic: hidden required not enforced', not e and c == {'a': 'no'})
c, e = validate_all(RQ, {'a': 'no', 'b': 'sneaky'}); ok('logic: hidden answers dropped', c == {'a': 'no'})
c, e = validate_all(RQ, {'a': 'yes'}); ok('logic: shown required enforced', 'b' in e)

# not a form
did = call('POST', '/api/docs', {'kind': 'doc'}, TA)[1]['id']
ok('docs are not forms', call('GET', f'/api/forms/{did}', None, TA)[0] == 404)
# delete responses
rid = rows[0]['id']; ok('delete one', call('DELETE', f'/api/forms/{fid}/responses/{rid}', None, TA)[0] == 200)
ok('delete all', call('DELETE', f'/api/forms/{fid}/responses', None, TA)[0] == 200 and call('GET', f'/api/forms/{fid}/responses', None, TA)[1]['responses'] == [])
# search + sharing note
ok('form kind in doc list', any(d['kind'] == 'form' for d in call('GET', '/api/docs', None, TA)[1]['mine']))
ok
