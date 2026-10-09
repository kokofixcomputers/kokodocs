import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hand } from 'lucide-react'
import { hue, initials } from './util'
import type { Call, Peer } from './types'

const KEY = 'koko.handspip'
export const handsPipPref = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }
export const setHandsPipPref = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* not saved */ } }

interface DocPip { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> }
const api = () => (typeof window !== 'undefined' ? (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture : undefined)

/** A small always-on-top window that shows who has a hand up, for a host who is looking at something else (another window, or the screen they are sharing).
 *  Browsers that have Document Picture-in-Picture can show it; Chrome also lets a page open it by itself when you switch away from a call, which is used here.
 *  Where it isn't available the tab's title carries the count instead. */
export function useHandsPip(call: Call, manager: boolean) {
  const supported = !!api()
  const [win, setWin] = useState<Window | null>(null)
  const manual = useRef(false)
  const open = useCallback(async (byHand: boolean) => {
    const dpip = api()
    if (!dpip || win) return
    try {
      const w = await dpip.requestWindow({ width: 340, height: 280 })
      manual.current = byHand
      for (const ss of [...document.styleSheets]) {   // the window starts empty: give it the app's look
        try { const st = w.document.createElement('style'); st.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n'); w.document.head.appendChild(st) }
        catch { if (ss.href) { const l = w.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; w.document.head.appendChild(l) } }
      }
      w.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') ?? 'light')
      w.document.title = 'Raised hands'
      w.addEventListener('pagehide', () => setWin(null))
      setWin(w)
    } catch (e) { console.warn('raised-hands window not opened:', e) }   // not allowed right now (it needs a click, or the browser's own switch-away moment)
  }, [win])
  const close = useCallback(() => { win?.close(); setWin(null) }, [win])

  // Chrome calls this when you switch away from a tab that has a call going
  useEffect(() => {
    if (!manager || !supported || !handsPipPref()) return
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => void open(false)) } catch { /* not a thing in this browser */ }
    return () => { try { navigator.mediaSession.setActionHandler('enterpictureinpicture' as MediaSessionAction, null) } catch { /* ignore */ } }
  }, [manager, supported, open])

  // coming back to the meeting closes the window it opened by itself
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible' && win && !manual.current) close() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [win, close])
  useEffect(() => () => { win?.close() }, [win])

  // without the window, say it in the tab's title
  const hands = call.peers().filter((p) => p.hand > 0).length
  useEffect(() => {
    if (!manager) return
    const base = document.title.replace(/^✋ \d+ · /, '')
    const set = () => { document.title = hands > 0 && document.hidden ? `✋ ${hands} · ${base}` : base }
    set()
    document.addEventListener('visibilitychange', set)
    return () => { document.removeEventListener('visibilitychange', set); document.title = base }
  }, [hands, manager])

  const node = win ? createPortal(<HandsList call={call} onBack={() => { window.focus(); close() }} />, win.document.body) : null
  return { supported, open: () => open(true), close, isOpen: !!win, node }
}

/** What the little window shows. */
export function HandsList({ call, onBack }: { call: Call; onBack: () => void }) {
  const raised = call.peers().filter((p: Peer) => p.hand > 0).sort((a, b) => a.hand - b.hand)
  const me = call.me()
  return (
    <div className="hands-pip">
      <header><Hand size={16} /><b>Raised hands</b><span>{raised.length}</span></header>
      <div className="list">
        {raised.length === 0 && <p>Nobody has a hand up.</p>}
        {raised.map((p) => (
          <div key={p.id} className="row">
            <i style={{ background: `hsl(${hue(p.name)} 45% 42%)` }}>{initials(p.name)}</i>
            <span>{p.self ? `${p.name} (you)` : p.name}</span><em>{p.hand}</em>
            {me.manager && <button onClick={() => call.lowerHand(p.id)}>Lower</button>}
          </div>))}
      </div>
      <footer>
        {me.manager && raised.length > 1 && <button onClick={() => call.lowerHand('all')}>Lower all</button>}
        <button className="primary" onClick={onBack}>Back to the meeting</button>
      </footer>
    </div>)
}
