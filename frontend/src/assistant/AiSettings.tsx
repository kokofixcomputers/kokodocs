import { useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { api, type AiSettings as S } from '../api'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'

const PRESETS = [
  { name: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'Ollama', url: 'http://localhost:11434/v1', model: 'llama3.1' },
]

export function AiSettingsBody({ settings, onSaved, onClose }: { settings: S | null; onSaved: (s: S) => void; onClose: () => void }) {
  const sys = settings?.system
  const [choice, setChoice] = useState<'system' | 'own'>(settings?.use_own || !sys?.available ? 'own' : 'system')
  const [url, setUrl] = useState(settings?.base_url ?? '')
  const [model, setModel] = useState(settings?.model ?? '')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const own = choice === 'own'

  const persist = async () => onSaved(await api.saveAiSettings({ base_url: url.trim(), model: model.trim(), ...(key ? { api_key: key } : {}) }))
  const loadModels = async () => {
    setTesting(true); setErr(''); setOk('')
    try {
      await persist(); setKey('')
      const r = await api.aiModels(); setModels(r.models)
      setOk(r.models.length ? `Connected. ${r.models.length} models available.` : 'Connected.')
    } catch (e) { setErr((e as Error).message) } finally { setTesting(false) }
  }
  useEffect(() => { if (settings?.configured && settings.source === 'user') api.aiModels().then((r) => setModels(r.models)).catch(() => {}) }, [settings])

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (own) { await persist(); toast('Using your own connection') }
      else { onSaved(await api.setAiSource('system')); toast('Using the system connection') }
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => { setBusy(true); try { onSaved(await api.deleteAiSettings()); toast('Your connection was removed'); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }

  return (
    <div className="share-body ai-settings">
        {sys?.available ? (
          <div className="ai-source" role="radiogroup" aria-label="Which connection to use">
            <button role="radio" aria-checked={!own} className={!own ? 'on' : ''} onClick={() => setChoice('system')}>
              <span><b>System connection</b><em>Set up by the admin for everyone. Nothing to do. {sys.model ? <>Model <code>{sys.model}</code>.</> : null}</em></span>{!own && <Check size={16} />}</button>
            <button role="radio" aria-checked={own} className={own ? 'on' : ''} onClick={() => setChoice('own')}>
              <span><b>My own connection</b><em>{settings?.own_saved ? `Saved: ${settings.model || 'a model'}.` : 'Use your own provider and key.'}</em></span>{own && <Check size={16} />}</button>
          </div>
        ) : <p className="muted hint" style={{ marginTop: 0 }}>Connect any OpenAI-compatible service. Your key is encrypted on the server and never sent back to the browser.</p>}
        {own && <>
          {sys?.available && <p className="muted hint" style={{ margin: 0 }}>Your key is encrypted on the server and never sent back to the browser.</p>}
          <div className="ai-presets">
            {PRESETS.map((p) => <button key={p.name} className={`chip ${url === p.url ? 'on' : ''}`} onClick={() => { setUrl(p.url); setModel(p.model) }}>{p.name}</button>)}
          </div>
          <label className="ai-field"><span>Base URL</span>
            <span className="field"><input placeholder="https://api.mistral.ai/v1" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></span></label>
          <label className="ai-field"><span>API key</span>
            <span className="field"><input type="password" autoComplete="off" placeholder={settings?.key_hint ? `Saved (${settings.key_hint}). Leave blank to keep it` : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} /></span></label>
          <label className="ai-field"><span>Model</span>
            <span className="ai-model">
              <span className="field"><input list="ai-models" placeholder="mistral-large-latest" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} /></span>
              <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
              <button className="btn btn-pill btn-ghost" onClick={loadModels} disabled={testing || !url.trim()}>{testing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Test</button>
            </span></label>
        </>}
        {ok && <p className="ai-ok"><Check size={15} />{ok}</p>}
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions">
          {settings?.own_saved ? <button className="btn btn-pill btn-ghost" onClick={remove} disabled={busy}><Trash2 size={15} />Remove mine</button> : <span />}
          <button className="btn btn-pill btn-primary" onClick={save} disabled={busy || (own && (!url.trim() || !model.trim()))}>Save</button>
        </div>
    </div>
  )
}

export function AiSettingsDialog(p: { settings: S | null; onSaved: (s: S) => void; onClose: () => void }) {
  return <Modal title="Assistant connection" onClose={p.onClose} width={540}><AiSettingsBody {...p} /></Modal>
}
