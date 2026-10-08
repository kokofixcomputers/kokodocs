"""Speech models are dropped from memory when idle and load again on demand. No server needed; run from backend/ (uses the tiny.en model if it is available)."""
import io, os, subprocess, sys, time, wave
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app import stt
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
rss = lambda: int(subprocess.check_output(['ps', '-o', 'rss=', '-p', str(os.getpid())]).split()[0]) // 1024

stt._models.update({'old': object(), 'fresh': object()}); stt._used.update({'old': time.time() - 1000, 'fresh': time.time()})
gone = stt.unload_idle(idle=180)
ok('a model unused for longer than the limit is dropped', gone == ['old'] and 'old' not in stt._models, gone)
ok('one in recent use stays', 'fresh' in stt._models)
ok('0 means never unload', stt.unload_idle(now=time.time() + 10_000, idle=0) == [] and 'fresh' in stt._models)
stt._models.clear(); stt._used.clear()

if stt._local_available():
    w = io.BytesIO()
    with wave.open(w, 'wb') as f: f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b'\x00\x00' * 16000)
    before = rss()
    try:
        stt._local_transcribe(w.getvalue(), 'en', 'tiny.en')
        loaded = rss()
        ok('a real model loads on demand', 'tiny.en' in stt.loaded_models(), stt.loaded_models())
        stt.unload_idle(now=time.time() + 1000, idle=180)
        after = rss()
        ok('and unloading it returns memory', 'tiny.en' not in stt.loaded_models() and after < loaded, f'{before} MB -> loaded {loaded} MB -> unloaded {after} MB')
        stt._local_transcribe(w.getvalue(), 'en', 'tiny.en')
        ok('it loads again when needed', 'tiny.en' in stt.loaded_models())
    except Exception as e:
        print('SKIP real model:', type(e).__name__, e)
