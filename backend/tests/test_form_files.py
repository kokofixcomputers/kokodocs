"""File uploads on forms. Server on :8000 with a fresh data dir (KOKO_FORM_UPLOAD_RATE=1000 so the rate limit stays out of the way)."""
import os, sqlite3, time, urllib.request, urllib.error, uuid
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
from pycrdt import Array, Doc, Map
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
ROOT = os.path.join(os.path.dirname(__file__), '..', 'data'); DB = os.path.join(ROOT, 'kokodocs.sqlite3')
def send(did, item, name, data, tok=None, ctype='application/octet-stream'):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="item"\r\n\r\n{item}\r\n--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    h = {'content-type': f'multipart/form-data; boundary={b}'}
    if tok: h['authorization'] = 'Bearer ' + tok
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + f'/api/forms/{did}/files', body, h, method='POST')); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
def download(did, fid, tok):
    req = urllib.request.Request(B + f'/api/forms/{did}/files/{fid}', headers={'authorization': 'Bearer ' + tok} if tok else {})
    try:
        r = urllib.request.urlopen(req); return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, b'', {}
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
O, V, E = signup('o@ff.io', 'Owner'), signup('v@ff.io', 'Viewer'), signup('e@ff.io', 'Editor')
fid_ = call('POST', '/api/docs', {'kind': 'form'}, O)[1]['id']
call('PUT', f'/api/docs/{fid_}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'v@ff.io', 'role': 'viewer'}, {'email': 'e@ff.io', 'role': 'editor'}]}, O)
def put_form(items, meta=None):
    d = Doc(); d['meta'] = m = Map(); d['order'] = o = Array(); d['items'] = im = Map()
    for k, v in (meta or {}).items(): m[k] = v
    for it in items: o.append(it['id']); im[it['id']] = {k: v for k, v in it.items() if k != 'id'}
    with sqlite3.connect(DB) as c: c.execute('UPDATE documents SET ydoc = ? WHERE id = ?', (d.get_update(), fid_))
put_form([{'id': 'f', 'type': 'file', 'title': 'CV', 'accept': 'docs'}, {'id': 'p', 'type': 'file', 'title': 'Photo', 'accept': 'images', 'maxMB': 1}, {'id': 'a', 'type': 'file', 'title': 'Anything', 'required': True}, {'id': 't', 'type': 'short', 'title': 'Name'}])
used = lambda: call('GET', '/api/me/storage', None, O)[1]
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 5000
base = used()

s, r = send(fid_, 'f', 'cv.pdf', b'%PDF-1.4 ' + b'x' * 2000, V); ok('viewer uploads a PDF', s == 200 and r['name'] == 'cv.pdf' and r['size'] > 2000, (s, r))
f1 = r.get('id')
ok('upload counts toward the owner\'s storage, not the uploader\'s', used()['files'] >= 2000 and used()['total'] - base['total'] == used()['files'] - base.get('files', 0) and call('GET', '/api/me/storage', None, V)[1]['total'] == 0)
ok('storage view lists it as files', 'files' in used())
ok('stranger cannot upload', send(fid_, 'f', 'x.pdf', b'%PDF-1', signup('s@ff.io', 'S'))[0] == 403)
ok('not a file question', send(fid_, 't', 'x.pdf', b'%PDF-1', V)[0] == 404)
ok('unknown question', send(fid_, 'nope', 'x.pdf', b'%PDF-1', V)[0] == 404)
ok('empty file rejected', send(fid_, 'f', 'e.pdf', b'', V)[0] == 415)
ok('over 3 MB rejected', send(fid_, 'a', 'big.bin', b'x' * (3 * 1024 * 1024 + 1), V)[0] == 413)
ok('exactly 3 MB accepted', send(fid_, 'a', 'ok.bin', b'x' * (3 * 1024 * 1024), V)[0] == 200)
ok("the question's own smaller limit applies", send(fid_, 'p', 'big.png', PNG + b'0' * (1024 * 1024), V)[0] == 413)
ok('executables refused whatever the question allows', send(fid_, 'a', 'setup.exe', b'MZ' + b'0' * 100, V)[0] == 415 and send(fid_, 'a', 'page.html', b'<script>1</script>', V)[0] == 415 and send(fid_, 'a', 'x.svg', b'<svg onload=1>', V)[0] == 415)
ok('wrong kind for the question', send(fid_, 'f', 'pic.png', PNG, V)[0] == 415)
ok('a renamed file cannot pass as an image', send(fid_, 'p', 'fake.png', b'just text', V)[0] == 415)
ok('real image accepted', send(fid_, 'p', 'me.png', PNG, V)[0] == 200)
s, r = send(fid_, 'a', '../../etc/pa<ss>wd', b'hello', V); ok('file names are cleaned', s == 200 and r['name'] == 'pa_ss_wd', r)

# submitting
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'f': f1}}, V); ok('required file question enforced', s == 422 and 'a' in r['detail']['errors'])
fa = send(fid_, 'a', 'notes.txt', b'my notes', V)[1]['id']
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': 'not-an-id'}}, V); ok('garbage id rejected', s == 422)
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': '0' * 32}}, V); ok('unknown id rejected', s == 422)
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': f1}}, V); ok("a file can't be used on a different question", s == 422)
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': fa, 'f': f1, 't': 'Vi'}}, V); ok('submit with files', s == 200, r); rid = r.get('id')
s, r = call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': fa}}, V); ok("a submitted file can't be reused", s == 422)
rows = call('GET', f'/api/forms/{fid_}/responses', None, E)[1]['responses']
ok('editors see file names, sizes and ids', rows[0]['answers']['a'] == {'id': fa, 'name': 'notes.txt', 'size': 8} and rows[0]['answers']['f']['name'] == 'cv.pdf')
s, body, h = download(fid_, fa, E); ok('editor downloads the file', s == 200 and body == b'my notes')
ok('download is always an attachment, never rendered', 'attachment' in h.get('content-disposition', '') and h.get('content-type') == 'application/octet-stream' and h.get('x-content-type-options') == 'nosniff', h)
ok('viewer cannot download', download(fid_, fa, V)[0] == 403)
ok('anonymous cannot download', download(fid_, fa, None)[0] in (401, 403))
ok('a pending (unsubmitted) upload cannot be downloaded', download(fid_, send(fid_, 'a', 'p.txt', b'x', V)[1]['id'], O)[0] == 404)
ok('bad id', download(fid_, '../../etc/passwd', O)[0] in (404, 422))

# link visitors and sign-in rules
call('PUT', f'/api/docs/{fid_}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': []}, O)
ok('anonymous upload through the link', send(fid_, 'a', 'anon.txt', b'hi')[0] == 200)
put_form([{'id': 'a', 'type': 'file', 'title': 'Anything'}], {'requireLogin': True}); ok('sign-in required forms refuse anonymous uploads', send(fid_, 'a', 'anon.txt', b'hi')[0] == 401)
put_form([{'id': 'a', 'type': 'file', 'title': 'Anything'}], {'accepting': False}); ok('closed forms refuse uploads', send(fid_, 'a', 'x.txt', b'hi', V)[0] == 403)
put_form([{'id': 'a', 'type': 'file', 'title': 'Anything'}])

# deleting frees space and removes the file from disk
disk = lambda: set(os.listdir(os.path.join(ROOT, 'form-files')))
before_disk, before_used = disk(), used()['files']
ok('files are stored on disk under random names', all(len(n) == 32 and '.' not in n for n in before_disk) and len(before_disk) >= 3)
call('DELETE', f'/api/forms/{fid_}/responses/{rid}', None, O)
ok('deleting a response deletes its files and frees the space', len(disk()) < len(before_disk) and used()['files'] < before_used and download(fid_, fa, O)[0] == 404)
fx = send(fid_, 'a', 'y.txt', b'yy', V)[1]['id']; call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': fx}}, V)
call('DELETE', f'/api/forms/{fid_}/responses', None, O)
with sqlite3.connect(DB) as c: left = c.execute('SELECT COUNT(*) FROM form_files WHERE response_id IS NOT NULL').fetchone()[0]
ok('clearing all responses deletes their files', left == 0)

# abandoned uploads are swept after a day
stale = send(fid_, 'a', 'stale.txt', b'zz', V)[1]['id']
with sqlite3.connect(DB) as c: c.execute('UPDATE form_files SET created_at = ? WHERE id = ?', (time.time() - 90000, stale))
import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..')); os.environ['KOKO_DATA_DIR'] = ROOT
from app import forms as F
F.sweep_stale()
with sqlite3.connect(DB) as c: ok('stale unsubmitted uploads are swept', c.execute('SELECT COUNT(*) FROM form_files WHERE id = ?', (stale,)).fetchone()[0] == 0)

# the owner's quota is enforced, and strangers are not told about it
A = signup('koko@kokodev.cc', 'Admin'); uid = call('GET', '/api/auth/me', None, O)[1]['id']
call('PATCH', f'/api/admin/users/{uid}', {'quota_mb': 1}, A)
big = send(fid_, 'a', 'b.bin', b'x' * (2 * 1024 * 1024), V)
ok('owner out of space: upload refused politely', big[0] == 507 and 'owner' in big[1].get('detail', '') and 'MB' not in big[1].get('detail', ''), big)
call('PATCH', f'/api/admin/users/{uid}', {'quota_mb': 0}, A)

# deleting the whole form removes every file
f2 = send(fid_, 'a', 'z.txt', b'zzzz', V)[1]['id']; call('POST', f'/api/forms/{fid_}/responses', {'answers': {'a': f2}}, V)
n0 = len(disk()); call('DELETE', f'/api/docs/{fid_}', None, O); call('DELETE', f'/api/docs/{fid_}/permanent', None, O)
ok('deleting the form for good removes its files from disk', len(disk()) < n0 and len(disk()) == 0, len(disk()))
