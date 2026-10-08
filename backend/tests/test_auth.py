import sys, time, json, urllib.request, urllib.error
sys.path.insert(0, '/Users/ct/Documents/kokodocs/backend')
from app.authx import totp_at
B='http://localhost:8000'
def call(m,p,body=None,tok=None,follow=True):
    h={'content-type':'application/json'}
    if tok: h['authorization']='Bearer '+tok
    req=urllib.request.Request(B+p,data=json.dumps(body).encode() if body is not None else None,headers=h,method=m)
    class NR(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k): return None
    op=urllib.request.build_opener(NR) if not follow else urllib.request.build_opener()
    try:
        r=op.open(req); return r.status, (json.loads(r.read() or b'null') if 'json' in r.headers.get('content-type','') else r.read())
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, dict(e.headers)
ok=lambda n,c: print(('PASS ' if c else 'FAIL ')+n)
_,a=call('POST','/api/auth/signup',{'email':'koko@kokodev.cc','name':'Koko','password':'password123'}); A=a['token']
_,u=call('POST','/api/auth/signup',{'email':'u1@x.io','name':'U One','password':'password123'}); U=u['token']
s,d=call('POST','/api/docs',{'title':'secret plans','kind':'doc'},U); did=d['id']
# 2FA
s,st=call('POST','/api/auth/2fa/setup',None,U); sec=st['secret']
ok('setup uri', st['uri'].startswith('otpauth://totp/') and sec in st['uri'])
s,_=call('POST','/api/auth/2fa/enable',{'code':'000000'},U); ok('bad code rejected', s==400)
code=totp_at(sec,int(time.time()//30)); s,r=call('POST','/api/auth/2fa/enable',{'code':code},U); ok('enable', s==200 and len(r['recovery_codes'])==8); rec=r['recovery_codes']
s,r=call('POST','/api/auth/login',{'email':'u1@x.io','password':'password123'}); ok('login needs mfa', r.get('mfa_required') is True); mt=r['mfa_token']
s,r=call('POST','/api/auth/login/2fa',{'mfa_token':mt,'code':'123456'}); ok('wrong code', s==401)
s,r=call('POST','/api/auth/login/2fa',{'mfa_token':mt,'code':totp_at(sec,int(time.time()//30)+1)}); ok('login 2fa (next step ok, window)', s==200 and 'token' in r)
s,r=call('POST','/api/auth/login/2fa',{'mfa_token':mt,'code':rec[0]}); ok('recovery code works', s==200)
s,r=call('POST','/api/auth/login/2fa',{'mfa_token':mt,'code':rec[0]}); ok('recovery code single use', s==401)
s,r=call('POST','/api/auth/2fa/disable',{'code':rec[1]},U); ok('disable w/ recovery', s==200)
# admin
s,_=call('GET','/api/admin/settings',None,U); ok('non-admin blocked', s==403)
s,_=call('PUT','/api/admin/settings',{'signup_enabled':False},A); s2,c=call('GET','/api/auth/config'); ok('signup closed in config', c['signup_enabled'] is False and c['providers'] == [])
s,_=call('POST','/api/auth/signup',{'email':'n@x.io','name':'N','password':'password123'}); ok('signup refused', s==403)
s,_=call('GET','/api/auth/sso/google/start'); ok('google off -> 404', s==404)
s,g=call('POST','/api/admin/sso',{'preset':'google'},A); s,r=call('PUT','/api/admin/sso/google',{'client_id':'cid.apps.googleusercontent.com','client_secret':'sec'},A); ok('google saved, secret hidden', s==200 and r['secret_set'] and r['ready'] and 'sec' not in json.dumps(r).replace('secret',''))
s,h=call('GET','/api/auth/sso/google/start?next=/d/x',follow=False); ok('google start redirects', s in (302,307) and 'accounts.google.com' in h.get('location',h.get('Location','')))
ok('google keeps its old redirect address', r['redirect_uri'].endswith('/api/auth/google/callback'))
s,h=call('GET','/api/auth/google/callback?code=x&state=bad',follow=False); ok('bad state -> login error', s in (302,307) and '/login?error=' in h.get('location',h.get('Location','')))
s,c=call('GET','/api/auth/config'); ok('google enabled in config', [p['id'] for p in c['providers']] == ['google'])
# moderation
s,f=call('GET','/api/admin/files',None,A); ok('admin lists files', any(x['id']==did for x in f))
s,i=call('GET',f'/api/docs/{did}',None,A); ok('admin can open any doc read-only', s==200 and i['role']=='viewer')
s,_=call('GET',f'/api/docs/{did}',None,None); ok('anon still blocked', s in (401,403))
s,f=call('GET',f'/api/admin/files?owner={u["user"]["id"]}',None,A); ok('filter by owner', len(f)==1)
s,_=call('DELETE',f'/api/admin/files/{did}',None,U); ok('non-admin cannot delete', s==403)
s,_=call('DELETE',f'/api/admin/files/{did}',None,A); s2,f=call('GET','/api/admin/files',None,A); ok('admin deletes', s==200 and not f)
