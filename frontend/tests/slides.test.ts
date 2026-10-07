import * as Y from 'yjs'
import { SlidesModel } from '../src/slides/model'
import { createSlidesAdapter } from '../src/assistant/slideTools'
import { toOutline } from '../src/slides/slidesExport'
import { applyTableOp, chartData, num, toMatrix } from '../src/slides/matrix'
import { chartCells, themeById } from '../src/slides/themes'

let pass = 0, fail = 0
const ok = (name: string, c: boolean) => { if (c) pass++; else { fail++; console.log(`FAIL ${name}`) } }
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(exp)}`) } }
const has = (name: string, text: string, ...needles: string[]) => { const miss = needles.filter((n) => !text.includes(n)); if (!miss.length) pass++; else { fail++; console.log(`FAIL ${name}: missing ${JSON.stringify(miss)} in\n${text.slice(0, 500)}`) } }

const doc = new Y.Doc(); const m = new SlidesModel(doc)
m.ensureDeck()
eq('starts with one title slide', [m.ids().length, m.read()[0].els.filter((e) => e.role === 'title').length, m.read()[0].els.some((e) => e.role === 'sub')], [1, 1, true])
const s2 = m.addSlide('titleContent', 0, { title: 'Roadmap', body: 'Ship v1\nLaunch\nIterate' }, 'Say hello')
eq('add slide after first', m.ids()[1], s2); eq('title text', m.read()[1].els.find((e) => e.role === 'title')!.text, 'Roadmap'); eq('notes', m.read()[1].notes, 'Say hello')
const e = m.addEl(s2, { type: 'shape', shape: 'ellipse', x: 10, y: 20, w: 100, h: 100, fill: 'auto' })!
eq('shape added on top', m.read()[1].els.at(-1)!.id, e)
m.updateEl(s2, e, { x: 500 }); eq('update', m.read()[1].els.find((x) => x.id === e)!.x, 500)
m.reorder(s2, [e], 'back'); eq('send to back', m.read()[1].els[0].id, e)
m.reorder(s2, [e], 'front'); eq('bring to front', m.read()[1].els.at(-1)!.id, e)
const dup = m.duplicateEls(s2, [e]); eq('duplicate element', dup.length, 1)
const n0 = m.read()[1].els.length; m.deleteEls(s2, dup); eq('delete element', m.read()[1].els.length, n0 - 1)
const s3 = m.duplicateSlide(s2)!; eq('duplicate slide places after', m.ids(), ['s1', s2, s3])
m.moveSlide(s3, 0); eq('move slide', m.ids()[0], s3)
m.deleteSlide(s3); eq('delete slide', m.ids(), ['s1', s2])
m.undo.stopCapturing(); m.setMeta('theme', 'ocean'); eq('theme meta', m.theme, 'ocean')
// two clients converge (ensureDeck race, duplicate ids)
const a = new Y.Doc(), b = new Y.Doc(); const ma = new SlidesModel(a), mb = new SlidesModel(b)
ma.ensureDeck(); mb.ensureDeck()
Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
eq('concurrent first slide deduped on read', ma.ids(), ['s1']); ma.ensureDeck(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); eq('both sides agree', mb.ids(), ma.ids())
// restore
const snap = new Y.Doc(); Y.applyUpdate(snap, Y.encodeStateAsUpdate(doc))
m.addSlide('blank'); m.restoreFrom(snap); eq('restore returns the snapshot deck', m.ids(), ['s1', s2]); eq('restore keeps theme', m.theme, 'ocean')
// outline export
const out = toOutline(m.read(), 'Deck'); has('outline', out, '# Deck', '## 2. Roadmap', '- Ship v1', '> Notes: Say hello')

// assistant tools
let cur = 's1'
const ad = createSlidesAdapter({ model: m, getCur: () => cur, setCur: (id) => { cur = id }, getSel: () => [], getTitle: () => 'Deck', canEdit: () => true })
const T = (n: string) => ad.tools.find((t) => t.spec.function.name === n)!
const run = async (n: string, args: object) => String(await T(n).run(args))
has('read_deck', await run('read_deck', {}), 'Presentation “Deck”: 2 slides', 'Slide 2', '"Roadmap"', 'Notes: "Say hello"')
has('add_slide', await run('add_slide', { title: 'Wrap up', bullets: 'Thanks\nQuestions', notes: 'Smile', after: 'end' }), 'Added slide 3')
eq('assistant slide content', m.read()[2].els.filter((x) => x.type === 'text').map((x) => x.text), ['Wrap up', 'Thanks\nQuestions']); eq('moved cursor to new slide', cur, m.ids()[2])
const ti = m.read()[2].els.findIndex((x) => x.role === 'title') + 1
await run('set_text', { slide: 3, element: ti, text: 'The end' }); eq('set_text', m.read()[2].els[ti - 1].text, 'The end')
await run('set_notes', { slide: 3, notes: 'Bye' }); eq('set_notes', m.read()[2].notes, 'Bye')
await run('move_slide', { slide: 3, to: 1 }); eq('move_slide', m.read()[0].els.find((x) => x.role === 'title')!.text, 'The end')
await run('delete_slide', { slide: 1 }); eq('delete_slide', m.ids().length, 2)
await run('set_theme', { theme: 'paper' }); eq('set_theme', m.theme, 'paper')
let threw = ''; try { await run('set_text', { slide: 9, element: 1, text: 'x' }) } catch (e2) { threw = (e2 as Error).message }
has('bad slide gives a helpful error', threw, 'There is no slide 9')
// every layout builds, uses theme tokens only, and keeps elements on the slide
import { LAYOUTS, layoutElements, resolveColor, themeById } from '../src/slides/themes'
const content = { title: 'T', subtitle: 'S', bullets: 'a\nb', columns: [{ heading: 'H1', text: 'x' }, { heading: 'H2', text: 'y' }, { heading: 'H3', text: 'z' }], stats: [{ value: '82%', label: 'Up' }, { value: '3x', label: 'Faster' }, { value: '$4M', label: 'Saved' }], quote: 'Q', author: 'A', steps: [{ title: 's1', text: 't' }, { title: 's2' }, { title: 's3' }, { title: 's4' }, { title: 's5' }] }
for (const l of LAYOUTS) {
  const els = layoutElements(l.id, content)
  eq(`layout ${l.id} stays on the slide`, els.every((e) => e.x >= -300 && e.y >= -300 && e.x + e.w <= 1580 && e.y + e.h <= 1020 && e.w > 0 && e.h > 0), true)
}
eq('stats layout carries values', layoutElements('stats', content).filter((e) => e.role === 'stat').map((e) => e.text), ['82%', '3x', '$4M'])
eq('quote layout carries author', layoutElements('quote', content).some((e) => e.text === '\u2014 A'), true)
eq('steps capped at five', layoutElements('steps', content).filter((e) => e.shape === 'ellipse').length, 5)
eq('card token resolves to a hex', /^#[0-9a-f]{6}$/.test(resolveColor('card', themeById('mono'))), true)
has('assistant add_slide documents every layout', JSON.stringify(ad.tools.find((t) => t.spec.function.name === 'add_slide')!.spec), ...LAYOUTS.map((l) => l.id))

// tables and charts
{
  const doc2 = new Y.Doc(); const m2 = new SlidesModel(doc2); m2.ensureDeck()
  const sid = m2.ids()[0]
  const tid = m2.addEl(sid, { type: 'table', x: 80, y: 200, w: 800, h: 300, nr: 2, nc: 2, cells: { '0:0': 'A', '0:1': 'B' }, header: true })!
  m2.setCell(sid, tid, 1, 0, 'one'); m2.setCell(sid, tid, 1, 1, '2')
  const t = m2.read()[0].els.find((e) => e.id === tid)!
  eq('table cells stored', t.cells, { '0:0': 'A', '0:1': 'B', '1:0': 'one', '1:1': '2' })
  eq('table matrix', toMatrix(t), [['A', 'B'], ['one', '2']])
  m2.setCell(sid, tid, 1, 1, ''); eq('empty cell removed', m2.read()[0].els.find((e) => e.id === tid)!.cells?.['1:1'], undefined)
  eq('add row', applyTableOp(t, 'addRow', 0).nr, 3); eq('add column', applyTableOp(t, 'addCol', 0).nc, 3)
  eq('delete row keeps at least one', applyTableOp({ ...t, nr: 1 }, 'delRow', 0).nr, 1)
  eq('delete column shifts data', toMatrix({ ...t, ...applyTableOp(t, 'delCol', 0) }), [['B'], ['2']])
  const cid = m2.addEl(sid, { type: 'chart', chart: 'column', x: 0, y: 0, w: 600, h: 400, nr: 3, nc: 3, cells: chartCells(['Q1', 'Q2'], [{ name: 'Sales', values: [10, '20'] }, { name: 'Cost', values: [4, 5] }]) })!
  const ch = chartData(m2.read()[0].els.find((e) => e.id === cid)!)
  eq('chart data parsed', ch, { cats: ['Q1', 'Q2'], series: [{ name: 'Sales', values: [10, 20] }, { name: 'Cost', values: [4, 5] }] })
  eq('numbers tolerate symbols', num('$1,250.5'), 1250.5); eq('junk becomes zero', num('n/a'), 0)
  const dec = new Y.Doc(); Y.applyUpdate(dec, Y.encodeStateAsUpdate(doc2)); eq('table and chart sync to another client', new SlidesModel(dec).read()[0].els.filter((e) => e.type === 'table' || e.type === 'chart').length, 2)
  // an assistant can build both
  let cur2 = sid
  const ad2 = createSlidesAdapter({ model: m2, getCur: () => cur2, setCur: (i) => { cur2 = i }, getSel: () => [], getTitle: () => 'D', canEdit: () => true })
  const T2 = (n: string) => ad2.tools.find((x) => x.spec.function.name === n)!
  await T2('add_slide').run({ layout: 'table', title: 'Pricing', table: [['Plan', 'Price'], ['Free', '$0'], ['Team', '$8']] })
  const tab = m2.read().at(-1)!.els.find((e) => e.type === 'table')!; eq('add_slide table layout', toMatrix(tab), [['Plan', 'Price'], ['Free', '$0'], ['Team', '$8']])
  await T2('add_slide').run({ layout: 'chart', title: 'Growth', chart: { kind: 'line', categories: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Users', values: [100, 150, 240] }] } })
  const cc = m2.read().at(-1)!.els.find((e) => e.type === 'chart')!; eq('add_slide chart layout', [cc.chart, chartData(cc).series[0].values], ['line', [100, 150, 240]])
  has('read_deck describes tables and charts', String(await T2('read_deck').run({})), 'table 3x2', 'line chart', 'Users [Jan=100')
  await T2('set_table_cell').run({ slide: m2.ids().length - 1, element: m2.read().at(-2)!.els.findIndex((e) => e.type === 'table') + 1, row: 2, column: 2, text: '$1' })
  eq('set_table_cell', toMatrix(m2.read().at(-2)!.els.find((e) => e.type === 'table')!)[1][1], '$1')
  const o = toOutline(m2.read(), 'D'); has('outline includes table and chart', o, '| Plan | Price |', 'Chart “” (line)'.replace('“” ', ''), 'Jan: Users 100')
}

// deck-wide fonts
{
  const m = new SlidesModel(new Y.Doc()); m.ensureDeck()
  const base = m.deckTheme()
  ok('deck fonts default to the theme', m.headFont === undefined && base.head === themeById(m.theme).head)
  m.setDeckFont('head', 'Lobster'); m.setDeckFont('body', 'Lato')
  ok('deck fonts override the theme', m.deckTheme().head === 'Lobster' && m.deckTheme().body === 'Lato' && m.deckTheme().accent === base.accent)
  const other = new SlidesModel(new Y.Doc()); other.ensureDeck(); other.restoreFrom(m.doc)
  ok('restoring a version restores its fonts', other.deckTheme().head === 'Lobster')
  m.setDeckFont('head', null)
  ok('clearing a deck font returns to the theme', m.deckTheme().head === base.head && m.deckTheme().body === 'Lato')
  const clear = new SlidesModel(new Y.Doc()); clear.ensureDeck(); clear.restoreFrom(m.doc)
  ok('restoring a version without fonts clears them', clear.headFont === undefined)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
