"""Startup merge of pictures stored twice. Server on :8000 with a fresh data dir; run from backend/ (it opens the same data directory)."""
import os, shutil, sqlite3, sys, time, hashlib, urllib.request, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("_, a = call('POST'")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
from app import db as D, imagededupe
def get(url):
    try: return urllib.request.urlopen(B + url).read()
    except urllib.error.HTTPError as e: return e.code
su = lambda e: call('POST', '/api/auth/signup', {'email': e, 'name': 'X', 'password': 'password123'})[1]['token']
A, C = su('ma@x.io'), su('mc@x.io')
d1 = call('POST', '/api/docs', {'title': 'One'}, A)[1]['id']; d2 = call('POST', '/api/docs', {'title': 'Two'}, A)[1]['id']; dc = call('POST', '/api/docs', {'title': 'C'}, C)[1]['id']
uid = lambda tok: call('GET', '/api/me/storage', None, tok) and None
import json
def mkdup(owner_email, doc, data, name, age):
    """What an older version would have left behind: a second stored copy with its own address."""
    db = sqlite3.connect(D.DB_PATH); oid = db.execute('SELECT id FROM users WHERE email = ?', (owner_email,)).fetchone()[0]
    (D.UPLOAD_DIR / name).write_bytes(data)
    db.execute('INSERT INTO uploads (name, doc_id, owner_id, size, created_at, hash) VALUES (?,?,?,?,?,?)', (name, doc, oid, len(data), age, hashlib.sha256(data).hexdigest()))
    db.execute('INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)', (name, doc)); db.commit(); db.close()
img = png(6000)
first = upload(d1, A, img)                       # the normal path stores one copy
names = [f for f in os.listdir(D.UPLOAD_DIR)]
orig = names[0]
mkdup('ma@x.io', d1, img, 'a' * 32 + '.png', time.time() + 10)
mkdup('ma@x.io', d2, img, 'b' * 32 + '.png', time.time() + 20)
mkdup('mc@x.io', dc, img, 'c' * 32 + '.png', time.time())          # someone else's copy: must stay
other = bytes(png(6001)); mkdup('ma@x.io', d1, other, 'd' * 32 + '.png', time.time() + 30)   # a different picture: must stay
before = call('GET', '/api/me/storage', None, A)[1]['images']
r = imagededupe.merge_duplicates()
after = call('GET', '/api/me/storage', None, A)[1]['images']
ok('two extra copies were merged', r['merged'] == 2, r)
ok('the storage used drops by the size of the extra copies', before - after == 2 * len(img), (before, after, len(img)))
ok('the oldest copy is the one that is kept', orig in os.listdir(D.UPLOAD_DIR) and not (D.UPLOAD_DIR / ('a' * 32 + '.png')).exists() and not (D.UPLOAD_DIR / ('b' * 32 + '.png')).exists())
ok('old addresses still show the picture', get('/api/images/' + 'a' * 32 + '.png') == img and get('/api/images/' + 'b' * 32 + '.png') == img)
ok('another person\'s copy is untouched', (D.UPLOAD_DIR / ('c' * 32 + '.png')).exists())
ok('a different picture is untouched', (D.UPLOAD_DIR / ('d' * 32 + '.png')).exists())
ok('running it again finds nothing', imagededupe.merge_duplicates()['merged'] == 0)
items = call('GET', '/api/me/storage/items', None, A)[1]
ok('every file using the picture still counts it under one file', items['unattached_images'] == 0, items)
call('DELETE', f'/api/docs/{d1}', None, A); call('DELETE', f'/api/docs/{d1}/permanent', None, A)
ok('a file that was merged in keeps the picture alive when another file is deleted', get('/api/images/' + 'b' * 32 + '.png') == img)
call('DELETE', f'/api/docs/{d2}', None, A); call('DELETE', f'/api/docs/{d2}/permanent', None, A)
ok('when the last file goes, every address for it goes too', get('/api/images/' + 'b' * 32 + '.png') == 404 and get('/api/images/' + 'a' * 32 + '.png') == 404)
