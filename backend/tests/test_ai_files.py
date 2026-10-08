"""The assistant may read a person's OTHER files only if they allow it. Server on :8000 with a fresh data dir; run from backend/."""
import os, sys, sqlite3, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
ME, OTHER, STR = signup('me@af.io', 'Me'), signup('boss@af.io', 'Boss'), signup('stranger@af.io', 'Stranger')

def put(tok, title, kind, build):
    did = call('POST', '/api/docs', {'title': title, 'kind': kind}, tok)[1]['id']
    d = Doc(); build(d)
    from app.db import DATA_DIR
    con = sqlite3.connect(os.path.join(os.environ.get('KOKO_DATA', str(DATA_DIR)), 'kokodocs.sqlite3')); con.execute('UPDATE documents SET ydoc = ? WHERE id = ?', (d.get_update(), did))
    con.execute('DELETE FROM doc_fts WHERE doc_id = ?', (did,))
    from app.searchindex import extract_text
    con.execute('INSERT INTO doc_fts (doc_id, title, body) VALUES (?,?,?)', (did, title, extract_text(d.get_update(), kind))); con.commit()
    return did
def doc_body(d):
    f = d.get('default', type=XmlFragment); h = XmlElement('heading', {'level': 1}); f.children.append(h); h.children.append(XmlText('Zebrafish budget'))
    p = XmlElement('paragraph'); f.children.append(p); p.children.append(XmlText('The marmoset grant is 4200 dollars.'))
def sheet_body(d):
    d['tabs'] = Map({'t1': {'id': 't1', 'name': 'Costs', 'order': 0}}); d['cells:t1'] = Map({'0,0': {'v': 'Item'}, '0,1': {'v': 'Cost'}, '1,0': {'v': 'Marmoset feed'}, '1,1': {'v': '=300*4'}})
mine = put(ME, 'My notes', 'doc', doc_body)
shared = put(OTHER, 'Boss plan', 'sheet', sheet_body)
secret = put(OTHER, 'Boss private', 'doc', lambda d: doc_body(d))
call('PUT', f'/api/docs/{shared}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'me@af.io', 'role': 'viewer'}]}, OTHER)
linkonly = put(OTHER, 'Public by link', 'doc', doc_body)
call('PUT', f'/api/docs/{linkonly}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': []}, OTHER)

ok('it is off by default', call('GET', '/api/me/ai-files', None, ME)[1]['mode'] == 'off')
ok('while off, searching is refused', call('GET', '/api/ai/files?q=marmoset', None, ME)[0] == 403)
ok('while off, reading is refused', call('GET', f'/api/ai/files/{mine}', None, ME)[0] == 403)
ok('only signed-in people can use it', call('GET', '/api/ai/files')[0] in (401, 403))
ok('a bad mode is refused', call('PUT', '/api/me/ai-files', {'mode': 'sure'}, ME)[0] == 422)
s, r = call('PUT', '/api/me/ai-files', {'mode': 'ask'}, ME); ok('it can be switched on (ask first)', s == 200 and call('GET', '/api/me/ai-files', None, ME)[1]['mode'] == 'ask')
ok('the setting is per person', call('GET', '/api/me/ai-files', None, OTHER)[1]['mode'] == 'off')

s, hits = call('GET', '/api/ai/files?q=marmoset', None, ME)
ids = [h['id'] for h in hits]
ok('search finds my file and the one shared with me', mine in ids and shared in ids, hits)
ok('search leaves out files I cannot open, and public-link files', secret not in ids and linkonly not in ids, ids)
ok('search can leave out the file I am working in', mine not in [h['id'] for h in call('GET', f'/api/ai/files?q=marmoset&exclude={mine}', None, ME)[1]])
s, lst = call('GET', '/api/ai/files', None, ME)
ok('with no query it lists recent files I can open', s == 200 and {mine, shared} <= {x['id'] for x in lst} and secret not in {x['id'] for x in lst}, lst)
s, r = call('GET', f'/api/ai/files/{mine}', None, ME)
ok('reading my own document gives structured text', s == 200 and '# Zebrafish budget' in r['text'] and 'marmoset grant' in r['text'], r)
s, r = call('GET', f'/api/ai/files/{shared}', None, ME)
ok('reading a shared spreadsheet gives its cells', s == 200 and 'A=Marmoset feed' in r['text'] and 'B==300*4' in r['text'] and r['owner'] == 'Boss' and r['kind'] == 'sheet', r)
ok('a file I cannot open looks like it does not exist', call('GET', f'/api/ai/files/{secret}', None, ME)[0] == 404)
ok('so does a public-link file that was not shared with me', call('GET', f'/api/ai/files/{linkonly}', None, ME)[0] == 404)
ok('so does a stranger asking for mine', (call('PUT', '/api/me/ai-files', {'mode': 'allow'}, STR), call('GET', f'/api/ai/files/{mine}', None, STR)[0])[1] == 404)
ok('the info call (for the permission card) gives just the name', call('GET', f'/api/ai/files/{shared}/info', None, ME)[1]['title'] == 'Boss plan')
call('PUT', '/api/me/ai-files', {'mode': 'off'}, ME)
ok('switching it off stops everything again', call('GET', f'/api/ai/files/{mine}', None, ME)[0] == 403)
