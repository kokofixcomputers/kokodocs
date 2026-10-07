import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { emojiHtml } from '../emoji'

marked.setOptions({ gfm: true, breaks: true })
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow') }
})

export const renderMarkdown = (src: string) => emojiHtml(DOMPurify.sanitize(marked.parse(src, { async: false }) as string))

/** Chat-safe markdown (everything the model writes is sanitised). */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
