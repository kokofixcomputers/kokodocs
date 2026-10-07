import { addr, colIndex, colName } from '../sheet/engine/refs'
import { PRESETS } from '../sheet/engine/format'
import { CellError } from '../sheet/engine/values'
import { HEADER_W, HEADER_H, rectNorm, type Rect, type SheetModel, type Style } from '../sheet/model'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'

export interface SheetDeps {
  model: SheetModel
  getSheet: () => string
  setSheet: (id: string) => void
  getSel: () => Rect
  getTitle: () => string
  canEdit: () => boolean
  reveal?: (x: number, y: number) => void
}

const MAX_ROWS = 200, MAX_COLS = 30

/** "A1", "A1:C9", "B:B" (whole column), "3:5" (rows). Returns zero-based rect, or null. */
export function parseRange(text: string, rows = 1000, cols = 26): Rect | null {
  const s = text.trim().replace(/\$/g, '')
  let m = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/.exec(s)
  if (m) {
    const a = { r: Number(m[2]) - 1, c: colIndex(m[1]) }, b = m[3] ? { r: Number(m[4]) - 1, c: colIndex(m[3]) } : a
    return rectNorm({ r1: a.r, c1: a.c, r2: b.r, c2: b.c })
  }
  m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(s)
  if (m) return rectNorm({ r1: 0, c1: colIndex(m[1]), r2: rows - 1, c2: colIndex(m[2]) })
  m = /^(\d+):(\d+)$/.exec(s)
  if (m) return rectNorm({ r1: Number(m[1]) - 1, c1: 0, r2: Number(m[2]) - 1, c2: cols - 1 })
  m = /^([A-Za-z]{1,3})$/.exec(s)
  if (m) return { r1: 0, c1: colIndex(m[1]), r2: rows - 1, c2: colIndex(m[1]) }
  return null
}
export const rangeLabel = (r: Rect) => (r.r1 === r.r2 && r.c1 === r.c2 ? addr(r.r1, r.c1) : `${addr(r.r1, r.c1)}:${addr(r.r2, r.c2)}`)

export function createSheetAdapter(d: SheetDeps): Adapter {
  const m = d.model
  const sheetId = (name?: string): string => {
    if (!name) return d.getSheet()
    const id = m.sheetId(name)
    if (!id) throw new Error(`There is no sheet called “${name}”. Sheets: ${m.tabList().map((t) => t.name).join(', ')}`)
    return id
  }
  const nameOf = (id: string) => m.tabList().find((t) => t.id === id)?.name ?? id
  const rect = (id: string, text: string): Rect => {
    const r = parseRange(text, m.rowCount(id), m.colCount(id))
    if (!r) throw new Error(`“${text}” isn't a valid range. Use A1 notation like B2 or A1:D20.`)
    return r
  }
  const show = (id: string, r: number, c: number) => { const x = m.display(id, r, c); return x.text }

  const table = (id: string, R: Rect) => {
    const head = ['', ...Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => colName(R.c1 + i))]
    const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
    for (let r = R.r1; r <= R.r2; r++) {
      const cells = Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => show(id, r, R.c1 + i).replace(/\|/g, '\\|').replace(/\n/g, ' '))
      lines.push(`| ${r + 1} | ${cells.join(' | ')} |`)
    }
    return lines.join('\n')
  }
  const formulasIn = (id: string, R: Rect, limit = 150) => {
    const out: string[] = []
    for (const [r, c, raw] of m.formulaCells(id)) {
      if (r < R.r1 || r > R.r2 || c < R.c1 || c > R.c2) continue
      out.push(`${addr(r, c)}: ${raw} → ${show(id, r, c)}`)
      if (out.length >= limit) { out.push('…more formulas not shown'); break }
    }
    return out
  }
  /** After writing, report what the formulas evaluate to so mistakes (#REF!, #NAME?) are caught. */
  const verify = (id: string, cells: { r: number; c: number }[]) => {
    const rows: string[] = []
    let errors = 0
    for (const { r, c } of cells) {
      const raw = m.raw(id, r, c)
      if (!raw || raw[0] !== '=') continue
      const v = m.value(id, r, c)
      if (v instanceof CellError) errors++
      if (rows.length < 25) rows.push(`${addr(r, c)} ${raw} → ${show(id, r, c)}`)
    }
    return rows.length ? `\nFormula results:\n${rows.join('\n')}${errors ? `\n⚠ ${errors} formula(s) returned an error. Fix them.` : ''}` : ''
  }
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))

  const readSheet: Tool = tool('read_sheet', 'Read a sheet: its values as displayed, its formulas, and its charts. Defaults to the active sheet and its used range (large sheets are capped; ask for a specific range to see more).',
    { sheet: { type: 'string', description: 'Sheet name (default: the active sheet)' }, range: { type: 'string', description: 'A1 range such as A1:F40 (default: everything used)' } }, [], {
      label: (a) => `Read ${a?.range ? a.range : 'the sheet'}${a?.sheet ? ` on ${a.sheet}` : ''}`,
      run: (a) => {
        const id = sheetId(a.sheet)
        const u = m.used(id)
        const used: Rect = { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) }
        const wanted = a.range ? rect(id, a.range) : used
        const R = { ...wanted, r2: Math.min(wanted.r2, wanted.r1 + MAX_ROWS - 1, used.r2), c2: Math.min(wanted.c2, wanted.c1 + MAX_COLS - 1, used.c2) }
        const lines = [`Spreadsheet “${d.getTitle()}”. Sheets: ${m.tabList().map((t) => t.name + (t.id === d.getSheet() ? ' (active)' : '')).join(', ')}.`]
        if (!u.vrows && !u.rows) return lines.concat(`Sheet “${nameOf(id)}” is empty.`).join('\n')
        lines.push(`Sheet “${nameOf(id)}”: used range A1:${addr(used.r2, used.c2)} (${u.rows} rows × ${u.cols} columns). Showing ${rangeLabel(R)}${R.r2 < wanted.r2 || R.c2 < wanted.c2 ? ' (capped; request a narrower range for more)' : ''}.`, '', table(id, R))
        const f = formulasIn(id, R)
        if (f.length) lines.push('', 'Formulas:', ...f)
        const ch = m.charts(id)
        if (ch.length) lines.push('', 'Charts:', ...ch.map((c) => `- id ${c.id}: ${c.type} chart “${c.title || 'untitled'}” from ${c.range}`))
        const fz = m.freeze(id); if (fz.rows || fz.cols) lines.push('', `Frozen: ${fz.rows} row(s), ${fz.cols} column(s).`)
        const mg = m.merges(id); if (mg.length) lines.push('', `Merged: ${mg.map(rangeLabel).join(', ')}`)
        return clip(lines.join('\n'), MAX_RESULT_CHARS)
      },
    })

  const getSelection: Tool = tool('get_selection', 'What the user currently has selected in the spreadsheet (range and values).', {}, [], {
    label: () => 'Looked at your selection',
    run: () => {
      const R = d.getSel(), id = d.getSheet()
      const small = { ...R, r2: Math.min(R.r2, R.r1 + 60), c2: Math.min(R.c2, R.c1 + 15) }
      return `Selected ${rangeLabel(R)} on “${nameOf(id)}”.\n\n${table(id, small)}`
    },
  })

  const setCells: Tool = tool('set_cells', 'Write values or formulas into specific cells. Values starting with "=" are formulas (Excel syntax). Numbers can be given as text or numbers; null clears a cell.',
    { sheet: { type: 'string' }, cells: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string', description: 'Cell like B7' }, value: { description: 'text, number, boolean, formula string, or null' } }, required: ['ref', 'value'] } } }, ['cells'], {
      edit: true,
      describe: (a) => {
        const list = (a.cells ?? []) as { ref: string; value: unknown }[]
        return { title: `Set ${list.length} cell${list.length === 1 ? '' : 's'}${a.sheet ? ` on ${a.sheet}` : ''}`, detail: list.slice(0, 6).map((c) => `${c.ref} = ${clip(text(c.value), 40)}`).join('\n') + (list.length > 6 ? `\n…and ${list.length - 6} more` : '') }
      },
      run: (a) => {
        const id = sheetId(a.sheet)
        const list = (a.cells ?? []) as { ref: string; value: unknown }[]
        if (!Array.isArray(list) || !list.length) throw new Error('No cells given')
        if (list.length > 2000) throw new Error('Too many cells in one call (max 2000). Split it up or use set_range.')
        const entries = list.map((c) => { const r = rect(id, c.ref); return { r: r.r1, c: r.c1, text: text(c.value) } })
        m.setTexts(id, entries)
        return `Set ${entries.length} cell(s) on “${nameOf(id)}”.${verify(id, entries)}`
      },
    })

  const setRange: Tool = tool('set_range', 'Write a block of values/formulas starting at a cell. `values` is a list of rows. Best for tables, headers plus data, or filling formulas.',
    { sheet: { type: 'string' }, start: { type: 'string', description: 'Top-left cell, e.g. A1' }, values: { type: 'array', items: { type: 'array', items: {} }, description: 'Rows of cell values' } }, ['start', 'values'], {
      edit: true,
      describe: (a) => {
        const v = (a.values ?? []) as unknown[][]
        return { title: `Fill ${v.length} row${v.length === 1 ? '' : 's'} × ${Math.max(0, ...v.map((r) => r.length))} column${Math.max(0, ...v.map((r) => r.length)) === 1 ? '' : 's'} from ${a.start}${a.sheet ? ` on ${a.sheet}` : ''}`, detail: v.slice(0, 4).map((r) => r.map((x) => clip(text(x), 18)).join(' | ')).join('\n') + (v.length > 4 ? `\n…${v.length - 4} more rows` : '') }
      },
      run: (a) => {
        const id = sheetId(a.sheet), at = rect(id, a.start)
        const v = a.values as unknown[][]
        if (!Array.isArray(v) || !v.every(Array.isArray)) throw new Error('values must be a list of rows, like [["Name","Qty"],["Pens",3]]')
        if (v.reduce((n, r) => n + r.length, 0) > 5000) throw new Error('Too many cells in one call (max 5000)')
        const entries: { r: number; c: number; text: string }[] = []
        v.forEach((row, i) => row.forEach((x, j) => entries.push({ r: at.r1 + i, c: at.c1 + j, text: text(x) })))
        m.setTexts(id, entries)
        return `Wrote ${entries.length} cell(s) at ${rangeLabel({ r1: at.r1, c1: at.c1, r2: at.r1 + v.length - 1, c2: at.c1 + Math.max(0, ...v.map((r) => r.length)) - 1 })} on “${nameOf(id)}”.${verify(id, entries)}`
      },
    })

  const formatCells: Tool = tool('format_cells', 'Apply formatting to a range: bold/italic, colors, alignment, number format, borders, wrap, font size.',
    {
      sheet: { type: 'string' }, range: { type: 'string', description: 'e.g. A1:D1' }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, underline: { type: 'boolean' }, strikethrough: { type: 'boolean' },
      text_color: { type: 'string', description: 'CSS hex like #ff0000' }, fill_color: { type: 'string', description: 'CSS hex like #fde047, or "none"' }, font_size: { type: 'number' },
      align: { type: 'string', enum: ['left', 'center', 'right'] }, vertical_align: { type: 'string', enum: ['top', 'middle', 'bottom'] }, wrap: { type: 'boolean' },
      number_format: { type: 'string', description: `One of ${Object.keys(PRESETS).join(', ')} or an Excel format code such as "#,##0.00" or "0.0%"` },
      borders: { type: 'string', enum: ['all', 'outer', 'inner', 'top', 'bottom', 'left', 'right', 'none'] },
    }, ['range'], {
      edit: true,
      describe: (a) => {
        const bits = [a.bold && 'bold', a.italic && 'italic', a.underline && 'underline', a.text_color && `text ${a.text_color}`, a.fill_color && `fill ${a.fill_color}`, a.align && `align ${a.align}`, a.number_format && `format ${a.number_format}`, a.borders && `borders ${a.borders}`, a.wrap && 'wrap', a.font_size && `size ${a.font_size}`].filter(Boolean)
        return { title: `Format ${a.range}${a.sheet ? ` on ${a.sheet}` : ''}`, detail: bits.join(', ') }
      },
      run: (a) => {
        const id = sheetId(a.sheet), R = rect(id, a.range)
        const patch: Partial<Style> = {}
        const set = <K extends keyof Style>(k: K, v: Style[K] | undefined) => { (patch as Record<string, unknown>)[k] = v }
        if ('bold' in a) set('b', a.bold ? 1 : undefined); if ('italic' in a) set('i', a.italic ? 1 : undefined)
        if ('underline' in a) set('u', a.underline ? 1 : undefined); if ('strikethrough' in a) set('st', a.strikethrough ? 1 : undefined)
        if (a.text_color) set('color', a.text_color); if (a.fill_color) set('bg', a.fill_color === 'none' ? undefined : a.fill_color)
        if (a.font_size) set('fs', Number(a.font_size)); if (a.align) set('ha', a.align); if (a.vertical_align) set('va', a.vertical_align); if ('wrap' in a) set('wrap', a.wrap ? 1 : undefined)
        if (a.number_format) { const p = PRESETS[String(a.number_format).toLowerCase()]; set('nf', p ? (p.code === 'General' ? undefined : p.code) : String(a.number_format)) }
        if (Object.keys(patch).length) m.setStyle(id, R, patch)
        if (a.borders) m.setBorders(id, R, a.borders)
        return `Formatted ${rangeLabel(R)} on “${nameOf(id)}”.`
      },
    })

  const createChart: Tool = tool('create_chart', 'Create a chart from a data range. The first column becomes the categories and each other column a series; set has_header_row if the first row holds series names.',
    { sheet: { type: 'string' }, type: { type: 'string', enum: ['column', 'bar', 'line', 'area', 'pie', 'scatter'] }, range: { type: 'string', description: 'Data range including labels, e.g. A1:D6' },
      title: { type: 'string' }, has_header_row: { type: 'boolean', description: 'Default true' }, stacked: { type: 'boolean' } }, ['type', 'range'], {
      edit: true,
      describe: (a) => ({ title: `Create a ${a.type} chart${a.title ? ` “${a.title}”` : ''}`, detail: `Data: ${a.range}${a.sheet ? ` on ${a.sheet}` : ''}` }),
      run: (a) => {
        const id = sheetId(a.sheet), R = rect(id, a.range)
        const u = m.used(id)
        let x = HEADER_W + 24
        for (let c = 0; c < Math.max(u.cols, R.c2 + 1); c++) x += m.colWidth(id, c)
        const n = m.charts(id).length
        const y = HEADER_H + 16 + n * 36
        const cid = m.addChart(id, { type: a.type, range: rangeLabel(R), title: a.title ?? '', x, y, w: 480, h: 300, headers: a.has_header_row !== false, stacked: !!a.stacked })
        if (id !== d.getSheet()) d.setSheet(id)
        d.reveal?.(x, y)
        return `Created chart ${cid} on “${nameOf(id)}” (${a.type}, ${rangeLabel(R)}). It sits to the right of the data.`
      },
    })

  const updateChart: Tool = tool('update_chart', 'Change an existing chart (use the id from read_sheet).', { sheet: { type: 'string' }, id: { type: 'string' }, type: { type: 'string', enum: ['column', 'bar', 'line', 'area', 'pie', 'scatter'] }, range: { type: 'string' }, title: { type: 'string' }, has_header_row: { type: 'boolean' }, stacked: { type: 'boolean' } }, ['id'], {
    edit: true,
    describe: (a) => ({ title: `Update chart ${a.id}`, detail: [a.type && `type ${a.type}`, a.range && `data ${a.range}`, a.title && `title “${a.title}”`].filter(Boolean).join(', ') }),
    run: (a) => {
      const id = sheetId(a.sheet)
      if (!m.charts(id).some((c) => c.id === a.id)) throw new Error(`No chart with id ${a.id} on “${nameOf(id)}”`)
      m.updateChart(id, a.id, { ...(a.type && { type: a.type }), ...(a.range && { range: rangeLabel(rect(id, a.range)) }), ...(a.title !== undefined && { title: a.title }), ...(a.has_header_row !== undefined && { headers: a.has_header_row }), ...(a.stacked !== undefined && { stacked: a.stacked }) })
      return `Updated chart ${a.id}.`
    },
  })
  const deleteChart: Tool = tool('delete_chart', 'Delete a chart by id.', { sheet: { type: 'string' }, id: { type: 'string' } }, ['id'], {
    edit: true, describe: (a) => ({ title: `Delete chart ${a.id}` }),
    run: (a) => { const id = sheetId(a.sheet); if (!m.charts(id).some((c) => c.id === a.id)) throw new Error(`No chart with id ${a.id}`); m.removeChart(id, a.id); return `Deleted chart ${a.id}.` },
  })

  const sortRange: Tool = tool('sort_range', 'Sort rows of a range by one column.', { sheet: { type: 'string' }, range: { type: 'string' }, by_column: { type: 'string', description: 'Column letter, e.g. C' }, ascending: { type: 'boolean' }, has_header_row: { type: 'boolean' } }, ['range', 'by_column'], {
    edit: true,
    describe: (a) => ({ title: `Sort ${a.range} by column ${a.by_column} ${a.ascending === false ? 'Z→A' : 'A→Z'}` }),
    run: (a) => { const id = sheetId(a.sheet), R = rect(id, a.range); m.sort(id, R, colIndex(String(a.by_column).toUpperCase()), a.ascending !== false, !!a.has_header_row); return `Sorted ${rangeLabel(R)} by column ${String(a.by_column).toUpperCase()}.` },
  })

  const structure = (name: string, desc: string, props: Record<string, unknown>, req: string[], title: (a: any) => string, run: (id: string, a: any) => string): Tool =>
    tool(name, desc, { sheet: { type: 'string' }, ...props }, req, { edit: true, describe: (a) => ({ title: title(a) }), run: (a) => { const id = sheetId(a.sheet); return run(id, a) } })
  const insertRows = structure('insert_rows', 'Insert blank rows before a row number.', { before_row: { type: 'number' }, count: { type: 'number' } }, ['before_row'], (a) => `Insert ${a.count ?? 1} row(s) before row ${a.before_row}`, (id, a) => { m.insertRows(id, Number(a.before_row) - 1, Number(a.count ?? 1)); return `Inserted ${a.count ?? 1} row(s).` })
  const deleteRows = structure('delete_rows', 'Delete rows.', { from_row: { type: 'number' }, count: { type: 'number' } }, ['from_row'], (a) => `Delete ${a.count ?? 1} row(s) from row ${a.from_row}`, (id, a) => { m.deleteRows(id, Number(a.from_row) - 1, Number(a.count ?? 1)); return `Deleted ${a.count ?? 1} row(s).` })
  const insertCols = structure('insert_columns', 'Insert blank columns before a column.', { before_column: { type: 'string' }, count: { type: 'number' } }, ['before_column'], (a) => `Insert ${a.count ?? 1} column(s) before ${a.before_column}`, (id, a) => { m.insertCols(id, colIndex(String(a.before_column).toUpperCase()), Number(a.count ?? 1)); return `Inserted ${a.count ?? 1} column(s).` })
  const deleteCols = structure('delete_columns', 'Delete columns.', { from_column: { type: 'string' }, count: { type: 'number' } }, ['from_column'], (a) => `Delete ${a.count ?? 1} column(s) from ${a.from_column}`, (id, a) => { m.deleteCols(id, colIndex(String(a.from_column).toUpperCase()), Number(a.count ?? 1)); return `Deleted ${a.count ?? 1} column(s).` })
  const clearRange = structure('clear_range', 'Clear contents and/or formatting of a range.', { range: { type: 'string' }, what: { type: 'string', enum: ['contents', 'formatting', 'all'] } }, ['range'], (a) => `Clear ${a.what ?? 'contents'} of ${a.range}`, (id, a) => { const R = rect(id, a.range); m.clear(id, R, a.what === 'formatting' ? 'formats' : a.what === 'all' ? 'all' : 'values'); return `Cleared ${rangeLabel(R)}.` })
  const mergeCells = structure('merge_cells', 'Merge a range into one cell.', { range: { type: 'string' } }, ['range'], (a) => `Merge ${a.range}`, (id, a) => { m.merge(id, rect(id, a.range)); return `Merged ${a.range}.` })
  const freeze = structure('freeze_panes', 'Freeze rows and/or columns at the top/left.', { rows: { type: 'number' }, columns: { type: 'number' } }, [], (a) => `Freeze ${a.rows ?? 0} row(s) and ${a.columns ?? 0} column(s)`, (id, a) => { m.setFreeze(id, Number(a.rows ?? 0), Number(a.columns ?? 0)); return 'Updated frozen panes.' })
  const colWidth = structure('set_column_width', 'Set column width in pixels (default 100).', { columns: { type: 'string', description: 'e.g. B or B:D' }, width: { type: 'number' } }, ['columns', 'width'], (a) => `Set column ${a.columns} width to ${a.width}px`, (id, a) => { const R = rect(id, String(a.columns).includes(':') ? a.columns : `${a.columns}:${a.columns}`); for (let c = R.c1; c <= R.c2; c++) m.setColWidth(id, c, Number(a.width)); return 'Set column width.' })
  const addSheet = tool('add_sheet', 'Add a new sheet (tab) and switch to it.', { name: { type: 'string' } }, ['name'], {
    edit: true, describe: (a) => ({ title: `Add a sheet called “${a.name}”` }),
    run: (a) => { if (m.sheetId(a.name)) throw new Error('A sheet with that name already exists'); const id = m.addTab(a.name); d.setSheet(id); return `Added sheet “${a.name}” and switched to it.` },
  })
  const renameSheet = tool('rename_sheet', 'Rename a sheet; formulas that refer to it are updated.', { from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to'], {
    edit: true, describe: (a) => ({ title: `Rename sheet “${a.from}” to “${a.to}”` }),
    run: (a) => { const id = sheetId(a.from); m.renameTab(id, a.to); return `Renamed to “${a.to}”.` },
  })

  return {
    kind: 'sheet', noun: 'spreadsheet', title: d.getTitle, canEdit: d.canEdit, undo: () => m.undo(),
    guide: `You are working in a spreadsheet. Formulas use Excel syntax (SUM, IF, XLOOKUP, FILTER, SUMIFS, …) and cell references like B2 or Sheet2!A1. Prefer live formulas over typing computed numbers so results stay correct when data changes. After writing formulas, check the "Formula results" the tool returns and fix any errors. Build charts with create_chart (column, bar, line, area, pie, scatter). Put new tables or summaries in empty areas or on a new sheet, never over existing data unless asked. Dates are stored as dates when written like 2024-01-31. Keep header rows bold when you create tables.`,
    context: () => {
      const R = d.getSel(), id = d.getSheet()
      const one = R.r1 === R.r2 && R.c1 === R.c2
      return `Active sheet: “${nameOf(id)}”. Sheets: ${m.tabList().map((t) => t.name).join(', ')}. The user has ${one ? `cell ${rangeLabel(R)} selected${m.raw(id, R.r1, R.c1) ? ` (contents: ${clip(m.raw(id, R.r1, R.c1) ?? '', 80)})` : ' (empty)'}` : `${rangeLabel(R)} selected`}.`
    },
    suggestions: ['Explain what this sheet does', 'Chart the data', 'Add a totals row', 'Look for anything odd in the numbers'],
    tools: [readSheet, getSelection, setCells, setRange, formatCells, createChart, updateChart, deleteChart, sortRange, insertRows, deleteRows, insertCols, deleteCols, clearRange, mergeCells, freeze, colWidth, addSheet, renameSheet],
  }
}
