import { COLORS, FORMATS, TYPE_LABEL, customRegex, isEmpty, problem, uid, type BoardModel, type FieldDef, type FieldType, type TextFormat, type Value } from '../board/model'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'

export interface BoardDeps {
  model: BoardModel
  getTitle: () => string
  setTitle: (t: string) => void
  canEdit: () => boolean
}

type F = { id: string } & FieldDef
const FIELD_TYPES = Object.keys(TYPE_LABEL) as FieldType[]

/** Text-validation settings from a tool call (format, pattern, message), or an error if they don't make sense. */
function textRules(a: any, type: string): Partial<FieldDef> {
  const out: Partial<FieldDef> = {}
  if (a.format === undefined && a.pattern === undefined && a.message === undefined) return out
  if (type !== 'text') throw new Error('Format, pattern and message only apply to text fields.')
  if (a.format !== undefined) out.format = a.format === 'none' || a.format === '' ? undefined : (a.format as TextFormat)
  if (a.pattern !== undefined) { if (a.pattern && !customRegex(String(a.pattern))) throw new Error('That pattern is not a valid regular expression.'); out.pattern = String(a.pattern) || undefined }
  if (a.message !== undefined) out.message = String(a.message) || undefined
  return out
}
const same = (a: string, b: unknown) => a.trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

export function createBoardAdapter(d: BoardDeps): Adapter {
  const m = d.model
  const col = (v: unknown) => {
    const c = m.columns().find((x) => x.id === v || same(x.name, v))
    if (!c) throw new Error(`There is no column “${v}”. The columns are: ${m.columns().map((x) => x.name).join(', ')}.`)
    return c
  }
  const field = (v: unknown): F => {
    const f = m.fieldList().find((x) => x.id === v || same(x.name, v))
    if (!f) throw new Error(`There is no field “${v}”. The fields are: ${m.fieldList().map((x) => x.name).join(', ') || '(none yet)'}.`)
    return f
  }
  const card = (v: unknown) => { const c = m.card(String(v)); if (!c) throw new Error(`There is no card with id ${v}. Read the board for the ids.`); return c }

  /** What the model sends for a field (labels, text, numbers) becomes what the board stores (option ids...). */
  const toValue = (f: F, raw: unknown): Value | undefined => {
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) return undefined
    switch (f.type) {
      case 'checkbox': return raw === true || String(raw).toLowerCase() === 'true' || raw === 'yes' ? true : undefined
      case 'number': { const n = Number(raw); if (!Number.isFinite(n)) throw new Error(`“${f.name}” needs a number.`); return n }
      case 'date': { const s = String(raw).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`“${f.name}” needs a date like 2026-10-31.`); return s }
      case 'single': case 'multi': {
        const labels = (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => String(x).trim()).filter(Boolean)
        const ids = labels.map((l) => { const o = (f.options ?? []).find((x) => x.id === l || same(x.label, l)); if (!o) throw new Error(`“${l}” is not an option of “${f.name}”. Options: ${(f.options ?? []).map((x) => x.label).join(', ')}.`); return o.id })
        if (f.type === 'single') { if (ids.length > 1) throw new Error(`“${f.name}” takes one option.`); return ids[0] }
        return [...new Set(ids)]
      }
      default: return String(raw)
    }
  }
  const apply = (values: Record<string, unknown> | undefined): Record<string, Value> => {
    const out: Record<string, Value> = {}
    for (const [k, raw] of Object.entries(values ?? {})) { const f = field(k); const v = toValue(f, raw); if (v !== undefined) out[f.id] = v }
    return out
  }
  const show = (f: F, v: Value | undefined): string => {
    if (isEmpty(v)) return ''
    if (f.type === 'single' || f.type === 'multi') return (Array.isArray(v) ? v : [String(v)]).map((id) => f.options?.find((o) => o.id === id)?.label ?? '?').join(', ')
    return f.type === 'checkbox' ? 'yes' : String(v)
  }
  const checkAll = (values: Record<string, Value>, fields: F[]) => {
    const bad = fields.map((f) => ({ f, msg: problem(f, values[f.id]) })).filter((x) => x.msg)
    if (bad.length) throw new Error(bad.map((x) => `${x.f.name}: ${x.msg}`).join('; '))
  }

  const valuesProp = { type: 'object', description: 'Field values by field name, e.g. {"Priority": "High", "Due date": "2026-10-31", "Labels": ["Design","Docs"]}. Select fields take the option label; dates are YYYY-MM-DD; use null to clear a value.', additionalProperties: true }

  const readBoard: Tool = tool('read_board', 'Read the whole board: its fields, and every column with its cards (each card with its id, field values and description).', {}, [], {
    label: () => 'Reading the board',
    run: () => {
      const fields = m.fieldList(), cols = m.columns()
      const out = [`Board: ${d.getTitle() || '(untitled)'}`, `Fields: ${fields.length ? fields.map((f) => `${f.name} (${TYPE_LABEL[f.type].toLowerCase()}${f.required ? ', required' : ''}${f.options ? `: ${f.options.map((o) => o.label).join(' | ')}` : ''}${f.min !== undefined || f.max !== undefined ? `, ${f.min ?? '…'} to ${f.max ?? '…'}${f.type === 'text' ? ' characters' : ''}` : ''}${f.format ? `, must be ${f.format === 'custom' ? `pattern ${f.pattern}` : FORMATS.find((x) => x.id === f.format)?.label.toLowerCase()}` : ''})`).join('; ') : '(none yet)'}`, '']
      for (const c of cols) {
        const list = m.cardsIn(c.id)
        out.push(`## ${c.name} (${list.length})`)
        if (!list.length) out.push('(empty)')
        for (const k of list) {
          const vals = fields.map((f) => [f.name, show(f, k.v?.[f.id])] as const).filter(([, v]) => v)
          out.push(`- [${k.id}] ${k.title}${vals.length ? ` | ${vals.map(([n, v]) => `${n}: ${v}`).join(' | ')}` : ''}${k.desc ? `\n    ${clip(k.desc.replace(/\s+/g, ' '), 300)}` : ''}`)
        }
        out.push('')
      }
      return clip(out.join('\n'), MAX_RESULT_CHARS)
    },
  })
  const addCard: Tool = tool('add_card', 'Add a card to a column. Required fields must be filled in or the card is refused.', { column: { type: 'string', description: 'Column name' }, title: { type: 'string' }, description: { type: 'string' }, values: valuesProp }, ['column', 'title'], {
    edit: true, describe: (a) => ({ title: `Add card “${clip(String(a.title ?? ''), 80)}” to ${a.column}`, detail: a.values ? Object.entries(a.values as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ') : undefined }),
    run: (a) => {
      const c = col(a.column), fields = m.fieldList(), values = apply(a.values)
      if (!String(a.title ?? '').trim()) throw new Error('A card needs a title.')
      checkAll(values, fields)
      const id = m.addCard(c.id, String(a.title).trim(), values, a.description ? String(a.description) : undefined)
      return `Added card ${id} to ${c.name}.`
    },
  })
  const editCard: Tool = tool('edit_card', 'Change a card: its title, description, column or field values. Only what you pass changes.', { card: { type: 'string', description: 'The card id from read_board' }, title: { type: 'string' }, description: { type: 'string' }, column: { type: 'string', description: 'Move it to this column (at the end)' }, values: valuesProp }, ['card'], {
    edit: true, describe: (a) => { let t = ''; try { t = card(a.card).title } catch { /* shown on run */ } return { title: `Edit card “${clip(t, 70)}”`, detail: [a.title && `title: ${a.title}`, a.column && `move to ${a.column}`, a.values && Object.keys(a.values as object).join(', ')].filter(Boolean).join('; ') } },
    run: (a) => {
      const c = card(a.card), fields = m.fieldList(), patch = apply(a.values)
      const next = { ...(c.v ?? {}) } as Record<string, Value>
      for (const [k, raw] of Object.entries((a.values ?? {}) as Record<string, unknown>)) { const f = field(k); const v = toValue(f, raw); if (v === undefined) delete next[f.id]; else next[f.id] = v }
      void patch
      checkAll(next, fields)
      if (a.title !== undefined) { if (!String(a.title).trim()) throw new Error('A card needs a title.'); m.updateCard(c.id, { title: String(a.title).trim() }) }
      if (a.description !== undefined) m.updateCard(c.id, { desc: String(a.description) || undefined })
      for (const f of fields) { const had = c.v?.[f.id], now = next[f.id]; if (JSON.stringify(had) !== JSON.stringify(now)) m.setValue(c.id, f.id, now) }
      if (a.column !== undefined) m.moveCard(c.id, col(a.column).id, null)
      return 'Updated.'
    },
  })
  const moveCard: Tool = tool('move_card', 'Move a card to a column, optionally just before another card.', { card: { type: 'string' }, column: { type: 'string' }, before: { type: 'string', description: 'Put it just above this card id; leave out for the bottom' } }, ['card', 'column'], {
    edit: true, describe: (a) => { let t = ''; try { t = card(a.card).title } catch { /* */ } return { title: `Move “${clip(t, 70)}” to ${a.column}` } },
    run: (a) => { const c = card(a.card), to = col(a.column); if (a.before) card(a.before); m.moveCard(c.id, to.id, a.before ? String(a.before) : null); return 'Moved.' },
  })
  const delCard: Tool = tool('delete_card', 'Delete a card.', { card: { type: 'string' } }, ['card'], {
    edit: true, describe: (a) => { let t = ''; try { t = card(a.card).title } catch { /* */ } return { title: `Delete card “${clip(t, 80)}”` } }, run: (a) => { m.removeCard(card(a.card).id); return 'Deleted.' },
  })
  const addColumn: Tool = tool('add_column', 'Add a column at the end.', { name: { type: 'string' }, color: { type: 'string', description: 'A hex colour like #22c55e (optional)' } }, ['name'], {
    edit: true, describe: (a) => ({ title: `Add column “${a.name}”` }),
    run: (a) => { if (m.columns().some((c) => same(c.name, a.name))) throw new Error('There is already a column with that name.'); const id = m.addCol(String(a.name).trim()); if (/^#[0-9a-f]{6}$/i.test(String(a.color ?? ''))) m.updateCol(id, { color: String(a.color) }); return 'Added.' },
  })
  const editColumn: Tool = tool('edit_column', 'Rename or recolour a column, or move it left or right.', { column: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, move: { type: 'string', enum: ['left', 'right'] } }, ['column'], {
    edit: true, describe: (a) => ({ title: `Change column “${a.column}”`, detail: [a.name && `rename to ${a.name}`, a.color && `colour ${a.color}`, a.move && `move ${a.move}`].filter(Boolean).join('; ') }),
    run: (a) => { const c = col(a.column); if (a.name !== undefined) m.updateCol(c.id, { name: String(a.name).trim() || c.name }); if (/^#[0-9a-f]{6}$/i.test(String(a.color ?? ''))) m.updateCol(c.id, { color: String(a.color) }); if (a.move) m.moveCol(c.id, a.move === 'left' ? -1 : 1); return 'Updated.' },
  })
  const delColumn: Tool = tool('delete_column', 'Delete a column. Its cards move to the column you name (default: the neighbouring one).', { column: { type: 'string' }, move_cards_to: { type: 'string' } }, ['column'], {
    edit: true, describe: (a) => ({ title: `Delete column “${a.column}”`, detail: `Its cards move to ${a.move_cards_to ?? 'the neighbouring column'}` }),
    run: (a) => {
      const cols = m.columns(), c = col(a.column)
      if (cols.length === 1) throw new Error('A board needs at least one column.')
      const to = a.move_cards_to ? col(a.move_cards_to) : cols[cols.findIndex((x) => x.id === c.id) === 0 ? 1 : cols.findIndex((x) => x.id === c.id) - 1]
      if (to.id === c.id) throw new Error('Choose a different column to move the cards to.')
      m.removeCol(c.id, to.id); return `Deleted. Its cards went to ${to.name}.`
    },
  })
  const fieldProps = { type: { type: 'string', enum: FIELD_TYPES }, required: { type: 'boolean' }, options: { type: 'array', items: { type: 'string' }, description: 'The choices (single and multi select)' }, min: { type: 'string', description: 'Smallest number, earliest date, or (text) fewest characters' }, max: { type: 'string', description: 'Largest number, latest date, or (text) most characters' }, format: { type: 'string', enum: ['none', ...FORMATS.map((f) => f.id)], description: 'Text fields only: what the text must look like. none removes it.' }, pattern: { type: 'string', description: 'Text fields with format custom: a regular expression the whole text must match' }, message: { type: 'string', description: 'Text fields: what to tell people when the text does not fit' }, show_on_card: { type: 'boolean' } }
  const addField: Tool = tool('add_field', 'Add a custom field to every card. Types: ' + FIELD_TYPES.join(', ') + '.', { name: { type: 'string' }, ...fieldProps }, ['name', 'type'], {
    edit: true, describe: (a) => ({ title: `Add field “${a.name}” (${String(a.type)})`, detail: Array.isArray(a.options) ? `Options: ${a.options.join(', ')}` : a.required ? 'Required' : undefined }),
    run: (a) => {
      if (!FIELD_TYPES.includes(a.type)) throw new Error(`Type must be one of: ${FIELD_TYPES.join(', ')}.`)
      if (m.fieldList().some((f) => same(f.name, a.name))) throw new Error('There is already a field with that name.')
      const id = m.addField(a.type); const patch: Partial<FieldDef> = { name: String(a.name).trim() }
      if (a.type === 'single' || a.type === 'multi') { const opts = (Array.isArray(a.options) ? a.options : ['Option 1', 'Option 2']).map(String).filter(Boolean); patch.options = opts.map((label: string, i: number) => ({ id: uid(), label, color: COLORS[i % COLORS.length] })) }
      if (a.required) patch.required = true
      if (a.min !== undefined && a.min !== '') patch.min = a.type === 'number' || a.type === 'text' ? Number(a.min) : String(a.min)
      if (a.max !== undefined && a.max !== '') patch.max = a.type === 'number' || a.type === 'text' ? Number(a.max) : String(a.max)
      if (a.show_on_card === false) patch.hidden = true
      Object.assign(patch, textRules(a, a.type))
      m.updateField(id, patch); return 'Added.'
    },
  })
  const editField: Tool = tool('edit_field', 'Change a field: rename it, make it required, change its limits or its options (give the full list of option labels; ones with the same label keep their values).', { field: { type: 'string' }, name: { type: 'string' }, ...fieldProps }, ['field'], {
    edit: true, describe: (a) => ({ title: `Change field “${a.field}”`, detail: Object.keys(a).filter((k) => k !== 'field').join(', ') }),
    run: (a) => {
      const f = field(a.field), patch: Partial<FieldDef> = {}
      if (a.name !== undefined) patch.name = String(a.name).trim() || f.name
      if (a.required !== undefined) patch.required = !!a.required
      if (a.show_on_card !== undefined) patch.hidden = !a.show_on_card
      if (a.min !== undefined) patch.min = a.min === '' ? undefined : f.type === 'number' || f.type === 'text' ? Number(a.min) : String(a.min)
      if (a.max !== undefined) patch.max = a.max === '' ? undefined : f.type === 'number' || f.type === 'text' ? Number(a.max) : String(a.max)
      if (Array.isArray(a.options)) {
        if (f.type !== 'single' && f.type !== 'multi') throw new Error('Only single and multi select fields have options.')
        const labels = a.options.map(String).filter(Boolean); if (!labels.length) throw new Error('Keep at least one option.')
        patch.options = labels.map((label: string, i: number) => { const old = (f.options ?? []).find((o) => same(o.label, label)); return old ? { ...old, label } : { id: uid(), label, color: COLORS[i % COLORS.length] } })
      }
      Object.assign(patch, textRules(a, f.type))
      m.updateField(f.id, patch); return 'Updated.'
    },
  })
  const delField: Tool = tool('delete_field', 'Delete a field and its values from every card.', { field: { type: 'string' } }, ['field'], {
    edit: true, describe: (a) => ({ title: `Delete field “${a.field}”`, detail: 'Its values are removed from every card.' }), run: (a) => { m.removeField(field(a.field).id); return 'Deleted.' },
  })
  const setTitle: Tool = tool('set_board_title', 'Rename the board.', { title: { type: 'string' } }, ['title'], {
    edit: true, describe: (a) => ({ title: `Rename the board to “${a.title}”` }), run: (a) => { d.setTitle(String(a.title)); return 'Renamed.' },
  })

  return {
    kind: 'board', noun: 'board', title: d.getTitle, canEdit: d.canEdit, undo: () => { m.undo.undo() },
    guide: `You are working on a kanban board (columns of cards, with custom fields on every card). Read it with read_board first; cards, columns and fields are named in the result, and cards have ids you pass back.
- Cards are short work items: a clear title, a description only when it adds something, and field values instead of putting priority or dates in the title.
- Use the board's existing fields and columns; do not add a field or a column unless the user asks or a request clearly needs it. Select fields take one of their option labels exactly. Dates are YYYY-MM-DD, and today's date is in your context.
- Required fields must have a value when you add or edit a card, or the change is refused; if you do not know the value, ask or pick a sensible default and say so.
- To plan work (a launch, a sprint, a backlog): propose the cards, add them in order of priority, put them in sensible columns and fill in the fields you can. To review a board, point out stale work, missing dates, overloaded columns and cards with no clear owner or next step, then offer changes.
- Summarise what you did in a sentence or two, naming the cards by title, not by id.`,
    context: () => `The board "${d.getTitle() || 'Untitled board'}" has ${m.columns().length} columns, ${m.fieldList().length} fields and ${m.columns().reduce((n, c) => n + m.cardsIn(c.id).length, 0)} cards.`,
    suggestions: ['Plan a product launch as cards', 'Summarize this board', 'What is overdue or missing a date?', 'Break the biggest card into smaller tasks'],
    tools: [readBoard, addCard, editCard, moveCard, delCard, addColumn, editColumn, delColumn, addField, editField, delField, setTitle],
  }
}
