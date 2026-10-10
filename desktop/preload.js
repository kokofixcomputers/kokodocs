// Runs before the page. The page only learns the platform and whether the window is full screen (the title bar adapts to that).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kokoDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('desktop:version'),
  update: {   // the interface can be updated on its own, without a new app
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => { ipcRenderer.send('update:ui'); ipcRenderer.on('desktop:update', (_e, u) => cb(u)) },   // (telling the app that this page can show the update card)
    onProgress: (cb) => ipcRenderer.on('desktop:update-progress', (_e, p) => cb(p)),
    onError: (cb) => ipcRenderer.on('desktop:update-error', (_e, m) => cb(m)),
  },
  bundle: () => ipcRenderer.invoke('bundle:info'),
  removeBundle: () => ipcRenderer.invoke('bundle:remove'),
  openSso: (url) => ipcRenderer.invoke('sso:open', url),
  onSso: (cb) => ipcRenderer.on('desktop:sso', (_e, r) => cb(r)),   // the result of signing in through a provider, read from the pop-up's last address
  storage: () => ipcRenderer.invoke('desktop:storage'),   // how much room the app's saved files take
  clear: (what) => ipcRenderer.invoke('desktop:clear', what),
  onSettings: (cb) => ipcRenderer.on('desktop:settings', () => cb()),
  appFiles: (cb) => ipcRenderer.on('desktop:app', (_e, s) => cb(s)),   // progress of saving the app's own files
  fullscreen: (cb) => ipcRenderer.on('desktop:fullscreen', (_e, on) => cb(!!on)),
})

// the local welcome and offline pages (not the website) can finish the walkthrough and retry
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('kokoSetup', {
    finish: () => ipcRenderer.invoke('setup:finish'),
    retry: () => ipcRenderer.invoke('setup:retry'),
  })
}
