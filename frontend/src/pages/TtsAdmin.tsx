import { useEffect, useState } from 'react'
import { CheckCircle2, PlugZap, Volume2 } from 'lucide-react'
import { api } from '../api'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'

type Cfg = Awaited<ReturnType<typeof api.adminTts>>

/** Admin: Read aloud. By default each device reads with its own voices; here an administrator can switch on one server voice for everyone. */
export function TtsAdmin() {
  const [c, setC] = useState<Cfg | null>(null)
  const [engine, setEngine] = useState<'browser' | 'cloudflare'>('browser')
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const load = (x: Cfg) => { setC(x); setEngine(x.engine); setAccount(x.account); setToken('') }
  useEffect(() => { api.adminTts().then(load).catch((e) => setErr(e.message)) }, [])
  if (!c) return err ? <p className="form-error">{err}</p> : <span className="spinner" />
  const save = async () => { const r = await api.adminTtsSave({ engine, account, token }); load(r); toast('Saved') }
  const run = async (check: boolean) => {
    setBusy(true); setErr(''); setTest(null)
    try { await save(); if (check) setTest(await api.adminTtsTest()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <h3 className="ad-h"><Volume2 size={18} style={{ verticalAlign: -3, marginRight: 8 }} />Read aloud</h3>
      <p className="muted hint" style={{ margin: 0 }}>The Read aloud button in documents and wikis. By default each device uses the voices it already has: free, instant, and the text never leaves the device. Quality depends on the device (very good on Apple devices, plainer on some others).</p>
      <div className="ai-field"><span>Voice</span>
        <Select label="Voice" value={engine} onChange={setEngine} options={[{ value: 'browser', label: "Each device's own voices (free)" }, { value: 'cloudflare', label: 'Cloudflare MeloTTS (one voice for everyone)' }]} />
        <span className="muted hint">{engine === 'cloudflare' ? `Uses Cloudflare Workers AI (${c.model}), about $0.0002 per minute of speech, roughly a cent an hour. The text of the page is sent to Cloudflare; encrypted documents are never sent and use the device's voice.` : 'Nothing to set up.'}</span></div>
      {engine === 'cloudflare' && (
        <>
          <label className="ai-field"><span>Cloudflare account id</span><span className="field"><input value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="off" placeholder="32 characters, from the Cloudflare dashboard" /></span></label>
          <label className="ai-field"><span>API token</span><span className="field"><input type="password" value={token} placeholder={c.token_set ? '••••••••' : ''} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" /></span>
            <span className="muted hint">{c.token_set ? 'Saved. Type to replace it. ' : ''}Needs the Workers AI permission. (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment are used if these are empty.)</span></label>
        </>)}
      {c.problem && engine === 'cloudflare' && <p className="form-error">{c.problem}</p>}
      {err && <p className="form-error">{err}</p>}
      {test && <p className={test.ok ? 'meet-ok' : 'form-error'}><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> {test.message}</p>}
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-pill btn-primary" disabled={busy} onClick={() => void run(false)}>Save</button>
        {engine === 'cloudflare' && <button className="btn btn-pill btn-soft" disabled={busy} onClick={() => void run(true)}><PlugZap size={16} />Save and test</button>}
      </div>
    </>
  )
}
