import { useEffect, useState } from 'react'
import { Check, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, type AiModelEntry, type AiSettings as S } from '../api'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'

export const PRESETS = [
  { name: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'Ollama', url: 'http://localhost:11434/v1', model: 'llama3.1' },
]

/** Add one of your own models, or edit one. Any OpenAI-compatible service works. Only you can see or use it. */
function ModelForm({ initial, onSaved, onCancel }: { initial?: AiModelEntry; onSaved: (s: S) => void; onCancel?: () => void }) {
  const [id, setId] = useState(initial?.id ?? null)   // set once it exists on the server (adding, then pressing Test, saves it)
  const [label, setLabel] = useState(initial?.label ?? '')
  const [url, setUrl] = useState(initial?.base_url ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [key, setKey] = useState('')
  const [hint, setHint] = useState(initial?.key_hint ?? null)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const persist = async (): Promise<S> => {
    const body = { label: label.trim(), base_url: url.trim(), model: model.trim(), ...(key ? { api_key: key } : {}) }
    const s = id ? await api.editAiModel(id, body) : await api.addAiModel(body)
    if (!id) setId(s.selected)   // a model you add is selected at once
    setKey(''); setHint(s.models.find((m) => m.id === (id ?? s.selected))?.key_hint ?? hint)
    return s
  }
  const test = async () => {
    setTesting(true); setErr(''); setOk('')
    try {
      const s = await persist(); onSaved(s)
      const r = await api.aiModels(id ?? s.selected ?? undefined); setModels(r.models)
      setOk(r.models.length ? `Connected. ${r.models.length} models available.` : 'Connected.')
    } catch (e) { setErr((e as Error).message) } finally { setTesting(false) }
  }
  const save = async () => {
    setBusy(true); setErr('')
    try { onSaved(await persist()); toast(initial || id ? 'Model saved' : 'Model added'); onCancel?.() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="ai-form">
      <div className="ai-presets">
        {PRESETS.map((p) => <button key={p.name} type="button" className={`chip ${url === p.url ? 'on' : ''}`} onClick={() => { setUrl(p.url); setModel(p.model); if (!label) setLabel(p.name) }}>{p.name}</button>)}
      </div>
      <label className="ai-field"><span>Name in the model list</span><span className="field"><input placeholder="Mistral Large" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></span></label>
      <label className="ai-field"><span>Base URL</span><span className="field"><input placeholder="https://api.mistral.ai/v1" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></span></label>
      <label className="ai-field"><span>API key</span><span className="field"><input type="password" autoComplete="off" placeholder={hint ? `Saved (${hint}). Leave blank to keep it` : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} /></span></label>
      <label className="ai-field"><span>Model</span>
        <span className="ai-model">
          <span className="field"><input list="ai-models" placeholder="mistral-large-latest" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></span>
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          <button type="button" className="btn btn-pill btn-ghost" onClick={test} disabled={testing || !url.trim() || !model.trim()}>{testing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Test</button>
        </span></label>
      {ok && <p className="ai-ok"><Check size={15} />{ok}</p>}
      {err && <p className="form-error">{err}</p>}
      <div className="modal-actions">
        {onCancel ? <button className="btn btn-pill btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button> : <span />}
        <button className="btn btn-pill btn-primary" onClick={save} disabled={busy || !url.trim() || !model.trim()}>{initial || id ? 'Save' : 'Add model'}</button>
      </div>
    </div>
  )
}

/** The models you can use: the ones your admin offers, and your own (which you add, edit and remove here). */
export function AiSettingsBody({ settings, onSaved, onClose }: { settings: S | null; onSaved: (s: S) => void; onClose: () => void }) {
  const models = settings?.models ?? []
  const system = models.filter((m) => m.scope === 'system')
  const own = models.filter((m) => m.scope === 'user')
  const [mode, setMode] = useState<'list' | 'add' | { edit: string }>(models.length ? 'list' : 'add')
  useEffect(() => { if (!models.length) setMode('add') }, [models.length])
  const pick = async (id: string) => { try { onSaved(await api.pickAiModel(id)) } catch (e) { toast((e as Error).message) } }
  const remove = async (m: AiModelEntry) => { try { onSaved(await api.deleteAiModel(m.id)); toast(`${m.label} removed`) } catch (e) { toast((e as Error).message) } }
  const Row = ({ m }: { m: AiModelEntry }) => (
    <div className={`ai-model-row ${settings?.selected === m.id ? 'on' : ''}`}>
      <button className="amr-main" onClick={() => void pick(m.id)} aria-label={`Use ${m.label}`}>
        <b>{m.label}</b><span>{m.model}{m.host ? ` · ${m.host}` : ''}</span>{settings?.selected === m.id && <Check size={15} />}</button>
      {m.scope === 'user' && <>
        <button className="icon-btn sm" aria-label={`Edit ${m.label}`} onClick={() => setMode({ edit: m.id })}><Pencil size={15} /></button>
        <button className="icon-btn sm" aria-label={`Remove ${m.label}`} onClick={() => void remove(m)}><Trash2 size={15} /></button></>}
    </div>
  )
  if (mode === 'add') return <div className="share-body ai-settings"><p className="muted hint" style={{ marginTop: 0 }}>Add a model from any OpenAI-compatible service. Your key is encrypted on the server and never sent back to the browser. Only you can see and use it.</p><ModelForm onSaved={onSaved} onCancel={models.length ? () => setMode('list') : undefined} /></div>
  if (typeof mode === 'object') { const m = own.find((x) => x.id === mode.edit); return <div className="share-body ai-settings">{m ? <ModelForm initial={m} onSaved={onSaved} onCancel={() => setMode('list')} /> : null}</div> }
  return (
    <div className="share-body ai-settings">
      {system.length > 0 && <div className="ai-group"><h4>From your administrator</h4>{system.map((m) => <Row key={m.id} m={m} />)}</div>}
      <div className="ai-group"><h4>Your models</h4>
        {own.length ? own.map((m) => <Row key={m.id} m={m} />) : <p className="muted hint" style={{ margin: 0 }}>None yet. Add your own provider and key to use a model nobody else can.</p>}
        <button className="btn btn-pill btn-soft" onClick={() => setMode('add')}><Plus size={15} />Add a model</button></div>
      <div className="modal-actions"><span /><button className="btn btn-pill btn-primary" onClick={onClose}>Done</button></div>
    </div>
  )
}

export function AiSettingsDialog(p: { settings: S | null; onSaved: (s: S) => void; onClose: () => void }) {
  return <Modal title="Models" onClose={p.onClose} width={540}><AiSettingsBody {...p} /></Modal>
}
