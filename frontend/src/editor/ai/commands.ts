import type { Editor } from '@tiptap/react'
import { fixFormatting, reportText } from './fixFormatting'

/** Plain-English commands that need no AI: "make this bold", "heading 2", "turn this into a bullet list", "align center", "make it red", "uppercase" …
 *  What "this" means: the selection, or when nothing is selected, the line the cursor is in. Returns what was done, or null when the words aren't a command we know
 *  (the command bar then asks the AI model, if one is connected). */
const COLORS: Record<string, string> = { red: '#dc2626', orange: '#ea580c', yellow: '#ca8a04', green: '#16a34a', teal: '#0d9488', blue: '#2563eb', purple: '#7c3aed', pink: '#db2777', gray: '#6b7280', grey: '#6b7280', black: '#111827', white: '#ffffff', brown: '#92400e' }
const MARKERS: Record<string, string> = { yellow: '#fde68a', green: '#bbf7d0', pink: '#fbcfe8', blue: '#bfdbfe', orange: '#fed7aa', purple: '#e9d5ff', red: '#fecaca', gray: '#e5e7eb', grey: '#e5e7eb' }

const clean = (s: string) => s.toLowerCase().replace(/[.!?,;:"“”]/g, ' ').replace(/\s+/g, ' ').trim()
const LEAD = /^(please |kindly |can you |could you |would you |i want to |i'd like to |i would like to |just |now )+/
const THIS = /\b(this|it|that|the (selection|selected text|text|line|paragraph|sentence|word|heading))\b/g

export interface Scope { from: number; to: number; block: boolean }
/** the selection, or the whole line the cursor is in */
export function scopeOf(editor: Editor): Scope {
  const { from, to, empty, $from } = editor.state.selection
  if (!empty) return { from, to, block: false }
  const start = $from.start(), end = $from.end()
  return { from: start, to: end, block: true }
}

function mapText(editor: Editor, s: Scope, fn: (t: string) => string): number {
  const tr = editor.state.tr; let n = 0
  const edits: { from: number; to: number; text: string; marks: readonly import('@tiptap/pm/model').Mark[] }[] = []
  editor.state.doc.nodesBetween(s.from, s.to, (node, pos) => {
    if (!node.isText || !node.text) return
    const a = Math.max(s.from, pos), b = Math.min(s.to, pos + node.nodeSize)
    const old = node.text.slice(a - pos, b - pos), neu = fn(old)
    if (neu !== old) { edits.push({ from: a, to: b, text: neu, marks: node.marks }); n++ }
  })
  for (const e of edits.reverse()) tr.replaceWith(e.from, e.to, editor.schema.text(e.text, e.marks))
  if (n) editor.view.dispatch(tr)
  return n
}
const titleCase = (t: string) => t.toLowerCase().replace(/(^|[\s(\-"“])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
const sentenceCase = (t: string) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())

type Run = (editor: Editor, s: Scope, m: RegExpExecArray) => string | null
const SET_MARKS: [RegExp, string, string][] = [
  [/^(bold|bolden|make bold|bold face|strong)( text)?$/, 'bold', 'Made it bold'],
  [/^(italic|italics|italicize|italicise|emphasi[sz]e|slanted)( text)?$/, 'italic', 'Made it italic'],
  [/^(underline|underlined)( text)?$/, 'underline', 'Underlined it'],
  [/^(strike ?through|strike|cross out|cross it out|strikethrough text)$/, 'strike', 'Struck it through'],
  [/^(code|inline code|monospace|monospaced|code font)$/, 'code', 'Formatted it as code'],
  [/^(superscript|raise|raised)$/, 'superscript', 'Made it superscript'],
  [/^(subscript|lower|lowered)$/, 'subscript', 'Made it subscript'],
]

const RULES: [RegExp, Run][] = [
  [/^(fix|clean ?up|tidy( up)?|repair|correct|sort out) (the )?(formatting|spacing|layout|format)( of (the )?(doc(ument)?|page))?$|^(fix|tidy|clean) (up )?(everything|all)$/, (e) => reportText(fixFormatting(e))],
  [/^(remove|clear|take off|get rid of|reset) (all )?(formatting|styles?|styling)$|^plain text$|^unformat$/, (e, s) => { e.chain().focus().setTextSelection({ from: s.from, to: s.to }).unsetAllMarks().run(); return 'Cleared the formatting' }],
  [/^(un ?bold|remove bold|not bold|no bold|stop bold|take off bold)$/, (e, s) => { e.chain().focus().setTextSelection({ from: s.from, to: s.to }).unsetBold().run(); return 'Removed bold' }],
  [/^(un ?italic(ize|ise)?|remove italics?|not italic|no italics?)$/, (e, s) => { e.chain().focus().setTextSelection({ from: s.from, to: s.to }).unsetItalic().run(); return 'Removed italics' }],
  [/^(un ?underline|remove underline|no underline)$/, (e, s) => { e.chain().focus().setTextSelection({ from: s.from, to: s.to }).unsetUnderline().run(); return 'Removed the underline' }],
  [/^(un ?highlight|remove highlight(ing)?|no highlight)$/, (e, s) => { e.chain().focus().setTextSelection({ from: s.from, to: s.to }).unsetHighlight().run(); return 'Removed the highlight' }],
  [/^(heading|header|title|h) ?([1-6])( heading)?$|^(heading|header) level ([1-6])$|^h([1-6])$/, (e, _s, m) => { const level = Number(m[2] ?? m[5] ?? m[6]); e.chain().focus().setHeading({ level: level as 1 }).run(); return `Made it a heading ${level}` }],
  [/^(a |make a |into a |as a )?(heading|header|title)$/, (e) => { e.chain().focus().setHeading({ level: 2 }).run(); return 'Made it a heading' }],
  [/^(normal text|normal|paragraph|body( text)?|regular text|plain paragraph)$/, (e) => { e.chain().focus().setParagraph().run(); return 'Made it normal text' }],
  [/^(a )?(bullet(ed)?|unordered) ?(list|points?)?$|^bullets?$/, (e) => { if (!e.isActive('bulletList')) e.chain().focus().toggleBulletList().run(); return 'Made it a bullet list' }],
  [/^(a )?(numbered|ordered|number) ?(list|points?)?$|^numbering$/, (e) => { if (!e.isActive('orderedList')) e.chain().focus().toggleOrderedList().run(); return 'Made it a numbered list' }],
  [/^(a )?(check ?list|task list|to ?do list|to ?do|checkboxes?|tasks?)$/, (e) => { if (!e.isActive('taskList')) e.chain().focus().toggleTaskList().run(); return 'Made it a checklist' }],
  [/^(a )?(block ?quote|quote|quotation)$/, (e) => { if (!e.isActive('blockquote')) e.chain().focus().toggleBlockquote().run(); return 'Made it a quote' }],
  [/^(a )?(code ?block|block of code|code snippet)$/, (e) => { if (!e.isActive('codeBlock')) e.chain().focus().toggleCodeBlock().run(); return 'Made it a code block' }],
  [/^(a )?(callout|note box|info box|call ?out)$/, (e) => { e.chain().focus().setCallout('info').run(); return 'Made it a callout' }],
  [/^(align|aligned)? ?(to the )?(left|right|center|centre|centered|centred|middle|justif(y|ied)|full)( aligned)?$|^(left|right|center|centre|justify)$/, (e, _s, m) => {
    const w = (m[3] ?? m[7] ?? m[0]).replace(/ed$/, ''); const a = /right/.test(w) ? 'right' : /cent|mid/.test(w) ? 'center' : /just|full/.test(w) ? 'justify' : 'left'
    e.chain().focus().setTextAlign(a).run(); return `Aligned it ${a}`
  }],
  [/^(upper ?case|all caps|capital letters|capitali[sz]e all|shout|caps)$|^(in )?(all )?(upper ?case|caps)$/, (e, s) => (mapText(e, s, (t) => t.toUpperCase()) ? 'Made it UPPERCASE' : 'It was already uppercase')],
  [/^(lower ?case|all lower ?case|small letters|no caps)$|^(in )?lower ?case$/, (e, s) => (mapText(e, s, (t) => t.toLowerCase()) ? 'Made it lowercase' : 'It was already lowercase')],
  [/^(title case|capitali[sz]e( each word| words)?|capitali[sz]e)$/, (e, s) => (mapText(e, s, titleCase) ? 'Made it Title Case' : 'It was already in title case')],
  [/^(sentence case)$/, (e, s) => (mapText(e, s, sentenceCase) ? 'Made it sentence case' : 'It was already in sentence case')],
  [/^(a |insert a |add a |insert |add |create a |create |make a )?(horizontal (rule|line)|divider|separator|line break line|hr)$/, (e) => { e.chain().focus().setHorizontalRule().run(); return 'Added a divider' }],
  [/^(insert |add |create |make )?(a )?(table)( (with|of))? ?(\d+) ?(x|by|×|rows? (and|by) ) ?(\d+)( columns?)?$|^(insert |add |create |make )(a )?table$/, (e, _s, m) => {
    const r = Number(m[6] ?? 3), c = Number(m[9] ?? 3); e.chain().focus().insertTable({ rows: Math.min(r, 30), cols: Math.min(c, 12), withHeaderRow: true }).run(); return `Inserted a ${Math.min(r, 30)} by ${Math.min(c, 12)} table`
  }],
  [/^(insert |add |put in |type )?(today'?s |the |current )?(date|today'?s date|today)$/, (e) => { e.chain().focus().insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run(); return 'Inserted today’s date' }],
  [/^(insert |add |put in |type )?(the )?(current )?time$/, (e) => { e.chain().focus().insertContent(new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })).run(); return 'Inserted the time' }],
  [/^(delete|remove|erase) (this|the|that)?( current)? ?(paragraph|line|block|heading|row of text)$/, (e, s) => { const $f = e.state.doc.resolve(s.from); e.chain().focus().deleteRange({ from: $f.before(), to: $f.after() }).run(); return 'Deleted it' }],
  [/^undo( that| it)?$/, (e) => { e.chain().focus().undo().run(); return 'Undid the last change' }],
  [/^redo( that| it)?$/, (e) => { e.chain().focus().redo().run(); return 'Redid it' }],
]

export function runLocalCommand(editor: Editor, input: string): string | null {
  let t = clean(input).replace(LEAD, '')
  t = t.replace(/^(make|turn|change|convert|set|format|style|apply|switch)\s+/, '').replace(THIS, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(/^(into|to|as|be|become|in|with|the)\s+/g, '').replace(/^(a|an)\s+(?=(bold|italic|heading|header|title|bullet|number|check|task|block|code|call|quote))/, '').replace(/\s+(please|now|thanks|thank you)$/, '').trim()
  if (!t) return null
  const s = scopeOf(editor)
  for (const [re, name, said] of SET_MARKS) if (re.test(t)) {
    const c = editor.chain().focus().setTextSelection({ from: s.from, to: s.to }); const cmd = 'set' + name[0].toUpperCase() + name.slice(1)
    if (typeof (editor.commands as unknown as Record<string, unknown>)[cmd] === 'function') { (c as unknown as Record<string, () => typeof c>)[cmd]().run(); return said }
    c.toggleMark(name).run(); return said
  }
  const hl = /^(highlight( in| with)?|marker|mark)( ?(yellow|green|pink|blue|orange|purple|red|gray|grey))?$|^(yellow|green|pink|blue|orange|purple|red|gray|grey) (highlight|marker)$/.exec(t)
  if (hl) { const c = MARKERS[hl[4] ?? hl[5] ?? 'yellow']; editor.chain().focus().setTextSelection({ from: s.from, to: s.to }).setHighlight({ color: c }).run(); return 'Highlighted it' }
  const col = /^(?:(?:text |font )?colou?r(?: it| to)? )?(red|orange|yellow|green|teal|blue|purple|pink|gray|grey|black|white|brown)(?: text| font)?$|^(?:make (?:it )?)?(red|orange|yellow|green|teal|blue|purple|pink|gray|grey|black|white|brown)$/.exec(t)
  if (col) { const c = COLORS[col[1] ?? col[2]]; editor.chain().focus().setTextSelection({ from: s.from, to: s.to }).setColor(c).run(); return `Made the text ${col[1] ?? col[2]}` }
  for (const [re, run] of RULES) { const m = re.exec(t); if (m) return run(editor, s, m) }
  return null
}

export const COMMAND_EXAMPLES = ['Make this bold', 'Heading 2', 'Turn this into a bullet list', 'Align center', 'Highlight yellow', 'Make it red', 'Uppercase', 'Insert a 3x4 table']
