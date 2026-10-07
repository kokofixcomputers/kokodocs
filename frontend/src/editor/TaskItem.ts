import TaskItem from '@tiptap/extension-task-item'
import { Plugin } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

type Progress = 'all' | 'some' | 'none'
/** The items nested directly under a checklist item, with where they sit relative to it. */
function kidsOf(node: PMNode): { node: PMNode; off: number }[] {
  const out: { node: PMNode; off: number }[] = []
  node.forEach((child, off) => { if (child.type.name === 'taskList') child.forEach((it, off2) => { if (it.type.name === 'taskItem') out.push({ node: it, off: 1 + off + 1 + off2 }) }) })
  return out
}
/** How far along an item is: a plain item is done or not; a parent is done when every child is, and "some" when only part of it is. */
export function progress(node: PMNode): Progress {
  const kids = kidsOf(node)
  if (!kids.length) return node.attrs.checked ? 'all' : 'none'
  const st = kids.map((k) => progress(k.node))
  return st.every((x) => x === 'all') ? 'all' : st.some((x) => x !== 'none') ? 'some' : 'none'
}
/** Parents that disagree with their children, so the document can be corrected: a parent is ticked exactly when all of its children are. */
export function parentFixes(doc: PMNode): { pos: number; checked: boolean }[] {
  const out: { pos: number; checked: boolean }[] = []
  const visit = (node: PMNode, pos: number): Progress => {
    const kids = kidsOf(node)
    if (!kids.length) return node.attrs.checked ? 'all' : 'none'
    const st = kids.map((k) => visit(k.node, pos + k.off))
    const all = st.every((x) => x === 'all')
    if (!!node.attrs.checked !== all) out.push({ pos, checked: all })
    return all ? 'all' : st.some((x) => x !== 'none') ? 'some' : 'none'
  }
  doc.descendants((n, pos) => { if (n.type.name === 'taskItem') { visit(n, pos); return false } return true })
  return out
}

/**
 * Checklist item with a self-contained checkbox handler. Same markup as the stock node view, but the
 * toggle resolves its own document position (getPos, falling back to the DOM) and dispatches directly.
 */
export const KokoTaskItem = TaskItem.extend({
  addProseMirrorPlugins() {
    return [new Plugin({
      // ticking the last child ticks its parent; unticking a child unticks it again (and the parent shows a dash while only some are done)
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null
        const fixes = parentFixes(state.doc)
        if (!fixes.length) return null
        const tr = state.tr
        for (const f of fixes) { const n = state.doc.nodeAt(f.pos); if (n) tr.setNodeMarkup(f.pos, undefined, { ...n.attrs, checked: f.checked }) }
        return tr
      },
    })]
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      let current = node
      const li = document.createElement('li')
      const wrap = document.createElement('label')
      const styler = document.createElement('span')
      const cb = document.createElement('input')
      const content = document.createElement('div')

      /** The checkbox follows the item's text size (the first sized run of text decides). */
      const fit = (n: typeof node) => {
        let size: number | null = null
        n.descendants((c) => { if (size == null && c.isText) { const m = c.marks.find((k) => k.type.name === 'textStyle' && k.attrs.fontSize); if (m) size = Number(m.attrs.fontSize) } return size == null })
        if (size) li.style.setProperty('--cb', String(size)); else li.style.removeProperty('--cb')
      }

      const label = () => { cb.ariaLabel = `Task item checkbox for ${current.textContent || 'empty task item'}` }
      label()
      wrap.contentEditable = 'false'
      cb.type = 'checkbox'
      cb.addEventListener('mousedown', (e) => e.preventDefault())

      const isTask = (p: number | null | undefined) => typeof p === 'number' && p >= 0 && editor.state.doc.nodeAt(p)?.type.name === 'taskItem'

      /** Try several independent ways to find this item in the document; returns the position plus a trace for debugging. */
      const locate = (): { pos: number | null; trace: string[] } => {
        const trace: string[] = []
        try { const p = getPos(); trace.push(`getPos=${String(p)}`); if (isTask(p)) return { pos: p as number, trace } } catch (e) { trace.push(`getPos threw ${String(e)}`) }
        try { const p = editor.view.posAtDOM(li, 0) - 1; trace.push(`posAtDOM=${p}`); if (isTask(p)) return { pos: p, trace } } catch (e) { trace.push(`posAtDOM threw ${String(e)}`) }
        let byIdentity: number | null = null
        editor.state.doc.descendants((n, p) => { if (n === current) byIdentity = p; return byIdentity === null })
        trace.push(`identity=${String(byIdentity)}`)
        if (isTask(byIdentity)) return { pos: byIdentity, trace }
        // DOM order equals document order, so the Nth checklist item in the page is the Nth taskItem in the doc.
        const all = Array.from(editor.view.dom.querySelectorAll('li[data-type="taskItem"]'))
        const idx = all.indexOf(li)
        let n = -1, byIndex: number | null = null
        editor.state.doc.descendants((node, p) => { if (node.type.name === 'taskItem' && ++n === idx) byIndex = p; return byIndex === null })
        trace.push(`index=${idx}/${all.length} -> ${String(byIndex)}`)
        if (isTask(byIndex)) return { pos: byIndex, trace }
        return { pos: null, trace }
      }

      cb.addEventListener('change', () => {
        const checked = cb.checked
        if (!editor.isEditable) { cb.checked = !checked; return }
        const { pos, trace } = locate()
        const target = pos == null ? null : editor.state.doc.nodeAt(pos)
        if (pos == null || !target) {
          cb.checked = !checked
          console.warn('KokoDocs: could not locate checklist item for toggle', trace.join(' | '))
          return
        }
        // ticking a parent ticks everything under it (and unticking clears it); a lone item just toggles
        const tr = editor.state.tr
        tr.setNodeMarkup(pos, undefined, { ...target.attrs, checked })
        target.descendants((n, off) => { if (n.type.name === 'taskItem' && !!n.attrs.checked !== checked) tr.setNodeMarkup(pos + 1 + off, undefined, { ...n.attrs, checked }); return true })
        editor.view.dispatch(tr)
      })

      Object.entries(this.options.HTMLAttributes).forEach(([k, v]) => li.setAttribute(k, v as string))
      Object.entries(HTMLAttributes).forEach(([k, v]) => li.setAttribute(k, v as string))
      li.dataset.checked = String(node.attrs.checked)
      li.dataset.partial = String(progress(node) === 'some')
      cb.checked = node.attrs.checked
      fit(node)
      wrap.append(cb, styler)
      li.append(wrap, content)

      return {
        dom: li,
        contentDOM: content,
        update: (updated) => {
          if (updated.type !== current.type) return false
          current = updated
          li.dataset.checked = String(updated.attrs.checked)
          li.dataset.partial = String(progress(updated) === 'some')
          cb.checked = updated.attrs.checked
          fit(updated)
          label()
          return true
        },
      }
    }
  },
})
