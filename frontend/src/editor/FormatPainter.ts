import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Mark } from '@tiptap/pm/model'
import { toast } from '../ui/Toast'

interface Captured { marks: readonly Mark[]; type: string; level?: number; align: string | null }

function capture(editor: Editor): Captured {
  const { state } = editor
  const { from, to, $from, empty } = state.selection
  let marks: readonly Mark[] = empty ? (state.storedMarks ?? $from.marks()) : []
  if (!empty) {
    state.doc.nodesBetween(from, to, (n) => {
      if (n.isText && marks.length === 0) { marks = n.marks; return false }
      return true
    })
  }
  const block = $from.parent
  return {
    marks: marks.filter((m) => m.type.name !== 'link'),
    type: block.type.name,
    level: block.attrs.level,
    align: block.attrs.textAlign ?? null,
  }
}

function paint(editor: Editor, c: Captured) {
  const { state, view } = editor
  const { from, to } = state.selection
  if (from === to) return
  const tr = state.tr
  Object.values(state.schema.marks).forEach((mt) => { if (mt.name !== 'link') tr.removeMark(from, to, mt) })
  c.marks.forEach((m) => tr.addMark(from, to, m))
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const type = state.schema.nodes[c.type]
    if (type && (c.type === 'paragraph' || c.type === 'heading')) {
      tr.setNodeMarkup(pos, type, { ...node.attrs, ...(c.type === 'heading' ? { level: c.level } : {}), textAlign: c.align })
    }
    return false
  })
  view.dispatch(tr)
}

/** Format painter: click, then drag over text to copy its formatting. Double-click to keep painting. */
export function useFormatPainter(editor: Editor) {
  const [mode, setMode] = useState<'off' | 'once' | 'sticky'>('off')
  const captured = useRef<Captured | null>(null)
  const startedAt = useRef(0)

  const toggle = useCallback(() => {
    if (mode === 'off') {
      captured.current = capture(editor)
      startedAt.current = Date.now()
      setMode('once')
      toast('Formatting copied. Now select the text to paint.')
    } else if (mode === 'once' && Date.now() - startedAt.current < 400) {
      setMode('sticky')
      toast('Painting is locked on. Press Esc or click the brush to stop.')
    } else setMode('off')
  }, [mode, editor])

  useEffect(() => {
    if (mode === 'off') return
    const dom = editor.view.dom as HTMLElement
    const up = () => setTimeout(() => {
      if (editor.state.selection.empty || !captured.current) return
      paint(editor, captured.current)
      if (mode === 'once') setMode('off')
    }, 0)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMode('off')
    dom.addEventListener('mouseup', up)
    document.addEventListener('keydown', key)
    return () => { dom.removeEventListener('mouseup', up); document.removeEventListener('keydown', key) }
  }, [mode, editor])

  useEffect(() => {
    document.body.classList.toggle('painting', mode !== 'off')
    return () => document.body.classList.remove('painting')
  }, [mode])

  return { active: mode !== 'off', toggle }
}
