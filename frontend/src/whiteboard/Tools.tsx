import { useState } from 'react'
import { ArrowUpRight, Cloud, Cylinder, Diamond, Eraser, FileText, Frame, Hand, Hexagon, Highlighter, Image as ImageIcon, Lasso, Minus, MousePointer2, PaintBucket, Pencil, Redo2, Shapes, Square, Star, Triangle, Type, Undo2, WandSparkles, Circle, Workflow } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { SHAPES, type ShapeKind, type Tool } from './types'
import { TEMPLATES, type FlowSpec } from './flowchart'

const SHAPE_ICON: Record<ShapeKind, React.ReactNode> = {
  rect: <Square size={17} />, ellipse: <Circle size={17} />, diamond: <Diamond size={17} />, triangle: <Triangle size={17} />, parallelogram: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M7 5h14l-4 14H3z" /></svg>,
  hexagon: <Hexagon size={17} />, cylinder: <Cylinder size={17} />, star: <Star size={17} />, cloud: <Cloud size={17} />, document: <FileText size={17} />,
}
export const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', q: 'lasso', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'draw', t: 'text', e: 'eraser', b: 'bucket', f: 'frame', i: 'image', m: 'highlight' }

const ITEMS: { tool: Tool; icon: React.ReactNode; label: string; key?: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={17} />, label: 'Select', key: 'V' },
  { tool: 'hand', icon: <Hand size={17} />, label: 'Hand: move around the board (or hold Space)', key: 'H' },
  { tool: 'lasso', icon: <Lasso size={17} />, label: 'Lasso: draw around things to select them', key: 'Q' },
]
const AFTER: typeof ITEMS = [
  { tool: 'line', icon: <Minus size={17} />, label: 'Line', key: 'L' },
  { tool: 'arrow', icon: <ArrowUpRight size={17} />, label: 'Arrow: joins shapes and follows them when they move', key: 'A' },
  { tool: 'draw', icon: <Pencil size={17} />, label: 'Pen', key: 'P' },
  { tool: 'highlight', icon: <Highlighter size={17} />, label: 'Highlighter', key: 'M' },
  { tool: 'text', icon: <Type size={17} />, label: 'Text', key: 'T' },
  { tool: 'image', icon: <ImageIcon size={17} />, label: 'Image', key: 'I' },
  { tool: 'frame', icon: <Frame size={17} />, label: 'Frame: a titled box to group things', key: 'F' },
  { tool: 'aiframe', icon: <WandSparkles size={17} />, label: 'AI frame: box a sketch and Koko turns it into a working website' },
  { tool: 'bucket', icon: <PaintBucket size={17} />, label: 'Bucket: fill a shape with the fill colour (click the board itself to colour the background)', key: 'B' },
  { tool: 'eraser', icon: <Eraser size={17} />, label: 'Eraser', key: 'E' },
]

export function Tools({ tool, setTool, readOnly, canUndo, canRedo, undo, redo, shape, setShape, onTemplate }: {
  tool: Tool; setTool: (t: Tool) => void; readOnly: boolean; canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; shape: ShapeKind; setShape: (s: ShapeKind) => void; onTemplate: (s: FlowSpec) => void
}) {
  const [tpl, setTpl] = useState(false)
  const btn = (t: { tool: Tool; icon: React.ReactNode; label: string; key?: string }) => (
    <button key={t.tool} type="button" className={`wb-tool ${tool === t.tool ? 'on' : ''}`} title={t.label + (t.key ? ` (${t.key})` : '')} aria-label={t.label} aria-pressed={tool === t.tool} disabled={readOnly && t.tool !== 'select' && t.tool !== 'hand'} onClick={() => setTool(t.tool)}>{t.icon}</button>
  )
  const [open, setOpen] = useState(false)
  const shapeOn = SHAPES.some((s) => s.kind === tool)
  return (
    <div className="wb-tools" role="toolbar" aria-label="Whiteboard tools">
      {!readOnly && <><button type="button" className="wb-tool" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 size={17} /></button><button type="button" className="wb-tool" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 size={17} /></button><i className="wb-sep" /></>}
      {ITEMS.map(btn)}
      <i className="wb-sep" />
      <button type="button" className={`wb-tool ${shapeOn ? 'on' : ''}`} title={`${SHAPES.find((s) => s.kind === shape)?.label ?? 'Shape'} (R)`} aria-label="Shape" disabled={readOnly} onClick={() => setTool(shape)}>{SHAPE_ICON[shape]}</button>
      <Popover align="start" onOpenChange={setOpen} trigger={({ toggle }) => <button type="button" className={`wb-tool more ${open ? 'on' : ''}`} title="More shapes" aria-label="More shapes" disabled={readOnly} onClick={toggle}><Shapes size={15} /></button>}>
        {(close) => (
          <div className="wb-shape-pop">{SHAPES.map((s) => <button key={s.kind} type="button" className={shape === s.kind ? 'on' : ''} onClick={() => { setShape(s.kind); setTool(s.kind); close() }}>{SHAPE_ICON[s.kind]}<span>{s.label}</span></button>)}</div>
        )}
      </Popover>
      {AFTER.map(btn)}
      <i className="wb-sep" />
      <Popover align="end" onOpenChange={setTpl} trigger={({ toggle }) => <button type="button" className={`wb-tool ${tpl ? 'on' : ''}`} title="Diagrams: start from a flowchart, org chart or system diagram" aria-label="Diagrams" disabled={readOnly} onClick={toggle}><Workflow size={17} /></button>}>
        {(close) => <div className="wb-shape-pop one">{TEMPLATES.map((t) => <button key={t.name} type="button" onClick={() => { close(); onTemplate(t.spec) }}><Workflow size={15} /><span>{t.name}</span></button>)}</div>}
      </Popover>
    </div>
  )
}
