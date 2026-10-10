import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Redo2, Undo2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { yUndoPluginKey } from 'y-prosemirror'

interface Said { kind: 'undo' | 'redo'; n: number; key: number }

/** "Undid 5 changes": pressing undo (or redo) several times in a row counts up in one little message that fades a moment after you stop. */
export function useUndoIndicator(editor: Editor | null): Said | null {
  const [said, setSaid] = useState<Said | null>(null)
  useEffect(() => {
    const um = editor ? yUndoPluginKey.getState(editor.state)?.undoManager : null
    if (!um) return
    let last: Said | null = null, at = 0, timer = 0
    const on = (e: { type: 'undo' | 'redo' }) => {
      const now = Date.now()
      last = { kind: e.type, n: last && last.kind === e.type && now - at < 1600 ? last.n + 1 : 1, key: now }
      at = now
      setSaid(last)
      window.clearTimeout(timer); timer = window.setTimeout(() => setSaid(null), 1700)
    }
    um.on('stack-item-popped', on)
    return () => { um.off('stack-item-popped', on); window.clearTimeout(timer) }
  }, [editor])
  return said
}

export function UndoPill({ said }: { said: Said | null }) {
  if (!said) return null
  const word = said.kind === 'undo' ? 'Undid' : 'Redid'
  return createPortal(
    <div className="undo-pill" role="status" aria-live="polite">
      {said.kind === 'undo' ? <Undo2 size={15} /> : <Redo2 size={15} />}<span>{word} {said.n} {said.n === 1 ? 'change' : 'changes'}</span>
    </div>, document.body)
}
