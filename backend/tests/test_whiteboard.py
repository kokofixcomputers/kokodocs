"""Whiteboards: the kind is accepted, what is drawn is searchable, readable by Koko (shapes, places, text, what arrows join) and summarised in version history. Needs the server on :8000."""
import os, sys
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pycrdt import Doc, Map
from app.searchindex import extract_text
from app.readdoc import render
from app.snapshots import summarize
T = call('POST', '/api/auth/signup', {'email': 'w@wb.io', 'name': 'W', 'password': 'password123'})[1]['token']
s, d = call('POST', '/api/docs', {'kind': 'whiteboard'}, T)
ok('a whiteboard can be created', s == 200 and d['kind'] == 'whiteboard', (s, d))
ok('it gets a default title', d['title'] == 'Untitled whiteboard')
doc = Doc()
doc['els'] = Map({
    'a': {'id': 'a', 'type': 'rect', 'x': 100, 'y': 50, 'w': 160, 'h': 90, 'z': 1, 'text': 'Receive order'},
    'b': {'id': 'b', 'type': 'diamond', 'x': 100, 'y': 250, 'w': 160, 'h': 110, 'z': 2, 'text': 'In stock?'},
    'c': {'id': 'c', 'type': 'arrow', 'x': 180, 'y': 140, 'w': 0, 'h': 110, 'z': 3, 'from': {'id': 'a'}, 'to': {'id': 'b'}, 'text': 'check'},
    'd': {'id': 'd', 'type': 'text', 'x': 400, 'y': 60, 'w': 120, 'h': 30, 'z': 4, 'text': 'Zebra warehouse'},
    'e': {'id': 'e', 'type': 'frame', 'x': 60, 'y': 20, 'w': 500, 'h': 400, 'z': 0, 'name': 'Order flow', 'ai': True},
    'f': {'id': 'f', 'type': 'rect', 'x': 0, 'y': 0, 'w': 5, 'h': 5, 'z': 5, 'text': 'secret', 'hide': True},
})
blob = doc.get_update()
text = extract_text(blob, 'whiteboard')
ok('words on shapes, text and frame names are searchable', all(w in text for w in ['Receive order', 'In stock?', 'Zebra warehouse', 'Order flow']), text)
out, cut = render(blob, 'whiteboard')
ok('Koko can read it: shapes with their place, size and words', 'rect at (100, 50), 160×90: Receive order' in out and 'diamond at (100, 250)' in out, out)
ok('and what an arrow joins', 'arrow from “Receive order” to “In stock?”: check' in out, out)
ok('frames are listed with their names', 'frame “Order flow”' in out, out)
ok('hidden things are left out', 'secret' not in out, out)
ok('back to front: the frame (layer 0) comes first', out.splitlines()[0].startswith('- frame'), out.splitlines()[:2])
n, preview = summarize(blob)
ok('version history counts the things and previews their words', n == 6 and 'Receive order' in preview, (n, preview))
# kind filter in search
s, r = call('GET', '/api/search?kind=whiteboard', None, T)
ok('search can filter to whiteboards', s == 200 and any(x['id'] == d['id'] for x in r), (s, r))
