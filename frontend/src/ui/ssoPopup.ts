/** Single sign-on in the desktop app happens in a small pop-up window instead of replacing the app.
 *  The pop-up ends up on one of the usual landing pages (/auth/callback, /login?error=, /?sso=); there it hands the result
 *  to the main window over a BroadcastChannel (not window.opener: some sign-in pages cut that link) and closes itself. */
const KEY = 'koko.ssoPopup', CH = 'koko-sso'
export type SsoResult = { token?: string; mfa?: string; next?: string; error?: string; linked?: string }

export function openSso(url: string, onResult: (r: SsoResult) => void, onClosed?: () => void) {
  const ch = new BroadcastChannel(CH)
  try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  const w = window.open(url, 'koko-sso', 'popup,width=520,height=720')
  let done = false
  const finish = () => { if (done) return; done = true; ch.close(); window.clearInterval(t); try { localStorage.removeItem(KEY) } catch { /* ignore */ } }
  ch.onmessage = (e) => { finish(); onResult(e.data as SsoResult) }
  const t = window.setInterval(() => { if (!w || w.closed) { const was = !done; finish(); if (was) onClosed?.() } }, 600)
}

/** (the marker is only ever set by openSso, in the desktop app) true (and the window closes) when this window is the sign-in pop-up that has just come back from the provider */
export function ssoPopupLanding(): boolean {
  let at = 0; try { at = Number(localStorage.getItem(KEY) ?? 0) } catch { /* ignore */ }
  if (!at || Date.now() - at > 10 * 60_000) return false
  const q = new URLSearchParams(location.search), frag = new URLSearchParams(location.hash.slice(1))
  let r: SsoResult | null = null
  if (location.pathname === '/auth/callback') r = { token: frag.get('token') ?? undefined, mfa: frag.get('mfa') ?? undefined, next: frag.get('next') ?? undefined }
  else if (location.pathname === '/login' && q.get('error')) r = { error: q.get('error')! }
  else if (location.pathname === '/' && q.get('sso')) r = q.get('sso')!.startsWith('linked') ? { linked: q.get('sso')! } : { error: q.get('sso')! }
  if (!r) return false
  const ch = new BroadcastChannel(CH); ch.postMessage(r); window.setTimeout(() => { ch.close(); window.close() }, 50)
  document.body.innerHTML = '<p style="font:15px system-ui;padding:40px;text-align:center">You can close this window.</p>'
  return true
}
