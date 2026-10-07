import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get("KOKO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
FORM_FILES_DIR = DATA_DIR / "form-files"   # files people attach to form responses (never served inline)
DB_PATH = DATA_DIR / "kokodocs.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled document',
  ydoc BLOB,
  link_access TEXT NOT NULL DEFAULT 'restricted',  -- restricted | anyone | password
  link_role TEXT NOT NULL DEFAULT 'viewer',        -- viewer | editor
  link_password_hash TEXT,
  folder_id TEXT,
  deleted_at REAL,
  kind TEXT NOT NULL DEFAULT 'doc',   -- doc | sheet | slides | form | wiki
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT,
  name TEXT NOT NULL,
  link_access TEXT NOT NULL DEFAULT 'restricted',  -- restricted | anyone
  link_role TEXT NOT NULL DEFAULT 'viewer',
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS folder_shares (
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (folder_id, email)
);
CREATE INDEX IF NOT EXISTS idx_folder_shares_email ON folder_shares(email);
CREATE TABLE IF NOT EXISTS ai_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  key_enc TEXT,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_conv ON ai_conversations(doc_id, user_id, updated_at);
CREATE TABLE IF NOT EXISTS uploads (
  name TEXT PRIMARY KEY,
  doc_id TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size INTEGER NOT NULL,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(doc_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS stars (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at REAL NOT NULL,
  PRIMARY KEY (user_id, doc_id)
);
CREATE TABLE IF NOT EXISTS recents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  opened_at REAL NOT NULL,
  PRIMARY KEY (user_id, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_recents_user ON recents(user_id, opened_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  doc_id TEXT,
  doc_title TEXT,
  actor_name TEXT,
  text TEXT NOT NULL DEFAULT '',
  link TEXT,
  created_at REAL NOT NULL,
  read_at REAL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS email_codes (
  key TEXT PRIMARY KEY,            -- kind:email
  code_hash TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  expires_at REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  mentions TEXT NOT NULL DEFAULT '[]',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id, created_at);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at REAL NOT NULL,
  kind TEXT NOT NULL,            -- auto | manual
  label TEXT,
  authors TEXT NOT NULL DEFAULT '[]',
  words INTEGER NOT NULL DEFAULT 0,
  preview TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  ydoc BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS form_responses (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  data TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_resp ON form_responses(form_id, created_at);
CREATE TABLE IF NOT EXISTS form_files (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  response_id TEXT,              -- NULL until the response is submitted; stale ones are swept
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_files_form ON form_files(form_id, response_id);
CREATE TABLE IF NOT EXISTS doc_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  created_at REAL NOT NULL,
  PRIMARY KEY (user_id, doc_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_doc_tags_user ON doc_tags(user_id, tag);
CREATE TABLE IF NOT EXISTS folder_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  created_at REAL NOT NULL,
  PRIMARY KEY (user_id, folder_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_folder_tags_user ON folder_tags(user_id, tag);
CREATE TABLE IF NOT EXISTS shares (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (doc_id, email)
);
CREATE INDEX IF NOT EXISTS idx_shares_email ON shares(email);
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(doc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id);
"""


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    FORM_FILES_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(SCHEMA)
        migrate(db)


def migrate(db: sqlite3.Connection) -> None:
    """Bring databases created by older versions up to date (safe to run every start)."""
    # pictures are stored once per owner: the same bytes added again (to this file or another) reuse the stored copy
    if "hash" not in {r["name"] for r in db.execute("PRAGMA table_info(uploads)")}:
        db.execute("ALTER TABLE uploads ADD COLUMN hash TEXT")
    db.execute("CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(owner_id, hash)")
    db.execute("CREATE TABLE IF NOT EXISTS image_aliases (name TEXT PRIMARY KEY, target TEXT NOT NULL)")   # addresses of merged duplicates -> the surviving copy
    db.execute("CREATE INDEX IF NOT EXISTS idx_alias_target ON image_aliases(target)")
    db.execute("CREATE TABLE IF NOT EXISTS upload_refs (name TEXT NOT NULL, doc_id TEXT NOT NULL, PRIMARY KEY (name, doc_id))")
    db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) SELECT name, doc_id FROM uploads WHERE doc_id IS NOT NULL")
    import hashlib
    for r in db.execute("SELECT name FROM uploads WHERE hash IS NULL").fetchall():
        try:
            h = hashlib.sha256((UPLOAD_DIR / r["name"]).read_bytes()).hexdigest()
        except OSError:
            h = "-"
        db.execute("UPDATE uploads SET hash = ? WHERE name = ?", (h, r["name"]))
    ucols = {r["name"] for r in db.execute("PRAGMA table_info(users)")}
    if "is_admin" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    for col, ddl in (("totp_secret", "TEXT"), ("totp_enabled", "INTEGER NOT NULL DEFAULT 0"), ("totp_recovery", "TEXT NOT NULL DEFAULT '[]'"), ("totp_last", "INTEGER NOT NULL DEFAULT 0")):
        if col not in ucols:
            db.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
    for col in ("google_sub", "google_email"):
        if col not in ucols:
            db.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub) WHERE google_sub IS NOT NULL")
    if "notify_email" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1")
    ccols = {r["name"] for r in db.execute("PRAGMA table_info(comments)")}
    if "anchor" not in ccols:
        db.execute("ALTER TABLE comments ADD COLUMN anchor TEXT")
    if "email_verified" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
    if "quota_mb" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN quota_mb INTEGER")
    if "pw_set" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN pw_set INTEGER NOT NULL DEFAULT 1")
    if "disabled" not in ucols:
        db.execute("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0")
    vcols = {r["name"] for r in db.execute("PRAGMA table_info(versions)")}
    for col, ddl in (("parent_id", "TEXT"), ("form", "TEXT NOT NULL DEFAULT 'full'"), ("sv", "BLOB")):   # delta storage: see snapshots.py
        if col not in vcols:
            db.execute(f"ALTER TABLE versions ADD COLUMN {col} {ddl}")
    db.execute("CREATE INDEX IF NOT EXISTS idx_versions_parent ON versions(parent_id)")
    cols = {r["name"] for r in db.execute("PRAGMA table_info(documents)")}
    if "folder_id" not in cols:
        db.execute("ALTER TABLE documents ADD COLUMN folder_id TEXT")
    if "deleted_at" not in cols:
        db.execute("ALTER TABLE documents ADD COLUMN deleted_at REAL")
    if "kind" not in cols:
        db.execute("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc'")
    db.execute("CREATE INDEX IF NOT EXISTS idx_docs_folder ON documents(folder_id)")
    fcols = {r["name"] for r in db.execute("PRAGMA table_info(folders)")}
    if "link_access" not in fcols:
        db.execute("ALTER TABLE folders ADD COLUMN link_access TEXT NOT NULL DEFAULT 'restricted'")
    if "color" not in fcols:
        db.execute("ALTER TABLE folders ADD COLUMN color TEXT")
    if "link_role" not in fcols:
        db.execute("ALTER TABLE folders ADD COLUMN link_role TEXT NOT NULL DEFAULT 'viewer'")


@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def get_db():
    with connect() as db:
        yield db


def settings_get(db: sqlite3.Connection, key: str, default: str = "") -> str:
    r = db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return r["value"] if r else default


def settings_set(db: sqlite3.Connection, key: str, value: str) -> None:
    db.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
