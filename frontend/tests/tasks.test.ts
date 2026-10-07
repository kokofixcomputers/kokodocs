import { Schema } from '@tiptap/pm/model'
import { parentFixes, progress } from '../src/editor/TaskItem'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
const schema = new Schema({
  nodes: {
    doc: { content: 'taskList+' }, text: { group: 'inline' }, paragraph: { content: 'text*', group: 'block' },
    taskList: { content: 'taskItem+' }, taskItem: { content: 'paragraph taskList?', attrs: { checked: { default: false } } },
  },
})
type T = [boolean, string, T[]?]
const item = (t: T): ReturnType<typeof schema.node> => schema.node('taskItem', { checked: t[0] }, [schema.node('paragraph', null, [schema.text(t[1])]), ...(t[2] ? [schema.node('taskList', null, t[2].map(item))] : [])])
const docOf = (ts: T[]) => schema.node('doc', null, [schema.node('taskList', null, ts.map(item))])

ok('a lone item is done or not', progress(item([true, 'a'])) === 'all' && progress(item([false, 'a'])) === 'none')
ok('some children done shows as partly done', progress(item([false, 'p', [[true, 'a'], [false, 'b']]])) === 'some')
ok('all children done is done', progress(item([false, 'p', [[true, 'a'], [true, 'b']]])) === 'all')
ok('no children done is not done', progress(item([false, 'p', [[false, 'a']]])) === 'none')
ok('partly done children make the parent partly done, through levels', progress(item([false, 'p', [[false, 'q', [[true, 'a'], [false, 'b']]]]])) === 'some')

ok('a correct document needs no fixes', parentFixes(docOf([[true, 'p', [[true, 'a'], [true, 'b']]], [false, 'q', [[true, 'a'], [false, 'b']]]])).length === 0)
let f = parentFixes(docOf([[false, 'p', [[true, 'a'], [true, 'b']]]]))
ok('ticking the last child ticks the parent', f.length === 1 && f[0].checked === true && f[0].pos === 1, JSON.stringify(f))
f = parentFixes(docOf([[true, 'p', [[true, 'a'], [false, 'b']]]]))
ok('unticking a child unticks the parent', f.length === 1 && f[0].checked === false, JSON.stringify(f))
f = parentFixes(docOf([[false, 'p', [[false, 'q', [[true, 'a']]], [true, 'b']]]]))
ok('it works through several levels, inner first', f.length === 2 && f.every((x) => x.checked === true), JSON.stringify(f))
ok('items without children are never changed', parentFixes(docOf([[true, 'a'], [false, 'b']])).length === 0)
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
