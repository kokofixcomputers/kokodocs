import { Extension, mergeAttributes, type Editor } from '@tiptap/core'
import Heading from '@tiptap/extension-heading'
import LinkExt from '@tiptap/extension-link'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { collectHeadings, type Heading as H } from './Outline'
import { EmojiText } from '../ui/EmojiText'

/** A heading that can be linked to: it carries a short, permanent `anchor` (written into the document the first time something links to it), so a
 *  link keeps working when the heading is renamed or moved. It is the element's `id`, so `#h-ab12cd` also works in exports and printouts. */
export const AnchorHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      anchor: { default: null, parseHTML: (el) => { const id = el.getAttribute('id'); return id && /^h-[a-z0-9]{4,}$/.test(id) ? id : null }, renderHTML: (a) => (a.anchor ? { id: a.anchor } : {}) },
    }
  },
})

/** Links that jump inside the document (`#h-ab12cd`) open in the same page, not a new tab. */
export const DocLink = LinkExt.extend({
  renderHTML(props) {
    const r = this.parent?.(props) as [string, Record<string, unknown>, number]
    if (String(props.HTMLAttributes.href ?? '').startsWith('#')) { delete r[1].target; delete r[1].rel }
    return r
  },
})
void mergeAttributes

export const isInternal = (href: string | null | undefined) => !!href && /^#h-[a-z0-9]+$/.test(href)

export function findHeading(editor: Editor, anchor: string): { pos: number; text: string } | null {
  let found: { pos: number; text: string } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'heading' && node.attrs.anchor === anchor) { found = { pos, text: node.textContent }; return false }
    return true
  })
  return found
}

/** The anchor of the heading at `pos`, adding one if it has none yet. */
export function ensureAnchor(editor: Editor, pos: number): string {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'heading') throw new Error('That heading is gone')
  if (node.attrs.anchor) return node.attrs.anchor as string
  const id = 'h-' + Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, anchor: id }))
  return id
}

/** Scroll to the heading, with a brief highlight. In an editable document the cursor goes there too. */
export function jumpTo(editor: Editor, anchor: string): boolean {
  const h = findHeading(editor, anchor)
  if (!h) return false
  const el = editor.view.nodeDOM(h.pos) as HTMLElement | null
  if (editor.isEditable) editor.chain().focus().setTextSelection(h.pos + 1).run()
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.animate?.([{ background: 'rgba(250, 204, 21, .55)' }, { background: 'rgba(250, 204, 21, 0)' }], { duration: 1800, easing: 'ease-out' })   // (not a class: the editor redraws headings and would wipe it)
  return true
}

/** Clicking an internal link jumps to its heading when you cannot edit (or hold Ctrl or ⌘ while editing; a plain click in an editable
 *  document shows the link's little menu instead, like every other link). */
export const HeadingLinks = Extension.create({
  name: 'headingLinks',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: new PluginKey('headingLinks'),
      props: {
        handleDOMEvents: {
          click: (_v, e) => {
            const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#h-"]') as HTMLAnchorElement | null
            if (!a) return false
            e.preventDefault()   // never let the browser change the address for these
            if (!editor.isEditable || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) { jumpTo(editor, a.getAttribute('href')!.slice(1)); return true }
            return false
          },
        },
      },
    })]
  },
})

/** The headings of the document, to choose one to link to. */
export function HeadingPicker({ editor, onPick, current }: { editor: Editor; onPick: (anchor: string, h: H) => void; current?: string | null }) {
  const list = collectHeadings(editor)
  const min = Math.min(6, ...list.map((h) => h.level))
  if (!list.length) return <p className="hp-empty">Add a heading to the document and you can link to it here.</p>
  return (
    <div className="heading-pick" role="listbox" aria-label="Headings in this document">
      {list.map((h) => {
        const a = (editor.state.doc.nodeAt(h.pos)?.attrs.anchor as string | null) ?? null
        return (
          <button key={h.pos} type="button" role="option" aria-selected={!!current && a === current} className={current && a === current ? 'on' : ''} style={{ paddingLeft: 10 + (h.level - min) * 14 }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { try { onPick(ensureAnchor(editor, h.pos), h) } catch { /* the heading was removed meanwhile */ } }} title={h.text}>
            <span className={`ol-dot l${h.level}`} /><span className="hp-text"><EmojiText text={h.text} /></span>
          </button>)
      })}
    </div>
  )
}
