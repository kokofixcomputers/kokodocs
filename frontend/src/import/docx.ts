import JSZip from 'jszip'
import { FONTS } from '../fonts'

/** Word (.docx) to editor HTML that keeps what people care about: font, size, colour, highlight, bold/italic/underline/strike,
 *  super/subscript, alignment, headings, bullet and numbered lists (nested), links, tables (merged cells, shading) and pictures.
 *  Written against the XML directly because the usual converters drop colours, sizes and fonts. */

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EDITOR_PT = 11   // the editor's body size: runs at this size need no explicit size
const EMU_PX = 9525
const MAX_IMG_W = 640

type El = Element
const els = (n: Node | null | undefined): El[] => (n ? (Array.from(n.childNodes).filter((c) => c.nodeType === 1) as El[]) : [])
const kids = (n: Node | null | undefined, local: string) => els(n).filter((c) => c.localName === local && c.namespaceURI === NS)
const kid = (n: Node | null | undefined, local: string) => kids(n, local)[0]
const attr = (e: El | null | undefined, name: string, ns: string = NS): string | null => {
  if (!e) return null
  const v = e.getAttributeNS(ns, name) || e.getAttribute((ns === NS ? 'w:' : ns === R ? 'r:' : '') + name)   // some DOMs return '' for a missing attribute
  return v === '' ? null : v
}
const isOn = (e: El | undefined) => { if (!e) return undefined; const v = attr(e, 'val'); return !(v === '0' || v === 'false' || v === 'off') }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hex = (v: string | null | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null)

interface RP { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; sup?: boolean; sub?: boolean; caps?: boolean; vanish?: boolean; color?: string | null; pt?: number; font?: string; hl?: string | null; shd?: string | null }
const merge = (...ps: (RP | undefined)[]): RP => { const out: Record<string, unknown> = {}; for (const p of ps) if (p) for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = v; return out as RP }

const HIGHLIGHT: Record<string, string> = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' }
const THEME_CLR: Record<string, string> = { text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hyperlink: 'hlink', dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2' }
// Office's own fonts mapped to look-alikes in the editor's font list
const FONT_MAP: Record<string, string> = { calibri: 'Carlito', cambria: 'Caladea', arial: 'Arimo', 'times new roman': 'Tinos', 'courier new': 'Cousine', georgia: 'Gelasio', verdana: 'Open Sans', tahoma: 'Open Sans', 'segoe ui': 'Open Sans',
  aptos: 'Inter', 'aptos display': 'Inter', 'aptos narrow': 'Inter', helvetica: 'Arimo', 'helvetica neue': 'Inter', 'comic sans ms': 'Comic Neue', consolas: 'Inconsolata', 'lucida console': 'Inconsolata', 'trebuchet ms': 'Fira Sans',
  garamond: 'EB Garamond', 'book antiqua': 'EB Garamond', 'palatino linotype': 'Libre Baskerville', 'century schoolbook': 'Libre Baskerville', impact: 'Anton', 'calibri light': 'Carlito', 'cambria math': 'Caladea', 'segoe ui light': 'Open Sans', 'franklin gothic book': 'Libre Franklin' }
const KNOWN = new Map(FONTS.map((f) => [f.family.toLowerCase(), f.family]))
const resolveFont = (raw?: string): string | undefined => {
  if (!raw) return undefined
  const k = raw.trim().toLowerCase()
  return KNOWN.get(k) ?? (FONT_MAP[k] ? KNOWN.get(FONT_MAP[k].toLowerCase()) : undefined)
}

interface Theme { major?: string; minor?: string; colors: Record<string, string> }
function readTheme(doc: Document | null): Theme {
  const t: Theme = { colors: {} }
  if (!doc) return t
  t.major = doc.getElementsByTagNameNS(A, 'majorFont')[0]?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface') ?? undefined
  t.minor = doc.getElementsByTagNameNS(A, 'minorFont')[0]?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface') ?? undefined
  const scheme = doc.getElementsByTagNameNS(A, 'clrScheme')[0]
  for (const c of els(scheme)) { const v = els(c)[0]; const h = v?.getAttribute('val') ?? v?.getAttribute('lastClr'); const x = hex(h); if (x) t.colors[c.localName!] = x }
  return t
}

function parseRPr(rPr: El | undefined, theme: Theme): RP {
  const p: RP = {}
  if (!rPr) return p
  for (const c of els(rPr)) {
    if (c.namespaceURI !== NS) continue
    switch (c.localName) {
      case 'b': p.b = isOn(c); break
      case 'i': p.i = isOn(c); break
      case 'u': p.u = attr(c, 'val') !== 'none'; break
      case 'strike': case 'dstrike': p.strike = isOn(c); break
      case 'caps': p.caps = isOn(c); break
      case 'vanish': p.vanish = isOn(c); break
      case 'vertAlign': { const v = attr(c, 'val'); p.sup = v === 'superscript'; p.sub = v === 'subscript'; break }
      case 'color': {
        const v = attr(c, 'val'), tc = attr(c, 'themeColor')
        p.color = v && v !== 'auto' ? hex(v) : tc && THEME_CLR[tc] && theme.colors[THEME_CLR[tc]] ? theme.colors[THEME_CLR[tc]] : v === 'auto' ? null : undefined
        break
      }
      case 'sz': { const n = Number(attr(c, 'val')); if (n > 0) p.pt = n / 2; break }
      case 'rFonts': {
        const th = attr(c, 'asciiTheme') ?? attr(c, 'hAnsiTheme')
        const raw = attr(c, 'ascii') ?? attr(c, 'hAnsi') ?? (th ? (th.startsWith('major') ? theme.major : theme.minor) : undefined) ?? undefined
        if (raw) p.font = raw
        break
      }
      case 'highlight': { const v = attr(c, 'val'); p.hl = !v || v === 'none' ? null : HIGHLIGHT[v] ?? null; break }
      case 'shd': { const f = attr(c, 'fill'); p.shd = f && f !== 'auto' ? hex(f) : null; break }
    }
  }
  return p
}

interface Style { id: string; type: string; name: string; basedOn?: string; rPr: RP; jc?: string; numId?: string; ilvl?: number; outline?: number }

export interface DocxResult { html: string; images: number; skippedImages: number }

export async function docxToHtml(file: File | ArrayBuffer, upload: (f: File) => Promise<string>): Promise<DocxResult> {
  const zip = await JSZip.loadAsync(file instanceof ArrayBuffer ? file : await file.arrayBuffer())
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? ''
  const parse = (xml: string) => (xml ? new DOMParser().parseFromString(xml, 'application/xml') : null)
  const body = parse(await read('word/document.xml'))?.getElementsByTagNameNS(NS, 'body')[0]
  if (!body) throw new Error('This isn’t a Word document I can read.')
  const theme = readTheme(parse(await read('word/theme/theme1.xml')))
  const stylesDoc = parse(await read('word/styles.xml'))
  const numDoc = parse(await read('word/numbering.xml'))
  const relsDoc = parse(await read('word/_rels/document.xml.rels'))

  const rels = new Map<string, { target: string; external: boolean }>()
  if (relsDoc) for (const r of Array.from(relsDoc.getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') ?? '', { target: r.getAttribute('Target') ?? '', external: r.getAttribute('TargetMode') === 'External' })

  // ── styles ──
  const styles = new Map<string, Style>()
  let defaults: RP = {}
  if (stylesDoc) {
    const dd = stylesDoc.getElementsByTagNameNS(NS, 'docDefaults')[0]
    defaults = parseRPr(kid(kid(dd, 'rPrDefault'), 'rPr'), theme)
    for (const s of Array.from(stylesDoc.getElementsByTagNameNS(NS, 'style'))) {
      const id = attr(s, 'styleId'); if (!id) continue
      const pPr = kid(s, 'pPr'), np = kid(pPr, 'numPr')
      styles.set(id, { id, type: attr(s, 'type') ?? '', name: attr(kid(s, 'name'), 'val') ?? id, basedOn: attr(kid(s, 'basedOn'), 'val') ?? undefined, rPr: parseRPr(kid(s, 'rPr'), theme),
        jc: attr(kid(pPr, 'jc'), 'val') ?? undefined, numId: attr(kid(np, 'numId'), 'val') ?? undefined, ilvl: kid(np, 'ilvl') ? Number(attr(kid(np, 'ilvl'), 'val')) : undefined, outline: kid(pPr, 'outlineLvl') ? Number(attr(kid(pPr, 'outlineLvl'), 'val')) : undefined })
    }
  }
  const chain = (id?: string): Style[] => { const out: Style[] = []; let cur = id ? styles.get(id) : undefined; while (cur && out.length < 12) { out.unshift(cur); cur = cur.basedOn ? styles.get(cur.basedOn) : undefined } return out }
  const styleRP = (id?: string) => merge(...chain(id).map((s) => s.rPr))
  const styleP = (id?: string) => { const c = chain(id); const last = <K extends keyof Style>(k: K) => [...c].reverse().find((s) => s[k] !== undefined)?.[k]; return { jc: last('jc') as string | undefined, numId: last('numId') as string | undefined, ilvl: last('ilvl') as number | undefined, outline: last('outline') as number | undefined, name: c[c.length - 1]?.name ?? '' } }

  // ── numbering: which list ids are bulleted ──
  const levelFmt = new Map<string, string>()   // `${numId}:${ilvl}` -> numFmt
  if (numDoc) {
    const abstract = new Map<string, Map<number, string>>()
    for (const a of Array.from(numDoc.getElementsByTagNameNS(NS, 'abstractNum'))) {
      const m = new Map<number, string>()
      for (const l of kids(a, 'lvl')) m.set(Number(attr(l, 'ilvl')), attr(kid(l, 'numFmt'), 'val') ?? 'decimal')
      abstract.set(attr(a, 'abstractNumId') ?? '', m)
    }
    for (const n of Array.from(numDoc.getElementsByTagNameNS(NS, 'num'))) {
      const m = abstract.get(attr(kid(n, 'abstractNumId'), 'val') ?? '')
      m?.forEach((fmt, lvl) => levelFmt.set(`${attr(n, 'numId')}:${lvl}`, fmt))
    }
  }
  const listTag = (numId: string, lvl: number): 'ul' | 'ol' => { const f = levelFmt.get(`${numId}:${lvl}`); return f && f !== 'bullet' && f !== 'none' ? 'ol' : 'ul' }

  // ── pictures ──
  const imgCache = new Map<string, string>()
  const stats = { images: 0, skipped: 0 }
  const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
  const picture = async (drawing: El): Promise<string> => {
    const blip = drawing.getElementsByTagNameNS(A, 'blip')[0]
    const rid = blip ? attr(blip, 'embed', R) : null
    const rel = rid ? rels.get(rid) : undefined
    if (!rel || rel.external) { stats.skipped++; return '' }
    const path = 'word/' + rel.target.replace(/^\/?(word\/)?/, '')
    const ext = path.split('.').pop()!.toLowerCase()
    if (!MIME[ext] || stats.images >= 100) { stats.skipped++; return '' }
    let src = imgCache.get(path)
    if (!src) {
      const f = zip.file(path); if (!f) { stats.skipped++; return '' }
      try { src = await upload(new File([await f.async('arraybuffer')], `image.${ext === 'jpeg' ? 'jpg' : ext}`, { type: MIME[ext] })); imgCache.set(path, src) } catch { stats.skipped++; return '' }
    }
    stats.images++
    const cx = Number(drawing.getElementsByTagNameNS(WP, 'extent')[0]?.getAttribute('cx')) || 0
    const w = cx ? Math.min(MAX_IMG_W, Math.max(24, Math.round(cx / EMU_PX))) : undefined
    const alt = drawing.getElementsByTagNameNS(WP, 'docPr')[0]?.getAttribute('descr') ?? ''
    return `<img src="${esc(src)}"${w ? ` width="${w}"` : ''} alt="${esc(alt)}">`
  }

  // ── runs ──
  const SAFE_HREF = /^(https?:|mailto:)/i
  const marks = (p: RP): { open: string; close: string } => {
    const css: string[] = []
    if (p.color && p.color !== '#000000') css.push(`color: ${p.color}`)
    if (p.pt && Math.abs(p.pt - EDITOR_PT) > 0.01 && p.pt >= 4 && p.pt <= 200) css.push(`font-size: ${+p.pt.toFixed(1)}pt`)
    const font = resolveFont(p.font); if (font) css.push(`font-family: '${font}'`)
    let open = css.length ? `<span style="${css.join('; ')}">` : '', close = css.length ? '</span>' : ''
    const wrap = (tag: string, on?: boolean, attrs = '') => { if (on) { open += `<${tag}${attrs}>`; close = `</${tag}>` + close } }
    const bg = p.hl ?? p.shd
    if (bg && bg !== '#ffffff') wrap('mark', true, ` data-color="${bg}" style="background-color: ${bg}"`)
    wrap('strong', p.b); wrap('em', p.i); wrap('u', p.u); wrap('s', p.strike); wrap('sup', p.sup); wrap('sub', p.sub)
    return { open, close }
  }

  const runsOf = async (container: El, pStyle: string | undefined, isHeading: boolean, inLink: boolean): Promise<string> => {
    let out = ''
    let group: { sig: string; rp: RP; html: string } | null = null
    const flush = () => { if (group && group.html) { const m = marks(group.rp); out += m.open + group.html + m.close } group = null }
    const push = (rp: RP, html: string) => { if (!html) return; const sig = JSON.stringify(rp); if (group && group.sig === sig) group.html += html; else { flush(); group = { sig, rp, html } } }
    const effective = (r: El): RP => {
      const rPr = kid(r, 'rPr'), rs = attr(kid(rPr, 'rStyle'), 'val') ?? undefined
      const direct = parseRPr(rPr, theme)
      let ps = styleRP(pStyle)
      let base: RP = defaults
      if (isHeading) { base = { ...defaults, pt: undefined, b: undefined }; ps = { ...ps, pt: undefined, b: undefined } }   // headings keep the editor's own heading size and weight
      const cs = rs && !(inLink && /hyperlink/i.test(rs)) ? styleRP(rs) : undefined
      const rp = merge(base, ps, cs, direct)
      if (inLink) { rp.u = direct.u ?? false; if (!direct.color) rp.color = null }   // the link already looks like a link
      return rp
    }
    const handle = async (r: El) => {
      if (r.namespaceURI !== NS) return
      const ln = r.localName
      if (ln === 'r') {
        const rp = effective(r)
        if (rp.vanish) return
        let html = ''
        for (const c of els(r)) {
          if (c.namespaceURI === NS) {
            if (c.localName === 't') { let t = c.textContent ?? ''; if (rp.caps) t = t.toUpperCase(); html += esc(t).replace(/ {2,}/g, (m) => ' ' + ' '.repeat(m.length - 1)) }
            else if (c.localName === 'tab') html += '    '
            else if (c.localName === 'br') { if ((attr(c, 'type') ?? 'textWrapping') === 'textWrapping') html += '<br>' }
            else if (c.localName === 'cr') html += '<br>'
            else if (c.localName === 'noBreakHyphen') html += '-'
            else if (c.localName === 'drawing') { flush(); push(rp, ''); out += await picture(c) }
          } else if (c.localName === 'AlternateContent') { for (const d of Array.from(c.getElementsByTagNameNS(NS, 'drawing')).slice(0, 1)) { flush(); out += await picture(d) } }
        }
        push(rp, html)
      } else if (ln === 'hyperlink') {
        flush()
        const rid = attr(r, 'id', R), rel = rid ? rels.get(rid) : undefined
        const href = rel?.external && SAFE_HREF.test(rel.target) ? rel.target : null
        const inner = await runsOf(r, pStyle, isHeading, true)
        out += href ? `<a href="${esc(href)}">${inner}</a>` : inner
      } else if (ln === 'ins' || ln === 'smartTag' || ln === 'sdt' || ln === 'sdtContent' || ln === 'fldSimple' || ln === 'customXml') {
        for (const c of els(r)) await handle(c)
      }
    }
    for (const c of els(container)) await handle(c)
    flush()
    return out
  }

  // ── blocks ──
  const alignOf = (jc?: string) => (jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : null)

  const blocks = async (parent: El): Promise<string> => {
    let html = ''
    const stack: { tag: 'ul' | 'ol' }[] = []
    const closeTo = (depth: number) => { while (stack.length > depth) html += `</li></${stack.pop()!.tag}>` }
    const visit = async (n: El) => {
      if (n.namespaceURI !== NS) return
      if (n.localName === 'sdt') { for (const c of els(kid(n, 'sdtContent'))) await visit(c); return }
      if (n.localName === 'tbl') { closeTo(0); html += await table(n); return }
      if (n.localName !== 'p') return
      const pPr = kid(n, 'pPr'), sid = attr(kid(pPr, 'pStyle'), 'val') ?? undefined
      const sp = styleP(sid)
      const nameKey = (sp.name || '').toLowerCase()
      let level = 0
      const hm = /^heading\s*([1-9])$/.exec(nameKey)
      if (hm) level = Number(hm[1]); else if (nameKey === 'title') level = 1; else if (nameKey === 'subtitle') level = 2
      else if (sp.outline !== undefined && sp.outline < 6 && !kid(kid(pPr, 'numPr'), 'numId')) level = sp.outline + 1
      if (level > 6) level = 0
      const np = kid(pPr, 'numPr')
      const numId = attr(kid(np, 'numId'), 'val') ?? sp.numId
      const ilvl = np && kid(np, 'ilvl') ? Number(attr(kid(np, 'ilvl'), 'val')) : sp.ilvl ?? 0
      const inner = await runsOf(n, sid, level > 0, false)
      const jc = attr(kid(pPr, 'jc'), 'val') ?? sp.jc, al = alignOf(jc || undefined)
      const style = al ? ` style="text-align: ${al}"` : ''
      if (numId && numId !== '0' && !level) {
        const tag = listTag(numId, ilvl), depth = Math.min(ilvl, 5) + 1
        if (stack.length > depth) closeTo(depth)
        if (stack.length === depth) { html += '</li>'; if (stack[depth - 1].tag !== tag) { html += `</${stack.pop()!.tag}><${tag}>`; stack.push({ tag }) } }
        while (stack.length < depth) { const t = stack.length === depth - 1 ? tag : 'ul'; html += `<${t}>${stack.length === depth - 1 ? '' : '<li>'}`; stack.push({ tag: t }) }
        html += `<li><p${style}>${inner}</p>`
        return
      }
      closeTo(0)
      const quote = /^(quote|intense quote|block text)$/.test(nameKey)
      if (level) html += `<h${level}${style}>${inner}</h${level}>`
      else if (quote) html += `<blockquote><p${style}>${inner}</p></blockquote>`
      else html += `<p${style}>${inner}</p>`
    }
    for (const c of els(parent)) await visit(c)
    closeTo(0)
    return html
  }

  const table = async (tbl: El): Promise<string> => {
    const rows = kids(tbl, 'tr')
    type Cell = { el: El; col: number; span: number; extra: number; vm: string | null; rowspan: number; skip: boolean }
    const num = (e: El | undefined) => Number(attr(e, 'val')) || 0
    const after = rows.map((tr) => num(kid(kid(tr, 'trPr'), 'gridAfter')))
    const grid: Cell[][] = rows.map((tr) => {
      let col = num(kid(kid(tr, 'trPr'), 'gridBefore'))   // a row can start further along the grid
      return kids(tr, 'tc').map((tc) => { const tcPr = kid(tc, 'tcPr'); const span = Number(attr(kid(tcPr, 'gridSpan'), 'val')) || 1; const vmEl = kid(tcPr, 'vMerge'); const c: Cell = { el: tc, col, span, extra: 0, vm: vmEl ? attr(vmEl, 'val') ?? 'continue' : null, rowspan: 1, skip: false }; col += span; return c })
    })
    // Word lets some rows have fewer cells (or start later / end earlier). The editor's tables are rectangular, so the first and last
    // cell of a short row stretch over the gap: the result still has the same cells in the same places, just without phantom empty ones.
    const total = Math.max(kids(kid(tbl, 'tblGrid'), 'gridCol').length, ...grid.map((row, i) => (row.length ? row[row.length - 1].col + row[row.length - 1].span : 0) + after[i]), 1)
    grid.forEach((row) => {
      if (!row.length) return
      const first = row[0], last = row[row.length - 1]
      if (first.col > 0 && !first.skip) first.extra += first.col
      const end = last.col + last.span
      if (total > end && last.vm !== 'continue') last.extra += total - end
    })
    grid.forEach((row, ri) => row.forEach((c) => {
      if (c.vm === 'continue') { c.skip = true; return }
      if (c.vm === 'restart') for (let r2 = ri + 1; r2 < grid.length; r2++) { const below = grid[r2].find((x) => x.col === c.col); if (below?.vm === 'continue') c.rowspan++; else break }
    }))
    let out = '<table><tbody>'
    for (const row of grid) {
      out += '<tr>'
      for (const c of row) {
        if (c.skip) continue
        const fill = hex(attr(kid(kid(c.el, 'tcPr'), 'shd'), 'fill'))
        const inner = (await blocks(c.el)) || '<p></p>'
        const span = c.span + c.extra
        out += `<td${span > 1 ? ` colspan="${span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${fill && fill !== '#ffffff' ? ` data-bg="${fill}" style="background-color: ${fill}"` : ''}>${inner}</td>`
      }
      out += '</tr>'
    }
    return out + '</tbody></table>'
  }

  const html = await blocks(body)
  return { html, images: stats.images, skippedImages: stats.skipped }
}
