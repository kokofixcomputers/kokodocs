import type { Editor } from '@tiptap/react'

const count = (text: string) => {
  const flat = text.replace(/\n/g, '')
  return { words: text.split(/\s+/).filter(Boolean).length, chars: Array.from(flat).length, noSpaces: Array.from(flat.replace(/\s/g, '')).length }
}
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Text that is selected right now (a range of text, or several table cells), or null. */
function selectedText(editor: Editor): string | null {
  const { doc, selection } = editor.state
  if (selection.empty) return null
  const text = selection.ranges.map((r) => doc.textBetween(r.$from.pos, r.$to.pos, '\n', '\n')).join('\n')
  return text.replace(/\s/g, '') ? text : null   // picking an image or an empty cell isn't "a selection" worth counting
}

/** A floating pill with the document's words and pages. While you have something selected it switches to the selection's words and characters. */
export function StatsPill({ editor, pages, editing }: { editor: Editor; pages: number; editing: number }) {
  const total = count(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n'))
  const picked = selectedText(editor)
  const sel = picked ? count(picked) : null
  return (
    <div className={`stats-pill ${sel ? 'sel' : ''}`} role="status" aria-live="polite" title={sel ? `${sel.noSpaces.toLocaleString()} characters without spaces` : undefined}>
      {sel ? (
        <>
          <span><b>{plural(sel.words, 'word')}</b></span><i />
          <span><b>{plural(sel.chars, 'character')}</b></span><i />
          <span className="of">selected of {total.words.toLocaleString()}</span>
        </>
      ) : (
        <>
          <span>{plural(total.words, 'word')}</span><i />
          <span>{plural(pages, 'page')}</span>
          {editing > 0 && <><i /><span>{editing + 1} editing</span></>}
        </>
      )}
    </div>
  )
}
