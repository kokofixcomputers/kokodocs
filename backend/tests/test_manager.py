"""The "can manage" role. Server on :8000 with a fresh data dir."""
import os, sqlite3
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
from pycrdt import Array, Doc, Map
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'kokodocs.sqlite3')
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
TO, TM, TE, TV, TX = signup('owner@mg.io', 'Owner'), signup('mgr@mg.io', 'Mgr'), signup('ed@mg.io', 'Ed'), signup('vw@mg.io', 'Vw'), signup('x@mg.io', 'X')
did = call('POST', '/api/docs', {'title': 'Plan'}, TO)[1]['id']
share = lambda tok, shares, access='restricted', role='viewer', doc=None: call('PUT', f'/api/docs/{doc or did}/sharing', {'link_access': access, 'link_role': role, 'shares': shares}, tok)
S = lambda e, r: {'email': e, 'role': r}
share(TO, [S('mgr@mg.io', 'manager'), S('ed@mg.io', 'editor'), S('vw@mg.io', 'viewer')])

ok('the role is stored and shown to the person who has it', call('GET', f'/api/docs/{did}', None, TM)[1]['role'] == 'manager')
ok('it appears in their "shared with me" list', [d['role'] for d in call('GET', '/api/docs', None, TM)[1]['shared']] == ['manager'])
ok('a manager can read the sharing settings', call('GET', f'/api/docs/{did}/sharing', None, TM)[0] == 200)
ok('an editor still cannot', call('GET', f'/api/docs/{did}/sharing', None, TE)[0] == 403 and share(TE, [])[0] == 403)
ok('a viewer cannot', share(TV, [])[0] == 403)

# a manager changes who has access
s, r = share(TM, [S('mgr@mg.io', 'manager'), S('ed@mg.io', 'editor'), S('x@mg.io', 'viewer')])
ok('a manager can add and remove people', s == 200 and {x['email'] for x in r['shares']} == {'mgr@mg.io', 'ed@mg.io', 'x@mg.io'}, r)
ok('the person they added can now open it', call('GET', f'/api/docs/{did}', None, TX)[0] == 200 and call('GET', f'/api/docs/{did}', None, TV)[0] == 403)
s, r = share(TM, [S('ed@mg.io', 'manager')])
ok('a manager can promote someone else to manager', s == 200 and {x['email']: x['role'] for x in r['shares']}.get('ed@mg.io') == 'manager', r)
ok("saving a list that leaves the manager out never locks them out", {x['email']: x['role'] for x in r['shares']}.get('mgr@mg.io') == 'manager' and call('GET', f'/api/docs/{did}', None, TM)[1]['role'] == 'manager', r)
s, r = share(TM, [S('owner@mg.io', 'viewer')])
ok("the owner can't be put on the list or demoted by a manager", call('GET', f'/api/docs/{did}', None, TO)[1]['role'] == 'owner' and 'owner@mg.io' not in {x['email'] for x in r['shares']}, r)
ok('a manager can change the link settings', share(TM, [S('mgr@mg.io', 'manager')], 'anyone', 'viewer')[1]['link_access'] == 'anyone')
ok('a link can never grant manage', call('PUT', f'/api/docs/{did}/sharing', {'link_access': 'anyone', 'link_role': 'manager', 'shares': []}, TM)[0] == 422)
share(TO, [S('mgr@mg.io', 'manager'), S('ed@mg.io', 'editor'), S('vw@mg.io', 'viewer')])

# what a manager still can't do
ok('only the owner can delete', call('DELETE', f'/api/docs/{did}', None, TM)[0] == 403)
ok('only the owner can erase for good or restore', call('DELETE', f'/api/docs/{did}/permanent', None, TM)[0] in (403, 404) and call('POST', f'/api/docs/{did}/restore', None, TM)[0] in (403, 404))
ok('the document is still there', call('GET', f'/api/docs/{did}', None, TO)[0] == 200)
# what a manager can do on top of editing
ok('a manager can edit (rename)', call('PATCH', f'/api/docs/{did}', {'title': 'Plan v2'}, TM)[0] == 200)
ok('a manager can save a version', call('POST', f'/api/docs/{did}/versions', {'label': 'm'}, TM)[0] in (200, 409))
cid = call('POST', f'/api/docs/{did}/comments', {'body': 'a viewer comment'}, TV)[1].get('id')
ok("a manager can delete other people's comments", call('DELETE', f'/api/docs/{did}/comments/{cid}', None, TM)[0] == 200 and not [c for c in call('GET', f'/api/docs/{did}/comments', None, TO)[1] if c['id'] == cid])
cid = call('POST', f'/api/docs/{did}/comments', {'body': 'an editor comment'}, TE)[1].get('id')
cid2 = call('POST', f'/api/docs/{did}/comments', {'body': 'another'}, TV)[1].get('id')
ok('an editor still can only delete their own comments', call('DELETE', f'/api/docs/{did}/comments/{cid2}', None, TE)[0] == 403)

# forms: managers see and manage the responses and the sharing
fid = call('POST', '/api/docs', {'kind': 'form'}, TO)[1]['id']
d = Doc(); d['meta'] = Map(); d['order'] = o = Array(); d['items'] = im = Map(); o.append('q'); im['q'] = {'type': 'short', 'title': 'Name'}
with sqlite3.connect(DB) as c: c.execute('UPDATE documents SET ydoc = ? WHERE id = ?', (d.get_update(), fid))
share(TO, [S('mgr@mg.io', 'manager'), S('ed@mg.io', 'editor'), S('vw@mg.io', 'viewer')], doc=fid)
rid = call('POST', f'/api/forms/{fid}/responses', {'answers': {'q': 'Ann'}}, TV)[1]['id']
ok('a manager sees the responses', len(call('GET', f'/api/forms/{fid}/responses', None, TM)[1]['responses']) == 1)
ok('a manager manages the responses', call('DELETE', f'/api/forms/{fid}/responses/{rid}', None, TM)[0] == 200)
ok("a manager manages the form's sharing", share(TM, [S('mgr@mg.io', 'manager'), S('x@mg.io', 'viewer')], doc=fid)[0] == 200 and call('GET', f'/api/forms/{fid}', None, TX)[0] == 200)
ok('a form link still only ever lets people fill it out', share(TM, [S('mgr@mg.io', 'manager')], 'anyone', 'editor', doc=fid)[1]['link_role'] == 'viewer')
ok('viewers still cannot see responses', call('GET', f'/api/forms/{fid}/responses', None, TV)[0] == 403)

# the person is told what they were given
n = [x for x in call('GET', '/api/notifications', None, TM)[1]['items'] if x['kind'] == 'share']
ok('the invitation says they can manage it', any('manage' in x['text'] for x in n), [x['text'] for x in n])
