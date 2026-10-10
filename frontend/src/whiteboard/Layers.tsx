import { useRef, useState } from 'react'
import { Eye, EyeOff, FileText, Frame, GripVertical, Image as ImageIcon, Lock, LockOpen, Minus, MonitorPlay, Pencil, Square, Type } from 'lucide-react'
import type { WhiteboardModel } from './model'
import { isShape, type El } from './types'

const icon = (e: El) => (e.type === 'text' ? <Type size={14} /> : e.type === 'image' ? <ImageIcon size={14} /> : e.type === 'draw' ? <Pencil size={14} /> : e.type === 'arrow' || e.type === 'line' ? <Minus size={14} /> : e.type === 'frame' ? <Frame size={14} /> : e.type === 'embed' ? <MonitorPlay size={14} /> : e.type === 'document' ? <FileText size={14} /> : <Square size={14} />)
const label = (e: El) => (e.text?.trim() ? e.text.trim().split('\n')[0].slice(0, 40) : e.name || (e.type === 'draw' ? 'Drawing' : e.type[0].toUpperCase() + e.type.slice(1)))

/** Every element from front to back. Drag a row to change what is in front; the eye hides and the padlock locks. */
export function Layers({ model, els, sel, setSel, readOnly }: { model: WhiteboardModel; els: El[]; sel: string[]; setSel: (ids: string[]) => void; readOnly: boolean }) {
  const list = [...els].reverse()
  const [over, setOver] = useState<number | null>(null)
  const drag = useRef<string | null>(null)
  void isShape
  return (
    <div className="wb-layers" role="list" aria-label="Layers">
      {!list.length && <p className="side-empty">Nothing on the board yet.</p>}
      {list.map((e, i) => (
        <div key={e.id} role="listitem" className={`wb-layer ${sel.includes(e.id) ? 'on' : ''} ${over === i ? 'over' : ''} ${e.hide ? 'off' : ''}`} draggable={!readOnly}
          onDragStart={(ev) => { drag.current = e.id; ev.dataTransfer.effectAllowed = 'move' }} onDragOver={(ev) => { ev.preventDefault(); setOver(i) }} onDragLeave={() => setOver(null)}
          onDrop={(ev) => { ev.preventDefault(); setOver(null); const id = drag.current; drag.current = null; if (id && id !== e.id) model.moveTo(id, els.length - 1 - i) }}
          onClick={(ev) => setSel(ev.shiftKey ? [...new Set([...sel, e.id])] : [e.id])}>
          {!readOnly && <GripVertical size={14} className="wb-grip" />}
          <i style={{ color: e.type === 'text' ? (e.tc ?? e.stroke) : e.stroke }}>{icon(e)}</i>
          <span className="wb-layer-name">{label(e)}</span>
          {!readOnly && <button type="button" className="wb-mini" aria-label={e.hide ? 'Show' : 'Hide'} title={e.hide ? 'Show' : 'Hide'} onClick={(ev) => { ev.stopPropagation(); model.update(e.id, { hide: !e.hide }) }}>{e.hide ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
          {!readOnly && <button type="button" className="wb-mini" aria-label={e.lock ? 'Unlock' : 'Lock'} title={e.lock ? 'Unlock' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); model.update(e.id, { lock: !e.lock }) }}>{e.lock ? <Lock size={14} /> : <LockOpen size={14} />}</button>}
        </div>
      ))}
    </div>
  )
}
