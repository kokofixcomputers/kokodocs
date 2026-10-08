import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { wikiTabs: { insertTabs: (titles?: string[]) => ReturnType } }
}

/** One panel of a tabs block: a title and any blocks. */
export const WikiTab = Node.create({
  name: 'wikiTab',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() { return { title: { default: 'Tab', parseHTML: (el) => el.getAttribute('data-title') || 'Tab', renderHTML: (a) => ({ 'data-title': a.title }) } } },
  parseHTML() { return [{ tag: 'div[data-wk-tab]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'wk-tab', 'data-wk-tab': '' }, HTMLAttributes), 0] },
})

const MAX_TABS = 12

/** A row of tabs that shows one panel at a time (for "cURL / JavaScript / Python", "Windows / macOS" and the like).
 *  Which tab is open is just the reader's own view: it is not saved in the page. */
export const WikiTabs = Node.create({
  name: 'wikiTabs',
  group: 'block',
  content: 'wikiTab+',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-wk-tabs]' }] },
  renderHTML() { return ['div', { class: 'wk-tabs-block', 'data-wk-tabs': '' }, 0] },
  addCommands() {
    return {
      // the cursor ends up in the first panel, ready to type
      insertTabs: (titles = ['Tab 1', 'Tab 2']) => ({ chain }) => chain().insertContent({
        type: this.name, content: titles.map((title) => ({ type: 'wikiTab', attrs: { title }, content: [{ type: 'paragraph' }] })),
      }).command(({ tr }) => {
        const $f = tr.selection.$from
        for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === this.name) { tr.setSelection(TextSelection.near(tr.doc.resolve($f.before(d) + 3))); break }
        return true
      }).run(),
    }
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node
      let active = 0
      const dom = document.createElement('div'); dom.className = 'wk-tabs-block'
      const bar = document.createElement('div'); bar.className = 'wk-tabs-bar'; bar.contentEditable = 'false'; bar.setAttribute('role', 'tablist')
      const body = document.createElement('div'); body.className = 'wk-tabs-body'
      dom.append(bar, body)

      const tabPos = (i: number): number | null => {
        const pos = getPos(); if (typeof pos !== 'number') return null
        let p = pos + 1
        for (let k = 0; k < i; k++) p += current.child(k).nodeSize
        return p
      }
      const render = () => {
        bar.querySelector('input')?.blur()   // finish any rename in progress first: removing a focused box mid-rebuild would run its handler in the middle of this one
        if (active >= current.childCount) active = Math.max(0, current.childCount - 1)
        dom.dataset.active = String(active)
        bar.replaceChildren()
        current.forEach((child, _off, i) => {
          const rename = (done?: () => void) => {
            const p = tabPos(i); if (p === null || !editor.isEditable) return
            const input = document.createElement('input')
            input.className = 'wk-tab-input'; input.value = String(child.attrs.title); input.maxLength = 40; input.setAttribute('aria-label', 'Tab name')
            input.style.width = `${Math.max(6, input.value.length + 2)}ch`
            let finished = false
            const finish = (save: boolean) => {
              if (finished) return; finished = true
              const v = input.value.trim().slice(0, 40)
              if (save && v && v !== child.attrs.title) { const pp = tabPos(i); if (pp !== null) editor.view.dispatch(editor.state.tr.setNodeMarkup(pp, undefined, { ...child.attrs, title: v })) } else render()
              done?.()
            }
            input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } })
            input.addEventListener('input', () => { input.style.width = `${Math.max(6, input.value.length + 2)}ch` })
            input.addEventListener('blur', () => finish(true))
            b.replaceChildren(input); input.focus(); input.select()
          }
          const b = document.createElement('button')
          b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === active)); b.className = `wk-tab-btn ${i === active ? 'on' : ''}`
          b.textContent = String(child.attrs.title || `Tab ${i + 1}`)
          if (editor.isEditable && i === active) b.title = 'Click again to rename this tab'
          b.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() })
          b.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') return
            if (i === active && editor.isEditable) { rename(); return }   // clicking the open tab again edits its name in place
            active = i; render()
          })
          b.addEventListener('dblclick', () => { if (editor.isEditable && i !== active) { active = i; render() } })
          bar.appendChild(b)
        })
        if (editor.isEditable) {
          const tools = document.createElement('span'); tools.className = 'wk-tab-tools'
          const add = document.createElement('button'); add.type = 'button'; add.className = 'wk-tab-add'; add.title = 'Add a tab'; add.setAttribute('aria-label', 'Add a tab'); add.textContent = '+'
          add.disabled = current.childCount >= MAX_TABS
          add.addEventListener('mousedown', (e) => e.preventDefault())
          add.addEventListener('click', () => {
            const pos = getPos(); if (typeof pos !== 'number') return
            const end = pos + current.nodeSize - 1, type = editor.schema.nodes.wikiTab
            editor.view.dispatch(editor.state.tr.insert(end, type.create({ title: `Tab ${current.childCount + 1}` }, editor.schema.nodes.paragraph.create())))
            active = current.childCount; render()
          })
          const pen = document.createElement('button'); pen.type = 'button'; pen.className = 'wk-tab-pen'; pen.title = 'Rename this tab'; pen.setAttribute('aria-label', 'Rename this tab'); pen.textContent = '✎'
          pen.addEventListener('mousedown', (e) => e.preventDefault())
          pen.addEventListener('click', () => bar.querySelector<HTMLButtonElement>('.wk-tab-btn.on')?.click())
          tools.append(pen, add)
          if (current.childCount > 1) {
            const del = document.createElement('button'); del.type = 'button'; del.className = 'wk-tab-del'; del.title = 'Remove this tab'; del.setAttribute('aria-label', 'Remove this tab'); del.textContent = '×'
            del.addEventListener('mousedown', (e) => e.preventDefault())
            del.addEventListener('click', () => {
              const p = tabPos(active); if (p === null) return
              editor.view.dispatch(editor.state.tr.delete(p, p + current.child(active).nodeSize))
            })
            tools.appendChild(del)
          }
          bar.appendChild(tools)
        }
      }
      // typing or moving the cursor into a panel opens it
      const follow = () => {
        const pos = getPos(); if (typeof pos !== 'number') return
        const from = editor.state.selection.from
        if (from <= pos || from >= pos + current.nodeSize) return
        let p = pos + 1
        for (let i = 0; i < current.childCount; i++) { const end = p + current.child(i).nodeSize; if (from < end) { if (i !== active) { active = i; render() } return } p = end }
      }
      editor.on('selectionUpdate', follow)
      render()
      return {
        dom, contentDOM: body,
        update(n) { if (n.type !== current.type) return false; current = n; render(); return true },
        stopEvent: (e) => bar.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => bar.contains(m.target) || (m.type === 'attributes' && m.target === dom),
        destroy() { editor.off('selectionUpdate', follow) },
      }
    }
  },
})
