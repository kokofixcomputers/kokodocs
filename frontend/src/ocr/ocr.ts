// Reading text from a photo of a page, on this device. The reader (Tesseract) and the English data are served by this app itself (see
// scripts/copy-ocr.mjs), so it works offline and the picture never leaves the browser. Other languages' data are fetched the first time from a CDN.
import type { Worker } from 'tesseract.js'

export const LANGS: { id: string; label: string }[] = [
  { id: 'eng', label: 'English' }, { id: 'spa', label: 'Spanish' }, { id: 'fra', label: 'French' }, { id: 'deu', label: 'German' }, { id: 'ita', label: 'Italian' },
  { id: 'por', label: 'Portuguese' }, { id: 'nld', label: 'Dutch' }, { id: 'pol', label: 'Polish' }, { id: 'rus', label: 'Russian' }, { id: 'tur', label: 'Turkish' },
  { id: 'ara', label: 'Arabic' }, { id: 'hin', label: 'Hindi' }, { id: 'jpn', label: 'Japanese' }, { id: 'kor', label: 'Korean' }, { id: 'chi_sim', label: 'Chinese (simplified)' },
]

export interface OcrPrefs { via: 'local' | 'ai'; lang: string; model: string }
const KEY = 'koko.ocr'
export function loadPrefs(): OcrPrefs {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p && (p.via === 'local' || p.via === 'ai')) return { via: p.via, lang: p.lang || 'eng', model: p.model || '' } } catch { /* defaults */ }
  return { via: 'local', lang: 'eng', model: '' }
}
export const savePrefs = (p: OcrPrefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* not remembered */ } }

/** A photo made ready to read: upright (phones store photos sideways with a flag), no bigger than needed, as a JPEG. `clean` also boosts contrast. */
export async function prepare(file: Blob, maxSide: number, clean = false, quality = 0.9): Promise<Blob> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { throw new Error('This browser can’t open that picture. Try a JPEG or PNG (iPhone HEIC photos can be shared as JPEG).') }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  if (clean) g.filter = 'grayscale(1) contrast(1.2)'
  g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close()
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The picture couldn’t be prepared'))), 'image/jpeg', quality))
}

/** What went wrong, in words. The reader's own failures arrive as plain strings or browser events, not as Errors. */
export function describe(e: unknown): string {
  console.error('Scan a page failed:', e)
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') { const m = (e as { message?: unknown; error?: unknown }); if (typeof m.message === 'string' && m.message) return m.message; if (m.error) return describe(m.error) }
  return ''
}

/** The files the reader needs must really be served here. A missing one often comes back as the app's own page (HTML) with a 200, which
 *  then fails far from the cause with no message at all. Only the headers are read, so this is quick. */
async function checkFiles(lang: string) {
  const base = location.origin + '/ocr'
  const need = [`${base}/worker.min.js`, `${base}/tesseract-core-lstm.wasm.js`, ...(lang === 'eng' ? [`${base}/lang/eng.traineddata.gz`] : [])]
  for (const url of need) {
    let r: Response
    try { r = await fetch(url, { cache: 'no-store' }) } catch { throw new Error('The on-device reader couldn\u2019t be downloaded (the connection failed). Check your connection and try again.') }
    void r.body?.cancel()
    if (!r.ok || /text\/html/i.test(r.headers.get('content-type') ?? '')) {
      throw new Error(`The on-device reader isn't installed on this server (${url.replace(location.origin, '')} is missing). The app needs to be updated with the newest build, which includes the /ocr folder.`)
    }
  }
}

let live: { lang: string; worker: Promise<Worker>; timer?: number } | null = null
let report: ((p: number, what: string) => void) | null = null

async function workerFor(lang: string, gzip = true): Promise<Worker> {
  if (live && live.lang === lang) { window.clearTimeout(live.timer); return live.worker }
  await checkFiles(lang)
  if (live) { const old = live.worker; live = null; void old.then((w) => w.terminate()).catch(() => {}) }
  const { createWorker } = await import('tesseract.js')
  const base = location.origin + '/ocr'
  const worker = createWorker(lang, 1, {
    workerPath: `${base}/worker.min.js`, corePath: base,
    langPath: lang === 'eng' ? `${base}/lang` : `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`,
    gzip,
    logger: (m: { status: string; progress: number }) => report?.(m.progress ?? 0, m.status),
  })
  live = { lang, worker }
  worker.catch(() => { if (live?.worker === worker) live = null })
  try { return await worker } catch (e) {
    if (live?.worker === worker) live = null
    // a server that adds "Content-Encoding: gzip" to .gz files has already unpacked the language data: try again without unpacking it ourselves
    if (gzip && lang === 'eng' && /header|gzip|inflate|incorrect/i.test(describe(e))) return workerFor(lang, false)
    throw e
  }
}

/** Read the text in a picture. The reader stays loaded for a minute, so scanning several pages in a row is quick. */
export async function readLocally(img: Blob, lang: string, onProgress?: (p: number, what: string) => void): Promise<string> {
  report = onProgress ?? null
  try {
    const w = await workerFor(lang)
    const r = await Promise.race([
      w.recognize(await prepare(img, 2600, true, 0.95)),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('Reading the page took too long. Try a smaller or clearer picture.')), 180_000)),
    ])
    return r.data.text
  } catch (e) {
    if (live) { const old = live.worker; live = null; void old.then((w) => w.terminate()).catch(() => {}) }   // start fresh next time
    throw new Error(describe(e) || 'The on-device reader failed to start. Try again, or use the AI provider.')
  } finally {
    report = null
    if (live) { window.clearTimeout(live.timer); const mine = live; live.timer = window.setTimeout(() => { if (live === mine) { live = null; void mine.worker.then((w) => w.terminate()).catch(() => {}) } }, 60_000) }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Plain recognised text to paragraphs: lines that are only wrapped are joined, blank lines separate paragraphs. */
export function textToHtml(text: string): string {
  return text.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')
}
