import { hasArt, loadEmojiPack } from '../emoji'

export interface Emo { group?: number; hexcode: string; label: string; tags?: string[]; unicode: string; skins?: { unicode: string; hexcode: string }[] }
export interface EmojiIndex { list: Emo[]; /** `:name:` words (GitHub's names first) for each emoji, by hexcode */ codes: Map<string, string[]>; /** shortcode -> emoji */ bySlug: Map<string, Emo> }

let index: Promise<EmojiIndex> | null = null
/** The emoji list, with the `:shortcode:` names people type (`:tada:`, `:+1:`). Loaded once, on first use, together with the picture pack so images appear at once. */
export function loadEmojiIndex(): Promise<EmojiIndex> {
  return (index ??= (async () => {
    const [compact, github, emojibase] = await Promise.all([
      import('emojibase-data/en/compact.json'), import('emojibase-data/en/shortcodes/github.json'), import('emojibase-data/en/shortcodes/emojibase.json'), loadEmojiPack(),
    ])
    const list = (compact.default as unknown as Emo[]).filter((e) => e.group !== undefined && e.group !== 2 && hasArt(e.unicode))
    const codes = new Map<string, string[]>(), bySlug = new Map<string, Emo>()
    const add = (src: Record<string, string | string[]>, e: Emo) => { const v = src[e.hexcode]; if (!v) return; for (const s of Array.isArray(v) ? v : [v]) { const c = (codes.get(e.hexcode) ?? []); if (!c.includes(s)) { c.push(s); codes.set(e.hexcode, c) } if (!bySlug.has(s)) bySlug.set(s, e) } }
    for (const e of list) add(github.default as unknown as Record<string, string | string[]>, e)   // GitHub's names win when two emoji share one
    for (const e of list) add(emojibase.default as unknown as Record<string, string | string[]>, e)
    return { list, codes, bySlug }
  })().catch((err) => { index = null; throw err }))
}

/** The skin-toned version of an emoji, if the person has picked a default tone in the emoji picker. */
export function toned(e: Emo): string {
  let tone = 0; try { tone = Number(localStorage.getItem('koko.emoji.tone') ?? 0) } catch { /* private mode */ }
  if (tone > 0) { const k = `1F3F${'BCDEF'[tone - 1]}`; const s = e.skins?.find((x) => { const m = x.hexcode.match(/1F3F[B-F]/g); return m?.length === 1 && m[0] === k }); if (s) return s.unicode }
  return e.unicode
}

export interface EmojiHit { emoji: Emo; slug: string; char: string }
/** Emoji matching what has been typed after the colon: names that start with it come first, then names and words that contain it. */
export function searchEmoji(ix: EmojiIndex, query: string, limit = 8): EmojiHit[] {
  const q = query.toLowerCase()
  if (!/^[a-z0-9_+-]+$/.test(q)) return []
  const scored: { hit: EmojiHit; score: number }[] = []
  for (const e of ix.list) {
    const slugs = ix.codes.get(e.hexcode) ?? []
    let best = 99, slug = slugs[0] ?? e.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    for (const s of slugs) { const sc = s === q ? 0 : s.startsWith(q) ? 1 : s.includes(q) ? 3 : 99; if (sc < best) { best = sc; slug = s } }
    if (best === 99) {
      const label = e.label.toLowerCase()
      if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) best = 2
      else if (e.tags?.some((t) => t.toLowerCase().startsWith(q))) best = 4
      else if (label.includes(q)) best = 5
    }
    if (best < 99) scored.push({ hit: { emoji: e, slug, char: toned(e) }, score: best * 1000 + slug.length })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.hit)
}
