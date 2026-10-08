// Pictures in encrypted documents. A picture is encrypted here, the ciphertext is stored under a random name, and the document holds
// the address /api/zk/img/<name>. To show one, the browser downloads those bytes, opens them with the document's key and gives the
// <img> a local blob: address instead.
import * as Y from 'yjs'
import { rawFetch } from '../api'
import { open256, random, seal256, utf8 } from './crypto'
import { docKeyOf } from './session'

const MIMES = ['', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']
const PLAIN = /\/api\/images\/[0-9a-f]{32}\.(png|jpg|gif|webp)/
const ZK = /\/api\/zk\/img\/([0-9a-f]{32})/
export const isZkImage = (src: string | null | undefined) => !!src && ZK.test(src)
export const isPlainImage = (src: string | null | undefined) => !!src && PLAIN.test(src)
const aad = (docId: string) => `i:${docId}`

function kindOf(b: Uint8Array): number {
  const at = (s: string, o = 0) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  if (b[0] === 0x89 && at('PNG', 1)) return 1
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 2
  if (at('GIF8')) return 3
  if (at('RIFF') && at('WEBP', 8)) return 4
  return 0
}

/** [document id, 16 characters][encrypted: type byte + picture]. The id says which key opens it. */
async function encryptImage(docId: string, key: Uint8Array, bytes: Uint8Array): Promise<Uint8Array> {
  const kind = kindOf(bytes)
  if (!kind) throw new Error('Only PNG, JPEG, GIF and WebP pictures are supported')
  const body = new Uint8Array(bytes.length + 1); body[0] = kind; body.set(bytes, 1)
  const sealed = await seal256(key, body, aad(docId))
  const out = new Uint8Array(16 + sealed.length); out.set(utf8(docId.padEnd(16, ' ').slice(0, 16))); out.set(sealed, 16)
  return out
}

async function decryptImage(blob: Uint8Array): Promise<{ blob: Blob; bytes: Uint8Array; docId: string } | null> {
  const docId = new TextDecoder().decode(blob.subarray(0, 16)).trim(), key = docKeyOf(docId)
  if (!key) return null
  try {
    const body = await open256(key, blob.subarray(16), aad(docId))
    return { blob: new Blob([body.subarray(1) as unknown as BlobPart], { type: MIMES[body[0]] || 'image/png' }), bytes: body.subarray(1), docId }
  } catch { return null }
}

async function download(src: string): Promise<Uint8Array | null> {
  const m = ZK.exec(src); if (!m) return null
  const r = await fetch(`/api/zk/img/${m[1]}`)
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
}

export async function uploadZkImage(docId: string, key: Uint8Array, data: Blob): Promise<string> {
  const blob = await encryptImage(docId, key, new Uint8Array(await data.arrayBuffer()))
  const fd = new FormData(); fd.append('file', new Blob([blob as unknown as BlobPart]), 'picture.enc')
  const r = await rawFetch(`/api/zk/docs/${docId}/images`, { method: 'POST', body: fd }, docId)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail?.message ?? (await r.text().catch(() => '')) ?? 'The picture couldn\'t be stored')
  return (await r.json()).url as string
}

/** A picture pasted from the web: the server fetches it (it is public anyway) and hands it back, then it is encrypted here. */
export async function importZkImage(docId: string, key: Uint8Array, url: string): Promise<string> {
  const r = await rawFetch(`/api/zk/docs/${docId}/images/fetch`, { method: 'POST', body: JSON.stringify({ url }), headers: { 'Content-Type': 'application/json' } }, docId)
  if (!r.ok) { let d: any = null; try { d = (await r.json()).detail } catch { /* ignore */ } throw new Error(typeof d === 'string' ? d : d?.message ?? 'The picture couldn\'t be fetched') }
  return uploadZkImage(docId, key, await r.blob())
}

// ── showing them ──
const shown = new Map<string, string | Promise<string | null>>()

/** The picture as something an <img> can show: a local address, made once per picture. */
export function zkImageUrl(src: string): Promise<string | null> | string | null {
  const m = ZK.exec(src); if (!m) return null
  const have = shown.get(m[1])
  if (have) return have
  const p = (async () => {
    const raw = await download(src); if (!raw) return null
    const d = await decryptImage(raw); if (!d) return null
    const url = URL.createObjectURL(d.blob); shown.set(m[1], url); return url
  })().then((u) => { if (!u) shown.delete(m[1]); return u }).catch(() => { shown.delete(m[1]); return null })
  shown.set(m[1], p)
  return p
}

/** The picture's bytes, for exporting or copying: a plain address works as it always did; an encrypted one is opened first. */
export async function imageBlob(src: string): Promise<Blob | null> {
  if (isZkImage(src)) {
    const raw = await download(src); const d = raw && await decryptImage(raw)
    return d ? d.blob : null
  }
  const r = await fetch(src); return r.ok ? r.blob() : null
}

/** Watches the page: any <img> whose address is an encrypted picture gets its decrypted local address. */
export function installZkImages() {
  const fix = (img: HTMLImageElement) => {
    const src = img.getAttribute('src')
    if (!isZkImage(src)) return
    const r = zkImageUrl(src!)
    const set = (u: string | null) => { if (u && img.getAttribute('src') === src) { img.dataset.zkSrc = src!; img.src = u } }
    if (typeof r === 'string') set(r); else if (r) void r.then(set)
  }
  const scan = (n: ParentNode | Node) => {
    if (n instanceof HTMLImageElement) fix(n)
    else if (n instanceof Element || n instanceof Document) n.querySelectorAll('img').forEach(fix)
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target instanceof HTMLImageElement) fix(m.target) } else m.addedNodes.forEach(scan)
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
  scan(document)
}

// ── moving pictures when a document changes between plain and encrypted, or gets a new key ──
interface Hit { src: string; apply: (to: string) => void }

/** Every picture address inside a document (any editor stores them as a `src` on a node or an element), found without knowing which kind of document it is. */
function findPictures(doc: Y.Doc, want: (s: string) => boolean): Hit[] {
  const hits: Hit[] = []
  const visit = (t: unknown) => {
    if (t instanceof Y.XmlElement) {
      const s = t.getAttribute('src')
      if (typeof s === 'string' && want(s)) hits.push({ src: s, apply: (n) => t.setAttribute('src', n) })
    }
    if (t instanceof Y.Map) {
      const s = t.get('src')
      if (typeof s === 'string' && want(s)) hits.push({ src: s, apply: (n) => t.set('src', n) })
      t.forEach((v) => { if (v instanceof Y.AbstractType) visit(v) })
    } else if (t instanceof Y.Array || t instanceof Y.XmlFragment) {
      for (const v of t.toArray()) if (v instanceof Y.AbstractType) visit(v)
    }
  }
  for (const [name, root] of doc.share) {
    const r = root as unknown as { _map?: Map<string, unknown>; _start?: unknown }
    try {
      if (r._start) visit(doc.getArray(name))
      else if (r._map && r._map.size) visit(doc.getMap(name))
    } catch { /* a root that can't be read as either has no pictures we can find */ }
  }
  return hits
}

async function move(doc: Y.Doc, want: (s: string) => boolean, convert: (src: string) => Promise<string>): Promise<string[]> {
  const hits = findPictures(doc, want), done = new Map<string, string>()
  for (const h of hits) if (!done.has(h.src)) done.set(h.src, await convert(h.src))
  doc.transact(() => { for (const h of hits) h.apply(done.get(h.src)!) })
  return [...new Set(done.values())]
}

const nameOf = (src: string) => ZK.exec(src)?.[1] ?? ''
const absolute = (src: string) => new URL(src, location.href).href

/** Plain pictures become encrypted ones. Returns the new addresses. */
export const picturesToEncrypted = (docId: string, key: Uint8Array, doc: Y.Doc) =>
  move(doc, isPlainImage, async (src) => {
    const r = await fetch(absolute(src))
    if (!r.ok) throw new Error('A picture in this document couldn\'t be downloaded to be encrypted')
    return uploadZkImage(docId, key, await r.blob())
  })

/** Encrypted pictures become ordinary stored pictures again. */
export const picturesToPlain = (docId: string, doc: Y.Doc) =>
  move(doc, isZkImage, async (src) => {
    const raw = await download(src), d = raw && await decryptImage(raw)
    if (!d) throw new Error('A picture in this document couldn\'t be opened')
    const fd = new FormData(); fd.append('file', new File([d.blob], 'picture.' + (d.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg'), { type: d.blob.type }))
    const r = await rawFetch(`/api/docs/${docId}/images`, { method: 'POST', body: fd }, docId)
    if (!r.ok) throw new Error('A picture couldn\'t be stored again')
    return (await r.json()).url as string
  })

/** A new document key: every picture is opened with the old key and stored again under the new one. Returns the new names. */
export async function picturesToNewKey(docId: string, oldKey: Uint8Array, newKey: Uint8Array, doc: Y.Doc): Promise<string[]> {
  const urls = await move(doc, isZkImage, async (src) => {
    const raw = await download(src); if (!raw) throw new Error('A picture couldn\'t be downloaded')
    let body: Uint8Array
    try { body = await open256(oldKey, raw.subarray(16), aad(docId)) } catch { throw new Error('A picture couldn\'t be opened with the old key') }
    return uploadZkImage(docId, newKey, new Blob([body.subarray(1) as unknown as BlobPart]))
  })
  return urls.map(nameOf)
}

void random
