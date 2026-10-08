import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { hideBusy, showBusy, updateBusy } from './busy'
import { recoveryFromText } from './crypto'
import {
  decryptDocuments, disableAccount, enableAccount, encryptDocuments, newRecoveryKey, ownedDocs, prepareAccount, zkApi, type BatchResult, type Prepared, type ZkStatus,
} from './flows'
import { fingerprint } from './crypto'
import { setZkNewEncrypted, zkNewEncrypted, zkPub } from './session'

const same = (a: string, b: string) => { const x = recoveryFromText(a), y = recoveryFromText(b); return !!x && !!y && x.every((v, i) => v === y[i]) }

function Report({ r, verb }: { r: BatchResult; verb: string }) {
  return (
    <div className="st-stack">
      <p style={{ margin: 0 }}><b>{r.done}</b> document{r.done === 1 ? '' : 's'} {verb}.</p>
      {r.images > 0 && <p className="muted" style={{ margin: 0 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {r.images} of them contain pictures. Pictures are still stored without encryption: they can't be encrypted yet.</p>}
      {r.skipped.length > 0 && <div><p style={{ margin: '0 0 4px' }}><b>{r.skipped.length} left as they were</b></p><ul className="zk-list">{r.skipped.map((s) => <li key={s.id}><b>{s.title || 'Untitled'}</b><span>{s.why}</span></li>)}</ul></div>}
      {r.failed.length > 0 && <div><p style={{ margin: '0 0 4px' }} className="form-error"><b>{r.failed.length} couldn't be {verb}</b></p><ul className="zk-list">{r.failed.map((s) => <li key={s.id}><b>{s.title || 'Untitled'}</b><span>{s.why}</span></li>)}</ul></div>}
    </div>
  )
}

export function RecoveryKey({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`KokoDocs recovery key\n\n${text}\n\nKeep this somewhere safe and private. It is the only way to get your encrypted documents back if you forget your password.\n`], { type: 'text/plain' }))
    a.download = 'kokodocs-recovery-key.txt'; a.click(); URL.revokeObjectURL(a.href)
  }
  const [typed, setTyped] = useState('')
  return (
    <div className="st-stack">
      <p style={{ margin: 0 }}><b>This is your recovery key.</b> If you forget your password, it is the only way to get your encrypted documents back. Nobody else has it, not even the server's administrator, and it is never shown again.</p>
      <div className="zk-key" aria-label="Recovery key">{text}</div>
      <div className="st-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-pill btn-soft btn-sm" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy</button>
        <button className="btn btn-pill btn-soft btn-sm" onClick={download}><Download size={15} />Download</button>
      </div>
      <label className="field"><KeyRound size={18} /><input autoComplete="off" spellCheck={false} placeholder="Type or paste the key again to confirm you saved it" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
      <div className="modal-actions"><button className="btn btn-pill btn-primary" disabled={!same(typed, text)} onClick={onClose}>I saved it</button></div>
    </div>
  )
}

function TurnOn({ status, onClose, onDone }: { status: ZkStatus; onClose: () => void; onDone: () => void }) {
  const { user, reloadUser } = useAuth()
  const [step, setStep] = useState<'intro' | 'key' | 'convert' | 'report'>('intro')
  const [pw, setPw] = useState('')
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [convert, setConvert] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<BatchResult | null>(null)

  const start = async () => {
    setErr(''); setBusy(true)
    try {
      showBusy('Creating your keys…', 'Stretching your password and making encryption keys on this device')
      const p = await prepareAccount(pw)
      setPrep(p); setStep('key')
    } catch (e) { setErr((e as Error).message) } finally { hideBusy(); setBusy(false) }
  }
  const finish = async () => {
    setErr(''); setBusy(true)
    try {
      showBusy('Turning on encryption…')
      await enableAccount(user!, prep!, pw)
      if (convert && status.plain > 0) {
        showBusy('Encrypting your documents…', 'Each one is encrypted on this device before it is stored.')
        const docs = (await ownedDocs()).filter((d) => !d.zk)
        const r = await encryptDocuments(docs, (done, total, what) => updateBusy({ done, total, detail: what ? `Now: ${what}` : undefined }))
        setReport(r)
      }
      await reloadUser()
      setStep('report')
    } catch (e) { setErr((e as Error).message); setStep('intro') } finally { hideBusy(); setBusy(false) }
  }

  if (step === 'report') return <Modal title="Encryption is on" onClose={onDone}>
    <div className="st-stack">
      <p style={{ margin: 0 }}><ShieldCheck size={16} style={{ verticalAlign: -3 }} /> New documents you create are encrypted. Documents you already had stay readable by you in every way they were before.</p>
      {report ? <Report r={report} verb="encrypted" /> : <p className="muted" style={{ margin: 0 }}>Your existing documents were left as they were. You can encrypt them later from this page.</p>}
      <div className="modal-actions"><button className="btn btn-pill btn-primary" onClick={onDone}>Done</button></div>
    </div></Modal>

  return (
    <Modal title="Turn on zero-knowledge encryption" onClose={onClose} width={560}>
      {step === 'intro' && (
        <div className="st-stack">
          <p style={{ margin: 0 }}>Your documents are encrypted on this device with keys only you hold. <b>Nobody who runs this service, including its administrator, can read them.</b> Documents you already have that you don't encrypt stay as they are, and you can keep using both.</p>
          <ul className="zk-points">
            <li>You sign in the same way. Your password now also protects your keys, so <b>forgetting it means using your recovery key</b>, which you'll get next.</li>
            <li>Live editing and sharing keep working, but only with people who have turned encryption on as well.</li>
            <li>Things that need the server to read a document don't work in encrypted ones: Koko, voice typing, spelling and grammar checks, version history, pictures, public links and forms.</li>
          </ul>
          {!status.has_password && <p className="form-error">You need a password first: set one in Security, then come back.</p>}
          <label className="field"><Lock size={18} /><input type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && status.has_password && start()} /></label>
          {status.plain > 0 && <label className="zk-check"><input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} /> Encrypt my {status.plain} existing document{status.plain === 1 ? '' : 's'} now{status.plain_blocked ? ` (${status.plain_blocked} can't be: forms and documents with a public link)` : ''}</label>}
          {err && <p className="form-error">{err}</p>}
          <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || !pw || !status.has_password} onClick={start}>Continue</button></div>
        </div>)}
      {step === 'key' && prep && (<>
        <RecoveryKey text={prep.recoveryText} onClose={() => void finish()} />
        {err && <p className="form-error">{err}</p>}
      </>)}
    </Modal>
  )
}

function TurnOff({ status, onClose, onDone }: { status: ZkStatus; onClose: () => void; onDone: () => void }) {
  const { user, reloadUser } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<BatchResult | null>(null)
  const go = async () => {
    setErr(''); setBusy(true)
    try {
      showBusy('Decrypting your documents…', 'Each one is decrypted on this device and stored readable again.')
      const docs = (await ownedDocs()).filter((d) => d.zk)
      const r = await decryptDocuments(docs, (done, total, what) => updateBusy({ done, total, detail: what ? `Now: ${what}` : undefined }))
      if (r.failed.length) { setReport(r); throw new Error('Some documents couldn\'t be decrypted, so encryption stays on. Fix that and try again.') }
      updateBusy({ title: 'Turning off encryption…', detail: undefined, total: undefined })
      await disableAccount(user!, pw)
      await reloadUser()
      toast('Encryption is off')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { hideBusy(); setBusy(false) }
  }
  return (
    <Modal title="Turn off encryption" onClose={onClose} width={560}>
      <div className="st-stack">
        <p style={{ margin: 0 }}><b>Your {status.encrypted} encrypted document{status.encrypted === 1 ? '' : 's'} will be decrypted</b> and stored so the server can read them again{status.encrypted ? ', including for anyone you shared them with' : ''}.</p>
        {status.shared_encrypted > 0 && <p className="form-error" style={{ margin: 0 }}>{status.shared_encrypted} encrypted document{status.shared_encrypted === 1 ? ' that was' : 's that were'} shared with you will stop opening: they belong to other people and can only be read with encryption on.</p>}
        <p className="muted" style={{ margin: 0 }}>Documents that were never encrypted aren't touched.</p>
        <label className="field"><Lock size={18} /><input type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {report && <Report r={report} verb="decrypted" />}
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Keep encryption on</button><button className="btn btn-pill btn-danger" disabled={busy || !pw} onClick={go}>Decrypt and turn off</button></div>
      </div>
    </Modal>
  )
}

function NewRecovery({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [pw, setPw] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setErr(''); setBusy(true)
    try { showBusy('Decrypting…', 'Opening your encryption keys'); setText(await newRecoveryKey(user!, pw)) } catch (e) { setErr((e as Error).message) } finally { hideBusy(); setBusy(false) }
  }
  return (
    <Modal title="New recovery key" onClose={text ? () => { /* must confirm first */ } : onClose} width={560}>
      {text ? <RecoveryKey text={text} onClose={onClose} /> : (
        <div className="st-stack">
          <p style={{ margin: 0 }}>This makes a new recovery key. <b>The old one stops working.</b></p>
          <label className="field"><Lock size={18} /><input type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && go()} /></label>
          {err && <p className="form-error">{err}</p>}
          <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || !pw} onClick={go}>Make a new key</button></div>
        </div>)}
    </Modal>
  )
}

/** The encryption card in Settings, Security. */
export function ZkCard() {
  const { user } = useAuth()
  const [st, setSt] = useState<ZkStatus | null>(null)
  const [dlg, setDlg] = useState<null | 'on' | 'off' | 'recovery' | 'convert'>(null)
  const [newEnc, setNewEnc] = useState(zkNewEncrypted())
  const [fp, setFp] = useState('')
  const load = () => { zkApi.status().then(setSt).catch(() => {}) }
  useEffect(load, [user?.zk])
  useEffect(() => { const p = zkPub(); if (p) void fingerprint(p).then(setFp) }, [user?.zk])
  if (!st) return <span className="spinner" />
  return (
    <>
      {!st.enabled ? (
        <div className="st-row"><div><b>Zero-knowledge encryption</b><span>Encrypt your documents with keys only you hold, so nobody running this service can read them. Off by default; you choose which documents are encrypted.</span></div>
          <button className="btn btn-pill btn-primary btn-sm" onClick={() => setDlg('on')}><ShieldCheck size={15} />Turn on</button></div>
      ) : (
        <div className="st-stack">
          <div className="st-row" style={{ padding: 0 }}><div><b><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Zero-knowledge encryption is on</b><span>{st.encrypted} encrypted · {st.plain} not encrypted{st.shared_encrypted ? ` · ${st.shared_encrypted} shared with you` : ''}</span></div>
            <button className="btn btn-pill btn-ghost btn-sm" onClick={() => setDlg('off')}>Turn off…</button></div>
          <div className="switch-row" style={{ borderBottom: 0, padding: 0 }}>
            <div><b>Encrypt new documents</b><span>Documents you create from now on. Forms can't be encrypted.</span></div>
            <button role="switch" aria-checked={newEnc} aria-label="Encrypt new documents" className={`toggle ${newEnc ? 'on' : ''}`} onClick={() => { setNewEnc(!newEnc); setZkNewEncrypted(!newEnc) }} />
          </div>
          {st.plain - st.plain_blocked > 0 && <div className="st-row" style={{ padding: 0 }}><div><b>Encrypt your other documents</b><span>{st.plain - st.plain_blocked} document{st.plain - st.plain_blocked === 1 ? '' : 's'} can be encrypted now{st.plain_blocked ? ` (${st.plain_blocked} can't be: forms and documents with a public link)` : ''}</span></div>
            <button className="btn btn-pill btn-soft btn-sm" onClick={() => setDlg('convert')}>Encrypt</button></div>}
          <div className="st-row" style={{ padding: 0 }}><div><b>Recovery key</b><span>The only way back in if you forget your password</span></div>
            <button className="btn btn-pill btn-soft btn-sm" onClick={() => setDlg('recovery')}><KeyRound size={15} />Make a new one</button></div>
          {fp && <div className="st-row" style={{ padding: 0 }}><div><b>Your key fingerprint</b><span className="zk-fp">{fp}</span><span>Others can compare this with what they see when they share a document with you, to be sure the key is yours.</span></div></div>}
        </div>)}
      {dlg === 'on' && <TurnOn status={st} onClose={() => setDlg(null)} onDone={() => { setDlg(null); load() }} />}
      {dlg === 'off' && <TurnOff status={st} onClose={() => setDlg(null)} onDone={() => { setDlg(null); load() }} />}
      {dlg === 'recovery' && <NewRecovery onClose={() => setDlg(null)} />}
      {dlg === 'convert' && <ConvertAll status={st} onClose={() => { setDlg(null); load() }} />}
    </>
  )
}

function ConvertAll({ status, onClose }: { status: ZkStatus; onClose: () => void }) {
  const [report, setReport] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      showBusy('Encrypting your documents…', 'Each one is encrypted on this device before it is stored.')
      const docs = (await ownedDocs()).filter((d) => !d.zk)
      setReport(await encryptDocuments(docs, (done, total, what) => updateBusy({ done, total, detail: what ? `Now: ${what}` : undefined })))
    } catch (e) { toast((e as Error).message) } finally { hideBusy(); setBusy(false) }
  }
  return (
    <Modal title="Encrypt your other documents" onClose={onClose}>
      {report ? <div className="st-stack"><Report r={report} verb="encrypted" /><div className="modal-actions"><button className="btn btn-pill btn-primary" onClick={onClose}>Done</button></div></div> : (
        <div className="st-stack">
          <p style={{ margin: 0 }}>{status.plain - status.plain_blocked} document{status.plain - status.plain_blocked === 1 ? '' : 's'} will be encrypted. <b>Anyone you shared them with loses access</b> until you share them again (people need encryption turned on too). Comments, version history and search text for them are removed from the server.</p>
          <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy} onClick={go}>Encrypt them</button></div>
        </div>)}
    </Modal>
  )
}

void api
