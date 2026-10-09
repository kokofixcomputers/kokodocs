// Reading a photo of a page on this device. The main reader finds the lines of text wherever they are in the photo (a desk or a table is not
// text, so it is skipped). If the page can be found cleanly, lines outside it are dropped, and a strongly tilted page is flattened and read
// again, keeping whichever reading is better. A page edge is never trusted blindly: text is only ever dropped if the page was found AND
// nearly all the text lies inside it.
import { LANGS, readLocally, textToHtml } from './ocr'
import { findPage, flatten, type Found, type Pt } from './page'
import { detectLines, layout, lineCenter, score, type Kind, type Line } from './paddle'

export interface Photo { bmp: ImageBitmap; found: Found; file: Blob }
const SIDE = 1800

export async function openPhoto(file: Blob): Promise<Photo> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { throw new Error('This browser can’t open that picture. Try a JPEG or PNG (iPhone HEIC photos can be shared as JPEG).') }
  return { bmp, found: findPage(bmp), file }
}

function scaled(bmp: ImageBitmap, side: number): { canvas: HTMLCanvasElement; k: number } {
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height)
  return { canvas: c, k }
}

const inside = (p: Pt, q: Pt[]) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c) } } return true }
const grow = (q: Pt[], f: number): Pt[] => { const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4; return q.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f })) }
/** Is the page noticeably in perspective or turned? Then flattening it is worth a second reading. */
function tilted(q: Pt[]): boolean {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y), [tl, tr, br, bl] = q
  const w = [d(tl, tr), d(bl, br)], h = [d(tl, bl), d(tr, br)]
  const skew = Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x)) * 180 / Math.PI
  return Math.abs(w[0] - w[1]) / Math.max(...w) > 0.07 || Math.abs(h[0] - h[1]) / Math.max(...h) > 0.07 || skew > 4
}

/** `classic` is true when the main reader couldn't run (its files aren't installed here, or the browser can't run it) and the classic one was used instead. */
export async function readPhoto(photo: Photo, o: { lang: string; quad?: Pt[] | null; onProgress?: (what: string) => void }): Promise<{ html: string; classic: boolean }> {
  const lang = LANGS.find((l) => l.id === o.lang) ?? LANGS[0]
  if (lang.engine === 'tess') return { html: textToHtml(await readLocally(photo.file, lang.id, (p, s) => o.onProgress?.(s === 'recognizing text' ? `Reading the page… ${Math.round(p * 100)}%` : 'Getting the reader ready…'))), classic: false }
  const kind: Kind = lang.engine
  let failed = false
  try {
    const say = o.onProgress ?? (() => {})
    say('Getting the reader ready…')
    let lines: Line[]
    if (o.quad) {   // the person chose the page's corners: read exactly that, flattened
      say('Reading the page…')
      lines = await detectLines(flatten(photo.bmp, o.quad, SIDE), kind)
    } else {
      const { canvas, k } = scaled(photo.bmp, SIDE)
      say('Reading the page…')
      lines = await detectLines(canvas, kind)
      const f = photo.found
      if (f.confident && !f.whole && lines.length) {
        const q = grow(f.quad.map((p) => ({ x: p.x * k, y: p.y * k })), 1.04)
        const within = lines.filter((l) => inside(lineCenter(l), q))
        if (within.length >= 0.85 * lines.length) {   // the page edge agrees with where the text is: trust it
          lines = within
          const sure = lines.reduce((m, l) => m + l.mean, 0) / lines.length
          if (tilted(f.quad) && sure < 0.93) {   // read a second time only when the first reading wasn't clearly good
            say('Straightening the page…')
            const again = await detectLines(flatten(photo.bmp, f.quad, SIDE), kind)
            if (score(again) > score(lines)) lines = again
          }
        }
      }
    }
    const text = layout(lines)
    if (text) return { html: textToHtml(text), classic: false }
  } catch (e) { console.warn('The main reader failed; using the classic one.', e); failed = true }
  o.onProgress?.('Trying the classic reader…')
  return { html: textToHtml(await readLocally(photo.file, lang.id)), classic: failed }
}
