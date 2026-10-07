import { SHAPE_KINDS, cleanShape, shapeSpec, textOn, wrapText } from '../src/editor/shapes'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
const flat = (s: unknown): string => JSON.stringify(s)

ok('every shape draws something', SHAPE_KINDS.every((k) => /polygon|rect|ellipse|line/.test(flat(shapeSpec({ shape: k.id })))))
ok('the drawing is as big as the shape', (() => { const s = shapeSpec({ shape: 'rect', w: 200, h: 80 }) as unknown as [string, Record<string, string>]; return s[1].viewBox === '0 0 200 80' && s[1].width === '200' })())
ok('colours that are not hex are replaced, so nothing can be injected', cleanShape({ fill: 'url(javascript:alert(1))', stroke: '"><script>' }).fill === '#e0e7ff' && cleanShape({ stroke: 'red' }).stroke === '#6366f1')
ok('"none" is allowed for no fill', cleanShape({ fill: 'none' }).fill === 'none')
ok('sizes are kept within limits', cleanShape({ w: 5, h: 99999 }).w === 16 && cleanShape({ h: 99999 }).h === 1200 && cleanShape({ w: 'abc' }).w === 160)
ok('unknown shapes become a rectangle', cleanShape({ shape: 'evil' as never }).shape === 'rect')
ok('text is written into the drawing, wrapped on several lines when long', (() => { const j = flat(shapeSpec({ shape: 'rect', w: 120, h: 100, text: 'A fairly long label that must wrap' })); return j.includes('tspan') && (j.match(/tspan/g) ?? []).length >= 4 })())
ok('a line has no text or fill', !flat(shapeSpec({ shape: 'line', text: 'hello' })).includes('tspan') && flat(shapeSpec({ shape: 'line' })).includes('"fill":"none"'))
ok('dark fills get light text, light fills dark text', textOn('#111111') === '#ffffff' && textOn('#fde68a') === '#111111' && textOn('none') === '#111111')
ok('wrapping respects the width', wrapText('one two three four five six', 60, 14).length > 1 && wrapText('short', 300, 14).join('') === 'short')
ok('very long words are cut', wrapText('a'.repeat(100), 100, 14).every((l) => l.length <= 18))
ok('wrapping stops at six lines', wrapText('word '.repeat(80), 80, 14).length === 6)
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
