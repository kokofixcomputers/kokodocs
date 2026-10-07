import { parseDelimited } from '../sheet/csv'

/** Turning a Notion export into wiki pages: the planning and text conversion, with no browser needed so it can be tested.
 *  Notion's "Markdown & CSV" export is a tree of files: `Page <32 hex id>.md` plus a folder of the same name holding its sub-pages and pictures,
 *  and `Database <id>.csv` plus a folder of the pages that are its rows. */

export interface PlanItem {
  id: string; t: 'page' | 'folder'; title: string; parent: string | null
  /** Markdown or HTML for a page. */
  body?: string; format?: 'md' | 'html'
  /** The folder the page's file was in, so relative pictures and links can be found. */
  dir: string
  /** The Notion id of the page this represents (for links between pages). */
  notionId?: string
  /** A page that is a row of a database (its first lines may be properties). */
  row?: boolean
  /** A table made from a database's csv. */
  db?: boolean
}
export interface Plan { /** What was cut off the front of every path (the export's wrapping folder), to find files in the original zip. */ prefix: string; items: PlanItem[]; pages: number; folders: number; databases: number; assets: string[]; idByNotion: Map<string, string> }

const ID = /\s([0-9a-f]{32})$/i
export const notionId = (s: string): string | null => ID.exec(s.replace(/\.[a-z]+$/i, ''))?.[1]?.toLowerCase() ?? null
export const stripId = (s: string) => s.replace(/\.[a-z]+$/i, '').replace(ID, '').trim()
const ext = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase() ?? ''
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const noExt = (p: string) => p.replace(/\.(md|html|csv)$/i, '')
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** Resolve a link target relative to the folder the page sits in, handling %20 and `..`. */
export function resolvePath(dir: string, rel: string): string {
  let r = rel
  try { r = decodeURIComponent(rel) } catch { /* keep as is */ }
  const out = dir ? dir.split('/') : []
  for (const seg of r.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg) }
  return out.join('/')
}

const titleOfMd = (md: string, fallback: string) => {
  const m = /^\s*#\s+(.+?)\s*$/m.exec(md.slice(0, 400))
  return m ? m[1].trim() : fallback
}
/** The page text without its own title line (the wiki shows the title above the page). */
export const withoutTitle = (md: string) => md.replace(/^\s*#\s+.+\n?/, '').replace(/^\s+/, '')
const titleOfHtml = (html: string, fallback: string) => /<h1[^>]*class="page-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() || /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || fallback
const bodyOfHtml = (html: string) => /<div class="page-body"[^>]*>([\s\S]*)<\/div>\s*<\/article>/i.exec(html)?.[1] ?? /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html

interface N { key: string; title: string; text?: string; format?: 'md' | 'html'; csv?: string; dir: string; kids: N[]; nid: string | null; row: boolean; parent?: N }

/** Work out the pages and folders from the files of an export. `texts` holds the contents of every .md, .html and .csv; `others` lists every other path. */
export function planNotion(texts: Record<string, string>, others: string[], newId: () => string): Plan {
  // an export often wraps everything in one folder that isn't a page: drop it
  let paths = Object.keys(texts), prefix = ''
  const all = [...paths, ...others]
  for (;;) {
    const firsts = new Set(all.map((p) => p.split('/')[0]))
    if (firsts.size !== 1 || all.some((p) => !p.includes('/'))) break
    const f = [...firsts][0]
    if (paths.some((p) => noExt(p) === f)) break
    const cut = (p: string) => p.slice(f.length + 1)
    prefix += f + '/'
    const nt: Record<string, string> = {}; for (const p of paths) nt[cut(p)] = texts[p]
    texts = nt; paths = Object.keys(texts); others = others.map(cut); all.splice(0, all.length, ...paths, ...others)
  }
  const nodes = new Map<string, N>()
  const get = (key: string): N => {
    let n = nodes.get(key)
    if (!n) { const name = base(key); n = { key, title: stripId(name) || name, dir: dirOf(key), kids: [], nid: notionId(name), row: false }; nodes.set(key, n) }
    return n
  }
  const hasCsv = new Set(paths.filter((p) => ext(p) === 'csv').map((p) => noExt(p).replace(/_all$/, '')))
  for (const p of paths) {
    const e = ext(p)
    if (e === 'csv') { const key = noExt(p).replace(/_all$/, ''); const n = get(key); if (!n.csv || !/_all\.csv$/i.test(p)) n.csv = texts[p]; continue }
    if (e !== 'md' && e !== 'html') continue
    const n = get(noExt(p)); n.text = texts[p]; n.format = e === 'html' ? 'html' : 'md'
    n.title = (e === 'html' ? titleOfHtml(texts[p], n.title) : titleOfMd(texts[p], n.title)) || n.title
  }
  // attach each node to its parent page or folder
  const roots: N[] = []
  const attach = (n: N) => {
    if (n.parent !== undefined || roots.includes(n)) return
    const pk = dirOf(n.key)
    if (!pk) { roots.push(n); return }
    const parent = get(pk); n.parent = parent; parent.kids.push(n); if (hasCsv.has(pk)) n.row = true
    attach(parent)
  }
  for (const n of [...nodes.values()]) attach(n)

  const items: PlanItem[] = [], idByNotion = new Map<string, string>()
  let pages = 0, folders = 0, databases = 0
  const hasBody = (n: N) => !!n.csv || (n.text !== undefined && (n.format === 'html' ? bodyOfHtml(n.text).replace(/<[^>]+>/g, '').trim() : withoutTitle(n.text)).trim().length > 0)
  const body = (n: N, row: boolean): Pick<PlanItem, 'body' | 'format' | 'row'> => (n.csv && !n.text ? { body: csvToMarkdown(n.csv), format: 'md' } : n.format === 'html' ? { body: bodyOfHtml(n.text ?? ''), format: 'html' } : { body: withoutTitle(n.text ?? ''), format: 'md', row })
  const emit = (n: N, parent: string | null) => {
    const kids = [...n.kids].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
    if (!kids.length) {
      if (!n.text && !n.csv) return
      const id = newId(); pages++; if (n.csv && !n.text) databases++
      items.push({ id, t: 'page', title: n.title, parent, dir: n.dir, notionId: n.nid ?? undefined, row: n.row, db: !!n.csv && !n.text, ...body(n, n.row) }); if (n.nid) idByNotion.set(n.nid, id)
      return
    }
    const fid = newId(); folders++
    items.push({ id: fid, t: 'folder', title: n.title, parent, dir: n.dir })
    if (hasBody(n)) {
      const id = newId(); pages++; if (n.csv && !n.text) databases++
      items.push({ id, t: 'page', title: n.title, parent: fid, dir: n.dir, notionId: n.nid ?? undefined, db: !!n.csv && !n.text, ...body(n, false) }); if (n.nid) idByNotion.set(n.nid, id)
    } else if (n.nid) idByNotion.set(n.nid, fid)
    for (const k of kids) emit(k, fid)
  }
  for (const r of roots.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))) emit(r, null)
  return { prefix, items, pages, folders, databases, assets: others.filter((p) => IMAGE_EXT.has(ext(p))), idByNotion }
}

const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
export function csvToMarkdown(csv: string, maxRows = 200): string {
  const rows = parseDelimited(csv.replace(/^﻿/, ''), ',').filter((r) => r.some((c) => c.trim()))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`
  const out = [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1, maxRows + 1).map(line)]
  if (rows.length - 1 > maxRows) out.push('', `Showing the first ${maxRows} of ${rows.length - 1} rows.`)
  return out.join('\n')
}

const EMOJI_KIND: [RegExp, string][] = [[/^(💡|✨|🌟)/u, 'tip'], [/^(⚠️?|🚧)/u, 'warning'], [/^(❗|🚨|⛔|🛑|❌)/u, 'danger'], [/^(✅|✔️?|🎉)/u, 'success'], [/^(❓|❔|🤔)/u, 'question'], [/^(ℹ️?|📌|📝|📖)/u, 'info']]
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}|️|‍|\s)+/u

export interface MdOptions {
  dir: string
  /** The address a picture was stored at, or null when it wasn't imported. */
  image: (resolvedPath: string) => string | null
  /** Where a link to another Notion page should go, or null if that page isn't in the import. */
  link: (id: string) => string | null
  row?: boolean
}

/** Notion's flavour of Markdown into plain Markdown the wiki understands (callouts, toggles, properties, pictures, internal links). */
export function notionMarkdown(md: string, o: MdOptions): string {
  let s = md.replace(/\r\n/g, '\n')
  // database rows start with "Key: value" lines; show them as a small table
  if (o.row) {
    const m = /^((?:[^\n:]{1,60}: ?[^\n]*\n)+)\n/.exec(s)
    if (m) {
      const rows = m[1].trim().split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
      s = `| Property | Value |\n| --- | --- |\n${rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`).join('\n')}\n\n` + s.slice(m[0].length)
    }
  }
  // callouts: <aside> ... </aside>
  s = s.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_m, inner: string) => {
    const text = inner.replace(/<\/?[a-z][^>]*>/gi, '').trim()
    const kind = EMOJI_KIND.find(([re]) => re.test(text))?.[1] ?? 'note'
    const lines = text.replace(LEADING_EMOJI, '').split('\n')
    return `> [!${kind}]\n${lines.map((l) => `> ${l}`).join('\n')}\n`
  })
  // toggles: keep the heading and the content
  s = s.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/g, (_m, sum: string, rest: string) => `**${sum.replace(/<[^>]+>/g, '').trim()}**\n\n${rest.trim()}\n`)
  s = s.replace(/<\/?(?:table_of_contents|column_list|column|synced_block)[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '  \n')
  // pictures and files
  s = s.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang: string, text: string, target: string) => {
    if (/^(https?:|mailto:|data:|#)/i.test(target)) {
      const nid = /notion\.(?:so|site)\/(?:[^\s)]*[-/])?([0-9a-f]{32})(?:[?#][^\s)]*)?$/i.exec(target)?.[1]?.toLowerCase()
      const to = nid ? o.link(nid) : null
      return to && !bang ? `[${text}](${to})` : m
    }
    const path = resolvePath(o.dir, target)
    if (bang) { const url = o.image(path); return url ? `![${text}](${url})` : `*(picture not imported: ${text || base(path)})*` }
    if (/\.(md|html)$/i.test(path)) { const nid = notionId(base(path)); const to = nid ? o.link(nid) : null; return to ? `[${text}](${to})` : text }
    return IMAGE_EXT.has(ext(path)) ? m : `${text || base(path)} *(attachment not imported)*`
  })
  return s
}

/** Pictures a page refers to, as resolved paths inside the export. */
export function referencedImages(md: string, dir: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) { if (!/^(https?:|data:)/i.test(m[1])) out.push(resolvePath(dir, m[1])) }
  for (const m of md.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)) { if (!/^(https?:|data:)/i.test(m[1])) out.push(resolvePath(dir, m[1])) }
  return out
}
