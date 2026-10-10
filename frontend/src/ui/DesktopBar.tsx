import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { NetChip } from './NetStatus'

/** The desktop app's own title bar (the window has no system one): back and forward, search, and whether the offline copy is up to date.
 *  The system's window buttons sit at the left on a Mac and at the right on Windows and Linux, so there is room left for them. */
export interface UpdateInfo { commit: string; built?: string; size?: number }
export interface BundleInfo { commit: string; built: number; source: 'downloaded' | 'packed'; bytes: number; downloadedBytes: number }
export interface DesktopApi { platform: string; version: string;
  update?: { check: () => Promise<UpdateInfo | null>; install: () => Promise<void>; onAvailable: (cb: (u: UpdateInfo) => void) => void; onProgress: (cb: (p: number) => void) => void; onError: (cb: (m: string) => void) => void }
  bundle?: () => Promise<BundleInfo | null>; removeBundle?: () => Promise<void>; storage?: () => Promise<{ appfiles: number; cache: number }>; clear?: (what: 'appfiles' | 'cache') => Promise<void>; onSettings?: (cb: () => void) => void; openSso?: (url: string) => Promise<void>; onSso?: (cb: (r: { token?: string; mfa?: string; next?: string; error?: string; linked?: string; closed?: boolean }) => void) => void; fullscreen: (cb: (on: boolean) => void) => void; appFiles: (cb: (s: { done: number; total: number; finished?: boolean }) => void) => void }
declare global { interface Window { kokoDesktop?: DesktopApi } }

export const isDesktop = () => typeof window !== 'undefined' && !!window.kokoDesktop

export function installDesktop() {
  const d = window.kokoDesktop; if (!d) return
  const c = document.documentElement.classList
  c.add('desktop'); c.add(d.platform === 'darwin' ? 'desktop-mac' : 'desktop-overlay')
  d.fullscreen((on) => c.toggle('desktop-full', on))
  // the desktop app keeps its own copy of the interface (and updates it itself), so the site's service worker is not wanted: it would serve old files
  void navigator.serviceWorker?.getRegistrations().then((r) => r.forEach((x) => void x.unregister())).catch(() => {})
  d.onSettings?.(() => window.dispatchEvent(new Event('koko:settings')))
  d.appFiles((s) => window.dispatchEvent(new CustomEvent('koko:appfiles', { detail: s })))
}

export function DesktopBar() {
  const [hist, setHist] = useState({ back: false, fwd: false })
  useEffect(() => {
    const n = (window as unknown as { navigation?: { canGoBack: boolean; canGoForward: boolean; addEventListener: Window['addEventListener']; removeEventListener: Window['removeEventListener'] } }).navigation
    const upd = () => setHist({ back: n ? n.canGoBack : history.length > 1, fwd: n ? n.canGoForward : true })
    upd(); n?.addEventListener('currententrychange', upd); window.addEventListener('popstate', upd)
    return () => { n?.removeEventListener('currententrychange', upd); window.removeEventListener('popstate', upd) }
  }, [])
  if (!isDesktop()) return null
  const mac = window.kokoDesktop!.platform === 'darwin'
  return (
    <div className="desk-bar" role="banner">
      <div className="desk-nav">
        <button className="desk-ic" aria-label="Back" disabled={!hist.back} onClick={() => history.back()}><ChevronLeft size={18} /></button>
        <button className="desk-ic" aria-label="Forward" disabled={!hist.fwd} onClick={() => history.forward()}><ChevronRight size={18} /></button>
      </div>
      <button className="desk-search" onClick={() => window.dispatchEvent(new Event('koko:search'))}><Search size={14} /> Search documents <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd></button>
      <NetChip />
    </div>
  )
}
