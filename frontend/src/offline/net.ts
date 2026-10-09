/** Whether the server can be reached. `navigator.onLine` only knows about the network card, so failed requests also flip this to offline,
 *  and while offline a ping every few seconds finds out when it's back. */
type Fn = (online: boolean) => void
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
const subs = new Set<Fn>()
let probe: number | undefined

export const isOnline = () => online
export function onNet(f: Fn) { subs.add(f); return () => { subs.delete(f) } }

export function setOnline(v: boolean) {
  if (v === online) return
  online = v
  subs.forEach((f) => f(v))
  window.dispatchEvent(new CustomEvent('koko:net', { detail: { online: v } }))
  window.clearTimeout(probe)
  if (!v) schedule()
}

function schedule() {
  window.clearTimeout(probe)
  probe = window.setTimeout(async () => {
    if (online) return
    try {
      const c = new AbortController(); const t = window.setTimeout(() => c.abort(), 4000)
      const r = await fetch('/api/ping', { cache: 'no-store', signal: c.signal }); window.clearTimeout(t)
      if (r.ok) { setOnline(true); return }
    } catch { /* still offline */ }
    schedule()
  }, 3000)
}

/** true when this error means "couldn't reach the server" (as opposed to the server saying no) */
export const isOffline = (e: unknown) => !!e && typeof e === 'object' && (e as { status?: number }).status === 0

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOnline(false))
  window.addEventListener('online', () => { void (async () => { try { const r = await fetch('/api/ping', { cache: 'no-store' }); if (r.ok) setOnline(true) } catch { /* not yet */ } })() })
  if (!online) schedule()
}
