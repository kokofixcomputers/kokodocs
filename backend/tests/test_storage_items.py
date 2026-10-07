"""Per-file storage breakdown. Server on :8000 with a fresh data dir."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("_, a = call('POST'")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
_, u = call('POST', '/api/auth/signup', {'email': 'si@x.io', 'name': 'S', 'password': 'password123'}); U = u['token']
_, o = call('POST', '/api/auth/signup', {'email': 'so@x.io', 'name': 'O', 'password': 'password123'}); O = o['token']
d1 = call('POST', '/api/docs', {'title': 'Report'}, U)[1]['id']; d2 = call('POST', '/api/docs', {'title': 'Plan', 'kind': 'sheet'}, U)[1]['id']
upload(d1, U, png(5000)); upload(d1, U, png(3000)); upload(d2, U, png(100))
call('POST', f'/api/docs/{d1}/versions', {'label': 'v1'}, U)
call('DELETE', f'/api/docs/{d2}', None, U)
s, r = call('GET', '/api/me/storage/items', None, U)
ok('needs sign-in', call('GET', '/api/me/storage/items')[0] == 401)
ok('lists every file you own, bin included', s == 200 and {i['id'] for i in r['items']} == {d1, d2}, r)
by = {i['id']: i for i in r['items']}
ok('images are attributed to the file they were added to', by[d1]['images'] > 8000 and by[d1]['images'] > by[d2]['images'] > 100, by)
ok('every part is reported as a number', all(isinstance(i[k], int) for i in r['items'] for k in ('text', 'versions', 'images', 'files')))
ok('the bin is flagged', by[d2]['trashed'] is True and by[d1]['trashed'] is False)
ok('each file total is the sum of its parts', all(i['total'] == i['text'] + i['versions'] + i['images'] + i['files'] for i in r['items']))
tot = call('GET', '/api/me/storage', None, U)[1]
ok('files add up to the account total', sum(i['total'] for i in r['items']) + r['unattached_images'] == tot['used'], (sum(i['total'] for i in r['items']), r['unattached_images'], tot['used']))
ok('sorted largest first', [i['total'] for i in r['items']] == sorted((i['total'] for i in r['items']), reverse=True))
ok('someone else sees none of it', call('GET', '/api/me/storage/items', None, O)[1] == {'items': [], 'unattached_images': 0})
