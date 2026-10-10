import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { LOCAL_MODEL, loadLocalModel, removeLocalModel, useLocalModel } from '../editor/ai/local'
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

/** the writing helpers that use AI, each with its own switch */
function AiHelpers() {
  const { writing: w } = usePrefs()
  const lm = useLocalModel()
  const [conn, setConn] = useState<boolean | null>(null)
  useEffect(() => { void aiConnected().then(setConn) }, [])
  const save = (p: Partial<typeof w>) => saveWriting(p).catch((e) => toast((e as Error).message))
  return (
    <>
      <h2 className="st-sub">AI helpers</h2>
      <div className="st-card">
        <div className="st-row"><div><b>Do something box</b><span>Press Ctrl/Cmd+J (or the sparkle button) and say what you want: “make this bold”, “heading 2”, “summarize this paragraph”, “make it shorter”. Formatting requests work without AI; rewrites and summaries use the AI model connected under Assistant.</span></div>
          <span className="st-btns"><Toggle on={w.commandBar} label="Do something box" set={(v) => void save({ commandBar: v })} /></span></div>
        <div className="st-row"><div><b>Fix formatting button</b><span>A toolbar button that tidies spacing, turns bold or ALL-CAPS lines into headings, and turns typed “- item” or “1. item” lines into real lists, without changing a word. It works on the selection, or the whole page.</span></div>
          <span className="st-btns"><Toggle on={w.fixFormatting} label="Fix formatting button" set={(v) => void save({ fixFormatting: v })} /></span></div>
        <div className="st-row"><div><b>Suggestions while you write</b><span>Grey text appears after your cursor with the likely rest of the sentence. Press Tab to take it, Cmd/Ctrl+→ for one word, or keep typing to ignore it. Off by default.</span></div>
          <span className="st-btns"><Toggle on={w.autocomplete} label="Suggestions while you write" set={(v) => { void save({ autocomplete: v }); if (v && w.engine === 'device' && !lm.downloaded) void loadLocalModel().catch(() => undefined) }} /></span></div>
        {w.autocomplete && (
          <div className="st-row" style={{ alignItems: 'flex-start' }}><div><b>Where suggestions come from</b>
            <span>{w.engine === 'device'
              ? `${LOCAL_MODEL.name}, a small model that runs on this device. Nothing you write leaves it, and it works offline once downloaded (about ${LOCAL_MODEL.mb} MB, kept by the browser). It is modest: expect short, plain continuations.`
              : conn === false ? 'Uses the AI model connected under Assistant, but none is connected yet. Connect one there first.' : 'Uses the AI model connected under Assistant. The text before your cursor is sent to that provider. It is not used for encrypted documents.'}</span>
            {w.engine === 'device' && (
              <span className="st-inline" style={{ gap: 10, marginTop: 8 }}>
                {lm.status === 'loading' ? <><Loader2 size={15} className="spin" /> {lm.downloaded ? 'Starting' : `Downloading ${Math.round(lm.progress * 100)}%`}</>
                  : lm.status === 'ready' ? <>Ready{lm.device === 'webgpu' ? ' (using the graphics card)' : ' (using the processor)'}</>
                  : lm.status === 'error' ? <span className="form-error" style={{ margin: 0 }}>{lm.error}</span>
                  : lm.downloaded ? <>Downloaded</> : null}
                {lm.status !== 'loading' && !lm.downloaded && <button className="btn btn-pill btn-soft btn-sm" onClick={() => void loadLocalModel().catch(() => undefined)}><Download size={15} />Download now</button>}
                {lm.status === 'error' && <button className="btn btn-pill btn-soft btn-sm" onClick={() => void loadLocalModel().catch(() => undefined)}>Try again</button>}
                {lm.downloaded && lm.status !== 'loading' && <button className="btn btn-pill btn-ghost btn-sm" onClick={() => void removeLocalModel()}>Remove the download</button>}
              </span>)}
          </div>
            <span className="seg mini" role="radiogroup" aria-label="Where suggestions come from">
              <button role="radio" aria-checked={w.engine === 'device'} className={w.engine === 'device' ? 'on' : ''} onClick={() => { void save({ engine: 'device' }); if (!lm.downloaded) void loadLocalModel().catch(() => undefined) }}>This device</button>
              <button role="radio" aria-checked={w.engine === 'server'} className={w.engine === 'server' ? 'on' : ''} onClick={() => void save({ engine: 'server' })}>AI connection</button>
            </span></div>)}
      </div>
    </>
  )
}
