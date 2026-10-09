/** A tiny IndexedDB wrapper: three stores (plain values, document states, the queue of things done while offline). Every call fails soft: private windows and blocked storage just mean "no offline copy". */
const NAME = 'koko-offline'
let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'))
    const r = indexedDB.open(NAME, 1)
    r.onupgradeneeded = () => {
      const d = r.result
      d.createObjectStore('kv'); d.createObjectStore('ydocs'); d.createObjectStore('outbox', { autoIncrement: true })
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return dbp
}

type Store = 'kv' | 'ydocs' | 'outbox'
async function tx<T>(store: Store, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open()
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), r = f(t.objectStore(store))
    t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error)
  })
}

export const idb = {
  get: <T = unknown>(store: Store, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', (s) => s.get(key)).catch(() => undefined),
  set: (store: Store, key: IDBValidKey, v: unknown) => tx(store, 'readwrite', (s) => s.put(v, key)).then(() => true, () => false),
  del: (store: Store, key: IDBValidKey) => tx(store, 'readwrite', (s) => s.delete(key)).then(() => true, () => false),
  keys: (store: Store) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]),
  add: (store: Store, v: unknown) => tx(store, 'readwrite', (s) => s.add(v)).then(() => true, () => false),
  /** everything in a store, in key order, with the keys */
  all: async <T = unknown>(store: Store): Promise<{ key: IDBValidKey; value: T }[]> => {
    try {
      const d = await open()
      return await new Promise((res, rej) => {
        const out: { key: IDBValidKey; value: T }[] = [], t = d.transaction(store, 'readonly'), c = t.objectStore(store).openCursor()
        c.onsuccess = () => { const x = c.result; if (x) { out.push({ key: x.key, value: x.value }); x.continue() } }
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error)
      })
    } catch { return [] }
  },
  clear: async () => { for (const s of ['kv', 'ydocs', 'outbox'] as Store[]) await tx(s, 'readwrite', (x) => x.clear()).catch(() => {}) },
}
