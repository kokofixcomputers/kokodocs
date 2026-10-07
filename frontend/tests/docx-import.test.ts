import JSZip from 'jszip'
import { DOMParser as XmlDom } from '@xmldom/xmldom'
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDom
import { docxToHtml } from '../src/import/docx'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
const run = (text: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (inner: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`
const listP = (text: string, numId: number, lvl: number) => para(run(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr>`)

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const docBody = [
  para(run('Quarterly report'), '<w:pStyle w:val="Heading1"/>'),
  para(run('Plain body text. ') + run('Big red bold', '<w:b/><w:color w:val="FF0000"/><w:sz w:val="36"/>') + run(' then ') + run('highlighted', '<w:highlight w:val="yellow"/>') + run(' and ') + run('Georgia', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>'), '<w:jc w:val="center"/>'),
  para(run('x', '<w:vertAlign w:val="superscript"/><w:i/><w:u w:val="single"/><w:strike/>') + run(' theme blue', '<w:color w:val="auto" w:themeColor="accent1"/>')),
  para('<w:hyperlink r:id="rId5">' + run('KokoDocs', '<w:rStyle w:val="Hyperlink"/>') + '</w:hyperlink>' + run(' and ') + '<w:hyperlink r:id="rId6">' + run('evil') + '</w:hyperlink>'),
  listP('First bullet', 1, 0), listP('Nested bullet', 1, 1), listP('Second bullet', 1, 0),
  listP('Step one', 2, 0), listP('Step two', 2, 0),
  para(run('after the lists')),
  `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>${para(run('Header spanning two', '<w:b/>'))}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${para(run('A'))}</w:tc><w:tc>${para(run('B'))}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${para('')}</w:tc><w:tc>${para(run('C', '<w:color w:val="00B050"/>'))}</w:tc></w:tr></w:tbl>`,
  para(`<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="1905000"/><wp:docPr id="1" name="p" descr="a pixel"/><a:graphic><a:graphicData><a:blip r:embed="rId7"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`),
  para(run('Hidden', '<w:vanish/>') + run('Shown in caps', '<w:caps/>')),
].join('')

const zip = new JSZip()
zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${docBody}</w:body></w:document>`)
zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`)
zip.file('word/theme/theme1.xml', `<a:theme ${W}><a:themeElements><a:clrScheme name="x"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme name="x"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`)
zip.file('word/numbering.xml', `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`)
zip.file('word/_rels/document.xml.rels', `<Relationships><Relationship Id="rId5" Type="x" Target="https://kokodocs.example/" TargetMode="External"/><Relationship Id="rId6" Type="x" Target="javascript:alert(1)" TargetMode="External"/><Relationship Id="rId7" Type="x" Target="media/image1.png"/></Relationships>`)
zip.file('word/media/image1.png', PNG)

import { writeFileSync } from 'node:fs'
if (process.env.WRITE_DOCX) writeFileSync(process.env.WRITE_DOCX, await zip.generateAsync({ type: 'uint8array' }))
const uploads: string[] = []
const { html, images } = await docxToHtml(await zip.generateAsync({ type: 'arraybuffer' }), async (f) => { uploads.push(f.name); return '/api/images/' + 'a'.repeat(32) + '.png' })

ok('heading from the style, with its colour but the editor\'s own size and weight', /<h1><span style="color: #2f5496; font-family: 'Carlito'">Quarterly report<\/span><\/h1>/.test(html), html.slice(0, 200))
ok('body text uses the document font (Calibri → Carlito) and 12pt', html.includes("<span style=\"font-size: 12pt; font-family: 'Carlito'\">Plain body text. </span>"), html)
ok('direct colour, size and bold', html.includes('color: #ff0000; font-size: 18pt') && /<strong>Big red bold<\/strong>/.test(html))
ok('highlight becomes a highlight mark', html.includes('<mark data-color="#ffff00" style="background-color: #ffff00">highlighted</mark>'))
ok('a font in the editor list is used as is', html.includes("font-family: 'Gelasio'") || html.includes("font-family: 'Georgia'"))
ok('paragraph alignment', html.includes('<p style="text-align: center">'))
ok('superscript, italic, underline, strike', /<sup>.*<\/sup>/.test(html) && html.includes('<em>') && html.includes('<u>') && html.includes('<s>'))
ok('theme colours resolve', html.includes('color: #4472c4'), html)
ok('links keep their address and drop Word\'s blue underline', html.includes('<a href="https://kokodocs.example/">') && !html.includes('0563c1') && !/<a [^>]*><[^>]*u>/.test(html))
ok('unsafe link targets are dropped but the text stays', !html.includes('javascript:') && html.includes('evil'))
ok('nested bullets', html.includes('<ul><li><p') && /<ul><li><p[^>]*>First bullet<\/p><ul><li><p[^>]*>Nested bullet<\/p><\/li><\/ul><\/li><li><p[^>]*>Second bullet<\/p><\/li><\/ul>/.test(html.replace(/<span[^>]*>|<\/span>/g, '')), html.replace(/<span[^>]*>|<\/span>/g, ''))
ok('numbered list is separate from the bullets', /<ol><li><p[^>]*>Step one<\/p><\/li><li><p[^>]*>Step two<\/p><\/li><\/ol>/.test(html.replace(/<span[^>]*>|<\/span>/g, '')))
ok('lists close before the next paragraph', html.indexOf('</ol>') < html.indexOf('after the lists'))
ok('table with column span, shading and a vertically merged cell', html.includes('colspan="2"') && html.includes('data-bg="#d9e2f3"') && html.includes('rowspan="2"') && (html.match(/<td/g) ?? []).length === 4, html.slice(html.indexOf('<table')))
ok('cell text colour', html.includes('#00b050'))
ok('pictures are uploaded and sized', uploads.length === 1 && images === 1 && /<img src="\/api\/images\/a{32}\.png" width="200" alt="a pixel">/.test(html), html.slice(-200))
ok('hidden text is dropped, caps applied', !html.includes('>Hidden<') && html.includes('SHOWN IN CAPS'))

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
