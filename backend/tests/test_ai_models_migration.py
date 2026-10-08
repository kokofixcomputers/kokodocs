"""Connections saved before there was a list of models carry over: the system one becomes a global model, each person's own becomes one of theirs. No server needed; run from backend/."""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
from app import db as D
tmp = tempfile.mkdtemp(); D.DATA_DIR = D.Path(tmp); D.DB_PATH = D.DATA_DIR / 'kokodocs.sqlite3'
con = sqlite3.connect(D.DB_PATH); con.row_factory = sqlite3.Row
con.executescript(open(D.__file__).read().split('SCHEMA = """')[1].split('"""')[0])
for u in ('u1', 'u2', 'u3'): con.execute("INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?,?,?,?,'#fff',1)", (u, u + '@x.io', u, 'h'))
for k, v in (('ai_sys_url', 'https://sys.example/v1'), ('ai_sys_model', 'big-model'), ('ai_sys_key', 'gAAAAsys')): con.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)", (k, v))
con.execute("INSERT INTO ai_settings (user_id, base_url, model, key_enc, updated_at) VALUES ('u1','https://mine.example/v1','my-model','gAAAAmine',1)")
con.execute("INSERT INTO ai_settings (user_id, base_url, model, key_enc, updated_at) VALUES ('u2','https://two.example/v1','two-model',NULL,1)")
con.commit()
D.migrate(con); D.migrate(con)   # twice: harmless
rows = {r['id']: dict(r) for r in con.execute("SELECT * FROM ai_models")}
sysrows = [r for r in rows.values() if r['scope'] == 'system']
ok('the system connection became one global model, key intact', len(sysrows) == 1 and sysrows[0]['base_url'] == 'https://sys.example/v1' and sysrows[0]['model'] == 'big-model' and sysrows[0]['key_enc'] == 'gAAAAsys' and sysrows[0]['enabled'] == 1, sysrows)
own = {r['user_id']: r for r in rows.values() if r['scope'] == 'user'}
ok('each person\'s own connection became one of theirs, once', set(own) == {'u1', 'u2'} and own['u1']['model'] == 'my-model' and own['u1']['key_enc'] == 'gAAAAmine' and own['u2']['key_enc'] is None, own)
sel = {r['id']: r['ai_model'] for r in con.execute("SELECT id, ai_model FROM users")}
ok('people who had their own keep using it', sel['u1'] == own['u1']['id'] and sel['u2'] == own['u2']['id'] and sel['u3'] == '', sel)
