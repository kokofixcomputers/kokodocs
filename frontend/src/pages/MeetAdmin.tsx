import { useEffect, useState } from 'react'
import { CheckCircle2, PlugZap } from 'lucide-react'
import { api, type MeetAdmin } from '../api'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'

const Switch = ({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint: string }) => (
  <div className="switch-row"><div><b>{label}</b><span>{hint}</span></div>
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} /></div>)

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="ai-field"><span>{label}</span><span className="field">{children}</span>{hint && <span className="muted hint">{hint}</span>}</label>)

/** Admin: Meetings. Who may start and join, and what carries the audio and video. */
export function MeetAdminSection() {
  const [m, setM] = useState<MeetAdmin | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  // text typed since the last save (secrets are never sent back, so they start empty)
  const [d, setD] = useState({ keyId: '', token: '', urls: '', user: '', pass: '', account: '', app: '', rtoken: '', host: '', guest: '' })
  const load = (x: MeetAdmin) => {
    setM(x)
    setD({ keyId: x.turn.key_id, token: '', urls: x.turn.urls, user: x.turn.user, pass: '', account: x.rtk.account, app: x.rtk.app, rtoken: '', host: x.rtk.host_preset, guest: x.rtk.guest_preset })
  }
  useEffect(() => { api.adminMeet().then(load).catch((e) => setErr(e.message)) }, [])
  if (!m) return err ? <p className="form-error">{err}</p> : <span className="spinner" />

  const save = async (patch: Parameters<typeof api.adminMeetSave>[0] = {}) => {
    setBusy(true); setErr(''); setTest(null)
    try {
      load(await api.adminMeetSave({
        turn: { key_id: d.keyId, token: d.token, urls: d.urls, user: d.user, password: d.pass },
        rtk: { account: d.account, app: d.app, token: d.rtoken, host_preset: d.host, guest_preset: d.guest },
        ...patch,
      }))
      toast('Saved')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true); setErr(''); setTest(null)
    try { await save(); setTest(await api.adminMeetTest()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const p = m.provider

  return (
    <div className="ad-stack">
      <div className="ad-card ad-form">
        <p className="muted hint" style={{ margin: 0 }}>Video and voice meetings: anyone with the link can join (guests give a name, if you allow them), and the host can mute or remove people. Choose below what carries the audio and video. Calls are never end-to-end encrypted.</p>
        <Switch on={m.enabled} set={(v) => void save({ enabled: v })} label="Meetings" hint="Off: the Meet button disappears and links stop working." />
        <Switch on={m.guests} set={(v) => void save({ guests: v })} label="Guests can join without an account" hint="Hosts can still make a single meeting for signed-in people only." />
      </div>

      <div className="ad-card ad-form">
        <div className="ai-field"><span>How calls are carried</span>
          <Select label="How calls are carried" value={p} onChange={(v) => void save({ provider: v })}
            options={m.providers.map((x) => ({ value: x.id, label: x.id === 'mesh' ? 'Directly between browsers (free, up to 8 people)' : x.label + ' (bigger meetings, billed by Cloudflare)' }))} />
          <span className="muted hint">{p === 'mesh'
            ? "People connect to each other directly and this server only introduces them, so no audio or video passes through it and it costs nothing. Each person sends their video to everyone else, so it suits small groups. People on strict networks need a relay (below)."
            : "Cloudflare carries everything through its own network, so meetings can be bigger and work from anywhere. Charged per participant-minute by Cloudflare. Meetings already started keep the way they began."}</span></div>
        {m.problem && <p className="form-error">{m.problem}</p>}
      </div>

      {p === 'mesh' && (
        <div className="ad-card ad-form">
          <h3 className="ad-h">Relay servers (TURN)</h3>
          <p className="muted hint" style={{ margin: 0 }}>Most people connect directly. Some networks (offices, schools, some mobile carriers) block that, and need a relay to pass the call through. Cloudflare's relay service gives 1,000 GB a month free.</p>
          <div className="ai-field"><span>Relay</span>
            <Select label="Relay" value={m.turn.mode} onChange={(v) => void save({ turn: { mode: v } })}
              options={[{ value: 'none', label: 'None (public STUN only)' }, { value: 'cloudflare', label: 'Cloudflare TURN' }, { value: 'custom', label: 'My own TURN server' }]} /></div>
          {m.turn.mode === 'cloudflare' && (<>
            <Field label="TURN key id" hint="Cloudflare dashboard → Realtime → TURN → create a key."><input value={d.keyId} onChange={(e) => setD({ ...d, keyId: e.target.value })} autoComplete="off" /></Field>
            <Field label="TURN key API token" hint={m.turn.token_set ? 'Saved. Type to replace it.' : undefined}><input type="password" value={d.token} placeholder={m.turn.token_set ? '••••••••' : ''} onChange={(e) => setD({ ...d, token: e.target.value })} autoComplete="new-password" /></Field>
          </>)}
          {m.warning && <p className="form-error">{m.warning}</p>}
          {m.turn.mode === 'custom' && (<>
            <label className="ai-field"><span>Server addresses, one per line</span>
              <textarea className="ocr-prompt" rows={3} value={d.urls} placeholder={'free.expressturn.com:3478\nturn:relay.example.com:3478\nglobal.relay.metered.ca:80 username password'} onChange={(e) => setD({ ...d, urls: e.target.value })} spellCheck={false} />
              <span className="muted hint">Just the address and port is fine: turn: is added for you. For a service with its own login, add it on the same line: <code>address username password</code>. Lines without one use the username and password below.</span></label>
            <Field label="Username"><input value={d.user} onChange={(e) => setD({ ...d, user: e.target.value })} autoComplete="off" /></Field>
            <Field label="Password" hint={m.turn.pass_set ? 'Saved. Type to replace it.' : undefined}><input type="password" value={d.pass} placeholder={m.turn.pass_set ? '••••••••' : ''} onChange={(e) => setD({ ...d, pass: e.target.value })} autoComplete="new-password" /></Field>
          </>)}
        </div>)}

      {p === 'realtimekit' && (
        <div className="ad-card ad-form">
          <h3 className="ad-h">Cloudflare RealtimeKit</h3>
          <Field label="Account id" hint="The 32-character id shown in the Cloudflare dashboard."><input value={d.account} onChange={(e) => setD({ ...d, account: e.target.value })} autoComplete="off" /></Field>
          <Field label="App id" hint="Dashboard → Realtime → RealtimeKit → your app."><input value={d.app} onChange={(e) => setD({ ...d, app: e.target.value })} autoComplete="off" /></Field>
          <Field label="API token" hint={m.rtk.token_set ? 'Saved. Type to replace it. It needs the Realtime (or Realtime Admin) permission.' : 'Needs the Realtime (or Realtime Admin) permission.'}><input type="password" value={d.rtoken} placeholder={m.rtk.token_set ? '••••••••' : ''} onChange={(e) => setD({ ...d, rtoken: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Host preset" hint="The preset (set of permissions) given to the person who started the meeting."><input value={d.host} onChange={(e) => setD({ ...d, host: e.target.value })} autoComplete="off" /></Field>
          <Field label="Everyone else's preset"><input value={d.guest} onChange={(e) => setD({ ...d, guest: e.target.value })} autoComplete="off" /></Field>
        </div>)}

      <div className="ad-card ad-form">
        {err && <p className="form-error">{err}</p>}
        {test && <p className={test.ok ? 'meet-ok' : 'form-error'}><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> {test.message}</p>}
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-pill btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
          <button className="btn btn-pill btn-soft" disabled={busy} onClick={() => void check()}><PlugZap size={16} />Save and test</button>
        </div>
      </div>
    </div>
  )
}
