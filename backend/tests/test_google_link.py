import json, sys, urllib.request, urllib.error
sys.path.insert(0,'/Users/ct/Documents/kokodocs/backend')
from app.security import make_state, read_state
B='http://localhost:8000'
def call(m,p,body=None,tok=None):
    h={'content-type':'application/json'}
    if tok: h['authorization']='Bearer '+tok
    try:
        r=urllib.request.urlopen(urllib.request.Request(B+p,json.dumps(body).encode() if body is not None else None,h,method=m)); return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read())
ok=lambda n,c: print(('PASS ' if c else 'FAIL ')+n)
ok('state roundtrip', read_state(make_state('/x',link='u1'))==('/x','u1') and read_state(make_state('/y'))==('/y',None))
_,a=call('POST','/api/auth/signup',{'email':'koko@kokodev.cc','name':'K','password':'password123'}); A=a['token']
_,u=call('POST','/api/auth/signup',{'email':'g@x.io','name':'G','password':'password123'}); U=u['token']
s,_=call('POST','/api/auth/google/link',None,U); ok('link without config 404', s==404)
call('PUT','/api/admin/settings',{'google_client_id':'cid','google_client_secret':'s'},A)
s,r=call('POST','/api/auth/google/link',None,U); ok('link url', s==200 and 'accounts.google.com' in r['url'] and 'state=' in r['url'])
s,r=call('GET','/api/auth/me',None,U); ok('me.google null', r['google'] is None)
s,_=call('POST','/api/auth/google/link',None,None); ok('link needs login', s==401)
s,_=call('POST','/api/auth/google/unlink',None,U); ok('unlink ok when password set', s==200)
