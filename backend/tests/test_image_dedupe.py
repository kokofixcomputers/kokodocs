"""Identical pictures are stored once per owner. Server on :8000 with a fresh data dir."""
import os, urllib.request, urllib.error
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("_, a = call('POST'")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
import json, uuid
def up(doc, tok, data):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + f'/api/docs/{doc}/images', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + tok}, method='POST')
    try: return json.loads(urllib.request.urlopen(r).read())['url']
    except urllib.error.HTTPError as e: return e.code
status = lambda url: (lambda r: r)(urllib.request.urlopen(B + url).status) if True else 0
def get(url):
    try: return urllib.request.urlopen(B + url).status
    except urllib.error.HTTPError as e: return e.code
su = lambda e: call('POST', '/api/auth/signup', {'email': e, 'name': 'X', 'password': 'password123'})[1]['token']
A, C = su('da@x.io'), su('dc@x.io')
d1 = call('POST', '/api/docs', {'title': 'One'}, A)[1]['id']; d2 = call('POST', '/api/docs', {'title': 'Two'}, A)[1]['id']; dc = call('POST', '/api/docs', {'title': 'C'}, C)[1]['id']
img = png(4000)
u1 = up(d1, A, img); used1 = call('GET', '/api/me/storage', None, A)[1]['images']
u2 = up(d1, A, img); u3 = up(d2, A, img)
ok('the same picture added again gets the same address', u1 == u2 == u3, (u1, u2, u3))
ok('and costs nothing extra', call('GET', '/api/me/storage', None, A)[1]['images'] == used1 > 4000)
ok('a different picture is stored separately', up(d1, A, png(4001)) != u1)
ok('another person gets their own copy', up(dc, C, img) != u1)
ok('the picture shows', get(u1) == 200)
call('DELETE', f'/api/docs/{d1}', None, A); call('DELETE', f'/api/docs/{d1}/permanent', None, A)
ok('deleting one file keeps a picture another file still uses', get(u1) == 200)
items = call('GET', '/api/me/storage/items', None, A)[1]
ok('it is counted under the file that still uses it', items['unattached_images'] == 0 and any(i['id'] == d2 and i['images'] > 4000 for i in items['items']), items)
call('DELETE', f'/api/docs/{d2}', None, A); call('DELETE', f'/api/docs/{d2}/permanent', None, A)
ok('the last file to go takes the picture with it', get(u1) == 404)
ok('the other person was not affected', get(up(dc, C, img)) == 200)
