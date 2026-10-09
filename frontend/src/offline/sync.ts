import { api, getToken, rawFetch, request } from '../api'
import { onNet, isOffline, isOnline, setOnline } from './net'
import { clearLocalNew, dirtyIds, hasYState, loadYState, offlineOn, outbox, saveYState } from './store'
import { idb } from './idb'

/** Two jobs while online: replay what was done offline (in order), then keep a copy of everything on this device.
 *  Documents already on the device are only re-downloaded when they changed on the server. */

export interface SyncState { phase: 'idle' | 'sending' | 'copying'; done: number; total: number; queued: number; at: number }
let state: SyncState = { phase: 'idle', done: 0, total: 0, queued: 0, at: 0 }
let running = false, again = false
export const syncState = () => state
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; window.dispatchEvent(new CustomEvent('koko:syncstate', { detail: state })) }

export async function flushOutbox(): Promise<number> {
  let sent = 0
  for (const { key, value: o } of await outbox.list()) {
    try {
      if (o.op === 'create') {
        await request('/api/docs', { method: 'POST', body: JSON.stringify({ id: o.id, title: o.title || null, folder_id: o.folder_id, kind: o.kind }) })
        await clearLocalNew(o.id)
      } else await request(`/api/docs/${o.id}`, { method: 'PATCH', body: JSON.stringify({ title: o.title }) }, o.id)
      await outbox.remove(key); sent++
    } catch (e) {
      if (isOffline(e)) break   // still no connection: keep the rest, in order
      await outbox.remove(key)   // the server said no (deleted meanwhile, no longer allowed): nothing to retry
    }
  }
  set({ queued: await outbox.count() })
  if (sent) window.dispatchEvent(new CustomEvent('koko:outbox-sent', { detail: { sent } }))
  return sent
}

/** documents edited offline and then closed: open each one in the background so what was typed reaches the server (and comes back merged) */
async function pushDirty() {
  const [{ KokoProvider }, Y] = await Promise.all([import('../collab'), import('yjs')])
  for (const id of await dirtyIds()) {
    const doc = new Y.Doc(), p = new KokoProvider(id, doc, false)
    await new Promise<void>((res) => {
      const t = window.setTimeout(res, 10_000)
      const done = () => { if (p.status === 'connected' && p.synced) { window.clearTimeout(t); window.setTimeout(res, 400) } }
      p.subscribe(done); done()
    })
    p.destroy(); doc.destroy()
  }
}

/** keep a local copy of every document the server will give us */
async function copyAll() {
  const { mine, shared } = await api.listDocs()
  await Promise.all([api.listFolders().catch(() => null), api.listSharedFolders().catch(() => null), api.recent().catch(() => null)])
  // documents that are only reachable through a folder someone shared with me aren't in the lists above: walk those folders too
  const all = new Map([...mine, ...shared].map((d) => [d.id, d]))
  const roots = await api.listSharedFolders().catch(() => [])
  const queue = roots.map((r) => r.id), visited = new Set<string>()
  while (queue.length && visited.size < 500) {
    const id = queue.shift()!; if (visited.has(id)) continue; visited.add(id)
    const v = await api.openSharedFolder(id).catch(() => null); if (!v) continue
    for (const d of v.docs) if (!all.has(d.id)) all.set(d.id, d)
    for (const f of v.folders) queue.push(f.id)
  }
  // (password-protected links need the password, but my own documents don't)
  const docs = [...all.values()].filter((d) => !d.zk && !d.deleted_at && (d.link_access !== 'password' || d.role === 'owner'))
  const seen = (await idb.get<Record<string, number>>('kv', 'seen')) ?? {}
  const todo: typeof docs = []
  for (const d of docs) if (!seen[d.id] || seen[d.id] < d.updated_at || !(await hasYState(d.id))) todo.push(d)
  set({ phase: 'copying', done: 0, total: todo.length })
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const d = todo[i++]
      try {
        const info = await api.getDoc(d.id)   // caches the details
        const res = await rawFetch(`/api/docs/${d.id}/state`, {}, d.id)
        if (res.ok) {
          const remote = new Uint8Array(await res.arrayBuffer())
          if (!remote.length) { seen[d.id] = Math.max(d.updated_at, info.updated_at); if (!(await hasYState(d.id))) await saveYState(d.id, new Uint8Array(0)); set({ done: Math.min(i, todo.length) }); continue }
          // what is here may hold edits that haven't gone up yet: combine rather than replace
          const have = await loadYState(d.id)
          const Y = await import('yjs')
          const merged = have?.length ? Y.mergeUpdates([have, remote]) : remote
          await saveYState(d.id, merged)
          seen[d.id] = Math.max(d.updated_at, info.updated_at)
        }
      } catch (e) { if (isOffline(e)) { i = todo.length } }
      set({ done: Math.min(i, todo.length) })
    }
  }
  await Promise.all([worker(), worker(), worker()])
  await idb.set('kv', 'seen', seen)
}

export async function syncNow() {
  if (!offlineOn() || !getToken()) return
  if (running) { again = true; return }
  running = true
  try {
    do {
      again = false
      if (!isOnline()) break
      set({ phase: 'sending', queued: await outbox.count() })
      await flushOutbox()
      await pushDirty()
      await copyAll()
      set({ at: Date.now() })
    } while (again)
  } catch (e) { if (isOffline(e)) setOnline(false) }
  finally { running = false; set({ phase: 'idle', queued: await outbox.count() }) }
}

/** start the background copy for this page: now, whenever the connection comes back, and every few minutes */
export function startSync() {
  void syncNow()
  const off = onNet((on) => { if (on) void syncNow() })
  const t = window.setInterval(() => void syncNow(), 5 * 60_000)
  return () => { off(); window.clearInterval(t) }
}
