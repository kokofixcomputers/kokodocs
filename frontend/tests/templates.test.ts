import * as Y from 'yjs'
import { SheetModel } from '../src/sheet/model'
import { SlidesModel } from '../src/slides/model'
import { FEATURED, TEMPLATES } from '../src/templates/catalog'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`) } }

ok('templates have unique ids', new Set(TEMPLATES.map((t) => t.id)).size === TEMPLATES.length)
ok('featured templates exist', FEATURED.every((id) => TEMPLATES.some((t) => t.id === id)))
ok('every kind has templates', (['doc', 'sheet', 'slides'] as const).every((k) => TEMPLATES.some((t) => t.kind === k)))
for (const t of TEMPLATES) {
  const plan = t.make()
  ok(`${t.id}: plan matches kind and has a title`, plan.kind === t.kind && !!plan.title)
  if (plan.kind === 'sheet') {
    const m = new SheetModel(new Y.Doc()); plan.apply(m)
    const sh = m.tabList()[0].id, u = m.used(sh)
    ok(`${t.id}: sheet filled`, u.rows >= 3 && u.cols >= 3, JSON.stringify(u))
    let errors = 0; for (let r = 0; r < u.rows; r++) for (let c = 0; c < u.cols; c++) if (/^#/.test(m.display(sh, r, c).text)) errors++
    ok(`${t.id}: no formula errors`, errors === 0, String(errors))
  } else if (plan.kind === 'slides') {
    const m = new SlidesModel(new Y.Doc()); plan.apply(m)
    const s = m.read()
    ok(`${t.id}: deck has slides`, s.length >= 4); ok(`${t.id}: every slide has a title or element`, s.every((x) => x.els.length > 0))
    ok(`${t.id}: layouts vary`, new Set(s.map((x) => x.els.map((e) => e.role ?? e.type).join())).size >= 3)
  } else {
    ok(`${t.id}: doc preview html`, (t.preview.html ?? '').length > 40)
  }
}
const budget = new SheetModel(new Y.Doc()); TEMPLATES.find((t) => t.id === 'budget')!.make().kind === 'sheet' && (TEMPLATES.find((t) => t.id === 'budget')!.make() as never as { apply: (m: SheetModel) => void }).apply(budget)
const bs = budget.tabList()[0].id
ok('budget totals compute', budget.display(bs, 5, 1).text.replace(/[^0-9.]/g, '') === '3200' || budget.display(bs, 5, 1).v === 3200, budget.display(bs, 5, 1).text)
ok('budget left over computes', budget.display(bs, 15, 1).v === 1370, String(budget.display(bs, 15, 1).v))
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
