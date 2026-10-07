import { EMOJI_RE, emojiCode, hasArt } from '../emoji'
import { CALLOUT_ICONS } from './calloutIcons'

/** Pictures an exported page needs so it looks right on its own, with nothing fetched from KokoDocs:
 *  the Twemoji artwork for the emoji that appear in it, and the icons of the callouts that appear in it. Only what is used is included,
 *  and each is written once however many times it appears. */

export const EXPORT_ASSET_CSS = `
.emoji { display: inline-block; width: 1.2em; height: 1.2em; vertical-align: -.2em; margin: 0 .04em; overflow: hidden; text-indent: -9999px; white-space: nowrap; background: center / contain no-repeat; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.callout { position: relative; } .callout::before { padding-left: 24px; }
.callout::after { content: ''; position: absolute; left: 14px; top: 12px; width: 16px; height: 16px; background: var(--cc); -webkit-mask: var(--ci) center / contain no-repeat; mask: var(--ci) center / contain no-repeat; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`

/** Wrap each emoji (outside code, and outside tag attributes) in <span class="emoji e-CODE">, keeping the character as the text so copying, searching and
 *  screen readers still see it. `svgFor` returns the artwork for a Twemoji file code, or null (then the emoji is left as ordinary text). */
export async function bundleEmoji(html: string, svgFor: (code: string) => Promise<string | null>): Promise<{ html: string; css: string; used: string[] }> {
  const found = new Set<string>()
  // pass 1: which emoji appear in text that isn't code
  const scan = (fn: (text: string) => string) => {
    let code = 0
    return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
      if (tag) { const t = /^<(\/?)(pre|code)\b/i.exec(tag); if (t) code += t[1] ? -1 : 1; return tag }
      return code > 0 ? text! : fn(text!)
    })
  }
  scan((t) => { EMOJI_RE.lastIndex = 0; for (const m of t.matchAll(EMOJI_RE)) if (hasArt(m[0])) found.add(emojiCode(m[0])); return t })
  const svgs = new Map<string, string>()
  await Promise.all([...found].map(async (c) => { const s = await svgFor(c).catch(() => null); if (s) svgs.set(c, s) }))
  const out = svgs.size ? scan((t) => t.replace(EMOJI_RE, (e) => { const c = emojiCode(e); return hasArt(e) && svgs.has(c) ? `<span class="emoji e-${c}">${e}</span>` : e })) : html
  const css = [...svgs].map(([c, svg]) => `.e-${c}{background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`).join('\n')
  return { html: out, css, used: [...svgs.keys()] }
}

/** The icon CSS for the callout kinds present in the page. */
export function calloutIconCss(html: string): string {
  const kinds = new Set([...html.matchAll(/<[^>]*\bdata-callout="([^"]*)"/g)].map((m) => m[1]))
  if (!kinds.size) return ''
  const known = (k: string) => k in CALLOUT_ICONS
  const rules: string[] = []
  if ([...kinds].some((k) => k === 'note' || !known(k))) rules.push(`.callout{--ci:${CALLOUT_ICONS.note}}`)   // note is the default, and what unknown kinds fall back to
  for (const k of kinds) if (known(k) && k !== 'note') rules.push(`.callout[data-callout=${k}]{--ci:${CALLOUT_ICONS[k]}}`)
  return rules.join('\n')
}
