import * as Y from 'yjs'
import { FormModel, paginate } from '../src/forms/model'
import { computeFlow } from '../src/forms/flow'
import { safeUrl, videoSource } from '../src/forms/media'
import { checkAll, checkItem, patternProblem } from '../src/forms/validate'

let pass = 0, fail = 0
const ok = (name: string, c: boolean) => { if (c) pass++; else { fail++; console.log('FAIL', name) } }

const m = new FormModel(new Y.Doc())
const a = m.add('short'), b = m.add('radio'), c = m.add('page'), d = m.add('number')
ok('order', m.read().map((i) => i.id).join() === [a, b, c, d].join())
m.update(a, { title: 'Name', required: true, minLen: 2 })
m.update(b, { options: ['x', 'y'], other: true })
ok('update merges', m.read()[0].title === 'Name' && m.read()[0].minLen === 2)
m.update(a, { minLen: undefined, required: false })
ok('undefined/false keys are dropped', !('minLen' in m.read()[0]) && !('required' in m.read()[0]))
m.move(d, -1); ok('move up', m.read().map((i) => i.id).join() === [a, b, d, c].join())
m.moveTo(c, a); ok('moveTo', m.read()[0].id === c)
const dup = m.duplicate(b)!; ok('duplicate', m.read().filter((i) => i.type === 'radio').length === 2 && dup !== b)
m.retype(b, 'checkbox'); ok('retype keeps options', m.read().find((i) => i.id === b)!.options?.join() === 'x,y')
m.retype(b, 'short'); ok('retype to text drops options', !m.read().find((i) => i.id === b)!.options)
m.remove(dup); ok('remove', !m.read().some((i) => i.id === dup))
const pages = paginate(m.read()); ok('pages split at page items', pages.length === 2 && pages[1].head?.type === 'page')
// collaboration: two peers converge
const d2 = new Y.Doc(); Y.applyUpdate(d2, Y.encodeStateAsUpdate(m.doc)); const m2 = new FormModel(d2)
m2.update(a, { title: 'Renamed' }); Y.applyUpdate(m.doc, Y.encodeStateAsUpdate(d2))
ok('peers converge', m.read().find((i) => i.id === a)!.title === 'Renamed')

const it = (o: object) => ({ id: 'q', type: 'short', title: 't', ...o }) as never
ok('required', checkItem(it({ required: true }), '') !== null && checkItem(it({}), '') === null)
ok('blank whitespace required', checkItem(it({ required: true }), '   ') !== null)
ok('min/max length', checkItem(it({ minLen: 3 }), 'ab') !== null && checkItem(it({ maxLen: 3 }), 'abcd') !== null && checkItem(it({ maxLen: 3 }), 'abc') === null)
ok('pattern + custom message', checkItem(it({ pattern: '^[A-Z]{3}$', patternMsg: 'Caps' }), 'abc') === 'Caps' && checkItem(it({ pattern: '^[A-Z]{3}$' }), 'ABC') === null)
ok('unsafe pattern ignored', checkItem(it({ pattern: '(a+)+$' }), 'aaaaaaaaaaaaaaaaaaaaaaaa!') === null)
ok('pattern problems reported', patternProblem('(') !== null && patternProblem('(a+)+') !== null && patternProblem('^a$') === null)
ok('number rules', checkItem(it({ type: 'number', min: 5 }), '4') !== null && checkItem(it({ type: 'number', max: 5 }), '6') !== null && checkItem(it({ type: 'number', integer: true }), '1.5') !== null && checkItem(it({ type: 'number' }), 'x') !== null && checkItem(it({ type: 'number', min: 0 }), '0') === null)
ok('email and link', checkItem(it({ type: 'email' }), 'bad') !== null && checkItem(it({ type: 'email' }), 'a@b.co') === null && checkItem(it({ type: 'url' }), 'ftp://x') !== null && checkItem(it({ type: 'url' }), 'https://x.io') === null)
ok('date bounds', checkItem(it({ type: 'date', min: '2020-01-01' }), '2019-12-31') !== null && checkItem(it({ type: 'date', max: '2020-01-01' }), '2020-01-02') !== null && checkItem(it({ type: 'date', min: '2020-01-01' }), '2020-01-01') === null)
ok('checkbox limits', checkItem(it({ type: 'checkbox', minSel: 2 }), ['a']) !== null && checkItem(it({ type: 'checkbox', maxSel: 1 }), ['a', 'b']) !== null && checkItem(it({ type: 'checkbox', maxSel: 2 }), ['a', 'b']) === null)
ok('colour answers must be a hex colour', checkItem(it({ type: 'color' }), '#1F6FEB') === null && checkItem(it({ type: 'color' }), 'blue') !== null && checkItem(it({ type: 'color' }), '#12345') !== null && checkItem(it({ type: 'color', required: true }), '') !== null)
ok('scale range', checkItem(it({ type: 'scale', scaleMin: 1, scaleMax: 5 }), '6') !== null && checkItem(it({ type: 'scale' }), '3') === null)
ok('checkAll skips text blocks', Object.keys(checkAll([it({ type: 'info', required: true }), it({ type: 'section', required: true }), it({ id: 'z', required: true })], {})).join() === 'z')

ok('safeUrl allows https, http and our uploads only', safeUrl('https://a.io/x.png') !== null && safeUrl('http://a.io') !== null && safeUrl('/api/images/' + 'a'.repeat(32) + '.png') !== null && safeUrl('javascript:alert(1)') === null && safeUrl('data:text/html,hi') === null && safeUrl('/etc/passwd') === null && safeUrl('') === null)
const yt = (u: string) => { const v = videoSource(u); return v && v.kind === 'iframe' ? v.src : null }
ok('youtube watch link', yt('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
ok('youtu.be, shorts, embed and mobile links', yt('https://youtu.be/dQw4w9WgXcQ') !== null && yt('https://youtube.com/shorts/dQw4w9WgXcQ') !== null && yt('https://www.youtube.com/embed/dQw4w9WgXcQ') !== null && yt('https://m.youtube.com/watch?v=dQw4w9WgXcQ') !== null)
ok('youtube start time', yt('https://youtu.be/dQw4w9WgXcQ?t=90') === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90')
ok('vimeo', yt('https://vimeo.com/123456789') === 'https://player.vimeo.com/video/123456789')
ok('direct files play natively', videoSource('https://cdn.io/a.mp4')?.kind === 'file' && videoSource('https://cdn.io/a.webm?x=1')?.kind === 'file')
ok('unknown or hostile hosts are not embedded', videoSource('https://evil.io/watch?v=dQw4w9WgXcQ') === null && videoSource('https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ') === null && videoSource('javascript:alert(1)') === null && yt('https://www.youtube.com/watch?v="><script>') === null)

// ── logic (the same cases run against the server in backend/tests/test_forms.py) ──
const Q = (id: string, type: string, o: object = {}) => ({ id, type, title: id, ...o }) as never
const vis = (items: never[], a: Record<string, string | string[]>) => [...computeFlow(items, a).visible].sort().join()
const path = (items: never[], a: Record<string, string | string[]>) => computeFlow(items, a).path.join()
const L1 = [Q('a', 'radio', { options: ['yes', 'no'] }), Q('b', 'short', { showIf: { match: 'all', rules: [{ q: 'a', op: 'is', v: 'yes' }] } })]
ok('showIf is', vis(L1, { a: 'yes' }) === 'a,b' && vis(L1, { a: 'no' }) === 'a' && vis(L1, {}) === 'a')
const L2 = [Q('a', 'checkbox', { options: ['x', 'y'] }), Q('b', 'short', { showIf: { match: 'all', rules: [{ q: 'a', op: 'is', v: 'y' }] } }), Q('c', 'short', { showIf: { match: 'all', rules: [{ q: 'b', op: 'filled' }] } })]
ok('checkbox is = includes; chains need visible sources', vis(L2, { a: ['x', 'y'], b: 'hi' }) === 'a,b,c' && vis(L2, { a: ['x'], b: 'hi' }) === 'a')
const L3 = [Q('n', 'number'), Q('b', 'short', { showIf: { match: 'any', rules: [{ q: 'n', op: 'gt', v: '10' }, { q: 'n', op: 'lt', v: '0' }] } })]
ok('numeric any-of', vis(L3, { n: '11' }) === 'b,n' && vis(L3, { n: '-1' }) === 'b,n' && vis(L3, { n: '5' }) === 'n' && vis(L3, { n: 'abc' }) === 'n')
const L4 = [Q('t', 'short'), Q('b', 'short', { showIf: { match: 'all', rules: [{ q: 't', op: 'contains', v: 'KO' }, { q: 't', op: 'isnot', v: 'koko' }] } })]
ok('contains is case-insensitive, isnot', vis(L4, { t: 'kokos' }) === 'b,t' && vis(L4, { t: 'koko' }) === 't')
ok('rules about deleted questions are ignored', vis([Q('b', 'short', { showIf: { match: 'all', rules: [{ q: 'gone', op: 'is', v: 'x' }] } })], {}) === 'b')
const P = [Q('a', 'radio', { options: ['one', 'two', 'end'], jumps: { two: 'p3', end: 'submit' } }), Q('p2', 'page'), Q('x', 'short'), Q('p3', 'page'), Q('y', 'short')]
ok('page order without jumps', path(P, { a: 'one' }) === '0,1,2' && path(P, {}) === '0,1,2')
ok('jump to a later page skips pages between', path(P, { a: 'two' }) === '0,2' && vis(P, { a: 'two' }) === 'a,y')
ok('jump to submit ends the form', path(P, { a: 'end' }) === '0' && vis(P, { a: 'end' }) === 'a')
const P2 = [Q('a', 'radio', { options: ['s'] }), Q('p2', 'page', { showIf: { match: 'all', rules: [{ q: 'a', op: 'is', v: 'zzz' }] } }), Q('x', 'short'), Q('p3', 'page'), Q('y', 'short')]
ok('a hidden page is skipped with its questions', path(P2, { a: 's' }) === '0,2' && vis(P2, { a: 's' }) === 'a,y')
ok('a page whose questions are all hidden is skipped', path([Q('a', 'radio', { options: ['s'] }), Q('p2', 'page'), Q('x', 'short', { showIf: { match: 'all', rules: [{ q: 'a', op: 'is', v: 'no' }] } }), Q('p3', 'page'), Q('y', 'short')], { a: 's' }) === '0,2')
ok('backward or missing jump targets are ignored', path([Q('a', 'radio', { options: ['s'], jumps: { s: 'gone' } }), Q('p2', 'page'), Q('x', 'short')], { a: 's' }) === '0,1')
ok('an answer hidden by a skipped page no longer drives later logic', vis([Q('a', 'radio', { options: ['s'], jumps: { s: 'p3' } }), Q('p2', 'page'), Q('x', 'short'), Q('p3', 'page'), Q('z', 'short', { showIf: { match: 'all', rules: [{ q: 'x', op: 'empty' }] } })], { a: 's', x: 'ignored' }) === 'a,z')

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
