import type { Editor } from '@tiptap/react'
import type { Node as PMNodeType } from '@tiptap/pm/model'
import { marked } from 'marked'
import { toMarkdown } from '../export/markdown'
import type { PageMeta } from '../editor/Pagination'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'
import { flash } from './flash'
import { calloutKind } from '../editor/Callout'

export interface DocDeps {
  editor: Editor
  getTitle: () => string
  setTitle: (t: string) => void
  getMeta: () => PageMeta
  setMeta: (m: Partial<PageMeta>) => void
  canEdit: () => boolean
}

interface Blk { i: number; node: PMNodeType; from: number; to: number }
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const blockText = (n: PMNodeType) => n.textBetween(0, n.content.size, ' ', ' ').replace(/\s+/g, ' ').trim()
const blockMd = (n: PMNodeType) => toMarkdown({ type: 'doc', content: [n.toJSON()] }).trim()
const kindOf = (n: PMNodeType) => {
  const t = n.type.name
  if (t === 'heading') return `heading ${n.attrs.level}`
  if (t === 'bulletList') return 'bullet list'
  if (t === 'orderedList') return 'numbered list'
  if (t === 'taskList') return 'checklist'
  if (t === 'table') return `table ${n.childCount}×${n.firstChild?.childCount ?? 0}`
  if (t === 'codeBlock') return 'code'
  if (t === 'callout') return `callout (${n.attrs.kind})`
  if (t === 'horizontalRule') return 'divider'
  return t === 'paragraph' ? 'paragraph' : t
}

/** Markdown (what the model writes) → the HTML Tiptap parses, including GFM tables and task lists. */
export function mdToHtml(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('blockquote').forEach((bq) => {
    const first = bq.querySelector('p'); if (!first) return
    const m = /^\s*\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/.exec(first.textContent ?? '')
    if (!m) return
    const div = doc.createElement('div'); div.setAttribute('data-callout', calloutKind(m[1])); div.setAttribute('data-title', m[2].trim())
    const rest = (first.innerHTML.split(/<br\s*\/?>|\n/).slice(1)).join('<br>').trim()
    if (rest) first.innerHTML = rest; else first.remove()
    div.innerHTML = bq.innerHTML.trim() || '<p></p>'; bq.replaceWith(div)
  })
  // a wiki's request blocks travel as a fenced ```api-request block holding the block's settings as JSON
  doc.querySelectorAll('pre > code.language-api-request').forEach((code) => {
    try {
      const attrs = JSON.parse(code.textContent ?? '')
      const div = doc.createElement('div'); div.setAttribute('data-wk-api', JSON.stringify(attrs)); code.parentElement!.replaceWith(div)
    } catch { /* not valid JSON: it stays a code block so nothing is lost */ }
  })
  doc.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector('input[type="checkbox"]')
    if (!box || box.closest('li') !== li) return
    li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false')
    box.remove()
    li.parentElement?.setAttribute('data-type', 'taskList')
  })
  return doc.body.innerHTML.replace(/\[\[badge:([^\]<>]{1,24})\]\]/g, (_m, l: string) => `<span data-wk-badge data-label="${l}">${l}</span>`)
}
const isInline = (md: string) => !/\n/.test(md.trim()) && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||---)/.test(md.trim())
const inlineHtml = (md: string) => marked.parseInline(md.trim(), { async: false, gfm: true }) as string

export function createDocAdapter(d: DocDeps): Adapter {
  const ed = d.editor
  const blocks = (): Blk[] => { const out: Blk[] = []; ed.state.doc.forEach((node, from, i) => out.push({ i, node, from, to: from + node.nodeSize })); return out }
  const at = (i: unknown): Blk => {
    const b = blocks()
    const n = Number(i)
    if (!Number.isInteger(n) || n < 0 || n >= b.length) throw new Error(`There is no block #${i}. The document has ${b.length} blocks (#0–#${Math.max(0, b.length - 1)}). Call read_document to see them.`)
    return b[n]
  }
  const check = (b: Blk, expect?: string) => {
    if (!expect) return
    const e = norm(expect).slice(0, 25), cur = norm(blockText(b.node))
    if (e && !cur.startsWith(e)) throw new Error(`Block #${b.i} has changed: it now starts with “${clip(blockText(b.node), 60)}”. Call read_document again before editing.`)
  }
  const apply = (from: number, to: number, html: string, innerOnly = false) => {
    const before = ed.state.doc.content.size
    ed.chain().insertContentAt({ from, to }, html, { updateSelection: false, parseOptions: { preserveWhitespace: false } }).run()
    const delta = ed.state.doc.content.size - before
    flash(ed, from + (innerOnly ? 0 : 0), Math.max(from, to + delta))
  }
  const wordCount = () => ed.state.doc.textBetween(0, ed.state.doc.content.size, ' ', ' ').split(/\s+/).filter(Boolean).length

  const render = (list: Blk[]) => list.map((b) => {
    const md = blockMd(b.node)
    return md.includes('\n') ? `[#${b.i}] (${kindOf(b.node)})\n${md.split('\n').map((l) => '    ' + l).join('\n')}` : `[#${b.i}] (${kindOf(b.node)}) ${md}`
  }).join('\n')

  const readDocument: Tool = tool('read_document', 'Read the whole document as numbered blocks in Markdown. Always do this before editing so you know the exact text and block numbers.', {}, [], {
    label: () => 'Read the document',
    run: () => {
      const all = blocks()
      const meta = d.getMeta()
      const head = `Document “${d.getTitle()}” has ${all.length} block${all.length === 1 ? '' : 's'} and ${wordCount()} words.${meta.header || meta.footer ? ` Page header: “${meta.header}”; footer: “${meta.footer}”.` : ''} Blocks are numbered [#n]; refer to them by number when editing (numbers shift after inserts and deletes).\n\n`
      let body = render(all)
      if (head.length + body.length > MAX_RESULT_CHARS) {
        let used = head.length, n = 0
        for (const b of all) { const piece = render([b]).length + 1; if (used + piece > MAX_RESULT_CHARS - 400) break; used += piece; n++ }
        body = render(all.slice(0, n)) + `\n\n…the document is long; showing blocks #0–#${n - 1} of ${all.length}. Use read_blocks for the rest.`
      }
      return head + (all.length ? body : '(the document is empty)')
    },
  })
  const readBlocks: Tool = tool('read_blocks', 'Read a range of blocks (inclusive) when the document is too long to read at once.', { from: { type: 'number' }, to: { type: 'number' } }, ['from', 'to'], {
    label: (a) => `Read blocks #${a?.from}–#${a?.to}`,
    run: (a) => { const all = blocks(); const f = Math.max(0, Number(a.from)), t = Math.min(all.length - 1, Number(a.to)); return clip(render(all.slice(f, t + 1)) || '(no such blocks)', MAX_RESULT_CHARS) },
  })
  const getSelection: Tool = tool('get_selection', 'What the user has selected (or where their cursor is) in the document.', {}, [], {
    label: () => 'Looked at your selection',
    run: () => {
      const { from, to, empty } = ed.state.selection
      const bi = (p: number) => ed.state.doc.resolve(p).index(0)
      if (empty) return `The cursor is in block #${bi(from)}: “${clip(blockText(blocks()[bi(from)]?.node ?? ed.state.doc), 200)}”. Nothing is selected.`
      return `Selected text (block #${bi(from)}${bi(to) !== bi(from) ? `–#${bi(to)}` : ''}):\n“${clip(ed.state.doc.textBetween(from, to, '\n', ' '), 4000)}”`
    },
  })
  const findText: Tool = tool('find_text', 'Search the document text. Returns matches with their block numbers.', { query: { type: 'string' }, match_case: { type: 'boolean' } }, ['query'], {
    label: (a) => `Searched for “${clip(String(a?.query ?? ''), 30)}”`,
    run: (a) => {
      const q = String(a.query), cs = !!a.match_case
      const hits: string[] = []
      blocks().forEach((b) => { const t = blockText(b.node); const idx = (cs ? t : t.toLowerCase()).indexOf(cs ? q : q.toLowerCase()); if (idx >= 0) hits.push(`#${b.i}: …${t.slice(Math.max(0, idx - 40), idx + q.length + 40)}…`) })
      return hits.length ? `${hits.length} block(s) contain “${q}”:\n${hits.slice(0, 30).join('\n')}` : `No matches for “${q}”.`
    },
  })

  const replaceText: Tool = tool('replace_text', 'Replace exact text everywhere (or once). Preserves surrounding formatting. Best for small wording fixes and renames.',
    { find: { type: 'string' }, replace: { type: 'string' }, match_case: { type: 'boolean', description: 'Default true' }, all: { type: 'boolean', description: 'Replace every occurrence (default true)' } }, ['find', 'replace'], {
      edit: true,
      describe: (a) => ({ title: `Replace “${clip(a.find ?? '', 40)}” with “${clip(a.replace ?? '', 40)}”`, detail: a.all === false ? 'First occurrence only' : 'Every occurrence' }),
      run: (a) => {
        const find = String(a.find); if (!find) throw new Error('find must not be empty')
        const cs = a.match_case !== false, hay = (s: string) => (cs ? s : s.toLowerCase()), needle = hay(find)
        const hits: { from: number; to: number }[] = []
        ed.state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true
          const t = hay(node.textBetween(0, node.content.size, undefined, '￼'))
          for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) hits.push({ from: pos + 1 + i, to: pos + 1 + i + find.length })
          return false
        })
        if (!hits.length) throw new Error(`Couldn't find “${clip(find, 60)}”. Use find_text or read_document to check the exact wording.`)
        const chosen = a.all === false ? hits.slice(0, 1) : hits
        const tr = ed.state.tr
        for (const h of [...chosen].reverse()) tr.insertText(String(a.replace), h.from, h.to)
        ed.view.dispatch(tr)
        // flash where they landed
        let shift = 0
        for (const h of chosen) { const s = h.from + shift; flash(ed, s, s + String(a.replace).length); shift += String(a.replace).length - find.length }
        return `Replaced ${chosen.length} occurrence(s).`
      },
    })

  const editBlock: Tool = tool('edit_block', 'Rewrite one block with new Markdown. Include heading marks (## ) / list markers when the block is a heading or list. Plain text keeps the block\'s existing type.',
    { index: { type: 'number', description: 'Block number from read_document' }, expect: { type: 'string', description: 'The first few words of the block as you last read it (guards against stale numbers)' }, markdown: { type: 'string' } }, ['index', 'markdown'], {
      edit: true,
      describe: (a) => {
        let before = ''; try { before = blockText(at(a.index).node) } catch { /* shown on run */ }
        return { title: `Rewrite block #${a.index}`, before: clip(before, 200), after: clip(String(a.markdown ?? ''), 300) }
      },
      run: (a) => {
        const b = at(a.index); check(b, a.expect)
        const md = String(a.markdown ?? '')
        if (isInline(md) && b.node.isTextblock) apply(b.from + 1, b.to - 1, inlineHtml(md), true)
        else apply(b.from, b.to, mdToHtml(md))
        return `Rewrote block #${a.index}. The document now has ${blocks().length} blocks.`
      },
    })

  const insertBlocks: Tool = tool('insert_blocks', 'Insert new content (Markdown: paragraphs, headings, lists, tables, checklists) after a block, or at the start/end.',
    { after: { description: 'Block number to insert after, or "start" / "end"' }, markdown: { type: 'string' } }, ['after', 'markdown'], {
      edit: true,
      describe: (a) => ({ title: a.after === 'start' ? 'Insert at the start' : a.after === 'end' ? 'Insert at the end' : `Insert after block #${a.after}`, after: clip(String(a.markdown ?? ''), 360) }),
      run: (a) => {
        const all = blocks()
        const pos = a.after === 'start' ? 0 : a.after === 'end' ? ed.state.doc.content.size : at(a.after).to
        apply(pos, pos, mdToHtml(String(a.markdown ?? '')))
        return `Inserted content. The document now has ${blocks().length} blocks (was ${all.length}).`
      },
    })

  const deleteBlocks: Tool = tool('delete_blocks', 'Delete blocks from..to (inclusive).', { from: { type: 'number' }, to: { type: 'number' }, expect: { type: 'string', description: 'First words of the first block, as you last read it' } }, ['from'], {
    edit: true,
    describe: (a) => { let before = ''; try { before = blockText(at(a.from).node) } catch { /* shown on run */ } return { title: a.to !== undefined && Number(a.to) !== Number(a.from) ? `Delete blocks #${a.from}–#${a.to}` : `Delete block #${a.from}`, before: clip(before, 200) } },
    run: (a) => {
      const f = at(a.from), t = at(a.to ?? a.from); check(f, a.expect)
      ed.chain().deleteRange({ from: f.from, to: t.to }).run()
      return `Deleted ${Number(a.to ?? a.from) - Number(a.from) + 1} block(s). The document now has ${blocks().length} blocks.`
    },
  })

  const replaceSelection: Tool = tool('replace_selection', 'Replace what the user has selected (or insert at the cursor) with new Markdown.', { markdown: { type: 'string' } }, ['markdown'], {
    edit: true,
    describe: (a) => { const { from, to, empty } = ed.state.selection; return { title: empty ? 'Insert at the cursor' : 'Replace the selected text', before: empty ? undefined : clip(ed.state.doc.textBetween(from, to, ' ', ' '), 200), after: clip(String(a.markdown ?? ''), 300) } },
    run: (a) => {
      const { from, to } = ed.state.selection
      const md = String(a.markdown ?? '')
      apply(from, to, isInline(md) ? inlineHtml(md) : mdToHtml(md))
      return 'Replaced the selection.'
    },
  })

  const setTitle: Tool = tool('set_title', 'Rename the document.', { title: { type: 'string' } }, ['title'], { edit: true, describe: (a) => ({ title: `Rename the document to “${a.title}”` }), run: (a) => { d.setTitle(String(a.title)); return 'Renamed.' } })
  const setHeaderFooter: Tool = tool('set_header_footer', 'Set the page header and/or footer text. {page} and {pages} insert the page number and count.', { header: { type: 'string' }, footer: { type: 'string' } }, [], {
    edit: true, describe: (a) => ({ title: 'Update the page header/footer', detail: [a.header !== undefined && `Header: ${a.header}`, a.footer !== undefined && `Footer: ${a.footer}`].filter(Boolean).join('\n') }),
    run: (a) => { d.setMeta({ ...(a.header !== undefined && { header: String(a.header) }), ...(a.footer !== undefined && { footer: String(a.footer) }) }); return 'Updated.' },
  })

  return {
    kind: 'doc', noun: 'document', title: d.getTitle, canEdit: d.canEdit, undo: () => { (ed.commands as any).undo() },
    guide: `You are working in a rich-text document. Read it with read_document (numbered blocks in Markdown). Make the smallest edit that does the job: replace_text for wording fixes, edit_block to rewrite one block, insert_blocks to add content, delete_blocks to remove. Write edits as Markdown: **bold**, *italic*, ## headings, - bullets, 1. numbered lists, - [ ] checklists, GFM tables, > quotes, and callouts written as \`> [!tip] Title\` followed by \`> \` lines (kinds: note, info, tip, success, question, warning, danger). Match the document's existing tone and formatting unless asked to change it. When asked to restructure, work block by block rather than rewriting everything at once. After an insert or delete the block numbers shift, so re-read if you need to edit again.`,
    context: () => {
      const { from, to, empty } = ed.state.selection
      const bi = (p: number) => ed.state.doc.resolve(p).index(0)
      return empty ? `The user's cursor is in block #${bi(from)}; nothing is selected.` : `The user has selected ${to - from} characters in block #${bi(from)}${bi(to) !== bi(from) ? `–#${bi(to)}` : ''}: “${clip(ed.state.doc.textBetween(from, to, ' ', ' '), 240)}”.`
    },
    suggestions: ['Summarize this document', 'Tighten the writing and fix mistakes', 'Draft a conclusion', 'Turn this into an outline'],
    tools: [readDocument, readBlocks, getSelection, findText, replaceText, editBlock, insertBlocks, deleteBlocks, replaceSelection, setTitle, setHeaderFooter],
  }
}
