import { api } from '../api'
import { ANSWERABLE, TYPE_LABEL, hasOptions, type FormItem, type FormModel, type ItemType } from '../forms/model'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'

export interface FormDeps {
  model: FormModel
  docId: string
  getTitle: () => string
  setTitle: (t: string) => void
  canEdit: () => boolean
}

const TYPES = Object.keys(TYPE_LABEL).filter((t) => t !== 'page') as ItemType[]
const WORDS: Record<string, ItemType> = { 'short answer': 'short', text: 'short', paragraph: 'long', 'long answer': 'long', 'multiple choice': 'radio', choice: 'radio', 'single choice': 'radio', checkboxes: 'checkbox', dropdown: 'select', rating: 'scale', 'linear scale': 'scale', heading: 'section', 'info block': 'info', upload: 'file', 'file upload': 'file' }
const asType = (t: unknown): ItemType => {
  const s = String(t ?? '').trim().toLowerCase()
  const k = (TYPES.includes(s as ItemType) ? s : WORDS[s]) as ItemType | undefined
  if (!k) throw new Error(`Unknown question type “${t}”. Use one of: ${TYPES.join(', ')}.`)
  return k
}

/** One line per question for the model to read (numbers are 1-based and shift when questions are added or removed). */
function describe(it: FormItem, n: number): string {
  const bits = [`${n}. [${it.type}] ${it.title || '(no title)'}`]
  if (it.required) bits.push('(required)')
  const extra: string[] = []
  if (it.help) extra.push(`help: ${it.help}`)
  if (hasOptions(it.type)) extra.push(`options: ${(it.options ?? []).join(' | ')}${it.other ? ' | Other…' : ''}`)
  if (it.type === 'scale') extra.push(`scale ${it.scaleMin ?? 1} to ${it.scaleMax ?? 5}${it.minLabel ? `, ${it.minLabel}` : ''}${it.maxLabel ? ` … ${it.maxLabel}` : ''}`)
  if (it.minLen || it.maxLen) extra.push(`length ${it.minLen ?? 0}-${it.maxLen ?? '∞'}`)
  if (it.min !== undefined || it.max !== undefined) extra.push(`${it.type === 'number' ? 'value' : 'range'} ${it.min ?? '…'} to ${it.max ?? '…'}${it.integer ? ', whole numbers' : ''}`)
  if (it.minSel || it.maxSel) extra.push(`pick ${it.minSel ?? 0}-${it.maxSel ?? '∞'}`)
  if (it.pattern) extra.push(`pattern ${it.pattern}`)
  if (it.showIf) extra.push(`shown only if ${it.showIf.match} of ${it.showIf.rules.length} rule(s) hold`)
  if (it.jumps && Object.keys(it.jumps).length) extra.push('has answer-based jumps')
  return bits.join(' ') + (extra.length ? `\n     ${extra.join('; ')}` : '')
}

export function createFormAdapter(d: FormDeps): Adapter {
  const m = d.model
  const at = (n: unknown): FormItem => {
    const list = m.read(), i = Number(n) - 1
    if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error(`There is no question ${n}. The form has ${list.length} item${list.length === 1 ? '' : 's'}.`)
    return list[i]
  }
  const props = {
    title: { type: 'string', description: 'The question (or heading text)' },
    help: { type: 'string', description: 'Small help text under the question' },
    required: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' }, description: 'The choices, for single choice, multiple choice and dropdown' },
    other: { type: 'boolean', description: 'Also offer an "Other" box (single and multiple choice)' },
    placeholder: { type: 'string' },
    min_length: { type: 'number' }, max_length: { type: 'number' },
    min: { type: 'string', description: 'Smallest number or earliest date (YYYY-MM-DD)' }, max: { type: 'string', description: 'Largest number or latest date' },
    whole_numbers: { type: 'boolean' },
    min_choices: { type: 'number' }, max_choices: { type: 'number' },
    scale_min: { type: 'number' }, scale_max: { type: 'number' }, min_label: { type: 'string' }, max_label: { type: 'string' },
    pattern: { type: 'string', description: 'A regular expression the answer must match' }, pattern_message: { type: 'string' },
  }
  const patchOf = (a: any): Partial<FormItem> => {
    const p: Partial<FormItem> = {}
    if (a.title !== undefined) p.title = String(a.title)
    if (a.help !== undefined) p.help = String(a.help)
    if (a.required !== undefined) p.required = !!a.required
    if (Array.isArray(a.options)) { const opts = a.options.map((x: unknown) => String(x)).filter(Boolean); if (!opts.length) throw new Error('Give at least one option.'); p.options = opts }
    if (a.other !== undefined) p.other = !!a.other
    if (a.placeholder !== undefined) p.placeholder = String(a.placeholder)
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))
    if (a.min_length !== undefined) p.minLen = num(a.min_length)
    if (a.max_length !== undefined) p.maxLen = num(a.max_length)
    if (a.min !== undefined) p.min = String(a.min)
    if (a.max !== undefined) p.max = String(a.max)
    if (a.whole_numbers !== undefined) p.integer = !!a.whole_numbers
    if (a.min_choices !== undefined) p.minSel = num(a.min_choices)
    if (a.max_choices !== undefined) p.maxSel = num(a.max_choices)
    if (a.scale_min !== undefined) p.scaleMin = num(a.scale_min)
    if (a.scale_max !== undefined) p.scaleMax = num(a.scale_max)
    if (a.min_label !== undefined) p.minLabel = String(a.min_label)
    if (a.max_label !== undefined) p.maxLabel = String(a.max_label)
    if (a.pattern !== undefined) p.pattern = String(a.pattern)
    if (a.pattern_message !== undefined) p.patternMsg = String(a.pattern_message)
    return p
  }

  const readForm: Tool = tool('read_form', 'Read the whole form: its title, description, settings and every question in order (numbered from 1).', {}, [], {
    label: () => 'Reading the form',
    run: () => {
      const items = m.read()
      const settings = `Accepting responses: ${m.getMeta('accepting', true) ? 'yes' : 'no (closed)'}. Sign-in required: ${m.getMeta('requireLogin', false) || m.getMeta('oneResponse', false) ? 'yes' : 'no'}. One response per person: ${m.getMeta('oneResponse', false) ? 'yes' : 'no'}.`
      const conf = m.getMeta('confirmation', '')
      const out = `Title: ${d.getTitle() || '(untitled)'}\nDescription: ${m.getMeta('description', '') || '(none)'}\n${settings}${conf ? `\nConfirmation message: ${conf}` : ''}\n\n${items.length ? items.map((it, i) => describe(it, i + 1)).join('\n') : '(no questions yet)'}`
      return clip(out, MAX_RESULT_CHARS)
    },
  })
  const readResponses: Tool = tool('read_responses', 'Read a summary of the answers people have submitted: how many responses, and for each question the tally of choices or the list of text answers. Only for forms the person owns or edits.', {}, [], {
    label: () => 'Reading the responses',
    run: async () => {
      const { items, responses } = await api.formResponses(d.docId)
      if (!responses.length) return 'There are no responses yet.'
      const out: string[] = [`${responses.length} response${responses.length === 1 ? '' : 's'}.`]
      items.filter((q) => ANSWERABLE.includes(q.type)).forEach((q) => {
        const vals = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
        out.push(`\n${q.title || '(untitled)'} [${q.type}] — ${vals.length} answered`)
        if (q.type === 'file') { out.push(`  ${vals.length} file(s) uploaded`); return }
        const flat = vals.flatMap((v) => (Array.isArray(v) ? v.map(String) : [typeof v === 'object' && v && 'name' in v ? String((v as { name: string }).name) : String(v)]))
        if (hasOptions(q.type) || q.type === 'scale') {
          const tally = new Map<string, number>(); flat.forEach((v) => tally.set(v, (tally.get(v) ?? 0) + 1))
          out.push(...[...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`))
          if (q.type === 'scale' && flat.length) out.push(`  average ${(flat.reduce((s, v) => s + Number(v), 0) / flat.length).toFixed(2)}`)
        } else if (q.type === 'number' && flat.length) {
          const nums = flat.map(Number).filter(Number.isFinite); if (nums.length) out.push(`  min ${Math.min(...nums)}, max ${Math.max(...nums)}, average ${(nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(2)}`)
        } else out.push(...flat.slice(0, 40).map((v) => `  - ${clip(v, 200)}`), ...(flat.length > 40 ? [`  … and ${flat.length - 40} more`] : []))
      })
      return clip(out.join('\n'), MAX_RESULT_CHARS)
    },
  })
  const addQ: Tool = tool('add_question', `Add a question (or a heading / info block) to the form. Types: ${TYPES.join(', ')}.`,
    { type: { type: 'string', description: 'The question type' }, ...props, after: { type: 'number', description: 'Put it after this question number (0 = at the very top). Leave out to add at the end.' } }, ['type', 'title'], {
      edit: true,
      describe: (a) => ({ title: `Add ${TYPE_LABEL[asType(a.type)].toLowerCase()}: ${clip(String(a.title ?? ''), 80)}`, detail: Array.isArray(a.options) ? `Options: ${a.options.join(', ')}` : a.required ? 'Required' : undefined }),
      run: (a) => {
        const t = asType(a.type), list = m.read()
        const after = a.after === undefined || a.after === null ? list[list.length - 1]?.id ?? null : Number(a.after) <= 0 ? null : at(a.after).id
        const id = m.add(t, after)
        const p = patchOf(a)
        if (hasOptions(t) && !p.options) p.options = ['Option 1', 'Option 2']
        m.update(id, p)
        return `Added as question ${m.read().findIndex((x) => x.id === id) + 1}.`
      },
    })
  const editQ: Tool = tool('edit_question', 'Change a question. Only the things you pass change. To switch its type, pass `type`.', { question: { type: 'number', description: 'The question number from read_form' }, type: { type: 'string' }, ...props }, ['question'], {
    edit: true,
    describe: (a) => { let cur = ''; try { cur = at(a.question).title } catch { /* shown on run */ } return { title: `Edit question ${a.question}`, before: clip(cur, 120), after: a.title !== undefined ? clip(String(a.title), 120) : Object.keys(a).filter((k) => k !== 'question').join(', ') } },
    run: (a) => {
      const it = at(a.question)
      if (a.type !== undefined && asType(a.type) !== it.type) m.retype(it.id, asType(a.type))
      const p = patchOf(a)
      if (Object.keys(p).length) m.update(it.id, p)
      return 'Updated.'
    },
  })
  const delQ: Tool = tool('delete_question', 'Delete a question from the form (its past answers stay in the responses).', { question: { type: 'number' } }, ['question'], {
    edit: true, describe: (a) => { let t = ''; try { t = at(a.question).title } catch { /* */ } return { title: `Delete question ${a.question}`, before: clip(t, 120) } },
    run: (a) => { m.remove(at(a.question).id); return `Deleted. ${m.read().length} left.` },
  })
  const moveQ: Tool = tool('move_question', 'Move a question to a new position (1-based).', { question: { type: 'number' }, to: { type: 'number' } }, ['question', 'to'], {
    edit: true, describe: (a) => ({ title: `Move question ${a.question} to position ${a.to}` }),
    run: (a) => { const it = at(a.question), target = at(a.to); m.moveTo(it.id, target.id); return 'Moved.' },
  })
  const setDetails: Tool = tool('set_form_details', 'Change the form\'s title, description or settings.', {
    title: { type: 'string' }, description: { type: 'string' }, accepting: { type: 'boolean', description: 'false closes the form' }, require_login: { type: 'boolean' }, one_response_per_person: { type: 'boolean' }, confirmation: { type: 'string', description: 'Message shown after submitting' },
  }, [], {
    edit: true, describe: (a) => ({ title: 'Change the form details', detail: Object.entries(a).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${clip(String(v), 60)}`).join('; ') }),
    run: (a) => {
      if (a.title !== undefined) d.setTitle(String(a.title))
      if (a.description !== undefined) m.setMeta('description', String(a.description))
      if (a.accepting !== undefined) m.setMeta('accepting', !!a.accepting)
      if (a.confirmation !== undefined) m.setMeta('confirmation', String(a.confirmation))
      if (a.one_response_per_person !== undefined) { m.setMeta('oneResponse', !!a.one_response_per_person); if (a.one_response_per_person) m.setMeta('requireLogin', true) }
      if (a.require_login !== undefined) m.setMeta('requireLogin', !!a.require_login)
      return 'Updated.'
    },
  })

  return {
    kind: 'form', noun: 'form', title: d.getTitle, canEdit: d.canEdit, undo: () => { m.undo.undo() },
    guide: `You are helping build a form (a survey, sign-up sheet, quiz or feedback form). Read it with read_form first. Questions are numbered from 1 and the numbers shift when you add, delete or move one.
- Write clear, neutral questions, one thing per question. Pick the type that fits: short answer for names and short text, paragraph for opinions, single choice or dropdown when exactly one option applies, multiple choice when several can, a linear scale for ratings, date or time pickers instead of free text, email and link types where the answer must be one.
- Mark a question required only if the form cannot be used without it. Give choices short labels. Do not invent a "Other" box unless it helps.
- Use headings (section) to group long forms, and an info block for instructions.
- For a new form: write a title and a one-line description with set_form_details, then add the questions in order, then summarise in two sentences. When asked to review a form, point out unclear, leading or double-barreled questions and suggest fixes before changing anything big.
- You can read what people answered with read_responses (counts and tallies; text answers are quoted). Never invent responses. Answers belong to the form's owner, so keep quotes short and relevant.
- Logic (show a question only if...), file upload settings and the look of the form are changed by the person in the editor; tell them where if they ask.`,
    context: () => { const items = m.read(); return `The form "${d.getTitle() || 'Untitled form'}" has ${items.length} item${items.length === 1 ? '' : 's'}${m.getMeta('accepting', true) ? '' : ' and is closed to new responses'}.` },
    suggestions: ['Build a customer feedback form', 'Review my questions and suggest improvements', 'Summarize the responses', 'Add a rating question and a comments box'],
    tools: [readForm, readResponses, addQ, editQ, delQ, moveQ, setDetails],
  }
}
