import { useEffect, useRef, useState } from 'react'
import { ImagePlus, RotateCcw } from 'lucide-react'
import { api, type OcrAdmin } from '../api'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'

/** Admin: which model reads pictures in "Scan a page", and what it is told. */
export function OcrAdminSection() {
  const [o, setO] = useState<OcrAdmin | null>(null)
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [lock, setLock] = useState(false)
  const [def, setDef] = useState<'' | 'local' | 'ai'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tried, setTried] = useState<{ text: string; model: string; ms: number } | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const load = (x: OcrAdmin) => { setO(x); setModel(x.model_id); setPrompt(x.prompt); setLock(x.lock); setDef(x.default) }
  useEffect(() => { api.adminOcr().then(load).catch((e) => setErr(e.message)) }, [])
  if (!o) return err ? <p className="form-error">{err}</p> : <span className="spinner" />
  const dirty = model !== o.model_id || prompt.trim() !== o.prompt.trim() || lock !== o.lock || def !== o.default
  const save = async () => {
    setBusy(true); setErr('')
    try { load(await api.adminOcrSave({ model_id: model, prompt, lock, default: def })); toast('Saved') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const test = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setErr(''); setTried(null)
    try { if (dirty) await api.adminOcrSave({ model_id: model, prompt, lock, default: def }).then(load); setTried(await api.adminOcrTest(f)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const modelOptions = [{ value: '', label: 'Not chosen (people use their own model)' }, ...o.models.map((m) => ({ value: m.id, label: `${m.label}${m.model && m.model !== m.label ? ` (${m.model})` : ''}` }))]
  return (
    <div className="ad-stack">
      <div className="ad-card ad-form">
        <p className="muted hint" style={{ margin: 0 }}>"Scan a page" can read a photo on the person's own device, or send it to a vision model: an AI model that can look at pictures (for example gpt-4o, pixtral, or a Llama or Qwen vision model). Choose which one here, and what it is told. The picture goes through this server to that model and nothing is stored.</p>
        <div className="ai-field"><span>Model that reads pictures</span>
          <Select label="Model that reads pictures" value={model} onChange={setModel} options={modelOptions} />
          {o.models.length === 0 && <span className="muted hint">No models are offered to everyone yet. Add one in Assistant (Koko), then come back. It must be able to see pictures.</span>}</div>
        <label className="ai-field"><span>What the model is told</span>
          <textarea className="ocr-prompt" rows={7} value={prompt} maxLength={4000} spellCheck={false} onChange={(e) => setPrompt(e.target.value)} />
          <span className="muted hint">The picture is sent with this instruction. Models follow it best when it says to reply with only the text. Markdown in the reply (headings, lists, tables) becomes formatting in the document.
            {prompt.trim() !== o.default_prompt.trim() && <> <button type="button" className="link-btn" onClick={() => setPrompt(o.default_prompt)}><RotateCcw size={12} style={{ verticalAlign: -1 }} /> Use the standard instruction</button></>}</span></label>
        <div className="switch-row">
          <div><b>Everyone uses this model</b><span>Off: people can pick any model they may use (their own included). On: always this one.</span></div>
          <button role="switch" aria-checked={lock} aria-label="Everyone uses this model" disabled={!model} className={`toggle ${lock ? 'on' : ''}`} onClick={() => setLock(!lock)} /></div>
        <div className="ai-field"><span>What "Scan a page" starts with</span>
          <Select label="Default way to read" value={def} onChange={(v) => setDef(v as '' | 'local' | 'ai')} options={[{ value: '', label: 'On this device (people can switch)' }, { value: 'local', label: 'On this device, as the default' }, { value: 'ai', label: 'The model above, as the default' }]} />
          <span className="muted hint">Only for people who haven't chosen yet. Reading on the device is private and works offline; the model is better with handwriting and messy photos.</span></div>
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-pill btn-primary" disabled={busy || !dirty} onClick={save}>Save</button>
          <button className="btn btn-pill btn-soft" disabled={busy || !model && o.models.length === 0} onClick={() => pick.current?.click()}><ImagePlus size={16} />Try it on a picture</button>
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { void test(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </div>
      {(busy || tried) && (
        <div className="ad-card ad-form">
          {busy && !tried ? <span className="spinner" /> : tried && (<>
            <p className="muted hint" style={{ margin: 0 }}>What {tried.model} sent back ({(tried.ms / 1000).toFixed(1)} s):</p>
            <pre className="ocr-try">{tried.text || '(no text found)'}</pre></>)}
        </div>)}
    </div>
  )
}
