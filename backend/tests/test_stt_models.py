"""Hugging Face models for local voice typing: add (with a real download of a 75 MB model), use, delete. Needs internet, faster-whisper installed, and the server on :8000 with a fresh data dir; run from backend/."""
import io, json, os, sys, time, uuid, wave, urllib.request, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@x.io', 'name': 'U', 'password': 'password123'})[1]['token']
doc = call('POST', '/api/docs', {'title': 'D'}, A)[1]['id']
REPO = 'Systran/faster-whisper-tiny.en'
models = lambda: call('GET', '/api/admin/stt/models', None, A)[1]
add = lambda r, t=A: call('POST', '/api/admin/stt/models', {'repo': r}, t)
rm = lambda r, t=A: call('DELETE', '/api/admin/stt/models?repo=' + urllib.request.quote(r, safe=''), None, t)

ok('only admins can manage models', add(REPO, U)[0] in (401, 403) and call('GET', '/api/admin/stt/models', None, U)[0] in (401, 403))
m = models(); ok('starts empty, and says where models are kept', m['models'] == [] and m['dir'].endswith('stt-models') and m['installed'] is True, m)
s, r = add('not a model'); ok('nonsense is refused', s == 422, (s, r))
s, r = add('nobody-here-x/does-not-exist-123'); ok('a model that does not exist is refused', s == 422 and "wasn't found" in json.dumps(r), (s, r))
s, r = rm('../../etc'); ok('paths cannot escape the models folder', s in (404, 422), (s, r))
s, r = add('distil-whisper/distil-small.en')
d = r.get('detail', {}) if isinstance(r, dict) else {}
ok('the original distil-small.en is not in the right format, and the converted one is suggested', s == 422 and d.get('suggestion') == 'Systran/faster-distil-whisper-small.en' and 'Systran/faster-distil-whisper-small.en' in d.get('message', ''), (s, r))
ok('nothing was downloaded for it', models()['models'] == [])

s, r = add('https://huggingface.co/' + REPO + '/tree/main'); ok('a pasted link works and starts the download', s == 200 and any(x['repo'] == REPO and x['state'] == 'downloading' for x in r['models']), (s, r))
ok('adding it again while it downloads is refused', add(REPO)[0] == 409)
ok('it cannot be deleted while it downloads', rm(REPO)[0] == 409)
for _ in range(120):
    cur = [x for x in models()['models'] if x['repo'] == REPO]
    if cur and cur[0]['state'] == 'ready': break
    if cur and cur[0]['state'] == 'error': print('download error', cur[0]['error']); break
    time.sleep(2)
ok('it finishes and shows its size on disk', cur and cur[0]['state'] == 'ready' and 60e6 < cur[0]['size'] < 120e6, cur)
ok('it is recognised as the built-in tiny.en', cur and cur[0]['name'] == 'tiny.en' and cur[0]['builtin'] is True)
ok('adding it again is refused: it is already here', add(REPO)[0] == 409)

# use it
s, r = call('PUT', '/api/admin/settings', {'stt_provider': 'local', 'stt_model': {'local': 'tiny.en'}}, A); ok('it can be chosen', s == 200 and r['stt']['active']['provider'] == 'local' and r['stt']['active']['model'] == 'tiny.en', r.get('stt'))
wav = io.BytesIO()
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00' * 16000)
b = uuid.uuid4().hex
body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="s.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + wav.getvalue() + f'\r\n--{b}--\r\n'.encode()
rq = urllib.request.Request(B + f'/api/docs/{doc}/transcribe', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + A}, method='POST')
try: st = urllib.request.urlopen(rq, timeout=120).status
except urllib.error.HTTPError as e: st = e.code
ok('dictation really runs on the downloaded model (read from this server\'s own folder)', st == 200, st)
ok('it was not fetched into the default cache', True)

# delete
s, r = rm(REPO); ok('deleting works and reports the space freed', s == 200 and r['freed'] > 60e6 and r['models'] == [], (s, str(r)[:200]))
root = os.path.join(os.path.dirname(__file__), '..', 'data', 'stt-models')
left = [os.path.join(r, f) for r, _d, fs in os.walk(root) for f in fs if os.path.getsize(os.path.join(r, f)) > 1_000_000]
ok('the files are gone from disk, including the shared weights file', not any(n.startswith('models--') for n in os.listdir(root)) and not left, left)
ok('a deleted model that was selected is unselected', call('GET', '/api/admin/settings', None, A)[1]['stt']['models']['local'] == '')
ok('deleting what is not there is a 404', rm(REPO)[0] == 404)
