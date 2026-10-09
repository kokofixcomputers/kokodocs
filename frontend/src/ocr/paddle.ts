// The on-device reader: PaddleOCR (PP-OCRv4 text finding + a reading model) running in the browser through ONNX Runtime. It finds where the
// lines of text are (so a desk, a table or a mug is simply not text and is skipped), then reads each line. Models and runtime are served by
// this app itself (see scripts/copy-ocr.mjs), so it works offline and the picture never leaves the browser.
import type Ocr from '@gutenye/ocr-browser'

export type Kind = 'en' | 'latin'
export interface Line { text: string; mean: number; box: number[][] }
const engines: Partial<Record<Kind, Promise<Ocr>>> = {}

/** A missing model comes back as the app's own page (HTML) with a 200; say so plainly instead of failing somewhere deep inside. */
async function needFiles(urls: string[]) {
  for (const url of urls) {
    const r = await fetch(url, { cache: 'force-cache' }).catch(() => { throw new Error('The on-device reader couldn\u2019t be downloaded (the connection failed).') })
    void r.body?.cancel()
    if (!r.ok || /text\/html/i.test(r.headers.get('content-type') ?? '')) throw new Error(`The on-device reader isn't installed on this server (${url.replace(location.origin, '')} is missing).`)
  }
}

async function load(kind: Kind): Promise<Ocr> {
  const b = `${location.origin}/ocr`
  await needFiles([`${b}/ort/ort-wasm-simd-threaded.wasm`, `${b}/paddle/ch_PP-OCRv4_det_infer.onnx`, `${b}/paddle/${kind === 'en' ? 'en_PP-OCRv4_rec_infer.onnx' : 'latin_PP-OCRv3_rec_infer.onnx'}`, `${b}/paddle/${kind}_dict.txt`])
  const [{ default: OcrCls }, ort] = await Promise.all([import('@gutenye/ocr-browser'), import('onnxruntime-web')])
  ort.env.wasm.wasmPaths = `${location.origin}/ocr/ort/`
  const base = `${location.origin}/ocr/paddle`
  return OcrCls.create({ models: {
    detectionPath: `${base}/ch_PP-OCRv4_det_infer.onnx`,
    recognitionPath: `${base}/${kind === 'en' ? 'en_PP-OCRv4_rec_infer.onnx' : 'latin_PP-OCRv3_rec_infer.onnx'}`,
    dictionaryPath: `${base}/${kind}_dict.txt`,
  } })
}
const engine = (kind: Kind) => (engines[kind] ??= load(kind).catch((e) => { delete engines[kind]; throw e }))

/** Every line of text found in the picture, with where it is and how sure the reader is. */
export async function detectLines(img: HTMLCanvasElement | Blob, kind: Kind): Promise<Line[]> {
  const ocr = await engine(kind)
  const blob = img instanceof Blob ? img : await new Promise<Blob>((res, rej) => img.toBlob((b) => (b ? res(b) : rej(new Error('The page couldn’t be prepared'))), 'image/png'))
  const url = URL.createObjectURL(blob)
  try {
    const r = await ocr.detect(url) as unknown as { texts: Line[] }
    return r.texts ?? []
  } finally { URL.revokeObjectURL(url) }
}

const center = (b: number[][]) => ({ x: b.reduce((s, p) => s + p[0], 0) / b.length, y: b.reduce((s, p) => s + p[1], 0) / b.length })
export const lineCenter = (l: Line) => center(l.box)
/** How much to believe a set of lines: more readable text, read with more confidence, scores higher. */
export const score = (lines: Line[]) => lines.reduce((s, l) => s + (l.mean > 0.45 ? l.text.length * l.mean : 0), 0)

/** Lines in reading order, as paragraphs. A tilted photo is straightened first (by the lines' own slope) so a heading isn't sorted after
 *  the first line of the paragraph just because that line's far end sits higher on the page. */
export function layout(lines: Line[], minMean = 0.45): string {
  const keep = lines.filter((l) => l.mean >= minMean && /[\p{L}\p{N}]/u.test(l.text) && l.box.length >= 4)
  if (!keep.length) return ''
  const slopes = keep.map((l) => { const [a, b] = l.box; return { w: Math.hypot(b[0] - a[0], b[1] - a[1]), a: Math.atan2(b[1] - a[1], b[0] - a[0]) } }).filter((s) => s.w > 40).map((s) => s.a).sort((x, y) => x - y)
  const skew = slopes.length ? slopes[slopes.length >> 1] : 0, cs = Math.cos(skew), sn = Math.sin(skew)
  const L = keep.map((l) => {
    const c = center(l.box), x = c.x * cs + c.y * sn, y = -c.x * sn + c.y * cs
    const h = (Math.hypot(l.box[3][0] - l.box[0][0], l.box[3][1] - l.box[0][1]) + Math.hypot(l.box[2][0] - l.box[1][0], l.box[2][1] - l.box[1][1])) / 2
    return { t: l.text.trim(), x, y, h: Math.max(8, h), top: y - h / 2, bottom: y + h / 2, left: x - Math.hypot(l.box[1][0] - l.box[0][0], l.box[1][1] - l.box[0][1]) / 2 }
  }).sort((a, b) => a.y - b.y)
  const med = [...L].map((l) => l.h).sort((a, b) => a - b)[L.length >> 1]
  const rows: typeof L[] = []
  for (const l of L) { const r = rows[rows.length - 1]; if (r && Math.abs(r[0].y - l.y) < med * 0.55) r.push(l); else rows.push([l]) }
  const paras: string[] = []; let para = '', prevBottom = -Infinity
  for (const r of rows) {
    r.sort((a, b) => a.left - b.left)
    const text = r.map((x) => x.t).join(' '), top = Math.min(...r.map((x) => x.top)), bottom = Math.max(...r.map((x) => x.bottom))
    if (para && top - prevBottom > med * 0.85) { paras.push(para); para = '' }
    para = !para ? text : /\w-$/.test(para) && /^[a-z]/.test(text) ? para.slice(0, -1) + text : `${para} ${text}`
    prevBottom = bottom
  }
  if (para) paras.push(para)
  return paras.join('\n\n')
}
