import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'

/** Keeps what you are reading in the same place on screen when the page above it changes height.
 *  Someone else typing above you, a page break moving or a picture loading would otherwise push your view down or up. (Safari on iPhones
 *  has no scroll anchoring of its own, and other browsers lose it when the block they anchored to is redrawn.) Your own typing is left to
 *  the editor, which already keeps the caret in view. */
function scroller(view: EditorView): HTMLElement | null {
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return el
  }
  return null
}
// page-break and header/footer widgets get redrawn all the time, so they make poor anchors
const isWidget = (el: Element) => /\b(pg-|ProseMirror-widget|collab-caret)/.test(String(el.className))

export const ScrollAnchor = Extension.create({
  name: 'scrollAnchor',
  addProseMirrorPlugins() {
    let view: EditorView | null = null
    let anchor: { el: Element; top: number; box: HTMLElement } | null = null
    return [new Plugin({
      state: {
        init: () => null,
        apply(tr) {   // runs before the page is redrawn: remember which block is at the top of the screen, and where
          anchor = null
          const remote = !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin
          if (!view?.dom.isConnected || (tr.docChanged && !remote)) return null
          const box = scroller(view)
          if (!box || box.scrollTop < 2) return null
          const top = box.getBoundingClientRect().top
          for (const el of Array.from(view.dom.children)) {
            if (isWidget(el)) continue
            const r = el.getBoundingClientRect()
            if (r.bottom > top + 1) { anchor = { el, top: r.top, box }; break }
          }
          return null
        },
      },
      view(v) {
        view = v
        return {
          update(v, prev) {
            // on a phone, a tapped picture or shape is brought into the visible part above the keyboard so its menu can be seen and used
            const sel = v.state.selection
            if (sel instanceof NodeSelection && !prev.selection.eq(sel) && matchMedia('(max-width: 720px)').matches) {
              const dom = v.nodeDOM(sel.from)
              if (dom instanceof HTMLElement) requestAnimationFrame(() => dom.scrollIntoView({ block: 'center', inline: 'nearest' }))
            }
            // runs right after the redraw: if that block moved, scroll by the same amount
            const a = anchor; anchor = null
            if (!a || !a.el.isConnected) return
            const delta = a.el.getBoundingClientRect().top - a.top
            if (Math.abs(delta) < 0.5) return
            const keep = a.box.style.scrollBehavior
            a.box.style.scrollBehavior = 'auto'
            a.box.scrollTop += delta
            a.box.style.scrollBehavior = keep
          },
          destroy() { view = null },
        }
      },
    })]
  },
})
