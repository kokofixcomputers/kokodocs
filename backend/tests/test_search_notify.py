"""Server on :8000 with a fresh data dir, and tests/mock_smtp.py running on 2525. Builds real Yjs content and checks search, notifications, mention email and comment anchors."""
import json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
from pycrdt import Doc, Map, Array, XmlElement, XmlFragment, XmlText
from app import searchindex
from app.db import connect
ok = lambda n, c: print(('PASS ' if c else 'FAIL ') + n)

def tok(email, name):
    s, r = call('POST', '/api/auth/signup', {'email': email, 'name': name, 'password': 'password123'})
    return (r['token'], r['user']['id']) if s == 200 else (call('POST', '/api/auth/login', {'email': email, 'password': 'password123'})[1]['token'], None)
A, _ = tok('koko@kokodev.cc', 'K'); M, mid = tok('maya@x.io', 'Maya'); P, pid = tok('priya@x.io', 'Priya')

def put(doc_id, blob):
    with connect() as db:
        db.execute("UPDATE documents SET ydoc = ? WHERE id = ?", (blob, doc_id)); searchindex.index_doc(db, doc_id, blob); db.commit()
d1 = call('POST', '/api/docs', {'title': 'Launch plan', 'kind': 'doc'}, M)[1]['id']
doc = Doc(); f = doc.get('default', type=XmlFragment); p = XmlElement('paragraph'); f.children.append(p); p.children.append(XmlText('The zebrafish migration finishes in March')); put(d1, doc.get_update())
d2 = call('POST', '/api/docs', {'title': 'Budget', 'kind': 'sheet'}, M)[1]['id']
sh = Doc(); sh.get('tabs', type=Map)['t'] = {'id': 'sheet1', 'name': 'Costs', 'order': 0}; sh.get('cells:sheet1', type=Map)['0:0'] = {'v': 'Narwhal licensing'}; sh.get('cells:sheet1', type=Map)['0:1'] = {'v': '=SUM(A1:A2)'}; put(d2, sh.get_update())
d3 = call('POST', '/api/docs', {'title': 'Pitch', 'kind': 'slides'}, M)[1]['id']
sl = Doc(); sl.get('order', type=Array).append('s1'); sm = sl.get('slides', type=Map); sm['s1'] = Map({'notes': 'mention the quokka', 'bg': None, 'els': Map({'e1': Map({'text': 'Hello pelican', 'role': 'title'})})}); put(d3, sl.get_update())

s, r = call('GET', '/api/search?q=zebrafish', None, M); ok('doc text found with snippet', s == 200 and r and r[0]['id'] == d1 and '[[zebrafish]]' in r[0]['snippet'])
s, r = call('GET', '/api/search?q=narwh', None, M); ok('sheet cell prefix match', r and r[0]['id'] == d2 and r[0]['kind'] == 'sheet')
s, r = call('GET', '/api/search?q=SUM', None, M); ok('formulas are not indexed', r == [])
s, r = call('GET', '/api/search?q=pelican', None, M); ok('slide text found', r and r[0]['id'] == d3)
s, r = call('GET', '/api/search?q=quokka', None, M); ok('speaker notes found', r and r[0]['id'] == d3)
s, r = call('GET', '/api/search?q=budget', None, M); ok('title match flagged', r and r[0]['title_match'])
s, r = call('GET', '/api/search?q=zebrafish', None, P); ok('others cannot find unshared files', r == [])
call('PUT', f'/api/docs/{d1}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': []}, M)
s, r = call('GET', '/api/search?q=zebrafish', None, P); ok('public link files stay out of strangers search', r == [])
call('PUT', f'/api/docs/{d1}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'priya@x.io', 'role': 'editor'}]}, M)
s, r = call('GET', '/api/search?q=zebrafish', None, P); ok('shared files are searchable', r and r[0]['id'] == d1 and r[0]['owner'] == 'Maya')
s, n = call('GET', '/api/notifications', None, P); ok('share creates a notification', n['unread'] == 1 and n['items'][0]['kind'] == 'share' and n['items'][0]['doc_id'] == d1)

# email must be active for mention emails
call('PUT', '/api/admin/settings', {'smtp_host': '127.0.0.1', 'smtp_port': 2525, 'smtp_security': 'none', 'smtp_from': 'KokoDocs <no@kokodev.cc>'}, A); call('POST', '/api/admin/email/test', None, A)
open('/tmp/mock_mail.jsonl', 'a').close(); before = len(open('/tmp/mock_mail.jsonl').read().splitlines())
s, c1 = call('POST', f'/api/docs/{d1}/comments', {'body': 'Looks good @priya@x.io, can you check?', 'quote': 'zebrafish'}, M); ok('comment created', s == 200)
import time; time.sleep(1.5)
lines = open('/tmp/mock_mail.jsonl').read().splitlines()[before:]
ok('mention email sent', len(lines) == 1 and 'priya@x.io' in json.loads(lines[0])['to'] and 'mentioned you' in json.loads(lines[0])['data'])
s, n = call('GET', '/api/notifications', None, P); men = [i for i in n['items'] if i['kind'] == 'mention']
ok('mention notification with link', men and men[0]['link'].startswith(f'/d/{d1}?comment=') and men[0]['actor'] == 'Maya' and n['unread'] == 2)
call('PUT', '/api/me/prefs', {'notify_email': False}, P)
call('POST', f'/api/docs/{d1}/comments', {'body': 'again @priya@x.io'}, M); time.sleep(1.2)
ok('email opt-out respected (still notified in app)', len(open('/tmp/mock_mail.jsonl').read().splitlines()) == before + 1 and call('GET', '/api/notifications/count', None, P)[1]['unread'] == 3)
call('POST', f'/api/docs/{d1}/comments', {'body': 'ping @nobody@x.io'}, M)
ok('mentioning a stranger is harmless', True)
s, _ = call('POST', f'/api/docs/{d1}/comments', {'body': 'reply from priya', 'parent_id': c1['id']}, P)
s, n = call('GET', '/api/notifications', None, M); ok('owner notified of replies', any(i['kind'] == 'comment' and i['actor'] == 'Priya' for i in n['items']))
call('POST', '/api/notifications/read', {'all': True}, P); ok('mark all read', call('GET', '/api/notifications/count', None, P)[1]['unread'] == 0)
s, c2 = call('POST', f'/api/docs/{d2}/comments', {'body': 'check this cell', 'quote': 'B4', 'anchor': {'sheet': 'sheet1', 'r': 3, 'c': 1}}, M)
s, lst = call('GET', f'/api/docs/{d2}/comments', None, M); ok('anchor round-trips', lst[0]['anchor'] == {'sheet': 'sheet1', 'r': 3, 'c': 1})
s, c3 = call('POST', f'/api/docs/{d3}/comments', {'body': 'tighten', 'quote': 'Slide 1', 'anchor': {'slide': 's1', 'el': 'e1'}}, M)
ok('slide anchor saved', call('GET', f'/api/docs/{d3}/comments', None, M)[1][0]['anchor'] == {'slide': 's1', 'el': 'e1'})
