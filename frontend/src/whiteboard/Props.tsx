import { AlignCenter, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, AlignCenterHorizontal, AlignCenterVertical, ArrowDown, ArrowUp, Bold, BringToFront, Copy, Group, Italic, Lock, LockOpen, SendToBack, Trash2, Ungroup } from 'lucide-react'
import { ColorPicker } from '../editor/ColorPicker'
import { FontPicker } from '../editor/FontPicker'
import { Popover } from '../ui/Popover'
import { loadFont } from '../fonts'
import { FILLS, PALETTE, holdsText, isLinear, isShape, type El, type FillStyle, type Head, type Style, type Tool } from './types'

type Patch = Partial<Style> & { bold?: boolean; italic?: boolean }

function Colors({ value, list, onPick, label, none }: { value: string; list: string[]; onPick: (c: string) => void; label: string; none?: boolean }) {
  return (
    <div className="wb-colors" role="group" aria-label={label}>
      {list.map((c) => <button key={c} type="button" className={`wb-sw ${value.toLowerCase() === c ? 'on' : ''} ${c === 'transparent' ? 'none' : ''}`} style={c === 'transparent' ? undefined : { background: c }} aria-label={c === 'transparent' ? 'No fill' : c} title={c === 'transparent' ? 'No fill' : c} onClick={() => onPick(c)} />)}
      <Popover align="start" trigger={({ toggle }) => <button type="button" className={`wb-sw more ${!list.includes(value.toLowerCase()) && value !== 'transparent' ? 'on' : ''}`} style={!list.includes(value.toLowerCase()) && value !== 'transparent' ? { background: value } : undefined} aria-label={`More ${label} colours`} title="More colours" onClick={toggle}>+</button>}>
        {(close) => <ColorPicker noneLabel={none ? 'No fill' : 'Black'} value={value === 'transparent' ? null : value} onPick={(c) => { close(); onPick(c ?? (none ? 'transparent' : '#1e1e2e')) }} />}
      </Popover>
    </div>
  )
}
function Seg<T extends string | number>({ value, items, onPick, label }: { value: T; items: { v: T; t: React.ReactNode; title: string }[]; onPick: (v: T) => void; label: string }) {
  return <div className="wb-seg" role="radiogroup" aria-label={label}>{items.map((i) => <button key={String(i.v)} type="button" role="radio" aria-checked={value === i.v} title={i.title} aria-label={i.title} className={value === i.v ? 'on' : ''} onClick={() => onPick(i.v)}>{i.t}</button>)}</div>
}
const Row = ({ t, children }: { t: string; children: React.ReactNode }) => <div className="wb-prop"><label>{t}</label>{children}</div>

/** The look of what is selected, or of what you draw next when nothing is selected. */
export function Props({ tool, selected, style, apply, act, readOnly }: {
  tool: Tool; selected: El[]; style: Style; apply: (p: Patch) => void; readOnly: boolean
  act: { align: (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'dh' | 'dv') => void; front: () => void; back: () => void; forward: () => void; backward: () => void; duplicate: () => void; remove: () => void; lock: () => void; group: () => void; ungroup: () => void }
}) {
  const first = selected[0]
  const types = selected.length ? selected.map((e) => e.type) : [tool === 'highlight' ? 'draw' : tool === 'select' || tool === 'hand' || tool === 'lasso' || tool === 'eraser' || tool === 'bucket' || tool === 'image' ? 'rect' : tool]
  const any = (f: (t: string) => boolean) => types.some((t) => f(t))
  const v: Style & { bold: boolean; italic: boolean } = first
    ? { stroke: first.stroke, fill: first.fill, fs: first.fs, sw: first.sw, ss: first.ss, ro: first.ro, op: first.op, rad: first.rad, font: first.font ?? style.font, size: first.size ?? style.size, ta: first.ta ?? style.ta, tc: first.tc ?? first.stroke, hs: first.hs ?? 'none', he: first.he ?? 'arrow', curve: first.curve ?? 'straight', bold: !!first.bold, italic: !!first.italic }
    : { ...style, bold: false, italic: false }
  if (readOnly || (tool === 'hand' && !selected.length) || (tool === 'image' && !selected.length) || (tool === 'eraser' && !selected.length)) return null
  const onlyImage = types.every((t) => t === 'image' || t === 'embed')
  const hasStroke = any((t) => t !== 'text' && t !== 'image' && t !== 'embed' && t !== 'frame')
  const hasFill = any((t) => isShape(t as never) || t === 'draw')
  const hasText = any((t) => holdsText(t as never)) && !any((t) => t === 'embed')
  const linear = any((t) => t === 'line' || t === 'arrow')
  const arrow = any((t) => t === 'arrow')
  const pad = tool === 'bucket' && !selected.length
  const FS: { v: FillStyle; t: string; title: string }[] = [{ v: 'hachure', t: '///', title: 'Hatched' }, { v: 'cross-hatch', t: '###', title: 'Cross-hatched' }, { v: 'solid', t: '■', title: 'Solid' }, { v: 'zigzag', t: 'ΛΛ', title: 'Zigzag' }, { v: 'dots', t: '···', title: 'Dots' }]
  const HEADS: { v: Head; t: string; title: string }[] = [{ v: 'none', t: '—', title: 'No head' }, { v: 'arrow', t: '→', title: 'Arrow' }, { v: 'triangle', t: '▶', title: 'Triangle' }, { v: 'dot', t: '●', title: 'Dot' }, { v: 'bar', t: '|', title: 'Bar' }, { v: 'diamond', t: '◆', title: 'Diamond' }]
  return (
    <aside className="wb-props" aria-label="Style">
      {pad && <p className="wb-hint">Click a shape to fill it with this colour, or the board to colour the background.</p>}
      {hasStroke && !pad && <Row t="Stroke"><Colors label="stroke" value={v.stroke} list={PALETTE} onPick={(c) => apply({ stroke: c })} /></Row>}
      {(hasFill || pad) && <Row t={pad ? 'Fill colour' : 'Background'}><Colors label="fill" value={v.fill} list={FILLS} none={!pad} onPick={(c) => apply({ fill: c })} /></Row>}
      {hasFill && !pad && v.fill !== 'transparent' && <Row t="Fill style"><Seg label="Fill style" value={v.fs} items={FS} onPick={(fs) => apply({ fs })} /></Row>}
      {hasStroke && !pad && <Row t="Stroke width"><Seg label="Stroke width" value={v.sw} items={[{ v: 1, t: <i className="wb-w w1" />, title: 'Thin' }, { v: 2, t: <i className="wb-w w2" />, title: 'Medium' }, { v: 4, t: <i className="wb-w w4" />, title: 'Bold' }, { v: 7, t: <i className="wb-w w7" />, title: 'Extra bold' }]} onPick={(sw) => apply({ sw })} /></Row>}
      {hasStroke && !pad && !any((t) => t === 'draw') && <Row t="Stroke style"><Seg label="Stroke style" value={v.ss} items={[{ v: 'solid', t: '——', title: 'Solid' }, { v: 'dashed', t: '- -', title: 'Dashed' }, { v: 'dotted', t: '···', title: 'Dotted' }]} onPick={(ss) => apply({ ss })} /></Row>}
      {hasStroke && !pad && !any((t) => t === 'draw') && <Row t="Sloppiness"><Seg label="Sloppiness" value={v.ro} items={[{ v: 0, t: 'Clean', title: 'Clean lines' }, { v: 1, t: 'Sketch', title: 'Hand-drawn' }, { v: 2, t: 'Messy', title: 'Very hand-drawn' }]} onPick={(ro) => apply({ ro })} /></Row>}
      {any((t) => t === 'rect') && !pad && <Row t="Corners"><Seg label="Corners" value={v.rad >= 999 ? 999 : v.rad > 0 ? 18 : 0} items={[{ v: 0, t: '▢', title: 'Square corners' }, { v: 18, t: '▭', title: 'Rounded corners' }, { v: 999, t: '⬭', title: 'Pill' }]} onPick={(rad) => apply({ rad })} /></Row>}
      {linear && !pad && <Row t="Path"><Seg label="Path" value={v.curve} items={[{ v: 'straight', t: '╱', title: 'Straight' }, { v: 'curved', t: '⌒', title: 'Curved' }, { v: 'elbow', t: '┐', title: 'Elbow (square corners)' }]} onPick={(curve) => apply({ curve })} /></Row>}
      {arrow && !pad && <Row t="Start"><Seg label="Start of the arrow" value={v.hs} items={HEADS} onPick={(hs) => apply({ hs })} /></Row>}
      {arrow && !pad && <Row t="End"><Seg label="End of the arrow" value={v.he} items={HEADS} onPick={(he) => apply({ he })} /></Row>}
      {hasText && !pad && (
        <>
          <Row t="Font">
            <Popover align="start" trigger={({ toggle }) => <button type="button" className="wb-font" style={{ fontFamily: `"${v.font}", cursive` }} onClick={toggle}>{v.font}</button>}>
              {(close) => <FontPicker value={v.font} onPick={(f) => { close(); loadFont(f); apply({ font: f }) }} />}
            </Popover>
          </Row>
          <Row t="Size"><div className="wb-size"><Seg label="Text size" value={v.size} items={[{ v: 16, t: 'S', title: 'Small' }, { v: 24, t: 'M', title: 'Medium' }, { v: 36, t: 'L', title: 'Large' }, { v: 56, t: 'XL', title: 'Extra large' }]} onPick={(size) => apply({ size })} />
            <input type="number" min={6} max={400} value={Math.round(v.size)} aria-label="Font size" onChange={(e) => { const n = Number(e.target.value); if (n >= 6 && n <= 400) apply({ size: n }) }} /></div></Row>
          <Row t="Text"><div className="wb-line">
            <Seg label="Alignment" value={v.ta} items={[{ v: 'left', t: <AlignLeft size={15} />, title: 'Left' }, { v: 'center', t: <AlignCenter size={15} />, title: 'Centre' }, { v: 'right', t: <AlignRight size={15} />, title: 'Right' }]} onPick={(ta) => apply({ ta })} />
            <button type="button" className={`wb-mini ${v.bold ? 'on' : ''}`} title="Bold" aria-label="Bold" aria-pressed={v.bold} onClick={() => apply({ bold: !v.bold })}><Bold size={15} /></button>
            <button type="button" className={`wb-mini ${v.italic ? 'on' : ''}`} title="Italic" aria-label="Italic" aria-pressed={v.italic} onClick={() => apply({ italic: !v.italic })}><Italic size={15} /></button></div></Row>
          <Row t="Text colour"><Colors label="text" value={v.tc} list={PALETTE} onPick={(c) => apply({ tc: c })} /></Row>
        </>
      )}
      {!pad && !onlyImage && <Row t={`Opacity ${v.op}%`}><input className="wb-range" type="range" min={5} max={100} step={5} value={v.op} aria-label="Opacity" onChange={(e) => apply({ op: Number(e.target.value) })} /></Row>}
      {onlyImage && !pad && <Row t={`Opacity ${v.op}%`}><input className="wb-range" type="range" min={5} max={100} step={5} value={v.op} aria-label="Opacity" onChange={(e) => apply({ op: Number(e.target.value) })} /></Row>}
      {selected.length > 1 && (
        <Row t="Align"><div className="wb-line">
          <button type="button" className="wb-mini" title="Align left" aria-label="Align left" onClick={() => act.align('left')}><AlignStartVertical size={15} /></button>
          <button type="button" className="wb-mini" title="Align centres" aria-label="Align centres" onClick={() => act.align('center')}><AlignCenterVertical size={15} /></button>
          <button type="button" className="wb-mini" title="Align right" aria-label="Align right" onClick={() => act.align('right')}><AlignEndVertical size={15} /></button>
          <button type="button" className="wb-mini" title="Align top" aria-label="Align top" onClick={() => act.align('top')}><AlignStartHorizontal size={15} /></button>
          <button type="button" className="wb-mini" title="Align middles" aria-label="Align middles" onClick={() => act.align('middle')}><AlignCenterHorizontal size={15} /></button>
          <button type="button" className="wb-mini" title="Align bottom" aria-label="Align bottom" onClick={() => act.align('bottom')}><AlignEndHorizontal size={15} /></button>
          {selected.length > 2 && <><button type="button" className="wb-mini" title="Space evenly across" aria-label="Distribute horizontally" onClick={() => act.align('dh')}><AlignHorizontalSpaceAround size={15} /></button>
          <button type="button" className="wb-mini" title="Space evenly down" aria-label="Distribute vertically" onClick={() => act.align('dv')}><AlignVerticalSpaceAround size={15} /></button></>}
        </div></Row>
      )}
      {selected.length > 0 && (
        <>
          <Row t="Layers"><div className="wb-line">
            <button type="button" className="wb-mini" title="Send to back (Ctrl/Cmd+Shift+[)" aria-label="Send to back" onClick={act.back}><SendToBack size={15} /></button>
            <button type="button" className="wb-mini" title="Send backward (Ctrl/Cmd+[)" aria-label="Send backward" onClick={act.backward}><ArrowDown size={15} /></button>
            <button type="button" className="wb-mini" title="Bring forward (Ctrl/Cmd+])" aria-label="Bring forward" onClick={act.forward}><ArrowUp size={15} /></button>
            <button type="button" className="wb-mini" title="Bring to front (Ctrl/Cmd+Shift+])" aria-label="Bring to front" onClick={act.front}><BringToFront size={15} /></button></div></Row>
          <Row t="Actions"><div className="wb-line">
            <button type="button" className="wb-mini" title="Duplicate (Ctrl/Cmd+D)" aria-label="Duplicate" onClick={act.duplicate}><Copy size={15} /></button>
            {selected.length > 1 && !selected.every((e) => e.grp && e.grp === selected[0].grp) && <button type="button" className="wb-mini" title="Group (Ctrl/Cmd+G)" aria-label="Group" onClick={act.group}><Group size={15} /></button>}
            {selected.some((e) => e.grp) && <button type="button" className="wb-mini" title="Ungroup (Ctrl/Cmd+Shift+G)" aria-label="Ungroup" onClick={act.ungroup}><Ungroup size={15} /></button>}
            <button type="button" className={`wb-mini ${selected.every((e) => e.lock) ? 'on' : ''}`} title={selected.every((e) => e.lock) ? 'Unlock' : "Lock (it can't be moved or changed until unlocked)"} aria-label="Lock" onClick={act.lock}>{selected.every((e) => e.lock) ? <Lock size={15} /> : <LockOpen size={15} />}</button>
            <button type="button" className="wb-mini danger" title="Delete (Del)" aria-label="Delete" onClick={act.remove}><Trash2 size={15} /></button></div></Row>
        </>
      )}
    </aside>
  )
}
void isLinear
