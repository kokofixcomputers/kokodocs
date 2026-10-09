/* KokoDocs service worker: keeps the app itself on the device so it opens with no connection.
   The build step fills in BUILD and PRECACHE. Documents are not handled here (they live in IndexedDB, see src/offline). */
const BUILD = '__BUILD__'
const CACHE = 'koko-' + BUILD
const PRECACHE = __PRECACHE__

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    // one file failing (a flaky connection) shouldn't stop the rest from being kept
    await Promise.all(PRECACHE.map(async (u) => { try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r) } catch { /* fetched later, when used */ } }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // keep this build and the one before it: an open page may still be loading its pieces from the older one
    const names = (await caches.keys()).filter((n) => n.startsWith('koko-')).sort().reverse()
    await Promise.all(names.slice(2).map((n) => caches.delete(n)))
    await self.clients.claim()
  })())
})

const RUNTIME = /^\/(assets\/|twemoji\/|ocr\/|favicon|api\/images\/)/

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  const p = url.pathname
  if (p === '/sw.js' || p === '/version.js' || p.startsWith('/ws/')) return
  if (p.startsWith('/api/') && !p.startsWith('/api/images/')) return

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req) } catch {
        return (await caches.match('/index.html', { ignoreVary: true })) || Response.error()
      }
    })())
    return
  }
  if (RUNTIME.test(p) || PRECACHE.includes(p)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true })   // (the server says Vary: Origin; module scripts send one, the precache's own fetches don't)
      if (hit) return hit
      const r = await fetch(req)
      if (r.ok && r.status === 200) { const c = await caches.open(CACHE); c.put(req, r.clone()) }
      return r
    })())
  }
})
