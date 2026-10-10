import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, CloudUpload, Loader2, RotateCcw, Unplug } from 'lucide-react'
import { api, type StorageIn, type StorageState } from '../api'
import { toast } from '../ui/Toast'
import { askConfirm } from '../ui/Dialogs'

type Kind = 'folder' | 'webdav' | 's3'
const KIND_NAME: Record<Kind, string> = { folder: 'A folder on the server', webdav: 'WebDAV (Nextcloud, ownCloud, a NAS…)', s3: 'S3-compatible (AWS, Cloudflare R2, MinIO, Backblaze, Wasabi…)' }
const FIELDS: Record<Kind, { key: string; label: string; ph: string; secret?: boolean; hint?: string }[]> = {
  folder: [{ key: 'path', label: 'Folder', ph: 'my-files', hint: 'A folder inside the one whoever runs this server has set aside for this.' }],
  webdav: [
    { key: 'url', label: 'Address', ph: 'https://cloud.example.com/remote.php/dav/files/you', hint: 'For Nextcloud this is on your Files page under Settings → WebDAV.' },
    { key: 'username', label: 'Name', ph: 'you' }, { key: 'password', label: 'Password', ph: '', secret: true, hint: 'Use an app password if your service has them.' },
    { key: 'prefix', label: 'Folder', ph: 'kokodocs', hint: 'Created for you if it is not there.' },
  ],
  s3: [
    { key: 'endpoint', label: 'Endpoint', ph: 'https://s3.eu-west-1.amazonaws.com', hint: 'Cloudflare R2: https://ACCOUNT.r2.cloudflarestorage.com · Backblaze: https://s3.us-west-004.backblazeb2.com · MinIO: your own address.' },
    { key: 'region', label: 'Region', ph: 'us-east-1', hint: 'R2 uses “auto”.' }, { key: 'bucket', label: 'Bucket', ph: 'my-kokodocs' },
    { key: 'access_key', label: 'Access key', ph: '' }, { key: 'secret_key', label: 'Secret key', ph: '', secret: true },
    { key: 'prefix', label: 'Folder in the bucket', ph: 'kokodocs' },
  ],
}
const IDLE = [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, 'an hour'], [1440, 'a day']] as const
const size = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)


/** how far a move to the storage has got: a bar, how much, what is being sent now, and anything that could not be moved */
function Progress({ s, onRetry }: { s: StorageState; onRetry: () => void }) {
  const p = s.progress, j = s.job
  const bar = (pct: number) => <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
  const failedList = (list: { what: string; error: string }[], retry?: () => void) => list.length > 0 && (
    <details className="st-failed" open={list.length <= 3}><summary><AlertCircle size={15} />{list.length} could not be {retry ? 'moved' : 'brought back'}. The rest carried on.{retry && <button type="button" className="btn btn-pill btn-soft btn-sm" onClick={(e) => { e.preventDefault(); retry() }}>Try again</button>}</summary>
      <ul>{list.map((f, i) => <li key={i}><b>{f.what}</b><span>{f.error}</span></li>)}</ul></details>)
  if (j && (j.running || j.failed?.length)) {
    const pct = j.total ? (j.done / j.total) * 100 : 0
    return <div className="st-progress">{j.running && <><div className="st-prog-head"><Loader2 size={15} className="spin" />Bringing everything back… {j.done} of {j.total}{j.bytes_done ? ` · ${size(j.bytes_done)}` : ''}</div>{bar(pct)}</>}{failedList(j.failed ?? [])}</div>
  }
  if (!p) return null
  const total = p.docs_total + p.files_total, done = p.docs_done + p.files_done
  const pct = p.bytes_total ? (p.bytes_done / p.bytes_total) * 100 : total ? (done / total) * 100 : 100
  return (
    <div className="st-progress">
      {p.running ? (
        <>
          <div className="st-prog-head"><Loader2 size={15} className="spin" /><b>Moving to your storage</b><span>{done} of {total} · {size(p.bytes_done)} of {size(p.bytes_total)} ({Math.round(pct)}%)</span></div>
          {bar(pct)}
          <div className="st-prog-now">{p.phase === 'files' ? 'Pictures and attachments' : 'Documents'}{p.current ? <>: <i>{p.current}</i></> : null}{p.failed.length ? ` · ${p.failed.length} failed so far` : ''}</div>
        </>
      ) : !p.failed.length && p.finished_at && Date.now() / 1000 - p.finished_at < 90 ? (
        <div className="st-prog-head ok"><Check size={15} />Moved {p.moved_docs ?? 0} {p.moved_docs === 1 ? 'document' : 'documents'} and {p.moved_files ?? 0} {p.moved_files === 1 ? 'picture or attachment' : 'pictures and attachments'} ({size(p.bytes_total)})</div>
      ) : null}
      {failedList(p.failed, p.running ? undefined : onRetry)}
    </div>
  )
}

/** Settings → Extended storage: keep your files in your own storage instead of on this server. */
export function ExtendedStorage() {
  const [st, setSt] = useState<StorageState | null>(null)
  const [kind, setKind] = useState<Kind>('webdav')
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const [idle, setIdle] = useState(5)
  const [keepSearch, setKeepSearch] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => api.storage().then((s) => { setSt(s); if (s.connection) { setKind(s.connection.kind); setIdle(s.connection.idle_minutes); setKeepSearch(s.connection.keep_search) } else if (!s.available.includes(kind)) setKind('webdav') }).catch((e) => toast((e as Error).message)), [kind])
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // while files are moving, keep the numbers fresh
  const busyNow = !!(st?.progress?.running || st?.job?.running)
  useEffect(() => { if (!st?.connection?.enabled && !st?.job?.running) return; const t = window.setInterval(() => void api.storage().then(setSt).catch(() => undefined), busyNow ? 800 : 3000); return () => window.clearInterval(t) }, [st?.connection?.enabled, st?.job?.running, busyNow])
  if (!st) return <section className="st-section"><h1>Extended storage</h1><p className="muted"><Loader2 size={16} className="spin" /> Loading…</p></section>

  const c = st.connection, s0 = st.stats
  const body = (): StorageIn => ({ kind, config: cfg, enabled: true, idle_minutes: idle, keep_search: keepSearch })
  const test = async () => { setBusy('test'); setNote(null); try { setNote({ ok: true, text: (await api.testStorage(body())).message }) } catch (e) { setNote({ ok: false, text: (e as Error).message }) } finally { setBusy(null) } }
  const save = async () => {
    setBusy('save'); setNote(null)
    try { const s = await api.saveStorage(body()); setSt(s); setEditing(false); setCfg({}); toast('Connected. Your files will start moving when they have been idle for a while.') } catch (e) { setNote({ ok: false, text: (e as Error).message }) } finally { setBusy(null) }
  }
  const setEnabled = async (enabled: boolean) => { try { setSt(await api.patchStorage({ enabled })) } catch (e) { toast((e as Error).message) } }
  const move = async () => { try { await api.moveStorage(); toast('Moving your files…'); setTimeout(() => void api.storage().then(setSt), 1500) } catch (e) { toast((e as Error).message) } }
  const restore = async () => {
    if (!(await askConfirm({ title: 'Bring everything back?', text: 'Every file and picture is copied back to this server, and extended storage is switched off. Your own storage keeps its copies.', label: 'Bring it all back' }))) return
    try { await api.restoreStorage(); setTimeout(() => void api.storage().then(setSt), 800) } catch (e) { toast((e as Error).message) }
  }
  const forceDisconnect = async () => {
    if (!(await askConfirm({ title: 'Disconnect anyway?', text: `${s0.docs_remote} files and ${s0.files_remote} pictures and attachments are only in your storage. If you disconnect now they stay there, but they cannot be opened here until you connect the same storage again (nothing is deleted). Use this if your storage has gone away or you cannot reach it. If you can reach it, “Bring everything back” is safer.`, label: 'Disconnect anyway', danger: true }))) return
    try { await api.disconnectStorage(true); setNote(null); setCfg({}); await load() } catch (e) { toast((e as Error).message) }
  }
  const disconnect = async () => {
    if (!(await askConfirm({ title: 'Disconnect your storage?', text: 'The connection is forgotten. Nothing is deleted from your storage.', label: 'Disconnect', danger: true }))) return
    try { await api.disconnectStorage(); setNote(null); setCfg({}); await load() } catch (e) { toast((e as Error).message) }
  }

  const form = (
    <div className="st-card">
      <div className="st-row" style={{ alignItems: 'flex-start' }}><div><b>Where is your storage?</b><span>Choose one. You need an account there that KokoDocs may write to.</span></div>
        <span className="seg mini xs-wrap" role="radiogroup" aria-label="Kind of storage">{st.available.map((k) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setCfg({}); setNote(null) }}>{k === 'folder' ? 'Folder' : k === 'webdav' ? 'WebDAV' : 'S3'}</button>)}</span></div>
      <p className="muted small" style={{ margin: '0 0 6px' }}>{KIND_NAME[kind]}</p>
      {FIELDS[kind].map((f) => (
        <label className="st-field" key={f.key}><span>{f.label}</span>
          <span className="field"><input type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} placeholder={c && c.kind === kind && f.secret && c.config[`${f.key}_set`] ? '•••••••• (saved: leave blank to keep)' : f.ph} value={cfg[f.key] ?? (c && c.kind === kind && !f.secret ? String(c.config[f.key] ?? '') : '')} onChange={(e) => setCfg((x) => ({ ...x, [f.key]: e.target.value }))} /></span>
          {f.hint && <small className="muted">{f.hint}</small>}</label>))}
      <label className="st-field"><span>Move a file to your storage after it has been idle for</span>
        <select className="st-select" value={idle} onChange={(e) => setIdle(Number(e.target.value))}>{IDLE.map(([m, t]) => <option key={m} value={m}>{t}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={keepSearch} onChange={(e) => setKeepSearch(e.target.checked)} />Keep searching inside files working (this keeps a plain-text copy of each file’s words on this server)</label>
      {note && <p className={note.ok ? 'form-ok' : 'form-error'} style={{ margin: '6px 0 0', display: 'flex', gap: 6, alignItems: 'flex-start' }}>{note.ok ? <Check size={16} /> : <AlertCircle size={16} />}{note.text}</p>}
      <div className="st-inline" style={{ gap: 10, marginTop: 12 }}>
        <button className="btn btn-pill btn-soft" disabled={!!busy} onClick={() => void test()}>{busy === 'test' ? <Loader2 size={15} className="spin" /> : null}Test</button>
        <button className="btn btn-pill btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? <Loader2 size={15} className="spin" /> : <CloudUpload size={15} />}{c ? 'Save' : 'Connect'}</button>
        {c && editing && <button className="btn btn-pill btn-ghost" onClick={() => { setEditing(false); setCfg({}); setNote(null) }}>Cancel</button>}
      </div>
    </div>
  )

  const s = st.stats, job = st.job
  const total = s.docs_remote + s.docs_cached + s.docs_local
  return (
    <section className="st-section">
      <h1>Extended storage</h1>
      <div className="st-card">
        <div className="st-row"><div><b>Keep your files in your own storage</b>
          <span>Connect a WebDAV server, an S3-compatible bucket or a folder, and your documents, pictures and attachments are saved there and removed from this server. Each document becomes a single <code>.kokodocs</code> file you can open anywhere. Opening a file fetches it back; when you are done with it, it is cleared from the server again. People you share a file with can still open it. Files that are end-to-end encrypted are already unreadable here and stay where they are. Meeting recordings are not moved.</span></div></div>
      </div>
      {!c || editing ? form : (
        <>
          <div className="st-card">
            <div className="st-row"><div><b>{KIND_NAME[c.kind].split(' (')[0]}</b><span>{c.kind === 'webdav' ? String(c.config.url) : c.kind === 's3' ? `${c.config.bucket} at ${c.config.endpoint}` : `Folder “${c.config.path}”`}{c.config.prefix ? ` · in “${c.config.prefix}”` : ''}</span></div>
              <span className="st-btns"><button type="button" role="switch" aria-checked={c.enabled} aria-label="Move my files to this storage" className={`toggle ${c.enabled ? 'on' : ''}`} onClick={() => void setEnabled(!c.enabled)} /></span></div>
            {!c.enabled && <p className="muted small" style={{ margin: 0 }}>Paused: nothing new is moved. Files already in your storage still open.</p>}
            {c.last_error && !st.progress?.failed?.length && <p className="form-error" style={{ margin: '6px 0 0', display: 'flex', gap: 6 }}><AlertCircle size={16} />{c.last_error}</p>}
            <div className="st-stats">
              <div><b>{s.docs_remote}</b><span>in your storage</span></div><div><b>{s.docs_cached}</b><span>opened, on both</span></div><div><b>{s.docs_local}</b><span>only on this server</span></div>
              <div><b>{s.files_remote}</b><span>pictures and attachments in your storage{s.bytes_remote ? ` (${size(s.bytes_remote)})` : ''}</span></div>
            </div>
            {total === 0 && s.files_remote === 0 && <p className="muted small" style={{ margin: 0 }}>You have no files to move yet.</p>}
            {job?.error && !job.running && <p className="form-error" style={{ margin: '6px 0 0' }}>{job.error}</p>}
            <Progress s={st} onRetry={() => void move()} />
            <div className="st-inline" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-pill btn-soft" disabled={!c.enabled} onClick={() => void move()}><CloudUpload size={15} />Move everything now</button>
              <button className="btn btn-pill btn-ghost" onClick={() => setEditing(true)}>Change connection</button>
              <button className="btn btn-pill btn-ghost" disabled={!!job?.running} onClick={() => void restore()}><RotateCcw size={15} />Bring everything back</button>
              <button className="btn btn-pill btn-ghost" disabled={s.docs_remote + s.files_remote > 0} title={s.docs_remote + s.files_remote > 0 ? 'Bring everything back first' : undefined} onClick={() => void disconnect()}><Unplug size={15} />Disconnect</button>
              {s.docs_remote + s.files_remote > 0 && <button className="btn btn-pill btn-ghost danger-text" disabled={!!job?.running} title="Forget the connection even though some files are only in your storage" onClick={() => void forceDisconnect()}>Disconnect anyway…</button>}
            </div>
          </div>
          <div className="st-card">
            <div className="st-row"><div><b>Move a file after it has been idle for</b><span>Files someone has open are never moved. Searching inside moved files {c.keep_search ? 'keeps working' : 'finds titles only until they are opened'}.</span></div>
              <span className="st-btns"><select className="st-select" aria-label="Idle time" value={c.idle_minutes} onChange={(e) => { void api.patchStorage({ idle_minutes: Number(e.target.value) }).then(setSt).catch((er) => toast((er as Error).message)) }}>{IDLE.map(([m, t]) => <option key={m} value={m}>{t}</option>)}</select></span></div>
            <div className="st-row"><div><b>Keep search working</b><span>Leaves a plain-text copy of each moved file’s words on this server so search can still find them.</span></div>
              <span className="st-btns"><button type="button" role="switch" aria-checked={c.keep_search} aria-label="Keep search working" className={`toggle ${c.keep_search ? 'on' : ''}`} onClick={() => void api.patchStorage({ keep_search: !c.keep_search }).then(setSt).catch((er) => toast((er as Error).message))} /></span></div>
          </div>
        </>)}
    </section>
  )
}
