import type { Editor } from '@tiptap/react'
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/** "Fix formatting": tidies what is already written without changing a word, as one step you can undo.
 *   spacing   double spaces, spaces at the ends of a line or before , . ; and stray blank lines between paragraphs
 *   headings  a short line that is all bold or ALL CAPS and stands alone becomes a heading; heading levels no longer skip (a 3 straight after a 1 becomes a 2)
 *   lists     lines typed as "- item", "• item", "1. item" or "[ ] item" become real lists
 *  Works on the selection, or on the whole document when nothing is selected. */
export interface FixReport { spaces: number; blanks: number; headings: number; levels: number; lists: number }
export const reportText = (r: FixReport) => {
  const bits = [r.spaces && `${r.spaces} spacing ${r.spaces === 1 ? 'fix' : 'fixes'}`, r.blanks && `${r.blanks} extra blank ${r.blanks === 1 ? 'line' : 'lines'}`, r.headings && `${r.headings} ${r.headings === 1 ? 'heading' : 'headings'}`, r.levels && `${r.levels} heading ${r.levels === 1 ? 'level' : 'levels'}`, r.lists && `${r.lists} ${r.lists === 1 ? 'list' : 'lists'}`].filter(Boolean)
  return bits.length ? `Fixed ${bits.join(', ')}` : 'Nothing to fix: the formatting already looks tidy'
}

const BULLET = /^\s*([-*•·–—▪◦‣]|•)\s+(?=\S)/
const NUMBER = /^\s*(\d{1,3})[.)]\s+(?=\S)/
const TASK = /^\s*(?:[-*•]\s*)?\[( |x|X)\]\s+(?=\S)/
const textOf = (n: PMNode) => n.textBetween(0, n.content.size, undefined, '￼')
const isBlank = (n: PMNode) => n.type.name === 'paragraph' && n.content.size === 0

/** every text-like piece inside a range that is not code */
function spacingEdits(doc: PMNode, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.code || node.type.name === 'codeBlock') return false
    if (!node.isTextblock) return true
    const start = pos + 1, text = textOf(node)
    const del = (a: number, b: number) => { if (b > a && start + a >= from && start + b <= to + 1) out.push({ from: start + a, to: start + b }) }
    for (const m of text.matchAll(/ {2,}/g)) if (m.index > 0) del(m.index + 1, m.index + m[0].length)   // two spaces or more → one
    for (const m of text.matchAll(/(?<=\S) +(?=[,.;](?!\d))/g)) del(m.index, m.index + m[0].length)     // a space before , . ;
    const lead = /^[ \t ]+/.exec(text)?.[0].length ?? 0, trail = /[ \t ]+$/.exec(text)?.[0].length ?? 0
    if (lead && lead < text.length) del(0, lead)
    if (trail && trail < text.length) del(text.length - trail, text.length)
    return false
  })
  // (a deletion can be found twice when two patterns overlap)
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  const uniq: typeof out = []
  for (const e of out) { const l = uniq[uniq.length - 1]; if (l && e.from < l.to) { if (e.to > l.to) l.to = e.to } else uniq.push({ ...e }) }
  return uniq
}

const allBold = (n: PMNode) => { let any = false, all = true; n.forEach((c) => { if (c.isText && c.text?.trim()) { any = true; if (!c.marks.some((m) => m.type.name === 'bold')) all = false } else if (!c.isText) all = false }); return any && all }
const looksLikeHeading = (n: PMNode, next: PMNode | undefined) => {
  if (n.type.name !== 'paragraph') return false
  const t = textOf(n).trim()
  if (t.length < 2 || t.length > 80 || /[.!?,;:]$/.test(t) || /^\s*([-*•]|\d+[.)])\s/.test(t)) return false
  if (!next || isBlank(next) && false) return false
  const caps = t.length >= 4 && t === t.toUpperCase() && /\p{L}/u.test(t) && t.split(/\s+/).length <= 8
  return allBold(n) || caps
}

export function fixFormatting(editor: Editor): FixReport {
  const { state } = editor, { doc, schema } = state
  const sel = state.selection, whole = sel.empty
  const report: FixReport = { spaces: 0, blanks: 0, headings: 0, levels: 0, lists: 0 }
  const tr: Transaction = state.tr

  // top-level blocks in range, worked out on the document as it is now
  const blocks: { node: PMNode; pos: number }[] = []
  doc.forEach((node, pos) => { if (whole || (pos + node.nodeSize > sel.from && pos < sel.to)) blocks.push({ node, pos }) })
  const rangeFrom = whole ? 0 : Math.min(...blocks.map((b) => b.pos), sel.from), rangeTo = whole ? doc.content.size : Math.max(...blocks.map((b) => b.pos + b.node.nodeSize), sel.to)

  // structure first (from the end, so earlier positions stay put), then spacing in the same pass
  type Edit = { from: number; to: number; nodes: PMNode[] }
  const edits: Edit[] = []
  const t = schema.nodes
  const mkList = (kind: 'bullet' | 'ordered' | 'task', items: { text: PMNode; checked?: boolean; start?: number }[]): PMNode | null => {
    const listType: NodeType | undefined = kind === 'bullet' ? t.bulletList : kind === 'ordered' ? t.orderedList : t.taskList
    const itemType: NodeType | undefined = kind === 'task' ? t.taskItem : t.listItem
    if (!listType || !itemType || !t.paragraph) return null
    const lis = items.map((i) => itemType.create(kind === 'task' ? { checked: !!i.checked } : null, i.text))
    return listType.create(kind === 'ordered' && items[0]?.start && items[0].start !== 1 ? { start: items[0].start } : null, lis)
  }
  const stripMarker = (n: PMNode, re: RegExp): PMNode => {
    const first = n.firstChild; if (!first?.isText) return n
    const m = re.exec(first.text ?? ''); if (!m) return n
    const rest = (first.text ?? '').slice(m[0].length)
    const kids: PMNode[] = []; if (rest) kids.push(schema.text(rest, first.marks)); n.forEach((c, _o, i) => { if (i > 0) kids.push(c) })
    return n.type.create(n.attrs, Fragment.from(kids), n.marks)
  }

  let i = 0
  while (i < blocks.length) {
    const { node, pos } = blocks[i]
    if (node.type.name === 'paragraph' && !isBlank(node)) {
      const text = textOf(node)
      const kind = TASK.test(text) ? 'task' : BULLET.test(text) ? 'bullet' : NUMBER.test(text) ? 'ordered' : null
      if (kind) {   // a run of such lines → one list
        const re = kind === 'task' ? TASK : kind === 'bullet' ? BULLET : NUMBER
        const items: { text: PMNode; checked?: boolean; start?: number }[] = []
        let j = i, end = pos
        while (j < blocks.length && blocks[j].node.type.name === 'paragraph' && re.test(textOf(blocks[j].node)) && (kind !== 'task' || TASK.test(textOf(blocks[j].node)))) {
          const m = re.exec(textOf(blocks[j].node))!
          items.push({ text: stripMarker(blocks[j].node, re), checked: kind === 'task' && /x/i.test(m[1]), start: kind === 'ordered' ? Number(m[1]) : undefined })
          end = blocks[j].pos + blocks[j].node.nodeSize; j++
        }
        const list = mkList(kind, items)
        if (list) { edits.push({ from: pos, to: end, nodes: [list] }); report.lists++; i = j; continue }
      }
    }
    i++
  }
  // headings: a bold or ALL-CAPS line standing alone before more text
  let prevLevel = 0
  for (let k = 0; k < blocks.length; k++) {
    const { node, pos } = blocks[k]
    if (edits.some((e) => pos >= e.from && pos < e.to)) continue
    if (node.type.name === 'heading') { const lvl = node.attrs.level as number; if (prevLevel && lvl > prevLevel + 1) { edits.push({ from: pos, to: pos + node.nodeSize, nodes: [node.type.create({ ...node.attrs, level: prevLevel + 1 }, node.content, node.marks)] }); report.levels++; prevLevel += 1 } else prevLevel = lvl; continue }
    if (t.heading && looksLikeHeading(node, blocks[k + 1]?.node)) {
      const lvl = Math.min(6, prevLevel ? Math.min(prevLevel + 1, Math.max(prevLevel, 2)) : 2)
      const plain: PMNode[] = []; node.forEach((c) => plain.push(c.isText ? c.mark(c.marks.filter((m) => m.type.name !== 'bold')) : c))
      edits.push({ from: pos, to: pos + node.nodeSize, nodes: [t.heading.create({ level: lvl }, Fragment.from(plain))] }); report.headings++; prevLevel = lvl
    }
  }
  // blank paragraphs: none between two lines of text or at the very top; elsewhere (next to a table, a picture, the end) at most one
  const textish = (n?: PMNode) => !!n && !isBlank(n) && (n.isTextblock || ['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(n.type.name))
  for (let k = 0; k < blocks.length; k++) {
    if (!isBlank(blocks[k].node) || edits.some((e) => blocks[k].pos >= e.from && blocks[k].pos < e.to)) continue
    let run = k; while (run + 1 < blocks.length && isBlank(blocks[run + 1].node)) run++
    const prev = blocks[k - 1]?.node, after = blocks[run + 1]?.node
    const dropAll = (k === 0 && !!after) || (textish(prev) && textish(after))
    const first = dropAll ? k : k + 1   // (when one stays, it is the first of the run)
    if (first <= run) {
      const from = blocks[first].pos, to = blocks[run].pos + blocks[run].node.nodeSize
      edits.push({ from, to, nodes: [] }); report.blanks += run - first + 1
    }
    k = run
  }
  // apply the structure edits from the end, then the spacing edits (also from the end, on positions mapped through the first ones)
  edits.sort((a, b) => b.from - a.from)
  const spacing = spacingEdits(doc, rangeFrom, rangeTo).filter((s) => !edits.some((e) => s.from >= e.from && s.to <= e.to))
  report.spaces = spacing.length
  const all = [...edits.map((e) => ({ ...e, kind: 'node' as const })), ...spacing.map((s) => ({ ...s, nodes: [] as PMNode[], kind: 'del' as const }))].sort((a, b) => b.from - a.from || b.to - a.to)
  for (const e of all) { if (e.kind === 'del') tr.delete(e.from, e.to); else if (e.nodes.length) tr.replaceWith(e.from, e.to, e.nodes); else tr.delete(e.from, e.to) }
  if (tr.docChanged) editor.view.dispatch(tr)
  return report
}
