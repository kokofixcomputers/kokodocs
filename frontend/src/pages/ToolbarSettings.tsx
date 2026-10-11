import { useRef, useState, type ReactNode } from 'react'
import { AlignLeft, ArrowLeft, ArrowRight, Baseline, Bold, Check, Code, FileCog, GitBranch, GitCompareArrows, Highlighter, History, ImagePlus, Info, Italic, Laptop, Link2, List, MessageSquare, Gauge,
  Mic, Minus, MoreHorizontal, PanelTop, Paintbrush, Pilcrow, Plus, Printer, Quote, Redo2, RemoveFormatting, RotateCcw, ScanText, Search, Shapes, Sigma, Smartphone, Smile, Sparkles, SpellCheck, StickyNote,
  Strikethrough, Subscript, Sun, Superscript, Table2, Underline, Undo2, Volume2, WandSparkles, X, Download } from 'lucide-react'
import { DEFAULT_BARS, HEADER_ITEMS, PRESETS, TOOLBAR_ITEMS, profileLists, type BarItem, type BarProfile, type Preset } from '../editor/bars'
import { saveBars, usePrefs } from '../prefs'
import { Toggle } from '../extensions/Field'
import { toast } from '../ui/Toast'

const I = 16
/** What each button looks like in the preview: an icon, or for the wide ones a little text, as in the real bar. */
const LOOK: Record<string, ReactNode> = {
  undo: <Undo2 size={I} />, redo: <Redo2 size={I} />, find: <Search size={I} />, print: <Printer size={I} />, nonprint: <Pilcrow size={I} />, painter: <Paintbrush size={I} />,
  style: 'Normal text ▾', font: 'Inter ▾', size: <>− 11 +</>,
  bold: <Bold size={I} />, italic: <Italic size={I} />, underline: <Underline size={I} />, strike: <Strikethrough size={I} />, color: <Baseline size={I} />, highlight: <Highlighter size={I} />, link: <Link2 size={I} />,
  align: <AlignLeft size={I} />, lists: <List size={I} />, quote: <Quote size={I} />, table: <Table2 size={I} />, image: <ImagePlus size={I} />, scan: <ScanText size={I} />, shape: <Shapes size={I} />,
  command: <Sparkles size={I} />, fixfmt: <WandSparkles size={I} />, sticky: <StickyNote size={I} />, emoji: <Smile size={I} />, callout: <Info size={I} />, equation: <Sigma size={I} />, divider: <Minus size={I} />,
  code: <Code size={I} />, sup: <Superscript size={I} />, sub: <Subscript size={I} />, clear: <RemoveFormatting size={I} />, voice: <Mic size={I} />,
  headerfooter: <><PanelTop size={I} />Header &amp; footer</>, pagesetup: <><FileCog size={I} />Page setup</>,
  comments: <MessageSquare size={I} />, assistant: <><Sparkles size={I} />Assistant</>, export: <Download size={I} />, history: <History size={I} />, proofread: <><SpellCheck size={I} />Proofread</>,
  compare: <GitCompareArrows size={I} />, branch: <GitBranch size={I} />, insights: <Gauge size={I} />, readaloud: <Volume2 size={I} />, theme: <Sun size={I} />,
}
const WIDE = new Set(['style', 'font', 'size', 'headerfooter', 'pagesetup', 'assistant', 'proofread'])

/** One bar as you'd see it: drag buttons to reorder them, drag one onto the “hidden” shelf (or press ✕) to put it under ⋯, drag one up from the shelf (or tap it) to add it. */
function BarEditor({ title, items, order, onChange, tail }: { title: string; items: BarItem[]; order: string[]; onChange: (next: string[]) => void; tail?: ReactNode }) {
  const [sel, setSel] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const atRef = useRef<number | null>(null)   // the drop spot, kept here too so a quick drop never uses a stale one
  const name = (id: string) => items.find((i) => i.id === id)?.label ?? id
  const hidden = items.filter((i) => !order.includes(i.id))

  const place = (id: string, index: number) => {
    const without = order.filter((x) => x !== id)
    const from = order.indexOf(id)
    const to = Math.max(0, Math.min(without.length, from >= 0 && from < index ? index - 1 : index))
    onChange([...without.slice(0, to), id, ...without.slice(to)])
  }
  const drop = (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || drag; const to = atRef.current; if (id && to !== null) { place(id, to); setSel(id) } setDrag(null); setAt(null); atRef.current = null }
  const over = (e: React.DragEvent) => {
    e.preventDefault()
    const chips = [...(bar.current?.querySelectorAll('[data-chip]') ?? [])] as HTMLElement[]
    let i = chips.length
    for (let k = 0; k < chips.length; k++) {
      const r = chips[k].getBoundingClientRect()
      if (e.clientY > r.bottom) continue
      if (e.clientY >= r.top && e.clientX > r.left + r.width / 2) continue
      i = k; break
    }
    setAt(i); atRef.current = i
  }
  const remove = (id: string) => { onChange(order.filter((x) => x !== id)); setSel(null) }
  const move = (id: string, d: -1 | 1) => { const i = order.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }

  return (
    <div className="bp">
      <h4 className="bar-h">{title}</h4>
      <div ref={bar} className={`bp-bar ${drag ? 'dragging' : ''}`} onDragOver={over} onDrop={drop} onDragLeave={(e) => { if (!bar.current?.contains(e.relatedTarget as Node)) setAt(null) }} role="list" aria-label={`${title}, in order`}>
        {order.map((id, i) => (
          <button key={id} type="button" data-chip role="listitem" draggable className={`bp-chip ${WIDE.has(id) ? 'wide' : ''} ${sel === id ? 'sel' : ''} ${drag === id ? 'ghost' : ''} ${at === i ? 'drop-before' : ''} ${at === order.length && i === order.length - 1 ? 'drop-after' : ''}`}
            title={`${name(id)} (drag to move)`} aria-label={name(id)} aria-pressed={sel === id}
            onDragStart={(e) => { setDrag(id); setSel(id); e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setAt(null) }}
            onClick={() => setSel(sel === id ? null : id)}
            onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id) } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.altKey || e.shiftKey)) { e.preventDefault(); move(id, e.key === 'ArrowLeft' ? -1 : 1); requestAnimationFrame(() => (bar.current?.querySelector(`[aria-label="${name(id)}"]`) as HTMLElement | null)?.focus()) } }}>
            {LOOK[id]}
          </button>))}
        {!order.length && <span className="bp-empty">Nothing here. Drag buttons up from below.</span>}
        <span className="bp-more" title="Anything hidden is here"><MoreHorizontal size={I} /></span>
        {tail}
      </div>
      {sel && order.includes(sel) && (
        <div className="bp-sel" role="group" aria-label={`${name(sel)} controls`}>
          <b>{name(sel)}</b>
          <button className="btn btn-pill btn-soft btn-sm" disabled={order.indexOf(sel) === 0} onClick={() => move(sel, -1)}><ArrowLeft size={14} />Earlier</button>
          <button className="btn btn-pill btn-soft btn-sm" disabled={order.indexOf(sel) === order.length - 1} onClick={() => move(sel, 1)}>Later<ArrowRight size={14} /></button>
          <button className="btn btn-pill btn-ghost btn-sm" onClick={() => remove(sel)}><X size={14} />Hide</button>
        </div>)}
      <div className={`bp-shelf ${drag && order.includes(drag) ? 'target' : ''}`} onDragOver={(e) => { e.preventDefault(); setAt(null) }} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || drag; if (id && order.includes(id)) remove(id); setDrag(null) }}>
        <span className="bp-shelf-h"><MoreHorizontal size={14} />Hidden under ⋯ {hidden.length ? `(${hidden.length})` : ''}</span>
        <div className="bp-tray">
          {hidden.map((i) => (
            <button key={i.id} type="button" draggable className="bp-tile" title={`Add ${i.label}`} onClick={() => { onChange([...order, i.id]); setSel(i.id) }}
              onDragStart={(e) => { setDrag(i.id); e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setAt(null) }}>
              <span className="bp-ico">{LOOK[i.id]}</span><span>{i.label}</span><Plus size={13} />
            </button>))}
          {!hidden.length && <span className="bp-empty">Everything is showing.</span>}
        </div>
      </div>
    </div>
  )
}

/** Settings → Toolbar: which buttons the top bar and the formatting bar show and in what order, separately for computers and phones. The rest wait under ⋯. */
export function ToolbarSettings() {
  const { bars } = usePrefs()
  const [which, setWhich] = useState<'desktop' | 'mobile'>('desktop')
  const key = bars.same ? 'desktop' : which
  const p = bars[key]
  const lists = profileLists(p)   // what is showing right now, whatever the preset
  const save = (next: typeof bars) => { void saveBars(next).catch((e) => toast((e as Error).message)) }
  const setProfile = (np: BarProfile) => save({ ...bars, [key]: np })
  const choose = (preset: Preset) => setProfile(preset === 'custom' ? { preset: 'custom', ...lists } : { ...p, preset })
  /** Any change starts from exactly what is showing, so nothing else disappears. */
  const edit = (list: 'toolbar' | 'header', next: string[]) => setProfile({ preset: 'custom', toolbar: list === 'toolbar' ? next : lists.toolbar, header: list === 'header' ? next : lists.header })

  return (
    <section className="st-section"><h1>Toolbar</h1>
      <div className="st-card">
        <div className="st-row"><div><b>Make the bars yours</b><span>Start from a layout, then drag buttons around, hide the ones you never use or bring back others. Anything hidden is under the <b>⋯</b> button, so nothing is lost.</span></div></div>
        <div className="st-row"><div><b>Same on computers and phones</b><span>Turn off to give your phone its own, smaller set.</span></div>
          <span className="st-btns"><Toggle on={bars.same} label="Use the same toolbar on every device" set={(v) => save({ ...bars, same: v })} /></span></div>
      </div>

      {!bars.same && (
        <div className="seg bar-tabs" role="tablist">
          <button role="tab" aria-selected={which === 'desktop'} className={which === 'desktop' ? 'on' : ''} onClick={() => setWhich('desktop')}><Laptop size={15} />Computer</button>
          <button role="tab" aria-selected={which === 'mobile'} className={which === 'mobile' ? 'on' : ''} onClick={() => setWhich('mobile')}><Smartphone size={15} />Phone</button>
        </div>
      )}

      <div className="bar-presets">
        {PRESETS.map((x) => (
          <button key={x.id} className={`bar-preset ${p.preset === x.id ? 'on' : ''}`} onClick={() => choose(x.id)} aria-pressed={p.preset === x.id}>
            <b>{x.label}</b><span>{x.hint}</span>{p.preset === x.id && <Check size={16} />}
          </button>))}
      </div>

      <h2 className="st-sub">Preview</h2>
      <div className="st-card bp-card">
        <BarEditor title="Top bar" items={HEADER_ITEMS} order={lists.header} onChange={(n) => edit('header', n)}
          tail={<><span className="bp-fixed">Share</span><span className="bp-fixed round" /></>} />
        <BarEditor title="Formatting bar" items={TOOLBAR_ITEMS} order={lists.toolbar} onChange={(n) => edit('toolbar', n)} />
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>Drag to reorder, or click a button and use Earlier / Later. Keyboard: Shift + ← → to move, Delete to hide. Share, your picture and the save status always stay.</p>
      </div>
      <div className="st-inline"><button className="btn btn-pill btn-ghost" onClick={() => save(DEFAULT_BARS)}><RotateCcw size={15} />Reset to the defaults</button></div>
    </section>
  )
}
