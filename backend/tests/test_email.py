"""Needs the server on :8000 (fresh data dir) and `python tests/mock_smtp.py 2525` running."""
import json, re, time
src = open(__file__.replace('test_email', 'test_quota')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c: print(('PASS ' if c else 'FAIL ') + n)
def last_code(to):
    msgs = [json.loads(l) for l in open('/tmp/mock_mail.jsonl')] if __import__('os').path.exists('/tmp/mock_mail.jsonl') else []
    m = [x for x in msgs if to in x['to']][-1]
    return re.search(r'Subject: (\d{6}) is', m['data']).group(1)
_, a = call('POST', '/api/auth/signup', {'email': 'koko@kokodev.cc', 'name': 'K', 'password': 'password123'}); A = a['token']
s, c = call('GET', '/api/auth/config'); ok('email off by default', c['email'] is False)
s, _ = call('POST', '/api/auth/signup/start', {'email': 'e1@x.io', 'name': 'E', 'password': 'password123'}); ok('start 404 when not set up', s == 404)
s, _ = call('POST', '/api/admin/email/test', None, A); ok('test needs config', s == 400)
s, r = call('PUT', '/api/admin/settings', {'smtp_host': '127.0.0.1', 'smtp_port': 2525, 'smtp_security': 'none', 'smtp_from': 'KokoDocs <noreply@kokodev.cc>', 'smtp_user': 'u', 'smtp_password': 'p'}, A)
ok('smtp saved, secret hidden, not active', r['smtp_host'] == '127.0.0.1' and r['smtp_password_set'] and not r['email_active'] and 'smtp_password"' not in json.dumps(r).replace('smtp_password_set', ''))
s, c = call('GET', '/api/auth/config'); ok('still off before test', c['email'] is False)
s, r = call('POST', '/api/admin/email/test', None, A); ok('test email sent', s == 200)
s, c = call('GET', '/api/auth/config'); ok('email active after test', c['email'] is True)
s, r = call('POST', '/api/auth/signup', {'email': 'e1@x.io', 'name': 'E', 'password': 'password123'}); ok('plain signup blocked', s == 400)
s, r = call('POST', '/api/auth/signup/start', {'email': 'e1@x.io', 'name': 'E One', 'password': 'password123'}); ok('start sends code', s == 200)
s, r = call('POST', '/api/auth/login', {'email': 'e1@x.io', 'password': 'password123'}); ok('no account before confirming', s == 401)
s, _ = call('POST', '/api/auth/signup/start', {'email': 'e1@x.io', 'name': 'E One', 'password': 'password123'}); ok('resend cooldown', s == 429)
code = last_code('e1@x.io'); wrong = '000000' if code != '000000' else '111111'
s, _ = call('POST', '/api/auth/signup/verify', {'email': 'e1@x.io', 'code': wrong}); ok('wrong code rejected', s == 400)
s, r = call('POST', '/api/auth/signup/verify', {'email': 'e1@x.io', 'code': code}); ok('right code creates account + token', s == 200 and 'token' in r and r['user']['name'] == 'E One')
s, _ = call('POST', '/api/auth/signup/verify', {'email': 'e1@x.io', 'code': code}); ok('code single use', s == 400)
s, _ = call('POST', '/api/auth/login', {'email': 'e1@x.io', 'password': 'password123'}); ok('can sign in now', s == 200)
# lockout after 5 wrong codes
call('POST', '/api/auth/signup/start', {'email': 'e2@x.io', 'name': 'E2', 'password': 'password123'})
for _i in range(5): call('POST', '/api/auth/signup/verify', {'email': 'e2@x.io', 'code': '999999' if last_code('e2@x.io') != '999999' else '888888'})
s, _ = call('POST', '/api/auth/signup/verify', {'email': 'e2@x.io', 'code': last_code('e2@x.io')}); ok('locked after too many wrong codes', s == 400)
# password reset
s, _ = call('POST', '/api/auth/password/forgot', {'email': 'nobody@x.io'}); ok('forgot is silent for unknown email', s == 200)
s, _ = call('POST', '/api/auth/password/forgot', {'email': 'e1@x.io'}); ok('forgot sends for real user', s == 200)
rc = last_code('e1@x.io')
s, _ = call('POST', '/api/auth/password/reset', {'email': 'e1@x.io', 'code': '123456' if rc != '123456' else '654321', 'password': 'newpassword99'}); ok('reset wrong code rejected', s == 400)
s, _ = call('POST', '/api/auth/password/reset', {'email': 'e1@x.io', 'code': rc, 'password': 'newpassword99'}); ok('reset works', s == 200)
s, _ = call('POST', '/api/auth/login', {'email': 'e1@x.io', 'password': 'password123'}); ok('old password dead', s == 401)
s, _ = call('POST', '/api/auth/login', {'email': 'e1@x.io', 'password': 'newpassword99'}); ok('new password works', s == 200)
# editing smtp deactivates until retested; removal turns it off
s, r = call('PUT', '/api/admin/settings', {'smtp_port': 2526}, A); ok('changing smtp deactivates', r['email_active'] is False)
call('PUT', '/api/admin/settings', {'smtp_port': 2525}, A); s, _ = call('POST', '/api/admin/email/test', None, A)
s, _ = call('DELETE', '/api/admin/email', None, A); s, c = call('GET', '/api/auth/config'); ok('removal turns email off', c['email'] is False)
s, r = call('POST', '/api/auth/signup', {'email': 'plain@x.io', 'name': 'P', 'password': 'password123'}); ok('plain signup works again', s == 200)
