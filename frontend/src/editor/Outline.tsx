import type { Editor } from '@tiptap/react'
import { ListTree } from 'lucide-react'
import { EmojiText } from '../ui/EmojiText'

export interface Heading { pos: number; level: number; text: string }

export function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      let text = ''
      node.descendants((n) => { if (n.isText) text += n.text; else if (n.type.name === 'emoji') text += n.attrs.char; else if (n.type.name === 'hardBreak') text += ' '; return true })
      if (text.trim()) out.push({ pos, level: node.attrs.level, text })
    }
    return true
  })
  return out
}

export function Outline({ editor, heading = 'Document tabs' }: { editor: Editor; heading?: string }) {
  const headings = collectHeadings(editor)
  const sel = editor.state.selection.from
  let active = -1
  headings.forEach((h, i) => { if (h.pos <= sel) active = i })
  const minLevel = Math.min(6, ...headings.map((h) => h.level))

  const go = (h: Heading) => {
    editor.chain().focus().setTextSelection(h.pos + 1).run()
    const el = editor.view.nodeDOM(h.pos) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="side-body">
      <div className="side-title"><ListTree size={18} /><h3>{heading}</h3></div>
      {headings.length === 0 ? (
        <p className="side-empty">Headings you add will appear here so you can jump around the document.</p>
      ) : (
        <nav className="outline">
          {headings.map((h, i) => (
            <button key={h.pos} className={`ol-item ${i === active ? 'on' : ''}`}
              style={{ paddingLeft: 12 + (h.level - minLevel) * 14 }} onClick={() => go(h)} title={h.text}>
              <span className={`ol-dot l${h.level}`} />
              <span className={`ol-text l${h.level}`}><EmojiText text={h.text} /></span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
