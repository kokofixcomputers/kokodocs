import json, urllib.request, urllib.error
B='http://localhost:8000'
def call(p,body,tok=None):
    h={'content-type':'application/json'}
    if tok: h['authorization']='Bearer '+tok
    try:
        r=urllib.request.urlopen(urllib.request.Request(B+p,json.dumps(body).encode(),h,method='POST')); return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read())
ok=lambda n,c: print(('PASS ' if c else 'FAIL ')+n)
_,a=call('/api/auth/signup',{'email':'p@x.io','name':'P','password':'password123'}); T=a['token']
ok('me has_password', a['user']['has_password'] is True)
s,_=call('/api/auth/password',{'current':'wrong','new':'newpassword1'},T); ok('wrong current rejected', s==400)
s,_=call('/api/auth/password',{'current':'password123','new':'short'},T); ok('short rejected', s==422)
s,_=call('/api/auth/password',{'current':'password123','new':'newpassword1'},T); ok('changed', s==200)
s,_=call('/api/auth/login',{'email':'p@x.io','password':'password123'}); ok('old password fails', s==401)
s,r=call('/api/auth/login',{'email':'p@x.io','password':'newpassword1'}); ok('new password works', s==200 and 'token' in r)
