import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Cpu, ImagePlus, Sparkles } from 'lucide-react'
import { api, type AiSettings } from '../api'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { LANGS, describe, loadPrefs, prepare, savePrefs, type OcrPrefs } from '../ocr/ocr'
import { findPage, flatten, type Pt } from '../ocr/page'
import { openPhoto, readPhoto, type Photo } from '../ocr/read'
import { docKeyOf } from '../zk/session'
import { ensureConsent } from '../zk/consent'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The photo with the page's four corners on it, to drag into place so only the page is read. */
function CropStep({ photo, quad, onQuad }: { photo: Photo; quad: Pt[]; onQuad: (q: Pt[]) => void }) {
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null)
  const W = photo.bmp.width, H = photo.bmp.height
  useEffect(() => { const c = cv.current!; c.width = Math.min(W, 1000); c.height = Math.round(c.width * H / W); c.getContext('2d')!.drawImage(photo.bmp, 0, 0, c.width, c.height) }, [photo, W, H])
  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault(); const el = e.currentTarget as Element; el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = box.current!.getBoundingClientRect()
      const p = { x: Math.max(0, Math.min(W, ((ev.clientX - r.left) / r.width) * W)), y: Math.max(0, Math.min(H, ((ev.clientY - r.top) / r.height) * H)) }
      onQuad(quad.map((q, j) => (j === i ? p : q)))
    }
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move as EventListener); el.addEventListener('pointerup', up)
  }
  const R = Math.max(W, H) * 0.022
  return (
    <div className="ocr-crop" ref={box} style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(52vh * ${W / H}))` }}>
      <canvas ref={cv} />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Drag the corners onto the corners of the page">
        <path d={`M0 0H${W}V${H}H0Z M${quad.map((p, i) => `${i ? 'L' : ''}${p.x} ${p.y}`).join('')}Z`} fillRule="evenodd" className="ocr-shade" />
        <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} className="ocr-quad" style={{ strokeWidth: R * 0.18 }} />
        {quad.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={R} className="ocr-handle" onPointerDown={drag(i)} role="slider" aria-label={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i] + ' corner'} />)}
      </svg>
    </div>
  )
}

/** "Scan a page": choose a photo or scan, and the text on it is added to the document at the cursor. Read on this device, or by the AI provider. */
export function OcrDialog({ editor, docId, onClose }: { editor: Editor; docId: string; onClose: () => void }) {
  const [prefs, setPrefs] = useState<OcrPrefs>(loadPrefs)
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [what, setWhat] = useState('')
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const [photo, setPhoto] = useState<Photo | null>(null)   // set while the person is adjusting the page's corners
  const [quad, setQuad] = useState<Pt[] | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  useEffect(() => { api.aiSettings().then(setAi).catch(() => setAi({ configured: false, models: [], selected: null })) }, [])
  const set = (p: Partial<OcrPrefs>) => setPrefs((c) => { const n = { ...c, ...p }; savePrefs(n); return n })
  const models = ai?.models ?? []
  const model = models.find((m) => m.id === prefs.model) ?? models.find((m) => m.id === ai?.selected) ?? models[0]
  const canAi = !!ai?.configured

  const read = async (ph: Photo, q: Pt[] | null) => {
    setErr(''); setBusy(true)
    try {
      let html: string, classic = false
      if (prefs.via === 'ai') {
        if (!canAi) throw new Error('Add an AI model in the assistant settings first.')
        if (docKeyOf(docId) && !(await ensureConsent('ocr'))) { setBusy(false); return }
        setWhat('Sending the picture to the AI provider…')
        let img: Blob
        if (q) img = await new Promise<Blob>((res, rej) => flatten(ph.bmp, q, 2000).toBlob((b) => (b ? res(b) : rej(new Error('The page couldn’t be prepared'))), 'image/jpeg', 0.88))
        else img = await prepare(ph.file, 2000, false, 0.85)
        const text = await api.ocr(img, model?.id)
        const { mdToHtml } = await import('../assistant/docTools')
        html = text.trim() ? mdToHtml(text) : ''
      } else {
        setWhat('Getting the reader ready…')
        const r = await readPhoto(ph, { lang: prefs.lang, quad: q, onProgress: setWhat })
        html = r.html; classic = r.classic
      }
      if (!html) throw new Error('No text was found on that picture. Try a clearer, straighter photo with good light, or drag the corners onto just the page.')
      editor.chain().focus().insertContent(html).run()
      const words = (html.replace(/<[^>]+>/g, ' ').match(/\S+/g) ?? []).length
      toast(`Added ${words} word${words === 1 ? '' : 's'} from the page. Undo with ${isMac ? '⌘Z' : 'Ctrl+Z'}.${classic ? ' The main reader isn\u2019t installed on this server, so the classic one was used and may be less accurate.' : ''}`)
      onClose()
    } catch (e) { setErr((e as Error)?.message || describe(e) || 'That page couldn’t be read') } finally { setBusy(false) }
  }

  const choose = async (file: File | undefined) => {
    if (!file || busy) return
    if (!file.type.startsWith('image/')) { setErr('Choose a photo or a scan (JPEG, PNG, WebP).'); return }
    setErr(''); setBusy(true); setWhat('Opening the picture…')
    try {
      const ph = await openPhoto(file)
      if (prefs.crop) { setPhoto(ph); setQuad(ph.found.quad); setBusy(false); return }
      await read(ph, null)
    } catch (e) { setErr((e as Error)?.message || describe(e) || 'That picture couldn’t be opened'); setBusy(false) }
  }

  const way = (via: 'local' | 'ai', icon: React.ReactNode, title: string, sub: string, off = false) => (
    <button type="button" className={`ocr-way ${prefs.via === via ? 'on' : ''}`} disabled={busy || off} aria-pressed={prefs.via === via} onClick={() => set({ via })}>
      <span className="ocr-ico">{icon}</span><span><b>{title}</b><em>{sub}</em></span>
    </button>)

  return (
    <Modal title="Scan a page" onClose={busy ? () => { /* wait for it */ } : onClose} width={520}>
      <div className="share-body">
        {photo && quad ? (<>
          <p className="muted" style={{ margin: 0 }}>Drag the corners onto the corners of the page. Only what is inside is read; the desk and everything else is ignored.</p>
          <CropStep photo={photo} quad={quad} onQuad={setQuad} />
          <div className="ocr-actions">
            <button type="button" className="btn btn-pill btn-ghost btn-sm" disabled={busy} onClick={() => setQuad(findPage(photo.bmp).quad)}>Find the page again</button>
            <button type="button" className="btn btn-pill btn-ghost btn-sm" disabled={busy} onClick={() => setQuad([{ x: 0, y: 0 }, { x: photo.bmp.width, y: 0 }, { x: photo.bmp.width, y: photo.bmp.height }, { x: 0, y: photo.bmp.height }])}>Whole photo</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-pill btn-primary" disabled={busy} onClick={() => void read(photo, quad)}>{busy ? <span className="spinner sm" /> : 'Read this page'}</button>
          </div>
          {busy && <div className="ocr-busy" role="status" aria-live="polite"><span>{what}</span></div>}
        </>) : (<>
          <div className="ocr-ways">
            {way('local', <Cpu size={18} />, 'On this device', 'Private and works offline. Finds the page in the photo and reads it here.')}
            {way('ai', <Sparkles size={18} />, 'AI provider', canAi ? 'Better with handwriting and messy photos. The picture is sent to your AI service.' : 'Add an AI model in the assistant settings to use this.', !canAi)}
          </div>
          {prefs.via === 'local'
            ? <div className="ocr-opt"><span>Language of the page</span><Select label="Language of the page" value={prefs.lang} onChange={(lang) => set({ lang })} options={LANGS.map((l) => ({ value: l.id, label: l.label }))} /></div>
            : model && <div className="ocr-opt"><span>Model</span><Select label="Model that reads the page" value={model.id} onChange={(id) => set({ model: id })} options={models.map((m) => ({ value: m.id, label: `${m.label}${m.model && m.model !== m.label ? ` (${m.model})` : ''}` }))} /></div>}
          <label className="zk-check"><input type="checkbox" checked={prefs.crop} disabled={busy} onChange={(e) => set({ crop: e.target.checked })} /> Let me adjust the page's edges first</label>
          {busy ? (
            <div className="ocr-busy" role="status" aria-live="polite"><span className="spinner" /><span>{what}</span></div>
          ) : (
            <button type="button" className={`ocr-drop ${over ? 'over' : ''}`} onClick={() => pick.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void choose(e.dataTransfer.files?.[0]) }}>
              <ImagePlus size={26} /><b>Choose a photo or scan</b><span>or drop it here. The text is added where your cursor is.</span>
            </button>)}
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
        </>)}
        {err && <p className="form-error" role="alert">{err}</p>}
      </div>
    </Modal>
  )
}
