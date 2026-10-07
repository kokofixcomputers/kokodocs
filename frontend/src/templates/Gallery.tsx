import { useState } from 'react'
import { FileText, Presentation, Sparkles, Table2, Wand2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { SlideStage } from '../slides/SlideView'
import { layoutElements, themeById } from '../slides/themes'
import { CATEGORIES, KIND_LABEL, TEMPLATES, type Template, type TemplateKind } from './catalog'

export function TemplatePreview({ t, width = 188 }: { t: Template; width?: number }) {
  const h = Math.round(width * 0.64)
  if (t.preview.slide) {
    const p = t.preview.slide, th = themeById(p.theme)
    const slide = { id: 'p', notes: '', bg: null, els: layoutElements(p.layout, p.content).map((e, i) => ({ ...e, id: String(i), z: i })) as never }
    return <div className="tpl-prev" style={{ width, height: h }}><SlideStage slide={slide} theme={th} scale={width / 1280} /></div>
  }
  if (t.preview.rows) {
    return (
      <div className="tpl-prev tpl-sheet" style={{ width, height: h }}>
        <table><tbody>{t.preview.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table>
      </div>)
  }
  return <div className="tpl-prev tpl-doc" style={{ width, height: h }}><div className="koko-prose" dangerouslySetInnerHTML={{ __html: t.preview.html ?? '' }} /></div>
}

export function TemplateCard({ t, onPick, busy }: { t: Template; onPick: () => void; busy?: boolean }) {
  return (
    <button className="tpl-card" onClick={onPick} disabled={busy} aria-label={`Use the ${t.name} template`}>
      <TemplatePreview t={t} />
      <b>{t.name}</b><span>{t.desc}</span>
    </button>
  )
}

const KINDS: { id: TemplateKind; icon: typeof FileText }[] = [{ id: 'doc', icon: FileText }, { id: 'sheet', icon: Table2 }, { id: 'slides', icon: Presentation }]

/** Pick a template, start blank, or describe what you need and let the assistant draft it. */
export function TemplateGallery({ onUse, onBlank, onDescribe, onClose }: {
  onUse: (t: Template) => void; onBlank: (k: TemplateKind) => void; onDescribe: (kind: TemplateKind, text: string) => void; onClose: () => void
}) {
  const [kind, setKind] = useState<TemplateKind | 'all'>('all')
  const [cat, setCat] = useState('All')
  const [ask, setAsk] = useState('')
  const [askKind, setAskKind] = useState<TemplateKind>('doc')
  const list = TEMPLATES.filter((t) => (kind === 'all' || t.kind === kind) && (cat === 'All' || t.category === cat))
  return (
    <Modal title="Start something new" onClose={onClose} width={900}>
      <div className="share-body tpl-gallery">
        <div className="tpl-ask">
          <Wand2 size={18} />
          <input value={ask} placeholder="Describe what you need and the assistant will draft it" onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ask.trim()) onDescribe(askKind, ask.trim()) }} />
          <span className="seg mini">{KINDS.map((k) => <button key={k.id} className={askKind === k.id ? 'on' : ''} onClick={() => setAskKind(k.id)} aria-label={KIND_LABEL[k.id]} title={KIND_LABEL[k.id]}><k.icon size={15} /></button>)}</span>
          <button className="btn btn-pill btn-primary btn-sm" disabled={!ask.trim()} onClick={() => onDescribe(askKind, ask.trim())}><Sparkles size={14} />Draft it</button>
        </div>
        <div className="tpl-filters">
          <span className="chips">{(['all', 'doc', 'sheet', 'slides'] as const).map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setKind(k)}>{k === 'all' ? 'Everything' : KIND_LABEL[k]}</button>)}</span>
          <span className="chips">{CATEGORIES.map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setCat(c)}>{c}</button>)}</span>
        </div>
        <div className="tpl-grid">
          {(kind === 'all' ? KINDS : KINDS.filter((k) => k.id === kind)).filter(() => cat === 'All').map((k) => (
            <button key={'blank-' + k.id} className="tpl-card blank" onClick={() => onBlank(k.id)}>
              <span className="tpl-blank"><k.icon size={30} /></span><b>Blank {k.id === 'doc' ? 'document' : k.id === 'sheet' ? 'spreadsheet' : 'presentation'}</b><span>Start from nothing</span>
            </button>))}
          {list.map((t) => <TemplateCard key={t.id} t={t} onPick={() => onUse(t)} />)}
        </div>
        {list.length === 0 && <p className="muted">No templates in this group yet.</p>}
      </div>
    </Modal>
  )
}
