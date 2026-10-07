import { useMemo } from 'react'
import { DOMSerializer } from '@tiptap/pm/model'
import { Shapes } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { Popover } from '../ui/Popover'
import { DEFAULT_SHAPE, SHAPE_KINDS, shapeSpec, type ShapeKind } from './shapes'

/** The drawing of a shape as markup, for pickers and previews. */
export function shapeMarkup(kind: ShapeKind, box = 44): string {
  const line = kind === 'line'
  const w = line ? box : box, h = line ? 12 : Math.round(box * 0.7)
  const el = DOMSerializer.renderSpec(document, shapeSpec({ shape: kind, w, h, fill: line ? 'none' : '#e0e7ff', stroke: '#6366f1', sw: 2 }) as never).dom as Element
  return el.outerHTML
}

function Grid({ onPick }: { onPick: (k: ShapeKind) => void }) {
  const html = useMemo(() => Object.fromEntries(SHAPE_KINDS.map((s) => [s.id, shapeMarkup(s.id)])), [])
  return (
    <div className="shape-grid" role="menu" aria-label="Shapes">
      {SHAPE_KINDS.map((s) => (
        <button key={s.id} type="button" role="menuitem" data-tip={`${s.name}|add it at the cursor, then drag the corner to resize`} aria-label={s.name} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(s.id)}>
          <span dangerouslySetInnerHTML={{ __html: html[s.id] }} />
        </button>))}
    </div>
  )
}

export function ShapeButton({ editor }: { editor: Editor }) {
  return (
    <Popover className="pop-shapes" trigger={({ toggle }) => (
      <button type="button" className="tb-btn" title="Insert shape" aria-label="Insert shape" onMouseDown={(e) => e.preventDefault()} onClick={toggle}><Shapes size={17} /></button>)}>
      {(close) => <Grid onPick={(k) => { close(); editor.chain().focus().insertShape(k === 'line' ? { shape: k, w: 200, h: 24, fill: 'none', sw: 3 } : { shape: k }).run() }} />}
    </Popover>
  )
}
export { DEFAULT_SHAPE }
