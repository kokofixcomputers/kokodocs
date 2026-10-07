import type { ReactElement } from 'react'
import { EMOJI_RE, emojiUrl, hasArt } from '../emoji'

/** Plain text with any emoji drawn as Twemoji images. */
export function EmojiText({ text }: { text: string }) {
  const out: (string | ReactElement)[] = []
  let last = 0, i = 0
  EMOJI_RE.lastIndex = 0
  for (let m = EMOJI_RE.exec(text); m; m = EMOJI_RE.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(hasArt(m[0]) ? <img key={i++} className="emoji" src={emojiUrl(m[0])} alt={m[0]} draggable={false} /> : m[0])
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
