import { writeFileSync } from 'node:fs'
import { Packer } from 'docx'
import { buildDocx } from '../src/export/docx'
import { toMarkdown, toPlainText } from '../src/export/markdown'
import type { PMNode } from '../src/export/util'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(exp)}`) } }
const T = (text: string, marks: PMNode['marks'] = []): PMNode => ({ type: 'text', text, marks })
const P = (...c: PMNode[]): PMNode => ({ type: 'paragraph', content: c })
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

export const sample: PMNode = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [T('Project Plan')] },
  P(T('Some '), T('bold', [{ type: 'bold' }]), T(', '), T('italic', [{ type: 'italic' }]), T(', '), T('both', [{ type: 'bold' }, { type: 'italic' }]), T(' and a '), T('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]), T('.')),
  P(T('Colored', [{ type: 'textStyle', attrs: { color: '#ff0000', fontFamily: 'Lexend', fontSize: 14 } }]), T(' and '), T('highlight', [{ type: 'highlight', attrs: { color: '#fde047' } }]), T(' and '), T('struck', [{ type: 'strike' }]), T(' x'), T('2', [{ type: 'superscript' }]), T(' a * star _ under [br]')),
  { type: 'heading', attrs: { level: 2 }, content: [T('Lists')] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [P(T('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [P(T('nested'))] }] }] }, { type: 'listItem', content: [P(T('two'))] }] },
  { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [P(T('third'))] }, { type: 'listItem', content: [P(T('fourth'))] }] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [P(T('done'))] }, { type: 'taskItem', attrs: { checked: false }, content: [P(T('todo'))] }] },
  { type: 'blockquote', content: [P(T('quoted text'))] },
  { type: 'codeBlock', content: [T('let x = 1\nconsole.log(x)')] },
  { type: 'horizontalRule' },
  { type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [P(T('Item'))] }, { type: 'tableHeader', content: [P(T('Cost'))] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [P(T('Design'))] }, { type: 'tableCell', attrs: { backgroundColor: '#fde047' }, content: [P(T('$400 | est'))] }] },
  ] },
  P({ type: 'image', attrs: { src: '/api/images/x.png', alt: 'pixel', width: 120 } }),
  P(T('line one'), { type: 'hardBreak' }, T('line two')),
] }

const md = toMarkdown(sample)
eq('md heading', md.startsWith('# Project Plan\n\n'), true)
eq('md marks', md.includes('Some **bold**, *italic*, ***both*** and a [link](https://example.com).'), true)
eq('md escapes & extras', md.includes('~~struck~~ x<sup>2</sup> a \\* star \\_ under \\[br\\]'), true)
eq('md nested list', md.includes('- one\n  - nested\n- two'), true)
eq('md ordered start', md.includes('3. third\n4. fourth'), true)
eq('md tasks', md.includes('- [x] done\n- [ ] todo'), true)
eq('md quote/code/hr', md.includes('> quoted text') && md.includes('```\nlet x = 1\nconsole.log(x)\n```') && md.includes('\n---\n'), true)
eq('md table', md.includes('| Item | Cost |\n| --- | --- |\n| Design | $400 \\| est |'), true)
eq('md image + break', md.includes('![pixel](/api/images/x.png)') && md.includes('line one  \nline two'), true)
const txt = toPlainText(sample)
if (process.env.SHOW) console.log(JSON.stringify(txt))
eq('txt basics', txt.startsWith('Project Plan\n\nSome bold, italic, both and a link.') && txt.includes('- one\n  - nested') && txt.includes('3. third') && txt.includes('[x] done') && txt.includes('Design\t$400 | est'), true)

const doc = await buildDocx(sample, { title: 'Project Plan', meta: { header: 'Confidential', footer: 'Page {page} of {pages}', headerAlign: 'right', footerAlign: 'center' }, loadImage: async () => ({ data: png, type: 'png', width: 1, height: 1 }) })
const buf = await Packer.toBuffer(doc)
writeFileSync('/tmp/koko-sample.docx', buf)
eq('docx is a zip', [buf[0], buf[1]], [0x50, 0x4b])
console.log(`${pass} passed, ${fail} failed`)
