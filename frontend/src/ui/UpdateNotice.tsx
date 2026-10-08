import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const POLL_MS = 60_000
const RELOADED_KEY = 'koko.updateReload'

/** Tells an open page the site has been updated. Every build has an id (a meta tag in index.html); `/version.js`, whose name never
 *  changes, always holds the newest one. The page checks it every minute and whenever it is brought back to the front or comes
 *  online, and offers a reload when the two differ. Pages from before an update would otherwise ask for lazy-loaded files that no
 *  longer exist and break in odd ways. If one of those loads does fail, reloading is the only fix, so that happens at once (once). */
const TRIED_KEY = 'koko.updateTried'

/** Reload so that the new version really arrives. A plain reload can be answered from a cache that still holds the old index page
 *  (a browser, or a proxy/CDN in front of the site that ignores no-cache), which would just bring the pill back. So first the page
 *  is fetched again bypassing caches, and if that has already been tried for this same update a moment ago, the address gets a
 *  throwaway `_v` parameter, which no cache can have seen. */
async function reloadForUpdate(latest: string | null) {
  const stamp = (() => { try { return JSON.parse(sessionStorage.getItem(TRIED_KEY) ?? 'null') as { id: string; at: number } | null } catch { return null } })()
  try { sessionStorage.setItem(TRIED_KEY, JSON.stringify({ id: latest, at: Date.now() })) } catch { /* ignore */ }
  try { await Promise.race([Promise.all(['/', '/index.html'].map((u) => fetch(u, { cache: 'reload' }))), new Promise((r) => setTimeout(r, 4000))]) } catch { /* offline: reload anyway */ }
  if (stamp && stamp.id === latest && Date.now() - stamp.at < 120_000) {
    const u = new URL(location.href); u.searchParams.set('_v', String(Date.now())); location.replace(u.toString())
  } else location.reload()
}

export function UpdateNotice() {
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const latestId = useRef<string | null>(null)
  useEffect(() => {
    const mine = document.querySelector('meta[name="koko-build"]')?.getAttribute('content')
    if (!mine) return   // the dev server has no build id
    const u = new URL(location.href)   // tidy up the throwaway parameter a stubborn reload may have added
    if (u.searchParams.has('_v')) { u.searchParams.delete('_v'); history.replaceState(history.state, '', u.pathname + u.search + u.hash) }
    let alive = true
    const check = async () => {
      try {
        const r = await fetch(`/version.js?_=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const latest = /"([0-9a-f]+)"/.exec(await r.text())?.[1]
        if (alive && latest && latest !== mine) { latestId.current = latest; setStale(true) }
      } catch { /* offline: try again later */ }
    }
    const visible = () => { if (document.visibilityState === 'visible') void check() }
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check() }, POLL_MS)
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', check)
    const preload = (e: Event) => {   // Vite fires this when a lazy-loaded file can't be fetched
      e.preventDefault()
      let last = 0; try { last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0) } catch { /* ignore */ }
      if (Date.now() - last > 30_000) { try { sessionStorage.setItem(RELOADED_KEY, String(Date.now())) } catch { /* ignore */ } location.reload() }
      else setStale(true)   // already reloaded a moment ago and it still fails: stop looping, let the person decide
    }
    window.addEventListener('vite:preloadError', preload)
    void check()
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', check); window.removeEventListener('vite:preloadError', preload) }
  }, [])
  if (!stale) return null
  return (
    <div className="update-notice" role="status">
      <RefreshCw size={16} /><span>KokoDocs was updated.</span>
      <button type="button" className="update-btn" disabled={busy} onClick={() => { setBusy(true); void reloadForUpdate(latestId.current) }}>{busy ? 'Reloading…' : 'Reload'}</button>
    </div>
  )
}
