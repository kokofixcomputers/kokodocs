import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, X } from 'lucide-react'
import { toast } from '../ui/Toast'
import { clearFind, findState, replaceAll, replaceCurrent, seekFromCursor, setFind, stepFind } from './FindReplace'

export function FindBar({ editor, withReplace, onClose }: { editor: Editor; withReplace: boolean; onClose: () => void }) {
  const [q, setQ] = useState(() => { const { from, to, empty } = editor.state.selection; return empty || to - from > 120 ? '' : editor.state.doc.textBetween(from, to, ' ') })
  const [r, setR] = useState('')
  const [cs, setCs] = useState(false)
  const [showReplace, setShowReplace] = useState(withReplace)
  const [, tick] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const canEdit = editor.isEditable

  useEffect(() => { const t = () => tick((n) => n + 1); editor.on('transaction', t); return () => { editor.off('transaction', t) } }, [editor])
  useEffect(() => { setFind(editor, q, cs); if (q) seekFromCursor(editor) }, [q, cs, editor])
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => () => { if (!editor.isDestroyed) clearFind(editor) }, [editor])
  useEffect(() => { if (withReplace) setShowReplace(true) }, [withReplace])

  const s = findState(editor)
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus() }
    else if (e.key === 'Enter') { e.preventDefault(); stepFind(editor, e.shiftKey ? -1 : 1) }
  }
  return (
    <div className="find-bar" role="search" onKeyDown={(e) => e.key === 'Escape' && (onClose(), editor.commands.focus())}>
      <button className={`icon-btn sm fb-toggle ${showReplace ? 'open' : ''}`} aria-label="Toggle replace" title="Replace" disabled={!canEdit} onClick={() => setShowReplace((v) => !v)}><ChevronRight size={16} /></button>
      <div className="fb-rows">
        <div className="fb-row">
          <label className="field fb-field"><input ref={input} value={q} placeholder="Find" onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} /></label>
          <span className="fb-count">{q ? (s.hits.length ? `${s.cur + 1} of ${s.hits.length}` : 'No results') : ''}</span>
          <button className={`icon-btn sm ${cs ? 'active' : ''}`} aria-label="Match case" title="Match case" onClick={() => setCs((v) => !v)}><CaseSensitive size={17} /></button>
          <button className="icon-btn sm" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={!s.hits.length} onClick={() => stepFind(editor, -1)}><ArrowUp size={16} /></button>
          <button className="icon-btn sm" aria-label="Next match" title="Next (Enter)" disabled={!s.hits.length} onClick={() => stepFind(editor, 1)}><ArrowDown size={16} /></button>
          <button className="icon-btn sm" aria-label="Close find" title="Close (Esc)" onClick={() => { onClose(); editor.commands.focus() }}><X size={16} /></button>
        </div>
        {showReplace && canEdit && (
          <div className="fb-row">
            <label className="field fb-field"><input value={r} placeholder="Replace with" onChange={(e) => setR(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(editor, r) } else key(e) }} spellCheck={false} /></label>
            <button className="btn btn-pill btn-soft btn-sm" disabled={!s.hits.length} onClick={() => replaceCurrent(editor, r)}>Replace</button>
            <button className="btn btn-pill btn-soft btn-sm" disabled={!s.hits.length} onClick={() => { const n = replaceAll(editor, r); toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`) }}>All</button>
          </div>
        )}
      </div>
    </div>
  )
}
