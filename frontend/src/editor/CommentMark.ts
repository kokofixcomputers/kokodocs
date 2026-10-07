import { Mark, mergeAttributes } from '@tiptap/core'

/** Anchors a comment thread to a range of text. It lives in the document, so the anchor follows edits and syncs to everyone. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { commentId: { default: null, parseHTML: (el) => el.getAttribute('data-comment-id'), renderHTML: (a) => (a.commentId ? { 'data-comment-id': a.commentId } : {}) } }
  },
  parseHTML() { return [{ tag: 'span[data-comment-id]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes({ class: 'cmt' }, HTMLAttributes), 0] },
})

export interface Anchor { id: string; from: number; to: number }
export function collectAnchors(doc: import('@tiptap/pm/model').Node): Map<string, Anchor> {
  const out = new Map<string, Anchor>()
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const m of node.marks) if (m.type.name === 'comment' && m.attrs.commentId) {
      const id = m.attrs.commentId as string, cur = out.get(id)
      out.set(id, cur ? { id, from: Math.min(cur.from, pos), to: Math.max(cur.to, pos + node.nodeSize) } : { id, from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  return out
}
