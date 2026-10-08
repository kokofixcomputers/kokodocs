import type { ReactElement } from 'react'
import { useRef } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowRight, Bold, BringToFront, ChevronDown, Circle, Copy, Image as ImageIcon, Italic, List, Minus, PaintBucket,
  Palette, Redo2, SendToBack, Square, SquareRoundCorner, Trash2, Triangle, Type, Underline, Undo2, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  Shapes, PanelTop, Highlighter, BarChart3, LineChart, PieChart, AreaChart, Table2, AlignHorizontalDistributeCenter, Pencil, Rows3, Columns3,
} from 'lucide-react'
import { ColorPicker } from '../editor/ColorPicker'
import { TBtn } from '../editor/Toolbar'
import { fontStack, loadFont } from '../fonts'
import { FontPicker } from '../editor/FontPicker'
import { Popover } from '../ui/Popover'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { AddSlide } from './Rail'
import { THEMES, themeById, chartCells, tableDraft, type ChartKind, type El, type ShapeKind, type Slide, type Theme } from './themes'
import { applyTableOp } from './matrix'
import { useState } from 'react'
import type { SlidesModel } from './model'

const SIZES = [14, 18, 20, 24, 28, 32, 36, 44, 54, 64, 76, 96, 120]
const SHAPES: { id: ShapeKind; name: string; icon: ReactElement }[] = [
  { id: 'rect', name: 'Rectangle', icon: <Square size={16} /> }, { id: 'round', name: 'Rounded rectangle', icon: <SquareRoundCorner size={16} /> },
  { id: 'ellipse', name: 'Ellipse', icon: <Circle size={16} /> }, { id: 'triangle', name: 'Triangle', icon: <Triangle size={16} /> },
  { id: 'line', name: 'Line', icon: <Minus size={16} /> }, { id: 'arrow', name: 'Arrow', icon: <ArrowRight size={16} /> },
]

export function SlidesToolbar({ model, slides, slide, theme, sel, setSel, setEditing, setCur, readOnly, upload, transition, activeCell, onEditChart }: {
  model: SlidesModel; slides: Slide[]; slide: Slide; theme: Theme; sel: string[]; setSel: (ids: string[]) => void; setEditing: (id: string | null) => void
  setCur: (id: string) => void; readOnly: boolean; upload: (f: File) => Promise<string>; transition: string
  activeCell: { r: number; c: number } | null; onEditChart: (id: string) => void
}) {
  const [pick, setPick] = useState<[number, number]>([0, 0])
  const file = useRef<HTMLInputElement>(null)
  const picked = slide.els.filter((e) => sel.includes(e.id))
  const first: El | undefined = picked[0]
  const has = picked.length > 0
  const texty = picked.filter((e) => e.type === 'text' || e.type === 'shape')
  const apply = (patch: Partial<El>, only?: El[]) => { const t = only ?? picked; if (t.length) model.updateMany(slide.id, Object.fromEntries(t.map((e) => [e.id, patch]))) }
  const size = first?.size ?? 28

  const add = (e: Parameters<SlidesModel['addEl']>[1], edit = false) => { const id = model.addEl(slide.id, e); if (id) { setSel([id]); if (edit) setEditing(id) } }
  const pickImage = async (f: File) => {
    try {
      const src = await upload(f)
      const dim = await new Promise<{ w: number; h: number }>((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 800, h: 450 }); i.src = src })
      const k = Math.min(1, 760 / dim.w, 480 / dim.h)
      const w = Math.round(dim.w * k), h = Math.round(dim.h * k)
      add({ type: 'image', src, x: Math.round((1280 - w) / 2), y: Math.round((720 - h) / 2), w, h, alt: f.name })
    } catch (e) { toast((e as Error).message || 'Could not upload the image') }
  }
  const off = readOnly

  return (
    <div className={`toolbar sl-toolbar ${readOnly ? 'readonly' : ''}`}>
      <fieldset disabled={off} className="tb-fieldset">
        <div className="tb-group">
          <TBtn icon={<Undo2 size={17} />} label="Undo (Ctrl+Z)" onClick={() => model.undo.undo()} />
          <TBtn icon={<Redo2 size={17} />} label="Redo (Ctrl+Y)" onClick={() => model.undo.redo()} />
        </div>
        <div className="tb-group"><AddSlide model={model} slides={slides} cur={slide.id} setCur={setCur} compact /></div>
        <div className="tb-group">
          <TBtn icon={<Type size={17} />} label="Text box" onClick={() => add({ type: 'text', x: 400, y: 300, w: 480, h: 90, text: '', size: 32, align: 'left', valign: 'top' }, true)} />
          <Popover className="pop-menu" trigger={({ toggle }) => <button className="tb-btn" title="Shape" aria-label="Shape" onMouseDown={(e) => e.preventDefault()} onClick={toggle}><Shapes size={17} /></button>}>
            {(close) => SHAPES.map((s) => <button key={s.id} className="menu-row" onClick={() => { close(); const line = s.id === 'line' || s.id === 'arrow'; add({ type: 'shape', shape: s.id, x: 440, y: line ? 340 : 230, w: line ? 400 : 400, h: line ? 40 : 260, fill: 'auto', strokeW: line ? 6 : 0 }) }}>{s.icon}{s.name}</button>)}
          </Popover>
          <Popover trigger={({ toggle }) => <TBtn icon={<Table2 size={17} />} label="Table" onClick={toggle} />}>
            {(close) => (
              <div>
                <div className="table-picker" onMouseLeave={() => setPick([0, 0])}>{Array.from({ length: 36 }, (_, i) => { const r = Math.floor(i / 6) + 1, c = (i % 6) + 1; return (
                  <i key={i} className={r <= pick[0] && c <= pick[1] ? 'on' : ''} onMouseEnter={() => setPick([r, c])} onClick={() => {
                    close(); const rows = Array.from({ length: r }, (_v, ri) => Array.from({ length: c }, (_w, ci) => (ri === 0 ? `Column ${ci + 1}` : '')))
                    const d = tableDraft(rows, 80, 200, 1120, Math.min(440, r * 64)); add(d as never)
                  }} />) })}</div>
                <div className="table-pick-label">{pick[0] ? `${pick[0]} x ${pick[1]}` : 'Insert a table'}</div>
              </div>)}
          </Popover>
          <Popover className="pop-menu" trigger={({ toggle }) => <TBtn icon={<BarChart3 size={17} />} label="Chart" onClick={toggle} />}>
            {(close) => ([['column', 'Columns', BarChart3], ['bar', 'Bars', AlignHorizontalDistributeCenter], ['line', 'Line', LineChart], ['area', 'Area', AreaChart], ['pie', 'Pie', PieChart]] as [ChartKind, string, typeof BarChart3][]).map(([k, n, I]) => (
              <button key={k} className="menu-row" onClick={() => { close(); add({ type: 'chart', chart: k, x: 240, y: 130, w: 800, h: 460, cells: chartCells(), nr: 5, nc: 3, legend: true }) }}><I size={16} />{n}</button>))}
          </Popover>
          <TBtn icon={<ImageIcon size={17} />} label="Image" onClick={() => file.current?.click()} />
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = '' }} />
        </div>

        <div className={`tb-group ${texty.length ? '' : 'dim'}`}>
          <Popover className="pop-font" trigger={({ toggle }) => <button className="tb-select" style={{ width: 138 }} onMouseDown={(e) => e.preventDefault()} onClick={toggle} disabled={!texty.length} aria-label="Font"><span className="trunc" style={{ fontFamily: first?.font && first.font !== 'auto' ? fontStack(first.font) : undefined }}>{first?.font && first.font !== 'auto' ? first.font : 'Theme font'}</span><ChevronDown size={15} /></button>}>
            {(close) => <FontPicker value={first?.font && first.font !== 'auto' ? first.font : ''} resetLabel="Use the theme's font" onReset={() => { close(); apply({ font: undefined }, texty) }} onPick={(f) => { close(); loadFont(f); apply({ font: f }, texty) }} />}
          </Popover>
          <div className="size-box">
            <button disabled={!texty.length} onMouseDown={(e) => e.preventDefault()} onClick={() => apply({ size: Math.max(8, size - 2) }, texty)} aria-label="Smaller">−</button>
            <Popover className="pop-menu small" trigger={({ toggle }) => <button className="size-val" disabled={!texty.length} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>{size}</button>}>
              {(close) => SIZES.map((s) => <button key={s} className={`menu-row ${s === size ? 'on' : ''}`} onClick={() => { close(); apply({ size: s }, texty) }}>{s}</button>)}
            </Popover>
            <button disabled={!texty.length} onMouseDown={(e) => e.preventDefault()} onClick={() => apply({ size: Math.min(300, size + 2) }, texty)} aria-label="Larger">+</button>
          </div>
        </div>
        <div className={`tb-group ${texty.length ? '' : 'dim'}`}>
          <TBtn icon={<Bold size={17} />} label="Bold (Ctrl+B)" active={!!first?.bold} disabled={!texty.length} onClick={() => apply({ bold: !first?.bold }, texty)} />
          <TBtn icon={<Italic size={17} />} label="Italic (Ctrl+I)" active={!!first?.italic} disabled={!texty.length} onClick={() => apply({ italic: !first?.italic }, texty)} />
          <TBtn icon={<Underline size={17} />} label="Underline (Ctrl+U)" active={!!first?.underline} disabled={!texty.length} onClick={() => apply({ underline: !first?.underline }, texty)} />
          <Popover trigger={({ toggle }) => <TBtn icon={<Palette size={17} />} label="Text color" disabled={!texty.length} onClick={toggle} />}>
            {(close) => <ColorPicker noneLabel="Theme color" value={first?.color} onPick={(c) => { close(); apply({ color: c ?? undefined }, texty) }} />}
          </Popover>
        </div>
        <div className={`tb-group ${texty.length ? '' : 'dim'}`}>
          <TBtn icon={<AlignLeft size={17} />} label="Align left" active={(first?.align ?? 'left') === 'left'} disabled={!texty.length} onClick={() => apply({ align: 'left' }, texty)} />
          <TBtn icon={<AlignCenter size={17} />} label="Align center" active={first?.align === 'center'} disabled={!texty.length} onClick={() => apply({ align: 'center' }, texty)} />
          <TBtn icon={<AlignRight size={17} />} label="Align right" active={first?.align === 'right'} disabled={!texty.length} onClick={() => apply({ align: 'right' }, texty)} />
          <TBtn icon={<AlignVerticalJustifyStart size={17} />} label="Align top" active={(first?.valign ?? 'top') === 'top'} disabled={!texty.length} onClick={() => apply({ valign: 'top' }, texty)} />
          <TBtn icon={<AlignVerticalJustifyCenter size={17} />} label="Align middle" active={first?.valign === 'middle'} disabled={!texty.length} onClick={() => apply({ valign: 'middle' }, texty)} />
          <TBtn icon={<AlignVerticalJustifyEnd size={17} />} label="Align bottom" active={first?.valign === 'bottom'} disabled={!texty.length} onClick={() => apply({ valign: 'bottom' }, texty)} />
          <TBtn icon={<List size={17} />} label="Bullet points" active={!!first?.bullets} disabled={!picked.some((e) => e.type === 'text')} onClick={() => apply({ bullets: !first?.bullets }, picked.filter((e) => e.type === 'text'))} />
        </div>
        <div className={`tb-group ${picked.some((e) => e.type === 'shape') ? '' : 'dim'}`}>
          <Popover trigger={({ toggle }) => <TBtn icon={<PaintBucket size={17} />} label="Fill color" disabled={!picked.some((e) => e.type === 'shape')} onClick={toggle} />}>
            {(close) => <ColorPicker noneLabel="No fill" value={first?.fill} onPick={(c) => { close(); apply({ fill: c ?? 'none' }, picked.filter((e) => e.type === 'shape')) }} />}
          </Popover>
          <Popover trigger={({ toggle }) => <TBtn icon={<Highlighter size={17} />} label="Outline color" disabled={!picked.some((e) => e.type === 'shape')} onClick={toggle} />}>
            {(close) => <ColorPicker noneLabel="No outline" value={first?.stroke} onPick={(c) => { close(); apply(c ? { stroke: c, strokeW: first?.strokeW || 4 } : { stroke: 'none' }, picked.filter((e) => e.type === 'shape')) }} />}
          </Popover>
        </div>
        {first?.type === 'table' && (
          <div className="tb-group">
            <TBtn icon={<Rows3 size={17} />} label="Add row below" onClick={() => model.updateEl(slide.id, first.id, applyTableOp(first, 'addRow', activeCell?.r ?? (first.nr ?? 1) - 1))} />
            <TBtn icon={<Columns3 size={17} />} label="Add column right" onClick={() => model.updateEl(slide.id, first.id, applyTableOp(first, 'addCol', activeCell?.c ?? (first.nc ?? 1) - 1))} />
            <TBtn icon={<Minus size={17} />} label="Delete row" disabled={(first.nr ?? 1) <= 1} onClick={() => model.updateEl(slide.id, first.id, applyTableOp(first, 'delRow', activeCell?.r ?? (first.nr ?? 1) - 1))} />
            <TBtn icon={<Trash2 size={15} />} label="Delete column" disabled={(first.nc ?? 1) <= 1} onClick={() => model.updateEl(slide.id, first.id, applyTableOp(first, 'delCol', activeCell?.c ?? (first.nc ?? 1) - 1))} />
            <TBtn icon={<PanelTop size={17} />} label="Header row" active={first.header !== false} onClick={() => model.updateEl(slide.id, first.id, { header: first.header === false })} />
          </div>)}
        {first?.type === 'chart' && (
          <div className="tb-group"><button className="tb-pill" onMouseDown={(e) => e.preventDefault()} onClick={() => onEditChart(first.id)}><Pencil size={15} />Edit chart data</button></div>)}
        <div className={`tb-group ${has ? '' : 'dim'}`}>
          <TBtn icon={<BringToFront size={17} />} label="Bring to front" disabled={!has} onClick={() => model.reorder(slide.id, sel, 'front')} />
          <TBtn icon={<SendToBack size={17} />} label="Send to back" disabled={!has} onClick={() => model.reorder(slide.id, sel, 'back')} />
          <TBtn icon={<Copy size={17} />} label="Duplicate (Ctrl+D)" disabled={!has} onClick={() => setSel(model.duplicateEls(slide.id, sel))} />
          <TBtn icon={<Trash2 size={17} />} label="Delete (Delete key)" disabled={!has} onClick={() => { model.deleteEls(slide.id, sel); setSel([]) }} />
        </div>
        <div className="tb-group">
          <Popover className="pop-menu" trigger={({ toggle }) => <button className="tb-pill" onMouseDown={(e) => e.preventDefault()} onClick={toggle}><PanelTop size={16} />Theme</button>}>
            {(close) => (
              <div className="theme-list">
                {THEMES.map((t) => (
                  <button key={t.id} className={`theme-item ${t.id === theme.id ? 'on' : ''}`} onClick={() => { close(); model.setMeta('theme', t.id); model.setPalette(null) }}>
                    <span className="theme-sw" style={{ background: t.bg, color: t.fg, boxShadow: `inset 0 0 0 1px ${t.muted}55` }}><b style={{ fontFamily: `"${t.head}"` }}>Aa</b><i style={{ background: t.accent }} /></span>
                    <span>{t.name}</span>
                  </button>))}
              </div>)}
          </Popover>
          <Popover className="pop-font" trigger={({ toggle }) => <button className="tb-pill" aria-label="Deck fonts" onMouseDown={(e) => e.preventDefault()} onClick={toggle}><Type size={16} />Fonts</button>}>
            {(close) => <DeckFonts model={model} theme={theme} close={close} />}
          </Popover>
          <Popover trigger={({ toggle }) => <TBtn icon={<PaintBucket size={17} />} label="Slide background" onClick={toggle} />}>
            {(close) => <ColorPicker noneLabel="Theme background" value={slide.bg && slide.bg.startsWith('#') ? slide.bg : null} onPick={(c) => { close(); model.setBg(slide.id, c) }} />}
          </Popover>
          <Select label="Transition" value={transition as 'none'} onChange={(v) => model.setMeta('transition', v)} options={[{ value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'none', label: 'No transition' }]} />
        </div>
      </fieldset>
    </div>
  )
}

/** Choose the heading and body fonts for the whole deck from all 2000 families. Text with its own font keeps it. */
function DeckFonts({ model, theme, close }: { model: SlidesModel; theme: Theme; close: () => void }) {
  const [which, setWhich] = useState<'head' | 'body'>('head')
  const cur = which === 'head' ? model.headFont : model.bodyFont
  const base = themeById(model.theme)
  return (
    <div className="deck-fonts">
      <div className="seg mini" role="tablist" aria-label="Which text">
        <button role="tab" aria-selected={which === 'head'} className={which === 'head' ? 'on' : ''} onClick={() => setWhich('head')}>Headings · {theme.head}</button>
        <button role="tab" aria-selected={which === 'body'} className={which === 'body' ? 'on' : ''} onClick={() => setWhich('body')}>Body · {theme.body}</button>
      </div>
      <FontPicker value={(which === 'head' ? theme.head : theme.body)} resetLabel={`Back to the theme's ${which === 'head' ? 'heading' : 'body'} font (${which === 'head' ? base.head : base.body})`}
        onReset={cur ? () => model.setDeckFont(which, null) : undefined}
        onPick={(f) => { loadFont(f); model.setDeckFont(which, f === (which === 'head' ? base.head : base.body) ? null : f) }} />
    </div>
  )
}
