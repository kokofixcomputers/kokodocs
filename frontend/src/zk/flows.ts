// Turning encryption on and off, signing in with it, and moving documents between plain and encrypted. All the cryptography happens here,
// in the browser; the server is only handed wrapped keys and ciphertext (see backend/app/zk.py).
import * as Y from 'yjs'
import { ApiError, request, type Comment, type DocSummary, type User } from '../api'
import { picturesToEncrypted, picturesToNewKey, picturesToPlain } from './images'
import {
  ARGON, b64, fromPassword, newKeypair, open256, openText, privWrapKey, random, recoveryFromText, recoveryToText, recoveryWrapKey, seal256, sealText, sealTo, unb64, type ArgonParams,
} from './crypto'
import {
  decryptComment, decryptTitle, decryptUpdate, docKeyOf, encryptComment, encryptTitle, encryptUpdate, newDocKey, openDocKey, sealDocKeyForMe, setDocKey, zkErase, zkMaster, zkPriv, zkPub, zkRecall, zkRemember, zkSetKeys, zkUid,
} from './session'

const json = (b: unknown) => ({ body: JSON.stringify(b) })

export interface ServerKeys { salt: string; params: ArgonParams; master_wrapped: string; priv_wrapped: string; pub: string; recovery_wrapped: string }
export interface ZkStatus { enabled: boolean; since: number | null; plain: number; plain_blocked: number; encrypted: number; shared_encrypted: number; has_password: boolean }

export const zkApi = {
  prelogin: (email: string) => request<{ zk: false } | { zk: true; salt: string; params: ArgonParams }>(`/api/auth/prelogin?email=${encodeURIComponent(email)}`),
  keys: () => request<ServerKeys>('/api/zk/keys'),
  status: () => request<ZkStatus>('/api/zk/status'),
  pubkey: (email: string) => request<{ email: string; name: string | null; pub: string }>(`/api/zk/pubkey?email=${encodeURIComponent(email)}`),
}

// ── what the person sees while this happens ──
export type Progress = (done: number, total: number, what: string) => void

// ── signing in ──
/** Before sending a password anywhere: if this account uses encryption, the password becomes a login secret (and a wrapping key that stays here). */
export async function loginSecret(email: string, password: string): Promise<{ secret: string; kek: Uint8Array | null }> {
  let pre: Awaited<ReturnType<typeof zkApi.prelogin>>
  try { pre = await zkApi.prelogin(email) } catch (e) { if (e instanceof ApiError && e.status === 429) throw e; return { secret: password, kek: null } }
  if (!pre.zk) return { secret: password, kek: null }
  const { auth, kek } = await fromPassword(password, unb64(pre.salt), pre.params)
  return { secret: auth, kek }
}

async function openAccount(user: { id: string }, keys: ServerKeys, master: Uint8Array) {
  const priv = await open256(await privWrapKey(master), unb64(keys.priv_wrapped), 'priv')
  zkSetKeys({ uid: user.id, master, priv, pub: unb64(keys.pub) })
  await zkRemember(user.id, master, keys.priv_wrapped, keys.pub)
}

/** After a successful sign-in with a login secret: fetch the wrapped keys and open them with the key made from the password. */
export async function finishLogin(user: { id: string }, kek: Uint8Array) {
  const keys = await zkApi.keys()
  let master: Uint8Array
  try { master = await open256(kek, unb64(keys.master_wrapped), 'master') } catch { throw new Error('Your password signed you in, but the encryption keys wouldn\'t open. Try again, or use your recovery key.') }
  await openAccount(user, keys, master)
}

/** Signed in (maybe on another device, or by single sign-on) but no key on this device: the password opens it. */
export async function unlockWithPassword(user: User, password: string) {
  const { kek } = await loginSecret(user.email, password)
  if (!kek) throw new Error('This account doesn\'t use encryption.')
  try { await finishLogin(user, kek) } catch { throw new Error('That isn\'t the right password.') }
}

/** A reload: the key remembered by this browser, if there is one. */
export async function restoreSession(user: { id: string }): Promise<boolean> {
  const r = await zkRecall(user.id)
  if (!r) return false
  try {
    const priv = await open256(await privWrapKey(r.master), unb64(r.privWrapped), 'priv')
    zkSetKeys({ uid: user.id, master: r.master, priv, pub: unb64(r.pub) })
    return true
  } catch { await zkErase(); return false }
}

// ── turning it on ──
export interface Prepared {
  recoveryText: string
  payload: { salt: string; params: ArgonParams; auth: string; master_wrapped: string; priv_wrapped: string; pub: string; recovery_wrapped: string }
  master: Uint8Array; priv: Uint8Array; pub: Uint8Array
}

/** Make every key for a new encrypted account. Nothing is sent: the person must see their recovery key first. */
export async function prepareAccount(password: string): Promise<Prepared> {
  const salt = random(16), { auth, kek } = await fromPassword(password, salt, ARGON)
  const master = random(32), kp = newKeypair(), recovery = random(32)
  return {
    recoveryText: recoveryToText(recovery), master, priv: kp.priv, pub: kp.pub,
    payload: {
      salt: b64(salt), params: ARGON, auth,
      master_wrapped: b64(await seal256(kek, master, 'master')),
      priv_wrapped: b64(await seal256(await privWrapKey(master), kp.priv, 'priv')),
      pub: b64(kp.pub),
      recovery_wrapped: b64(await seal256(await recoveryWrapKey(recovery), master, 'master')),
    },
  }
}

export async function enableAccount(user: User, prep: Prepared, password: string) {
  await request('/api/zk/enable', { method: 'POST', ...json({ ...prep.payload, password }) })
  zkSetKeys({ uid: user.id, master: prep.master, priv: prep.priv, pub: prep.pub })
  await zkRemember(user.id, prep.master, prep.payload.priv_wrapped, prep.payload.pub)
}

// ── documents: plain to encrypted and back ──
export interface Skipped { id: string; title: string; why: string }
export interface BatchResult { done: number; skipped: Skipped[]; failed: Skipped[]; images: number }

async function encryptDocument(d: DocSummary): Promise<{ skipped?: string; images?: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await request<{ ydoc: string | null; title: string; kind: string; updated_at: number; blocked: string | null; has_images: boolean }>(`/api/zk/docs/${d.id}/plain`, {}, d.id)
    if (p.blocked) return { skipped: p.blocked }
    const key = newDocKey()
    let state = p.ydoc ? unb64(p.ydoc) : Y.encodeStateAsUpdate(new Y.Doc())
    if (p.has_images) {   // its pictures are stored again, encrypted, and the document points at the new copies
      const doc = new Y.Doc(); Y.applyUpdate(doc, state)
      if ((await picturesToEncrypted(d.id, key, doc)).length) state = Y.encodeStateAsUpdate(doc)
      doc.destroy()
    }
    const comments: Record<string, { body: string; quote: string }> = {}
    for (const c of await request<Comment[]>(`/api/docs/${d.id}/comments`, {}, d.id)) comments[c.id] = { body: await encryptComment(key, d.id, c.body), quote: c.quote ? await encryptComment(key, d.id, c.quote) : '' }
    try {
      await request(`/api/zk/docs/${d.id}/encrypt`, { method: 'POST', ...json({
        title_enc: await encryptTitle(key, d.id, p.title), sealed: await sealDocKeyForMe(key), checkpoint: b64(await encryptUpdate(key, d.id, state)), expect_updated_at: p.updated_at, comments,
      }) }, d.id)
    } catch (e) { if (e instanceof ApiError && e.code === 'changed' && attempt < 2) { await new Promise((r) => setTimeout(r, 600)); continue } throw e }
    setDocKey(d.id, key)
    return { images: p.has_images }
  }
  return { skipped: 'It kept changing while it was being encrypted. Try again when nobody is editing it.' }
}

export async function encryptDocuments(docs: DocSummary[], onProgress?: Progress): Promise<BatchResult> {
  const r: BatchResult = { done: 0, skipped: [], failed: [], images: 0 }
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    onProgress?.(i, docs.length, d.title || 'Untitled')
    try {
      const x = await encryptDocument(d)
      if (x.skipped) r.skipped.push({ id: d.id, title: d.title, why: x.skipped }); else { r.done++; if (x.images) r.images++ }
    } catch (e) { r.failed.push({ id: d.id, title: d.title, why: (e as Error).message }) }
  }
  onProgress?.(docs.length, docs.length, '')
  return r
}

/** Rebuild a document's plain state from its encrypted history. */
export async function readEncrypted(id: string, sealed: string | null | undefined) {
  const key = await openDocKey(id, sealed)
  if (!key) throw new Error('You don\'t have the key to this document')
  const log = await request<{ checkpoint: string | null; upto: number; updates: { id: number; blob: string }[] }>(`/api/zk/docs/${id}/log`, {}, id)
  const doc = new Y.Doc()
  if (log.checkpoint) Y.applyUpdate(doc, await decryptUpdate(key, id, unb64(log.checkpoint)))
  for (const u of log.updates) Y.applyUpdate(doc, await decryptUpdate(key, id, unb64(u.blob)))
  return { key, doc, last: Math.max(log.upto, ...log.updates.map((u) => u.id)) }
}

async function decryptDocument(d: DocSummary): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { key, doc, last } = await readEncrypted(d.id, d.zk_sealed)
    const title = d.zk_title ? await decryptTitle(key, d.id, d.zk_title) : d.title
    await picturesToPlain(d.id, doc)   // pictures are stored again, readable, and the document points at them
    const comments: Record<string, { body: string; quote: string }> = {}
    for (const c of await request<Comment[]>(`/api/docs/${d.id}/comments`, {}, d.id)) comments[c.id] = { body: await decryptComment(key, d.id, c.body), quote: c.quote ? await decryptComment(key, d.id, c.quote) : '' }
    try {
      await request(`/api/zk/docs/${d.id}/decrypt`, { method: 'POST', ...json({ ydoc: b64(Y.encodeStateAsUpdate(doc)), title, last_id: last, comments }) }, d.id)
      return
    } catch (e) { if (e instanceof ApiError && e.code === 'changed' && attempt < 2) { await new Promise((r) => setTimeout(r, 600)); continue } throw e }
  }
  throw new Error('It kept changing while it was being decrypted. Try again when nobody is editing it.')
}

export async function decryptDocuments(docs: DocSummary[], onProgress?: Progress): Promise<BatchResult> {
  const r: BatchResult = { done: 0, skipped: [], failed: [], images: 0 }
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    onProgress?.(i, docs.length, d.title || 'Untitled')
    try { await decryptDocument(d); r.done++ } catch (e) { r.failed.push({ id: d.id, title: d.title, why: (e as Error).message }) }
  }
  onProgress?.(docs.length, docs.length, '')
  return r
}

/** Everything the person owns, trash included, so nothing is left behind. */
export async function ownedDocs(): Promise<DocSummary[]> {
  const { api } = await import('../api')
  const [lists, trash] = await Promise.all([api.listDocs(), api.listTrash()])
  return [...lists.mine, ...trash.docs]
}

export async function disableAccount(user: User, password: string) {
  const { secret } = await loginSecret(user.email, password)
  await request('/api/zk/disable', { method: 'POST', ...json({ auth: secret, password }) })
  await zkErase()
}

// ── passwords and the recovery key ──
export async function changeEncryptedPassword(user: User, current: string, next: string, code = '') {
  const cur = await loginSecret(user.email, current)
  const master = zkMaster()
  if (!master || !cur.kek) throw new Error('Unlock your encryption first')
  const salt = random(16), n = await fromPassword(next, salt, ARGON)
  await request('/api/zk/password', { method: 'POST', ...json({ current: cur.secret, salt: b64(salt), params: ARGON, auth: n.auth, master_wrapped: b64(await seal256(n.kek, master, 'master')), code }) })
}

/** A fresh recovery key replaces the old one (which then no longer works). Returns the new key to show. */
export async function newRecoveryKey(user: User, password: string): Promise<string> {
  const cur = await loginSecret(user.email, password), master = zkMaster()
  if (!master || !cur.kek) throw new Error('Unlock your encryption first')
  const recovery = random(32)
  await request('/api/zk/recovery', { method: 'PUT', ...json({ auth: cur.secret, recovery_wrapped: b64(await seal256(await recoveryWrapKey(recovery), master, 'master')) }) })
  return recoveryToText(recovery)
}

/** Forgot the password: the emailed code was accepted, now the recovery key opens the master key and a new password wraps it again. */
export async function resetWithRecovery(token: string, keys: ServerKeys, recoveryText: string, newPassword: string) {
  const raw = recoveryFromText(recoveryText)
  if (!raw) throw new Error('That recovery key isn\'t the right length. It has 52 letters and digits.')
  let master: Uint8Array
  try { master = await open256(await recoveryWrapKey(raw), unb64(keys.recovery_wrapped), 'master') } catch { throw new Error('That recovery key doesn\'t open this account.') }
  const salt = random(16), n = await fromPassword(newPassword, salt, ARGON), recovery = random(32)
  await request('/api/zk/reset/finish', { method: 'POST', ...json({
    token, salt: b64(salt), params: ARGON, auth: n.auth, master_wrapped: b64(await seal256(n.kek, master, 'master')),
    recovery_wrapped: b64(await seal256(await recoveryWrapKey(recovery), master, 'master')),
  }) })
  return recoveryToText(recovery)   // the old recovery key keeps working only until the next change; show the new one
}

export const destroyAndReset = (token: string, password: string) => request<{ deleted: number }>('/api/zk/reset/destroy', { method: 'POST', ...json({ token, password, confirm: 'DELETE' }) })

// ── sharing ──
/** The public key for an email, to seal a document key to them. */
export async function keyFor(email: string) { return zkApi.pubkey(email) }
export async function sealKeyFor(pub: string, docKey: Uint8Array) { return sealTo(unb64(pub), docKey) }

/** After someone lost access: a new key for the document, and everything re-encrypted with it, so what they could still fetch is useless. */
export async function rotateKey(d: { id: string; zk_sealed?: string | null }, grants: { email: string; pub: string }[], title: string) {
  const { doc, last, key: oldKey } = await readEncrypted(d.id, d.zk_sealed)
  const key = newDocKey()
  const sealedBy: Record<string, string> = {}
  for (const g of grants) sealedBy[g.email] = await sealTo(unb64(g.pub), key)
  const images = await picturesToNewKey(d.id, oldKey, key, doc)   // pictures and comments were encrypted with the old key: they move to the new one
  const comments: Record<string, { body: string; quote: string }> = {}
  for (const c of await request<Comment[]>(`/api/docs/${d.id}/comments`, {}, d.id)) comments[c.id] = { body: await encryptComment(key, d.id, await decryptComment(oldKey, d.id, c.body)), quote: c.quote ? await encryptComment(key, d.id, await decryptComment(oldKey, d.id, c.quote)) : '' }
  await request(`/api/zk/docs/${d.id}/rotate`, { method: 'POST', ...json({
    title_enc: await encryptTitle(key, d.id, title), checkpoint: b64(await encryptUpdate(key, d.id, Y.encodeStateAsUpdate(doc))), grants: sealedBy, last_id: last, images, comments,
  }) }, d.id)
  setDocKey(d.id, key)
}

export { docKeyOf, openText, sealText, zkPriv, zkPub, zkUid }
