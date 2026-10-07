import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/** Checkbox glyphs other editors use to mark checklist items. */
const UNCHECKED = /^[☐□◻▫]/        // ☐ □ ◻ ▫ (Wingdings box)
const CHECKED = /^[☑☒✅✔✓■]/ // ☑ ☒ ✅ ✔ ✓ ■ (Wingdings checked)
const TEXT_MARK = /^\s*(?:\[\s?\]|\[[xX]\])\s+/                // "[ ] " / "[x] "

/** Decode CSS escapes like "\2610" inside list-style-type values. */
const decodeCss = (v: string) => v.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/["']/g, '').trim()

/** true = checked, false = unchecked, null = not a checklist marker. */
function markerState(s: string): boolean | null {
  const t = s.replace(/^\s+/, '')
  if (UNCHECKED.test(t)) return false
  if (CHECKED.test(t)) return true
  const m = TEXT_MARK.exec(s)
  if (m) return /x/i.test(m[0])
  return null
}

/** Remove the marker (glyph or "[ ]") from the start of the first text node under `el`. */
function stripMarker(el: Element) {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? ''
    if (!text.trim()) continue
    n.nodeValue = text.replace(/^\s*(?:\[\s?\]|\[[xX]\]|[☐□◻▫☑☒✅✔✓■])\s*/, '')
    return
  }
}

function liState(li: Element): { state: boolean | null; fromText: boolean } {
  const style = li.getAttribute('style') ?? ''
  const m = /list-style(?:-type)?\s*:\s*([^;]+)/i.exec(style)
  if (m) {
    const s = markerState(decodeCss(m[1]))
    if (s !== null) return { state: s, fromText: false }
  }
  if (li.getAttribute('aria-checked') === 'true' || li.getAttribute('data-checked') === 'true') return { state: true, fromText: false }
  if (li.getAttribute('aria-checked') === 'false') return { state: false, fromText: false }
  const s = markerState(li.textContent ?? '')
  return { state: s, fromText: s !== null }
}

function makeTaskItem(doc: Document, checked: boolean, content: Node[]) {
  const li = doc.createElement('li')
  li.setAttribute('data-type', 'taskItem')
  li.setAttribute('data-checked', String(checked))
  const p = doc.createElement('p')
  content.forEach((c) => p.appendChild(c))
  li.appendChild(p)
  return li
}

/** Rewrites checklist markup (Google Docs, Word, Notion, plain "☐ item" paragraphs) into Tiptap's task list HTML. */
export function convertChecklistHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false

  // 1) lists whose items carry a checkbox marker
  Array.from(doc.querySelectorAll('ul, ol')).forEach((list) => {
    const items = Array.from(list.children).filter((c) => c.tagName === 'LI')
    const states = items.map(liState)
    if (!states.some((s) => s.state !== null)) return
    changed = true
    let target: Element = list
    if (list.tagName === 'OL') {
      target = doc.createElement('ul')
      while (list.firstChild) target.appendChild(list.firstChild)
      list.replaceWith(target)
    }
    target.setAttribute('data-type', 'taskList')
    target.removeAttribute('style')
    items.forEach((li, i) => {
      if (states[i].fromText) stripMarker(li)
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(states[i].state === true))
      li.removeAttribute('style')
    })
  })

  // 2) runs of sibling paragraphs that start with a marker ("☐ buy milk")
  const containers = new Set<Element>([doc.body])
  doc.querySelectorAll('b[id^="docs-internal-guid"], div, td, th').forEach((e) => containers.add(e))
  containers.forEach((box) => {
    let run: Element[] = []
    const flush = () => {
      if (!run.length) return
      const ul = doc.createElement('ul')
      ul.setAttribute('data-type', 'taskList')
      run.forEach((p) => {
        const checked = markerState(p.textContent ?? '') === true
        stripMarker(p)
        ul.appendChild(makeTaskItem(doc, checked, Array.from(p.childNodes)))
      })
      run[0].before(ul)
      run.forEach((p) => p.remove())
      run = []; changed = true
    }
    Array.from(box.children).forEach((c) => {
      if ((c.tagName === 'P' || c.tagName === 'DIV') && !c.querySelector('p, div, ul, ol, table') && markerState(c.textContent ?? '') !== null) run.push(c)
      else flush()
    })
    flush()
  })

  return changed ? doc.body.innerHTML : html
}

export const PasteChecklists = Extension.create({
  name: 'pasteChecklists',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: (html) => { try { return convertChecklistHtml(html) } catch { return html } } } })]
  },
})
