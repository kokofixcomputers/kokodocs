"""Mention emails. Needs the server on :8000 (fresh data dir) and `python tests/mock_smtp.py 2525` running."""
import json, os, time, urllib.request, urllib.error
B = 'http://localhost:8000'
def call(m, p, body=None, tok=None):
    h = {'content-type': 'application/json'}
    if tok: h['authorization'] = 'Bearer ' + tok
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + p, json.dumps(body).encode() if body is not None else None, h, method=m)); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
def count(to):
    time.sleep(1.3)
    msgs = [json.loads(l) for l in open('/tmp/mock_mail.jsonl')] if os.path.exists('/tmp/mock_mail.jsonl') else []
    return len([m for m in msgs if to in m['to'] and 'mentioned you' in m['data']])
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
A, O, F = signup('koko@kokodev.cc', 'Admin'), signup('owner@m.io', 'Owner'), signup('friend@m.io', 'Friend')
d = call('POST', '/api/docs', {'kind': 'doc'}, O)[1]['id']
call('PUT', f'/api/docs/{d}/sharing', {'link_access': 'restricted', 'link_role': 'viewer', 'shares': [{'email': 'friend@m.io', 'role': 'editor'}, {'email': 'newbie@m.io', 'role': 'viewer'}]}, O)
cm = lambda body: call('POST', f'/api/docs/{d}/comments', {'body': body}, O)
cm('no smtp yet @friend@m.io'); ok('nothing sent while email is not set up (and nothing breaks)', count('friend@m.io') == 0)
call('PUT', '/api/admin/settings', {'smtp_host': '127.0.0.1', 'smtp_port': 2525, 'smtp_security': 'none', 'smtp_from': 'K <n@kokodev.cc>', 'smtp_user': 'u', 'smtp_password': 'p'}, A)
ok('email still reports not active (no test yet)', call('GET', '/api/auth/config')[1]['email'] is False)
cm('saved but never tested @friend@m.io'); ok('mention email sends once SMTP is saved, no test needed', count('friend@m.io') == 1)
cm('capitals @Friend@M.io'); ok('mention with capitals', count('friend@m.io') == 2)
s, r = cm('shared but no account @newbie@m.io'); ok('shared person without an account is still emailed', count('newbie@m.io') == 1 and r['skipped'] == [])
s, r = cm('random address @stranger@gmail.com'); ok('arbitrary address is not emailed, and the commenter is told', count('stranger@gmail.com') == 0 and r['skipped'] == [{'email': 'stranger@gmail.com', 'reason': 'not_shared'}], r.get('skipped'))
signup('linkonly@m.io', 'L'); call('PUT', f'/api/docs/{d}/sharing', {'link_access': 'anyone', 'link_role': 'viewer', 'shares': [{'email': 'friend@m.io', 'role': 'editor'}, {'email': 'newbie@m.io', 'role': 'viewer'}]}, O)
s, r = cm('link-only account @linkonly@m.io'); ok('account that only has the link is not emailed, and the commenter is told', count('linkonly@m.io') == 0 and len(r['skipped']) == 1)
cm('note to self @owner@m.io'); ok('mentioning yourself emails you (useful as a test)', count('owner@m.io') == 1)
ok('but your own plain comments never notify you', not any(i['kind'] == 'comment' for i in call('GET', '/api/notifications', None, O)[1]['items']))
call('PUT', '/api/me/prefs', {'notify_email': False}, F)
cm('after opting out @friend@m.io'); ok('opted-out person gets no email', count('friend@m.io') == 2)
n = call('GET', '/api/notifications', None, F)[1]['items']; ok('but still gets the in-app notification', any('after opting out' in i['text'] for i in n))
call('PUT', '/api/admin/settings', {'smtp_host': '127.0.0.1', 'smtp_port': 1, 'smtp_security': 'none'}, A)
call('PUT', '/api/me/prefs', {'notify_email': True}, F)
s, r = cm('smtp now broken @friend@m.io'); ok('a dead mail server never breaks commenting', s == 200 and r['body'].startswith('smtp now broken'))
