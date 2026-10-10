// KokoDocs desktop: a window around your KokoDocs server. The website itself keeps the offline copy (service worker + IndexedDB),
// so this only adds the native parts: the title bar, menus, screen sharing, links, and remembering which server to open.
const { app, BrowserWindow, Menu, shell, session, ipcMain, nativeTheme, desktopCapturer, protocol, net } = require('electron')
const fs = require('fs')
const path = require('path')

const isMac = process.platform === 'darwin'
const SSO = 'persist:sso'
const BAR = 40
const cfgFile = () => path.join(app.getPath('userData'), 'config.json')
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) } catch { return {} } }
const writeCfg = (c) => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c)) }

// The server is fixed: this app is for docs.kokodev.cc and can't be pointed anywhere else.
// (Only an unpackaged development run can use KOKO_DEV_URL, to test against a local server.)
const SERVER = 'https://docs.kokodev.cc'
const server = (!app.isPackaged && process.env.KOKO_DEV_URL) || SERVER
let win = null

// ── the app's own files, kept on disk ──
// The website also keeps itself in a service worker, but this doesn't depend on that: every app file that loads is saved here, and when the
// server can't be reached the saved copy is served instead, so the window always opens. (Documents are kept by the page itself, in IndexedDB.)
const crypto = require('crypto')
const bundle = require('./bundle')
const cacheDir = () => path.join(app.getPath('userData'), 'appfiles')
const slot = (p) => path.join(cacheDir(), crypto.createHash('sha1').update(p).digest('hex'))
const cacheable = (p) => /^\/(assets|twemoji|shots|ocr)\//.test(p) || p === '/favicon.svg' || p.startsWith('/api/images/')
const store = (p, type, buf) => { try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(slot(p) + '.bin', buf); fs.writeFileSync(slot(p) + '.type', type || 'application/octet-stream') } catch { /* disk full or read-only: just no copy */ } }
const saved = (p) => { try { return { body: fs.readFileSync(slot(p) + '.bin'), type: fs.readFileSync(slot(p) + '.type', 'utf8') } } catch { return null } }
const have = (p) => fs.existsSync(slot(p) + '.bin')

// Cross-origin isolation lets the page run work on several threads (the read-aloud neural voice is about twice as fast with them). `credentialless` keeps pictures,
// fonts and other things from other sites loading as before (without their cookies).
const isolate = (res) => {
  const h = new Headers(res.headers)
  h.delete('content-encoding'); h.delete('content-length')   // (the body here is already decoded)
  h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'credentialless')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}

function offlineFiles() {
  const scheme = new URL(server).protocol.slice(0, -1)
  protocol.handle(scheme, async (req) => {
    const u = new URL(req.url)
    const pass = () => net.fetch(req, { bypassCustomProtocolHandlers: true })
    if (u.origin !== server || req.method !== 'GET' || u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/images/') || u.pathname.startsWith('/ws/')) return pass()
    const p = u.pathname
    const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
    const own = bundle.fileFor(p, isNav)   // the interface on this computer (packed with the app, or downloaded later): no waiting for the server, and it works offline
    if (own) {
      try { return isolate(new Response(await fs.promises.readFile(own), { status: 200, headers: { 'content-type': bundle.typeOf(own), 'cache-control': 'no-cache' } })) } catch { /* fall through to the server's */ }
    }
    try {
      const res = await pass()
      if (res.ok && res.status === 200 && (cacheable(p) || isNav)) {
        const type = res.headers.get('content-type') || ''
        if (cacheable(p)) store(p, type, Buffer.from(await res.clone().arrayBuffer()))
        else if (type.includes('text/html')) store('/index.html', type, Buffer.from(await res.clone().arrayBuffer()))   // every page address is the same app
      }
      return isolate(res)
    } catch (e) {
      const c = cacheable(p) ? saved(p) : isNav ? saved('/index.html') : null
      if (c) return isolate(new Response(c.body, { headers: { 'content-type': c.type, 'cache-control': 'no-store' } }))
      throw e
    }
  })
}

/** after a normal load: fetch the rest of the app so the editors work offline too. The service worker's list is only a starting point:
 *  every saved script and stylesheet is also read for the files it loads, so nothing depends on how complete the server's list is. */
const FILE = /(?:\/?assets\/|\.\/)([A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|json))/g
let prefetching = false
async function prefetch() {
  if (prefetching) return; prefetching = true
  try {
    const sw = await (await net.fetch(server + '/sw.js', { cache: 'no-store' })).text().catch(() => '')
    const queue = new Set(JSON.parse(/const PRECACHE = (\[.*\])/.exec(sw)?.[1] || '[]').filter(cacheable))
    const idx = saved('/index.html'); if (idx) for (const m of idx.body.toString().matchAll(FILE)) queue.add('/assets/' + m[1])
    const done = new Set(); let fin = 0
    const report = () => win?.webContents.send('desktop:app', { done: fin, total: queue.size })
    const next = () => { for (const p of queue) if (!done.has(p)) return p; return null }
    await Promise.all([1, 2, 3, 4].map(async () => {
      for (let p = next(); p; p = next()) {
        done.add(p)
        try {
          let body, type = ''
          if (have(p)) { const c = saved(p); body = c.body; type = c.type } else {
            const r = await net.fetch(server + p, { bypassCustomProtocolHandlers: true })
            if (!r.ok) continue
            type = r.headers.get('content-type') || ''; body = Buffer.from(await r.arrayBuffer()); store(p, type, body)
          }
          if (/javascript|css/.test(type)) for (const m of body.toString('utf8').matchAll(FILE)) queue.add('/assets/' + m[1])   // what this file loads in turn
        } catch { /* next time */ }
        fin++; if (fin % 5 === 0) report()
      }
    }))
    win?.webContents.send('desktop:app', { done: queue.size, total: queue.size, finished: true })
  } catch { /* offline, or an older server */ } finally { prefetching = false }
}

const themeBar = () => ({ color: nativeTheme.shouldUseDarkColors ? '#1b1b1f' : '#ffffff', symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e6ea' : '#1a1a1e', height: BAR })

function createWindow() {
  const opts = {
    width: 1320, height: 860, minWidth: 820, minHeight: 560, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1f' : '#ffffff',
    title: 'KokoDocs',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  }
  if (isMac) Object.assign(opts, { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: Math.round((BAR - 14) / 2) } })
  else Object.assign(opts, { titleBarStyle: 'hidden', titleBarOverlay: themeBar() })
  win = new BrowserWindow(opts)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })
  win.on('enter-full-screen', () => win?.webContents.send('desktop:fullscreen', true))
  win.on('leave-full-screen', () => win?.webContents.send('desktop:fullscreen', false))
  win.webContents.on('did-finish-load', () => { win?.webContents.send('desktop:fullscreen', win.isFullScreen()); if (win?.webContents.getURL().startsWith(server)) { if (!bundle.active()) setTimeout(prefetch, 4000); setTimeout(() => void checkUpdates(false), 6000) } })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === server) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: win ?? undefined, autoHideMenuBar: true, titleBarStyle: 'default', minimizable: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } }   // the app's own pop-ups (single sign-on)
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // (single sign-on has its own window: see ipcMain 'sso:open')
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return
    if (new URL(url).origin !== server) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url) }
  })
  // the page couldn't be loaded at all (first launch without a connection, wrong address, server down)
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3 /* aborted */) return
    void win.loadFile(path.join(__dirname, 'pages', 'offline.html'), { query: { server, why: desc } })
  })
  load()
}

// Single sign-on happens in a window with its own browser session, which this app's file serving never touches: the provider's pages (GitHub's, Google's) load exactly as in a
// browser, with their own cookies. When it lands back on this site, the result is read from that address here and handed to the main window, and the window closes.
ipcMain.handle('sso:open', (_e, url) => {
  let u
  try { u = new URL(String(url)) } catch { return }
  if (u.origin !== server || !u.pathname.startsWith('/api/auth/sso/')) return   // only this site's own sign-in addresses
  const child = new BrowserWindow({
    width: 520, height: 720, parent: win ?? undefined, autoHideMenuBar: true, title: 'Sign in', minimizable: false,
    webPreferences: { partition: SSO, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  watchSso(child)
  void child.loadURL(u.href)
})

function watchSso(child) {
  let done = false
  const finish = (r) => { if (done) return; done = true; win?.webContents.send('desktop:sso', r); setTimeout(() => { try { child.close() } catch { /* already closed */ } }, 50) }
  child.on('closed', () => { if (!done) { done = true; win?.webContents.send('desktop:sso', { closed: true }) } })   // closed by hand: nothing was decided
  const look = (url) => {
    try {
      const u = new URL(url)
      if (u.origin !== server) return
      const h = new URLSearchParams(u.hash.slice(1))
      if (u.pathname === '/auth/callback') finish({ token: h.get('token') || undefined, mfa: h.get('mfa') || undefined, next: h.get('next') || undefined })
      else if (u.pathname === '/login' && u.searchParams.get('error')) finish({ error: u.searchParams.get('error') })
      else if (u.pathname === '/' && u.searchParams.get('sso')) { const v = u.searchParams.get('sso'); finish(v.startsWith('linked') ? { linked: v } : { error: v }) }
    } catch { /* not an address */ }
  }
  const c = child.webContents
  c.on('will-redirect', (_e, url) => look(url)); c.on('did-navigate', (_e, url) => look(url)); c.on('did-navigate-in-page', (_e, url) => look(url))
}

function load() {
  if (!win) return
  if (!readCfg().onboarded) void win.loadFile(path.join(__dirname, 'pages', 'setup.html'))   // first launch: the walkthrough
  else void win.loadURL(server)
}

function secure() {
  const allowed = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'display-capture', 'mediaKeySystem', 'speaker-selection', 'window-management'])
  const ok = (wc, perm) => allowed.has(perm) && wc && (wc.getURL().startsWith('file:') || wc.getURL().startsWith(server))
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(!!ok(wc, perm)))
  session.defaultSession.setPermissionCheckHandler((wc, perm) => !!ok(wc, perm))
  // screen sharing in meetings: the system's own picker where there is one, otherwise a menu of screens and windows
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      if (!sources.length) return cb({})
      const menu = Menu.buildFromTemplate([
        { label: 'Share…', enabled: false }, { type: 'separator' },
        ...sources.slice(0, 20).map((s) => ({ label: s.name.slice(0, 60), click: () => cb({ video: s, ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) }) })),
        { type: 'separator' }, { label: 'Cancel', click: () => cb({}) },
      ])
      menu.popup({ window: win ?? undefined, callback: () => {} })
    } catch { cb({}) }
  }, { useSystemPicker: true })
}

const dirSize = (dir) => {
  let n = 0
  try { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); n += f.isDirectory() ? dirSize(p) : fs.statSync(p).size } } catch { /* not there */ }
  return n
}
ipcMain.handle('desktop:storage', async () => ({ appfiles: dirSize(cacheDir()), cache: await session.defaultSession.getCacheSize().catch(() => 0) }))
ipcMain.handle('desktop:clear', async (_e, what) => {
  if (what === 'appfiles') fs.rmSync(cacheDir(), { recursive: true, force: true })
  else if (what === 'cache') await session.defaultSession.clearCache()
})

// ── interface updates (see bundle.js) ──
let offered = ''
async function checkUpdates(manual) {
  try {
    const u = await bundle.check()
    if (u && (manual || u.commit !== offered)) { offered = u.commit; win?.webContents.send('desktop:update', u) }
    return u
  } catch (e) { if (manual) throw e; return null }   // (offline, or GitHub unreachable: try again later)
}
ipcMain.handle('update:check', () => checkUpdates(true))
ipcMain.handle('update:install', async () => {
  try { await bundle.install((p) => win?.webContents.send('desktop:update-progress', p)); win?.webContents.reloadIgnoringCache() }
  catch (e) { win?.webContents.send('desktop:update-error', e.message); throw e }
})
ipcMain.handle('bundle:info', () => bundle.describe())
ipcMain.handle('bundle:remove', () => { bundle.removeDownloaded(); win?.webContents.reloadIgnoringCache() })

function buildMenu() {
  const settings = { label: isMac ? 'Settings…' : 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('desktop:settings') }
  const nav = (fn) => () => win && fn(win.webContents)
  const t = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, settings, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      ...(isMac ? [] : [settings, { type: 'separator' }]),
      { label: 'Search…', click: () => win?.webContents.executeJavaScript("window.dispatchEvent(new Event('koko:search'))") },   // (Cmd/Ctrl+K itself is handled by the page)
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ] },
    { label: 'Go', submenu: [
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: nav((w) => w.canGoBack() && w.goBack()) },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: nav((w) => w.canGoForward() && w.goForward()) },
    ] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(t))
}

ipcMain.on('desktop:version', (e) => { e.returnValue = app.getVersion() })
ipcMain.handle('setup:finish', () => { writeCfg({ ...readCfg(), onboarded: true }); load() })
ipcMain.handle('setup:retry', () => { load() })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(async () => {
    if (!app.isPackaged && process.env.KOKO_TEST_NOSW) await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })   // (testing: prove the saved files work without the service worker)
    offlineFiles(); secure(); buildMenu(); createWindow()
    setInterval(() => void checkUpdates(false), 6 * 3600 * 1000)
    nativeTheme.on('updated', () => { if (!isMac && win) win.setTitleBarOverlay(themeBar()) })
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
}
