// KokoDocs desktop: a window around your KokoDocs server. The website itself keeps the offline copy (service worker + IndexedDB),
// so this only adds the native parts: the title bar, menus, screen sharing, links, and remembering which server to open.
const { app, BrowserWindow, Menu, shell, session, ipcMain, nativeTheme, desktopCapturer, protocol, net } = require('electron')
const fs = require('fs')
const path = require('path')

const isMac = process.platform === 'darwin'
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
const cacheDir = () => path.join(app.getPath('userData'), 'appfiles')
const slot = (p) => path.join(cacheDir(), crypto.createHash('sha1').update(p).digest('hex'))
const cacheable = (p) => /^\/(assets|twemoji|shots)\//.test(p) || p === '/favicon.svg' || p.startsWith('/api/images/')
const store = (p, type, buf) => { try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(slot(p) + '.bin', buf); fs.writeFileSync(slot(p) + '.type', type || 'application/octet-stream') } catch { /* disk full or read-only: just no copy */ } }
const saved = (p) => { try { return { body: fs.readFileSync(slot(p) + '.bin'), type: fs.readFileSync(slot(p) + '.type', 'utf8') } } catch { return null } }
const have = (p) => fs.existsSync(slot(p) + '.bin')

function offlineFiles() {
  const scheme = new URL(server).protocol.slice(0, -1)
  protocol.handle(scheme, async (req) => {
    const u = new URL(req.url)
    const pass = () => net.fetch(req, { bypassCustomProtocolHandlers: true })
    if (u.origin !== server || req.method !== 'GET' || u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/images/') || u.pathname.startsWith('/ws/')) return pass()
    const p = u.pathname
    const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
    try {
      const res = await pass()
      if (res.ok && res.status === 200 && (cacheable(p) || isNav)) {
        const type = res.headers.get('content-type') || ''
        if (cacheable(p)) store(p, type, Buffer.from(await res.clone().arrayBuffer()))
        else if (type.includes('text/html')) store('/index.html', type, Buffer.from(await res.clone().arrayBuffer()))   // every page address is the same app
      }
      return res
    } catch (e) {
      const c = cacheable(p) ? saved(p) : isNav ? saved('/index.html') : null
      if (c) return new Response(c.body, { headers: { 'content-type': c.type, 'cache-control': 'no-store' } })
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
  win.webContents.on('did-finish-load', () => { win?.webContents.send('desktop:fullscreen', win.isFullScreen()); if (win?.webContents.getURL().startsWith(server)) setTimeout(prefetch, 4000) })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === server) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: win ?? undefined, autoHideMenuBar: true, titleBarStyle: 'default', minimizable: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } }   // the app's own pop-ups (single sign-on)
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
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

function buildMenu() {
  const nav = (fn) => () => win && fn(win.webContents)
  const t = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
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
    nativeTheme.on('updated', () => { if (!isMac && win) win.setTitleBarOverlay(themeBar()) })
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
}
