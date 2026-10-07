import { useEffect, useRef, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { SlideStage } from './SlideView'
import { LAYOUTS, type LayoutId, type Slide, type Theme } from './themes'
import type { SlidesModel } from './model'
import type { RemoteSel } from './Canvas'

const THUMB = 0.11

export function Rail({ model, slides, theme, cur, setCur, readOnly, remotes, commentCounts, onContext }: {
  onContext?: (x: number, y: number, slideId: string) => void
  model: SlidesModel; slides: Slide[]; theme: Theme; cur: string; setCur: (id: string) => void; readOnly: boolean; remotes: RemoteSel[]; commentCounts?: Record<string, number>
}) {
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [cur])

  return (
    <aside className="sl-rail" aria-label="Slides">
      <div className="sl-rail-list" onKeyDown={(e) => {
        if (readOnly) return
        const i = slides.findIndex((s) => s.id === cur)
        if ((e.key === 'Delete' || e.key === 'Backspace') && slides.length > 1) { e.preventDefault(); model.deleteSlide(cur); setCur(slides[Math.max(0, i - 1)].id === cur ? slides[1].id : slides[Math.max(0, i - 1)].id) }
      }}>
        {slides.map((s, i) => (
          <div key={s.id} ref={s.id === cur ? activeRef : undefined} tabIndex={0} role="button" aria-label={`Slide ${i + 1}`} aria-current={s.id === cur}
            className={`sl-thumb ${s.id === cur ? 'on' : ''} ${drag?.over === i && drag.id !== s.id ? 'drop' : ''}`}
            draggable={!readOnly} onClick={() => setCur(s.id)} onContextMenu={(e) => { if (!onContext) return; e.preventDefault(); onContext(e.clientX, e.clientY, s.id) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCur(s.id) } if (e.key === 'ArrowDown' && slides[i + 1]) { e.preventDefault(); setCur(slides[i + 1].id) } if (e.key === 'ArrowUp' && slides[i - 1]) { e.preventDefault(); setCur(slides[i - 1].id) } }}
            onDragStart={(e) => { setDrag({ id: s.id, over: i }); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }) } }}
            onDrop={(e) => { e.preventDefault(); if (drag) model.moveSlide(drag.id, i); setDrag(null) }} onDragEnd={() => setDrag(null)}>
            <span className="sl-num">{i + 1}</span>
            <div className="sl-thumb-card"><SlideStage slide={s} theme={theme} scale={THUMB} /></div>
            {commentCounts?.[s.id] ? <i className="sl-cbadge" title={`${commentCounts[s.id]} open comment(s)`}>{commentCounts[s.id]}</i> : null}
            {remotes.filter((r) => r.slide === s.id).slice(0, 3).map((r) => <i key={r.id} className="sl-dot" style={{ background: r.color }} title={r.name} />)}
            {!readOnly && (
              <span className="sl-thumb-actions" onClick={(e) => e.stopPropagation()}>
                <button aria-label="Duplicate slide" title="Duplicate slide" onClick={() => { const n = model.duplicateSlide(s.id); if (n) setCur(n) }}><Copy size={13} /></button>
                {slides.length > 1 && <button aria-label="Delete slide" title="Delete slide" onClick={() => { model.deleteSlide(s.id); if (s.id === cur) setCur(slides[Math.max(0, i - 1)].id === s.id ? slides[1].id : slides[Math.max(0, i - 1)].id) }}><Trash2 size={13} /></button>}
              </span>)}
          </div>
        ))}
      </div>
      {!readOnly && <AddSlide model={model} slides={slides} cur={cur} setCur={setCur} />}
    </aside>
  )
}

export function AddSlide({ model, slides, cur, setCur, compact }: { model: SlidesModel; slides: Slide[]; cur: string; setCur: (id: string) => void; compact?: boolean }) {
  const add = (layout: LayoutId) => setCur(model.addSlide(layout, slides.findIndex((s) => s.id === cur)))
  return (
    <div className="sl-add">
      <button className="btn btn-pill btn-soft btn-sm sl-add-main" onClick={() => add('titleContent')}><Plus size={15} />{compact ? '' : 'New slide'}</button>
      <Popover align="start" className="pop-menu" trigger={({ toggle }) => <button className="btn btn-pill btn-soft btn-sm sl-add-more" aria-label="Choose a layout" title="Choose a layout" onClick={toggle}>Layout</button>}>
        {(close) => LAYOUTS.map((l) => <button key={l.id} className="menu-row" onClick={() => { close(); add(l.id) }}>{l.name}</button>)}
      </Popover>
    </div>
  )
}
