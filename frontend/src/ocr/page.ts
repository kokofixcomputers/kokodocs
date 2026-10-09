// Finding the page in a photo, so the reader looks only at it: not the desk, the table, the mug or the shadow. Then the page is flattened
// (the perspective undone, as if scanned). Plain pixel arithmetic, no libraries, all on this device.

export interface Pt { x: number; y: number }
/** Corners in the picture's own pixels, in order: top-left, top-right, bottom-right, bottom-left. */
export interface Found { quad: Pt[]; confident: boolean; whole: boolean }

const SMALL = 420

function gray(d: ImageData): Float32Array {
  const g = new Float32Array(d.width * d.height)
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d.data[p] + 0.587 * d.data[p + 1] + 0.114 * d.data[p + 2]
  return g
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) { tmp[y * w + x] = acc / n; acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)] }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x] }
  }
  return out
}

/** The brightness that best splits "page" from "everything else" (Otsu). */
function otsu(g: Float32Array): number {
  const hist = new Float64Array(256)
  for (const v of g) hist[Math.max(0, Math.min(255, v | 0))]++
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0, sB = 0, best = 0, t = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue
    const wF = g.length - wB; if (!wF) break
    sB += i * hist[i]
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2
    if (v > best) { best = v; t = i }
  }
  return t
}

/** The biggest connected blob, with its holes filled in (printed text leaves holes in a page). */
function biggestBlob(mask: Uint8Array, w: number, h: number): { pix: Uint8Array; area: number } | null {
  const label = new Int32Array(w * h), stack: number[] = []
  let best = -1, bestArea = 0, id = 0
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue
    id++; let area = 0; stack.push(s); label[s] = id
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p / w) | 0; area++
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1) }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w) }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w) }
    }
    if (area > bestArea) { bestArea = area; best = id }
  }
  if (best < 0) return null
  const pix = new Uint8Array(w * h)
  for (let i = 0; i < pix.length; i++) pix[i] = label[i] === best ? 1 : 0
  // everything that can't be reached from the border without crossing the blob is inside it
  const out = new Uint8Array(w * h).fill(1), q: number[] = []
  const seed = (p: number) => { if (!pix[p] && out[p]) { out[p] = 0; q.push(p) } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (q.length) {
    const p = q.pop()!, x = p % w, y = (p / w) | 0
    if (x > 0) seed(p - 1); if (x < w - 1) seed(p + 1); if (y > 0) seed(p - w); if (y < h - 1) seed(p + w)
  }
  let filled = 0; for (let i = 0; i < out.length; i++) filled += out[i]
  return { pix: out, area: filled }
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y), lo: Pt[] = [], up: Pt[] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}
const polyArea = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + (a.x * b.y - b.x * a.y) }, 0)) / 2
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Four corners from a blob: the points furthest toward each diagonal. Good for pages photographed from a reasonable angle. */
function corners(pix: Uint8Array, w: number, h: number): Pt[] {
  const edge: Pt[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!pix[y * w + x]) continue
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !pix[y * w + x - 1] || !pix[y * w + x + 1] || !pix[(y - 1) * w + x] || !pix[(y + 1) * w + x]) edge.push({ x, y })
  }
  const H = hull(edge)
  const pick = (f: (p: Pt) => number) => H.reduce((a, b) => (f(b) > f(a) ? b : a))
  return [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => -p.x + p.y)]
}

function wholeImage(w: number, h: number): Found { return { quad: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], confident: false, whole: true } }

/** Find the page in a photo. `confident` is true when it looks like a clean, page-shaped, page-sized region; otherwise the person should check the corners. */
export function findPage(bmp: ImageBitmap): Found {
  const k = Math.min(1, SMALL / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g2 = c.getContext('2d', { willReadFrequently: true })!; g2.drawImage(bmp, 0, 0, w, h)
  const g = boxBlur(gray(g2.getImageData(0, 0, w, h)), w, h, 3), t = otsu(g)
  let best: { quad: Pt[]; score: number; solid: number; frac: number } | null = null
  for (const bright of [true, false]) {   // a light page on a dark desk, or (less often) the other way round
    const mask = new Uint8Array(w * h)
    for (let i = 0; i < mask.length; i++) mask[i] = (g[i] > t) === bright ? 1 : 0
    const blob = biggestBlob(mask, w, h); if (!blob) continue
    const frac = blob.area / (w * h)
    if (frac < 0.12) continue
    const quad = corners(blob.pix, w, h), qa = polyArea(quad), solid = qa ? blob.area / qa : 0
    const score = Math.min(1, solid) * (frac > 0.97 ? 0.5 : 1) * Math.sqrt(frac)
    if (!best || score > best.score) best = { quad, score, solid, frac }
  }
  if (!best) return wholeImage(bmp.width, bmp.height)
  if (best.frac > 0.97) return { ...wholeImage(bmp.width, bmp.height), confident: true }   // the page already fills the photo
  const q = best.quad.map((p) => ({ x: p.x / k, y: p.y / k }))
  const ang = q.map((p, i) => { const a = q[(i + 3) % 4], b = q[(i + 1) % 4]; const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y }; return Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)) * 180 / Math.PI })
  const sane = ang.every((a) => a > 50 && a < 130) && q.every((p, i) => dist(p, q[(i + 1) % 4]) > 0.1 * Math.max(bmp.width, bmp.height))
  return { quad: q, confident: sane && best.solid > 0.88 && best.solid < 1.12 && best.frac > 0.2, whole: false }
}

// ── flattening ──
/** Solve for the 3x3 perspective transform taking the four `from` points to the four `to` points (rows of 8 unknowns, Gauss elimination). */
function homography(from: Pt[], to: Pt[]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]); A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let i = 0; i < 8; i++) {
    let m = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r
    ;[A[i], A[m]] = [A[m], A[i]]
    for (let r = 0; r < 8; r++) if (r !== i) { const f = A[r][i] / (A[i][i] || 1e-12); for (let c = i; c < 9; c++) A[r][c] -= f * A[i][c] }
  }
  return [...Array.from({ length: 8 }, (_, i) => A[i][8] / (A[i][i] || 1e-12)), 1]
}

/** The page as a flat, upright picture: the quad stretched to a rectangle, no bigger than `maxSide` on its longest side. */
export function flatten(bmp: ImageBitmap, quad: Pt[], maxSide = 2400): HTMLCanvasElement {
  const [tl, tr, br, bl] = quad
  let W = Math.max(dist(tl, tr), dist(bl, br)), Hh = Math.max(dist(tl, bl), dist(tr, br))
  const k = Math.min(1, maxSide / Math.max(W, Hh)); W = Math.max(16, Math.round(W * k)); Hh = Math.max(16, Math.round(Hh * k))
  const ks = Math.min(1, 3600 / Math.max(bmp.width, bmp.height))   // sample from a copy no bigger than needed
  const sc = document.createElement('canvas'); sc.width = Math.round(bmp.width * ks); sc.height = Math.round(bmp.height * ks)
  const sg = sc.getContext('2d', { willReadFrequently: true })!; sg.drawImage(bmp, 0, 0, sc.width, sc.height)
  const src = sg.getImageData(0, 0, sc.width, sc.height), sw = sc.width, sh = sc.height
  const H = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }], quad.map((p) => ({ x: p.x * ks, y: p.y * ks })))
  const out = document.createElement('canvas'); out.width = W; out.height = Hh
  const og = out.getContext('2d')!, od = og.createImageData(W, Hh), d = od.data, s = src.data
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const z = H[6] * x + H[7] * y + 1, u = (H[0] * x + H[1] * y + H[2]) / z, v = (H[3] * x + H[4] * y + H[5]) / z
    const o = (y * W + x) * 4
    if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = 255; continue }
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4
    for (let c = 0; c < 3; c++) d[o + c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy
    d[o + 3] = 255
  }
  og.putImageData(od, 0, 0)
  return out
}
