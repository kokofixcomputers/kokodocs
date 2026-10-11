import { Node, mergeAttributes } from '@tiptap/core'
import { callExt, extState, sanitizeHtml, subscribeExt, type ExtBlock as BlockDef } from './runtime'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { extBlock: { insertExtBlock: (ext: string, block: string, data: Record<string, unknown>) => ReturnType } }
}

const parse = (s: unknown): Record<string, unknown> => { try { const v = JSON.parse(String(s ?? '{}')); return v && typeof v === 'object' ? v : {} } catch { return {} } }

function openForm(anchor: HTMLElement, def: BlockDef, values: Record<string, unknown>, save: (v: Record<string, unknown>) => void, remove: () => void) {
  document.querySelectorAll('.math-pop').forEach((p) => p.remove())
  const pop = document.createElement('div'); pop.className = 'math-pop ext-form'; pop.setAttribute('role', 'dialog')
  const title = document.createElement('b'); title.textContent = def.title; pop.appendChild(title)
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {}
  for (const f of def.fields) {
    const label = document.createElement('label'); label.className = 'ext-field'
    const span = document.createElement('span'); span.textContent = f.label
    const el = f.type === 'longtext' ? document.createElement('textarea') : document.createElement('input')
    if (el instanceof HTMLInputElement) el.type = f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'
    else el.rows = 4
    el.value = String(values[f.key] ?? def.defaults[f.key] ?? '')
    label.append(span, el); pop.appendChild(label); inputs[f.key] = el
  }
  const row = document.createElement('div'); row.className = 'math-actions'
  const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-pill btn-ghost'; del.textContent = 'Remove'
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn btn-pill btn-primary'; ok.textContent = 'Done'
  const sp = document.createElement('span'); sp.className = 'math-hint'
  row.append(del, sp, ok); pop.appendChild(row)
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24)
    pop.style.width = `${w}px`; pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left))}px`
    const h = pop.offsetHeight; pop.style.top = `${r.bottom + 10 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 10) : r.bottom + 10}px`
  }
  let closed = false
  const close = () => { if (closed) return; closed = true; pop.remove(); document.removeEventListener('mousedown', outside, true) }
  const done = () => { const out: Record<string, unknown> = { ...values }; for (const f of def.fields) out[f.key] = f.type === 'number' ? Number(inputs[f.key].value) : inputs[f.key].value; save(out); close() }
  const outside = (e: MouseEvent) => { if (!pop.contains(e.target as globalThis.Node) && !anchor.contains(e.target as globalThis.Node)) done() }
  ok.addEventListener('click', done); del.addEventListener('click', () => { remove(); close() })
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close() } e.stopPropagation() })
  document.body.appendChild(pop); document.addEventListener('mousedown', outside, true)
  place(); requestAnimationFrame(place); Object.values(inputs)[0]?.focus()
}

/** A block an extension defines. The document stores which extension, which block and its settings; the extension draws it. */
export const ExtBlock = Node.create({
  name: 'extBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      ext: { default: '', parseHTML: (el) => el.getAttribute('data-ext') ?? '', renderHTML: (a) => ({ 'data-ext': a.ext }) },
      block: { default: '', parseHTML: (el) => el.getAttribute('data-block') ?? '', renderHTML: (a) => ({ 'data-block': a.block }) },
      data: { default: '{}', parseHTML: (el) => el.getAttribute('data-data') ?? '{}', renderHTML: (a) => ({ 'data-data': a.data }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-ext-block]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'ext-block', 'data-ext-block': '' }, HTMLAttributes), 'Extension block'] },
  addCommands() {
    return { insertExtBlock: (ext, block, data) => ({ commands }) => commands.insertContent({ type: 'extBlock', attrs: { ext, block, data: JSON.stringify(data) } }) }
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let cur = node, token = 0
      const dom = document.createElement('div'); dom.className = 'ext-block'; dom.contentEditable = 'false'
      const body = document.createElement('div'); body.className = 'ext-block-body'; dom.appendChild(body)
      const def = () => extState().blocks.find((b) => b.ext === cur.attrs.ext && b.id === cur.attrs.block)
      const draw = () => {
        const d = def(), mine = ++token
        if (!d) { body.className = 'ext-block-body missing'; body.textContent = 'This block comes from an extension that is not running on this account.'; return }
        callExt(cur.attrs.ext, 'r:' + cur.attrs.block, parse(cur.attrs.data)).then((html) => {
          if (mine !== token) return
          body.className = 'ext-block-body'; body.replaceChildren(sanitizeHtml(String(html ?? '')))
        }).catch((e: Error) => { if (mine === token) { body.className = 'ext-block-body missing'; body.textContent = e.message } })
      }
      draw()
      const off = subscribeExt(() => { const d = def(); const k = (d ? 'y' : 'n') + extState().rev; if (dom.dataset.k !== k) { dom.dataset.k = k; draw() } })
      dom.addEventListener('click', () => {
        const d = def(); if (!d || !d.fields.length || !editor.isEditable) return
        const pos = getPos(); if (typeof pos !== 'number') return
        openForm(dom, d, parse(cur.attrs.data), (v) => { const p = getPos(); if (typeof p === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...cur.attrs, data: JSON.stringify(v) })) },
          () => { const p = getPos(); if (typeof p === 'number') editor.chain().focus().deleteRange({ from: p, to: p + cur.nodeSize }).run() })
      })
      return {
        dom, stopEvent: () => false, ignoreMutation: () => true, destroy: off,
        update: (n) => { if (n.type !== cur.type) return false; const changed = n.attrs.data !== cur.attrs.data || n.attrs.block !== cur.attrs.block; cur = n; if (changed) draw(); return true },
      }
    }
  },
})
