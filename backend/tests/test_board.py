"""Boards: the new document kind is accepted and its cards, columns and text fields are searchable. Needs the server on :8000."""
import os, sys
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pycrdt import Doc, Map
from app.searchindex import extract_text
T = call('POST', '/api/auth/signup', {'email': 'b@bd.io', 'name': 'B', 'password': 'password123'})[1]['token']
s, d = call('POST', '/api/docs', {'kind': 'board'}, T)
ok('a board can be created', s == 200 and d['kind'] == 'board', (s, d))
ok('it gets a default title', d['title'] == 'Untitled board')
doc = Doc()
doc['cols'] = Map({'a': {'name': 'Backlog', 'color': '#fff'}})
doc['cards'] = Map({'c1': {'col': 'a', 'rank': 1, 'title': 'Fix the zebra crossing', 'desc': 'near the library', 'v': {'f1': 'opt-id', 'f2': 3}, 'at': 1}})
text = extract_text(doc.get_update(), 'board')
ok('column names, card titles and descriptions are searchable', all(w in text for w in ['Backlog', 'zebra', 'library']), text)
