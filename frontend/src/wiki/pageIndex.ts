import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { fragLines } from '../editor/diff'
import type { Tree } from './tree'

/** What every wiki page says and links to, read from the shared document: powers searching inside pages and the "Linked from" list. */
export interface PageInfo { text: string; lines: string[]; links: string[] }

function hrefs(root: Y.XmlFragment): string[] {
  const out: string[] = []
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (c instanceof Y.XmlText) {
        for (const d of c.toDelta() as { attributes?: { link?: { href?: string } } }[]) { const h = d.attributes?.link?.href; if (h) out.push(h) }
      } else if (c instanceof Y.XmlElement) walk(c)
    }
  }
  walk(root)
  return out
}

export function indexPages(ydoc: Y.Doc, tree: Tree): Record<string, PageInfo> {
  const out: Record<string, PageInfo> = {}
  for (const id of Object.keys(tree)) {
    if (tree[id].t !== 'page') continue
    const frag = ydoc.getXmlFragment('p:' + id)
    const lines = fragLines(frag)
    out[id] = { lines, text: lines.join('\n').toLowerCase(), links: hrefs(frag) }
  }
  return out
}

/** The index, rebuilt a moment after the last change (so typing never waits on it). */
export function usePageIndex(ydoc: Y.Doc, tree: Tree, enabled: boolean): Record<string, PageInfo> {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let t: number | undefined
    const on = () => { window.clearTimeout(t); t = window.setTimeout(() => setTick((n) => n + 1), 700) }
    ydoc.on('update', on)
    return () => { ydoc.off('update', on); window.clearTimeout(t) }
  }, [ydoc, enabled])
  return useMemo(() => (enabled ? indexPages(ydoc, tree) : {}), [ydoc, tree, enabled, tick])   // eslint-disable-line react-hooks/exhaustive-deps
}

const clip = (line: string, at: number, len: number) => {
  const s = Math.max(0, at - 36), e = Math.min(line.length, at + len + 60)
  return (s > 0 ? '…' : '') + line.slice(s, e) + (e < line.length ? '…' : '')
}

/** Pages whose text contains `q`, with a short snippet around the first match. */
export function searchText(index: Record<string, PageInfo>, q: string): { id: string; snippet: string; count: number }[] {
  const s = q.trim().toLowerCase(); if (s.length < 2) return []
  const out: { id: string; snippet: string; count: number }[] = []
  for (const [id, p] of Object.entries(index)) {
    if (!p.text.includes(s)) continue
    const line = p.lines.find((l) => l.toLowerCase().includes(s)) ?? ''
    out.push({ id, snippet: clip(line, line.toLowerCase().indexOf(s), s.length), count: p.text.split(s).length - 1 })
  }
  return out.sort((a, b) => b.count - a.count)
}

const isLinkTo = (href: string, id: string) => { const i = href.lastIndexOf('#'); return i >= 0 && decodeURIComponent(href.slice(i + 1)) === id }

/** Pages that link to `id` with a real link, and pages that mention its title in plain text. */
export function backlinks(index: Record<string, PageInfo>, tree: Tree, id: string): { id: string; how: 'link' | 'mention'; snippet: string }[] {
  const title = (tree[id]?.title ?? '').trim().toLowerCase()
  const out: { id: string; how: 'link' | 'mention'; snippet: string }[] = []
  for (const [pid, p] of Object.entries(index)) {
    if (pid === id) continue
    if (p.links.some((h) => isLinkTo(h, id))) { out.push({ id: pid, how: 'link', snippet: p.lines.find((l) => title && l.toLowerCase().includes(title)) ?? '' }); continue }
    if (title.length >= 3 && p.text.includes(title)) {
      const line = p.lines.find((l) => l.toLowerCase().includes(title)) ?? ''
      out.push({ id: pid, how: 'mention', snippet: clip(line, line.toLowerCase().indexOf(title), title.length) })
    }
  }
  return out.sort((a, b) => (a.how === b.how ? 0 : a.how === 'link' ? -1 : 1))
}
