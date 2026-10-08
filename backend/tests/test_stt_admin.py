"""Voice typing configured from the admin dashboard (Groq, Mistral, OpenAI, any compatible server, local). Server on :8000 with a fresh data dir; run from backend/."""
import io, json, os, sys, threading, uuid, wave, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
SEEN = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); body = self.rfile.read(n)
        SEEN.append({'auth': self.headers.get('authorization'), 'path': self.path, 'model': (__import__('re').search(rb'name="model"\r\n\r\n([^\r]+)', body) or [None, b''])[1].decode(), 'lang': (__import__('re').search(rb'name="language"\r\n\r\n([^\r]+)', body) or [None, b''])[1].decode()})
        if self.headers.get('authorization') == 'Bearer bad': self.send_response(401); self.end_headers(); return
        self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps({'text': ' hello world '}).encode())
srv = HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
MOCK = f'http://127.0.0.1:{srv.server_port}/v1'

A = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'Admin', 'password': 'password123'})[1]['token']
U = call('POST', '/api/auth/signup', {'email': 'u@x.io', 'name': 'U', 'password': 'password123'})[1]['token']
doc = call('POST', '/api/docs', {'title': 'Dictate'}, A)[1]['id']
wav = io.BytesIO()
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00' * 16000)
def transcribe(tok):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="s.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + wav.getvalue() + f'\r\n--{b}--\r\n'.encode()
    r = urllib.request.Request(B + f'/api/docs/{doc}/transcribe?language=en', body, {'content-type': f'multipart/form-data; boundary={b}', 'authorization': 'Bearer ' + tok}, method='POST')
    try: return 200, json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
view = lambda: call('GET', '/api/admin/settings', None, A)[1]['stt']
put = lambda b, t=A: call('PUT', '/api/admin/settings', b, t)

v = view()
ok('starts on automatic, with the Groq models listed, turbo first', v['provider'] == 'auto' and v['groq_models'] == ['whisper-large-v3-turbo', 'whisper-large-v3'], v)
ok('only admins can change it', put({'stt_provider': 'groq'}, U)[0] in (401, 403))
s, r = put({'stt_provider': 'groq', 'stt_key': {'groq': 'gsk_secret_value'}})
ok('choosing Groq and saving a key works', s == 200 and r['stt']['provider'] == 'groq' and r['stt']['key_set']['groq'] is True, r.get('stt'))
ok('the key is never sent back', 'gsk_secret_value' not in json.dumps(r) and 'gsk_secret_value' not in json.dumps(view()))
ok('the live status says Groq is available', call('GET', '/api/stt/status', None, U)[1] .items() >= {'available': True, 'provider': 'groq'}.items())
ok('whisper-large-v3-turbo is the default model', view()['active']['model'] == 'whisper-large-v3-turbo')
ok('whisper-large-v3 can be chosen', put({'stt_model': {'groq': 'whisper-large-v3'}})[1]['stt']['active']['model'] == 'whisper-large-v3')
ok('other model names are refused for Groq', put({'stt_model': {'groq': 'gpt-4'}})[0] == 422)
ok('the key is stored encrypted', 'gsk_secret_value' not in open(os.path.join(os.path.dirname(__file__), '..', 'data', 'kokodocs.sqlite3'), 'rb').read().decode('latin1'))
ok('a provider with no key is not available', put({'stt_provider': 'mistral'})[1]['stt']['active']['available'] is False and call('GET', '/api/stt/status')[1]['available'] is False)
ok('unknown providers are refused', put({'stt_provider': 'nope'})[0] == 422)

# a real round trip through a compatible server
s, r = put({'stt_provider': 'openai-compatible', 'stt_url': MOCK, 'stt_key': {'openai-compatible': 'sk-mine'}, 'stt_model': {'openai-compatible': 'my-whisper'}, 'stt_language': 'en'})
ok('an OpenAI-compatible server can be set up', s == 200 and r['stt']['active']['available'] and r['stt']['url'] == MOCK, r.get('stt'))
s, r = transcribe(A)
ok('dictation goes to that server with the key and model', s == 200 and r.get('text') == 'hello world' and SEEN[-1]['auth'] == 'Bearer sk-mine' and SEEN[-1]['model'] == 'my-whisper' and SEEN[-1]['path'] == '/v1/audio/transcriptions' and SEEN[-1]['lang'] == 'en', (s, r, SEEN[-1:]))
s, r = call('POST', '/api/admin/stt/test', {}, A); ok('the test button works', s == 200 and r['ok'] and r['provider'] == 'openai-compatible', (s, r))
put({'stt_key': {'openai-compatible': 'bad'}})
s, r = call('POST', '/api/admin/stt/test', {}, A); ok('a rejected key is reported by the test button', s == 502 and 'key' in json.dumps(r).lower(), (s, r))
ok('removing a key works', put({'stt_clear_key': 'openai-compatible'})[1]['stt']['key_set']['openai-compatible'] is False)
ok('addresses must be http(s)', put({'stt_url': 'ftp://x'})[0] == 422)
s, r = put({'stt_provider': 'local', 'stt_model': {'local': 'small.en'}}); ok('local can be chosen with a model', s == 200 and r['stt']['active']['provider'] in ('local', None) and r['stt']['models']['local'] == 'small.en', r.get('stt'))
ok('unknown local models are refused', put({'stt_model': {'local': 'huge'}})[0] == 422)
ok('going back to automatic works', put({'stt_provider': 'auto'})[1]['stt']['provider'] == 'auto')

# the Groq request itself (in-process: address, model and key as they will be sent)
from app import stt
from app.db import connect, settings_set
from app.security import encrypt_secret
with connect() as db:
    settings_set(db, 'stt_provider', 'groq'); settings_set(db, 'stt_key_groq', encrypt_secret('gsk_x')); settings_set(db, 'stt_model_groq', '')
    c = stt.config(db)
ok('Groq requests go to api.groq.com with whisper-large-v3-turbo', c.url == 'https://api.groq.com/openai/v1/audio/transcriptions' and c.model == 'whisper-large-v3-turbo' and c.key == 'gsk_x' and c.ready, c)
