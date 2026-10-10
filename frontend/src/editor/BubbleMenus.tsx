import { useEffect, useState } from 'react'
import { BubbleMenu, type Editor } from '@tiptap/react'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ArrowDownFromLine, ArrowRightFromLine, Combine, Palette,
  MessageSquarePlus, LayoutGrid, Bold as BoldIcon, Italic as ItalicIcon, Underline as UnderlineIcon, Strikethrough as StrikeIcon, Code as CodeIcon, Link as LinkIcon, Highlighter as HighlighterIcon, Shapes, Type, Minus, Plus, Rows3, Columns3, Split, Trash2, TableProperties, Image as ImageIcon,
} from 'lucide-react'
import { CellSelection, TableMap, mergeCells, selectionCell } from '@tiptap/pm/tables'
import { toast } from '../ui/Toast'
import { CALLOUT_COLORS, CALLOUT_KINDS, CUSTOM_DEFAULT_BG, calloutKind, defaultTitle } from './Callout'
import { Select } from '../ui/Select'
import { Popover } from '../ui/Popover'
import { ColorPicker } from './ColorPicker'
import { askText } from '../ui/Dialogs'
import { SHAPE_KINDS, cleanShape, type ShapeKind } from './shapes'
import { TABLE_STYLES } from './TableExtensions'

const Btn = ({ icon, label, tip, onClick, danger, active }: { icon: React.ReactNode; label: string; tip?: string; onClick: () => void; danger?: boolean; active?: boolean }) => (
  <button type="button" aria-pressed={active} className={`bb-btn ${danger ? 'danger' : ''} ${active ? 'on' : ''}`} data-tip={tip ? `${label}|${tip}` : label} aria-label={label}
    onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon}</button>
)

/** Join the cell the cursor is in with its neighbour, without dragging a selection: handy on a phone, where you can't. */
function mergeNeighbour(editor: Editor, dir: 'right' | 'down') {
  const { state, view } = editor
  let $cell
  try { $cell = selectionCell(state) } catch { return }
  const table = $cell.node(-1), start = $cell.start(-1), map = TableMap.get(table)
  const rect = map.findCell($cell.pos - start)
  const other = dir === 'right' ? (rect.right < map.width ? map.map[rect.top * map.width + rect.right] : null) : (rect.bottom < map.height ? map.map[rect.bottom * map.width + rect.left] : null)
  if (other == null) { toast(dir === 'right' ? 'There is no cell to the right to join.' : 'There is no cell below to join.'); return }
  view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, $cell.pos, start + other)))
  if (!mergeCells(editor.state, view.dispatch)) toast('Those cells can’t be joined because they are different heights or widths. Select a rectangle of cells and use Merge cells.')
}

function tableRect(editor: Editor): DOMRect {
  const { from } = editor.state.selection
  const n = editor.view.domAtPos(from).node
  const el = (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest('table')
  return (el ?? editor.view.dom).getBoundingClientRect()
}

/** The table design list; it follows the table's own settings as they change. */
function TableStyleBody({ editor }: { editor: Editor }) {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick((n) => n + 1); editor.on('transaction', f); return () => { editor.off('transaction', f) } }, [editor])
  const a = editor.getAttributes('table') as { tableStyle?: string; banded?: boolean; frozen?: boolean }
  const set = (p: Record<string, unknown>) => editor.chain().focus().updateAttributes('table', p).run()
  return (
    <div className="tbl-styles">
      <b>Design</b>
      {TABLE_STYLES.map((s) => (
        <button key={s.id} type="button" className={`tbl-style ${(a.tableStyle ?? 'default') === s.id ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ tableStyle: s.id })}>
          <i className={`tbl-thumb tbl-${s.id}`} /><span><b>{s.label}</b><em>{s.hint}</em></span></button>))}
      <label className="tbl-switch"><input type="checkbox" checked={!!a.banded} onChange={(e) => set({ banded: e.target.checked })} />Alternating row shading</label>
      <label className="tbl-switch"><input type="checkbox" checked={!!a.frozen} onChange={(e) => set({ frozen: e.target.checked })} />Freeze the first row <em>(stays in view while a long table scrolls)</em></label>
    </div>
  )
}

export function TableMenu({ editor }: { editor: Editor }) {
  const c = () => editor.chain().focus()
  return (
    <BubbleMenu editor={editor} pluginKey="tableMenu"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table') && !e.isActive('image')}
      tippyOptions={{ placement: 'top', maxWidth: 'none', offset: [0, 10], getReferenceClientRect: () => tableRect(editor), duration: 120 }}>
      <div className="bubble">
        <Btn icon={<ArrowUpToLine size={16} />} label="Insert row above" tip="add an empty row above the current one" onClick={() => c().addRowBefore().run()} />
        <Btn icon={<ArrowDownToLine size={16} />} label="Insert row below" tip="add an empty row below the current one" onClick={() => c().addRowAfter().run()} />
        <Btn icon={<ArrowLeftToLine size={16} />} label="Insert column left" tip="add an empty column to the left" onClick={() => c().addColumnBefore().run()} />
        <Btn icon={<ArrowRightToLine size={16} />} label="Insert column right" tip="add an empty column to the right" onClick={() => c().addColumnAfter().run()} />
        <span className="bb-sep" />
        <Btn icon={<Rows3 size={16} />} label="Delete row" tip="remove the row the cursor is in" onClick={() => c().deleteRow().run()} />
        <Btn icon={<Columns3 size={16} />} label="Delete column" tip="remove the column the cursor is in" onClick={() => c().deleteColumn().run()} />
        <span className="bb-sep" />
        <Btn icon={<ArrowRightFromLine size={16} />} label="Join with the cell to the right" tip="merge this cell with its right neighbour: no dragging needed" onClick={() => mergeNeighbour(editor, 'right')} />
        <Btn icon={<ArrowDownFromLine size={16} />} label="Join with the cell below" tip="merge this cell with the one under it: no dragging needed" onClick={() => mergeNeighbour(editor, 'down')} />
        <Btn icon={<Combine size={16} />} label="Merge cells" tip="join the selected cells into one (drag to select several)" onClick={() => c().mergeCells().run()} />
        <Btn icon={<Split size={16} />} label="Split cell" tip="undo a merge and split it back into cells" onClick={() => c().splitCell().run()} />
        <Btn icon={<TableProperties size={16} />} label="Toggle header row" tip="turn the first row into a bold header, or back" onClick={() => c().toggleHeaderRow().run()} />
        <Popover className="bb-pop tbl-pop" trigger={({ toggle }) => <Btn icon={<LayoutGrid size={16} />} label="Table style" tip="pick a design, alternating row shading, a frozen header row" onClick={toggle} />}>
          {() => <TableStyleBody editor={editor} />}
        </Popover>
        <Popover trigger={({ toggle }) => <Btn icon={<Palette size={16} />} label="Cell color" tip="fill the cell background" onClick={toggle} />}>
          {(close) => <ColorPicker noneLabel="No fill" onPick={(col) => { close(); c().setCellAttribute('backgroundColor', col).run() }} />}
        </Popover>
        <span className="bb-sep" />
        <Btn icon={<Trash2 size={16} />} label="Delete table" tip="remove the whole table" danger onClick={() => c().deleteTable().run()} />
      </div>
    </BubbleMenu>
  )
}

export function ImageMenu({ editor }: { editor: Editor }) {
  const setWidth = (frac: number | null) => {
    const { from } = editor.state.selection
    const dom = editor.view.nodeDOM(from) as HTMLElement | null
    const box = dom?.closest('td,th,.ProseMirror') as HTMLElement | null
    const cs = box ? getComputedStyle(box) : null
    const avail = box ? box.clientWidth - (cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0) : 624
    editor.chain().focus().updateAttributes('image', { width: frac ? Math.round(avail * frac) : null }).run()
  }
  const c = () => editor.chain().focus()
  return (
    <BubbleMenu editor={editor} pluginKey="imageMenu"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('image')}
      tippyOptions={{ placement: 'top', offset: [0, 12], maxWidth: 'none', duration: 120 }}>
      <div className="bubble">
        <ImageIcon size={16} className="bb-ico" />
        {([['S', 0.25, 'Small', 'a quarter of the width'], ['M', 0.5, 'Medium', 'half of the width'], ['L', 0.75, 'Large', 'three quarters of the width'], ['Full', 1, 'Full width', 'stretch the picture across the whole line']] as const).map(([l, f, name, tip]) => (
          <button key={l} type="button" className="bb-text" data-tip={`${name}|${tip}`} aria-label={name} onMouseDown={(e) => e.preventDefault()} onClick={() => setWidth(f)}>{l}</button>
        ))}
        <button type="button" className="bb-text" data-tip="Original size|show the picture at its own size" aria-label="Original size" onMouseDown={(e) => e.preventDefault()} onClick={() => setWidth(null)}>Original</button>
        <span className="bb-sep" />
        <Btn icon={<AlignLeft size={16} />} label="Align left" tip="put the picture against the left edge" onClick={() => c().setTextAlign('left').run()} />
        <Btn icon={<AlignCenter size={16} />} label="Align center" tip="center the picture on the line" onClick={() => c().setTextAlign('center').run()} />
        <Btn icon={<AlignRight size={16} />} label="Align right" tip="put the picture against the right edge" onClick={() => c().setTextAlign('right').run()} />
        <span className="bb-sep" />
        <Btn icon={<Trash2 size={16} />} label="Remove image" tip="delete this picture from the page" danger onClick={() => c().deleteSelection().run()} />
      </div>
    </BubbleMenu>
  )
}

/** Clicking a colour must not pull focus out of the editor, or the shape is deselected and its menu disappears. Text fields keep working. */
const keepSelection = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }

export function ShapeMenu({ editor }: { editor: Editor }) {
  const a = () => cleanShape(editor.getAttributes('docShape'))
  const set = (p: Record<string, unknown>) => editor.chain().focus().updateShape(p).run()
  const c = () => editor.chain().focus()
  const sw = a().sw
  return (
    <BubbleMenu editor={editor} pluginKey="shapeMenu"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('docShape')}
      tippyOptions={{ placement: 'top', offset: [0, 12], maxWidth: 'none', duration: 120 }}>
      <div className="bubble">
        <Shapes size={16} className="bb-ico" />
        <Select label="Shape" value={a().shape} options={SHAPE_KINDS.map((k) => ({ value: k.id, label: k.name }))} onChange={(k: ShapeKind) => set(k === 'line' ? { shape: k, fill: 'none', h: Math.min(a().h, 32), sw: Math.max(2, a().sw) } : { shape: k, ...(a().fill === 'none' ? { fill: '#e0e7ff' } : {}) })} />
        <span className="bb-sep" />
        <Popover trigger={({ toggle }) => <button type="button" className="bb-text bb-swatch" data-tip="Fill|the colour inside the shape" onMouseDown={(e) => e.preventDefault()} onClick={toggle} aria-label="Fill colour"><i style={{ background: a().fill === 'none' ? 'transparent' : a().fill, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.4)' }} />Fill</button>}>
          {(close) => <div onMouseDown={keepSelection}><ColorPicker noneLabel="No fill" value={a().fill === 'none' ? null : a().fill} onPick={(col) => { close(); set({ fill: col ?? 'none' }) }} /></div>}
        </Popover>
        <Popover trigger={({ toggle }) => <button type="button" className="bb-text bb-swatch" data-tip="Outline|the colour of the edge" onMouseDown={(e) => e.preventDefault()} onClick={toggle} aria-label="Outline colour"><i style={{ background: 'transparent', boxShadow: `inset 0 0 0 2px ${a().stroke === 'none' ? 'rgba(255,255,255,.4)' : a().stroke}` }} />Outline</button>}>
          {(close) => <div onMouseDown={keepSelection}><ColorPicker noneLabel="No outline" value={a().stroke === 'none' ? null : a().stroke} onPick={(col) => { close(); set(col ? { stroke: col, sw: sw || 2 } : { sw: 0 }) }} /></div>}
        </Popover>
        <Btn icon={<Minus size={16} />} label="Thinner outline" tip="make the edge a little thinner" onClick={() => set({ sw: Math.max(0, sw - 1) })} />
        <span className="bb-num" aria-label="Outline thickness">{sw}</span>
        <Btn icon={<Plus size={16} />} label="Thicker outline" tip="make the edge a little thicker" onClick={() => set({ sw: Math.min(16, sw + 1), ...(a().stroke === 'none' ? { stroke: '#6366f1' } : {}) })} />
        <span className="bb-sep" />
        <Btn icon={<Type size={16} />} label="Edit text" tip="type a label inside the shape (or double-click it)" onClick={() => { void askText({ title: 'Text in the shape', value: a().text, label: 'Save', placeholder: 'Leave empty for no text' }).then((v) => { if (v !== null) set({ text: v.slice(0, 300) }) }) }} />
        <Btn icon={<AlignLeft size={16} />} label="Align left" tip="put the shape at the left" onClick={() => c().setTextAlign('left').run()} />
        <Btn icon={<AlignCenter size={16} />} label="Align center" tip="center the shape" onClick={() => c().setTextAlign('center').run()} />
        <Btn icon={<AlignRight size={16} />} label="Align right" tip="put the shape at the right" onClick={() => c().setTextAlign('right').run()} />
        <span className="bb-sep" />
        <Btn icon={<Trash2 size={16} />} label="Remove shape" tip="delete this shape" danger onClick={() => c().deleteSelection().run()} />
      </div>
    </BubbleMenu>
  )
}

/** The little bar over selected text (like Medium's): bold, italic, underline, strikethrough, code, link, colour and highlight, and the comment button in documents. */
export function FormatMenu({ editor, onComment }: { editor: Editor; onComment?: () => void }) {
  const c = () => editor.chain().focus()
  const on = (n: string, a?: object) => editor.isActive(n, a)
  const link = async () => {
    const cur = editor.getAttributes('link').href as string | undefined
    const v = await askText({ title: 'Link', label: 'Web address', placeholder: 'https://…', value: cur ?? '' })
    if (v === null || v === undefined) return
    const url = v.trim()
    if (!url) { c().extendMarkRange('link').unsetLink().run(); return }
    c().extendMarkRange('link').setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run()
  }
  const color = editor.getAttributes('textStyle').color as string | undefined, hl = editor.getAttributes('highlight').color as string | undefined
  return (
    <BubbleMenu editor={editor} pluginKey="formatMenu"
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !('node' in state.selection) && !e.isActive('image') && !e.isActive('table') && !e.isActive('codeBlock') && !e.isActive('docShape')}
      tippyOptions={{ placement: 'top', offset: [0, 8], maxWidth: 'none', duration: 120 }}>
      <div className="bubble" onMouseDown={keepSelection}>
        <Btn icon={<BoldIcon size={16} />} label="Bold" tip="Ctrl+B" onClick={() => c().toggleBold().run()} active={on('bold')} />
        <Btn icon={<ItalicIcon size={16} />} label="Italic" tip="Ctrl+I" onClick={() => c().toggleItalic().run()} active={on('italic')} />
        <Btn icon={<UnderlineIcon size={16} />} label="Underline" tip="Ctrl+U" onClick={() => c().toggleUnderline().run()} active={on('underline')} />
        <Btn icon={<StrikeIcon size={16} />} label="Strikethrough" onClick={() => c().toggleStrike().run()} active={on('strike')} />
        <Btn icon={<CodeIcon size={16} />} label="Code" onClick={() => c().toggleCode().run()} active={on('code')} />
        <span className="bb-sep" />
        <Btn icon={<LinkIcon size={16} />} label={on('link') ? 'Edit link' : 'Link'} onClick={() => void link()} active={on('link')} />
        <Popover className="bb-pop" trigger={({ toggle }) => <Btn icon={<span className="bb-color" style={{ borderBottomColor: color ?? 'currentColor' }}>A</span>} label="Text colour" onClick={toggle} />}>
          {(close) => <ColorPicker value={color} noneLabel="Default" onPick={(v) => { if (v) c().setColor(v).run(); else c().unsetColor().run(); close() }} />}
        </Popover>
        <Popover className="bb-pop" trigger={({ toggle }) => <Btn icon={<HighlighterIcon size={16} />} label="Highlight" onClick={toggle} active={on('highlight')} />}>
          {(close) => <ColorPicker value={hl} noneLabel="None" onPick={(v) => { if (v) c().setHighlight({ color: v }).run(); else c().unsetHighlight().run(); close() }} />}
        </Popover>
        {onComment && <><span className="bb-sep" /><button type="button" className="bb-text bb-with-icon" onMouseDown={(e) => e.preventDefault()} onClick={onComment}><MessageSquarePlus size={15} />Comment</button></>}
      </div>
    </BubbleMenu>
  )
}

export function CommentMenu({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  return (
    <BubbleMenu editor={editor} pluginKey="commentMenu"
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive('image') && !e.isActive('table')}
      tippyOptions={{ placement: 'bottom', offset: [0, 8], maxWidth: 'none', duration: 120 }}>
      <div className="bubble">
        <button type="button" className="bb-text bb-with-icon" onMouseDown={(e) => e.preventDefault()} onClick={onComment}><MessageSquarePlus size={15} />Comment</button>
      </div>
    </BubbleMenu>
  )
}

export function CalloutMenu({ editor }: { editor: Editor }) {
  const attrs = () => editor.getAttributes('callout') as { kind: string; title: string; bg?: string | null; accent?: string | null }
  return (
    <BubbleMenu editor={editor} pluginKey="calloutMenu"
      shouldShow={({ editor: e, state }) => e.isEditable && e.isActive('callout') && state.selection.empty}
      tippyOptions={{ placement: 'top-start', offset: [0, 8], maxWidth: 'none', duration: 120, getReferenceClientRect: () => {
        const n = editor.view.domAtPos(editor.state.selection.from).node
        return ((n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest('.callout') ?? editor.view.dom).getBoundingClientRect()
      } }}>
      <div className="bubble">
        <Select label="Callout type" value={calloutKind(attrs().kind ?? 'note')} options={CALLOUT_KINDS.map((k) => ({ value: k, label: defaultTitle(k), color: CALLOUT_COLORS[k] }))}
          onChange={(k) => editor.chain().updateAttributes('callout', k === 'custom' ? { kind: k, bg: attrs().bg ?? CUSTOM_DEFAULT_BG } : { kind: k }).run()} />
        <input className="bb-input" placeholder={defaultTitle(attrs().kind ?? 'note')} defaultValue={attrs().title ?? ''} key={`${editor.state.selection.from}-${attrs().kind}`}
          onChange={(e) => editor.chain().updateAttributes('callout', { title: e.target.value }).run()} aria-label="Callout title" />
        {attrs().kind === 'custom' && (
          <>
            <Popover trigger={({ toggle }) => <button type="button" className="bb-text bb-swatch" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Background color" aria-label="Callout background color"><i style={{ background: attrs().bg ?? CUSTOM_DEFAULT_BG }} />Background</button>}>
              {(close) => <ColorPicker noneLabel="Default yellow" value={attrs().bg} onPick={(c) => { close(); editor.chain().updateAttributes('callout', { bg: c ?? CUSTOM_DEFAULT_BG }).run() }} />}
            </Popover>
            <Popover trigger={({ toggle }) => <button type="button" className="bb-text bb-swatch" onMouseDown={(e) => e.preventDefault()} onClick={toggle} title="Accent color for the title and left edge" aria-label="Callout accent color"><i style={{ background: attrs().accent ?? '#374151' }} />Accent</button>}>
              {(close) => <ColorPicker noneLabel="Automatic" value={attrs().accent} onPick={(c) => { close(); editor.chain().updateAttributes('callout', { accent: c }).run() }} />}
            </Popover>
          </>
        )}
        <Btn icon={<Trash2 size={16} />} label="Remove callout" tip="keep the text, remove the box" onClick={() => editor.chain().focus().lift('callout').run()} />
      </div>
    </BubbleMenu>
  )
}
