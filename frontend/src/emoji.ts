/** Twemoji helpers: finds emoji in text and maps each to its SVG (self-hosted in /twemoji). */
export const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|[#*0-9]️?⃣)(?:️|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:‍(?:\p{Extended_Pictographic})(?:️|\p{Emoji_Modifier})?)*)/gu

import codesText from './generated/emoji-codes'
const CODES = new Set<string>(codesText.split(' '))
/** "👍🏽" -> "1f44d-1f3fd" (Twemoji drops the variation selector unless the sequence has a ZWJ). */
export function emojiCode(ch: string): string {
  const s = ch.includes('‍') ? ch : ch.replace(/️/g, '')
  return Array.from(s, (c) => c.codePointAt(0)!.toString(16)).join('-')
}
// The whole set ships as one lazy chunk (about 1.4 MB gzipped). Until it has loaded, emoji come from the individual files.
let pack: Map<string, string> | null = null
let packLoad: Promise<void> | null = null
const uris = new Map<string, string>()
export function loadEmojiPack(): Promise<void> {
  return (packLoad ??= import('./generated/emoji-pack.txt?raw').then((m) => {
    const text = m.default as string, map = new Map<string, string>()
    for (let i = 0; i < text.length;) {
      let j = text.indexOf('\n', i); if (j < 0) j = text.length
      const tab = text.indexOf('\t', i)
      if (tab > 0 && tab < j) map.set(text.slice(i, tab), text.slice(tab + 1, j))
      i = j + 1
    }
    pack = map
  }).catch(() => { packLoad = null }))
}
/** Start loading the pack when the browser is idle (skipped on data saver). */
export function prefetchEmojiPack() {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  const run = () => void loadEmojiPack()
  if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (f: () => void, o?: object) => void }).requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 2000)
}
export const emojiPackReady = () => pack !== null
/** The Twemoji artwork for a file code ("1f600"), from the pack if it loads, otherwise from the self-hosted file. Null if there is none. */
export async function emojiSvgText(code: string): Promise<string | null> {
  await loadEmojiPack()
  const s = pack?.get(code)
  if (s) return s
  try { const r = await fetch(`/twemoji/${code}.svg`); return r.ok ? await r.text() : null } catch { return null }
}
export function emojiUrl(ch: string): string {
  const code = emojiCode(ch)
  const svg = pack?.get(code)
  if (!svg) return `/twemoji/${code}.svg`
  let u = uris.get(code); if (!u) { u = 'data:image/svg+xml,' + encodeURIComponent(svg); uris.set(code, u) }
  return u
}
/** An emoji picture that failed to load (the server restarting during an update, a dropped connection, a half-copied deploy) used to stay
 *  broken until the page was reloaded. Now it tries again by itself: twice from its own file with a pause between, then from the
 *  embedded pack, and if even that fails it shows the plain emoji character instead of a broken-image icon. */
export function installEmojiRecovery() {
  const fail = (img: HTMLImageElement) => { img.classList.add('emoji-failed'); img.removeAttribute('src') }   // the alt text is the emoji itself
  document.addEventListener('error', (e) => {
    const img = e.target
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('emoji') || !img.alt) return
    const n = Number(img.dataset.retry ?? 0)
    img.dataset.retry = String(n + 1)
    const code = emojiCode(img.alt)
    if (img.src.startsWith('data:') || n > 2) { fail(img); return }
    if (n < 2) { window.setTimeout(() => { if (img.isConnected) img.src = `/twemoji/${code}.svg?r=${n + 1}` }, 500 * 3 ** n); return }
    void loadEmojiPack().then(() => { const svg = pack?.get(code); if (svg && img.isConnected) img.src = emojiUrl(img.alt); else fail(img) })
  }, true)   // image errors don't bubble, so listen while the event is still travelling down
}
export const emojiImgHtml = (ch: string) => `<img class="emoji" draggable="false" alt="${ch}" src="${emojiUrl(ch)}">`

/** Replaces emoji characters in an HTML string with Twemoji images (leaves tag attributes alone). */
export function emojiHtml(html: string): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => (tag ? tag : text!.replace(EMOJI_RE, (e) => (hasArt(e) ? emojiImgHtml(e) : e))))
}
/** Twemoji has no artwork for the newest Unicode emoji; those stay as ordinary text so the system font draws them. */
export const hasArt = (ch: string) => CODES.has(emojiCode(ch))
export const hasEmoji = (s: string) => { EMOJI_RE.lastIndex = 0; return EMOJI_RE.test(s) }
