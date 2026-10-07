import { bundleEmoji, calloutIconCss, EXPORT_ASSET_CSS } from '../src/export/htmlAssets'
import { CALLOUT_ICONS } from '../src/export/calloutIcons'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
const asked: string[] = []
const svgFor = async (code: string) => { asked.push(code); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path id="p${code}" d="M0 0h36v36z"/></svg>` }

const html = '<p>Hi 😀 and 😀 again, a 👍🏽 and a flag 🇳🇴.</p><pre><code>code 🎉 stays text</code></pre><p>inline <code>x 🎉</code> too</p><p title="tip 🍕">attr</p><p>plain</p>'
const r = await bundleEmoji(html, svgFor)
ok('each used emoji is looked up once however often it appears', asked.length === new Set(asked).size && asked.includes('1f600') && asked.includes('1f44d-1f3fd') && asked.includes('1f1f3-1f1f4'), asked.join())
ok('emoji outside code become spans that keep the character', r.html.includes('<span class="emoji e-1f600">😀</span>') && (r.html.match(/e-1f600/g) ?? []).length === 2)
ok('skin tones and flags work', r.html.includes('e-1f44d-1f3fd') && r.html.includes('e-1f1f3-1f1f4'))
ok('emoji in code blocks and inline code are left alone', r.html.includes('code 🎉 stays text') && r.html.includes('<code>x 🎉</code>') && !asked.includes('1f389'))
ok('emoji inside tag attributes are left alone', r.html.includes('title="tip 🍕"') && !asked.includes('1f355'))
ok('one CSS rule per emoji used, with the artwork inlined once', (r.css.match(/\.e-/g) ?? []).length === 3 && r.css.includes('data:image/svg+xml,') && !r.css.includes('"<svg'), r.css.slice(0, 200))
ok('the artwork is URL-encoded so it can sit inside url("…")', !/url\("data:[^"]*"[^)]/.test(r.css))
ok('nothing used, nothing added', (await bundleEmoji('<p>no emoji here</p>', svgFor)).css === '')

const missing = await bundleEmoji('<p>ok 😀 and 😎</p>', async (c) => (c === '1f600' ? '<svg/>' : null))
ok('an emoji with no artwork stays as plain text', missing.html.includes('<span class="emoji e-1f600">😀</span>') && missing.html.includes(' and 😎') && !missing.html.includes('e-1f60e'))

// callout icons
const doc = '<div class="callout" data-callout="tip" data-title="Tip">x</div><div class="callout" data-callout="warning">y</div><div class="callout" data-callout="tip">z</div>'
const css = calloutIconCss(doc)
ok('only the callout kinds used get an icon', css.includes('data-callout=tip') && css.includes('data-callout=warning') && !css.includes('data-callout=danger') && !css.includes('data-callout=info') && !css.includes('.callout{--ci'), css.slice(0, 120))
ok('each kind is written once', (css.match(/data-callout=tip/g) ?? []).length === 1)
ok('note is the default icon', calloutIconCss('<div class="callout" data-callout="note">x</div>').startsWith('.callout{--ci:') && calloutIconCss('<div class="callout" data-callout="weird">x</div>').startsWith('.callout{--ci:'))
ok('custom callouts get the palette icon', calloutIconCss('<div class="callout" data-callout="custom" style="--cb:#123456">x</div>').includes('data-callout=custom'))
ok('no callouts, no icon CSS', calloutIconCss('<p>hi</p>') === '')
ok('every callout kind has an icon', ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger', 'custom'].every((k) => CALLOUT_ICONS[k]?.startsWith('url("data:image/svg+xml')))
ok('the shared rules draw the icon from the kind colour', EXPORT_ASSET_CSS.includes('var(--ci)') && EXPORT_ASSET_CSS.includes('var(--cc)'))

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
