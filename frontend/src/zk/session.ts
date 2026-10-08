// The keys of the person who is signed in, kept in this browser only. (No network calls here, so api.ts can use it freely.)
import { b64, fromUtf8, open256, openSealed, openText, random, sealText, sealTo, seal256, unb64, utf8 } from './crypto'

interface Keys { uid: string; master: Uint8Array; priv: Uint8Array; pub: Uint8Array }
let keys: Keys | null = null
const listeners = new Set<() => void>()
const docKeys = new Map<string, Uint8Array>()
const emit = () => listeners.forEach((l) => l())

export const zkUnlocked = () => !!keys
const NEW_PLAIN = 'koko.zk.newPlain'
/** With encryption on, should new documents be encrypted? (Yes unless the person said otherwise: this is per browser.) */
export const zkNewEncrypted = () => { try { return localStorage.getItem(NEW_PLAIN) !== '1' } catch { return true } }
export const setZkNewEncrypted = (v: boolean) => { try { if (v) localStorage.removeItem(NEW_PLAIN); else localStorage.setItem(NEW_PLAIN, '1') } catch { /* ignore */ } }
export const zkOnChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const zkMaster = () => keys?.master ?? null
export const zkPub = () => keys?.pub ?? null
export const zkPriv = () => keys?.priv ?? null
export const zkUid = () => keys?.uid ?? null

export function zkSetKeys(k: Keys) { keys = k; docKeys.clear(); emit() }
export function zkForget() { keys = null; docKeys.clear(); emit() }

// ── "stay signed in": the master key is kept in IndexedDB, encrypted by a key this browser can use but never read out ──
const DB = 'koko-zk', STORE = 'kv'
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGet<T>(k: string): Promise<T | undefined> {
  const d = await idb()
  return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result as T | undefined); q.onerror = () => rej(q.error) })
}
async function idbPut(k: string, v: unknown) {
  const d = await idb()
  return new Promise<void>((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
}
async function idbDel(k: string) {
  const d = await idb()
  return new Promise<void>((res) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = () => res(); tx.onerror = () => res() })
}
async function deviceKey(create: boolean): Promise<CryptoKey | null> {
  let k = await idbGet<CryptoKey>('device')
  if (!k && create) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await idbPut('device', k) }
  return k ?? null
}

/** Remember the master key on this device so a reload doesn't ask for the password again. */
export async function zkRemember(uid: string, master: Uint8Array, privWrapped: string, pubB64: string) {
  try {
    const dk = await deviceKey(true); if (!dk) return
    const iv = random(12)
    const blob = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, dk, master as unknown as BufferSource))
    await idbPut('session', { uid, iv, blob, privWrapped, pub: pubB64 })
  } catch { /* private window or blocked storage: the password is asked for next time */ }
}
export async function zkRecall(uid: string): Promise<{ master: Uint8Array; privWrapped: string; pub: string } | null> {
  try {
    const s = await idbGet<{ uid: string; iv: Uint8Array; blob: Uint8Array; privWrapped: string; pub: string }>('session')
    const dk = await deviceKey(false)
    if (!s || !dk || s.uid !== uid) return null
    return { master: new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as unknown as BufferSource }, dk, s.blob as unknown as BufferSource)), privWrapped: s.privWrapped, pub: s.pub }
  } catch { return null }
}
export async function zkErase() { zkForget(); try { await idbDel('session') } catch { /* nothing to erase */ } }

// ── document keys ──
export const docKeyOf = (id: string) => docKeys.get(id) ?? null
export const setDocKey = (id: string, raw: Uint8Array) => { docKeys.set(id, raw) }
export const newDocKey = () => random(32)

/** Open the copy of a document's key that was sealed to me (and remember it). */
export async function openDocKey(id: string, sealed: string | null | undefined): Promise<Uint8Array | null> {
  const have = docKeys.get(id)
  if (have) return have
  if (!keys || !sealed) return null
  try { const k = await openSealed(keys.priv, sealed); docKeys.set(id, k); return k } catch { return null }
}
export async function sealDocKeyForMe(raw: Uint8Array): Promise<string> {
  if (!keys) throw new Error('Your encryption keys are locked')
  return sealTo(keys.pub, raw)
}

// ── what is encrypted with a document key, always bound to that document ──
export const updateAad = (id: string) => `u:${id}`
export const titleAad = (id: string) => `t:${id}`
export const commentAad = (id: string) => `c:${id}`
export const awarenessAad = (id: string) => `a:${id}`
export const encryptBlob = (key: Uint8Array, aad: string, data: Uint8Array) => seal256(key, data, aad)
export const decryptBlob = (key: Uint8Array, aad: string, blob: Uint8Array) => open256(key, blob, aad)
export const encryptUpdate = (key: Uint8Array, id: string, update: Uint8Array) => seal256(key, update, updateAad(id))
export const decryptUpdate = (key: Uint8Array, id: string, blob: Uint8Array) => open256(key, blob, updateAad(id))
export const encryptTitle = (key: Uint8Array, id: string, title: string) => sealText(key, title, titleAad(id))
export const decryptTitle = (key: Uint8Array, id: string, enc: string) => openText(key, enc, titleAad(id))
export const encryptComment = (key: Uint8Array, id: string, text: string) => sealText(key, text, commentAad(id))
export const decryptComment = (key: Uint8Array, id: string, enc: string) => openText(key, enc, commentAad(id))

/** An encrypted document as the server lists it, with its title opened when my key is available. */
export interface ZkFields { zk?: boolean; zk_title?: string | null; zk_sealed?: string | null; zk_locked?: boolean }
export async function decorate<T extends ZkFields & { id: string; title: string }>(d: T): Promise<T> {
  if (!d.zk) return d
  const k = await openDocKey(d.id, d.zk_sealed)
  if (!k || !d.zk_title) { d.zk_locked = true; d.title = 'Encrypted document'; return d }
  try { d.title = await decryptTitle(k, d.id, d.zk_title); d.zk_locked = false } catch { d.zk_locked = true; d.title = 'Encrypted document' }
  return d
}
export const decorateAll = <T extends ZkFields & { id: string; title: string }>(list: T[]) => Promise.all(list.map(decorate))
export { b64, fromUtf8, unb64, utf8 }
