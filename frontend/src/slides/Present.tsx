import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, StickyNote, X } from 'lucide-react'
import { SlideStage, useDeckFonts } from './SlideView'
import { H, W, type Slide, type Theme } from './themes'

/** Fullscreen slideshow: arrow keys, space, click or swipe to move; N for speaker notes; Esc to leave. */
export function Present({ slides, theme, start, transition, onClose }: { slides: Slide[]; theme: Theme; start: number; transition: string; onClose: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(0, start), slides.length - 1))
  const [prev, setPrev] = useState<number | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)
  const [notes, setNotes] = useState(false)
  const [scale, setScale] = useState(1)
  const [chrome, setChrome] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const touch = useRef<number | null>(null)
  const hide = useRef<number | undefined>(undefined)
  useDeckFonts(slides, theme)

  const go = useCallback((to: number) => {
    setI((cur) => {
      const n = Math.max(0, Math.min(slides.length - 1, to))
      if (n === cur) return cur
      setPrev(cur); setDir(n > cur ? 1 : -1); window.setTimeout(() => setPrev(null), 420)
      return n
    })
  }, [slides.length])

  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / W, innerHeight / H))
    fit(); window.addEventListener('resize', fit)
    root.current?.requestFullscreen?.().catch(() => {})
    const onFs = () => { if (!document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', onFs)
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(i + 1) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(i - 1) }
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(slides.length - 1)
      else if (e.key.toLowerCase() === 'n') setNotes((v) => !v)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, i, onClose, slides.length])

  const wake = () => { setChrome(true); window.clearTimeout(hide.current); hide.current = window.setTimeout(() => setChrome(false), 2200) }
  useEffect(() => { wake(); return () => window.clearTimeout(hide.current) }, [])

  const slide = slides[i], old = prev !== null ? slides[prev] : null
  const anim = transition === 'none' ? '' : transition === 'slide' ? (dir === 1 ? 'tr-slide-next' : 'tr-slide-prev') : 'tr-fade'
  return createPortal(
    <div ref={root} className={`present ${chrome ? 'chrome' : ''}`} onMouseMove={wake}
      onClick={(e) => { if ((e.target as HTMLElement).closest('.pr-ui')) return; go(e.clientX < innerWidth * 0.3 ? i - 1 : i + 1) }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
      onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1) }}>
      <div className="pr-stage" style={{ width: W * scale, height: H * scale }}>
        {old && transition !== 'none' && <div className="pr-layer pr-old"><SlideStage slide={old} theme={theme} scale={scale} /></div>}
        <div key={slide.id + ':' + i} className={`pr-layer ${prev !== null ? anim : ''}`}><SlideStage slide={slide} theme={theme} scale={scale} /></div>
      </div>
      <div className="pr-progress"><i style={{ width: `${((i + 1) / slides.length) * 100}%` }} /></div>
      <div className="pr-ui pr-bar">
        <button aria-label="Previous slide" onClick={() => go(i - 1)} disabled={i === 0}><ChevronLeft size={20} /></button>
        <span>{i + 1} / {slides.length}</span>
        <button aria-label="Next slide" onClick={() => go(i + 1)} disabled={i === slides.length - 1}><ChevronRight size={20} /></button>
        <button aria-label="Speaker notes" className={notes ? 'on' : ''} title="Speaker notes (N)" onClick={() => setNotes((v) => !v)}><StickyNote size={18} /></button>
        <button aria-label="Exit" title="Exit (Esc)" onClick={onClose}><X size={18} /></button>
      </div>
      {notes && <div className="pr-ui pr-notes"><b>Speaker notes</b><p>{slide.notes.trim() || 'No notes for this slide.'}</p></div>}
    </div>, document.body)
}
