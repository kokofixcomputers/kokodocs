/** Which addresses can be shown as a player or embedded page, and the address to put in the frame. Everything else gets a preview card. */
export interface Embed { provider: string; src: string; h: number; wide?: boolean }   // h: height in px; wide: fills the line at 16:9

const secs = (t: string | null) => {
  if (!t) return 0
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

export function embedFor(raw: string): Embed | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^(www|m)\./, ''), parts = u.pathname.split('/').filter(Boolean)
  const id = /^[\w-]{6,}$/

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    const v = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? u.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : null
    if (v && id.test(v)) {
      const t = secs(u.searchParams.get('t') ?? u.searchParams.get('start'))
      return { provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${v}${t ? `?start=${t}` : ''}`, h: 0, wide: true }
    }
    return null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = parts.find((p) => /^\d{5,}$/.test(p))
    return v ? { provider: 'Vimeo', src: `https://player.vimeo.com/video/${v}`, h: 0, wide: true } : null
  }
  if (host === 'loom.com' && (parts[0] === 'share' || parts[0] === 'embed') && id.test(parts[1] ?? '')) return { provider: 'Loom', src: `https://www.loom.com/embed/${parts[1]}`, h: 0, wide: true }
  if (host === 'open.spotify.com') {
    const i = parts.findIndex((p) => ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(p))
    if (i >= 0 && id.test(parts[i + 1] ?? '')) return { provider: 'Spotify', src: `https://open.spotify.com/embed/${parts[i]}/${parts[i + 1]}`, h: parts[i] === 'track' || parts[i] === 'episode' ? 152 : 352 }
    return null
  }
  if ((host === 'twitter.com' || host === 'x.com') && parts[1] === 'status' && /^\d+$/.test(parts[2] ?? '')) return { provider: 'X', src: `https://platform.twitter.com/embed/Tweet.html?id=${parts[2]}`, h: 480 }
  if (host === 'codepen.io' && parts.length >= 3 && ['pen', 'full', 'details'].includes(parts[1])) return { provider: 'CodePen', src: `https://codepen.io/${parts[0]}/embed/${parts[2]}?default-tab=result`, h: 420 }
  if (host === 'figma.com' && ['file', 'design', 'proto', 'board'].includes(parts[0])) return { provider: 'Figma', src: `https://www.figma.com/embed?embed_host=kokodocs&url=${encodeURIComponent(u.href)}`, h: 450 }
  if (host === 'maps.google.com' || (host === 'google.com' && parts[0] === 'maps' && u.searchParams.get('q'))) {
    const q = u.searchParams.get('q'); return q ? { provider: 'Google Maps', src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, h: 380 } : null
  }
  return null
}

/** the single web address in a piece of text, or null */
export function soleUrl(text: string): string | null {
  const t = text.trim()
  if (!t || t.length > 2000 || /\s/.test(t) || !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(t)) return null
  try { new URL(t); return t } catch { return null }
}
