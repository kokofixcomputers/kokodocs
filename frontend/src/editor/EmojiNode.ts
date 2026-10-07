import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from 'y-prosemirror'
import { EMOJI_RE, emojiUrl, hasArt } from '../emoji'

/** An emoji drawn with its Twemoji SVG. It is one character wide in the document, so editing and exports stay simple. */
export const EmojiNode = Node.create({
  name: 'emoji',
  priority: 1000,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { char: { default: '', renderHTML: () => ({}) } } },
  parseHTML() { return [{ tag: 'img.emoji', getAttrs: (el) => ({ char: (el as HTMLElement).getAttribute('alt') ?? '' }) }] },
  // a leaf node must not have a content hole: with one, ProseMirror treats the <img> as an editable container and typing next to it breaks
  renderHTML({ node, HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'emoji', alt: node.attrs.char, src: emojiUrl(node.attrs.char), draggable: 'false' })]
  },
  renderText({ node }) { return node.attrs.char },
  // NOTE: Tiptap applies this to every node type, so it must name the emoji itself: for pictures it used to put the word "undefined" into the text (word counts, search, spell check)
  extendNodeSchema() { return { leafText: (node: { type: { name: string }; attrs: { char?: string } }) => (node.type.name === 'emoji' ? node.attrs.char ?? '' : '') } },

  addProseMirrorPlugins() {
    const type = this.type
    return [new Plugin({
      key: new PluginKey('emojiDragSelect'),
      props: {
        // Highlight emoji that are inside a text selection (browsers don't paint selections over images, so a drag looked like nothing happened)
        decorations: (state) => {
          const sel = state.selection
          if (!(sel instanceof TextSelection) || sel.empty) return null
          const decos: Decoration[] = []
          state.doc.nodesBetween(sel.from, sel.to, (n, pos) => { if (n.type === type) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'emoji-sel' })) })
          return decos.length ? DecorationSet.create(state.doc, decos) : null
        },
        // Browsers can't extend a mouse selection over non-editable images, so a drag that starts on or beside an
        // emoji never highlights anything (and Delete then does nothing). Drive that selection ourselves.
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.button !== 0 || event.shiftKey || !view.editable) return false
            const emojiAt = (x: number, y: number) => {
              const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('img.emoji') as HTMLElement | null
              return el && view.dom.contains(el) ? el : null
            }
            const startEl = emojiAt(event.clientX, event.clientY)
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!hit) return false
            const $p = view.state.doc.resolve(hit.pos)
            if (!startEl && $p.nodeAfter?.type !== type && $p.nodeBefore?.type !== type) return false
            const startAt = startEl ? view.posAtDOM(startEl, 0) : hit.pos
            const sx = event.clientX, sy = event.clientY
            let dragging = false
            const move = (e: MouseEvent) => {
              if (!dragging && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return
              const over = emojiAt(e.clientX, e.clientY)
              const at = over ? view.posAtDOM(over, 0) : -1
              let from: number, to: number
              if (over && over === startEl) { from = startAt; to = startAt + 1 }      // dragging within the emoji you started on selects it
              else {
                let raw = at
                if (!over) { const h = view.posAtCoords({ left: e.clientX, top: e.clientY }); if (!h) return; raw = h.pos }
                const forward = raw > startAt || (over !== null && at > startAt)
                from = startEl ? (forward ? startAt : startAt + 1) : startAt     // the emoji you started on stays inside the selection
                to = over ? (forward ? at + 1 : at) : raw                         // landing on another emoji includes it
              }
              dragging = true
              const size = view.state.doc.content.size
              const sel = TextSelection.create(view.state.doc, Math.min(from, size), Math.min(to, size))
              if (!view.state.selection.eq(sel)) view.dispatch(view.state.tr.setSelection(sel))
              e.preventDefault()
            }
            const up = (e: MouseEvent) => { move(e); document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true) }   // the release point counts too
            document.addEventListener('mousemove', move, true)
            document.addEventListener('mouseup', up, true)
            return false
          },
        },
      },
    }), new Plugin({
      key: new PluginKey('emojiConvert'),
      // Turn emoji characters that this user typed, pasted or dictated into Twemoji nodes. Changes arriving from other
      // people are skipped so two clients never convert the same character twice.
      appendTransaction: (trs, _old, state) => {
        if (!this.editor.isEditable) return null
        if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta(ySyncPluginKey)?.isChangeOrigin || t.getMeta('emojiConvert'))) return null
        const found: { from: number; to: number; ch: string }[] = []
        const ranges: [number, number][] = []
        trs.forEach((t, i) => t.steps.forEach((_s, j) => {
          const map = t.mapping.slice(j + 1)
          t.mapping.maps[j].forEach((_a, _b, from, to) => {
            let a = map.map(from, -1), b = map.map(to, 1)
            for (let k = i + 1; k < trs.length; k++) { a = trs[k].mapping.map(a, -1); b = trs[k].mapping.map(b, 1) }
            ranges.push([Math.max(0, a), Math.min(state.doc.content.size, b)])
          })
        }))
        for (const [a, b] of ranges) {
          state.doc.nodesBetween(a, b, (node, pos, parent) => {
            if (!node.isText || !node.text) return
            if (parent?.type.spec.code) return   // code blocks hold plain text only: an emoji node there would split the block
            if (node.marks.some((m) => m.type.spec.code)) return
            EMOJI_RE.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = EMOJI_RE.exec(node.text))) {
              const from = pos + m.index, to = from + m[0].length
              if (to > a && from < b && hasArt(m[0]) && !found.some((f) => f.from === from)) found.push({ from, to, ch: m[0] })
            }
          })
        }
        if (!found.length) return null
        const tr = state.tr.setMeta('emojiConvert', true)
        for (const f of found.sort((x, y) => y.from - x.from)) tr.replaceWith(f.from, f.to, type.create({ char: f.ch }))
        return tr
      },
    })]
  },
})
