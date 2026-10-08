"""The live preview while speaking: a small local model writes rough text, the admin's provider still writes the final text. Server on :8000 with a fresh data dir; run from backend/."""
import io, json, os, uuid, wave, urllib.request, urllib.error
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
V = call('POST', '/api/auth/signup', {'email': 'v@dr.io', 'name': 'V', 'password': 'password123'})[1]['token']
doc = call('POST', '/api/docs', {'title': 'D'}, A)[1]['id']
call('PUT', f'/api/docs/{doc}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'v@dr.io', 'role': 'viewer'}]}, A)
wav = io.BytesIO()
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00' * 16000)
def draft(tok):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="s.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + wav.getvalue() + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + f'/api/docs/{doc}/transcribe/draft', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + tok}, method='POST')
    try: return 200, json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

st = call('GET', '/api/stt/status')[1]
ok('previews are on by default when the local engine is installed', st.get('draft') is True, st)
s, r = draft(A); ok('an editor gets a preview (silence gives empty text)', s == 200 and r['text'] == '', (s, r))
ok('viewers cannot spend the server\'s time', draft(V)[0] == 403)
view = call('GET', '/api/admin/settings', None, A)[1]['stt']
ok('the admin sees the setting and which small model is used', view['draft'] is True and view['draft_model'] == 'tiny.en', view)
call('PUT', '/api/admin/settings', {'stt_language': 'fr'}, A)
ok('a non-English language switches to the multilingual small model', call('GET', '/api/admin/settings', None, A)[1]['stt']['draft_model'] == 'tiny')
call('PUT', '/api/admin/settings', {'stt_language': '', 'stt_draft': False}, A)
ok('the admin can switch previews off', call('GET', '/api/stt/status')[1].get('draft') is False)
ok('and the endpoint then refuses', draft(A)[0] == 404)

# which downloaded model writes the preview
import pathlib, sys
sys.path.insert(0, '.')
from app import sttmodels
fake = sttmodels.MODELS_DIR / 'models--Systran--faster-whisper-base.en' / 'snapshots' / 'abc'   # (a model "downloaded" for the test: only its files' presence matters here)
fake.mkdir(parents=True, exist_ok=True); (fake / 'model.bin').write_bytes(b'x'); (fake / 'config.json').write_text('{}')
call('PUT', '/api/admin/settings', {'stt_draft': True, 'stt_language': ''}, A)
v = lambda: call('GET', '/api/admin/settings', None, A)[1]['stt']
ok('the options are the models downloaded on the server', 'base.en' in [o['value'] for o in v()['draft_options']], v()['draft_options'])
ok('by default it is automatic', v()['draft_choice'] == '' and v()['draft_model'] == 'tiny.en')
ok('a model that is not downloaded is refused', call('PUT', '/api/admin/settings', {'stt_draft_model': 'large-v3'}, A)[0] == 422)
ok('only admins choose', call('PUT', '/api/admin/settings', {'stt_draft_model': 'base.en'}, V)[0] in (401, 403))
s, r = call('PUT', '/api/admin/settings', {'stt_draft_model': 'base.en'}, A)
ok('the admin picks a downloaded model for the preview', s == 200 and r['stt']['draft_choice'] == 'base.en' and r['stt']['draft_model'] == 'base.en', r['stt'].get('draft_model'))
call('PUT', '/api/admin/settings', {'stt_language': 'fr'}, A)
ok('an English-only choice is not used for another language (the multilingual tiny is)', v()['draft_model'] == 'tiny')
call('PUT', '/api/admin/settings', {'stt_language': ''}, A)
ok('and applies again for English', v()['draft_model'] == 'base.en')
import shutil; shutil.rmtree(sttmodels.MODELS_DIR / 'models--Systran--faster-whisper-base.en')
ok('if the chosen model is deleted, it falls back to automatic', v()['draft_model'] == 'tiny.en' and 'base.en' not in [o['value'] for o in v()['draft_options']])
call('PUT', '/api/admin/settings', {'stt_draft_model': ''}, A); ok('and automatic can be chosen again', v()['draft_choice'] == '')
