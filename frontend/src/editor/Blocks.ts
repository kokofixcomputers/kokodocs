import { Node, mergeAttributes } from '@tiptap/core'
import HorizontalRule from '@tiptap/extension-horizontal-rule'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customBlocks: {
      insertToggle: () => ReturnType
      insertColumns: (n?: number) => ReturnType
      insertPullQuote: () => ReturnType
      insertToc: () => ReturnType
      insertDivider: (variant?: DividerVariant) => ReturnType
    }
  }
}

export const DIVIDERS = [['line', 'Line'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['thick', 'Thick'], ['dots', 'Three dots'], ['stars', 'Stars'], ['fade', 'Fading']] as const
export type DividerVariant = (typeof DIVIDERS)[number][0]

/** The horizontal rule, with a look to choose (the plain line stays the default, so older documents are unchanged). */
export const Divider = HorizontalRule.extend({
  addAttributes() {
    return { variant: { default: 'line', parseHTML: (el) => el.getAttribute('data-variant') || 'line', renderHTML: (a) => (a.variant && a.variant !== 'line' ? { 'data-variant': a.variant } : {}) } }
  },
  addCommands() {
    return { ...this.parent?.(), insertDivider: (variant: DividerVariant = 'line') => ({ commands }: { commands: any }) => commands.insertContent({ type: 'horizontalRule', attrs: { variant } }) } as never
  },
})

/** Notion-style toggle: a summary line with a triangle that folds the blocks under it. */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-toggle-summary]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'kd-toggle-summary', 'data-toggle-summary': '' }, HTMLAttributes), 0] },
})

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary block+',
  defining: true,
  addAttributes() { return { open: { default: true, parseHTML: (el) => el.getAttribute('data-open') !== 'false', renderHTML: (a) => ({ 'data-open': a.open ? 'true' : 'false' }) } } },
  parseHTML() { return [{ tag: 'div[data-toggle]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'kd-toggle', 'data-toggle': '' }, HTMLAttributes), 0] },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node
      const dom = document.createElement('div'); dom.className = 'kd-toggle'; dom.setAttribute('data-toggle', ''); dom.dataset.open = String(!!node.attrs.open)
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'kd-toggle-chev'; btn.contentEditable = 'false'; btn.setAttribute('aria-label', 'Fold or unfold')
      btn.setAttribute('aria-expanded', String(!!node.attrs.open))
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', () => {
        const pos = getPos(); if (typeof pos !== 'number') return
        if (editor.isEditable) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, open: !cur.attrs.open }))
        else { const o = dom.dataset.open !== 'true'; dom.dataset.open = String(o); btn.setAttribute('aria-expanded', String(o)) }   // someone who can only read can still fold it, on their own screen
      })
      const content = document.createElement('div'); content.className = 'kd-toggle-content'
      dom.append(btn, content)
      return {
        dom, contentDOM: content,
        update: (n) => { if (n.type !== cur.type) return false; cur = n; dom.dataset.open = String(!!n.attrs.open); btn.setAttribute('aria-expanded', String(!!n.attrs.open)); return true },
      }
    }
  },
  addCommands() {
    return { insertToggle: () => ({ commands }) => commands.insertContent({ type: 'toggle', attrs: { open: true }, content: [{ type: 'toggleSummary' }, { type: 'paragraph' }] }) }
  },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-column]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'column', 'data-column': '' }, HTMLAttributes), 0] },
})

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  isolating: true,
  defining: true,
  parseHTML() { return [{ tag: 'div[data-columns]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes({ class: 'columns', 'data-columns': '', style: `--cols:${node.childCount}` }, HTMLAttributes), 0] },
  addCommands() {
    return { insertColumns: (n = 2) => ({ commands }) => commands.insertContent({ type: 'columns', content: Array.from({ length: Math.max(2, Math.min(4, n)) }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) }) }
  },
})

export const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'blockquote[data-pull]' }] },
  renderHTML({ HTMLAttributes }) { return ['blockquote', mergeAttributes({ class: 'pull-quote', 'data-pull': '' }, HTMLAttributes), 0] },
  addCommands() { return { insertPullQuote: () => ({ commands }) => commands.insertContent({ type: 'pullQuote' }) } },
})

/** A table of contents that follows the headings as you type. */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: 'nav[data-toc]' }] },
  renderHTML({ HTMLAttributes }) { return ['nav', mergeAttributes({ class: 'doc-toc', 'data-toc': '' }, HTMLAttributes), 'Table of contents'] },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('nav'); dom.className = 'doc-toc'; dom.contentEditable = 'false'
      const draw = () => {
        const items: { pos: number; level: number; text: string }[] = []
        editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading' && n.textContent.trim()) items.push({ pos, level: n.attrs.level, text: n.textContent }); return true })
        dom.replaceChildren()
        const h = document.createElement('div'); h.className = 'doc-toc-title'; h.textContent = 'Contents'; dom.appendChild(h)
        if (!items.length) { const e = document.createElement('div'); e.className = 'doc-toc-empty'; e.textContent = 'Headings you add will be listed here.'; dom.appendChild(e); return }
        const min = Math.min(...items.map((i) => i.level))
        for (const it of items) {
          const a = document.createElement('a'); a.href = '#'; a.textContent = it.text; a.style.paddingLeft = `${(it.level - min) * 16}px`
          a.addEventListener('click', (e) => {
            e.preventDefault()
            const el = editor.view.nodeDOM(it.pos) as HTMLElement | null
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
          dom.appendChild(a)
        }
      }
      let t: number | undefined
      const later = () => { window.clearTimeout(t); t = window.setTimeout(draw, 250) }
      editor.on('update', later); draw()
      return { dom, stopEvent: () => false, ignoreMutation: () => true, destroy: () => { window.clearTimeout(t); editor.off('update', later) } }
    }
  },
  addCommands() { return { insertToc: () => ({ commands }) => commands.insertContent({ type: 'tableOfContents' }) } },
})

export const customBlocks = () => [Divider, Toggle, ToggleSummary, Columns, Column, PullQuote, TableOfContents]
