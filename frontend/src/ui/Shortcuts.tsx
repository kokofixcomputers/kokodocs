import { useEffect, useState } from 'react'
import { Modal } from './Modal'

export type ShortcutArea = 'general' | 'doc' | 'sheet' | 'slides' | 'form'
let current: ShortcutArea = 'general'
/** Editors tell the cheat sheet which file is open so it starts on the right tab. */
export const setShortcutArea = (a: ShortcutArea) => { current = a }

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const M = MAC ? '⌘' : 'Ctrl'
const ALT = MAC ? '⌥' : 'Alt'
type Row = [string, string[]]   // [what it does, keys (a "/" means "or")]
const SECTIONS: Record<ShortcutArea, { title: string; groups: { name: string; rows: Row[] }[] }> = {
  general: { title: 'Everywhere', groups: [
    { name: 'Navigate', rows: [['Search all your files', [M, 'K']], ['Show this cheat sheet', ['?']], ['Show this cheat sheet (works while typing)', [M, '/']], ['Close a dialog, menu or panel', ['Esc']]] },
    { name: 'Voice typing', rows: [['Dictate: hold the key you chose in the voice settings, speak, then let go', ['hold']], ['Cancel dictation', ['Esc']]] },
  ] },
  doc: { title: 'Documents', groups: [
    { name: 'Text', rows: [['Bold', [M, 'B']], ['Italic', [M, 'I']], ['Underline', [M, 'U']], ['Strikethrough', [M, 'Shift', 'S']], ['Inline code', [M, 'E']], ['Highlight', [M, 'Shift', 'H']]] },
    { name: 'Paragraphs', rows: [['Heading 1, 2, 3', [M, ALT, '1 / 2 / 3']], ['Normal text', [M, ALT, '0']], ['Bulleted list', [M, 'Shift', '8']], ['Numbered list', [M, 'Shift', '7']], ['Checklist', [M, 'Shift', '9']], ['Quote', [M, 'Shift', 'B']], ['Indent a list item', ['Tab']], ['Outdent a list item', ['Shift', 'Tab']]] },
    { name: 'Edit', rows: [['Undo', [M, 'Z']], ['Redo', [M, 'Shift', 'Z']], ['Select all', [M, 'A']], ['Find', [M, 'F']], ['Find and replace', [M, 'H']], ['Next / previous match', ['Enter / Shift Enter']], ['Insert something with the slash menu', ['/']]] },
    { name: 'Type to format', rows: [['Heading', ['# ', '## ', '### ']], ['Bulleted list', ['- ']], ['Numbered list', ['1. ']], ['Checklist', ['[ ] ']], ['Callout', ['[!tip] ']], ['Divider', ['---']]] },
  ] },
  sheet: { title: 'Spreadsheets', groups: [
    { name: 'Move', rows: [['Move one cell', ['Arrows']], ['Jump to the edge of the data', [M, 'Arrows']], ['Next / previous cell', ['Tab / Shift Tab']], ['Start or end of the row', ['Home / End']], ['First / last cell', [M, 'Home / End']], ['Page up / down', ['Page Up / Down']]] },
    { name: 'Select', rows: [['Extend the selection', ['Shift', 'Arrows']], ['Extend to the edge of the data', [M, 'Shift', 'Arrows']], ['Select everything', [M, 'A']]] },
    { name: 'Edit', rows: [['Edit the cell', ['F2 / Enter']], ['Confirm and move down', ['Enter']], ['Cancel the edit', ['Esc']], ['Clear the selection', ['Delete']], ['Fill down', [M, 'D']], ['Fill right', [M, 'R']]] },
    { name: 'Format and history', rows: [['Bold / italic / underline', [M, 'B / I / U']], ['Undo', [M, 'Z']], ['Redo', [M, 'Y']], ['Copy / cut / paste', [M, 'C / X / V']]] },
  ] },
  slides: { title: 'Presentations', groups: [
    { name: 'Selected items', rows: [['Move by 1 pixel (10 with Shift)', ['Arrows']], ['Edit the text', ['Enter']], ['Delete', ['Delete']], ['Duplicate', [M, 'D']], ['Copy / cut / paste', [M, 'C / X / V']], ['Select all on the slide', [M, 'A']], ['Deselect', ['Esc']], ['Undo / redo', [M, 'Z / Y']]] },
    { name: 'Presenting', rows: [['Next slide', ['→ / Space / Enter']], ['Previous slide', ['← / Backspace']], ['First / last slide', ['Home / End']], ['Show or hide speaker notes', ['N']], ['Leave the slideshow', ['Esc']]] },
  ] },
  form: { title: 'Forms', groups: [
    { name: 'Building', rows: [['Undo / redo (when not typing in a box)', [M, 'Z']], ['Add an option below this one', ['Enter']], ['Reorder a question', ['Drag the grip, or use the arrows']]] },
    { name: 'Filling out', rows: [['Move between answers', ['Tab']], ['Pick a date', ['Arrows', 'Enter']], ['Change month in the date picker', ['Page Up / Down']]] },
  ] },
}
const AREAS: ShortcutArea[] = ['general', 'doc', 'sheet', 'slides', 'form']

export function ShortcutsSheet() {
  const [open, setOpen] = useState(false)
  const [area, setArea] = useState<ShortcutArea>('general')
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
      const slash = (e.ctrlKey || e.metaKey) && !e.altKey && e.key === '/'
      const q = (e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey && !typing
      if (!slash && !q) return
      e.preventDefault()
      setArea(current); setOpen((o) => !o)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  if (!open) return null
  const sec = SECTIONS[area]
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)} width={640}>
      <div className="sc">
        <div className="sc-tabs seg" role="tablist">{AREAS.map((a) => <button key={a} role="tab" aria-selected={area === a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{SECTIONS[a].title}</button>)}</div>
        <div className="sc-body">
          {sec.groups.map((g) => (
            <section key={g.name}><h4>{g.name}</h4>
              {g.rows.map(([what, keys]) => (
                <div className="sc-row" key={what}><span>{what}</span>
                  <span className="sc-keys">{keys.map((k, i) => k.includes('/') && k.length > 1 && !/^\//.test(k) ? <span key={i} className="sc-or">{k.split(' / ').map((p, j) => <span key={j}>{j > 0 && <i>or</i>}<kbd>{p}</kbd></span>)}</span> : <kbd key={i}>{k}</kbd>)}</span>
                </div>))}
            </section>))}
        </div>
        <p className="muted sc-foot">Press <kbd>?</kbd> any time you're not typing, or <kbd>{M}</kbd> <kbd>/</kbd> from anywhere.</p>
      </div>
    </Modal>
  )
}
