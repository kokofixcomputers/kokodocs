import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Cpu, ImagePlus, Sparkles } from 'lucide-react'
import { api, type AiSettings } from '../api'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { LANGS, describe, loadPrefs, prepare, readLocally, savePrefs, textToHtml, type OcrPrefs } from '../ocr/ocr'
import { docKeyOf } from '../zk/session'
import { ensureConsent } from '../zk/consent'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** "Scan a page": choose a photo or scan, and the text on it is added to the document at the cursor. Read on this device, or by the AI provider. */
export function OcrDialog({ editor, docId, onClose }: { editor: Editor; docId: string; onClose: () => void }) {
  const [prefs, setPrefs] = useState<OcrPrefs>(loadPrefs)
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [what, setWhat] = useState('')
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  useEffect(() => { api.aiSettings().then(setAi).catch(() => setAi({ configured: false, models: [], selected: null })) }, [])
  const set = (p: Partial<OcrPrefs>) => setPrefs((c) => { const n = { ...c, ...p }; savePrefs(n); return n })
  const models = ai?.models ?? []
  const model = models.find((m) => m.id === prefs.model) ?? models.find((m) => m.id === ai?.selected) ?? models[0]
  const canAi = !!ai?.configured

  const run = async (file: File | undefined) => {
    if (!file || busy) return
    if (!file.type.startsWith('image/')) { setErr('Choose a photo or a scan (JPEG, PNG, WebP).'); return }
    setErr(''); setBusy(true); setPct(null)
    try {
      let html: string
      if (prefs.via === 'ai') {
        if (!canAi) throw new Error('Add an AI model in the assistant settings first.')
        if (docKeyOf(docId) && !(await ensureConsent('ocr'))) { setBusy(false); return }
        setWhat('Sending the picture to the AI provider…')
        const text = await api.ocr(await prepare(file, 2000, false, 0.85), model?.id)
        const { mdToHtml } = await import('../assistant/docTools')
        html = text.trim() ? mdToHtml(text) : ''
      } else {
        setWhat('Starting the reader…')
        const text = await readLocally(file, prefs.lang, (p, s) => { setPct(Math.round(p * 100)); setWhat(s === 'recognizing text' ? 'Reading the page…' : s.startsWith('loading') || s.startsWith('initial') ? 'Getting the reader ready…' : 'Working…') })
        html = textToHtml(text)
      }
      if (!html) throw new Error('No text was found on that picture. Try a clearer, straighter photo with good light.')
      editor.chain().focus().insertContent(html).run()
      const words = (html.replace(/<[^>]+>/g, ' ').match(/\S+/g) ?? []).length
      toast(`Added ${words} word${words === 1 ? '' : 's'} from the page. Undo with ${isMac ? '⌘Z' : 'Ctrl+Z'}.`)
      onClose()
    } catch (e) { setErr((e as Error)?.message || describe(e) || 'That page couldn’t be read') } finally { setBusy(false) }
  }

  const way = (via: 'local' | 'ai', icon: React.ReactNode, title: string, sub: string, off = false) => (
    <button type="button" className={`ocr-way ${prefs.via === via ? 'on' : ''}`} disabled={busy || off} aria-pressed={prefs.via === via} onClick={() => set({ via })}>
      <span className="ocr-ico">{icon}</span><span><b>{title}</b><em>{sub}</em></span>
    </button>)

  return (
    <Modal title="Scan a page" onClose={busy ? () => { /* wait for it */ } : onClose} width={520}>
      <div className="share-body">
        <div className="ocr-ways">
          {way('local', <Cpu size={18} />, 'On this device', 'Private and works offline. Best for clear printed pages.')}
          {way('ai', <Sparkles size={18} />, 'AI provider', canAi ? 'Better with handwriting and messy photos. The picture is sent to your AI service.' : 'Add an AI model in the assistant settings to use this.', !canAi)}
        </div>
        {prefs.via === 'local'
          ? <div className="ocr-opt"><span>Language of the page</span><Select label="Language of the page" value={prefs.lang} onChange={(lang) => set({ lang })} options={LANGS.map((l) => ({ value: l.id, label: l.label }))} /></div>
          : model && <div className="ocr-opt"><span>Model</span><Select label="Model that reads the page" value={model.id} onChange={(id) => set({ model: id })} options={models.map((m) => ({ value: m.id, label: `${m.label}${m.model && m.model !== m.label ? ` (${m.model})` : ''}` }))} /></div>}
        {busy ? (
          <div className="ocr-busy" role="status" aria-live="polite">
            {pct !== null ? <div className="zk-bar"><i style={{ width: `${pct}%` }} /></div> : <span className="spinner" />}
            <span>{what}</span>
          </div>
        ) : (
          <button type="button" className={`ocr-drop ${over ? 'over' : ''}`} onClick={() => pick.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void run(e.dataTransfer.files?.[0]) }}>
            <ImagePlus size={26} /><b>Choose a photo or scan</b><span>or drop it here. The text is added where your cursor is.</span>
          </button>)}
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { void run(e.target.files?.[0]); e.target.value = '' }} />
        {err && <p className="form-error" role="alert">{err}</p>}
      </div>
    </Modal>
  )
}
