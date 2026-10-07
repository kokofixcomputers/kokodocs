import { fontCssUrl } from '../fonts'
import { DEFAULT_META, PAGE_SIZES, type PageMeta } from '../editor/Pagination'
import { emojiSvgText } from '../emoji'
import { EXPORT_ASSET_CSS, bundleEmoji, calloutIconCss } from './htmlAssets'
import { escapeHtml, toDataUrl } from './util'

/** Look of a document outside the editor (HTML export and the print/PDF view). */
export const DOC_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f4f4f6; color: #111; font: 400 11pt/1.55 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.page { max-width: 816px; margin: 32px auto; padding: 96px; background: #fff; border-radius: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.page > :first-child { margin-top: 0; }
p { margin: 0 0 .75em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 0 0 .5em; font-weight: 700; letter-spacing: -.01em; break-after: avoid; }
h1 { font-size: 26pt; } h2 { font-size: 20pt; } h3 { font-size: 16pt; } h4 { font-size: 14pt; } h5 { font-size: 12pt; } h6 { font-size: 11pt; color: #666; }
a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
ul, ol { padding-left: 1.5em; margin: 0 0 .75em; } li > p { margin-bottom: .25em; }
ul[data-type="taskList"] { list-style: none; padding-left: 2px; }
ul[data-type="taskList"] li { display: flex; gap: 10px; align-items: flex-start; } ul[data-type="taskList"] li > label { margin-top: .25em; }
ul[data-type="taskList"] li > div { flex: 1; } li[data-checked="true"] > div { text-decoration: line-through; opacity: .55; }
input[type="checkbox"] { width: 14px; height: 14px; accent-color: #111; margin: 0; }
.callout { --cc: #6b7280; --cb: #f3f4f6; margin: 0 0 .75em; padding: 10px 14px; border-radius: 10px; border-left: 4px solid var(--cc); background: var(--cb); }
.callout::before { content: attr(data-title); display: block; font-weight: 700; margin-bottom: 4px; color: var(--cc); }
.callout[data-callout=tip] { --cc: #0d9488; --cb: #f0fdfa; } .callout[data-callout=success] { --cc: #16a34a; --cb: #f0fdf4; }
.callout[data-callout=info] { --cc: #2563eb; --cb: #eff6ff; } .callout[data-callout=warning] { --cc: #d97706; --cb: #fffbeb; }
.callout[data-callout=danger] { --cc: #dc2626; --cb: #fef2f2; } .callout[data-callout=question] { --cc: #7c3aed; --cb: #f5f3ff; }
blockquote { margin: 0 0 .75em; padding: 4px 0 4px 18px; border-left: 4px solid #a3a3a3; color: #555; }
code { font-family: ui-monospace, 'JetBrains Mono', monospace; background: #f0f0f0; padding: 2px 6px; border-radius: 6px; font-size: .9em; }
pre { background: #1c1b30; color: #e8e6ff; padding: 14px 18px; border-radius: 14px; overflow: auto; break-inside: avoid; } pre code { background: none; color: inherit; padding: 0; }
hr { border: 0; height: 2px; background: #ddd; margin: 1.2em 0; }
mark { border-radius: 4px; padding: 0 2px; color: inherit; }
table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 0 0 .9em; border: 1px solid #ddd; border-radius: 14px; table-layout: fixed; }
td, th { padding: 8px 12px; border-right: 1px solid #ddd; border-bottom: 1px solid #ddd; vertical-align: top; }
th { background: #f0f0f4; font-weight: 600; text-align: left; } tr > :last-child { border-right: 0; } tr:last-child > * { border-bottom: 0; }
tr:first-child > :first-child { border-top-left-radius: 13px; } tr:first-child > :last-child { border-top-right-radius: 13px; }
tr:last-child > :first-child { border-bottom-left-radius: 13px; } tr:last-child > :last-child { border-bottom-right-radius: 13px; }
td > :last-child, th > :last-child { margin-bottom: 0; } tr { break-inside: avoid; }
img { max-width: 100%; height: auto; border-radius: 10px; vertical-align: bottom; }
.wk-tabs-block { margin: 0 0 .9em; } .wk-tab { border: 1px solid #ddd; border-radius: 12px; padding: 10px 14px; margin-bottom: 8px; } .wk-tab::before { content: attr(data-title); display: block; font-weight: 700; margin-bottom: 4px; }
.doc-shape { display: inline-block; vertical-align: bottom; line-height: 0; max-width: 100%; } .doc-shape svg { display: block; max-width: 100%; height: auto; overflow: visible; }
sub, sup { line-height: 0; }
`

/** CSS `content:` value for header/footer text, turning {page} / {pages} into page counters. */
function marginContent(text: string): string {
  const parts = text.split(/(\{page\}|\{pages\})/).filter(Boolean)
  return parts.map((p) => (p === '{page}' ? 'counter(page)' : p === '{pages}' ? 'counter(pages)' : `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)).join(' ') || '""'
}

function pageRules(meta: PageMeta, size: string, margin: string): string {
  const box = (pos: 'top' | 'bottom', text: string, align: string) => text.trim()
    ? `@${pos}-${align} { content: ${marginContent(text)}; font: 400 9pt 'Inter', sans-serif; color: #666; }` : ''
  return `@page { size: ${size}; margin: ${margin}; ${box('top', meta.header, meta.headerAlign)} ${box('bottom', meta.footer, meta.footerAlign)} }`
}

export interface HtmlOptions {
  title: string
  body: string
  fonts: string[]
  meta?: PageMeta
  /** 'print' = the print/PDF view (no screen card, real page margins); 'download' = a self-contained web page. */
  mode: 'download' | 'print'
  size?: string
  margin?: string
  css?: string
  embedImages?: boolean
}

export async function buildHtml(o: HtmlOptions): Promise<string> {
  let body = o.body
  if (o.embedImages) {
    const srcs = [...new Set([...body.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]))]
    const map = new Map<string, string>()
    await Promise.all(srcs.map(async (s) => { const abs = new URL(s.replace(/&amp;/g, '&'), location.href).href; const d = await toDataUrl(abs); if (d) map.set(s, d) }))
    body = body.replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (_m, a, s, b) => a + (map.get(s) ?? new URL(s.replace(/&amp;/g, '&'), location.href).href) + b)
  } else {
    body = body.replace(/(<img[^>]*\ssrc=")(\/[^"]+)(")/g, (_m, a, s, b) => a + new URL(s, location.href).href + b)
  }
  // emoji and callout icons travel inside the page: only the ones used, each written once
  const emo = await bundleEmoji(body, emojiSvgText)
  body = emo.html
  const assetCss = EXPORT_ASSET_CSS + calloutIconCss(body) + '\n' + emo.css
  const links = ['Inter', ...o.fonts].map((f) => (f === 'Inter' ? 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,400&display=swap' : fontCssUrl(f))).filter(Boolean)
    .map((u) => `<link rel="stylesheet" href="${u}">`).join('\n')
  const print = o.mode === 'print'
  const pm: PageMeta = { ...DEFAULT_META, header: '', footer: '', ...(o.meta ?? {}) }
  const printCss = print
    ? `${pageRules(pm, o.size ?? `${PAGE_SIZES[pm.size]?.css ?? 'letter'} ${pm.orientation}`, o.margin ?? `${pm.mt / 96}in ${pm.mr / 96}in ${pm.mb / 96}in ${pm.ml / 96}in`)}
body { background: #fff; } .page { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
a { color: inherit; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
    : '@media print { body { background: #fff; } .page { box-shadow: none; margin: 0; max-width: none; border-radius: 0; } }'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
${links}
<style>${DOC_CSS}${assetCss}${o.css ?? ''}${printCss}</style></head>
<body><main class="page">${body}</main></body></html>`
}
