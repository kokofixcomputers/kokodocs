import type { Editor } from '@tiptap/core'
import type { ImportPlan } from '../import/pending'
import type { SheetModel, Style } from '../sheet/model'
import type { LayoutId, SlideContent } from '../slides/themes'

export type TemplateKind = 'doc' | 'sheet' | 'slides'
export interface Template {
  id: string; kind: TemplateKind; name: string; desc: string; category: string
  /** what the card draws */
  preview: { html?: string; rows?: string[][]; slide?: { layout: LayoutId; content: SlideContent; theme: string } }
  make: () => ImportPlan
}

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
const task = (items: string[]) => `<ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join('')}</ul>`
const table = (rows: string[][]) => `<table><tbody>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table>`

const docT = (id: string, name: string, desc: string, category: string, html: () => string, previewHtml: string): Template => ({
  id, kind: 'doc', name, desc, category, preview: { html: previewHtml },
  make: () => ({ kind: 'doc', title: name, apply: (ed: Editor) => { ed.chain().setContent(html(), true).run() } }),
})

const DOCS: Template[] = [
  docT('meeting', 'Meeting notes', 'Agenda, decisions and action items', 'Work', () => `<h1>Meeting notes</h1><p><strong>Date:</strong> ${today()}</p><p><strong>Attendees:</strong> </p><p><strong>Goal:</strong> </p><h2>Agenda</h2><ol><li><p>Topic one</p></li><li><p>Topic two</p></li></ol><h2>Notes</h2><p></p><h2>Decisions</h2><ul><li><p></p></li></ul><h2>Action items</h2>${task(['Owner: task, due date'])}`,
    '<h1>Meeting notes</h1><p><b>Date:</b> Today</p><h2>Agenda</h2><ol><li>Topic one</li><li>Topic two</li></ol><h2>Action items</h2><p>☐ Owner: task</p>'),
  docT('project', 'Project plan', 'Goals, timeline, risks and owners', 'Work', () => `<h1>Project plan</h1><div data-callout="info" data-title="Summary"><p>One or two sentences on what this project is and why it matters.</p></div><h2>Goals</h2><ul><li><p>Goal one</p></li><li><p>Goal two</p></li></ul><h2>Timeline</h2>${table([['Milestone', 'Owner', 'Due', 'Status'], ['Kickoff', '', '', 'Planned'], ['First draft', '', '', 'Planned'], ['Launch', '', '', 'Planned']])}<h2>Risks</h2><ul><li><p>What could go wrong, and what we will do about it</p></li></ul><h2>Next steps</h2>${task(['First step'])}`,
    '<h1>Project plan</h1><p>Summary box</p><h2>Goals</h2><ul><li>Goal one</li></ul><h2>Timeline</h2><table><tr><th>Milestone</th><th>Due</th></tr><tr><td>Kickoff</td><td></td></tr></table>'),
  docT('report', 'One-page report', 'Summary, findings and next steps', 'Work', () => `<h1>Report title</h1><p>${today()}</p><div data-callout="tip" data-title="Key takeaway"><p>The single most important thing a busy reader should know.</p></div><h2>Findings</h2><ul><li><p>Finding one, with a number if you have one</p></li><li><p>Finding two</p></li><li><p>Finding three</p></li></ul><h2>Details</h2><p>Explain the background, method and evidence here.</p><h2>Recommendations</h2><ol><li><p>Do this first</p></li><li><p>Then this</p></li></ol>`,
    '<h1>Report title</h1><p>Key takeaway box</p><h2>Findings</h2><ul><li>Finding one</li><li>Finding two</li></ul><h2>Recommendations</h2><ol><li>Do this first</li></ol>'),
  docT('todo', 'Weekly to-do list', 'A checklist for each day', 'Personal', () => `<h1>This week</h1>${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => `<h2>${d}</h2>${task(['', ''])}`).join('')}<h2>Weekend</h2>${task([''])}`,
    '<h1>This week</h1><h2>Monday</h2><p>☐ &nbsp;</p><p>☐ &nbsp;</p><h2>Tuesday</h2><p>☐ &nbsp;</p>'),
  docT('letter', 'Cover letter', 'A clean, professional letter', 'Personal', () => `<p><strong>Your name</strong><br>Your address · your email · your phone</p><p>${today()}</p><p>Hiring manager name<br>Company</p><p>Dear Hiring manager,</p><p>Open with the role you are applying for and one sentence on why you are excited about it.</p><p>In the middle, show two or three specific things you have done that match what they need, with results.</p><p>Close by thanking them and saying how you will follow up.</p><p>Sincerely,<br>Your name</p>`,
    '<p><b>Your name</b></p><p>Today</p><p>Dear Hiring manager,</p><p>Open with the role you are applying for…</p><p>Sincerely,</p>'),
  docT('study', 'Study notes', 'Cues on the left, notes on the right', 'School', () => `<h1>Topic</h1><p>Class · ${today()}</p>${table([['Questions and keywords', 'Notes'], ['', ''], ['', ''], ['', '']])}<h2>Summary</h2><p>Write a few sentences in your own words.</p>`,
    '<h1>Topic</h1><table><tr><th>Questions</th><th>Notes</th></tr><tr><td></td><td></td></tr></table><h2>Summary</h2>'),
]

// ───────── spreadsheets ─────────
type Row = (string | number)[]
const sheetT = (id: string, name: string, desc: string, category: string, rows: Row[], opts: { widths?: number[]; head?: number; bold?: [number, number][]; money?: [number, number, number, number]; total?: number[]; shown?: Record<string, string> } = {}): Template => ({
  id, kind: 'sheet', name, desc, category,
  // the card shows computed numbers, not formulas (the formula engine stays out of this file so the dashboard loads fast)
  preview: { rows: rows.slice(0, 7).map((r, ri) => r.slice(0, 5).map((v, ci) => opts.shown?.[`${ri}:${ci}`] ?? String(v))) },
  make: () => ({
    kind: 'sheet', title: name,
    apply: (m: SheetModel) => {
      m.ensureDefaultTab(); const sh = m.tabList()[0].id
      m.setTexts(sh, rows.flatMap((r, ri) => r.map((v, c) => ({ r: ri, c, text: String(v) })).filter((x) => x.text !== '')))
      const head: Partial<Style> = { b: 1, bg: '#111111', color: '#ffffff' }
      m.setStyle(sh, { r1: 0, c1: 0, r2: opts.head ?? 0, c2: Math.max(...rows.map((r) => r.length)) - 1 }, head)
      opts.bold?.forEach(([r, c]) => m.setStyle(sh, { r1: r, c1: c, r2: r, c2: c }, { b: 1 }))
      if (opts.money) { const [r1, c1, r2, c2] = opts.money; m.setStyle(sh, { r1, c1, r2, c2 }, { nf: '$#,##0.00' }) }
      opts.widths?.forEach((w, c) => m.setColWidth(sh, c, w))
    },
  }),
})
const SHEETS: Template[] = [
  sheetT('budget', 'Monthly budget', 'Income, spending and what is left', 'Personal', [
    ['Monthly budget', '', ''], ['', '', ''], ['Income', 'Planned', 'Actual'], ['Salary', 3000, 3000], ['Other', 200, 150], ['Total income', '=SUM(B4:B5)', '=SUM(C4:C5)'],
    ['', '', ''], ['Spending', 'Planned', 'Actual'], ['Rent', 1100, 1100], ['Groceries', 400, 430], ['Transport', 120, 95], ['Subscriptions', 60, 60], ['Fun', 150, 180], ['Total spending', '=SUM(B9:B13)', '=SUM(C9:C13)'],
    ['', '', ''], ['Left over', '=B6-B14', '=C6-C14'],
  ], { shown: { '5:1': '3200', '5:2': '3150' }, widths: [200, 120, 120], head: 0, money: [3, 1, 15, 2], bold: [[2, 0], [2, 1], [2, 2], [5, 0], [7, 0], [7, 1], [7, 2], [13, 0], [15, 0], [15, 1], [15, 2]] }),
  sheetT('tracker', 'Project tracker', 'Tasks, owners, status and due dates', 'Work', [
    ['Task', 'Owner', 'Status', 'Due', 'Notes'], ['Kickoff meeting', 'Sam', 'Done', '', ''], ['Write the brief', 'Alex', 'In progress', '', ''], ['Design review', 'Priya', 'Not started', '', ''], ['Build first version', 'Jonas', 'Not started', '', ''], ['Launch', '', 'Not started', '', ''],
  ], { widths: [220, 120, 130, 110, 260] }),
  sheetT('schedule', 'Weekly schedule', 'Hour by hour, Monday to Sunday', 'Personal', [
    ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ...['8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'].map((t) => [t, '', '', '', '', '', '', '']),
  ], { widths: [80, 110, 110, 110, 110, 110, 110, 110], bold: [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0]] }),
  sheetT('invoice', 'Invoice', 'Line items, tax and a total', 'Work', [
    ['INVOICE', '', '', ''], ['Bill to: ', '', 'Invoice #', '0001'], ['', '', 'Date', ''], ['', '', '', ''],
    ['Description', 'Qty', 'Unit price', 'Amount'], ['Design work', 10, 80, '=B6*C6'], ['Development', 20, 95, '=B7*C7'], ['', '', '', ''], ['', '', '', ''],
    ['', '', 'Subtotal', '=SUM(D6:D9)'], ['', '', 'Tax (10%)', '=D10*0.1'], ['', '', 'Total due', '=D10+D11'],
  ], { shown: { '5:3': '800', '6:3': '1900' }, widths: [260, 70, 120, 130], head: 4, money: [5, 2, 11, 3], bold: [[0, 0], [11, 2], [11, 3]] }),
  sheetT('grades', 'Grade book', 'Scores and automatic averages', 'School', [
    ['Student', 'Quiz 1', 'Quiz 2', 'Project', 'Exam', 'Average'], ['Ada', 92, 88, 95, 90, '=AVERAGE(B2:E2)'], ['Grace', 85, 91, 89, 94, '=AVERAGE(B3:E3)'], ['Linus', 78, 82, 90, 85, '=AVERAGE(B4:E4)'], ['Class average', '=AVERAGE(B2:B4)', '=AVERAGE(C2:C4)', '=AVERAGE(D2:D4)', '=AVERAGE(E2:E4)', '=AVERAGE(F2:F4)'],
  ], { shown: { '1:5': '91.25', '2:5': '89.75', '3:5': '83.75', '4:1': '85', '4:2': '87', '4:3': '91.33', '4:4': '89.67' }, widths: [160, 90, 90, 90, 90, 100], bold: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5]] }),
]

// ───────── presentations ─────────
type Spec = { layout: LayoutId; content?: SlideContent; notes?: string }
const deckT = (id: string, name: string, desc: string, category: string, theme: string, spec: Spec[]): Template => ({
  id, kind: 'slides', name, desc, category, preview: { slide: { layout: spec[0].layout, content: spec[0].content ?? {}, theme } },
  make: () => ({ kind: 'slides', title: name, apply: (m) => m.buildDeck(spec, theme) }),
})
const DECKS: Template[] = [
  deckT('pitch', 'Pitch deck', 'Problem, solution, traction and the ask', 'Work', 'ocean', [
    { layout: 'title', content: { title: 'Your company', subtitle: 'One sentence on what you do' }, notes: 'Open with the problem you saw, not the product.' },
    { layout: 'stat', content: { title: 'The problem', stats: [{ value: '68%', label: 'of people struggle with this' }], subtitle: 'Source: add your source' }, notes: 'Make the pain specific and measurable.' },
    { layout: 'cards', content: { title: 'Our solution', columns: [{ heading: 'Simple', text: 'Why it is easy to start.' }, { heading: 'Fast', text: 'Why it saves time.' }, { heading: 'Private', text: 'Why people can trust it.' }] } },
    { layout: 'steps', content: { title: 'How it works', steps: [{ title: 'Sign up', text: 'Takes a minute.' }, { title: 'Connect', text: 'Bring your data.' }, { title: 'Go', text: 'See results fast.' }] } },
    { layout: 'chart', content: { title: 'Traction', chart: { kind: 'column', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Users', values: [120, 340, 900, 2100] }] } }, notes: 'Replace with your real numbers.' },
    { layout: 'stats', content: { title: 'The market', stats: [{ value: '$4B', label: 'market size' }, { value: '12%', label: 'yearly growth' }, { value: '3', label: 'direct competitors' }] } },
    { layout: 'closing', content: { title: 'Let’s talk', subtitle: 'you@company.com' }, notes: 'State the ask clearly: amount, use of funds, timeline.' },
  ]),
  deckT('update', 'Weekly update', 'Wins, numbers, blockers and next week', 'Work', 'mono', [
    { layout: 'title', content: { title: 'Weekly update', subtitle: 'Week of ' + today() } },
    { layout: 'titleContent', content: { title: 'Wins this week', bullets: 'Shipped the thing\nClosed two customers\nFixed the slow page' } },
    { layout: 'stats', content: { title: 'By the numbers', stats: [{ value: '24', label: 'new signups' }, { value: '98%', label: 'uptime' }, { value: '4.7', label: 'support rating' }] } },
    { layout: 'twoColumn', content: { title: 'Blockers and next week', columns: [{ heading: 'Blocked on', text: 'Waiting on legal\nNeed design review' }, { heading: 'Next week', text: 'Launch the beta\nHire a designer' }] } },
    { layout: 'closing', content: { title: 'Questions?', subtitle: 'Reply in the thread' } },
  ]),
  deckT('class', 'Class presentation', 'Agenda, key ideas and a quote to remember', 'School', 'paper', [
    { layout: 'title', content: { title: 'Presentation title', subtitle: 'Your name · Class · Date' } },
    { layout: 'titleContent', content: { title: 'Agenda', bullets: 'Background\nMain ideas\nWhat it means\nQuestions' } },
    { layout: 'section', content: { title: 'Background', subtitle: 'PART ONE' } },
    { layout: 'cards', content: { title: 'Three main ideas', columns: [{ heading: 'Idea one', text: 'Explain it in a sentence.' }, { heading: 'Idea two', text: 'Explain it in a sentence.' }, { heading: 'Idea three', text: 'Explain it in a sentence.' }] } },
    { layout: 'quote', content: { quote: 'Add a quote that sums up your point.', author: 'Who said it' } },
    { layout: 'closing', content: { title: 'Thank you', subtitle: 'Questions?' } },
  ]),
]

export const TEMPLATES: Template[] = [...DECKS, ...DOCS, ...SHEETS]
export const FEATURED = ['pitch', 'meeting', 'budget']
export const CATEGORIES = ['All', 'Work', 'School', 'Personal']
export const KIND_LABEL: Record<TemplateKind, string> = { doc: 'Documents', sheet: 'Spreadsheets', slides: 'Presentations' }
