/** Links for image/video blocks. Only http(s) links and our own uploads are ever rendered. */
export function safeUrl(u: string | undefined): string | null {
  const s = (u ?? '').trim()
  if (!s || s.length > 2000) return null
  if (/^\/api\/images\/[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(s)) return s
  try { const x = new URL(s); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null } catch { return null }
}

export type VideoSource = { kind: 'iframe'; src: string; provider: string } | { kind: 'file'; src: string }

const FILE = /\.(mp4|webm|ogv|ogg|m4v|mov)(\?.*)?$/i
/** YouTube and Vimeo links become privacy-friendly embeds; direct video files play in a <video>. Anything else is not embeddable. */
export function videoSource(u: string | undefined): VideoSource | null {
  const url = safeUrl(u)
  if (!url) return null
  const x = new URL(url), host = x.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = x.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (x.pathname === '/watch') id = x.searchParams.get('v')
    else { const m = /^\/(embed|shorts|live|v)\/([^/?]+)/.exec(x.pathname); if (m) id = m[2] }
  }
  if (id && /^[\w-]{6,20}$/.test(id)) {
    const t = x.searchParams.get('t') ?? x.searchParams.get('start'), start = t && /^\d+s?$/.test(t) ? parseInt(t, 10) : 0
    return { kind: 'iframe', provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}` }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /(?:^|\/)(\d{5,12})(?:\/|$)/.exec(x.pathname)
    if (m) return { kind: 'iframe', provider: 'Vimeo', src: `https://player.vimeo.com/video/${m[1]}` }
  }
  if (FILE.test(x.pathname + x.search)) return { kind: 'file', src: url }
  return null
}
