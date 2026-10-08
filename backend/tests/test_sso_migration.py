"""People who used the old built-in Google sign-in keep it: their settings become the "google" provider and linked accounts carry over. No server needed; run from backend/."""
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
from app import db as D
tmp = tempfile.mkdtemp(); D.DATA_DIR = D.Path(tmp); D.DB_PATH = D.DATA_DIR / 'kokodocs.sqlite3'
con = sqlite3.connect(D.DB_PATH); con.row_factory = sqlite3.Row
con.executescript(D.SCHEMA if hasattr(D, 'SCHEMA') else open(D.__file__).read().split('SCHEMA = """')[1].split('"""')[0])
for c in ("google_sub TEXT", "google_email TEXT"):
    try: con.execute(f"ALTER TABLE users ADD COLUMN {c}")
    except sqlite3.OperationalError: pass
con.execute("INSERT INTO users (id, email, name, password_hash, color, created_at, google_sub, google_email) VALUES ('u1','g@x.io','G','h','#fff',1,'sub-123','g@x.io')")
con.execute("INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES ('u2','n@x.io','N','h','#fff',1)")
for k, v in (('google_client_id', 'old-client'), ('google_client_secret', 'gAAAAencrypted')): con.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)", (k, v))
con.commit()
D.migrate(con); D.migrate(con)   # twice: it must be harmless to run again
p = con.execute("SELECT * FROM sso_providers").fetchall()
ok('the old Google settings became one "google" provider', len(p) == 1 and p[0]['id'] == 'google' and p[0]['client_id'] == 'old-client' and p[0]['client_secret_enc'] == 'gAAAAencrypted' and p[0]['enabled'] == 1 and p[0]['verified_field'] == 'email_verified', [dict(x) for x in p])
i = con.execute("SELECT * FROM user_identities").fetchall()
ok('linked Google accounts carried over, once', len(i) == 1 and i[0]['provider'] == 'google' and i[0]['subject'] == 'sub-123' and i[0]['user_id'] == 'u1' and i[0]['label'] == 'g@x.io', [dict(x) for x in i])
