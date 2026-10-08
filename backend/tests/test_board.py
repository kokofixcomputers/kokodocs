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

# comments are pushed over the document's websocket instead of being polled
import asyncio, websockets
async def pushed():
    tok2 = call('POST', '/api/auth/signup', {'email': 'c@bd.io', 'name': 'C', 'password': 'password123'})[1]['token']
    call('PUT', f'/api/docs/{d["id"]}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'c@bd.io', 'role': 'viewer'}]}, T)
    got = {}
    async with websockets.connect(f'ws://localhost:8000/ws/docs/{d["id"]}?token={tok2}') as ws:      # a viewer listening
        await ws.recv()   # the document itself
        async def comment(label, fn):
            await asyncio.to_thread(fn)
            try:
                while True:
                    m = await asyncio.wait_for(ws.recv(), 3)
                    if m[0] == 3: got[label] = True; return
            except asyncio.TimeoutError: got[label] = False
        r = {}
        def add(): r['c'] = call('POST', f'/api/docs/{d["id"]}/comments', {'body': 'hello', 'anchor': {'card': 'x'}}, T)[1]
        await comment('add', add)
        await comment('resolve', lambda: call('PUT', f'/api/docs/{d["id"]}/comments/{r["c"]["id"]}/resolved', {'resolved': True}, T))
        await comment('delete', lambda: call('DELETE', f'/api/docs/{d["id"]}/comments/{r["c"]["id"]}', None, T))
    return got
got = asyncio.run(pushed())
ok('adding a comment pings everyone connected', got.get('add'), got)
ok('resolving pings', got.get('resolve'), got)
ok('deleting pings', got.get('delete'), got)
