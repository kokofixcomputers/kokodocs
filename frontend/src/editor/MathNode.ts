import { InputRule, Node, mergeAttributes, nodeInputRule, type Editor } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { math: { insertMath: (block?: boolean, latex?: string) => ReturnType } }
}

type Katex = typeof import('katex')
let katexP: Promise<Katex> | null = null
/** KaTeX is loaded the first time an equation is drawn, so documents without maths never download it. */
const loadKatex = () => (katexP ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default))

export async function renderMath(el: HTMLElement, latex: string, display: boolean) {
  const k = await loadKatex()
  try { k.render(latex, el, { displayMode: display, throwOnError: false, errorColor: '#b42318', strict: 'ignore', trust: false, output: 'htmlAndMathml' }) }
  catch { el.textContent = latex }
}

const SNIPPETS: [string, string][] = [
  ['a⁄b', '\\frac{a}{b}'], ['√', '\\sqrt{x}'], ['xⁿ', 'x^{n}'], ['xₙ', 'x_{n}'], ['∑', '\\sum_{i=1}^{n} i'], ['∫', '\\int_{a}^{b} f(x)\\,dx'], ['lim', '\\lim_{x \\to \\infty}'],
  ['π', '\\pi'], ['α', '\\alpha'], ['β', '\\beta'], ['θ', '\\theta'], ['λ', '\\lambda'], ['Δ', '\\Delta'], ['∞', '\\infty'], ['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'],
  ['×', '\\times'], ['·', '\\cdot'], ['→', '\\rightarrow'], ['∈', '\\in'], ['∂', '\\partial'], ['( )', '\\left( x \\right)'], ['[ ]', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'],
]
const EXAMPLES = ['E = mc^2', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}']

let fresh = false   // set while a just-inserted equation should open its editor straight away

/** The little editor that opens on an equation: LaTeX on top, a live preview under it, and buttons for the common pieces. */
function openEditor(anchor: HTMLElement, initial: string, block: boolean, onSave: (v: string) => void, onRemove: () => void) {
  document.querySelectorAll('.math-pop').forEach((p) => p.remove())
  const pop = document.createElement('div'); pop.className = 'math-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Edit equation')
  pop.innerHTML = `<div class="math-chips"></div><textarea class="math-src" rows="${block ? 3 : 2}" spellcheck="false" placeholder="Type LaTeX, e.g. ${EXAMPLES[0]}"></textarea>
    <div class="math-prev" aria-live="polite"></div>
    <div class="math-actions"><button type="button" class="btn btn-pill btn-ghost math-del">Remove</button><span class="math-hint">⌘/Ctrl + Enter to save</span><button type="button" class="btn btn-pill btn-primary math-ok">Done</button></div>`
  const ta = pop.querySelector('.math-src') as HTMLTextAreaElement, prev = pop.querySelector('.math-prev') as HTMLElement, chips = pop.querySelector('.math-chips') as HTMLElement
  ta.value = initial
  const draw = () => { if (!ta.value.trim()) { prev.textContent = 'The equation shows here'; prev.classList.add('empty'); return } prev.classList.remove('empty'); void renderMath(prev, ta.value, true) }
  for (const [label, code] of SNIPPETS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'math-chip'; b.textContent = label; b.title = code
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(code, s, e, 'end'); ta.focus(); draw() })
    chips.appendChild(b)
  }
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = Math.min(460, window.innerWidth - 24)
    pop.style.width = `${w}px`
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`
    const h = pop.offsetHeight, below = r.bottom + 10
    pop.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 10) : below}px`
  }
  let closed = false
  const close = () => { if (closed) return; closed = true; pop.remove(); document.removeEventListener('mousedown', outside, true); window.removeEventListener('resize', place) }
  const done = () => { onSave(ta.value.trim()); close() }
  const outside = (e: MouseEvent) => { if (!pop.contains(e.target as globalThis.Node) && !anchor.contains(e.target as globalThis.Node)) done() }
  ta.addEventListener('input', draw)
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); done() }
    else if (e.key === 'Escape') { e.preventDefault(); if (!initial) onRemove(); close() }
    e.stopPropagation()
  })
  pop.querySelector('.math-ok')!.addEventListener('click', done)
  pop.querySelector('.math-del')!.addEventListener('click', () => { onRemove(); close() })
  document.body.appendChild(pop)
  document.addEventListener('mousedown', outside, true); window.addEventListener('resize', place)
  draw(); place(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
  requestAnimationFrame(place)
}

function mathNode(name: 'mathInline' | 'mathBlock') {
  const block = name === 'mathBlock'
  return Node.create({
    name,
    group: block ? 'block' : 'inline',
    inline: !block,
    atom: true,
    selectable: true,
    draggable: block,
    addAttributes() { return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') ?? '', renderHTML: (a) => ({ 'data-latex': a.latex }) } } },
    parseHTML() { return [{ tag: block ? 'div[data-math-block]' : 'span[data-math-inline]' }] },
    renderHTML({ node, HTMLAttributes }) {
      // the plain-LaTeX fallback is what exports and copies see; the editor draws it with KaTeX
      return [block ? 'div' : 'span', mergeAttributes({ class: block ? 'math-block' : 'math-inline', [block ? 'data-math-block' : 'data-math-inline']: '' }, HTMLAttributes), block ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`]
    },
    addInputRules() {
      return block
        ? [nodeInputRule({ find: /^\$\$\s$/, type: this.type, getAttributes: () => { fresh = true; return { latex: '' } } })]
        : [new InputRule({ find: /(?<![\\$])\$([^$\n]+?)\$$/, handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1].trim() })) } })]
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let cur = node
        const dom = document.createElement(block ? 'div' : 'span')
        dom.className = block ? 'math-block' : 'math-inline'; dom.contentEditable = 'false'
        const body = document.createElement('span'); body.className = 'math-body'; dom.appendChild(body)
        const draw = () => {
          const l = String(cur.attrs.latex ?? '')
          dom.classList.toggle('empty', !l.trim())
          if (!l.trim()) { body.textContent = block ? 'Add an equation' : 'equation'; return }
          void renderMath(body, l, block)
        }
        const edit = () => {
          if (!editor.isEditable) return
          const pos = getPos(); if (typeof pos !== 'number') return
          openEditor(dom, String(cur.attrs.latex ?? ''), block, (v) => {
            const p = getPos(); if (typeof p !== 'number') return
            if (!v) { editor.chain().focus().deleteRange({ from: p, to: p + cur.nodeSize }).run(); return }
            if (v !== cur.attrs.latex) editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...cur.attrs, latex: v }))
            editor.commands.focus()
          }, () => { const p = getPos(); if (typeof p === 'number') editor.chain().focus().deleteRange({ from: p, to: p + cur.nodeSize }).run() })
        }
        dom.addEventListener('click', (e) => { e.preventDefault(); edit() })
        draw()
        if (fresh && !String(node.attrs.latex ?? '') && editor.isEditable) { fresh = false; window.setTimeout(edit, 0) }
        return {
          dom,
          update: (n) => { if (n.type !== cur.type) return false; const changed = n.attrs.latex !== cur.attrs.latex; cur = n; if (changed) draw(); return true },
          stopEvent: () => false,
          ignoreMutation: () => true,
        }
      }
    },
    addCommands() {
      return name === 'mathBlock' ? {
        insertMath: (isBlock = true, latex = '') => ({ commands }) => {
          fresh = !latex
          return commands.insertContent({ type: isBlock ? 'mathBlock' : 'mathInline', attrs: { latex } })
        },
      } : {}
    },
  })
}

export const MathInline = mathNode('mathInline')
export const MathBlock = mathNode('mathBlock')

export const insertEquation = (editor: Editor, block: boolean) => editor.chain().focus().insertMath(block).run()
