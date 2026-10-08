import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const POLL_MS = 60_000
const RELOADED_KEY = 'koko.updateReload'

/** Tells an open page the site has been updated. Every build has an id (a meta tag in index.html); `/version.js`, whose name never
 *  changes, always holds the newest one. The page checks it every minute and whenever it is brought back to the front or comes
 *  online, and offers a reload when the two differ. Pages from before an update would otherwise ask for lazy-loaded files that no
 *  longer exist and break in odd ways. If one of those loads does fail, reloading is the only fix, so that happens at once (once). */
export function UpdateNotice() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const mine = document.querySelector('meta[name="koko-build"]')?.getAttribute('content')
    if (!mine) return   // the dev server has no build id
    let alive = true
    const check = async () => {
      try {
        const r = await fetch(`/version.js?_=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const latest = /"([0-9a-f]+)"/.exec(await r.text())?.[1]
        if (alive && latest && latest !== mine) setStale(true)
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
      <button className="btn btn-pill btn-primary btn-sm" onClick={() => location.reload()}>Reload</button>
    </div>
  )
}
