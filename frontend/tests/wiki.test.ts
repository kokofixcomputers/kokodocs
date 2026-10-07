import { badgeTone, build, emptySpec, interpolate, pretty, statusTone, toCurl, toFetch, toPython } from '../src/wiki/request'
import * as Y from 'yjs'
import { toMarkdown } from '../src/export/markdown'
import { diffDocs, wikiLines } from '../src/editor/diff'
import { ancestors, children, descendants, place, reading, type Tree } from '../src/wiki/tree'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }

ok('variables are filled in', interpolate('{{a}}/x/{{ b }}', { a: 'https://h', b: '2' }).text === 'https://h/x/2')
ok('missing variables are listed once and left in place', (() => { const r = interpolate('{{a}}{{a}}{{b}}', { b: '' }); return r.text === '{{a}}{{a}}{{b}}' && r.missing.join() === 'a,b' })())
ok('prototype names are not variables', interpolate('{{constructor}}', {}).missing[0] === 'constructor')

const spec = { ...emptySpec(), method: 'POST' as const, url: '{{base}}/users?x=1', query: [{ k: 'q', v: 'a b' }, { k: 'off', v: '1', off: true }, { k: '', v: 'nokey' }], headers: [{ k: 'Authorization', v: 'Bearer {{t}}' }], bodyType: 'json' as const, body: '{"n":"{{n}}"}' }
const b = build(spec, { base: 'https://api.test', t: 'S3', n: 'Ann' })
ok('query is appended after an existing query', b.url === 'https://api.test/users?x=1&q=a%20b', b.url)
ok('disabled and unnamed parameters are skipped', !b.url.includes('off') && !b.url.includes('nokey'))
ok('headers and body get their variables', b.headers.Authorization === 'Bearer S3' && b.body === '{"n":"Ann"}')
ok('json bodies get a content type', b.headers['Content-Type'] === 'application/json')
ok('a content type you set is kept', build({ ...spec, headers: [{ k: 'content-type', v: 'application/vnd.x+json' }] }, { base: 'https://a.b', n: '1' }).headers['Content-Type'] === undefined)
ok('no body is sent on GET', build({ ...spec, method: 'GET' }, { base: 'https://a.b', n: '1' }).body === undefined)
ok('unset variables give a helpful error', build(spec, {}).error?.includes('{{base}}') === true)
ok('invalid JSON is caught before sending', build({ ...spec, body: '{oops' }, { base: 'https://a.b', t: '1' }).error === 'The body isn’t valid JSON')
ok('a plain address works', build({ ...emptySpec(), url: 'https://x.io/a' }, {}).error === undefined)
ok('non web schemes are refused', build({ ...emptySpec(), url: 'file:///etc/passwd' }, {}).error !== undefined)

ok('curl quotes single quotes safely', toCurl(build({ ...emptySpec(), url: "https://x.io/a'b" }, {})).includes(`'https://x.io/a'\\''b'`))
ok('curl has method, header and body', (() => { const c = toCurl(b); return c.includes('-X POST') && c.includes("-H 'Authorization: Bearer S3'") && c.includes(`-d '{"n":"Ann"}'`) })())
ok('fetch snippet is valid-looking', toFetch(b).startsWith('const res = await fetch("https://api.test/users?x=1&q=a%20b", {') && toFetch(b).includes('method: "POST"'))
ok('python snippet uses the verb', toPython(b).includes('requests.post(') && toPython(build({ ...emptySpec(), url: 'https://x.io' }, {})).includes('requests.get("https://x.io")'))

ok('method badges have their own colour', badgeTone('GET') === 'get' && badgeTone('delete') === 'delete')
ok('meaningful words get a tone', badgeTone('Required') === 'danger' && badgeTone('Deprecated') === 'warn' && badgeTone('Beta') === 'info' && badgeTone('whatever') === 'neutral')
ok('status colours', statusTone(204) === 'ok' && statusTone(302) === 'info' && statusTone(404) === 'warn' && statusTone(503) === 'danger')
ok('json is pretty printed', pretty('{"a":1}', 'application/json') === '{\n  "a": 1\n}' && pretty('plain', 'text/plain') === 'plain')

const T: Tree = {
  a: { t: 'folder', title: 'Guides', parent: null, pos: 1 }, b: { t: 'page', title: 'Intro', parent: 'a', pos: 1 }, c: { t: 'page', title: 'Auth', parent: 'a', pos: 2 },
  d: { t: 'folder', title: 'Deep', parent: 'a', pos: 3 }, e: { t: 'page', title: 'Nested', parent: 'd', pos: 1 }, f: { t: 'page', title: 'Home', parent: null, pos: 0 },
}
ok('children are in order', children(T, null).join() === 'f,a' && children(T, 'a').join() === 'b,c,d')
ok('descendants include nested', descendants(T, 'a').sort().join() === 'b,c,d,e')
ok('ancestors from the top', ancestors(T, 'e').join() === 'a,d')
ok('reading order skips folders but enters them', reading(T).join() === 'f,b,c,e')
ok('placing before a sibling uses the midpoint', place(T, 'e', 'a', 'c')?.pos === 1.5)
ok('placing before the first sibling goes ahead of it', (place(T, 'e', 'a', 'b')?.pos ?? 9) < 1)
ok('placing last goes after everything', place(T, 'f', 'a', null)?.pos === 4)
ok('a folder cannot move into itself or its children', place(T, 'a', 'a', null) === null && place(T, 'a', 'd', null) === null)
ok('pages cannot hold other entries', place(T, 'f', 'b', null) === null)

// markdown the assistant reads and writes
const md = toMarkdown({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Needs ' }, { type: 'wikiBadge', attrs: { label: 'Required' } }, { type: 'text', text: ' auth' }] },
  { type: 'apiRequest', attrs: { method: 'POST', url: '{{baseUrl}}/x', query: [], headers: [{ k: 'A', v: 'b' }], body: '{"a":1}', bodyType: 'json', example: '', title: 'Make x' } },
] } as never)
ok('badges are written as [[badge:Label]]', md.includes('Needs [[badge:Required]] auth'), md)
ok('request blocks are written as a fenced api-request block holding JSON', (() => { const m = /```api-request\n([\s\S]*?)\n```/.exec(md); if (!m) return false; const j = JSON.parse(m[1]); return j.method === 'POST' && j.headers[0].k === 'A' && j.title === 'Make x' })(), md)

// version comparison of a whole wiki
const mk = (pages: Record<string, [string, string[]]>, extra?: (d: Y.Doc) => void) => {
  const d = new Y.Doc(), t = d.getMap('tree')
  Object.entries(pages).forEach(([id, [title, lines]], i) => {
    t.set(id, { t: 'page', title, parent: null, pos: i + 1 })
    const f = d.getXmlFragment('p:' + id)
    f.insert(0, lines.map((l) => { const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText(l)]); return p }))
  })
  extra?.(d); return d
}
const A = mk({ a: ['Intro', ['Hello world']], b: ['Auth', ['Use a token']] })
const B = mk({ a: ['Intro', ['Hello there']], b: ['Auth', ['Use a token']], c: ['Errors', ['Codes']] })
ok('a wiki flattens to a heading line per page', wikiLines(A).join('|') === '§ Intro|Hello world|§ Auth|Use a token', wikiLines(A).join('|'))
const df = diffDocs('wiki', A, B)
ok('adding a page and editing a line are both found', df.added === 2 && df.changed === 1 && !df.same, JSON.stringify([df.added, df.changed, df.removed]))
ok('the same wiki has no differences', diffDocs('wiki', A, mk({ a: ['Intro', ['Hello world']], b: ['Auth', ['Use a token']] })).same)
const tabsMd = toMarkdown({ type: 'doc', content: [{ type: 'wikiTabs', content: [
  { type: 'wikiTab', attrs: { title: 'cURL' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Run curl.' }] }] },
  { type: 'wikiTab', attrs: { title: 'Python' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use requests.' }] }] },
] }] } as never)
ok('tabs are written as :::tabs with a ::tab line per panel', tabsMd.startsWith(':::tabs\n::tab cURL\nRun curl.\n::tab Python\nUse requests.\n:::'), tabsMd)
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
