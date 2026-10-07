import * as Y from 'yjs'
import { diffDocs, docLines, lcs, wordDiff } from '../src/editor/diff'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }

// lcs + word diff
ok('lcs identical', lcs(['a', 'b'], ['a', 'b']).every((o) => o.t === 'same'))
ok('lcs insert/delete', lcs(['a', 'b', 'c'], ['a', 'c', 'd']).map((o) => o.t).join() === 'same,del,same,add')
const wd = wordDiff('the quick brown fox', 'the slow brown fox jumps')
ok('word diff marks the changed words', wd.some((p) => p.t === 'del' && p.text.includes('quick')) && wd.some((p) => p.t === 'add' && p.text.includes('slow')) && wd.some((p) => p.t === 'add' && p.text.includes('jumps')))
ok('word diff reassembles both sides', wd.filter((p) => p.t !== 'add').map((p) => p.text).join('') === 'the quick brown fox' && wd.filter((p) => p.t !== 'del').map((p) => p.text).join('') === 'the slow brown fox jumps')

// documents
const mkDoc = (paras: string[]) => {
  const d = new Y.Doc(), f = d.getXmlFragment('default')
  paras.forEach((t, i) => {
    const el = new Y.XmlElement(i === 0 ? 'heading' : 'paragraph'); if (i === 0) el.setAttribute('level', '1' as never)
    const x = new Y.XmlText(); x.insert(0, t); el.insert(0, [x]); f.insert(f.length, [el])
  })
  return d
}
ok('document lines', docLines(mkDoc(['Title', 'one', 'two'])).join('|') === '# Title|one|two')
const a = mkDoc(['Title', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']), b = mkDoc(['Title', 'one', 'TWO', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])
const d1 = diffDocs('doc', a, b)
ok('doc diff counts', d1.changed === 1 && d1.added === 1 && d1.removed === 0 && !d1.same, JSON.stringify([d1.added, d1.removed, d1.changed]))
ok('long unchanged stretches fold into a gap', d1.rows.some((r) => r.kind === 'gap'))
ok('identical docs are the same', diffDocs('doc', a, mkDoc(['Title', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'])).same)
const d2 = diffDocs('doc', mkDoc(['T', 'x']), mkDoc(['T']))
ok('removed line', d2.removed === 1 && d2.rows.some((r) => r.kind === 'del'))

// spreadsheets
const mkSheet = (cells: Record<string, string>) => {
  const d = new Y.Doc(); d.getMap('tabs').set('t1', { id: 't1', name: 'Sheet1', order: 0 } as never)
  const m = d.getMap('cells:t1'); for (const [k, v] of Object.entries(cells)) m.set(k, { v } as never)
  return d
}
const s = diffDocs('sheet', mkSheet({ '0,0': 'Name', '0,1': '10', '1,0': 'Bob' }), mkSheet({ '0,0': 'Name', '0,1': '12', '2,0': 'Cy' }))
ok('sheet diff finds edit, add, remove', s.changed === 1 && s.added === 1 && s.removed === 1, JSON.stringify([s.added, s.removed, s.changed]))
ok('sheet labels use A1 addresses', s.rows.some((r) => 'label' in r && r.label === 'B1') && s.rows.some((r) => 'label' in r && r.label === 'A3'))

// presentations
const mkDeck = (texts: Record<string, string>) => {
  const d = new Y.Doc(); d.getArray('order').push(['s1'])
  const sl = new Y.Map<unknown>(); const els = new Y.Map<unknown>()
  for (const [id, t] of Object.entries(texts)) { const e = new Y.Map<unknown>(); e.set('type', 'text'); e.set('text', t); if (id === 'ti') e.set('role', 'title'); els.set(id, e) }
  sl.set('els', els); d.getMap('slides').set('s1', sl as never)
  return d
}
const sd = diffDocs('slides', mkDeck({ ti: 'Hello', b: 'old body' }), mkDeck({ ti: 'Hello', b: 'new body', c: 'extra' }))
ok('slides diff', sd.changed === 1 && sd.added === 1 && sd.removed === 0 && sd.rows.some((r) => 'label' in r && r.label === 'Slide 1 · text'), JSON.stringify([sd.added, sd.removed, sd.changed]))

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
