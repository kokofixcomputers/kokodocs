"""Run with the server up on :8000 (fresh data dir). Uses a tiny PNG; sets quotas via the admin API."""
import io, json, struct, urllib.request, urllib.error, uuid, zlib
B = 'http://localhost:8000'
def call(m, p, body=None, tok=None):
    h = {'content-type': 'application/json'}
    if tok: h['authorization'] = 'Bearer ' + tok
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(body).encode() if body is not None else None, h, method=m)); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
def png(n_pad=0):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b'\x00\xff\x00\x00'
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'tEXt', b'k\x00' + b'x' * n_pad) + chunk(b'IEND', b'')
def upload(doc, tok, data):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + f'/api/docs/{doc}/images', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + tok}, method='POST')
    try: return urllib.request.urlopen(r).status, {}
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
ok = lambda n, c: print(('PASS ' if c else 'FAIL ') + n)
_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'K', 'password': 'password123'}); A = a['token']
_, u = call('POST', '/api/auth/signup', {'email': 'q@x.io', 'name': 'Q', 'password': 'password123'}); U = u['token']; uid = u['user']['id']
s, st = call('GET', '/api/me/storage', None, U); ok('default limit 500 MB', st['limit'] == 500 * 1024 * 1024 and st['used'] == 0)
_, d = call('POST', '/api/docs', {'title': 'x', 'kind': 'doc'}, U)
s, _ = upload(d['id'], U, png()); ok('upload counted', s == 200 and call('GET', '/api/me/storage', None, U)[1]['images'] > 0)
s, r = call('PATCH', f'/api/admin/users/{uid}', {'quota_mb': 0}, A); ok('admin sets unlimited', s == 200 and r['quota_mb'] == 0)
s, st = call('GET', '/api/me/storage', None, U); ok('unlimited shows limit 0', st['limit'] == 0)
s, r = call('PUT', '/api/admin/settings', {'default_quota_mb': 1}, A); ok('default changed', r['default_quota_mb'] == 1)
call('PATCH', f'/api/admin/users/{uid}', {'clear_quota': True}, A)
s, st = call('GET', '/api/me/storage', None, U); ok('user follows default (1 MB)', st['limit'] == 1024 * 1024)
s, _ = upload(d['id'], U, png(1_200_000)); ok('big upload refused 413', s == 413)
s, _ = upload(d['id'], U, png()); ok('small upload still fits', s == 200)
call('PATCH', f'/api/admin/users/{uid}', {'quota_mb': 1}, A)
call('PUT', '/api/admin/settings', {'default_quota_mb': 500}, A)
s, r = call('GET', '/api/admin/users', None, A); me = [x for x in r if x['id'] == uid][0]; ok('admin sees usage + override', me['used'] > 0 and me['quota_mb'] == 1 and me['limit_mb'] == 1)
# fill: a 1 MB limit with ~1.1 MB used blocks new docs
upload(d['id'], U, png(900_000)); upload(d['id'], U, png(300_000))
s, st = call('GET', '/api/me/storage', None, U); print('  used', st['used'])
s, _ = upload(d['id'], U, png(300_000)); ok('upload refused near the limit', s == 413)
s, _ = call('DELETE', f'/api/admin/files/{d["id"]}', None, A); s2, st = call('GET', '/api/me/storage', None, U); ok('deleting file frees uploads', st['images'] == 0)
