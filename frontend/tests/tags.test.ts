import { MAX_TAGS, cleanTags, tagHue } from '../src/ui/tags'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
// the same cases the server test (backend/tests/test_tags.py) uses: both sides must agree
ok('trims and collapses spaces', cleanTags(['  Work  ', '   spaced    out  ']).join('|') === 'Work|spaced out')
ok('duplicates are ignored regardless of case, keeping the first spelling', cleanTags(['Work', 'work', 'WORK']).join('|') === 'Work')
ok('commas split into separate words rather than staying in a tag', cleanTags(['a, b']).join('|') === 'a b')
ok('empty and blank tags vanish', cleanTags(['', '   ', ',']).length === 0)
ok('long tags are cut at 30 characters', cleanTags(['x'.repeat(80)])[0].length === 30)
ok('at most 12 tags', cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length === MAX_TAGS && MAX_TAGS === 12)
ok('a tag always gets the same colour, whatever its case', tagHue('Work') === tagHue('work') && tagHue('work') >= 0 && tagHue('work') < 360 && tagHue('work') !== tagHue('finance'))
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
