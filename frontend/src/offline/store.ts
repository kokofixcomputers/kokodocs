import { ApiError, type DocInfo, type DocKind, type DocSummary, type Folder } from '../api'
import { idb } from './idb'
import { isOffline, isOnline } from './net'

/** The offline copy. Lists, document details and every document's Yjs state are kept in IndexedDB so the app opens and edits with no connection;
 *  what is done while away (creating, renaming) waits in an outbox and is replayed in order when the server is back (see sync.ts).
 *  Encrypted (zero-knowledge) accounts and documents are never stored here: the server can't read them, and neither should a disk cache. */

const ZK = 'koko.zk', PREF = 'koko.offline'
export const setAccountZk = (z: boolean) => { try { z ? localStorage.setItem(ZK, '1') : localStorage.removeItem(ZK) } catch { /* ignore */ } }
const flag = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
export const offlinePref = () => flag(PREF) !== 'off'
export const setOfflinePref = (on: boolean) => { try { on ? localStorage.removeItem(PREF) : localStorage.setItem(PREF, 'off') } catch { /* ignore */ } }
/** is an offline copy kept at all on this device? */
export const offlineOn = () => offlinePref() && !flag(ZK) && !!flag('koko.token')

type Listy = { mine: DocSummary[]; shared: DocSummary[] }
const plain = <T extends { zk?: boolean }>(l: T[]) => l.filter((d) => !d.zk)

/** Network first; if the server can't be reached, the last copy. */
export async function cached<T>(key: string, fn: () => Promise<T>, keep: (v: T) => T = (v) => v): Promise<T> {
  if (!offlineOn()) return fn()
  const fromCache = async () => { const v = await idb.get<T>('kv', key); if (v === undefined) throw offlineErr(); return v }
  if (!isOnline()) return fromCache()
  try {
    const v = await fn()
    void idb.set('kv', key, keep(v))
    return v
  } catch (e) { if (isOffline(e)) return fromCache(); throw e }
}
const offlineErr = () => new ApiError(0, 'offline', 'You’re offline and this isn’t saved on this device yet.')   // (api.ts and this file import each other; ApiError is only used at call time)
export const keepLists = (r: Listy): Listy => ({ mine: plain(r.mine), shared: plain(r.shared) })
export const keepPlain = <T extends { zk?: boolean }>(l: T[]) => plain(l)

export type Op =
  | { op: 'create'; id: string; title: string; folder_id: string | null; kind: DocKind }
  | { op: 'rename'; id: string; title: string }

export const outbox = {
  list: () => idb.all<Op>('outbox'),
  push: (o: Op) => idb.add('outbox', o).then((r) => { window.dispatchEvent(new CustomEvent('koko:outbox')); return r }),
  remove: (key: IDBValidKey) => idb.del('outbox', key),
  count: async () => (await idb.keys('outbox')).length,
}

const DEFAULT_TITLE: Record<string, string> = { doc: 'Untitled document', sheet: 'Untitled spreadsheet', slides: 'Untitled presentation', wiki: 'Untitled wiki', board: 'Untitled board', form: 'Untitled form' }

/** a document made while offline: put into the saved lists and details as if the server had made it */
export async function addLocalDoc(o: Extract<Op, { op: 'create' }>, owner: string): Promise<DocSummary> {
  const now = Date.now() / 1000
  const d: DocSummary = { id: o.id, title: o.title || DEFAULT_TITLE[o.kind] || 'Untitled', role: 'owner', owner, updated_at: now, created_at: now, link_access: 'restricted', folder_id: o.folder_id, kind: o.kind }
  const l = (await idb.get<Listy>('kv', 'docs')) ?? { mine: [], shared: [] }
  await idb.set('kv', 'docs', { ...l, mine: [d, ...l.mine.filter((x) => x.id !== d.id)] })
  await idb.set('kv', `doc:${o.id}`, { ...d, owner_email: '', link: { access: 'restricted', role: 'viewer' } } satisfies DocInfo)
  await idb.set('kv', `new:${o.id}`, true)
  return d
}

export async function renameLocal(id: string, title: string) {
  const l = await idb.get<Listy>('kv', 'docs')
  if (l) await idb.set('kv', 'docs', { mine: l.mine.map((d) => d.id === id ? { ...d, title } : d), shared: l.shared.map((d) => d.id === id ? { ...d, title } : d) })
  const i = await idb.get<DocInfo>('kv', `doc:${id}`)
  if (i) await idb.set('kv', `doc:${id}`, { ...i, title })
}

export const isLocalNew = (id: string) => idb.get<boolean>('kv', `new:${id}`).then(Boolean)
export const clearLocalNew = (id: string) => idb.del('kv', `new:${id}`)

/** Everything on this device, so a title search works with no connection. */
export async function searchLocal(q: string): Promise<DocSummary[]> {
  const l = await idb.get<Listy>('kv', 'docs'); if (!l) return []
  const n = q.trim().toLowerCase()
  return [...l.mine, ...l.shared].filter((d) => !d.deleted_at && (!n || d.title.toLowerCase().includes(n))).sort((a, b) => b.updated_at - a.updated_at).slice(0, 30)
}

export const savedFolders = () => idb.get<Folder[]>('kv', 'folders')
export const saveYState = (id: string, bytes: Uint8Array) => idb.set('ydocs', id, bytes)
export const loadYState = (id: string) => idb.get<Uint8Array>('ydocs', id)
export const hasYState = async (id: string) => (await idb.keys('ydocs')).includes(id)
export const forgetEverything = () => idb.clear()

/** documents with edits made on this device that the server hasn't been given yet (found again by the background sync) */
export const markDirty = (id: string) => idb.set('kv', `dirty:${id}`, true)
export const clearDirty = (id: string) => idb.del('kv', `dirty:${id}`)
export const dirtyIds = async () => (await idb.keys('kv')).map(String).filter((k) => k.startsWith('dirty:')).map((k) => k.slice(6))
