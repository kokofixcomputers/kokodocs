import * as c from '../src/zk/crypto.ts'
const t0=Date.now()
const salt=c.random(16)
const a=await c.fromPassword('correct horse', salt, c.ARGON), b=await c.fromPassword('correct horse', salt, c.ARGON), w=await c.fromPassword('wrong horse', salt, c.ARGON)
console.log('argon ms',Date.now()-t0,'same pw same keys',a.auth===b.auth&&c.b64(a.kek)===c.b64(b.kek),'diff pw differs',a.auth!==w.auth, 'auth!=kek', a.auth!==c.b64(a.kek))
const master=c.random(32); const wrapped=await c.seal256(a.kek, master)
console.log('unwrap ok', c.b64(await c.open256(b.kek, wrapped))===c.b64(master))
try{ await c.open256(w.kek, wrapped); console.log('FAIL wrong key opened') }catch{ console.log('wrong key rejected') }
const kp=c.newKeypair(); const dek=c.random(32)
const s=await c.sealTo(kp.pub, dek); console.log('sealed open', c.b64(await c.openSealed(kp.priv,s))===c.b64(dek))
const other=c.newKeypair(); try{ await c.openSealed(other.priv,s); console.log('FAIL other opened') }catch{ console.log('other key rejected') }
const rk=c.random(32), txt=c.recoveryToText(rk); console.log(txt, txt.length, c.b64(c.recoveryFromText(txt.toLowerCase().replace(/-/g,' '))!)===c.b64(rk), c.recoveryFromText('bad')===null)
const m=await c.sealText(dek,'hello','doc1'); console.log('text', await c.openText(dek,m,'doc1'));
try{ await c.openText(dek,m,'doc2'); console.log('FAIL aad') }catch{ console.log('bound to the document id') }
console.log('fp', await c.fingerprint(kp.pub))

