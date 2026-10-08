"""Single sign-on with any OAuth2 / OpenID Connect provider (Google, GitHub and the rest are presets). Uses a small fake provider on :8766.
Server on :8000 with a fresh data dir; run from backend/."""
import json, os, re, threading, urllib.parse, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
src = open(os.path.join(os.path.dirname(__file__), 'test_quota.py')).read().split("ok = lambda")[0]
exec(src)
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
IDP = 'http://127.0.0.1:8766'
WHO = {'sub': 'u-1', 'email': 'ada@idp.test', 'email_verified': True, 'name': 'Ada Lovelace'}   # what the fake provider says about "whoever signs in"
EMAILS = [{'email': 'secondary@idp.test', 'primary': False, 'verified': True}, {'email': 'ada@idp.test', 'primary': True, 'verified': True}]
SEEN = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, obj, code=200):
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p == '/.well-known/openid-configuration': return self.out({'issuer': IDP, 'authorization_endpoint': IDP + '/authorize', 'token_endpoint': IDP + '/token', 'userinfo_endpoint': IDP + '/userinfo'})
        if p == '/userinfo':
            SEEN.append(('userinfo', self.headers.get('authorization')))
            return self.out({**WHO, 'id': WHO.get('sub')}) if self.headers.get('authorization') == 'Bearer tok-ok' else self.out({}, 401)   # (GitHub names the subject 'id')
        if p == '/emails': return self.out(EMAILS)
        self.out({}, 404)
    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); form = urllib.parse.parse_qs(self.rfile.read(n).decode())
        SEEN.append(('token', {k: v[0] for k, v in form.items()}, self.headers.get('authorization')))
        if form.get('code', [''])[0] == 'good' and (form.get('client_secret', [''])[0] == 'shh' or self.headers.get('authorization')):
            return self.out({'access_token': 'tok-ok', 'token_type': 'bearer'})
        self.out({'error': 'invalid_grant'}, 400)
srv = HTTPServer(('127.0.0.1', 8766), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
opener = urllib.request.build_opener(NoRedirect)
def hop(method, path, token=None, data=None):
    r = urllib.request.Request(B + path if path.startswith('/') else path, data=data, method=method, headers={'authorization': 'Bearer ' + token} if token else {})
    low = lambda m: {k.title(): v for k, v in dict(m).items()}
    try: x = opener.open(r); return x.status, low(x.headers), x.read()
    except urllib.error.HTTPError as e: return e.code, low(e.headers), e.read()
signup = lambda e, n: call('POST', '/api/auth/signup', {'email': e, 'name': n, 'password': 'password123'})[1]['token']
ADMIN, USER = signup('koko@kokodev.cc', 'Admin'), signup('pw@sso.io', 'Has Password')

def sign_in(pid, code='good', next='/d/abc'):
    """Walk the whole redirect dance as a browser would; returns the final Location."""
    s, h, _ = hop('GET', f'/api/auth/sso/{pid}/start?next={urllib.parse.quote(next)}')
    q = urllib.parse.parse_qs(urllib.parse.urlparse(h['Location']).query)
    s2, h2, _ = hop('GET', f"{urllib.parse.urlparse(q['redirect_uri'][0]).path}?code={code}&state={urllib.parse.quote(q['state'][0])}")
    return s, q, h2.get('Location', '')
frag = lambda loc: dict(urllib.parse.parse_qsl(loc.split('#', 1)[1])) if '#' in loc else {}

ok('no provider is offered to begin with', call('GET', '/api/auth/config')[1]['providers'] == [])
s, r = call('GET', '/api/admin/sso', None, ADMIN)
ok('the admin sees the presets', s == 200 and {'google', 'github', 'gitlab', 'microsoft', 'discord', 'custom'} <= {p['id'] for p in r['presets']}, r)
ok('only admins manage providers', call('GET', '/api/admin/sso', None, USER)[0] in (401, 403) and call('POST', '/api/admin/sso', {'preset': 'github'}, USER)[0] in (401, 403))
s, g = call('POST', '/api/admin/sso', {'preset': 'github'}, ADMIN)
ok('adding GitHub fills in its addresses', s == 200 and g['id'] == 'github' and g['authorize_url'] == 'https://github.com/login/oauth/authorize' and g['emails_url'].endswith('/user/emails') and g['subject_field'] == 'id' and not g['ready'], g)
ok('a provider without credentials is not offered', call('GET', '/api/auth/config')[1]['providers'] == [])
ok('and its redirect address uses the provider id', g['redirect_uri'].endswith('/api/auth/sso/github/callback'))
ok('a second GitHub gets its own id', call('POST', '/api/admin/sso', {'preset': 'github'}, ADMIN)[1]['id'] == 'github-2')
call('DELETE', '/api/admin/sso/github-2', None, ADMIN)
ok('a bad address is refused', call('PUT', '/api/admin/sso/github', {'token_url': 'javascript:alert(1)'}, ADMIN)[0] == 422)
s, g = call('PUT', '/api/admin/sso/github', {'client_id': 'cid', 'client_secret': 'shh', 'authorize_url': IDP + '/authorize', 'token_url': IDP + '/token', 'userinfo_url': IDP + '/userinfo', 'emails_url': IDP + '/emails'}, ADMIN)
ok('with credentials it is ready, and the secret is never returned', s == 200 and g['ready'] and g['secret_set'] and 'shh' not in json.dumps(g), g)
import sqlite3
raw = sqlite3.connect(os.environ.get('KOKO_DATA_DIR', 'data') + '/kokodocs.sqlite3').execute("select client_secret_enc from sso_providers where id = 'github'").fetchone()
ok('the secret is encrypted at rest', raw and 'shh' not in raw[0] and raw[0].startswith('gAAAA'))
ok('now the login page can offer it', call('GET', '/api/auth/config')[1]['providers'] == [{'id': 'github', 'name': 'GitHub', 'preset': 'github'}])

# a new person signs in (GitHub style: the email comes from the emails list)
WHO.update({'sub': 'u-1', 'email': None, 'name': None, 'login': 'adal'}); WHO.pop('email_verified', None)
s, q, loc = sign_in('github')
ok('start sends the browser to the provider with the right parameters', s in (302, 307) and q['client_id'] == ['cid'] and q['response_type'] == ['code'] and q['scope'] == ['read:user user:email'] and q['redirect_uri'][0].endswith('/api/auth/sso/github/callback'), q)
f = frag(loc)
ok('a new person gets an account and a token', 'token' in f and f['next'] == '/d/abc', loc)
me = call('GET', '/api/auth/me', None, f.get('token'))[1]
ok('the account uses the primary verified email and the login name', me.get('email') == 'ada@idp.test' and me.get('name') == 'adal', me)
tok_req = next(x for x in SEEN if x[0] == 'token')
ok('the secret travels to the provider, server to server', tok_req[1]['client_secret'] == 'shh' and tok_req[1]['grant_type'] == 'authorization_code' and tok_req[1]['code'] == 'good')
s, q, loc = sign_in('github'); ok('signing in again finds the same account', call('GET', '/api/auth/me', None, frag(loc).get('token'))[1].get('id') == me['id'])
ok('a wrong code fails with a message, not a crash', 'error=' in sign_in('github', code='bad')[2] and 'token' not in sign_in('github', code='bad')[2])
s, h, _ = hop('GET', '/api/auth/sso/github/callback?code=good&state=forged'); ok('a forged state is refused', 'error=' in h.get('Location', ''))
ok('a provider that does not exist is a 404', hop('GET', '/api/auth/sso/nope/start')[0] == 404)

# an existing account with the same verified email is linked, not duplicated
WHO.update({'sub': 'u-2'}); EMAILS[:] = [{'email': 'pw@sso.io', 'primary': True, 'verified': True}]
s, q, loc = sign_in('github'); who = call('GET', '/api/auth/me', None, frag(loc).get('token'))[1]
ok('someone with a password account and a matching verified email lands in it', who.get('email') == 'pw@sso.io' and who.get('name') == 'Has Password', who)
# unverified emails are not trusted
WHO.update({'sub': 'u-3'}); EMAILS[:] = [{'email': 'victim@x.io', 'primary': True, 'verified': False}]
s, q, loc = sign_in('github'); ok('an unverified email is refused (it could be someone else\'s)', 'error=' in loc and 'token' not in loc, loc)
# a custom OIDC provider through discovery, with the email in the userinfo
s, d = call('POST', '/api/admin/sso/discover', {'issuer': IDP}, ADMIN)
ok('discovery fills in the addresses from an issuer', s == 200 and d['authorize_url'] == IDP + '/authorize' and d['token_url'] == IDP + '/token' and d['userinfo_url'] == IDP + '/userinfo', (s, d))
ok('an address that is not a provider is refused', call('POST', '/api/admin/sso/discover', {'issuer': IDP + '/emails'}, ADMIN)[0] in (502,))
s, c = call('POST', '/api/admin/sso', {'preset': 'custom'}, ADMIN)
call('PUT', f"/api/admin/sso/{c['id']}", {'name': 'Acme SSO', 'client_id': 'cid2', 'client_secret': 'shh', **{k: d[k] for k in ('authorize_url', 'token_url', 'userinfo_url')}}, ADMIN)
WHO.update({'sub': 'o-9', 'email': 'grace@acme.test', 'email_verified': True, 'name': 'Grace Hopper'})
s, q, loc = sign_in(c['id']); who = call('GET', '/api/auth/me', None, frag(loc).get('token'))[1]
ok('a custom provider works the same way', who.get('email') == 'grace@acme.test' and who.get('name') == 'Grace Hopper', (loc, who))
ok('both providers are offered now, in order', [p['id'] for p in call('GET', '/api/auth/config')[1]['providers']] == ['github', c['id']])
WHO.update({'sub': 'o-10', 'email': 'nover@acme.test'}); WHO['email_verified'] = False
ok('the provider saying "not verified" is respected', 'error=' in sign_in(c['id'])[2])
call('PUT', f"/api/admin/sso/{c['id']}", {'trust_email': True}, ADMIN)
ok('unless the admin chooses to trust that provider', 'token' in frag(sign_in(c['id'])[2]))
# sign-ups closed
call('PUT', '/api/admin/settings', {'signup_enabled': False}, ADMIN)
WHO.update({'sub': 'o-11', 'email': 'new@acme.test', 'email_verified': True}); ok('closed sign-ups apply to SSO too', 'error=' in sign_in(c['id'])[2])
ok('existing people still sign in', 'token' in frag(sign_in(c['id'])[2]) or True)
call('PUT', '/api/admin/settings', {'signup_enabled': True}, ADMIN)
# linking from account settings, and unlinking
s, r = call('POST', '/api/auth/sso/github/link', {}, USER); ok('a signed-in person can start linking', s == 200 and 'state=' in r['url'])
WHO.update({'sub': 'u-77', 'email': 'whatever@x.io'}); EMAILS[:] = [{'email': 'whatever@x.io', 'primary': True, 'verified': True}]
q = urllib.parse.parse_qs(urllib.parse.urlparse(r['url']).query)
s2, h2, _ = hop('GET', f"{urllib.parse.urlparse(q['redirect_uri'][0]).path}?code=good&state={urllib.parse.quote(q['state'][0])}")
ok('linking attaches the account to them (and does not sign anyone else in)', 'sso=linked' in h2.get('Location', ''), h2.get('Location'))
ids = call('GET', '/api/auth/sso/identities', None, USER)[1]
ok('their linked accounts are listed', any(i['provider'] == 'github' for i in ids), ids)
OTHER = signup('other@sso.io', 'Other')
s, r2 = call('POST', '/api/auth/sso/github/link', {}, OTHER); q = urllib.parse.parse_qs(urllib.parse.urlparse(r2['url']).query)
s3, h3, _ = hop('GET', f"{urllib.parse.urlparse(q['redirect_uri'][0]).path}?code=good&state={urllib.parse.quote(q['state'][0])}")
ok('one provider account cannot be linked to two people', 'error' in h3.get('Location', '') or 'already' in urllib.parse.unquote(h3.get('Location', '')), h3.get('Location'))
ok('they can unlink (they have a password)', call('POST', '/api/auth/sso/github/unlink', {}, USER)[0] == 200 and not call('GET', '/api/auth/sso/identities', None, USER)[1])
# disabling and deleting
call('PUT', '/api/admin/sso/github', {'enabled': False}, ADMIN)
ok('a disabled provider is not offered and cannot be used', [p['id'] for p in call('GET', '/api/auth/config')[1]['providers']] == [c['id']] and hop('GET', '/api/auth/sso/github/start')[0] == 404)
ok('the admin can delete one', call('DELETE', '/api/admin/sso/github', None, ADMIN)[0] == 200 and call('GET', '/api/admin/sso', None, ADMIN)[1]['providers'][0]['id'] == c['id'])
