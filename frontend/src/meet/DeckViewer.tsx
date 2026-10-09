import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { ChevronLeft, ChevronRight, LayoutList, Lock, Pencil, StickyNote, Unlock, Users } from 'lucide-react'
import { KokoProvider } from '../collab'
import { setDocToken } from '../api'
import { SlidesModel } from '../slides/model'
import { SlideStage, useDeckFonts } from '../slides/SlideView'
import { H, W } from '../slides/themes'
import type { Call, Share } from './types'

/** A presentation shown inside the meeting. Everyone fetches the deck themselves (read-only, with a key for this meeting) and shows the slide the presenter is on.
 *  Where the presenter allows it, people can look at other slides on their own and jump back to the presenter. The presenter (and hosts) turn the pages. */
export function DeckViewer({ call, share }: { call: Call; share: Share }) {
  const me = call.me(), perms = call.perms()
  const controls = share.by_id === me.id || me.manager
  const mayBrowse = controls || (perms.seek && share.seek)
  const [model, setModel] = useState<SlidesModel | null>(null)
  const [, bump] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading')
  const [browse, setBrowse] = useState<number | null>(null)   // null: following the presenter
  const [strip, setStrip] = useState(false)
  const [notes, setNotes] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 450 })

  useEffect(() => {
    let dead = false, cleanup = () => {}
    setState('loading'); setModel(null)
    void call.shareToken().then((t) => {
      if (dead) return
      setDocToken(t.doc_id, t.token)
      const ydoc = new Y.Doc(), m = new SlidesModel(ydoc), p = new KokoProvider(t.doc_id, ydoc, true)
      const off = m.subscribe(() => bump((n) => n + 1))
      const poll = p.subscribe(() => { if (p.status === 'denied') setState('denied'); else if (p.synced) setState('ready'); bump((n) => n + 1) })
      setModel(m)
      cleanup = () => { off(); poll(); p.destroy(); m.destroy() }
    }).catch(() => setState('denied'))
    return () => { dead = true; cleanup() }
  }, [call, share.id, share.doc_id])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [state])

  const slides = model ? model.read() : []
  const theme = model ? model.deckTheme() : null
  useDeckFonts(slides, theme ?? ({ head: 'Inter', body: 'Inter' } as never))
  const last = Math.max(0, slides.length - 1)
  const at = Math.min(Math.max(0, call.slide()), last)
  const cur = Math.min(browse ?? at, last)
  const following = browse === null || browse === at

  const go = (n: number) => {
    const t = Math.max(0, Math.min(last, n))
    if (controls) { setBrowse(null); call.setSlide(t) }
    else if (mayBrowse) setBrowse(t === at ? null : t)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if ((el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) || e.metaKey || e.ctrlKey || e.altKey || !mayBrowse) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(cur + 1) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(cur - 1) }
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(last)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (state === 'denied') return <div className="deck-msg"><p>This presentation couldn't be opened.</p></div>
  if (model && state === 'ready' && !slides.length) return <div className="deck-msg"><p>This presentation has no slides yet.</p>{controls && <p className="muted small">Add some in the presentation, then share it again.</p>}</div>
  if (!model || !theme || !slides.length || state === 'loading') return <div className="deck-msg"><span className="spinner" /><p>Loading the presentation…</p></div>

  const stripH = strip ? 86 : 0, barH = 54
  const scale = Math.max(0.05, Math.min(size.w / W, (size.h - barH - stripH - (notes && controls ? 96 : 0)) / H))
  const slide = slides[cur]
  return (
    <div className="deck">
      {!following && (
        <div className="deck-browsing"><Users size={14} />You're looking around on your own. The presenter is on slide {at + 1}.
          <button className="btn btn-primary btn-sm btn-pill" onClick={() => setBrowse(null)}>Back to the presenter</button></div>)}
      <div className="deck-slide" ref={box}>
        <div key={slide.id + ':' + cur} className="deck-fade"><SlideStage slide={slide} theme={theme} scale={scale} /></div>
      </div>
      {notes && controls && <div className="deck-notes"><b>Speaker notes</b><p>{slide.notes.trim() || 'No notes for this slide.'}</p></div>}
      {strip && mayBrowse && (
        <div className="deck-strip">{slides.map((s, i) => (
          <button key={s.id} className={`${i === cur ? 'cur' : ''} ${i === at ? 'live' : ''}`} onClick={() => go(i)} aria-label={`Slide ${i + 1}`}><SlideStage slide={s} theme={theme} scale={0.1} /><span>{i + 1}</span></button>))}</div>)}
      <div className="deck-bar">
        {mayBrowse ? <button className="icon-btn" aria-label="Previous slide" onClick={() => go(cur - 1)} disabled={cur === 0}><ChevronLeft size={20} /></button> : null}
        <span className="deck-count" aria-live="polite">{cur + 1} / {slides.length}</span>
        {mayBrowse ? <button className="icon-btn" aria-label="Next slide" onClick={() => go(cur + 1)} disabled={cur === last}><ChevronRight size={20} /></button> : <span className="deck-lock" title="The presenter turns the pages"><Lock size={13} />Following the presenter</span>}
        {mayBrowse && <button className={`icon-btn ${strip ? 'on' : ''}`} aria-label="Show all slides" title="All slides" onClick={() => setStrip((v) => !v)}><LayoutList size={18} /></button>}
        {controls && <button className={`icon-btn ${notes ? 'on' : ''}`} aria-label="Speaker notes" title="Speaker notes (only you see them)" onClick={() => setNotes((v) => !v)}><StickyNote size={18} /></button>}
        {controls && <button className={`btn btn-soft btn-pill btn-sm`} onClick={() => call.setShareSeek(!share.seek)} title="Let people look at other slides on their own">{share.seek ? <Unlock size={14} /> : <Lock size={14} />}{share.seek ? 'People can browse' : 'People follow you'}</button>}
        {!controls && !mayBrowse && perms.seek === false && <span className="deck-lock"><Pencil size={0} /></span>}
      </div>
    </div>)
}
