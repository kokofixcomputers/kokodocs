import { useEffect, useState } from 'react'
import { api } from '../api'
import { aiConnected } from '../editor/ai/model'
import { Plus, Trash2 } from 'lucide-react'
import { saveSnippets, saveWriting, usePrefs, type Snippet } from '../prefs'
import { toast } from '../ui/Toast'

/** Settings → Snippets: type a trigger like ;sig in a document or wiki and it becomes the saved text. */
export function SnippetsSettings() {
  const { snippets, writing } = usePrefs()
  const [rows, setRows] = useState<Snippet[]>(snippets)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setRows(snippets) }, [JSON.stringify(snippets)])   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(snippets)
  const bad = (r: Snippet, i: number) => r.trigger.length < 2 || r.trigger.length > 40 || /\s/.test(r.trigger) || rows.findIndex((x) => x.trigger === r.trigger) !== i
  const invalid = rows.some((r, i) => bad(r, i) || !r.text.trim())
  const save = async () => { setBusy(true); try { await saveSnippets(rows); toast('Snippets saved') } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  const set = (i: number, p: Partial<Snippet>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))
  return (
    <section className="st-section"><h1>Writing</h1>
      <div className="st-card">
        <div className="st-row"><div><b>Link previews</b><span>Paste a web address on an empty line and it turns into a player or preview card (YouTube, Vimeo, Spotify, X, GitHub and most other pages). A switch on the preview takes it back to a plain link.</span></div>
          <span className="st-btns"><button type="button" role="switch" aria-checked={writing.linkPreviews} aria-label="Preview links when I paste them" className={`toggle ${writing.linkPreviews ? 'on' : ''}`} onClick={() => saveWriting({ linkPreviews: !writing.linkPreviews }).catch((e) => toast((e as Error).message))} /></span></div>
      </div>
      <AiHelpers />
      <h2 className="st-sub">Snippets</h2>
      <div className="st-card">
        <div className="st-row"><div><b>Text expansion</b><span>Type a trigger in a document or wiki and it turns into the saved text: <code>;sig</code> → your signature. A trigger is 2 or more characters with no spaces; start it with a symbol like ; so it never clashes with a word. If another trigger starts the same way (<code>;a</code> and <code>;addr</code>) it waits for a space. In the text you can use {'{date}'}, {'{time}'}, {'{datetime}'}, {'{name}'} and {'{email}'}.</span></div></div>
      </div>
      {rows.map((r, i) => (
        <div className="st-card" key={i}>
          <label className="st-field"><span>Trigger</span><span className="field"><input value={r.trigger} maxLength={40} placeholder=";sig" aria-invalid={bad(r, i)} onChange={(e) => set(i, { trigger: e.target.value.trim() })} /></span></label>
          <label className="st-field"><span>Becomes</span><span className="field"><textarea rows={3} value={r.text} maxLength={4000} placeholder={'Best regards,\n{name}'} onChange={(e) => set(i, { text: e.target.value })} /></span></label>
          {bad(r, i) && r.trigger && <p className="form-error" style={{ margin: 0 }}>{rows.findIndex((x) => x.trigger === r.trigger) !== i ? 'Two snippets have this trigger.' : 'A trigger is 2 to 40 characters with no spaces.'}</p>}
          <div className="st-row" style={{ borderBottom: 0, padding: 0 }}><span /><button className="btn btn-pill btn-ghost btn-sm" onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 size={15} />Remove</button></div>
        </div>))}
      <div className="st-inline" style={{ gap: 10 }}>
        <button className="btn btn-pill btn-soft" onClick={() => setRows([...rows, { trigger: ';', text: '' }])}><Plus size={16} />Add a snippet</button>
        <button className="btn btn-pill btn-primary" disabled={busy || !dirty || invalid} onClick={() => void save()}>Save</button>
      </div>
    </section>
  )
}

const Toggle = ({ on, label, set }: { on: boolean; label: string; set: (v: boolean) => void }) => <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} />


/** which AI model a helper uses: the one Koko uses, or one of your own choosing */
function ModelPick({ value, models, onPick, label }: { value: string; models: { id: string; label: string; model: string; selected: boolean }[]; onPick: (id: string) => void; label: string }) {
  const koko = models.find((m) => m.selected)
  return (
    <select className="st-select" aria-label={label} value={models.some((m) => m.id === value) ? value : ''} onChange={(e) => onPick(e.target.value)}>
      <option value="">Same as Koko{koko ? ` (${koko.label})` : ''}</option>
      {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.model && m.model !== m.label ? ` · ${m.model}` : ''}</option>)}
    </select>
  )
}

/** the writing helpers that use AI, each with its own switch */
function AiHelpers() {
  const { writing: w } = usePrefs()
  const [conn, setConn] = useState<boolean | null>(null)
  const [models, setModels] = useState<{ id: string; label: string; model: string; selected: boolean }[]>([])
  useEffect(() => { void aiConnected().then(setConn); api.aiSettings().then((r) => setModels(r.models.map((m) => ({ id: m.id, label: m.label, model: m.model, selected: m.id === r.selected })))).catch(() => undefined) }, [])
  const save = (p: Partial<typeof w>) => saveWriting(p).catch((e) => toast((e as Error).message))
  return (
    <>
      <h2 className="st-sub">AI helpers</h2>
      <div className="st-card">
        <div className="st-row"><div><b>Do something box</b><span>Press Ctrl/Cmd+J (or the sparkle button) and say what you want: “make this bold”, “heading 2”, “summarize this paragraph”, “make it shorter”. Formatting requests work without AI; rewrites and summaries use the AI model you pick here (by default the one Koko uses).</span></div>
          <span className="st-btns">{conn && w.commandBar && <ModelPick value={w.commandModel} models={models} label="Model for the Do something box" onPick={(id) => void save({ commandModel: id })} />}<Toggle on={w.commandBar} label="Do something box" set={(v) => void save({ commandBar: v })} /></span></div>
        <div className="st-row"><div><b>Fix formatting button</b><span>A toolbar button that tidies spacing, turns bold or ALL-CAPS lines into headings, and turns typed “- item” or “1. item” lines into real lists, without changing a word. It works on the selection, or the whole page.</span></div>
          <span className="st-btns"><Toggle on={w.fixFormatting} label="Fix formatting button" set={(v) => void save({ fixFormatting: v })} /></span></div>
      </div>
    </>
  )
}
