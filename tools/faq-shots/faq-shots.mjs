/** Captures the screenshots on the FAQ page (frontend/public/shots/faq-*.jpg and faq-*-dark.jpg) from a freshly seeded local KokoDocs.
 *  Needs the built frontend (cd frontend && npm run build), Python deps for the backend, and a Chromium-based browser (BROWSER=/path/to/it).
 *  Run:  cd tools/faq-shots && npm i && node faq-shots.mjs [name ...]      (with names, only those are retaken) */
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = process.env.OUT || path.join(ROOT, 'frontend/public/shots')
const BROWSER = process.env.BROWSER || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const BASE = 'http://127.0.0.1:8000'
const only = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

execSync(`cd ${ROOT}/backend; pkill -f "uvicorn app.main"; sleep 1; rm -rf data; (nohup .venv/bin/python -m uvicorn app.main:app --port 8000 >/tmp/koko-shots.log 2>&1 &); sleep 4`, { shell: '/bin/zsh' })
const api = async (m, p, b, t) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json().catch(() => null)] }
const signup = async (name, email) => (await api('POST', '/api/auth/signup', { email, name, password: 'password123' }))[1].token

// ── people and files ──
const M = await signup('Maya Chen', 'maya@acme.io'), P = await signup('Priya Nair', 'priya@acme.io'), S = await signup('Sam Ortiz', 'sam@acme.io')
const mk = async (tok, title, kind = 'doc', folder) => (await api('POST', '/api/docs', { title, kind, folder_id: folder }, tok))[1].id
const folderId = (await api('POST', '/api/folders', { name: 'Launch 2026' }, M))[1].id
await api('POST', '/api/folders', { name: 'Brand' }, M)
await api('POST', '/api/folders', { name: 'Finance' }, M)
const plan = await mk(M, 'Q3 launch plan', 'doc', folderId)
const checklist = await mk(M, 'Launch checklist', 'doc', folderId)
const budget = await mk(M, 'Launch budget', 'sheet', folderId)
const wiki = await mk(M, 'Team handbook', 'wiki')
await mk(M, 'Meeting notes', 'doc'); await mk(M, 'Customer feedback', 'form')

const PLAN_HTML = `<h1>Q3 launch plan</h1><p>Our goal is to ship the new onboarding flow to every customer by the end of September, with support and sales ready on day one.</p>
<h2>Milestones</h2><ul><li>Beta with ten design partners, August 12</li><li>Pricing page and help articles live, September 2</li><li>General availability, September 23</li></ul>
<h2>Owners</h2><table><tbody><tr><th>Area</th><th>Owner</th><th>Status</th></tr><tr><td>Product</td><td>Maya Chen</td><td>On track</td></tr><tr><td>Engineering</td><td>Sam Ortiz</td><td>On track</td></tr><tr><td>Support</td><td>Priya Nair</td><td>Needs docs</td></tr></tbody></table>
<h2>Risks</h2><p>The biggest risk is the data migration for older accounts. We will run it twice on a copy before the real day, and keep the old flow switchable for a week.</p>`

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new', args: ['--no-sandbox'] })
async function page(tok, theme, w = 1440, h = 900) {
  const p = await browser.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1.5 })
  await p.goto(BASE + '/login'); await p.evaluate((t, th) => { localStorage.setItem('koko.token', t); localStorage.setItem('koko.theme', th) }, tok, theme)
  return p
}
const go = async (p, url, wait = 3200) => { await p.goto(BASE + url); await sleep(wait) }
const editor = (p, fn, ...a) => p.evaluate(fn, ...a)
const click = (p, text, sel = 'button') => p.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find((x) => x.innerText.trim() === t || x.getAttribute('aria-label') === t); if (!b) throw new Error('no ' + t); b.click() }, text, sel)

// fill the plan once (it saves to the server)
{
  const p = await page(M, 'light'); await go(p, '/d/' + plan)
  await editor(p, (h) => { const e = document.querySelector('.ProseMirror').editor; e.commands.setContent(h) }, PLAN_HTML); await sleep(2500)
  for (const [label, extra] of [['First draft', ''], ['Added the risks section', '<p>Draft v2.</p>'], ['Shared with the team', '']]) {
    await api('POST', `/api/docs/${plan}/versions`, { label }, M); await sleep(300)
  }
  await p.close()
}
// a sheet from a CSV
{
  const p = await page(M, 'light'); await go(p, '/d/' + budget)
  const csv = 'Item,Q3 plan,Actual,Owner\nAds,12000,11450,Priya\nEvents,8000,9200,Maya\nTools,3500,3310,Sam\nContractors,15000,14100,Sam\nTravel,6000,4890,Maya\n'
  const fs = await import('node:fs'); fs.writeFileSync('/tmp/budget.csv', csv)
  const input = await p.$('input[type=file]'); await input.uploadFile('/tmp/budget.csv'); await sleep(2500)
  await p.close()
}

const shots = {}
const add = (name, fn) => { shots[name] = fn }
const bars = (preset) => api('PUT', '/api/me/prefs/bars', { value: { same: true, desktop: { preset, toolbar: [], header: [] }, mobile: { preset: 'essential', toolbar: [], header: [] } } }, M)
const openSettings = async (p, section) => {
  await p.click('.avatar-btn'); await sleep(300)
  await p.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'Settings').click()); await sleep(700)
  await p.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(t))?.click(), section); await sleep(900)
}

// share the plan with two people, and the folder with one
await api('PUT', `/api/docs/${plan}/sharing`, { link_access: 'restricted', link_role: 'viewer', shares: [{ email: 'priya@acme.io', role: 'editor' }, { email: 'sam@acme.io', role: 'viewer' }] }, M)
await api('PUT', `/api/folders/${folderId}/sharing`, { link_access: 'restricted', link_role: 'viewer', shares: [{ email: 'priya@acme.io', role: 'editor' }] }, M)

add('faq-dashboard', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/')
  await p.evaluate(() => { const h = [...document.querySelectorAll('*')].find((e) => e.children.length < 4 && e.textContent.trim() === 'My documents' && e.getBoundingClientRect().height > 10); h?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110) }); await sleep(500)
  return p
})
add('faq-share-file', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + plan)
  await click(p, 'Share'); await sleep(900); return p
})
add('faq-share-folder', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/')
  await p.evaluate(() => document.querySelector('.doc-row.head')?.scrollIntoView({ block: 'start' })); await sleep(300)
  await click(p, 'Share Launch 2026'); await sleep(900); return p
})
add('faq-link-expiry', async (theme) => {
  await bars('standard')
  await api('PUT', `/api/docs/${checklist}/sharing`, { link_access: 'anyone', link_role: 'viewer', expires: '7d', shares: [] }, M)
  const p = await page(M, theme); await go(p, '/d/' + checklist)
  await click(p, 'Share'); await sleep(900)
  await p.evaluate(() => document.querySelector('[aria-label="Link expiry"]')?.click()); await sleep(500); return p
})
add('faq-request-access', async (theme) => {
  await bars('standard')
  const p = await page(S, theme); await go(p, '/d/' + plan)
  await click(p, 'Request edit access'); await sleep(600)
  await p.type('.modal textarea', 'Hi Maya, could I edit this? I want to add the support milestones.'); await sleep(300); return p
})
add('faq-history', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + plan)
  await click(p, 'Version history'); await sleep(1500); return p
})
add('faq-compare', async (theme) => {
  await bars('everything')
  const p = await page(M, theme); await go(p, '/d/' + plan)
  await editor(p, () => { const e = document.querySelector('.ProseMirror').editor; e.commands.setContent(e.getHTML().replace('September 23', 'September 30').replace('ten design partners', 'twelve design partners')) }); await sleep(1500)
  await click(p, 'Compare'); await sleep(2500); return p
})
add('faq-insights', async (theme) => {
  await bars('everything')
  const p = await page(M, theme); await go(p, '/d/' + plan)
  await click(p, 'Insights'); await sleep(1800); return p
})
add('faq-equation', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + checklist)
  await editor(p, () => { const e = document.querySelector('.ProseMirror').editor; e.commands.setContent('<h1>Growth model</h1><p>New accounts grow with a compounding rate each month. The roots of the quadratic below tell us when growth turns positive.</p>'); e.commands.insertContentAt(e.state.doc.content.size, { type: 'mathBlock', attrs: { latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' } }) }); await sleep(2500)
  await p.click('.math-block'); await sleep(1200); return p
})
add('faq-toolbar', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + plan); await openSettings(p, 'Toolbar'); return p
})
add('faq-hide-columns', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + budget)
  const box = (txt) => p.evaluate((t) => { const e = [...document.querySelectorAll('.sg-ch')].find((x) => x.textContent.trim() === t).getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 } }, txt)
  const b = await box('B'), c = await box('C')
  await p.mouse.click(b.x, b.y); await p.keyboard.down('Shift'); await p.mouse.click(c.x, c.y); await p.keyboard.up('Shift')
  await p.mouse.click(c.x, c.y, { button: 'right' }); await sleep(700); return p
})
add('faq-extensions', async (theme) => {
  await bars('standard')
  const code = {
    rose: `koko.theme({ id: 'rose-pine', name: 'Rosé Pine', base: 'dark', vars: { '--bg': '#191724', '--surface': '#1f1d2e', '--ink': '#e0def4', '--accent': '#c4a7e7', '--accent-ink': '#191724', '--line': '#403d52', '--accent-soft': '#26233a', '--muted': '#908caa' } })`,
    dice: `koko.slash({ title: 'Roll a die', hint: 'Inserts a random number from 1 to 6', run() { return String(1 + Math.floor(Math.random() * 6)) } })`,
    bar: `koko.block({ id: 'progress', title: 'Progress bar', defaults: { value: 40 }, fields: [{ key: 'value', label: 'Percent', type: 'number' }], render(d) { return '<div style="height:12px;border-radius:9px;background:#8883"><div style="height:100%;width:' + d.value + '%;background:#6366f1;border-radius:9px"></div></div>' } })`,
  }
  await api('PUT', '/api/me/prefs/extensions', { value: { items: [{ id: 'a1', name: 'Rosé Pine', enabled: true, code: code.rose }, { id: 'a2', name: 'Dice roller', enabled: true, code: code.dice }, { id: 'a3', name: 'Progress bar block', enabled: true, code: code.bar }], theme: '' } }, M)
  const p = await page(M, theme); await go(p, '/d/' + plan); await openSettings(p, 'Extensions'); await sleep(800); return p
})
add('faq-export', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + plan)
  await p.evaluate(() => document.querySelector('[aria-label="Download as"]')?.click()); await sleep(700); return p
})
add('faq-wiki-links', async (theme) => {
  await bars('standard')
  const p = await page(M, theme); await go(p, '/d/' + wiki)
  if (theme === 'light') {   // build the pages once (they save to the server)
    const set = (h) => p.evaluate((x) => document.querySelector('.wiki-page .ProseMirror').editor.commands.setContent(x), h)
    await p.waitForSelector('.wiki-page .ProseMirror'); await sleep(800)
    await set('<p>Welcome to the team handbook. Start with Onboarding, then read how we run the Support rotation.</p>'); await sleep(900)
    for (const t of ['Onboarding', 'Support rotation', 'Tools we use']) { await p.click('button[aria-label="New page"]'); await sleep(900); await p.keyboard.type(t); await sleep(300); await set(`<p>${t}: what you need to know in your first week, with examples.</p>`); await sleep(900) }
  }
  await sleep(500)
  await p.evaluate(() => { location.hash = '' }); await sleep(800)
  await p.evaluate(() => { const e = document.querySelector('.wiki-page .ProseMirror').editor; e.commands.focus(); e.commands.setTextSelection({ from: 52, to: 62 }) })
  await p.click('.toolbar button[aria-label="Link"]'); await p.mouse.move(40, 700); await sleep(900); return p
})

for (const [name, fn] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue
  for (const theme of ['light', 'dark']) {
    const p = await fn(theme)
    await p.screenshot({ path: path.join(OUT, `${name}${theme === 'dark' ? '-dark' : ''}.jpg`), type: 'jpeg', quality: 82 })
    await p.close()
  }
  console.log('took', name)
}
await browser.close(); execSync('pkill -f "uvicorn app.main"', { shell: '/bin/zsh' }); process.exit(0)
