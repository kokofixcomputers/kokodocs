import type { PMNode } from './util'

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/([*_`\[\]])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3').replace(/</g, '&lt;')

function inline(nodes: PMNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '  \n'
    if (n.type === 'emoji') return String(n.attrs?.char ?? '')
    if (n.type === 'mathInline') return `$${String(n.attrs?.latex ?? '')}$`
    if (n.type === 'docShape') return n.attrs?.text ? `[shape: ${String(n.attrs.text).replace(/[\[\]]/g, '')}]` : '[shape]'
    if (n.type === 'wikiBadge') return `[[badge:${String(n.attrs?.label ?? '').replace(/[\[\]<>]/g, '')}]]`
    if (n.type === 'image') return `![${(n.attrs?.alt ?? '').replace(/[\[\]]/g, '')}](${n.attrs?.src ?? ''})`
    if (n.type !== 'text') return inline(n.content)
    let t = n.text ?? ''
    const marks = n.marks ?? []
    const has = (m: string) => marks.some((x) => x.type === m)
    if (has('code')) { t = '`' + t.replace(/`/g, '\\`') + '`' } else t = esc(t)
    const lead = /^\s*/.exec(t)![0], trail = /\s*$/.exec(t)![0]
    let core = t.trim()
    if (!core) return t
    if (has('bold')) core = `**${core}**`
    if (has('italic')) core = `*${core}*`
    if (has('strike')) core = `~~${core}~~`
    if (has('underline')) core = `<u>${core}</u>`
    if (has('highlight')) core = `<mark>${core}</mark>`
    if (has('subscript')) core = `<sub>${core}</sub>`
    if (has('superscript')) core = `<sup>${core}</sup>`
    const link = marks.find((x) => x.type === 'link')
    if (link?.attrs?.href) core = `[${core}](${link.attrs.href})`
    return lead + core + trail
  }).join('')
}

const indentLines = (s: string, pad: string) => s.split('\n').map((l, i) => (i === 0 || !l ? l : pad + l)).join('\n')

function list(node: PMNode, depth: number): string {
  const items = node.content ?? []
  const start = node.type === 'orderedList' ? (node.attrs?.start ?? 1) : 1
  return items.map((li, i) => {
    const marker = node.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}] ` : node.type === 'orderedList' ? `${start + i}. ` : '- '
    const parts = (li.content ?? []).map((c) => (c.type === 'paragraph' ? inline(c.content) : block(c, depth + 1).trimEnd()))
    const first = parts.shift() ?? ''
    const rest = parts.map((p) => indentLines(p, ' '.repeat(marker.length))).map((p) => ' '.repeat(marker.length) + p)
    return marker + first + (rest.length ? '\n' + rest.join('\n') : '')
  }).join('\n') + '\n\n'
}

function table(node: PMNode): string {
  // GFM tables can't merge cells, so lay the cells out on the real grid: a merged cell keeps its text in its first slot and leaves the others blank
  const rows: string[][] = []
  const taken = new Set<string>()
  ;(node.content ?? []).forEach((tr, ri) => {
    const row: string[] = (rows[ri] = rows[ri] ?? [])
    let col = 0
    for (const c of tr.content ?? []) {
      while (taken.has(`${ri}:${col}`)) col++
      const text = (c.content ?? []).map((p) => inline(p.content)).join('<br>').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const cs = Math.max(1, Number(c.attrs?.colspan) || 1), rs = Math.max(1, Number(c.attrs?.rowspan) || 1)
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
        taken.add(`${ri + dr}:${col + dc}`)
        if (dr || dc) { rows[ri + dr] = rows[ri + dr] ?? []; rows[ri + dr][col + dc] = '' }
      }
      row[col] = text
      col += cs
    }
  })
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n\n'
}

function block(n: PMNode, depth = 0): string {
  switch (n.type) {
    case 'paragraph': { const t = inline(n.content); return t.trim() ? t + '\n\n' : '\n' }
    case 'heading': return `${'#'.repeat(n.attrs?.level ?? 1)} ${inline(n.content)}\n\n`
    case 'bulletList': case 'orderedList': case 'taskList': return list(n, depth)
    case 'blockquote': return (n.content ?? []).map((c) => block(c, depth)).join('').trimEnd().split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') + '\n\n'
    case 'callout': {
      const k = String(n.attrs?.kind ?? 'note'), t = String(n.attrs?.title ?? '')
      const body = (n.content ?? []).map((c) => block(c, depth)).join('').trimEnd().split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')
      return `> [!${k}]${t ? ' ' + t : ''}\n${body}\n\n`
    }
    case 'codeBlock': return '```' + (n.attrs?.language ?? '') + '\n' + (n.content ?? []).map((t) => t.text ?? '').join('') + '\n```\n\n'
    case 'horizontalRule': return '---\n\n'
    case 'mathBlock': return `$$\n${String(n.attrs?.latex ?? '')}\n$$\n\n`
    case 'wikiTabs': return ':::tabs\n' + (n.content ?? []).map((t) => `::tab ${String(t.attrs?.title ?? 'Tab').replace(/\n/g, ' ')}\n${(t.content ?? []).map((c) => block(c, depth)).join('').trim()}\n`).join('') + ':::\n\n'
    case 'apiRequest': return '```api-request\n' + JSON.stringify(n.attrs ?? {}, null, 2) + '\n```\n\n'
    case 'table': return table(n)
    default: return (n.content ?? []).map((c) => block(c, depth)).join('')
  }
}

export function toMarkdown(doc: PMNode): string {
  return (doc.content ?? []).map((n) => block(n)).join('').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ───────────── plain text ─────────────
function plainInline(nodes: PMNode[] = []): string {
  return nodes.map((n) => (n.type === 'hardBreak' ? '\n' : n.type === 'text' ? (n.text ?? '') : n.type === 'emoji' ? String(n.attrs?.char ?? '') : n.type === 'mathInline' ? String(n.attrs?.latex ?? '') : n.type === 'image' ? (n.attrs?.alt ? `[${n.attrs.alt}]` : '') : plainInline(n.content))).join('')
}
function plainBlock(n: PMNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  switch (n.type) {
    case 'paragraph': return plainInline(n.content) + '\n\n'
    case 'heading': return plainInline(n.content) + '\n\n'
    case 'bulletList': case 'orderedList': case 'taskList': {
      const start = n.type === 'orderedList' ? (n.attrs?.start ?? 1) : 1
      return (n.content ?? []).map((li, i) => {
        const m = n.type === 'taskList' ? (li.attrs?.checked ? '[x] ' : '[ ] ') : n.type === 'orderedList' ? `${start + i}. ` : '- '
        const parts = (li.content ?? []).map((c) => ({ nested: ['bulletList', 'orderedList', 'taskList'].includes(c.type), text: c.type === 'paragraph' ? plainInline(c.content) : plainBlock(c, depth + 1).trimEnd() }))
        return pad + m + parts.map((p, i) => (i === 0 ? p.text : '\n' + (p.nested ? '' : pad + '  ') + p.text)).join('')
      }).join('\n') + '\n\n'
    }
    case 'blockquote': return (n.content ?? []).map((c) => plainBlock(c, depth)).join('').trimEnd().split('\n').map((l) => '> ' + l).join('\n') + '\n\n'
    case 'callout': return (n.attrs?.title || String(n.attrs?.kind ?? 'note').toUpperCase()) + '\n' + (n.content ?? []).map((c) => plainBlock(c, depth)).join('')
    case 'codeBlock': return (n.content ?? []).map((t) => t.text ?? '').join('') + '\n\n'
    case 'horizontalRule': return '----------\n\n'
    case 'mathBlock': return String(n.attrs?.latex ?? '') + '\n\n'
    case 'table': return (n.content ?? []).map((tr) => (tr.content ?? []).map((c) => plainInline(c.content?.flatMap((p) => p.content ?? [])).replace(/\n/g, ' ')).join('\t')).join('\n') + '\n\n'
    default: return (n.content ?? []).map((c) => plainBlock(c, depth)).join('')
  }
}
export function toPlainText(doc: PMNode): string {
  return (doc.content ?? []).map((n) => plainBlock(n)).join('').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
