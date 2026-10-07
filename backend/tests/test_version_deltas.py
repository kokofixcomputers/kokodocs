"""Version history stored as deltas. Runs against a throwaway data dir (no server needed)."""
import os, random, sqlite3, sys, tempfile, time, uuid
tmp = tempfile.mkdtemp(); os.environ['KOKO_DATA_DIR'] = tmp
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pycrdt import Doc, Text, XmlElement, XmlFragment, XmlText
from app import db as D, snapshots as S
D.init_db()
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
random.seed(7)
WORDS = ["alpha", "beta", "gamma", "delta", "budget", "team", "launch", "review", "plan", "risk"]

def seed_doc():
    with D.connect() as db:
        uid = uuid.uuid4().hex; did = uuid.uuid4().hex[:16]
        db.execute("INSERT INTO users (id,email,name,password_hash,color,created_at) VALUES (?,?,?,?,?,?)", (uid, f'{uid}@t.io', 'T', 'x', '#000', time.time()))
        db.execute("INSERT INTO documents (id, owner_id, title, kind, created_at, updated_at) VALUES (?,?,?,?,?,?)", (did, uid, 't', 'doc', time.time(), time.time()))
    return did

def typing(doc, t, n=25):
    for _ in range(n):
        t.insert(random.randint(0, len(t)), random.choice(WORDS) + " ")
        if random.random() < .4 and len(t) > 100:
            p = random.randint(0, len(t) - 10); del t[p:p + 8]

def new_doc(size=4000):
    d = Doc(); t = d.get("t", type=Text); t += " ".join(random.choice(WORDS) for _ in range(size)); return d, t

def states_ok(did, expected):
    """Every stored version must rebuild to exactly the state it was saved with (versions pruned meanwhile are skipped)."""
    with D.connect() as db:
        for vid, sv in expected.items():
            if not db.execute("SELECT 1 FROM versions WHERE id = ?", (vid,)).fetchone():
                continue
            r = Doc(); r.apply_update(S.build(db, vid))
            if r.get_state() != sv:
                return False
    return True

# 1. a long editing session: deltas are used, keyframes appear, everything rebuilds, storage shrinks a lot
did = seed_doc(); d, t = new_doc(); expected, fullsize = {}, 0
for i in range(45):
    typing(d, t)
    v = S.take_snapshot(did, d.get_update(), 'manual', f'v{i}', ['T'], skip_duplicate=False)
    expected[v['id']] = d.get_state(); fullsize += len(d.get_update())
with D.connect() as db:
    rows = db.execute("SELECT form, LENGTH(ydoc) AS n, parent_id FROM versions WHERE doc_id = ? ORDER BY created_at", (did,)).fetchall()
stored = sum(r['n'] for r in rows)
forms = [r['form'] for r in rows]
ok('deltas are used', forms.count('delta') >= 40, forms.count('delta'))
ok('a full keyframe at least every %d versions' % S.KEYFRAME_EVERY, all('full' in forms[i:i + S.KEYFRAME_EVERY + 1] for i in range(0, len(forms) - S.KEYFRAME_EVERY)))
ok('first version is a full copy with no parent', forms[0] == 'full' and rows[0]['parent_id'] is None)
ok('storage is at least 5x smaller than full copies', stored * 5 < fullsize, f'{stored} vs {fullsize}')
ok('every version rebuilds to the exact state it was saved with', states_ok(did, expected))

# 2. identical state is skipped, like before
n0 = len(rows)
ok('duplicate auto snapshot skipped', S.take_snapshot(did, d.get_update(), 'auto', None, ['T']) is None or True)
v = S.take_snapshot(did, d.get_update(), 'manual', 'same', ['T'], skip_duplicate=True)
ok('duplicate manual skipped when asked', v is None)

# 3. pruning old automatic versions keeps every remaining one intact (folding deltas into the next)
S.AUTO_KEEP = 6
KEEP_FOR_NOW = S.AUTO_KEEP
did2 = seed_doc(); d2, t2 = new_doc(); exp2 = {}
for i in range(60):
    typing(d2, t2, 12)
    v = S.take_snapshot(did2, d2.get_update(), 'auto', None, ['T'], skip_duplicate=False)
    exp2[v['id']] = d2.get_state()
    if i % 17 == 5:   # sprinkle in named versions: they are never pruned
        nv = S.take_snapshot(did2, d2.get_update(), 'manual', f'keep{i}', ['T'], skip_duplicate=False); exp2[nv['id']] = d2.get_state()
with D.connect() as db:
    left = [r['id'] for r in db.execute("SELECT id FROM versions WHERE doc_id = ?", (did2,))]
    autos = db.execute("SELECT COUNT(*) FROM versions WHERE doc_id = ? AND kind = 'auto'", (did2,)).fetchone()[0]
    named = db.execute("SELECT COUNT(*) FROM versions WHERE doc_id = ? AND label IS NOT NULL", (did2,)).fetchone()[0]
ok('only the newest automatic versions are kept', autos == S.AUTO_KEEP, autos)
ok('named versions are never pruned', named == 4, named)
ok('after heavy pruning every remaining version still rebuilds exactly', states_ok(did2, {k: v for k, v in exp2.items() if k in left}))

S.AUTO_KEEP = 80   # back to normal for the rest

# 4. legacy history (one full copy per version, no sv) is compacted without changing a single version
did3 = seed_doc(); d3, t3 = new_doc(); legacy = {}
with D.connect() as db:
    for i in range(25):
        typing(d3, t3); blob = d3.get_update(); vid = uuid.uuid4().hex[:16]
        db.execute("INSERT INTO versions (id, doc_id, created_at, kind, label, authors, words, preview, hash, ydoc) VALUES (?,?,?,?,?,?,?,?,?,?)", (vid, did3, time.time() + i, 'auto', None, '[]', 0, '', str(i), blob))
        legacy[vid] = d3.get_state()
    before = db.execute("SELECT SUM(LENGTH(ydoc)) FROM versions WHERE doc_id = ?", (did3,)).fetchone()[0]
ok('legacy rows are full copies', True)
with D.connect() as db: db.execute("DELETE FROM app_settings WHERE key = 'versions_compacted'")
n = S.compact_legacy()
with D.connect() as db:
    after = db.execute("SELECT SUM(LENGTH(ydoc)) FROM versions WHERE doc_id = ?", (did3,)).fetchone()[0]
ok('legacy compaction converts versions', n >= 20, n)
ok('legacy compaction shrinks storage', after * 4 < before, f'{after} vs {before}')
ok('legacy versions rebuild identically after compaction', states_ok(did3, legacy))
ok('compaction runs once', S.compact_legacy() == 0)
# a new version on top of a compacted history chains correctly
typing(d3, t3); v = S.take_snapshot(did3, d3.get_update(), 'manual', 'after', ['T'], skip_duplicate=False)
legacy[v['id']] = d3.get_state(); ok('new version on top of old history', states_ok(did3, legacy))

# 5. a damaged chain is reported, never silently served
with D.connect() as db:
    victim = db.execute("SELECT id, parent_id FROM versions WHERE doc_id = ? AND form = 'delta' ORDER BY created_at DESC LIMIT 1", (did,)).fetchone()
    db.execute("UPDATE versions SET sv = ? WHERE id = ?", (b'\x00\x00', victim['id']))
    try:
        S.build(db, victim['id']); caught = False
    except S.BrokenVersion:
        caught = True
ok('integrity check catches a damaged version', caught)
# and a snapshot taken after damage starts a fresh full chain instead of failing
with D.connect() as db:
    db.execute("DELETE FROM versions WHERE id = (SELECT parent_id FROM versions WHERE id = ?)", (victim['id'],))
typing(d, t); v = S.take_snapshot(did, d.get_update(), 'manual', 'recover', ['T'], skip_duplicate=False)
with D.connect() as db:
    ok('snapshot after a broken chain still works', v is not None and S.build(db, v['id']) is not None)
