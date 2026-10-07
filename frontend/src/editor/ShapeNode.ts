import { Node, mergeAttributes } from '@tiptap/core'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { askText } from '../ui/Dialogs'
import { DEFAULT_SHAPE, SHAPE_MAX, SHAPE_MIN, cleanShape, shapeSpec, type ShapeAttrs } from './shapes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { docShape: { insertShape: (a?: Partial<ShapeAttrs>) => ReturnType; updateShape: (a: Partial<ShapeAttrs>) => ReturnType } }
}

const attrOf = (n: PMNode) => cleanShape(n.attrs as Partial<ShapeAttrs>)
const A = (k: keyof ShapeAttrs, d: unknown) => ({ default: d, parseHTML: (el: HTMLElement) => { try { return JSON.parse(el.getAttribute('data-doc-shape') || '{}')[k] ?? d } catch { return d } }, renderHTML: () => ({}) })

/** A shape that sits in the text like a picture: a rectangle, ellipse, arrow… with colours, an outline and an optional label.
 *  Drag the corner to resize, double-click to edit the label. */
export const DocShape = Node.create({
  name: 'docShape',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    const D = DEFAULT_SHAPE
    return { shape: A('shape', D.shape), w: A('w', D.w), h: A('h', D.h), fill: A('fill', D.fill), stroke: A('stroke', D.stroke), sw: A('sw', D.sw), text: A('text', D.text), fs: A('fs', D.fs) }
  },
  parseHTML() { return [{ tag: 'span[data-doc-shape]' }] },
  renderHTML({ node }) {
    const a = attrOf(node)
    return ['span', mergeAttributes({ class: 'doc-shape', 'data-doc-shape': JSON.stringify(a), style: `width:${a.w}px;height:${a.h}px` }), shapeSpec(a) as never]
  },
  addCommands() {
    return {
      // changing a drawn shape replaces its node, which would drop the selection: put it back so the menu stays and you can keep adjusting
      updateShape: (a) => ({ state, tr, dispatch }) => {
        const sel = state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false
        if (dispatch) { tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, ...cleanShape({ ...attrOf(sel.node), ...a }) }); tr.setSelection(NodeSelection.create(tr.doc, sel.from)) }
        return true
      },
      insertShape: (a) => ({ commands }) => commands.insertContent({ type: this.name, attrs: cleanShape({ ...DEFAULT_SHAPE, ...a }) }) }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      props: {
        // double-click a shape to type its label
        handleDoubleClickOn(view, _pos, node, nodePos) {
          if (node.type.name !== 'docShape' || !editor.isEditable) return false
          void askText({ title: 'Text in the shape', value: attrOf(node).text, label: 'Save', placeholder: 'Leave empty for no text' }).then((v) => {
            if (v === null) return
            const tr = view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, text: v.slice(0, 300) })
            view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, nodePos)))
          })
          return true
        },
      },
    })]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node
      const wrap = document.createElement('span')
      wrap.className = 'doc-shape-wrap'
      const draw = () => {
        const a = attrOf(current)
        wrap.style.width = `${a.w}px`; wrap.style.height = `${a.h}px`
        wrap.replaceChildren(DOMSerializer.renderSpec(document, shapeSpec(a) as never).dom)
        wrap.appendChild(handle)
        wrap.appendChild(badge)
      }
      const badge = document.createElement('span'); badge.className = 'img-size'
      const handle = document.createElement('span'); handle.className = 'shape-handle'
      handle.addEventListener('pointerdown', (e) => {
        if (!editor.isEditable) return
        e.preventDefault(); e.stopPropagation()
        handle.setPointerCapture(e.pointerId)
        const a = attrOf(current), sx = e.clientX, sy = e.clientY, ratio = a.w / a.h
        const limit = (wrap.closest('td,th,.ProseMirror') as HTMLElement | null)?.clientWidth ?? 800
        let w = a.w, h = a.h
        wrap.classList.add('resizing')
        const move = (ev: PointerEvent) => {
          w = Math.round(Math.min(Math.min(limit - 8, SHAPE_MAX), Math.max(SHAPE_MIN, a.w + ev.clientX - sx)))
          h = ev.shiftKey ? Math.round(w / ratio) : Math.round(Math.min(SHAPE_MAX, Math.max(SHAPE_MIN, a.h + ev.clientY - sy)))
          wrap.style.width = `${w}px`; wrap.style.height = `${h}px`
          const svg = wrap.querySelector('svg'); if (svg) svg.replaceWith(DOMSerializer.renderSpec(document, shapeSpec({ ...a, w, h }) as never).dom)
          badge.textContent = `${w} × ${h}`
        }
        const up = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up)
          wrap.classList.remove('resizing')
          const pos = getPos()
          if (typeof pos === 'number') { const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, w, h }); editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos))) }
        }
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up)
      })
      draw()
      return {
        dom: wrap,
        update(n) { if (n.type !== current.type) return false; current = n; draw(); return true },
        selectNode() { wrap.classList.add('selected') },
        deselectNode() { wrap.classList.remove('selected') },
        stopEvent: (ev) => ev.target === handle,
        ignoreMutation: () => true,
      }
    }
  },
})
