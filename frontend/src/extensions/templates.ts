/** Example extensions people can add with one click, and learn from. */
export interface Template { name: string; blurb: string; code: string }

const pine = (id: string, name: string, base: 'dark' | 'light', v: Record<string, string>) => `// ${name}: a colour theme. Pick it under Extensions → Themes.
koko.theme({
  id: '${id}', name: '${name}', base: '${base}',
  vars: {
${Object.entries(v).map(([k, x]) => `    '${k}': '${x}',`).join('\n')}
  },
})
`

export const TEMPLATES: Template[] = [
  { name: 'Rosé Pine', blurb: 'The soho vibes dark theme', code: pine('rose-pine', 'Rosé Pine', 'dark', {
    '--bg': '#191724', '--canvas': '#14121f', '--surface': '#1f1d2e', '--sheet': '#1f1d2e', '--ink': '#e0def4', '--muted': '#908caa', '--faint': '#6e6a86', '--line': '#403d52',
    '--accent': '#c4a7e7', '--accent-2': '#9ccfd8', '--accent-ink': '#191724', '--accent-soft': '#26233a', '--accent-soft-2': '#403d52', '--danger': '#eb6f92', '--danger-soft': '#3a1c2c', '--ok': '#9ccfd8',
    '--hover': 'rgba(224,222,244,.07)', '--link': '#9ccfd8' }) },
  { name: 'Rosé Pine Dawn', blurb: 'The light version', code: pine('rose-pine-dawn', 'Rosé Pine Dawn', 'light', {
    '--bg': '#faf4ed', '--canvas': '#f2e9e1', '--surface': '#fffaf3', '--sheet': '#fffaf3', '--ink': '#575279', '--muted': '#797593', '--faint': '#9893a5', '--line': '#dfdad9',
    '--accent': '#907aa9', '--accent-2': '#56949f', '--accent-ink': '#faf4ed', '--accent-soft': '#f2e9e1', '--accent-soft-2': '#dfdad9', '--danger': '#b4637a', '--danger-soft': '#f6e3e6', '--ok': '#286983',
    '--hover': 'rgba(87,82,121,.07)', '--link': '#286983' }) },
  { name: 'Dracula', blurb: 'A purple and pink dark theme', code: pine('dracula', 'Dracula', 'dark', {
    '--bg': '#282a36', '--canvas': '#21222c', '--surface': '#303241', '--sheet': '#303241', '--ink': '#f8f8f2', '--muted': '#a9afc8', '--faint': '#6272a4', '--line': '#44475a',
    '--accent': '#bd93f9', '--accent-2': '#8be9fd', '--accent-ink': '#282a36', '--accent-soft': '#3a3d50', '--accent-soft-2': '#44475a', '--danger': '#ff5555', '--danger-soft': '#42262c', '--ok': '#50fa7b',
    '--hover': 'rgba(248,248,242,.07)', '--link': '#8be9fd' }) },
  { name: 'Dice roller', blurb: 'Type /Roll a die to insert a random number', code: `// A slash command: it runs when you pick it and returns what to insert.
koko.slash({
  title: 'Roll a die',
  hint: 'Inserts a random number from 1 to 6',
  keys: 'dice random number',
  run() { return String(1 + Math.floor(Math.random() * 6)) },
})
` },
  { name: 'Word count line', blurb: 'Type /Word count to insert how long the document is', code: `// run() receives { text, date }: the document's text and today's date.
koko.slash({
  title: 'Word count',
  hint: 'Inserts a line with the number of words so far',
  keys: 'words length stats',
  run({ text }) {
    const n = (text.match(/\\S+/g) || []).length
    return '<p><em>' + n + ' words so far</em></p>'
  },
})
` },
  { name: 'Progress bar block', blurb: 'A new block type with a percentage you can edit', code: `// A block is stored in the document as { extension, block, data }.
// fields: what you can edit (click the block). render(data) returns HTML.
koko.block({
  id: 'progress',
  title: 'Progress bar',
  hint: 'A labelled bar from 0 to 100',
  defaults: { label: 'Progress', value: 40, color: '#4f46e5' },
  fields: [
    { key: 'label', label: 'Label' },
    { key: 'value', label: 'Percent (0-100)', type: 'number' },
    { key: 'color', label: 'Colour', type: 'color' },
  ],
  render(d) {
    const v = Math.max(0, Math.min(100, Number(d.value) || 0))
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    return '<div style="font:600 14px sans-serif;margin-bottom:6px">' + esc(d.label) + ' · ' + v + '%</div>' +
      '<div style="height:12px;border-radius:99px;background:rgba(128,128,128,.25);overflow:hidden">' +
      '<div style="height:100%;width:' + v + '%;background:' + esc(d.color) + '"></div></div>'
  },
})
` },
  { name: 'Wider page', blurb: 'Plain CSS tweaks to the whole app', code: `// koko.css() adds your own styles to the app.
koko.css(\`
  .sheet, .wiki-page { font-family: Georgia, serif; }
  .ProseMirror a { text-decoration: underline wavy; }
\`)
` },
]

export const BLANK = `// Your extension runs in a sandbox. It has no access to the page, your account or the internet.
// What it can do:
//   koko.theme({ id, name, base: 'dark' | 'light', vars: { '--bg': '#000', ... } })   a colour theme
//   koko.css('...')                                                                    extra styles
//   koko.slash({ title, hint, keys, run({ text, date }) { return 'text or <p>html</p>' } })   a "/" command
//   koko.block({ id, title, hint, defaults, fields, render(data) { return '<html>' } })       a new block type
//   koko.toast('message')
koko.slash({
  title: 'Say hello',
  run() { return 'Hello from my extension!' },
})
`
