import { csvToMarkdown, notionId, notionMarkdown, planNotion, referencedImages, resolvePath, stripId, withoutTitle } from '../src/wiki/notion'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
const ID1 = 'a'.repeat(32), ID2 = 'b'.repeat(32), ID3 = 'c'.repeat(32), ID4 = 'd'.repeat(32), ID5 = 'e'.repeat(32)

ok('the id is taken off a name', stripId(`Getting started ${ID1}.md`) === 'Getting started' && notionId(`Getting started ${ID1}.md`) === ID1)
ok('names without an id are left alone', stripId('Plain.md') === 'Plain' && notionId('Plain.md') === null)
ok('relative paths are decoded and resolved', resolvePath('Docs abc/Sub def', '../img%20one.png') === 'Docs abc/img one.png' && resolvePath('', 'a/b.png') === 'a/b.png')
ok('the title line is removed from the body', withoutTitle('# Hello\n\nBody text') === 'Body text')

let n = 0; const nid = () => 'p' + ++n
const texts: Record<string, string> = {
  [`Export-1/Home ${ID1}.md`]: '# Home\n\nWelcome. See [the guide](Guides%20' + ID2 + '.md).',
  [`Export-1/Guides ${ID2}.md`]: '# Guides\n\nIntro to guides.',
  [`Export-1/Guides ${ID2}/Install ${ID3}.md`]: '# Install\n\nRun it.\n\n![diagram](Install%20' + ID3 + '/diagram.png)',
  [`Export-1/Guides ${ID2}/Empty parent ${ID5}.md`]: '# Empty parent\n',
  [`Export-1/Guides ${ID2}/Empty parent ${ID5}/Child.md`]: '# Child\n\nLeaf.',
  [`Export-1/Tasks ${ID4}.csv`]: 'Name,Status\nWrite docs,Done\nShip,"In, progress"\n',
  [`Export-1/Tasks ${ID4}/Write docs ${'f'.repeat(32)}.md`]: '# Write docs\n\nStatus: Done\nOwner: Maya\n\nDetails here.',
}
const others = [`Export-1/Guides ${ID2}/Install ${ID3}/diagram.png`, `Export-1/readme.txt`]
const plan = planNotion(texts, others, nid)
const by = (t: string) => plan.items.find((i) => i.title === t)!
ok('the wrapping folder of the export is dropped', plan.items.every((i) => !i.title.startsWith('Export')))
ok('a page with sub-pages becomes a folder holding its own page first', by('Guides').t === 'folder' && plan.items.some((i) => i.t === 'page' && i.title === 'Guides' && i.parent === by('Guides').id))
ok('sub-pages go inside', by('Install').parent === by('Guides').id && by('Install').t === 'page')
ok('a page with no text but children is just a folder', plan.items.filter((i) => i.title === 'Empty parent').length === 1 && by('Empty parent').t === 'folder' && by('Child').parent === by('Empty parent').id)
ok('a database folder holds its table and its rows', by('Tasks').t === 'folder' && plan.items.some((i) => i.t === 'page' && i.title === 'Tasks' && i.body?.includes('| Name | Status |')) && by('Write docs').parent === by('Tasks').id && by('Write docs').row === true)
ok('counts', plan.pages === 6 && plan.folders === 3 && plan.databases === 1, JSON.stringify([plan.pages, plan.folders, plan.databases]))
ok('the dropped wrapper is remembered so original paths can be found', plan.prefix === 'Export-1/')
ok('database tables are marked', plan.items.some((i) => i.title === 'Tasks' && i.t === 'page' && i.db === true) && !by('Install').db)
ok('only pictures are listed as assets', plan.assets.length === 1 && plan.assets[0].endsWith('diagram.png'))
ok('notion ids map to the new page', plan.idByNotion.get(ID2) !== undefined && plan.idByNotion.get(ID1) === by('Home').id)

const opts = (extra = {}) => ({ dir: `Guides ${ID2}`, image: (p: string) => (p.endsWith('diagram.png') ? '/api/images/x.png' : null), link: (id: string) => plan.idByNotion.get(id) ? `#${plan.idByNotion.get(id)}` : null, ...extra })
ok('pictures are pointed at their stored address', notionMarkdown(`![d](Install%20${ID3}/diagram.png)`, opts()).includes('![d](/api/images/x.png)'))
ok('pictures that could not be stored say so', notionMarkdown('![x](gone.png)', opts()).includes('picture not imported'))
ok('links between pages become internal links', notionMarkdown(`[g](Guides%20${ID2}.md)`, opts({ dir: '' })).includes(`[g](#${plan.idByNotion.get(ID2)})`))
ok('links to notion.so pages work too', notionMarkdown(`[g](https://www.notion.so/Guides-${ID2})`, opts()).includes(`#${plan.idByNotion.get(ID2)}`))
ok('web links are untouched', notionMarkdown('[a](https://example.com/x)', opts()) === '[a](https://example.com/x)')
ok('other files become plain text with a note', notionMarkdown('[Report](Report.pdf)', opts()).includes('Report *(attachment not imported)*'))
ok('callouts become callout blocks, with the kind from the emoji', notionMarkdown('<aside>\n💡 Remember this\n</aside>', opts()).startsWith('> [!tip]\n> Remember this') && notionMarkdown('<aside>\n⚠️ Careful\n</aside>', opts()).includes('[!warning]'))
ok('toggles keep their title and content', notionMarkdown('<details><summary>More</summary>\n\nHidden text\n</details>', opts()).includes('**More**') && notionMarkdown('<details><summary>More</summary>\n\nHidden text\n</details>', opts()).includes('Hidden text'))
ok('database row properties become a table', notionMarkdown('Status: Done\nOwner: Maya\n\nDetails.', opts({ row: true })).startsWith('| Property | Value |\n| --- | --- |\n| Status | Done |\n| Owner | Maya |'))
ok('ordinary pages do not get a property table', !notionMarkdown('Note: this is text\n\nMore.', opts()).includes('Property'))
ok('csv becomes a table, with quoted commas kept', csvToMarkdown('Name,Status\nShip,"In, progress"\n').includes('| Ship | In, progress |'))
ok('long tables are cut with a note', csvToMarkdown('a\n' + '1\n'.repeat(300), 50).includes('Showing the first 50 of 300 rows.'))
ok('pictures a page uses are found', referencedImages(`![a](Install%20${ID3}/diagram.png) ![b](https://x.io/y.png)`, `Guides ${ID2}`).join() === `Guides ${ID2}/Install ${ID3}/diagram.png`)
console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
