import type * as Y from 'yjs'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/** Page sizes at 96dpi (portrait). Header/footer zones live inside each page's top and bottom margins. */
export const PAGE_SIZES = {
  letter: { label: 'Letter', w: 816, h: 1056, css: 'letter', mm: [215.9, 279.4] },
  a4: { label: 'A4', w: 794, h: 1123, css: 'A4', mm: [210, 297] },
  legal: { label: 'Legal', w: 816, h: 1344, css: 'legal', mm: [215.9, 355.6] },
  a5: { label: 'A5', w: 559, h: 794, css: 'A5', mm: [148, 210] },
} as const
export type PageSize = keyof typeof PAGE_SIZES

export interface PageMeta {
  header: string; footer: string
  headerAlign: 'left' | 'center' | 'right'; footerAlign: 'left' | 'center' | 'right'
  size: PageSize; orientation: 'portrait' | 'landscape'
  /** margins in CSS px (96 per inch) */
  mt: number; mb: number; ml: number; mr: number
}
export const DEFAULT_META: PageMeta = {
  header: '', footer: 'Page {page} of {pages}', headerAlign: 'left', footerAlign: 'center',
  size: 'letter', orientation: 'portrait', mt: 88, mb: 88, ml: 96, mr: 96,
}

export interface Geometry { width: number; height: number; header: number; footer: number; padL: number; padR: number; gap: number; body: number }
const clampPx = (n: unknown, d: number) => (typeof n === 'number' && isFinite(n) ? Math.max(24, Math.min(240, n)) : d)
export function geometry(m: Partial<PageMeta> = {}): Geometry {
  const sz = PAGE_SIZES[(m.size as PageSize) in PAGE_SIZES ? (m.size as PageSize) : 'letter']
  const land = m.orientation === 'landscape'
  const width = land ? sz.h : sz.w, height = land ? sz.w : sz.h
  const header = clampPx(m.mt, DEFAULT_META.mt), footer = clampPx(m.mb, DEFAULT_META.mb)
  return { width, height, header, footer, padL: clampPx(m.ml, DEFAULT_META.ml), padR: clampPx(m.mr, DEFAULT_META.mr), gap: 32, body: Math.max(120, height - header - footer) }
}
/** CSS custom properties that size the sheet for a given page setup. */
export const sheetVars = (g: Geometry) => ({ ['--pad-l' as string]: `${g.padL}px`, ['--pad-r' as string]: `${g.padR}px` })

export const readPageMeta = (m: Y.Map<unknown>): PageMeta => ({
  ...DEFAULT_META,
  ...(Object.fromEntries(Object.entries(m.toJSON()).filter(([k]) => k in DEFAULT_META)) as Partial<PageMeta>),
})

interface Break { pos: number; remaining: number }
interface PState { breaks: Break[]; tail: number; version: number }
export const pagesKey = new PluginKey<PState>('pages')

const fmt = (tpl: string, page: number, pages: number) =>
  tpl.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages))

function zone(kind: 'header' | 'footer', text: string, align: string, h: number) {
  const el = document.createElement('div')
  el.className = `pg-zone pg-${kind}`
  el.style.height = `${h}px`
  el.style.textAlign = align
  const t = document.createElement('span')
  t.textContent = text
  t.title = `Edit ${kind}`
  if (!text) t.className = 'pg-empty'
  if (!text) t.textContent = kind === 'header' ? 'Add header' : 'Add footer'
  el.appendChild(t)
  el.addEventListener('dblclick', () => window.dispatchEvent(new CustomEvent('koko:edit-header-footer')))
  return el
}

export const Pagination = Extension.create<{ getMeta: () => PageMeta }>({
  name: 'pagination',
  addOptions() { return { getMeta: () => DEFAULT_META } },

  addProseMirrorPlugins() {
    const getMeta = () => ({ ...DEFAULT_META, ...this.options.getMeta() })
    return [new Plugin<PState>({
      key: pagesKey,
      state: {
        init: () => ({ breaks: [], tail: geometry(getMeta()).body, version: 0 }),
        apply(tr, value) {
          const m = tr.getMeta(pagesKey)
          if (m?.breaks) return { breaks: m.breaks, tail: m.tail, version: value.version + 1 }
          if (m?.refresh) return { ...value, version: value.version + 1 }
          if (tr.docChanged) {
            return { ...value, breaks: value.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos, -1) })) }
          }
          return value
        },
      },
      props: {
        decorations(state) {
          const s = pagesKey.getState(state)!
          const meta = getMeta()
          const G = geometry(meta)
          const total = s.breaks.length + 1
          const sig = JSON.stringify(meta)
          const decos: Decoration[] = []

          decos.push(Decoration.widget(0, () => {
            const el = document.createElement('div')
            el.className = 'pg-first'
            el.contentEditable = 'false'
            el.appendChild(zone('header', fmt(meta.header, 1, total), meta.headerAlign, G.header))
            return el
          }, { side: -1, key: `first|${total}|${sig}`, ignoreSelection: true }))

          s.breaks.forEach((b, i) => {
            const h = b.remaining + G.footer + G.gap + G.header
            decos.push(Decoration.widget(b.pos, () => {
              const el = document.createElement('div')
              el.className = 'pg-break'
              el.contentEditable = 'false'
              el.style.height = `${h}px`
              const sp = document.createElement('div')
              sp.style.height = `${b.remaining}px`
              const gap = document.createElement('div')
              gap.className = 'pg-gap'
              gap.style.height = `${G.gap}px`
              el.append(sp, zone('footer', fmt(meta.footer, i + 1, total), meta.footerAlign, G.footer), gap,
                zone('header', fmt(meta.header, i + 2, total), meta.headerAlign, G.header))
              return el
            }, { side: -1, key: `br|${i}|${b.remaining}|${total}|${sig}`, ignoreSelection: true }))
          })

          decos.push(Decoration.widget(state.doc.content.size, () => {
            const el = document.createElement('div')
            el.className = 'pg-tail'
            el.contentEditable = 'false'
            el.style.height = `${s.tail + G.footer}px`
            const sp = document.createElement('div')
            sp.style.height = `${s.tail}px`
            el.append(sp, zone('footer', fmt(meta.footer, total, total), meta.footerAlign, G.footer))
            return el
          }, { side: 1, key: `tail|${s.tail}|${total}|${sig}`, ignoreSelection: true }))

          return DecorationSet.create(state.doc, decos)
        },
      },
      view(view) {
        let raf = 0
        const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => measure(view, getMeta)) }
        const ro = new ResizeObserver(schedule)
        ro.observe(view.dom)
        const onLoad = () => schedule()
        view.dom.addEventListener('load', onLoad, true)
        document.fonts?.addEventListener?.('loadingdone', onLoad)
        schedule()
        return {
          update: schedule,
          destroy() {
            cancelAnimationFrame(raf); ro.disconnect()
            view.dom.removeEventListener('load', onLoad, true)
            document.fonts?.removeEventListener?.('loadingdone', onLoad)
          },
        }
      },
    })]
  },
})

function measure(view: EditorView, getMeta: () => PageMeta) {
  if (!view.dom.isConnected) return
  const G = geometry(getMeta())
  const BODY = G.body
  let y = 0, pageStart = 0
  const breaks: Break[] = []
  view.state.doc.forEach((_node, offset) => {
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || el.nodeType !== 1) return
    const fit = el.offsetHeight
    const mb = parseFloat(getComputedStyle(el).marginBottom) || 0
    if (y + fit > pageStart + BODY + 0.5 && y > pageStart + 0.5) {
      const remaining = Math.max(0, Math.round(pageStart + BODY - y))
      breaks.push({ pos: offset, remaining })
      y = pageStart = y + remaining + G.footer + G.gap + G.header
    }
    y += fit + mb
  })
  const tail = Math.max(0, Math.round(pageStart + BODY - y))
  const cur = pagesKey.getState(view.state)!
  const same = cur.tail === tail && cur.breaks.length === breaks.length &&
    cur.breaks.every((b, i) => b.pos === breaks[i].pos && b.remaining === breaks[i].remaining)
  if (!same) view.dispatch(view.state.tr.setMeta(pagesKey, { breaks, tail }).setMeta('addToHistory', false))
}
