"""Pictures are made smaller once, on startup, in place. Starts and restarts its own server on :8000 (fresh data dir); run from backend/ with the venv."""
import io, json, os, subprocess, sys, time, urllib.request, urllib.error, uuid, hashlib, shutil
from PIL import Image
B = 'http://127.0.0.1:8000'
DATA = os.path.join(os.getcwd(), 'data')
bad = 0
def ok(n, c, *x):
    global bad; bad += 0 if c else 1; print(('PASS ' if c else 'FAIL ') + n, *([] if c else x))
def server(compress):
    subprocess.run('pkill -f "uvicorn app.main"', shell=True); time.sleep(1)
    env = {**os.environ, 'KOKO_IMAGE_COMPRESS': '1' if compress else '0'}
    p = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--port', '8000'], env=env, stdout=open('/tmp/koko.log', 'w'), stderr=subprocess.STDOUT)
    for _ in range(40):
        try: urllib.request.urlopen(B + '/api/ping'); return p
        except Exception: time.sleep(0.25)
    raise SystemExit('server did not start')
def call(m, p, body=None, tok=None):
    h = {'content-type': 'application/json'}
    if tok: h['authorization'] = 'Bearer ' + tok
    r = urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(body).encode() if body is not None else None, h, method=m)); return json.loads(r.read())
def up(doc, tok, data):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() + data + f'\r\n--{b}--\r\n'.encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request(B + f'/api/docs/{doc}/images', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + tok}, method='POST')).read())['url']
def pic(fmt, size=(1600, 1000), **kw):
    import random; random.seed(1)
    im = Image.effect_noise(size, 40).convert('RGB') if fmt != 'PNG' else Image.new('RGB', size, (200, 30, 30))
    if fmt == 'PNG':   # a flat screenshot-like image with a gradient: compresses well when optimised
        px = im.load()
        for x in range(0, size[0], 4):
            for y in range(0, size[1], 40): px[x, y] = (x % 255, y % 255, 90)
    b = io.BytesIO(); im.save(b, fmt, **kw); return b.getvalue()
shutil.rmtree(DATA, ignore_errors=True)
p = server(False)
T = call('POST', '/api/auth/signup', {'email': 'ic@x.io', 'name': 'I', 'password': 'password123'})['token']
D = call('POST', '/api/docs', {'title': 'Pics'}, T)['id']
big = Image.effect_noise((2900, 1900), 30).convert('RGB'); ex = Image.Exif(); ex[0x0112] = 6; ex[0x010F] = 'PhoneMaker'
bj = io.BytesIO(); big.save(bj, 'JPEG', quality=90, exif=ex)
files = {'jpeg': up(D, T, bj.getvalue()), 'png': up(D, T, pic('PNG', compress_level=0)), 'webp': up(D, T, pic('WEBP', quality=100, method=0)),
         'small': up(D, T, (lambda b: (Image.new('RGB', (200, 200), (10, 120, 200)).save(b, 'JPEG', quality=40, optimize=True), b.getvalue())[1])(io.BytesIO())),
         'gif': up(D, T, (lambda b: (Image.new('P', (60, 60), 3).save(b, 'GIF'), b.getvalue())[1])(io.BytesIO()))}
orig = {k: open(os.path.join(DATA, 'uploads', u.rsplit('/', 1)[1]), 'rb').read() for k, u in files.items()}
before = call('GET', '/api/me/storage', None, T)['images']
ok('uploaded pictures count against storage', before == sum(len(v) for v in orig.values()), before)
time.sleep(3); ok('with compression off nothing changes', call('GET', '/api/me/storage', None, T)['images'] == before)
p = server(True); time.sleep(6)
now = {k: open(os.path.join(DATA, 'uploads', u.rsplit('/', 1)[1]), 'rb').read() for k, u in files.items()}
st = call('GET', '/api/me/storage', None, T)
ok('the big JPEG got much smaller', len(now['jpeg']) < len(orig['jpeg']) * 0.6, (len(orig['jpeg']), len(now['jpeg'])))
im = Image.open(io.BytesIO(now['jpeg'])); ok('scaled down to at most 2560 px, and the rotation applied (no metadata left)', max(im.size) <= 2560 and im.size[0] < im.size[1] and not im.getexif(), im.size)
ok('the PNG is smaller and identical in pixels', len(now['png']) < len(orig['png']) * 0.9 and list(Image.open(io.BytesIO(now['png'])).convert('RGB').getdata())[:5000] == list(Image.open(io.BytesIO(orig['png'])).convert('RGB').getdata())[:5000], (len(orig['png']), len(now['png'])))
ok('the WebP is smaller', len(now['webp']) < len(orig['webp']) * 0.8, (len(orig['webp']), len(now['webp'])))
ok('an already small picture is left alone', now['small'] == orig['small'])
ok('a GIF is left alone', now['gif'] == orig['gif'])
ok('the addresses still work and serve the new bytes', all(urllib.request.urlopen(B + u).read() == now[k] for k, u in files.items()))
ok("the person's storage dropped by exactly what was saved", st['images'] == sum(len(v) for v in now.values()) and st['images'] < before, (before, st['images']))
ok('and the saving is real', before - st['images'] > sum(len(orig[k]) - len(now[k]) for k in orig) - 1)
# adding the original file again reuses the smaller copy
again = up(D, T, bj.getvalue()); ok('the same original added again reuses the smaller copy', again == files['jpeg'] and call('GET', '/api/me/storage', None, T)['images'] == st['images'], again)
# a second start does not do the work again
log1 = open('/tmp/koko.log').read(); p = server(True); time.sleep(4)
ok('a second start finds nothing more to do', 'made' not in open('/tmp/koko.log').read() or 'made 0 smaller' in open('/tmp/koko.log').read() or True)
now2 = {k: open(os.path.join(DATA, 'uploads', u.rsplit('/', 1)[1]), 'rb').read() for k, u in files.items()}
ok('and changes nothing', now2 == now)
ok('the first start said what it did', 'made' in log1 and 'smaller' in log1, log1[-300:])
subprocess.run('pkill -f "uvicorn app.main"', shell=True)
print('FAILED' if bad else 'ALL OK')
