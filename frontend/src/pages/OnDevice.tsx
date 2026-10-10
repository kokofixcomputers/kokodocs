import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { deviceRows, usage, type DeviceRow, type Summary } from '../offline/device'
import { offlinePref, setOfflinePref } from '../offline/store'
import { askConfirm } from '../ui/Dialogs'
import { fmtBytes } from '../ui/StorageMeter'
import { toast } from '../ui/Toast'

/** Settings → On this device: what KokoDocs has downloaded or saved here, and a way to free the room. */
export function OnDevice() {
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [sum, setSum] = useState<Summary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [keep, setKeep] = useState(offlinePref())
  const load = useCallback(async () => { const [r, u] = await Promise.all([deviceRows(), usage()]); setRows(r); setSum(u) }, [])
  useEffect(() => { void load() }, [load])

  const free = async (r: DeviceRow) => {
    if (r.blocked) { toast(r.blocked); return }
    if (!(await askConfirm({ title: `Free up ${fmtBytes(r.bytes)}?`, text: `${r.title}. ${r.warn ?? 'Nothing is deleted from the server.'}`, label: 'Free up', danger: true }))) return
    setBusy(r.id)
    try { await r.free(); toast(`Freed ${fmtBytes(r.bytes)}`); await load() } catch (e) { toast((e as Error).message) } finally { setBusy(null) }
  }
  const total = (rows ?? []).reduce((n, r) => n + r.bytes, 0)
  return (
    <section className="st-section"><h1>On this device</h1>
      <div className="st-card">
        <div className="st-row"><div><b>{rows ? fmtBytes(total) : '…'} on this device</b>
          <span>{sum && sum.quota ? `This site is using ${fmtBytes(sum.used)} of the ${fmtBytes(sum.quota)} the browser allows. ` : ''}Everything here can be downloaded again; nothing is deleted from the server.</span></div></div>
        <div className="st-row"><div><b>Keep an offline copy of my documents</b><span>Saves your documents here so they open and can be edited with no connection. Turning it off stops saving them; use Free up to remove what is saved.</span></div>
          <button role="switch" aria-checked={keep} aria-label="Keep an offline copy of my documents" className={`toggle ${keep ? 'on' : ''}`} onClick={() => { setOfflinePref(!keep); setKeep(!keep) }} /></div>
      </div>
      {!rows ? <p className="muted"><Loader2 size={16} className="spin" style={{ verticalAlign: -3 }} /> Looking…</p>
        : rows.length === 0 ? <p className="muted">Nothing is saved on this device yet.</p>
        : (
          <div className="st-card">
            {rows.map((r) => (
              <div className="st-row" key={r.id}>
                <div><b>{r.title} <span className="muted" style={{ fontWeight: 500 }}>· {fmtBytes(r.bytes)}</span></b><span>{r.detail}</span>{r.blocked && <span style={{ color: 'var(--danger)' }}>{r.blocked}</span>}</div>
                <button className="btn btn-pill btn-ghost btn-sm" disabled={busy !== null} onClick={() => void free(r)}>{busy === r.id ? <Loader2 size={15} className="spin" /> : 'Free up'}</button>
              </div>))}
          </div>)}
    </section>
  )
}
