// KokoDocs desktop: a window around your KokoDocs server. The website itself keeps the offline copy (service worker + IndexedDB),
// so this only adds the native parts: the title bar, menus, screen sharing, links, and remembering which server to open.
const { app, BrowserWindow, Menu, shell, session, ipcMain, nativeTheme, desktopCapturer, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

const isMac = process.platform === 'darwin'
const BAR = 40
const cfgFile = () => path.join(app.getPath('userData'), 'config.json')
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) } catch { return {} } }
const writeCfg = (c) => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c)) }

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const normalize = (u) => {
  let s = String(u || '').trim(); if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/.test(s) ? 'http://' : 'https://') + s
  try { const x = new URL(s); return x.origin } catch { return null }
}
let server = normalize(process.env.KOKO_URL || arg('server')) || normalize(readCfg().server)
let win = null

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
  win.webContents.on('did-finish-load', () => win?.webContents.send('desktop:fullscreen', win.isFullScreen()))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (server && new URL(url).origin === server) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, titleBarStyle: 'default' } }   // the app's own pop-out windows
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return
    if (!server || new URL(url).origin !== server) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url) }
  })
  // the page couldn't be loaded at all (first launch without a connection, wrong address, server down)
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3 /* aborted */) return
    void win.loadFile(path.join(__dirname, 'pages', 'offline.html'), { query: { server: server || '', why: desc } })
  })
  load()
}

function load() {
  if (!win) return
  if (!server) void win.loadFile(path.join(__dirname, 'pages', 'setup.html'))
  else void win.loadURL(server)
}

function secure() {
  const allowed = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen', 'display-capture', 'mediaKeySystem', 'speaker-selection', 'window-management'])
  const ok = (wc, perm) => allowed.has(perm) && wc && (wc.getURL().startsWith('file:') || (server && wc.getURL().startsWith(server)))
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
      { label: 'Change server…', click: () => { server = null; load() } },
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
ipcMain.handle('setup:current', () => server || '')
ipcMain.handle('setup:save', async (_e, input) => {
  const u = normalize(input)
  if (!u) return { ok: false, error: 'That doesn’t look like an address.' }
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000)
    const r = await fetch(`${u}/api/ping`, { signal: c.signal }); clearTimeout(t)
    if (!r.ok || !(await r.json()).ok) throw new Error('not kokodocs')
  } catch { return { ok: false, error: 'Couldn’t reach KokoDocs there. Check the address and your connection.' } }
  server = u; writeCfg({ server }); load()
  return { ok: true }
})
ipcMain.handle('setup:retry', () => { load() })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(() => {
    secure(); buildMenu(); createWindow()
    nativeTheme.on('updated', () => { if (!isMac && win) win.setTitleBarOverlay(themeBar()) })
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
}
