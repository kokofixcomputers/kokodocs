"""Whether speech models are dropped from memory when idle, and after how long, is set in the admin dashboard. Server on :8000 with a fresh data dir; run from backend/."""
import os
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@id.io', 'name': 'U', 'password': 'password123'})[1]['token']
view = lambda: call('GET', '/api/admin/settings', None, A)[1]['stt']
put = lambda b, t=A: call('PUT', '/api/admin/settings', b, t)

v = view(); ok('by default models are dropped after 3 minutes', v['idle_unload'] is True and v['idle_minutes'] == 3, v)
ok('the admin sees which models are in memory', isinstance(v['loaded'], list))
s, r = put({'stt_idle_minutes': 10}); ok('the time can be changed', s == 200 and view()['idle_minutes'] == 10, (s, r))
s, r = put({'stt_idle_unload': False}); ok('unloading can be switched off', s == 200 and view()['idle_unload'] is False, (s, r))
ok('the time is kept while it is off', view()['idle_minutes'] == 10)
put({'stt_idle_unload': True}); ok('and on again', view()['idle_unload'] is True and view()['idle_minutes'] == 10)
ok('0 minutes is refused', put({'stt_idle_minutes': 0})[0] == 422)
ok('more than a day is refused', put({'stt_idle_minutes': 5000})[0] == 422)
ok('only admins can change it', put({'stt_idle_unload': False}, U)[0] in (401, 403) and view()['idle_unload'] is True)

# which models are in memory right now, and freeing them
import io, json, uuid, wave, urllib.request, urllib.error
doc = call('POST', '/api/docs', {'title': 'D'}, A)[1]['id']
wav = io.BytesIO()
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00' * 16000)
def preview():
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="s.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + wav.getvalue() + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + f'/api/docs/{doc}/transcribe/draft', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + A}, method='POST')
    return json.loads(urllib.request.urlopen(r).read())
models = lambda: call('GET', '/api/admin/stt/models', None, A)[1]
ok('nothing is loaded before anyone dictates', not any(m.get('loaded') for m in models()['models']))
preview()
m = next((x for x in models()['models'] if x['name'] == 'tiny.en'), None)
ok('after a preview the tiny model shows as in memory, with what it is for and when it drops', m and m['loaded'] and m['loaded']['roles'] == ['live preview'] and isinstance(m['loaded']['unload_in'], int) and m['loaded']['idle'] >= 0, m)
ok('the server\'s memory use is reported', isinstance(models().get('memory_mb'), int) and models()['memory_mb'] > 0, models().get('memory_mb'))
ok('only admins can free models', call('POST', '/api/admin/stt/unload', {}, U)[0] in (401, 403))
s, r = call('POST', '/api/admin/stt/unload', {'name': 'tiny.en'}, A)
ok('freeing one model works', s == 200 and r['unloaded'] == ['tiny.en'] and not any(x.get('loaded') for x in r['models']), (s, r.get('unloaded')))
preview(); s, r = call('POST', '/api/admin/stt/unload', {}, A)
ok('freeing everything works', s == 200 and r['unloaded'] == ['tiny.en'], (s, r.get('unloaded')))
ok('freeing when nothing is loaded is harmless', call('POST', '/api/admin/stt/unload', {}, A)[1]['unloaded'] == [])
