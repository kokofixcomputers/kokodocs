"""Tags on files and folders. Server on :8000 with a fresh data dir."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
TA, TB, TC = signup('a@tg.io', 'A'), signup('b@tg.io', 'B'), signup('c@tg.io', 'C')
d1 = call('POST', '/api/docs', {'title': 'One'}, TA)[1]['id']; d2 = call('POST', '/api/docs', {'title': 'Two', 'kind': 'sheet'}, TA)[1]['id']
fo = call('POST', '/api/folders', {'name': 'Fold', 'parent_id': None}, TA)[1]['id']
docs = lambda t: {d['id']: d for d in call('GET', '/api/docs', None, t)[1]['mine'] + call('GET', '/api/docs', None, t)[1]['shared']}
ok('new files have no tags', docs(TA)[d1]['tags'] == [])

s, r = call('PUT', f'/api/tags/doc/{d1}', {'tags': ['Work', 'urgent']}, TA); ok('tag a file', s == 200 and r['tags'] == ['Work', 'urgent'], r)
ok('tags come back with the file list, alphabetical', docs(TA)[d1]['tags'] == ['urgent', 'Work'], docs(TA)[d1]['tags'])
s, r = call('PUT', f'/api/tags/doc/{d1}', {'tags': ['  Work  ', 'work', 'a, b', '', 'x' * 80, '   spaced    out  ']}, TA)
ok('names are cleaned: trimmed, no duplicates ignoring case, commas split off, length capped', r['tags'] == ['Work', 'a b', 'x' * 30, 'spaced out'], r)
s, r = call('PUT', f'/api/tags/doc/{d1}', {'tags': [f't{i}' for i in range(30)]}, TA); ok('at most 12 tags per item', len(r['tags']) == 12)
call('PUT', f'/api/tags/doc/{d1}', {'tags': ['Work', 'urgent']}, TA)
s, r = call('PUT', f'/api/tags/doc/{d1}', {'tags': []}, TA); ok('clearing tags', r['tags'] == [] and docs(TA)[d1]['tags'] == [])
call('PUT', f'/api/tags/doc/{d1}', {'tags': ['Work', 'urgent']}, TA); call('PUT', f'/api/tags/doc/{d2}', {'tags': ['work']}, TA)

s, r = call('PUT', f'/api/tags/folder/{fo}', {'tags': ['Archive']}, TA); ok('tag a folder', s == 200)
ok('folders list their tags', [f['tags'] for f in call('GET', '/api/folders', None, TA)[1] if f['id'] == fo] == [['Archive']])
ok('you can only tag your own folders', call('PUT', f'/api/tags/folder/{fo}', {'tags': ['x']}, TB)[0] == 404)
ok('strangers cannot tag a file they cannot open', call('PUT', f'/api/tags/doc/{d1}', {'tags': ['x']}, TC)[0] in (401, 403))
ok('signed-out people cannot tag', call('PUT', f'/api/tags/doc/{d1}', {'tags': ['x']})[0] == 401)

# tags are personal
call('PUT', f'/api/docs/{d1}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'b@tg.io', 'role': 'viewer'}]}, TA)
ok('a person you share with starts with no tags on it', docs(TB)[d1]['tags'] == [])
ok('a viewer can tag what they can open', call('PUT', f'/api/tags/doc/{d1}', {'tags': ['reading list']}, TB)[0] == 200)
ok('their tags are theirs alone', docs(TB)[d1]['tags'] == ['reading list'] and docs(TA)[d1]['tags'] == ['urgent', 'Work'])

# the tag list
ts = {t['name']: t['count'] for t in call('GET', '/api/tags', None, TA)[1]['tags']}
ok('tag list counts files and folders, merging capitalisations', ts == {'Archive': 1, 'urgent': 1, 'Work': 2}, ts)
ok("you never see someone else's tag names", 'reading list' not in ts)

# rename, merge, delete
ok('rename', call('POST', '/api/tags/rename', {'old': 'urgent', 'new': 'Soon'}, TA)[0] == 200 and docs(TA)[d1]['tags'] == ['Soon', 'Work'])
call('POST', '/api/tags/rename', {'old': 'Soon', 'new': 'work'}, TA)
ok('renaming onto an existing tag merges them', docs(TA)[d1]['tags'] == ['Work'] or docs(TA)[d1]['tags'] == ['work'], docs(TA)[d1]['tags'])
call('POST', '/api/tags/rename', {'old': 'work', 'new': 'WORK'}, TA); ok('changing only the capitalisation', docs(TA)[d2]['tags'] == ['WORK'] and docs(TA)[d1]['tags'] == ['WORK'], (docs(TA)[d1]['tags'], docs(TA)[d2]['tags']))
ok('rename to nothing is refused', call('POST', '/api/tags/rename', {'old': 'WORK', 'new': ' , '}, TA)[0] == 422)
ok("renaming doesn't touch other people's tags", docs(TB)[d1]['tags'] == ['reading list'])
call('POST', '/api/tags/delete', {'name': 'work'}, TA); ok('delete a tag everywhere (case-insensitive), files untouched', docs(TA)[d1]['tags'] == [] and docs(TA)[d2]['tags'] == [] and d1 in docs(TA))

# cleanup when things go away
call('PUT', f'/api/tags/doc/{d2}', {'tags': ['gone']}, TA); call('PUT', f'/api/tags/folder/{fo}', {'tags': ['gone']}, TA)
call('DELETE', f'/api/docs/{d2}', None, TA); call('DELETE', f'/api/docs/{d2}/permanent', None, TA); call('DELETE', f'/api/folders/{fo}', None, TA)
ts = {t['name'] for t in call('GET', '/api/tags', None, TA)[1]['tags']}
ok('deleting a file or folder for good removes its tags', 'gone' not in ts, ts)
