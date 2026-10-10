// The app's interface (the built website) as a bundle on this computer, so the window opens at once and offline, and so it can be updated without
// a new desktop app. Two places can hold one: the copy packed inside the app, and the newest one downloaded from the project's "frontend-nightly"
// release on GitHub (userData/frontend). The one built later wins. Each bundle says which commit it is (bundle.json); the release's manifest says
// which commit is the latest, with a checksum of the file, and when they differ the app offers to download it.
const { app, net } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const tar = require('tar')

const REPO = 'kokofixcomputers/kokodocs'
const RELEASE = `https://github.com/${REPO}/releases/download/frontend-nightly`
const base = () => (!app.isPackaged && process.env.KOKO_UPDATE_BASE) || RELEASE   // (an unpackaged run can be pointed at a local test server)

const downloaded = () => path.join(app.getPath('userData'), 'frontend')
const packed = () => (app.isPackaged ? path.join(process.resourcesPath, 'bundle') : path.join(__dirname, 'bundle'))

function info(dir) {
  try {
    if (!fs.existsSync(path.join(dir, 'index.html'))) return null
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf8'))
    return j && j.commit ? { dir, commit: String(j.commit), built: Date.parse(j.built) || 0 } : null
  } catch { return null }
}

/** the bundle to show: the downloaded one, or the one packed with the app, whichever was built later (null: none, the server's own files are used) */
let cached
function active() {
  if (cached !== undefined) return cached
  let dl = null
  try { const cur = JSON.parse(fs.readFileSync(path.join(downloaded(), 'current.json'), 'utf8')); dl = info(path.join(downloaded(), String(cur.dir).replace(/[^0-9a-f]/gi, ''))) } catch { /* none */ }
  const pk = info(packed())
  cached = dl && pk ? (dl.built >= pk.built ? { ...dl, source: 'downloaded' } : { ...pk, source: 'packed' }) : dl ? { ...dl, source: 'downloaded' } : pk ? { ...pk, source: 'packed' } : null
  return cached
}
const reset = () => { cached = undefined }

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', wasm: 'application/wasm', onnx: 'application/octet-stream', txt: 'text/plain; charset=utf-8', map: 'application/json', gz: 'application/gzip' }

/** the file for a page address, or null when the bundle doesn't have it (and, for a page address without a file extension, the app's own page: every route is the same app) */
function fileFor(pathname, isNav) {
  const b = active(); if (!b) return null
  let rel
  try { rel = decodeURIComponent(pathname) } catch { return null }
  const root = path.resolve(b.dir)
  const f = path.resolve(root, '.' + rel)
  if (f !== root && !f.startsWith(root + path.sep)) return null   // never anything outside the bundle
  try { if (rel !== '/' && fs.statSync(f).isFile()) return f } catch { /* not a file */ }
  return isNav || !/\.[a-z0-9]+$/i.test(rel) ? path.join(root, 'index.html') : null
}
const typeOf = (f) => TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream'

// ── updates ──
let latest = null
const getJson = async (url) => { const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status}`); return r.json() }

/** what the project has published, if it differs from what is showing now: { commit, built, size, sha256, file } or null */
async function check() {
  const m = await getJson(`${base()}/manifest.json`)
  if (!m || !/^[0-9a-f]{7,64}$/i.test(m.commit || '') || !/^[0-9a-f]{64}$/i.test(m.sha256 || '') || typeof m.file !== 'string' || /[\\/]/.test(m.file)) throw new Error('The update notice is not in the expected form')
  const now = active()
  latest = m
  if (now && now.commit === m.commit) return null
  if (now && now.built && Date.parse(m.built) && Date.parse(m.built) <= now.built) return null   // never go back to something older than what is here
  return { commit: m.commit, built: m.built, size: m.size, sha256: m.sha256, file: m.file }
}

/** download the latest bundle, check it is the file the manifest describes, unpack it, and make it the one to show */
async function install(progress) {
  const m = latest || (await check()); if (!m) return null
  const dir = downloaded(); fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'download.tar.gz')
  const res = await net.fetch(`${base()}/${m.file}`, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || m.size || 0, hash = crypto.createHash('sha256'), out = fs.createWriteStream(tmp)
  let got = 0
  const MAX = 300 * 1024 * 1024
  for await (const chunk of res.body) {
    got += chunk.length; if (got > MAX) throw new Error('The download is larger than expected')
    hash.update(chunk); if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
    progress?.(total ? got / total : 0)
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())))
  if (hash.digest('hex') !== m.sha256.toLowerCase()) { fs.rmSync(tmp, { force: true }); throw new Error('The download is not the file that was published (checksum mismatch)') }
  const name = String(m.commit).toLowerCase(), target = path.join(dir, name), staging = target + '.new'
  fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true })
  await tar.x({ file: tmp, cwd: staging, strict: true, filter: (p, e) => !(e.type && !['File', 'Directory'].includes(e.type)) })   // (plain files only: no links)
  fs.rmSync(tmp, { force: true })
  const got2 = info(staging)
  if (!got2 || got2.commit.toLowerCase() !== name) { fs.rmSync(staging, { recursive: true, force: true }); throw new Error('The downloaded interface is not the version that was announced') }
  fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(staging, target)
  fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ dir: name }))
  for (const f of fs.readdirSync(dir)) if (f !== name && f !== 'current.json') fs.rmSync(path.join(dir, f), { recursive: true, force: true })   // older ones are not needed
  reset()
  return active()
}

/** remove the downloaded bundle (the one packed with the app, or the server's files, are used again) */
function removeDownloaded() { fs.rmSync(downloaded(), { recursive: true, force: true }); reset() }

const size = (dir) => { let n = 0; try { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); n += f.isDirectory() ? size(p) : fs.statSync(p).size } } catch { /* none */ } return n }
const describe = () => { const b = active(); return b ? { commit: b.commit, built: b.built, source: b.source, bytes: size(b.dir), downloadedBytes: size(downloaded()) } : null }

module.exports = { active, fileFor, typeOf, check, install, removeDownloaded, describe, reset }
