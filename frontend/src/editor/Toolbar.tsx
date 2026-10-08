import { EmojiButton } from './EmojiPicker'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, ChevronDown, Code, Highlighter, ImagePlus, Italic,
  FileCog, Search, Info, Link2, List, ListChecks, KeyboardOff, IndentDecrease, IndentIncrease, ListOrdered, Minus, PanelTop, Paintbrush, Plus, Printer, Quote, Redo2, RemoveFormatting, Strikethrough,
  Subscript, Superscript, Table2, Underline, Undo2,
} from 'lucide-react'
import { DEFAULT_FONT } from '../fonts'
import { ShapeButton } from './ShapePicker'
import { useKeyboardOpen } from '../ui/KeyboardFit'
import { Popover } from '../ui/Popover'
import { VoiceControl } from '../voice/VoiceControl'
import type { Voice } from '../voice/useVoiceTyping'
import { ColorPicker } from './ColorPicker'
import { useFormatPainter } from './FormatPainter'
import { FontPicker } from './FontPicker'
import { HeadingPicker } from './headingLinks'

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 60, 72, 96]
const HEADING_SIZE: Record<number, number> = { 1: 26, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 }
const STYLES = [
  { label: 'Normal text', level: 0, cls: 's-p' },
  { label: 'Heading 1', level: 1, cls: 's-h1' }, { label: 'Heading 2', level: 2, cls: 's-h2' },
  { label: 'Heading 3', level: 3, cls: 's-h3' }, { label: 'Heading 4', level: 4, cls: 's-h4' },
  { label: 'Heading 5', level: 5, cls: 's-h5' }, { label: 'Heading 6', level: 6, cls: 's-h6' },
] as const

interface BtnProps { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean }
export function TBtn({ icon, label, active, onClick, disabled }: BtnProps) {
  return (
    <button type="button" className={`tb-btn ${active ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={active}
      disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</button>
  )
}

function TablePicker({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0])
  return (
    <div className="table-picker">
      <div className="tp-grid" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1, c = (i % 8) + 1
          return <button key={i} className={r <= hover[0] && c <= hover[1] ? 'on' : ''}
            onMouseEnter={() => setHover([r, c])} onClick={() => onPick(r, c)} aria-label={`${r} by ${c}`} />
        })}
      </div>
      <div className="tp-label">{hover[0] ? `${hover[0]} × ${hover[1]} table` : 'Insert table'}</div>
    </div>
  )
}

/** Pressing the bar must not take focus from the page: on a phone that would close the keyboard. Text boxes inside menus still work. */
const keepFocus = (e: React.SyntheticEvent) => { if (!(e.target as HTMLElement).closest('input, textarea, select')) e.preventDefault() }

export function Toolbar({ editor, onImage, onHeaderFooter, onPageSetup, onFind, voice, extras }: { extras?: React.ReactNode; editor: Editor; onImage: (f: File) => void; onHeaderFooter?: () => void; onPageSetup?: () => void; onFind?: () => void; voice?: Voice }) {
  const file = useRef<HTMLInputElement>(null)
  const kbOpen = useKeyboardOpen()
  const painter = useFormatPainter(editor)
  const ts = editor.getAttributes('textStyle')
  const headingLevel = (editor.getAttributes('heading').level as number | undefined) ?? 0
  const family: string = ts.fontFamily ?? DEFAULT_FONT
  const size: number = ts.fontSize ?? (headingLevel ? HEADING_SIZE[headingLevel] : 11)
  const can = editor.isEditable
  useEffect(() => { const f = () => file.current?.click(); window.addEventListener('koko:pick-image', f); return () => window.removeEventListener('koko:pick-image', f) }, [])
  const run = () => editor.chain().focus()
  const styleLabel = STYLES.find((s) => s.level === headingLevel)?.label ?? 'Normal text'

  const setLink = (close: () => void, url: string) => {
    close()
    if (!url.trim()) run().extendMarkRange('link').unsetLink().run()
    else run().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|#h-)/i.test(url) ? url : `https://${url}` }).run()
  }
  const linkToHeading = (close: () => void, anchor: string, h: { text: string }) => {   // a link that jumps to a heading in this document
    close()
    const { from, to } = editor.state.selection
    if (from === to && !editor.isActive('link')) run().insertContent({ type: 'text', text: h.text, marks: [{ type: 'link', attrs: { href: `#${anchor}` } }] }).run()
    else run().extendMarkRange('link').setLink({ href: `#${anchor}` }).run()
  }

  return (
    <div className={`toolbar ${can ? '' : 'readonly'}`} onPointerDown={keepFocus} onMouseDown={keepFocus}>
      {kbOpen && can && <div className="tb-group kb-hide"><TBtn icon={<KeyboardOff size={17} />} label="Hide keyboard" onClick={() => { (document.activeElement as HTMLElement | null)?.blur() }} /></div>}
      <div className="tb-group">
        <TBtn icon={<Undo2 size={17} />} label="Undo" onClick={() => (editor.commands as any).undo()} disabled={!can} />
        <TBtn icon={<Redo2 size={17} />} label="Redo" onClick={() => (editor.commands as any).redo()} disabled={!can} />
        {onFind && <TBtn icon={<Search size={17} />} label="Find and replace (Ctrl+F)" onClick={onFind} />}
        <TBtn icon={<Printer size={17} />} label="Print" onClick={() => window.print()} />
        <TBtn icon={<Paintbrush size={17} />} label="Paint format (double-click to keep painting)" active={painter.active} onClick={painter.toggle} disabled={!can} />
      </div>

      <fieldset disabled={!can} className="tb-fieldset">
        <div className="tb-group">
          <Popover className="pop-menu" trigger={({ toggle }) => (
            <button className="tb-select" style={{ width: 128 }} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
              <span>{styleLabel}</span><ChevronDown size={15} />
            </button>)}>
            {(close) => STYLES.map((s) => (
              <button key={s.level} className={`style-row ${s.cls} ${s.level === headingLevel ? 'on' : ''}`}
                onClick={() => { close(); s.level ? run().setHeading({ level: s.level as 1 }).run() : run().setParagraph().run() }}>
                {s.label}
              </button>))}
          </Popover>
          <Popover className="pop-font" trigger={({ toggle }) => (
            <button className="tb-select" style={{ width: 168 }} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
              <span className="trunc">{family}</span><ChevronDown size={15} />
            </button>)}>
            {(close) => <FontPicker value={family} onPick={(f) => { close(); run().setFontFamily(f).run() }} />}
          </Popover>
          <div className="size-box">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => run().setFontSize(Math.max(1, size - 1)).run()} aria-label="Smaller"><Minus size={14} /></button>
            <Popover className="pop-menu small" trigger={({ toggle }) => <button className="size-val" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>{size}</button>}>
              {(close) => SIZES.map((s) => (
                <button key={s} className={`menu-row ${s === size ? 'on' : ''}`} onClick={() => { close(); run().setFontSize(s).run() }}>{s}</button>))}
            </Popover>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => run().setFontSize(Math.min(400, size + 1)).run()} aria-label="Larger"><Plus size={14} /></button>
          </div>
        </div>

        <div className="tb-group">
          <TBtn icon={<Bold size={17} />} label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => run().toggleBold().run()} />
          <TBtn icon={<Italic size={17} />} label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => run().toggleItalic().run()} />
          <TBtn icon={<Underline size={17} />} label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => run().toggleUnderline().run()} />
          <TBtn icon={<Strikethrough size={17} />} label="Strikethrough" active={editor.isActive('strike')} onClick={() => run().toggleStrike().run()} />
          <Popover trigger={({ toggle }) => (
            <button className="tb-btn color" title="Text color" aria-label="Text color" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
              <Baseline size={17} /><i style={{ background: ts.color ?? 'var(--ink)' }} />
            </button>)}>
            {(close) => <ColorPicker value={ts.color} noneLabel="Default color"
              onPick={(c) => { close(); c ? run().setColor(c).run() : run().unsetColor().run() }} />}
          </Popover>
          <Popover trigger={({ toggle }) => (
            <button className={`tb-btn color ${editor.isActive('highlight') ? 'on' : ''}`} title="Highlight color" aria-label="Highlight color"
              onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
              <Highlighter size={17} /><i style={{ background: editor.getAttributes('highlight').color ?? '#fde047' }} />
            </button>)}>
            {(close) => <ColorPicker value={editor.getAttributes('highlight').color} noneLabel="No highlight"
              onPick={(c) => { close(); c ? run().setHighlight({ color: c }).run() : run().unsetHighlight().run() }} />}
          </Popover>
          <Popover className="pop-link" trigger={({ toggle }) => (
            <TBtn icon={<Link2 size={17} />} label="Link" active={editor.isActive('link')} onClick={toggle} />)}>
            {(close) => (
              <>
              <form className="link-form" onSubmit={(e) => { e.preventDefault(); setLink(close, (e.currentTarget.elements.namedItem('url') as HTMLInputElement).value) }}>
                <input name="url" autoFocus placeholder="Paste a link" defaultValue={editor.getAttributes('link').href ?? ''} />
                <button className="btn btn-primary btn-pill btn-sm">Apply</button>
              </form>
              <div className="link-heads"><h5>Or jump to a heading in this document</h5><HeadingPicker editor={editor} current={String(editor.getAttributes('link').href ?? '').slice(1) || null} onPick={(a, h) => linkToHeading(close, a, h)} /></div>
              </>)}
          </Popover>
        </div>

        <div className="tb-group">
          <TBtn icon={<AlignLeft size={17} />} label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => run().setTextAlign('left').run()} />
          <TBtn icon={<AlignCenter size={17} />} label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => run().setTextAlign('center').run()} />
          <TBtn icon={<AlignRight size={17} />} label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => run().setTextAlign('right').run()} />
          <TBtn icon={<AlignJustify size={17} />} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => run().setTextAlign('justify').run()} />
        </div>

        <div className="tb-group">
          <TBtn icon={<List size={17} />} label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => run().toggleBulletList().run()} />
          <TBtn icon={<ListOrdered size={17} />} label="Numbered list" active={editor.isActive('orderedList')} onClick={() => run().toggleOrderedList().run()} />
          <TBtn icon={<ListChecks size={17} />} label="Checklist" active={editor.isActive('taskList')} onClick={() => run().toggleTaskList().run()} />
          {(editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')) && <>
            <TBtn icon={<IndentDecrease size={17} />} label="Move out of the list (Shift+Tab)" active={false} onClick={() => { const t = editor.isActive('taskItem') ? 'taskItem' : 'listItem'; run().liftListItem(t).run() }} />
            <TBtn icon={<IndentIncrease size={17} />} label="Nest inside the item above (Tab)" active={false} onClick={() => { const t = editor.isActive('taskItem') ? 'taskItem' : 'listItem'; run().sinkListItem(t).run() }} />
          </>}
          <TBtn icon={<Quote size={17} />} label="Quote" active={editor.isActive('blockquote')} onClick={() => run().toggleBlockquote().run()} />
        </div>

        <div className="tb-group">
          <Popover trigger={({ toggle }) => <TBtn icon={<Table2 size={17} />} label="Insert table" active={editor.isActive('table')} onClick={toggle} />}>
            {(close) => <TablePicker onPick={(r, c) => { close(); run().insertTable({ rows: r, cols: c, withHeaderRow: true }).run() }} />}
          </Popover>
          <TBtn icon={<ImagePlus size={17} />} label="Insert image" onClick={() => file.current?.click()} />
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = '' }} />
          <ShapeButton editor={editor} />
          <EmojiButton editor={editor} />
          <TBtn icon={<Info size={17} />} label="Callout" active={editor.isActive('callout')} onClick={() => (editor.isActive('callout') ? run().lift('callout').run() : run().setCallout('info').run())} />
          <TBtn icon={<Minus size={17} />} label="Divider" onClick={() => run().setHorizontalRule().run()} />
          <TBtn icon={<Code size={17} />} label="Code" active={editor.isActive('code')} onClick={() => run().toggleCode().run()} />
          <TBtn icon={<Superscript size={17} />} label="Superscript" active={editor.isActive('superscript')} onClick={() => run().toggleSuperscript().run()} />
          <TBtn icon={<Subscript size={17} />} label="Subscript" active={editor.isActive('subscript')} onClick={() => run().toggleSubscript().run()} />
          <TBtn icon={<RemoveFormatting size={17} />} label="Clear formatting" onClick={() => run().unsetAllMarks().clearNodes().run()} />
        </div>

        {extras}

        {voice && <div className="tb-group"><VoiceControl voice={voice} editable={can} /></div>}

        {(onHeaderFooter || onPageSetup) && <div className="tb-group">
          {onHeaderFooter && <button className="tb-pill" onMouseDown={(e) => e.preventDefault()} onClick={onHeaderFooter}>
            <PanelTop size={16} />Header &amp; footer
          </button>}
          {onPageSetup && <button className="tb-pill" onMouseDown={(e) => e.preventDefault()} onClick={onPageSetup}><FileCog size={16} />Page setup</button>}
        </div>}
      </fieldset>
    </div>
  )
}
