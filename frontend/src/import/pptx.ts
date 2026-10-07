import JSZip from 'jszip'
import { W, H, type ShapeKind } from '../slides/themes'
import type { ImportedSlide } from '../slides/model'

const EMU_PX = 9525
const rect = (xf: Element | undefined, k: { x: number; y: number }) => {
  if (!xf) return null
  const off = xf.getElementsByTagName('a:off')[0], ext = xf.getElementsByTagName('a:ext')[0]
  if (!off || !ext) return null
  return { x: Math.round(Number(off.getAttribute('x')) * k.x), y: Math.round(Number(off.getAttribute('y')) * k.y), w: Math.max(8, Math.round(Number(ext.getAttribute('cx')) * k.x)), h: Math.max(8, Math.round(Number(ext.getAttribute('cy')) * k.y)) }
}
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
const text = (el: Element) => Array.from(el.getElementsByTagName('a:p')).map((p) => Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent ?? '').join('')).join('\n').replace(/\s+$/, '')
const clr = (scope: Element | undefined | null) => { const c = scope?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val'); return c ? '#' + c.toLowerCase() : undefined }
const PRST: Record<string, ShapeKind> = { rect: 'rect', roundRect: 'round', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'triangle', line: 'line', straightConnector1: 'line', rightArrow: 'arrow', bentArrow: 'arrow' }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const FALLBACK = { title: { x: 80, y: 56, w: 1120, h: 100 }, sub: { x: 80, y: 420, w: 1120, h: 100 }, body: { x: 80, y: 200, w: 1120, h: 440 }, other: { x: 80, y: 200, w: 600, h: 200 } }

export async function readPptx(file: File, upload: (f: File) => Promise<string>): Promise<{ slides: ImportedSlide[]; skipped: { charts: number; images: number } }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? ''
  const pres = parse(await read('ppt/presentation.xml'))
  const sz = pres.getElementsByTagName('p:sldSz')[0]
  const cx = Number(sz?.getAttribute('cx')) || 12192000, cy = Number(sz?.getAttribute('cy')) || 6858000
  const k = { x: W / cx, y: H / cy }, fontK = W / (cx / EMU_PX)   // source px -> stage px
  const rels = (xml: string) => { const m = new Map<string, { target: string; type: string }>(); parse(xml).querySelectorAll('Relationship').forEach((r) => m.set(r.getAttribute('Id')!, { target: r.getAttribute('Target')!, type: r.getAttribute('Type') ?? '' })); return m }
  const presRels = rels(await read('ppt/_rels/presentation.xml.rels'))
  const ids = Array.from(pres.getElementsByTagName('p:sldId')).map((s) => s.getAttribute('r:id')!).map((id) => presRels.get(id)?.target).filter(Boolean) as string[]
  const slides: ImportedSlide[] = []; const skipped = { charts: 0, images: 0 }
  for (const target of ids.slice(0, 100)) {
    const path = 'ppt/' + target.replace(/^\/?(ppt\/)?/, '')
    const sx = parse(await read(path))
    const base = path.split('/').pop()!
    const sr = rels(await read(`ppt/slides/_rels/${base}.rels`))
    const resolve = (t: string) => { const parts = ('ppt/slides/' + t).split('/'); const out: string[] = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p) } return out.join('/') }
    const els: ImportedSlide['els'] = []
    // text boxes, placeholders and shapes, in drawing order
    const tree = sx.getElementsByTagName('p:spTree')[0]
    const walk = async (parent: Element) => {
      for (const node of Array.from(parent.children)) {
        const tag = node.tagName
        if (tag === 'p:grpSp') { await walk(node); continue }
        if (tag === 'p:sp' || tag === 'p:cxnSp') {
          const ph = node.getElementsByTagName('p:ph')[0], phType = ph?.getAttribute('type') ?? (ph ? 'body' : '')
          const role = /title/i.test(phType) ? 'title' : phType === 'subTitle' ? 'sub' : ph && phType !== 'sldNum' && phType !== 'dt' && phType !== 'ftr' ? 'body' : undefined
          if (phType === 'sldNum' || phType === 'dt' || phType === 'ftr') continue
          const spPr = node.getElementsByTagName('p:spPr')[0]
          const r = rect(spPr?.getElementsByTagName('a:xfrm')[0], k) ?? FALLBACK[(role ?? 'other') as keyof typeof FALLBACK]
          const t = node.tagName === 'p:sp' ? text(node) : ''
          const prst = spPr?.getElementsByTagName('a:prstGeom')[0]?.getAttribute('prst') ?? ''
          const fillScope = Array.from(spPr?.children ?? []).find((c) => c.tagName === 'a:solidFill')
          const fill = clr(fillScope), noFill = !!Array.from(spPr?.children ?? []).find((c) => c.tagName === 'a:noFill')
          const rPr = node.getElementsByTagName('a:rPr')[0] ?? node.getElementsByTagName('a:endParaRPr')[0]
          const sz = Number(rPr?.getAttribute('sz')) / 100
          const size = sz ? Math.round(sz * (96 / 72) * fontK) : undefined
          const algn = node.getElementsByTagName('a:pPr')[0]?.getAttribute('algn')
          const textual = { text: t, size, bold: rPr?.getAttribute('b') === '1' || role === 'title', italic: rPr?.getAttribute('i') === '1', color: clr(rPr), align: algn === 'ctr' ? 'center' as const : algn === 'r' ? 'right' as const : 'left' as const, valign: 'top' as const }
          const isShape = (PRST[prst] && PRST[prst] !== 'rect' && !role) || (!!fill && !role && !noFill) || node.tagName === 'p:cxnSp'
          if (isShape) {
            els.push({ type: 'shape', shape: PRST[prst] ?? 'rect', ...r, fill: fill ?? (node.tagName === 'p:cxnSp' ? undefined : 'accent'), stroke: node.tagName === 'p:cxnSp' ? (clr(node.getElementsByTagName('a:ln')[0]) ?? 'fg') : undefined, strokeW: node.tagName === 'p:cxnSp' ? 4 : 0, ...(t ? { ...textual, align: 'center' as const } : {}) })
          } else if (t) {
            els.push({ type: 'text', role: role as never, ...r, ...textual, bullets: role === 'body' || !!node.getElementsByTagName('a:buChar')[0] || !!node.getElementsByTagName('a:buAutoNum')[0] })
          }
        } else if (tag === 'p:pic') {
          const embed = node.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed'), rel = embed ? sr.get(embed) : undefined
          const r = rect(node.getElementsByTagName('p:spPr')[0]?.getElementsByTagName('a:xfrm')[0], k) ?? FALLBACK.other
          const ext = rel?.target.split('.').pop()?.toLowerCase() ?? ''
          const entry = rel && MIME[ext] ? zip.file(resolve(rel.target)) : null
          if (!entry) { skipped.images++; continue }
          try {
            const blob = new Blob([await entry.async('arraybuffer')], { type: MIME[ext] })
            els.push({ type: 'image', src: await upload(new File([blob], `slide-image.${ext}`, { type: MIME[ext] })), alt: node.getElementsByTagName('p:cNvPr')[0]?.getAttribute('descr') ?? '', ...r })
          } catch { skipped.images++ }
        } else if (tag === 'p:graphicFrame') {
          const tbl = node.getElementsByTagName('a:tbl')[0]
          const r = rect(node.getElementsByTagName('p:xfrm')[0], k) ?? FALLBACK.body
          if (tbl) {
            const rows = Array.from(tbl.getElementsByTagName('a:tr')).map((tr) => Array.from(tr.getElementsByTagName('a:tc')).map((tc) => text(tc)))
            const cells: Record<string, string> = {}; rows.forEach((row, i) => row.forEach((v, j) => { if (v) cells[`${i}:${j}`] = v }))
            els.push({ type: 'table', ...r, nr: rows.length, nc: Math.max(1, ...rows.map((x) => x.length)), cells, header: true, size: 22 })
          } else if (node.getElementsByTagName('c:chart')[0]) skipped.charts++
        }
      }
    }
    if (tree) await walk(tree)
    // speaker notes
    let notes = ''
    const nrel = Array.from(sr.values()).find((x) => x.type.endsWith('/notesSlide'))
    if (nrel) {
      const nx = parse(await read(resolve(nrel.target)))
      notes = Array.from(nx.getElementsByTagName('p:sp')).filter((sp) => sp.getElementsByTagName('p:ph')[0]?.getAttribute('type') === 'body').map(text).join('\n').trim()
    }
    slides.push({ notes, els })
  }
  return { slides, skipped }
}
