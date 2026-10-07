import { useRef, useState } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowUpAZ, Baseline, Bold, ChartColumn, ChevronDown, Download, DollarSign, Grid2x2, Italic, Merge, Minus,
  PaintBucket, Percent, Plus, Redo2, RemoveFormatting, Sigma, Snowflake, Strikethrough, Underline, Undo2, Upload, WrapText, ArrowUpToLine, ArrowDownToLine, FoldVertical, Rows3, Columns3,
} from 'lucide-react'
import { Popover } from '../ui/Popover'
import { ColorPicker } from '../editor/ColorPicker'
import { FontPicker } from '../editor/FontPicker'
import { TBtn } from '../editor/Toolbar'
import { colName } from './engine/refs'
import { PRESETS } from './engine/format'
import { CellError } from './engine/values'
import type { Rect, SheetModel, Style } from './model'
import { loadFont } from '../fonts'
import { askText } from '../ui/Dialogs'

const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

/** Add / remove one decimal place in a number format code. */
export function changeDecimals(code: string | undefined, delta: number): string {
  const c = !code || code === 'General' ? '0' : code
  const m = /([#0?][#0?,]*)(?:\.([0#?]+))?/.exec(c)
  if (!m) return c
  const dec = (m[2] ?? '').length + delta
  if (dec < 0) return c
  const repl = m[1] + (dec > 0 ? '.' + '0'.repeat(dec) : '')
  return c.slice(0, m.index) + repl + c.slice(m.index + m[0].length)
}

export function SheetToolbar({ model, sheet, rect, active, readOnly, version, setSel, onChart, onImport, onExport, focusGrid }: {
  model: SheetModel; sheet: string; rect: Rect; active: { r: number; c: number }; readOnly: boolean; version: number
  setSel: (a: number, b: number, c: number, d: number) => void; onChart: () => void; onImport: (f: File) => void; onExport: () => void; focusGrid: () => void
}) {
  void version
  const cur = model.style(sheet, active.r, active.c)
  const file = useRef<HTMLInputElement>(null)
  const [header, setHeader] = useState(true)
  const set = (patch: Partial<Style>) => { model.setStyle(sheet, rect, patch); focusGrid() }
  const toggle = (k: 'b' | 'i' | 'u' | 'st') => set({ [k]: cur[k] ? undefined : 1 } as Partial<Style>)
  const family = cur.ff ?? 'Inter', size = cur.fs ?? 13
  const merged = model.mergeAt(sheet, rect.r1, rect.c1)
  const isMerged = !!merged && merged.r1 === rect.r1 && merged.c1 === rect.c1 && merged.r2 === rect.r2 && merged.c2 === rect.c2
  const fz = model.freeze(sheet)
  const nfLabel = Object.values(PRESETS).find((p) => p.code === (cur.nf ?? 'General'))?.label ?? 'Custom'
  const multiRow = rect.r2 > rect.r1, multiCol = rect.c2 > rect.c1

  const insertFn = (fn: string) => {
    const R = rect
    const single = R.r1 === R.r2 && R.c1 === R.c2
    const num = (r: number, c: number) => { const v = model.value(sheet, r, c); return typeof v === 'number' }
    if (single) {
      let r = R.r1 - 1; while (r >= 0 && num(r, R.c1)) r--
      if (R.r1 - 1 > r) { model.setText(sheet, R.r1, R.c1, `=${fn}(${colName(R.c1)}${r + 2}:${colName(R.c1)}${R.r1})`, false); return }
      let c = R.c1 - 1; while (c >= 0 && num(R.r1, c)) c--
      if (R.c1 - 1 > c) { model.setText(sheet, R.r1, R.c1, `=${fn}(${colName(c + 1)}${R.r1 + 1}:${colName(R.c1 - 1)}${R.r1 + 1})`, false); return }
      model.setText(sheet, R.r1, R.c1, `=${fn}()`, false)
    } else {
      model.setTexts(sheet, Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => ({ r: R.r2 + 1, c: R.c1 + i, text: `=${fn}(${colName(R.c1 + i)}${R.r1 + 1}:${colName(R.c1 + i)}${R.r2 + 1})` })))
    }
    focusGrid()
  }

  const doSort = (asc: boolean) => {
    const u = model.used(sheet)
    const single = rect.r1 === rect.r2 && rect.c1 === rect.c2
    const R: Rect = single || (rect.c1 === rect.c2) ? { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) } : rect
    model.sort(sheet, R, active.c, asc, header)
    focusGrid()
  }

  return (
    <div className={`toolbar sheet-toolbar ${readOnly ? 'readonly' : ''}`}>
      <div className="tb-group">
        <TBtn icon={<Undo2 size={17} />} label="Undo (Ctrl+Z)" onClick={() => { model.undo(); focusGrid() }} disabled={readOnly} />
        <TBtn icon={<Redo2 size={17} />} label="Redo (Ctrl+Y)" onClick={() => { model.redo(); focusGrid() }} disabled={readOnly} />
      </div>
      <fieldset disabled={readOnly} className="tb-fieldset">
        <div className="tb-group">
          <Popover className="pop-menu nf-menu" trigger={({ toggle: t }) => (
            <button className="tb-select" style={{ width: 118 }} onMouseDown={(e) => e.preventDefault()} onClick={t}><span className="trunc">{nfLabel}</span><ChevronDown size={15} /></button>)}>
            {(close) => (
              <>
                {Object.entries(PRESETS).map(([id, p]) => (
                  <button key={id} className={`menu-row nf-row ${(cur.nf ?? 'General') === p.code ? 'on' : ''}`} onClick={() => { close(); set({ nf: p.code === 'General' ? undefined : p.code }) }}>
                    <span>{p.label}</span><em>{p.sample}</em>
                  </button>))}
                <button className="menu-row" onClick={async () => { close(); const c = await askText({ title: 'Custom number format', value: cur.nf ?? '', placeholder: 'e.g. #,##0.00 or yyyy-mm-dd', label: 'Apply' }); if (c !== null) set({ nf: c }) }}>Custom format…</button>
              </>)}
          </Popover>
          <TBtn icon={<DollarSign size={17} />} label="Format as currency" active={cur.nf === '$#,##0.00'} onClick={() => set({ nf: '$#,##0.00' })} />
          <TBtn icon={<Percent size={17} />} label="Format as percent" active={cur.nf === '0.00%' || cur.nf === '0%'} onClick={() => set({ nf: '0.00%' })} />
          <TBtn icon={<span className="tb-txt">.0<Minus size={9} /></span>} label="Decrease decimal places" onClick={() => set({ nf: changeDecimals(cur.nf, -1) })} />
          <TBtn icon={<span className="tb-txt">.00<Plus size={9} /></span>} label="Increase decimal places" onClick={() => set({ nf: changeDecimals(cur.nf, 1) })} />
        </div>

        <div className="tb-group">
          <Popover className="pop-font" trigger={({ toggle: t }) => (
            <button className="tb-select" style={{ width: 150 }} onMouseDown={(e) => e.preventDefault()} onClick={t}><span className="trunc">{family}</span><ChevronDown size={15} /></button>)}>
            {(close) => <FontPicker value={family} onPick={(f) => { close(); loadFont(f); set({ ff: f }) }} />}
          </Popover>
          <div className="size-box">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => set({ fs: Math.max(6, size - 1) })} aria-label="Smaller"><Minus size={14} /></button>
            <Popover className="pop-menu small" trigger={({ toggle: t }) => <button className="size-val" onMouseDown={(e) => e.preventDefault()} onClick={t}>{size}</button>}>
              {(close) => SIZES.map((s) => <button key={s} className={`menu-row ${s === size ? 'on' : ''}`} onClick={() => { close(); set({ fs: s }) }}>{s}</button>)}
            </Popover>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => set({ fs: Math.min(96, size + 1) })} aria-label="Larger"><Plus size={14} /></button>
          </div>
        </div>

        <div className="tb-group">
          <TBtn icon={<Bold size={17} />} label="Bold (Ctrl+B)" active={!!cur.b} onClick={() => toggle('b')} />
          <TBtn icon={<Italic size={17} />} label="Italic (Ctrl+I)" active={!!cur.i} onClick={() => toggle('i')} />
          <TBtn icon={<Underline size={17} />} label="Underline (Ctrl+U)" active={!!cur.u} onClick={() => toggle('u')} />
          <TBtn icon={<Strikethrough size={17} />} label="Strikethrough" active={!!cur.st} onClick={() => toggle('st')} />
          <Popover trigger={({ toggle: t }) => (
            <button className="tb-btn color" title="Text color" aria-label="Text color" onMouseDown={(e) => e.preventDefault()} onClick={t}><Baseline size={17} /><i style={{ background: cur.color ?? 'var(--ink)' }} /></button>)}>
            {(close) => <ColorPicker value={cur.color} noneLabel="Default color" onPick={(c) => { close(); set({ color: c ?? undefined }) }} />}
          </Popover>
          <Popover trigger={({ toggle: t }) => (
            <button className="tb-btn color" title="Fill color" aria-label="Fill color" onMouseDown={(e) => e.preventDefault()} onClick={t}><PaintBucket size={17} /><i style={{ background: cur.bg ?? '#fde047' }} /></button>)}>
            {(close) => <ColorPicker value={cur.bg} noneLabel="No fill" onPick={(c) => { close(); set({ bg: c ?? undefined }) }} />}
          </Popover>
          <Popover className="pop-menu" trigger={({ toggle: t }) => <TBtn icon={<Grid2x2 size={17} />} label="Borders" onClick={t} />}>
            {(close) => (['all', 'outer', 'inner', 'top', 'bottom', 'left', 'right', 'none'] as const).map((m) => (
              <button key={m} className="menu-row" onClick={() => { close(); model.setBorders(sheet, rect, m); focusGrid() }}>{{ all: 'All borders', outer: 'Outer border', inner: 'Inner borders', top: 'Top border', bottom: 'Bottom border', left: 'Left border', right: 'Right border', none: 'Clear borders' }[m]}</button>))}
          </Popover>
          <TBtn icon={<Merge size={17} />} label={isMerged ? 'Unmerge cells' : 'Merge cells'} active={isMerged} onClick={() => { isMerged ? model.unmerge(sheet, rect) : model.merge(sheet, rect); focusGrid() }} />
        </div>

        <div className="tb-group">
          <TBtn icon={<AlignLeft size={17} />} label="Align left" active={cur.ha === 'left'} onClick={() => set({ ha: cur.ha === 'left' ? undefined : 'left' })} />
          <TBtn icon={<AlignCenter size={17} />} label="Align center" active={cur.ha === 'center'} onClick={() => set({ ha: cur.ha === 'center' ? undefined : 'center' })} />
          <TBtn icon={<AlignRight size={17} />} label="Align right" active={cur.ha === 'right'} onClick={() => set({ ha: cur.ha === 'right' ? undefined : 'right' })} />
          <TBtn icon={<ArrowUpToLine size={17} />} label="Align top" active={cur.va === 'top'} onClick={() => set({ va: cur.va === 'top' ? undefined : 'top' })} />
          <TBtn icon={<FoldVertical size={17} />} label="Align middle" active={cur.va === 'middle'} onClick={() => set({ va: cur.va === 'middle' ? undefined : 'middle' })} />
          <TBtn icon={<ArrowDownToLine size={17} />} label="Align bottom" active={cur.va === 'bottom'} onClick={() => set({ va: cur.va === 'bottom' ? undefined : 'bottom' })} />
          <TBtn icon={<WrapText size={17} />} label="Wrap text" active={!!cur.wrap} onClick={() => set({ wrap: cur.wrap ? undefined : 1 })} />
          <TBtn icon={<RemoveFormatting size={17} />} label="Clear formatting" onClick={() => { model.clear(sheet, rect, 'formats'); focusGrid() }} />
        </div>

        <div className="tb-group">
          <Popover className="pop-menu" trigger={({ toggle: t }) => <TBtn icon={<Sigma size={17} />} label="Functions" onClick={t} />}>
            {(close) => ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => <button key={f} className="menu-row" onClick={() => { close(); insertFn(f) }}>{f}</button>)}
          </Popover>
          <Popover className="pop-menu" trigger={({ toggle: t }) => <TBtn icon={<ArrowDownAZ size={17} />} label="Sort" onClick={t} />}>
            {(close) => (
              <>
                <button className="menu-row" onClick={() => { close(); doSort(true) }}><ArrowDownAZ size={16} />Sort column {colName(active.c)} A → Z</button>
                <button className="menu-row" onClick={() => { close(); doSort(false) }}><ArrowUpAZ size={16} />Sort column {colName(active.c)} Z → A</button>
                <label className="menu-row chk"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />Data has a header row</label>
              </>)}
          </Popover>
          <Popover className="pop-menu" trigger={({ toggle: t }) => <TBtn icon={<Snowflake size={17} />} label="Freeze panes" active={fz.rows > 0 || fz.cols > 0} onClick={t} />}>
            {(close) => (
              <>
                <button className="menu-row" onClick={() => { close(); model.setFreeze(sheet, 0, 0) }}>No frozen rows or columns</button>
                <button className="menu-row" onClick={() => { close(); model.setFreeze(sheet, 1, fz.cols) }}>Freeze 1 row</button>
                <button className="menu-row" onClick={() => { close(); model.setFreeze(sheet, fz.rows, 1) }}>Freeze 1 column</button>
                <button className="menu-row" onClick={() => { close(); model.setFreeze(sheet, rect.r2 + 1, fz.cols) }}>Freeze rows up to {rect.r2 + 1}</button>
                <button className="menu-row" onClick={() => { close(); model.setFreeze(sheet, fz.rows, rect.c2 + 1) }}>Freeze columns up to {colName(rect.c2)}</button>
              </>)}
          </Popover>
          <Popover className="pop-menu" trigger={({ toggle: t }) => <TBtn icon={<Rows3 size={17} />} label="Rows and columns" onClick={t} />}>
            {(close) => (
              <>
                <button className="menu-row" onClick={() => { close(); model.insertRows(sheet, rect.r1, rect.r2 - rect.r1 + 1) }}>Insert {rect.r2 - rect.r1 + 1} row{multiRow ? 's' : ''} above</button>
                <button className="menu-row" onClick={() => { close(); model.insertRows(sheet, rect.r2 + 1, rect.r2 - rect.r1 + 1) }}>Insert {rect.r2 - rect.r1 + 1} row{multiRow ? 's' : ''} below</button>
                <button className="menu-row" onClick={() => { close(); model.insertCols(sheet, rect.c1, rect.c2 - rect.c1 + 1) }}>Insert {rect.c2 - rect.c1 + 1} column{multiCol ? 's' : ''} left</button>
                <button className="menu-row" onClick={() => { close(); model.insertCols(sheet, rect.c2 + 1, rect.c2 - rect.c1 + 1) }}>Insert {rect.c2 - rect.c1 + 1} column{multiCol ? 's' : ''} right</button>
                <button className="menu-row danger" onClick={() => { close(); model.deleteRows(sheet, rect.r1, rect.r2 - rect.r1 + 1); setSel(rect.r1, rect.c1, rect.r1, rect.c1) }}>Delete row{multiRow ? 's' : ''}</button>
                <button className="menu-row danger" onClick={() => { close(); model.deleteCols(sheet, rect.c1, rect.c2 - rect.c1 + 1); setSel(rect.r1, rect.c1, rect.r1, rect.c1) }}>Delete column{multiCol ? 's' : ''}</button>
              </>)}
          </Popover>
          <TBtn icon={<ChartColumn size={17} />} label="Insert chart" onClick={onChart} />
        </div>
      </fieldset>
      <div className="tb-group">
        <TBtn icon={<Upload size={17} />} label="Import CSV" onClick={() => file.current?.click()} disabled={readOnly} />
        <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
        <TBtn icon={<Download size={17} />} label="Download as CSV" onClick={onExport} />
      </div>
    </div>
  )
}

export const isErr = (v: unknown) => v instanceof CellError
export { Columns3 }
