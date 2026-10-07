import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** What each button does, keyed by its label. Shown under the name when you hover (or keyboard-focus) a toolbar button. */
const TIPS: Record<string, string> = {
  'undo': 'Reverse your last change',
  'redo': 'Bring back the change you just undid',
  'find and replace': 'Search the document and swap text',
  'print': 'Print the document, or save it as a PDF',
  'paint format': 'Copy the style of the selected text, then click other text to apply it. Double-click to keep painting',
  'smaller': 'Make the text size one point smaller',
  'larger': 'Make the text size one point bigger',
  'bold': 'Make the selected text thicker',
  'italic': 'Slant the selected text',
  'underline': 'Draw a line under the selected text',
  'strikethrough': 'Cross out the selected text',
  'text color': 'Change the color of the selected text',
  'highlight color': 'Add a colored background behind the selected text',
  'link': 'Turn the selected text into a link',
  'align left': 'Line text up with the left edge',
  'align center': 'Center the text',
  'align right': 'Line text up with the right edge',
  'justify': 'Stretch lines to fill the full width',
  'bulleted list': 'Start a list with bullet points',
  'numbered list': 'Start a list with numbers',
  'checklist': 'Track tasks with checkboxes you can tick off',
  'quote': 'Set a passage apart as a quotation',
  'insert table': 'Add a grid of rows and columns',
  'insert image': 'Upload a picture into the document',
  'insert shape': 'Draw a rectangle, ellipse, arrow, star or line you can colour, label and resize',
  'insert emoji': 'Pick an emoji to add at the cursor',
  'callout': 'Wrap text in a highlighted note box (info, tip, warning)',
  'divider': 'Add a horizontal line',
  'code': 'Show the selected text in a monospaced font',
  'superscript': 'Raise the text above the line, like x²',
  'subscript': 'Lower the text below the line, like H₂O',
  'clear formatting': 'Remove fonts, colors and styles from the selection',
  'voice typing': 'Dictate instead of typing. Hold the key, or tap the mic on a phone',
  'header & footer': 'Set text that repeats at the top and bottom of every page',
  'page setup': 'Choose paper size, orientation and margins',
  'version history': 'See earlier versions and restore one',
  'comments': 'Read and add comments on the text',
  'toggle document tabs': 'Show or hide the outline of your headings',
  'toggle theme': 'Switch between light and dark',
  'assistant': 'Ask Koko to read, explain or edit this file',
  'proofread': 'Check spelling, grammar and punctuation',
  'share': 'Invite people, or create a link anyone can use',
  'export': 'Download as PDF, Word, Markdown, HTML and more',
  'download': 'Download as PDF, Word, Markdown, HTML and more',
  'new conversation': 'Start a fresh chat with the assistant',
  'past conversations': 'Reopen an earlier chat about this file',
  'connection settings': 'Choose which AI service the assistant uses',
  'match case': 'Only match text with the same capital letters',
  'previous match': 'Jump to the match before this one',
  'next match': 'Jump to the next match',
  'borders': 'Draw lines around or between the selected cells',
  'wrap text': 'Show long text on several lines inside the cell',
  'freeze panes': 'Keep the top rows or left columns visible while you scroll',
  'functions': 'Insert a formula like SUM or AVERAGE',
  'sort': 'Order the rows by the selected column',
  'insert chart': 'Turn the selected cells into a chart',
  'rows and columns': 'Insert or delete rows and columns',
  'import csv': 'Load a CSV or Excel file into this sheet',
  'download as csv': 'Save this sheet as a CSV file',
  'format as currency': 'Show numbers as money, like $1,200.00',
  'format as percent': 'Show numbers as percentages',
  'increase decimal places': 'Show more digits after the decimal point',
  'decrease decimal places': 'Show fewer digits after the decimal point',
  'align top': 'Put the text at the top of the cell', 'align middle': 'Center the text vertically in the cell', 'align bottom': 'Put the text at the bottom of the cell',
  'add sheet': 'Add another tab to this spreadsheet',
  'cell address': 'Type a cell like B7 or a range like A1:C9 to jump to it',
  'formula bar': 'See and edit what is in the selected cell',
  'table': 'Insert a table: drag over the grid to pick its size',
  'chart': 'Insert a chart. You type its data directly, nothing is linked to a spreadsheet',
  'add row below': 'Add a row under the selected cell', 'add column right': 'Add a column to the right of the selected cell', 'header row': 'Style the first row as a header',
  'text box': 'Add a box you can type in anywhere on the slide',
  'shape': 'Add a rectangle, ellipse, triangle, line or arrow',
  'image': 'Upload a picture onto the slide',
  'theme': 'Change the colors and fonts of the whole presentation',
  'slide background': 'Set a background color for this slide only',
  'transition': 'How slides change while presenting',
  'bring to front': 'Move the selected items in front of the others',
  'send to back': 'Move the selected items behind the others',
  'duplicate': 'Make a copy of the selected items',
  'delete': 'Remove the selected items',
  'bullet points': 'Show each line of the text as a bullet',
  'fill color': 'Color the inside of the selected shape or the cell',
  'outline color': 'Color the outline of the selected shape',
  'present': 'Play the slideshow full screen',
  'all documents': 'Go back to your documents',
}
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
const SHORT = /\(([^)]*(?:Ctrl|Cmd|Shift|Alt|Esc|Enter)[^)]*)\)/i
const SCOPE = '.ed-top, .ed-toolbar-wrap, .bubble, .dash-top, .ai-head, .find-bar, .emoji-tabs, .sheet-tabs, .home-nav, .cm-panel .side-title'

interface Tip { title: string; desc?: string; keys?: string; rect: DOMRect }

function read(el: HTMLElement): { title: string; desc?: string; keys?: string } | null {
  const raw = el.getAttribute('data-tip') || el.getAttribute('data-orig-title') || el.getAttribute('title') || el.getAttribute('aria-label') || ''
  if (!raw) return null
  const [t, d] = raw.split('|')
  const m = SHORT.exec(t)
  const title = t.replace(SHORT, '').trim()
  const visible = (el.textContent ?? '').trim()
  const desc = d || TIPS[norm(title)] || TIPS[norm(visible)]
  // text buttons without a known description already say what they do
  if (visible && !desc) return null
  return { title: title || visible, desc, keys: m?.[1] }
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!matchMedia('(hover: hover)').matches) return
    let timer = 0
    let cur: HTMLElement | null = null
    const restore = () => { if (cur?.hasAttribute('data-orig-title')) { cur.setAttribute('title', cur.getAttribute('data-orig-title')!); cur.removeAttribute('data-orig-title') } }
    const hide = () => { window.clearTimeout(timer); restore(); cur = null; setTip(null); setPos(null) }
    const over = (e: MouseEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"], [data-tip], [title]') as HTMLElement | null
      if (!t || t === cur || !t.closest(SCOPE) || t.matches('input, textarea, select')) { if (!t || !t.closest(SCOPE)) hide(); return }
      hide(); cur = t
      if (t.hasAttribute('title')) { t.setAttribute('data-orig-title', t.getAttribute('title')!); t.removeAttribute('title') }
      const info = read(t); if (!info) return
      timer = window.setTimeout(() => setTip({ ...info, rect: t.getBoundingClientRect() }), 380)
    }
    const out = (e: MouseEvent) => { if (cur && !cur.contains(e.relatedTarget as Node | null)) hide() }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('scroll', hide, true)
    return () => { hide(); document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out); document.removeEventListener('mousedown', hide, true); document.removeEventListener('keydown', hide, true); window.removeEventListener('scroll', hide, true) }
  }, [])

  useEffect(() => {
    if (!tip || !box.current) return
    const b = box.current.getBoundingClientRect(), r = tip.rect
    let top = r.bottom + 10
    if (top + b.height > innerHeight - 8) top = Math.max(8, r.top - b.height - 10)
    const left = Math.max(8, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 8))
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div ref={box} className="koko-tip" role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
      <div className="kt-head"><b>{tip.title}</b>{tip.keys && <span className="kt-keys">{tip.keys.split('+').map((k) => <kbd key={k}>{k.trim()}</kbd>)}</span>}</div>
      {tip.desc && <span className="kt-desc">{tip.desc}</span>}
    </div>, document.body)
}
