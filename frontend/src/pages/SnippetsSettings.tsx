import { useEffect, useState } from 'react'
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
