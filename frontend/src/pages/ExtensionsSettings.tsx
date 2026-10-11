import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, Puzzle, Trash2 } from 'lucide-react'
import { getExtensions, saveExtensions, usePrefs } from '../prefs'
import { setSelectedTheme, useExtensions, type Extension } from '../extensions/runtime'
import { BLANK, TEMPLATES } from '../extensions/templates'
import { toast } from '../ui/Toast'

const newId = () => Math.random().toString(36).slice(2, 10)
const Toggle = ({ on, label, set }: { on: boolean; label: string; set: (v: boolean) => void }) => <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)}><i /></button>

/** Settings → Extensions: small JavaScript programs that follow your account. They run in a sandbox, so a bad one can't touch your documents or account. */
export function ExtensionsSettings() {
  const { extensions } = usePrefs()
  const ext = useExtensions()
  const [rows, setRows] = useState<Extension[]>(extensions.items)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setRows(extensions.items) }, [JSON.stringify(extensions.items)])   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(extensions.items)
  const set = (id: string, p: Partial<Extension>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const add = (name: string, code: string) => { const e = { id: newId(), name, code, enabled: true }; setRows((r) => [...r, e]); setOpen(e.id) }
  const save = async (list = rows, theme = extensions.theme) => {
    setBusy(true)
    try {
      const keep = list.some((x) => x.enabled && theme.startsWith(x.id + ':')) ? theme : ''   // a theme goes with its extension
      await saveExtensions(list, keep); toast('Extensions saved')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const pickTheme = async (key: string) => { setSelectedTheme(key); try { await saveExtensions(getExtensions().items, key) } catch (e) { toast((e as Error).message) } }

  return (
    <section className="st-section"><h1>Extensions</h1>
      <div className="st-card">
        <div className="st-row"><div><b>Add your own features</b>
          <span>Extensions are small JavaScript programs that follow your account to every device. They can change the colours of the whole app, add your own “/” commands and add new kinds of blocks to documents.
            They run in an isolated sandbox with no access to the internet, your documents (beyond what a “/” command is handed) or your account, so a mistake can’t break your files. Only add code you understand or trust.</span></div></div>
      </div>

      <h2 className="st-sub">Themes</h2>
      <div className="st-card">
        <div className="ext-themes">
          <button className={`ext-theme ${!ext.selected ? 'on' : ''}`} onClick={() => void pickTheme('')}><b>Default</b><span>Light, dark or follow the device</span>{!ext.selected && <Check size={16} />}</button>
          {ext.themes.map((t) => (
            <button key={t.key} className={`ext-theme ${ext.selected === t.key ? 'on' : ''}`} onClick={() => void pickTheme(t.key)}>
              <span className="ext-swatch" style={{ background: t.vars['--bg'] }}><i style={{ background: t.vars['--surface'] }} /><i style={{ background: t.vars['--accent'] }} /><i style={{ background: t.vars['--ink'] }} /></span>
              <b>{t.name}</b><span>{t.base === 'dark' ? 'Dark' : 'Light'}</span>{ext.selected === t.key && <Check size={16} />}
            </button>
          ))}
        </div>
        {!ext.themes.length && <p className="muted" style={{ margin: '10px 0 0' }}>Themes from your extensions show up here. Try adding Rosé Pine below.</p>}
      </div>

      <h2 className="st-sub">Your extensions</h2>
      {rows.map((r) => {
        const err = ext.errors[r.id], running = ext.running(r.id)
        return (
          <div className="st-card" key={r.id}>
            <div className="st-row" style={{ borderBottom: 0, padding: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="field"><input value={r.name} maxLength={80} aria-label="Extension name" onChange={(e) => set(r.id, { name: e.target.value })} /></span>
                <span className="ext-status">{!r.enabled ? 'Off' : err ? <><AlertTriangle size={13} /> {err}</> : running ? 'Running' : dirty ? 'Save to run' : 'Starting…'}</span>
              </div>
              <span className="st-btns">
                <button className="btn btn-pill btn-soft btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide code' : 'Edit code'}</button>
                <Toggle on={r.enabled} label={`Turn ${r.name} on or off`} set={(v) => set(r.id, { enabled: v })} />
                <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))}><Trash2 size={17} /></button>
              </span>
            </div>
            {open === r.id && <textarea className="ext-code" spellCheck={false} rows={16} value={r.code} maxLength={100000} aria-label={`Code of ${r.name}`} onChange={(e) => set(r.id, { code: e.target.value })} />}
          </div>
        )
      })}
      {!rows.length && <div className="st-card"><p className="muted" style={{ margin: 0 }}>No extensions yet. Start from an example, or write your own.</p></div>}
      <div className="st-inline" style={{ gap: 10 }}>
        <button className="btn btn-pill btn-soft" onClick={() => add('My extension', BLANK)} disabled={rows.length >= 20}><Plus size={16} />New extension</button>
        <button className="btn btn-pill btn-primary" disabled={busy || !dirty || rows.some((r) => !r.name.trim())} onClick={() => void save()}>Save</button>
      </div>

      <h2 className="st-sub">Examples</h2>
      <div className="st-card">
        <div className="ext-examples">
          {TEMPLATES.map((t) => (
            <button key={t.name} className="ext-example" disabled={rows.length >= 20} onClick={() => add(t.name, t.code)}><Puzzle size={16} /><b>{t.name}</b><span>{t.blurb}</span></button>
          ))}
        </div>
      </div>
    </section>
  )
}
