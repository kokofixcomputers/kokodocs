import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Minus, Plus } from 'lucide-react'

const HEADING_SIZE: Record<number, number> = { 1: 26, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 }

/** Phones: a floating text-size pill that rides above the on-screen keyboard while you are typing. */
export function SizePill({ editor }: { editor: Editor }) {
  const [, tick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [bottom, setBottom] = useState(0)
  useEffect(() => {
    const t = () => tick((n) => n + 1)
    const dom = editor.view.dom
    const f = () => setFocused(true)
    const b = () => setTimeout(() => setFocused(document.activeElement === dom || dom.contains(document.activeElement)), 150)
    document.addEventListener('selectionchange', t)
    editor.on('transaction', t); dom.addEventListener('focusin', f); dom.addEventListener('focusout', b)
    setFocused(document.activeElement === dom || dom.contains(document.activeElement))
    return () => { document.removeEventListener('selectionchange', t); editor.off('transaction', t); dom.removeEventListener('focusin', f); dom.removeEventListener('focusout', b) }
  }, [editor])
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const f = () => { const kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)); setBottom(kb); document.documentElement.style.setProperty('--kb', `${kb}px`) }
    f(); vv.addEventListener('resize', f); vv.addEventListener('scroll', f)
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); document.documentElement.style.removeProperty('--kb') }
  }, [])
  const live = focused || editor.view.dom.contains(document.activeElement)
  if (!live || !editor.isEditable) return null
  const ts = editor.getAttributes('textStyle')
  const lvl = (editor.getAttributes('heading').level as number | undefined) ?? 0
  const size: number = ts.fontSize ?? (lvl ? HEADING_SIZE[lvl] : 11)
  const set = (n: number) => editor.chain().focus().setFontSize(Math.max(1, Math.min(400, n))).run()
  const hold = (e: React.SyntheticEvent) => e.preventDefault()
  return createPortal(
    <div className="size-pill" style={{ bottom: bottom + 12 }} role="group" aria-label="Text size">
      <button type="button" aria-label="Smaller text" onPointerDown={hold} onMouseDown={hold} onClick={() => set(size - 1)}><Minus size={18} /></button>
      <b>{size}</b>
      <button type="button" aria-label="Larger text" onPointerDown={hold} onMouseDown={hold} onClick={() => set(size + 1)}><Plus size={18} /></button>
    </div>, document.body)
}
