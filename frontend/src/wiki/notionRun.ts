import JSZip from 'jszip'
import DOMPurify from 'dompurify'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { baseExtensions } from '../editor/extensions'
import { mdToHtml } from '../assistant/docTools'
import { ApiRequestSchema, WikiBadge } from './WikiNodes'
import { WikiTab, WikiTabs } from './WikiTabs'
import { IMAGE_EXT, notionId, notionMarkdown, planNotion, referencedImages, resolvePath, type Plan, type PlanItem } from './notion'
import { nextPos, uid, type Entry, type Tree } from './tree'

const MAX_IMAGE = 12 * 1024 * 1024
const MAX_PAGES = 3000
const ext = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase() ?? ''
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

export interface Source { texts: Record<string, string>; others: string[]; images: Map<string, () => Promise<Blob>>; warnings: string[] }

/** Read what the person chose: a Notion export .zip (also zips inside zips, which large exports are split into), or loose .md, .html and .csv files. */
export async function readSource(files: File[]): Promise<Source> {
  const src: Source = { texts: {}, others: [], images: new Map(), warnings: [] }
  const addZip = async (zip: JSZip, depth: number) => {
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) continue
      const e = ext(name)
      if (e === 'zip' && depth < 3) { await addZip(await JSZip.loadAsync(await entry.async('arraybuffer')), depth + 1); continue }
      if (e === 'md' || e === 'html' || e === 'csv') src.texts[name] = await entry.async('string')
      else { src.others.push(name); if (IMAGE_EXT.has(e)) src.images.set(name, async () => new Blob([await entry.async('arraybuffer')], { type: MIME[e] })) }
    }
  }
  for (const f of files) {
    const e = ext(f.name)
    if (e === 'zip') { try { await addZip(await JSZip.loadAsync(f), 0) } catch { throw new Error(`“${f.name}” isn't a readable zip file.`) } }
    else if (e === 'md' || e === 'html' || e === 'csv') src.texts[(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name] = await f.text()
    else if (IMAGE_EXT.has(e)) { src.others.push(f.name); src.images.set(f.name, async () => f) }
    else src.warnings.push(`Skipped ${f.name}: only Notion exports (.zip) and .md, .html and .csv files can be imported.`)
  }
  if (!Object.keys(src.texts).length) throw new Error('No pages found. In Notion, use Export, choose “Markdown & CSV”, and select that .zip file.')
  return src
}

export function planSource(src: Source): Plan {
  const plan = planNotion(src.texts, src.others, uid)
  if (plan.pages > MAX_PAGES) throw new Error(`That export has ${plan.pages} pages. Import it in parts (the limit is ${MAX_PAGES}).`)
  return plan
}

export interface RunOptions {
  ydoc: Y.Doc; tree: Tree; upload: (f: File) => Promise<string>
  images: boolean; wrapper: string | null
  onProgress: (done: number, total: number, what: string) => void
}
export interface RunResult { pages: number; folders: number; images: number; skippedImages: number; first: string | null }

const clean = (html: string) => DOMPurify.sanitize(html, { ADD_ATTR: ['data-callout', 'data-title', 'data-type', 'data-checked', 'data-wk-badge', 'data-label', 'colspan', 'rowspan'] })

/** Create the pages and folders in the wiki's shared document, with their content and pictures. */
export async function runImport(plan: Plan, src: Source, o: RunOptions): Promise<RunResult> {
  const schema = getSchema([...baseExtensions(), ApiRequestSchema, WikiBadge, WikiTabs, WikiTab])
  const parser = PMDOMParser.fromSchema(schema)
  const ytree = o.ydoc.getMap<Entry>('tree')
  const total = plan.items.length
  let done = 0

  // 1. pictures first, so pages can point at them
  const urls = new Map<string, string | null>()
  let uploaded = 0, skipped = 0
  if (o.images) {
    const wanted = new Set<string>()
    for (const it of plan.items) if (it.body) for (const p of referencedImages(it.body, it.dir)) wanted.add(p)
    const list = [...wanted]; let i = 0
    const worker = async () => {
      while (i < list.length) {
        const path = list[i++]
        const get = src.images.get(plan.prefix + path) ?? src.images.get(path)
        if (!get) { urls.set(path, null); skipped++; continue }
        try {
          const blob = await get()
          if (blob.size > MAX_IMAGE) throw new Error('too big')
          const e = ext(path)
          urls.set(path, await o.upload(new File([blob], `image.${e === 'jpeg' ? 'jpg' : e}`, { type: MIME[e] ?? blob.type })))
          uploaded++
        } catch { urls.set(path, null); skipped++ }
        o.onProgress(done, total, `Pictures ${uploaded + skipped} of ${list.length}`)
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }

  // 2. folders and pages
  const link = (nid: string) => { const id = plan.idByNotion.get(nid); return id ? `#${id}` : null }
  const html = (it: PlanItem): string => {
    if (it.format === 'html') {
      const box = document.createElement('div'); box.innerHTML = clean(it.body ?? '')
      box.querySelectorAll('img').forEach((img) => {
        const s = img.getAttribute('src') ?? ''
        if (/^(https?:|data:|\/api\/)/i.test(s)) return
        const u = o.images ? urls.get(resolvePath(it.dir, s)) : null
        if (u) img.setAttribute('src', u); else img.replaceWith(document.createTextNode('(picture not imported)'))
      })
      box.querySelectorAll('a').forEach((a) => {
        const h = a.getAttribute('href') ?? ''
        if (/^(https?:|mailto:|#)/i.test(h)) return
        const nid = notionId(resolvePath('', h).split('/').pop() ?? ''); const to = nid ? link(nid) : null
        if (to) a.setAttribute('href', to); else a.replaceWith(...Array.from(a.childNodes))
      })
      return box.innerHTML
    }
    const md = notionMarkdown(it.body ?? '', { dir: it.dir, row: it.row, link, image: (p) => (o.images ? urls.get(p) ?? null : null) })
    return clean(mdToHtml(md))
  }
  const wrapperId = o.wrapper ? uid() : null
  const counters = new Map<string | null, number>()
  const next = (parent: string | null) => { const n = (counters.get(parent) ?? 0) + 1; counters.set(parent, n); return n }
  let first: string | null = null
  if (wrapperId) o.ydoc.transact(() => ytree.set(wrapperId, { t: 'folder', title: o.wrapper!.slice(0, 120) || 'Imported from Notion', parent: null, pos: nextPos(o.tree, null) }))
  for (let i = 0; i < plan.items.length; i += 15) {
    o.ydoc.transact(() => {
      for (const it of plan.items.slice(i, i + 15)) {
        const parent = it.parent ?? wrapperId
        ytree.set(it.id, { t: it.t, title: (it.title || 'Untitled').slice(0, 120), parent, pos: it.parent ? next(it.parent) : wrapperId ? next(wrapperId) : nextPos(o.tree, null) + next(null) - 1 })
        if (it.t === 'page') {
          if (!first && !it.db && !it.row) first = it.id
          if (it.body?.trim()) {
            const box = document.createElement('div'); box.innerHTML = html(it)
            const json = parser.parse(box).toJSON()
            prosemirrorJSONToYXmlFragment(schema, json, o.ydoc.getXmlFragment('p:' + it.id))
          }
        }
        done++
      }
    })
    o.onProgress(done, total, 'Pages')
    await new Promise((r) => setTimeout(r, 0))
  }
  if (!first) first = plan.items.find((i) => i.t === 'page')?.id ?? null
  return { pages: plan.pages, folders: plan.folders + (wrapperId ? 1 : 0), images: uploaded, skippedImages: skipped, first }
}
