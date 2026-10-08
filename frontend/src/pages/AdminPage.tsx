import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, ChevronLeft, ChevronRight, Copy, Files, HardDrive, ExternalLink, FileText, Download, KeyRound, LayoutDashboard, Mail, Mic, Search, Sparkles, ShieldCheck, ShieldOff, SlidersHorizontal, Table2, Trash2, UserX, UserCheck, Users } from 'lucide-react'
import { api, ApiError, type AiAdmin, type AiAdminModel, type SsoAdmin, type SsoProvider, type SttModel, type SttModels, type AdminFile, type AdminSettings, type AdminStats, type AdminUser, type SttProvider } from '../api'
import { useAuth } from '../auth'
import { Avatar } from '../ui/Avatar'
import { askConfirm, askText } from '../ui/Dialogs'
import { fmtBytes } from '../ui/StorageMeter'
import { Select } from '../ui/Select'
import { KindIcon } from '../ui/KindIcon'
import { Logo } from '../ui/Logo'
import { PRESETS } from '../assistant/AiSettings'
import { ProviderMark } from '../ui/ProviderMark'
import { toast } from '../ui/Toast'

const bytes = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')

function UsersTab({ onFiles }: { onFiles: (u: AdminUser) => void }) {
  const { user } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = () => { api.adminUsers().then(setUsers).catch((e) => setErr(e.message)) }
  useEffect(load, [])
  const shown = useMemo(() => (users ?? []).filter((u) => (u.name + ' ' + u.email).toLowerCase().includes(q.toLowerCase())), [users, q])
  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok); load() } catch (e) { toast((e as Error).message) } }

  return (
    <>
        <div className="dash-bar"><label className="field admin-search"><Search size={16} /><input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
        {err && <p className="form-error">{err}</p>}
        {!users ? <span className="spinner" /> : (
          <div className="admin-table">
            {shown.map((u) => {
              const me = u.id === user?.id
              return (
                <div key={u.id} className={`admin-row ${u.disabled ? 'off' : ''}`}>
                  <Avatar name={u.name} color={u.color} size={36} />
                  <div className="a-who"><b>{u.name}{me && ' (you)'}</b><span>{u.email}</span></div>
                  <div className="a-tags">{u.is_admin && <span className="tag">Admin</span>}{u.disabled && <span className="tag warn">Suspended</span>}</div>
                  <div className="a-meta">{u.docs} docs · {u.sheets} sheets{u.totp ? ' · 2FA' : ''}<br /><b className={u.limit_mb && u.used > u.limit_mb * 1048576 * 0.9 ? 'warn-text' : ''}>{fmtBytes(u.used)} / {u.limit_mb ? `${u.limit_mb} MB` : 'unlimited'}</b>{u.quota_mb !== null ? ' (custom)' : ''}<br />Joined {new Date(u.created_at * 1000).toLocaleDateString()}</div>
                  <div className="a-actions">
                    <button className="icon-btn sm" title="Storage limit" aria-label="Storage limit" onClick={async () => {
                      const v = await askText({ title: `Storage limit for ${u.name}`, value: u.quota_mb === null ? '' : String(u.quota_mb), label: 'Save', placeholder: 'MB. Blank = default, 0 = unlimited' })
                      if (v === null) return
                      const t = v.trim()
                      if (t === '') void act(() => api.adminPatch(u.id, { clear_quota: true }), 'Using the default limit')
                      else if (/^\d+$/.test(t)) void act(() => api.adminPatch(u.id, { quota_mb: Number(t) }), Number(t) === 0 ? 'Unlimited storage' : `Limit set to ${t} MB`)
                      else toast('Enter a whole number of megabytes')
                    }}><HardDrive size={17} /></button>
                    <button className="icon-btn sm" title="View their files" aria-label="View files" onClick={() => onFiles(u)}><FileText size={17} /></button>
                    {u.totp && <button className="icon-btn sm" title="Reset two-factor" aria-label="Reset two-factor" onClick={async () => { if (await askConfirm({ title: 'Reset two-factor?', text: `${u.name} will be able to sign in with just their password until they set it up again.`, label: 'Reset' })) void act(() => api.adminPatch(u.id, { reset_2fa: true }), 'Two-factor reset') }}><ShieldOff size={17} style={{ opacity: .55 }} /></button>}
                    <button className="icon-btn sm" title={u.is_admin ? 'Remove admin' : 'Make admin'} aria-label="Toggle admin" disabled={me || u.builtin_admin}
                      onClick={() => act(() => api.adminPatch(u.id, { is_admin: !u.is_admin }), u.is_admin ? 'Admin removed' : 'Now an admin')}>{u.is_admin ? <ShieldOff size={17} /> : <ShieldCheck size={17} />}</button>
                    <button className="icon-btn sm" title="Reset password" aria-label="Reset password"
                      onClick={async () => { const p = await askText({ title: `New password for ${u.name}`, label: 'Set password', placeholder: 'At least 8 characters' }); if (p) void act(() => api.adminPatch(u.id, { password: p }), 'Password changed') }}><KeyRound size={17} /></button>
                    <button className="icon-btn sm" title={u.disabled ? 'Unsuspend' : 'Suspend'} aria-label="Suspend" disabled={me || u.builtin_admin}
                      onClick={() => act(() => api.adminPatch(u.id, { disabled: !u.disabled }), u.disabled ? 'Account restored' : 'Account suspended')}>{u.disabled ? <UserCheck size={17} /> : <UserX size={17} />}</button>
                    <button className="icon-btn sm danger" title="Delete user" aria-label="Delete user" disabled={me || u.builtin_admin}
                      onClick={async () => { if (await askConfirm({ title: `Delete ${u.name}?`, text: `This permanently deletes ${u.email} and everything they own: ${u.docs + u.sheets} files, folders and comments. This can't be undone.`, label: 'Delete user', danger: true })) void act(() => api.adminDelete(u.id), 'User deleted') }}><Trash2 size={17} /></button>
                  </div>
                </div>
              )
            })}
            {shown.length === 0 && <p className="muted">No users match.</p>}
          </div>
        )}
    </>
  )
}

const when = (t: number) => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function FilesTab({ owner, clearOwner }: { owner: AdminUser | null; clearOwner: () => void }) {
  const [files, setFiles] = useState<AdminFile[] | null>(null)
  const [q, setQ] = useState('')
  const load = () => { api.adminFiles({ owner: owner?.id, q }).then(setFiles).catch((e) => toast(e.message)) }
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [owner, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (f: AdminFile) => {
    if (!(await askConfirm({ title: `Delete “${f.title || 'Untitled'}”?`, text: `This permanently deletes it for ${f.owner_name} and everyone it was shared with, including its history and comments. This can't be undone.`, label: 'Delete permanently', danger: true }))) return
    try { await api.adminDeleteFile(f.id); toast('Deleted'); load() } catch (e) { toast((e as Error).message) }
  }
  return (
    <>
      <div className="dash-bar"><h2>{owner ? `Files by ${owner.name}` : 'All files'}</h2>
        {owner && <button className="btn btn-pill btn-ghost btn-sm" onClick={clearOwner}>Show everyone</button>}
        <label className="field admin-search"><Search size={16} /><input placeholder="Search title or owner" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      <p className="muted hint">You can open any file read-only to check for abuse. Opening a file doesn't notify its owner.</p>
      {!files ? <span className="spinner" /> : (
        <div className="admin-table">
          {files.map((f) => (
            <div key={f.id} className={`admin-row ${f.deleted_at ? 'off' : ''}`}>
              <KindIcon kind={f.kind} size={20} />
              <div className="a-who"><b>{f.title || 'Untitled'}</b><span>{f.owner_name} · {f.owner_email}</span></div>
              <div className="a-tags">{f.deleted_at && <span className="tag warn">In recycle bin</span>}{f.link_access !== 'restricted' && <span className="tag">Public link</span>}</div>
              <div className="a-meta">Edited {when(f.updated_at)}</div>
              <div className="a-actions">
                {!f.deleted_at && <a className="icon-btn sm" title="Open read-only" aria-label="Open" href={`/d/${f.id}`} target="_blank" rel="noreferrer"><ExternalLink size={17} /></a>}
                <button className="icon-btn sm danger" title="Delete permanently" aria-label="Delete" onClick={() => remove(f)}><Trash2 size={17} /></button>
              </div>
            </div>
          ))}
          {files.length === 0 && <p className="muted">No files found.</p>}
        </div>
      )}
    </>
  )
}

function EmailSettings({ s, apply }: { s: AdminSettings; apply: (x: AdminSettings) => void }) {
  const [host, setHost] = useState(s.smtp_host)
  const [port, setPort] = useState(String(s.smtp_port))
  const [sec, setSec] = useState<'starttls' | 'ssl' | 'none'>(s.smtp_security)
  const [user, setUser] = useState(s.smtp_user)
  const [pw, setPw] = useState('')
  const [from, setFrom] = useState(s.smtp_from)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = host !== s.smtp_host || Number(port) !== s.smtp_port || sec !== s.smtp_security || user !== s.smtp_user || from !== s.smtp_from || !!pw
  const save = async () => {
    setBusy(true); setErr('')
    try { apply(await api.adminSaveSettings({ smtp_host: host, smtp_port: Number(port) || 587, smtp_security: sec, smtp_user: user, smtp_from: from, ...(pw ? { smtp_password: pw } : {}) })); setPw(''); toast('Saved. Send a test email to switch it on.') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setErr('')
    try { const r = await api.adminEmailTest(); apply(await api.adminSettings()); toast(`Test email sent to ${r.sent_to}`) } catch (e) { setErr((e as Error).message); apply(await api.adminSettings()) } finally { setBusy(false) }
  }
  const remove = async () => { setBusy(true); try { await api.adminEmailRemove(); const x = await api.adminSettings(); apply(x); setHost(''); setUser(''); setFrom(''); setPw(''); toast('Email removed') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  return (
    <>
      <div>
        <h3 style={{ margin: '8px 0 4px' }}>Email (SMTP) <span className={`tag ${s.email_active ? '' : 'warn'}`} style={{ marginLeft: 6, verticalAlign: 'middle' }}>{s.email_active ? 'Active' : 'Off'}</span></h3>
        <p className="muted hint" style={{ marginTop: 0 }}>Optional. When active, new accounts must confirm their email with a 6-digit code, and people can reset a forgotten password. It switches on only after a test email is delivered, and switches off again if you change these settings.</p>
        <p className="muted hint" style={{ marginTop: 0 }}>@mention emails don't wait for this: they are sent as soon as the host and From address are saved. If they don't arrive, the server log says why.</p>
      </div>
      <div className="ps-row">
        <label className="ai-field" style={{ flex: 1, minWidth: 180 }}><span>SMTP host</span><span className="field"><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" spellCheck={false} /></span></label>
        <label className="ai-field" style={{ width: 90 }}><span>Port</span><span className="field"><input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} /></span></label>
        <div className="ai-field"><span>Security</span><Select label="Security" value={sec} onChange={setSec} options={[{ value: 'starttls', label: 'STARTTLS (587)' }, { value: 'ssl', label: 'SSL/TLS (465)' }, { value: 'none', label: 'None' }]} /></div>
      </div>
      <div className="ps-row">
        <label className="ai-field" style={{ flex: 1, minWidth: 180 }}><span>Username</span><span className="field"><input autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} /></span></label>
        <label className="ai-field" style={{ flex: 1, minWidth: 180 }}><span>Password</span><span className="field"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={s.smtp_password_set ? 'Saved. Leave blank to keep it' : ''} /></span></label>
      </div>
      <label className="ai-field"><span>From address</span><span className="field"><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="KokoDocs <noreply@example.com>" spellCheck={false} /></span></label>
      {err && <p className="form-error">{err}</p>}
      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-pill btn-primary" disabled={busy || !dirty || !host.trim() || !from.trim()} onClick={save}>Save</button>
        <button className="btn btn-pill btn-soft" disabled={busy || dirty || !s.smtp_host || !s.smtp_from} onClick={test}>{busy ? <span className="spinner sm" style={{ borderTopColor: 'var(--ink)' }} /> : 'Send test email to me'}</button>
        {(s.smtp_host || s.smtp_from) && <button className="btn btn-pill btn-ghost" disabled={busy} onClick={remove}>Remove email</button>}
      </div>
    </>
  )
}

const STT_NAMES: Record<string, string> = { groq: 'Groq', mistral: 'Mistral (Voxtral)', openai: 'OpenAI', 'openai-compatible': 'Other OpenAI-compatible server', local: 'Local (on this server)' }
const GROQ_LABEL: Record<string, string> = { 'whisper-large-v3-turbo': 'whisper-large-v3-turbo (fast, default)', 'whisper-large-v3': 'whisper-large-v3 (most accurate)' }

/** Which speech-to-text service turns dictation into text, with its key and model. */
const fmtMB = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`)

/** The Hugging Face models kept on this server's disk for local voice typing: add one, watch it download, delete it to free the space. */
const idleText = (s: number, plain = false) => (s < 5 && !plain ? 'just used' : s < 90 ? `${plain ? '' : 'used '}${s} s${plain ? '' : ' ago'}` : `${plain ? '' : 'used '}${Math.round(s / 60)} min${plain ? '' : ' ago'}`)

function LocalModels({ reload, onUse }: { reload: () => void; onUse: (m: string) => void }) {
  const [data, setData] = useState<SttModels | null>(null)
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ text: string; suggestion?: string } | null>(null)
  const load = () => api.adminSttModels().then(setData).catch((e) => setErr({ text: e.message }))
  useEffect(() => { void load() }, [])
  // what is in memory changes by itself (models load when someone dictates and drop when idle), so keep it fresh while this is on screen
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void api.adminSttModels().then(setData).catch(() => {}) }, 5000)
    return () => window.clearInterval(t)
  }, [])
  const freeNow = async (name?: string) => {
    setBusy(true)
    try { const d = await api.adminSttUnload(name); setData(d); reload(); toast(d.unloaded?.length ? 'Freed from memory' : 'Nothing was loaded') } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const downloading = data?.models.some((m) => m.state === 'downloading')
  useEffect(() => {
    if (!downloading) return
    const t = window.setInterval(() => { void api.adminSttModels().then((d) => { setData(d); if (!d.models.some((m) => m.state === 'downloading')) reload() }).catch(() => {}) }, 1800)
    return () => window.clearInterval(t)
  }, [downloading]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (r = repo) => {
    setBusy(true); setErr(null)
    try { setData(await api.adminSttAddModel(r)); setRepo('') }
    catch (e) { const d = (e as ApiError).detail; setErr({ text: (e as Error).message, suggestion: d && typeof d === 'object' ? d.suggestion ?? undefined : undefined }) } finally { setBusy(false) }
  }
  const remove = async (m: SttModel) => {
    if (!(await askConfirm({ title: `Delete ${m.name}?`, text: `This removes ${fmtMB(m.size)} from this server's disk. You can add it again later.`, label: 'Delete from disk', danger: true }))) return
    setBusy(true)
    try { const d = await api.adminSttDeleteModel(m.repo); setData(d); reload(); toast(`Deleted. ${fmtMB(d.freed ?? 0)} freed`) } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  if (!data) return <span className="spinner" />
  return (
    <div className="stt-models">
      <div className="stt-models-head"><b>Models on this server</b><span className="muted">{fmtMB(data.models.reduce((n, m) => n + m.size, 0))} used in <code>{data.dir}</code></span></div>
      <div className="stt-memory">
        <span><i className={`dot ${data.models.some((m) => m.loaded) ? 'on' : ''}`} />{data.models.filter((m) => m.loaded).length ? `${data.models.filter((m) => m.loaded).length} in memory: ${data.models.filter((m) => m.loaded).map((m) => m.name).join(', ')}` : 'No speech model is in memory right now'}</span>
        {data.memory_mb != null && <span className="muted">Server process: {data.memory_mb} MB</span>}
        {data.models.some((m) => m.loaded) && <button className="btn btn-pill btn-soft btn-sm" disabled={busy} onClick={() => void freeNow()}>Free all now</button>}
      </div>
      {data.models.length === 0 && <p className="muted hint" style={{ margin: 0 }}>None yet. The built-in sizes download the first time someone dictates; add one below to download it now.</p>}
      {data.models.map((m) => (
        <div key={m.repo} className={`stt-model ${m.state}`}>
          <div className="stt-model-main"><b>{m.name}</b>{m.builtin && <span className="tag">built-in</span>}<span className="muted">{m.builtin ? m.repo : 'Hugging Face'}</span>
            {m.loaded && <span className="tag live" title={m.loaded.roles.length ? `Used for ${m.loaded.roles.join(' and ')}` : undefined}>in memory{m.loaded.roles.length ? `, ${m.loaded.roles.join(' + ')}` : ''}</span>}
            {m.loaded && <span className="muted">{idleText(m.loaded.idle)}{m.loaded.unload_in != null ? `, drops in ${idleText(m.loaded.unload_in, true)}` : ', stays loaded'}</span>}</div>
          {m.state === 'downloading' ? (
            <div className="stt-model-prog"><div className="meter ok"><i style={{ width: `${Math.min(100, ((m.size / Math.max(1, m.total ?? 1)) * 100))}%` }} /></div><span>{fmtMB(m.size)} of {fmtMB(m.total ?? 0)}</span></div>
          ) : m.state === 'error' ? <span className="form-error" style={{ margin: 0 }}>{m.error}</span>
          : <span className="muted">{m.state === 'incomplete' ? 'Incomplete, ' : ''}{fmtMB(m.size)}</span>}
          <span className="stt-model-btns">
            {m.loaded && <button className="btn btn-pill btn-ghost btn-sm" disabled={busy} onClick={() => void freeNow(m.name)}>Free</button>}
            {m.state === 'ready' && <button className="btn btn-pill btn-soft btn-sm" onClick={() => onUse(m.builtin ? m.name : m.repo)}>Use</button>}
            <button className="icon-btn sm" aria-label={`Delete ${m.name}`} title="Delete from disk" disabled={busy || m.state === 'downloading'} onClick={() => remove(m)}><Trash2 size={16} /></button>
          </span>
        </div>))}
      <div className="ps-row" style={{ alignItems: 'flex-end' }}>
        <label className="ai-field" style={{ flex: 1, minWidth: 220 }}><span>Add a Hugging Face model (name or link)</span>
          <span className="field"><input value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && repo.trim() && add()} placeholder="Systran/faster-distil-whisper-small.en" spellCheck={false} /></span></label>
        <button className="btn btn-pill btn-primary" disabled={busy || !repo.trim() || !data.installed} onClick={() => add()}>{busy ? <span className="spinner sm" /> : <><Download size={16} />Download</>}</button>
      </div>
      <p className="muted hint" style={{ margin: 0 }}>Must be a public Whisper model in CTranslate2 format (a model.bin next to config.json), up to {data.max_mb} MB. Look for “faster-” versions, such as Systran/faster-distil-whisper-small.en.</p>
      {err && <p className="form-error" style={{ margin: 0 }}>{err.text}{err.suggestion && <> <button className="btn btn-pill btn-soft btn-sm" disabled={busy} onClick={() => { setRepo(err.suggestion!); void add(err.suggestion) }}>Download {err.suggestion}</button></>}</p>}
    </div>
  )
}

function VoiceSettings({ s, apply }: { s: AdminSettings; apply: (x: AdminSettings) => void }) {
  const v = s.stt
  const [prov, setProv] = useState<'auto' | SttProvider>(v.provider)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [url, setUrl] = useState(v.url)
  const [lang, setLang] = useState(v.language)
  const [draftOn, setDraftOn] = useState(v.draft)
  const [draftModel, setDraftModel] = useState(v.draft_choice)
  const [idleOn, setIdleOn] = useState(v.idle_unload)
  const [idleMin, setIdleMin] = useState(String(v.idle_minutes))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // each provider remembers its own model, so switching back and forth keeps what was chosen
  const savedModel = (p: SttProvider) => v.models[p] || (p === 'groq' ? 'whisper-large-v3-turbo' : p === 'local' ? 'base.en' : '')
  const effModel = prov !== 'auto' && model !== '' ? model : prov !== 'auto' ? savedModel(prov) : ''
  const change = (p: 'auto' | SttProvider) => { setProv(p); setModel(''); setKey(''); setMsg(null) }
  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const body: Parameters<typeof api.adminSaveSettings>[0] = { stt_provider: prov, stt_language: lang.trim(), stt_draft: draftOn, stt_draft_model: draftModel, stt_idle_unload: idleOn, stt_idle_minutes: Math.min(1440, Math.max(1, Math.round(Number(idleMin)) || v.idle_minutes)) }
      if (prov !== 'auto') {
        body.stt_model = { [prov]: effModel }
        if (key.trim() && prov !== 'local') body.stt_key = { [prov]: key.trim() }
        if (prov === 'openai-compatible') body.stt_url = url.trim()
      }
      apply(await api.adminSaveSettings(body)); setKey(''); toast('Voice typing saved')
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setMsg(null)
    try { const r = await api.adminSttTest(); setMsg({ ok: true, text: r.note ?? `Works: ${STT_NAMES[r.provider] ?? r.provider}, ${r.model}, answered in ${r.ms} ms.` }) }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const clearKey = async () => { if (prov === 'auto' || prov === 'local') return; setBusy(true); try { apply(await api.adminSaveSettings({ stt_clear_key: prov })); toast('Key removed') } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  const changed = draftOn !== v.draft || draftModel !== v.draft_choice || idleOn !== v.idle_unload || (idleOn && Number(idleMin) !== v.idle_minutes) || prov !== v.provider || !!key.trim() || lang.trim() !== v.language || (prov !== 'auto' && effModel !== savedModel(prov)) || (prov === 'openai-compatible' && url.trim() !== v.url)
  const hasKey = prov !== 'auto' && prov !== 'local' && v.key_set[prov]
  const envKey = (prov === 'groq' || prov === 'mistral' || prov === 'openai') && v.env_key[prov]
  const active = v.active
  return (
    <>
      <div>
        <h3 style={{ margin: '8px 0 4px' }}>Voice typing <span className={`tag ${active.available ? '' : 'warn'}`} style={{ marginLeft: 6, verticalAlign: 'middle' }}>{active.available ? `${STT_NAMES[active.provider ?? ''] ?? active.provider}, ${active.model}` : 'Off'}</span></h3>
        <p className="muted hint" style={{ marginTop: 0 }}>Pick the service that turns speech into text, add its key, and it works for everyone. Keys are stored encrypted and never shown again. “Automatic” uses whatever the server's environment provides.</p>
      </div>
      <div className="ps-row">
        <div className="ai-field" style={{ flex: 1, minWidth: 220 }}><span>Provider</span>
          <Select label="Speech provider" value={prov} onChange={change} options={[{ value: 'auto', label: 'Automatic (server environment)' }, ...(['groq', 'mistral', 'openai', 'openai-compatible', 'local'] as SttProvider[]).map((p) => ({ value: p, label: STT_NAMES[p] }))]} /></div>
        {prov === 'groq' && <div className="ai-field" style={{ flex: 1, minWidth: 220 }}><span>Model</span>
          <Select label="Groq model" value={effModel} onChange={setModel} options={v.groq_models.map((m) => ({ value: m, label: GROQ_LABEL[m] ?? m }))} /></div>}
        {prov === 'local' && <div className="ai-field" style={{ flex: 1, minWidth: 220 }}><span>Model</span>
          <Select label="Local model" value={effModel} onChange={setModel} options={v.local_models.map((m) => ({ value: m, label: m }))} /></div>}
      </div>
      {prov === 'openai-compatible' && <label className="ai-field"><span>Server address</span><span className="field"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://host/v1" spellCheck={false} /></span></label>}
      {(prov === 'mistral' || prov === 'openai' || prov === 'openai-compatible') && <label className="ai-field"><span>Model (leave empty for the default)</span><span className="field"><input value={effModel} onChange={(e) => setModel(e.target.value)} placeholder={prov === 'mistral' ? 'voxtral-mini-latest' : 'whisper-1'} spellCheck={false} /></span></label>}
      {prov !== 'auto' && prov !== 'local' && (
        <label className="ai-field"><span>API key{prov === 'openai-compatible' ? ' (if the server needs one)' : ''}</span>
          <span className="field"><input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? 'Saved. Leave blank to keep it' : envKey ? 'Using the key from the server environment' : prov === 'groq' ? 'gsk_…' : 'sk-…'} /></span></label>)}
      {prov === 'local' && <p className="muted hint" style={{ margin: 0 }}>{v.local_installed ? 'faster-whisper is installed. Audio never leaves this server.' : 'faster-whisper is not installed on this server: run pip install -r requirements-local.txt and restart.'}</p>}
      {v.local_installed && (prov === 'local' || v.draft || v.loaded.length > 0) && <LocalModels reload={() => { void api.adminSettings().then(apply) }} onUse={(m) => setModel(m)} />}
      <label className="ai-field" style={{ maxWidth: 260 }}><span>Language (optional, like en; empty detects it)</span><span className="field"><input value={lang} onChange={(e) => setLang(e.target.value)} maxLength={12} spellCheck={false} placeholder="auto" /></span></label>
      {v.local_installed && (
        <div className="ai-field" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <span><b>Free memory when idle</b><br /><span className="muted hint">A speech model that hasn't been used for a while is dropped from memory and loads again (a second or two) the next time someone dictates. {v.loaded.length ? `In memory now: ${v.loaded.join(', ')}.` : 'No speech model is in memory right now.'}</span></span>
            <button type="button" role="switch" aria-checked={idleOn} aria-label="Free memory when idle" className={`toggle ${idleOn ? 'on' : ''}`} onClick={() => setIdleOn(!idleOn)} />
          </div>
          {idleOn && <label className="ai-field" style={{ maxWidth: 260 }}><span>Drop a model after this many minutes unused</span><span className="field"><input type="number" min={1} max={1440} value={idleMin} onChange={(e) => setIdleMin(e.target.value)} /></span></label>}
        </div>)}
      <div className="ai-field" style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <span><b>Live preview while speaking</b><br /><span className="muted hint">{v.local_installed ? `Shows the words as people talk, written by a small model on this server (${v.draft_model ?? 'tiny'}, free and private). What gets inserted is still the better transcript from the provider above.` : 'Needs faster-whisper on this server (pip install -r requirements-local.txt), then restart. Until then the pill only shows a waveform.'}</span></span>
        <button type="button" role="switch" aria-checked={draftOn} aria-label="Live preview while speaking" disabled={!v.local_installed} className={`toggle ${draftOn ? 'on' : ''}`} onClick={() => setDraftOn(!draftOn)} />
      </div>
      {draftOn && v.local_installed && (
        <div className="ai-field" style={{ maxWidth: 420 }}>
          <span>Model that writes the live preview</span>
          <Select label="Live preview model" value={v.draft_options.some((o) => o.value === draftModel) ? draftModel : ''} onChange={setDraftModel}
            options={[{ value: '', label: `Automatic (${v.draft_model ?? 'tiny'})` }, ...v.draft_options.map((o) => ({ value: o.value, label: `${o.label}, ${fmtMB(o.size)}` }))]} />
          <span className="muted hint">Only models already downloaded on this server are listed (add more in the list above). A bigger model gets the words right more often but is slower, so the preview may lag behind your voice, and it takes more memory while it is loaded. The final text always comes from the provider you chose.</span>
        </div>)}
      {msg && <p className={msg.ok ? 'ai-ok' : 'form-error'}>{msg.text}</p>}
      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-pill btn-primary" disabled={busy || !changed} onClick={save}>Save</button>
        <button className="btn btn-pill btn-soft" disabled={busy || changed || !active.available} onClick={test}>{busy ? <span className="spinner sm" style={{ borderTopColor: 'var(--ink)' }} /> : 'Test'}</button>
        {hasKey && <button className="btn btn-pill btn-ghost" disabled={busy} onClick={clearKey}>Remove key</button>}
      </div>
    </>
  )
}

const NO_AI: AiAdmin = { models: [], env: { configured: false, url: '', model: '' }, using_env: false, people_own: 0 }

/** The page can be newer than the server it talks to (the site files updated, the backend not yet, or not restarted). Fill in whatever an
 *  older server leaves out so nothing crashes, and say that the server is behind. */
function normalise(x: AdminSettings): { s: AdminSettings; behind: boolean } {
  const behind = !x.ai || !x.stt || x.stt.loaded === undefined || x.stt.draft === undefined
  return { behind, s: { ...x, ai: x.ai ?? NO_AI, stt: Object.assign({ draft: false, draft_model: null, draft_choice: '', draft_options: [], loaded: [], idle_unload: false, idle_minutes: 3 }, x.stt ?? {}) as AdminSettings['stt'] } }
}

function useAdminSettings() {
  const [state, setState] = useState<{ s: AdminSettings; behind: boolean } | null>(null)
  useEffect(() => { api.adminSettings().then((x) => setState(normalise(x))).catch((e) => toast(e.message)) }, [])
  const set = (x: AdminSettings) => setState(normalise(x))
  return [state?.s ?? null, set, !!state?.behind] as const
}

function AccessSection({ s, apply }: { s: AdminSettings; apply: (x: AdminSettings) => void }) {
  const [quotaText, setQuotaText] = useState(String(s.default_quota_mb))
  const [busy, setBusy] = useState(false)
  const save = async (b: Parameters<typeof api.adminSaveSettings>[0], msg = 'Saved') => {
    setBusy(true)
    try { apply(await api.adminSaveSettings(b)); toast(msg) } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="ad-stack">
      <div className="ad-card">
        <div className="switch-row">
          <div><b>Allow new sign-ups</b><span>When off, nobody can create an account (including through single sign-on). Existing users can still sign in.</span></div>
          <button role="switch" aria-checked={s.signup_enabled} aria-label="Allow sign-ups" className={`toggle ${s.signup_enabled ? 'on' : ''}`} onClick={() => save({ signup_enabled: !s.signup_enabled }, s.signup_enabled ? 'Sign-ups closed' : 'Sign-ups open')} />
        </div>
      </div>
      <div className="ad-card">
        <label className="ai-field"><span>Default storage per user (MB, 0 = unlimited)</span>
          <span className="ps-row" style={{ alignItems: 'center' }}><span className="field" style={{ width: 140 }}><input inputMode="numeric" value={quotaText} onChange={(e) => setQuotaText(e.target.value)} /></span>
            <button className="btn btn-pill btn-soft btn-sm" disabled={busy || !/^\d+$/.test(quotaText.trim()) || Number(quotaText) === s.default_quota_mb} onClick={() => save({ default_quota_mb: Number(quotaText) }, 'Default storage limit saved')}>Save</button></span>
          <span className="muted hint">Counts documents, spreadsheets, version history, uploaded images and files people attach to forms. Individual users can be given their own limit under Users.</span></label>
      </div>
    </div>
  )
}

/** One model the admin offers everyone. */
function GlobalModelCard({ m, count, onChange, onDelete }: { m: AiAdminModel; count: number; onChange: (x: AiAdmin) => void; onDelete: (x: AiAdmin) => void }) {
  const [edit, setEdit] = useState(false)
  const [label, setLabel] = useState(m.label)
  const [url, setUrl] = useState(m.base_url)
  const [model, setModel] = useState(m.model)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (f: () => Promise<void>) => { setBusy(true); setMsg(null); try { await f() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) } }
  const save = () => run(async () => { onChange(await api.adminAiEdit(m.id, { label: label.trim(), base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) })); setKey(''); setEdit(false); toast('Saved') })
  const test = () => run(async () => { const r = await api.adminAiTest(m.id); setModels(r.models); setMsg({ ok: r.model_ok, text: r.model_ok ? `Works: ${r.models.length ? `${r.models.length} models available, ` : ''}answered in ${r.ms} ms.` : `Connected, but the provider doesn't list “${m.model}”.` }) })
  const remove = async () => { if (await askConfirm({ title: `Remove “${m.label}”?`, text: 'People who had picked it switch to another model. Their own models are not affected.', label: 'Remove', danger: true })) void run(async () => onDelete(await api.adminAiDelete(m.id))) }
  return (
    <div className={`ad-card gm-card ${m.enabled ? '' : 'off'}`}>
      <div className="gm-head">
        <div className="gm-title"><b>{m.label}</b>{m.default && <span className="sso-chip on">Default</span>}{!m.enabled && <span className="sso-chip">Off</span>}<span className="muted">{m.model} · {(() => { try { return new URL(m.base_url).hostname } catch { return m.base_url } })()}{m.key_set ? ' · key saved' : ''}</span></div>
        <div className="gm-actions">
          <button className="btn btn-pill btn-ghost btn-sm" disabled={busy} onClick={() => void test()}>Test</button>
          <button className="icon-btn sm" aria-label={`Edit ${m.label}`} onClick={() => setEdit(!edit)}><Pencil size={15} /></button>
          <button className="icon-btn sm" aria-label={`Remove ${m.label}`} disabled={busy} onClick={() => void remove()}><Trash2 size={15} /></button>
          <button role="switch" aria-checked={m.enabled} aria-label={`Offer ${m.label}`} disabled={busy} className={`toggle ${m.enabled ? 'on' : ''}`} onClick={() => void run(async () => onChange(await api.adminAiEdit(m.id, { enabled: !m.enabled })))} />
        </div>
      </div>
      {msg && <p className={msg.ok ? 'ai-ok' : 'form-error'} style={{ margin: '8px 0 0' }}>{msg.text}</p>}
      {!m.default && m.enabled && count > 1 && <button className="cm-link" disabled={busy} onClick={() => void run(async () => onChange(await api.adminAiDefault(m.id)))}>Make this the default</button>}
      {edit && (
        <div className="ad-form gm-edit">
          <label className="ai-field"><span>Name in the model list</span><span className="field"><input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></span></label>
          <label className="ai-field"><span>Base URL</span><span className="field"><input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></span></label>
          <label className="ai-field"><span>API key</span><span className="field"><input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={m.key_set ? 'Saved. Leave blank to keep it' : 'sk-…'} /></span></label>
          <label className="ai-field"><span>Model</span><span className="field"><input list={`gm-${m.id}`} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></span><datalist id={`gm-${m.id}`}>{models.map((x) => <option key={x} value={x} />)}</datalist></label>
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <span>{m.key_set && <button className="btn btn-pill btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { onChange(await api.adminAiEdit(m.id, { clear_key: true })); toast('Key removed') })}>Remove key</button>}</span>
            <span style={{ display: 'flex', gap: 8 }}><button className="btn btn-pill btn-ghost" onClick={() => setEdit(false)}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || !url.trim() || !model.trim()} onClick={() => void save()}>Save</button></span>
          </div>
        </div>)}
    </div>
  )
}

/** The models Koko offers everyone: as many as you like. People can still add their own and pick which one answers. */
function AssistantSection() {
  const [ai, setAi] = useState<AiAdmin | null>(null)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { api.adminAiModels().then(setAi).catch((e) => toast(e.message)) }, [])
  if (!ai) return <span className="spinner" />
  const add = async () => {
    setBusy(true); setErr('')
    try { setAi(await api.adminAiAdd({ label: label.trim(), base_url: url.trim(), model: model.trim(), ...(key.trim() ? { api_key: key.trim() } : {}) })); setLabel(''); setUrl(''); setModel(''); setKey(''); toast('Model added') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="ad-stack">
      {ai.models.length === 0 && (
        <div className="ad-card"><p className="ad-state"><i className={ai.env.configured ? 'on' : ''} />{ai.using_env ? <>Everyone uses the connection from the server's environment: <code>{ai.env.model || 'model'}</code> at <code>{ai.env.url}</code>. Add a model below to replace it.</> : 'No model is offered to everyone yet. Until you add one, people bring their own.'}</p></div>)}
      {ai.models.map((m) => <GlobalModelCard key={m.id} m={m} count={ai.models.length} onChange={setAi} onDelete={setAi} />)}
      {ai.models.length > 0 && <p className="muted hint" style={{ margin: '0 4px' }}>The model at the top is the default. Everyone can switch between these in the chat box{ai.people_own > 0 ? `, and ${ai.people_own} ${ai.people_own === 1 ? 'model has' : 'models have'} been added by people for themselves` : ''}.</p>}
      <div className="ad-card ad-form">
        <h3 style={{ margin: 0 }}>Add a model for everyone</h3>
        <p className="muted hint" style={{ margin: 0 }}>Any OpenAI-compatible service. The key is encrypted on the server and never sent to a browser, not even yours.</p>
        <div className="ai-presets">{PRESETS.map((p) => <button key={p.name} className={`chip ${url === p.url ? 'on' : ''}`} onClick={() => { setUrl(p.url); setModel(p.model); if (!label) setLabel(p.name) }}>{p.name}</button>)}</div>
        <label className="ai-field"><span>Name in the model list</span><span className="field"><input placeholder="Mistral Large" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></span></label>
        <label className="ai-field"><span>Base URL</span><span className="field"><input placeholder="https://api.mistral.ai/v1" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></span></label>
        <label className="ai-field"><span>API key</span><span className="field"><input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" /></span></label>
        <label className="ai-field"><span>Model</span><span className="field"><input placeholder="mistral-large-latest" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></span></label>
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-pill btn-primary" disabled={busy || !url.trim() || !model.trim()} onClick={() => void add()}><Plus size={15} />Add model</button></div>
      </div>
    </div>
  )
}

const SSO_FIELDS = ['name', 'client_id', 'authorize_url', 'token_url', 'userinfo_url', 'emails_url', 'scopes', 'subject_field', 'email_field', 'name_field', 'verified_field'] as const

function ProviderCard({ p, hint, onChange, onDelete }: { p: SsoProvider; hint: string; onChange: (x: SsoProvider) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(!p.ready)
  const [d, setD] = useState<Record<string, string>>(() => Object.fromEntries(SSO_FIELDS.map((k) => [k, p[k]])))
  const [secret, setSecret] = useState('')
  const [trust, setTrust] = useState(p.trust_email)
  const [method, setMethod] = useState(p.auth_method)
  const [issuer, setIssuer] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }))
  const dirty = SSO_FIELDS.some((k) => d[k].trim() !== p[k]) || !!secret.trim() || trust !== p.trust_email || method !== p.auth_method
  const run = async (f: () => Promise<unknown>, fail = true) => { setBusy(true); setMsg(null); try { await f() } catch (e) { if (fail) setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) } }
  const save = () => run(async () => { const x = await api.adminSsoSave(p.id, { ...Object.fromEntries(SSO_FIELDS.map((k) => [k, d[k].trim()])), ...(secret.trim() ? { client_secret: secret.trim() } : {}), trust_email: trust, auth_method: method }); setSecret(''); onChange(x); toast(`${x.name} saved`) })
  const toggle = () => run(async () => { onChange(await api.adminSsoSave(p.id, { enabled: !p.enabled })) })
  const discover = () => run(async () => { const r = await api.adminSsoDiscover(issuer); setD((x) => ({ ...x, authorize_url: r.authorize_url, token_url: r.token_url, userinfo_url: r.userinfo_url, scopes: r.scopes, ...(x.name === 'Single sign-on' && r.name ? { name: new URL(r.name).hostname } : {}) })); setMsg({ ok: true, text: 'Addresses filled in. Add the client ID and secret, then save.' }) })
  const remove = async () => {
    if (!(await askConfirm({ title: `Remove ${p.name}?`, text: p.linked ? `${p.linked} ${p.linked === 1 ? 'person has' : 'people have'} signed in or linked with it. They keep their accounts, but those who never set a password won't be able to sign in until they reset it by email (if email is set up).` : 'Nobody has used it yet.', label: 'Remove', danger: true }))) return
    void run(async () => { await api.adminSsoDelete(p.id); onDelete() })
  }
  const state = !p.enabled ? 'Off' : p.ready ? 'On' : 'Needs setup'
  return (
    <div className={`ad-card sso-card ${open ? 'open' : ''}`}>
      <div className="sso-head">
        <button className="sso-title" onClick={() => setOpen(!open)} aria-expanded={open}><ProviderMark preset={p.preset} /><b>{p.name}</b><span className={`sso-chip ${p.ready && p.enabled ? 'on' : ''}`}>{state}</span>{p.linked > 0 && <em>{p.linked} {p.linked === 1 ? 'person' : 'people'}</em>}<ChevronRight size={16} className="sso-caret" /></button>
        <button role="switch" aria-checked={p.enabled} aria-label={`Offer ${p.name}`} disabled={busy} className={`toggle ${p.enabled ? 'on' : ''}`} onClick={toggle} />
      </div>
      {open && (
        <div className="ad-form sso-body">
          {hint && <p className="muted hint" style={{ margin: 0 }}>{hint}</p>}
          <label className="ai-field"><span>Redirect address (give this to the provider)</span>
            <span className="sec-secret"><span style={{ flex: 1 }}>{p.redirect_uri}</span><button className="icon-btn sm" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(p.redirect_uri); toast('Copied') }}><Copy size={15} /></button></span></label>
          <label className="ai-field"><span>Name shown on the button</span><span className="field"><input value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></span></label>
          <label className="ai-field"><span>Client ID</span><span className="field"><input value={d.client_id} onChange={(e) => set('client_id', e.target.value)} spellCheck={false} autoComplete="off" /></span></label>
          <label className="ai-field"><span>Client secret</span><span className="field"><input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p.secret_set ? 'Saved. Leave blank to keep it' : ''} /></span></label>
          <div className="ai-field"><span>Have an OpenID Connect issuer address? Paste it to fill in the addresses</span>
            <span className="ai-model"><span className="field"><input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://auth.example.com/realms/main" spellCheck={false} /></span>
              <button className="btn btn-pill btn-soft" disabled={busy || !issuer.trim()} onClick={discover}>Discover</button></span></div>
          <details className="sso-adv">
            <summary>Addresses, fields and trust</summary>
            <div className="ad-form">
              {([['authorize_url', 'Authorize address'], ['token_url', 'Token address'], ['userinfo_url', 'User info address'], ['emails_url', 'Emails address (optional, for providers like GitHub that list emails separately)'], ['scopes', 'Scopes']] as const).map(([k, label]) => (
                <label key={k} className="ai-field"><span>{label}</span><span className="field"><input value={d[k]} onChange={(e) => set(k, e.target.value)} spellCheck={false} /></span></label>))}
              <div className="sso-grid">
                {([['subject_field', 'Field that identifies the person'], ['email_field', 'Email field'], ['name_field', 'Name field (first that exists)'], ['verified_field', 'Email verified field (blank if none)']] as const).map(([k, label]) => (
                  <label key={k} className="ai-field"><span>{label}</span><span className="field"><input value={d[k]} onChange={(e) => set(k, e.target.value)} spellCheck={false} /></span></label>))}
              </div>
              <div className="ai-field"><span>Send the client secret</span><Select label="Client authentication" value={method} onChange={setMethod} options={[{ value: 'post', label: 'In the request body (most providers)' }, { value: 'basic', label: 'As a Basic authorization header' }]} /></div>
              <div className="switch-row">
                <div><b>Trust the email this provider returns</b><span>Accounts are matched by email, so an email is only used when the provider says it is verified. Turn this on only for a provider you control (your own company's), where every email is real.</span></div>
                <button role="switch" aria-checked={trust} aria-label="Trust emails" className={`toggle ${trust ? 'on' : ''}`} onClick={() => setTrust(!trust)} /></div>
            </div>
          </details>
          {msg && <p className={msg.ok ? 'ai-ok' : 'form-error'}>{msg.text}</p>}
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-pill btn-primary" disabled={busy || !dirty} onClick={save}>Save</button>
            <button className="btn btn-pill btn-ghost" disabled={busy} onClick={remove}><Trash2 size={15} />Remove</button>
          </div>
        </div>)}
    </div>
  )
}

/** Single sign-on: any OAuth 2.0 / OpenID Connect provider. Google, GitHub and the rest are just presets that fill the form in. */
function SsoSection({ s, apply }: { s: AdminSettings; apply: (x: AdminSettings) => void }) {
  const [data, setData] = useState<SsoAdmin | null>(null)
  const [url, setUrl] = useState(s.public_url)
  const [busy, setBusy] = useState(false)
  const load = () => { api.adminSso().then(setData).catch((e) => toast(e.message)) }
  useEffect(load, [])
  if (!data) return <span className="spinner" />
  const add = async (preset: string) => { setBusy(true); try { await api.adminSsoAdd(preset); load() } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  const savePublic = async () => { setBusy(true); try { const x = await api.adminSaveSettings({ public_url: url.trim() }); apply(x); load(); toast('Saved') } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  return (
    <div className="ad-stack">
      {data.providers.map((p) => <ProviderCard key={p.id} p={p} hint={data.presets.find((x) => x.id === p.preset)?.hint ?? ''} onChange={(x) => setData({ ...data, providers: data.providers.map((y) => (y.id === x.id ? x : y)) })} onDelete={load} />)}
      <div className="ad-card">
        <h3 style={{ margin: '0 0 4px' }}>Add a sign-in option</h3>
        <p className="muted hint" style={{ margin: '0 0 12px' }}>Pick a service to start from, or <b>Single sign-on</b> for any other OAuth 2.0 / OpenID Connect provider (Keycloak, Authentik, Okta, Auth0...).</p>
        <div className="sso-presets">
          {data.presets.map((p) => <button key={p.id} className="btn btn-pill btn-soft" disabled={busy} onClick={() => void add(p.id)}><ProviderMark preset={p.id} />{p.name}</button>)}
        </div>
      </div>
      <div className="ad-card ad-form">
        <label className="ai-field"><span>Public address of this site (only if the redirect addresses above are wrong behind your proxy)</span>
          <span className="ps-row" style={{ alignItems: 'center' }}><span className="field" style={{ flex: 1 }}><input placeholder="https://docs.example.com" value={url} onChange={(e) => setUrl(e.target.value)} /></span>
            <button className="btn btn-pill btn-soft btn-sm" disabled={busy || url.trim() === data.public_url} onClick={savePublic}>Save</button></span></label>
      </div>
    </div>
  )
}

function Overview({ s, go }: { s: AdminSettings | null; go: (id: AdminSection) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [sso, setSso] = useState<SsoProvider[] | null>(null)
  useEffect(() => { api.adminStats().then(setStats).catch(() => {}); api.adminSso().then((r) => setSso(r.providers)).catch(() => setSso([])) }, [])
  const stt = s?.stt
  const rows: { id: AdminSection; label: string; value: string; ok: boolean }[] = s ? [
    { id: 'access', label: 'Sign-ups', value: s.signup_enabled ? 'Open' : 'Closed', ok: s.signup_enabled },
    { id: 'access', label: 'Default storage', value: s.default_quota_mb ? `${s.default_quota_mb} MB per user` : 'Unlimited', ok: true },
    { id: 'email', label: 'Email', value: s.email_active ? 'Active' : 'Off', ok: s.email_active },
    { id: 'sso', label: 'Single sign-on', value: sso ? (sso.filter((p) => p.ready && p.enabled).map((p) => p.name).join(', ') || 'Not set up') : '…', ok: !!sso?.some((p) => p.ready && p.enabled) },
    { id: 'assistant', label: 'Koko models', value: s.ai.models.filter((m) => m.enabled).length ? `${s.ai.models.filter((m) => m.enabled).length} offered (${s.ai.models.find((m) => m.default)?.label ?? ''} is the default)` : s.ai.using_env ? `From the environment${s.ai.env.model ? `, ${s.ai.env.model}` : ''}` : 'Everyone brings their own', ok: s.ai.models.some((m) => m.enabled) || s.ai.using_env },
    { id: 'voice', label: 'Voice typing', value: stt?.active.available ? `${stt.active.provider}, ${stt.active.model}` : 'Off', ok: !!stt?.active.available },
    { id: 'voice', label: 'Live preview', value: stt?.draft && stt.draft_model ? `On (${stt.draft_model})` : 'Off', ok: !!(stt?.draft && stt.draft_model) },
  ] : []
  return (
    <div className="ad-stack">
      {stats ? (
        <div className="ad-stats">
          {([['Users', stats.users], ['Documents', stats.documents], ['Spreadsheets', stats.spreadsheets], ['In recycle bin', stats.trashed], ['Comments', stats.comments], ['Versions', stats.versions], ['Uploads', bytes(stats.upload_bytes)]] as const).map(([l, v]) => (
            <div key={l} className="ad-stat"><b>{v}</b><span>{l}</span></div>))}
        </div>) : <span className="spinner" />}
      <div className="ad-card ad-status">
        <h3>Server status</h3>
        {rows.map((r, i) => (
          <button key={i} className="ad-status-row" onClick={() => go(r.id)}><span>{r.label}</span><b><i className={r.ok ? 'on' : ''} />{r.value}</b><ChevronRight size={16} /></button>))}
        {!s && <span className="spinner" />}
      </div>
    </div>
  )
}

type AdminSection = 'overview' | 'users' | 'files' | 'access' | 'email' | 'sso' | 'voice' | 'assistant'
const SECTIONS: { id: AdminSection; label: string; icon: React.ReactNode; group: string; blurb: string }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={17} />, group: 'Manage', blurb: 'How much is on this server, and how it is set up.' },
  { id: 'users', label: 'Users', icon: <Users size={17} />, group: 'Manage', blurb: 'Accounts, storage limits, admins and two-factor resets.' },
  { id: 'files', label: 'Files', icon: <Files size={17} />, group: 'Manage', blurb: 'Every document on the server. Open, download or delete.' },
  { id: 'access', label: 'Access & storage', icon: <SlidersHorizontal size={17} />, group: 'Configure', blurb: 'Who can sign up, and how much room each person gets.' },
  { id: 'email', label: 'Email', icon: <Mail size={17} />, group: 'Configure', blurb: 'Confirmation codes, password resets and mention emails.' },
  { id: 'sso', label: 'Single sign-on', icon: <KeyRound size={17} />, group: 'Configure', blurb: 'Let people sign in with Google, GitHub or any OAuth 2.0 / OpenID Connect provider.' },
  { id: 'assistant', label: 'Assistant (Koko)', icon: <Sparkles size={17} />, group: 'Configure', blurb: 'The models Koko offers everyone. People can pick between them, and add their own.' },
  { id: 'voice', label: 'Voice typing', icon: <Mic size={17} />, group: 'Configure', blurb: 'The speech provider, live preview, and models kept on this server.' },
]
const fromHash = (): AdminSection => { const raw = location.hash.slice(1); const h = (raw === 'google' ? 'sso' : raw) as AdminSection; /* (#google was this section's old name) */ return SECTIONS.some((x) => x.id === h) ? h : 'overview' }

export function AdminPage() {
  const { user } = useAuth()
  const [sec, setSec] = useState<AdminSection>(fromHash)
  const [mobileList, setMobileList] = useState(() => !location.hash)
  const [owner, setOwner] = useState<AdminUser | null>(null)
  const [s, setS, behind] = useAdminSettings()
  useEffect(() => { const f = () => { setSec(fromHash()); setMobileList(!location.hash) }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  if (!user?.is_admin) return <div className="splash"><p>Admins only.</p><Link to="/" className="btn btn-pill btn-ghost">Back to documents</Link></div>
  const open = (id: AdminSection) => { history.replaceState(null, '', `#${id}`); setSec(id); setMobileList(false); if (id !== 'files') setOwner(null) }
  const cur = SECTIONS.find((x) => x.id === sec)!
  const groups = [...new Set(SECTIONS.map((x) => x.group))]
  const settingsBody = (render: (s: AdminSettings) => React.ReactNode) => (s ? render(s) : <span className="spinner" />)

  return (
    <div className={`ad-shell ${mobileList ? 'list' : 'detail'}`}>
      <nav className="ad-side" aria-label="Admin sections">
        <div className="ad-brand"><Logo size={30} /><div><b>KokoDocs</b><span className="ad-badge">Admin</span></div></div>
        <Link to="/" className="ad-back"><ArrowLeft size={16} />Back to documents</Link>
        {groups.map((g) => (
          <div key={g} className="ad-group"><h3>{g}</h3>
            {SECTIONS.filter((x) => x.group === g).map((x) => (
              <button key={x.id} className={`ad-nav ${sec === x.id ? 'on' : ''}`} aria-current={sec === x.id ? 'page' : undefined} onClick={() => open(x.id)}>{x.icon}<span>{x.label}</span></button>))}
          </div>))}
        <div className="ad-me"><Avatar name={user.name} color={user.color} size={30} /><div><b>{user.name}</b><span>{user.email}</span></div></div>
      </nav>
      <main className="ad-main">
        <div className="ad-main-inner">
          <button className="ad-mback" onClick={() => setMobileList(true)}><ChevronLeft size={18} />Admin</button>
          <header className="ad-head"><h1>{cur.label}</h1><p>{cur.blurb}</p></header>
          {behind && <div className="ad-warn" role="alert"><b>The server is older than this page.</b> It doesn't know about some newer settings (such as the assistant connection or live voice preview). Update the server files (the <code>backend</code> folder, not only the site) and restart it. Until then those settings show as empty and can't be saved.</div>}
          {sec === 'overview' && <Overview s={s} go={open} />}
          {sec === 'users' && <UsersTab onFiles={(u) => { setOwner(u); history.replaceState(null, '', '#files'); setSec('files') }} />}
          {sec === 'files' && <FilesTab owner={owner} clearOwner={() => setOwner(null)} />}
          {sec === 'access' && settingsBody((x) => <AccessSection s={x} apply={setS} />)}
          {sec === 'email' && settingsBody((x) => <div className="ad-card ad-form"><EmailSettings s={x} apply={setS} /></div>)}
          {sec === 'sso' && settingsBody((x) => <SsoSection s={x} apply={setS} />)}
          {sec === 'assistant' && <AssistantSection />}
          {sec === 'voice' && settingsBody((x) => <div className="ad-card ad-form"><VoiceSettings s={x} apply={setS} /></div>)}
        </div>
      </main>
    </div>
  )
}
