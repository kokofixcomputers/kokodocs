// Runs before the page. The page only learns the platform and whether the window is full screen (the title bar adapts to that).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kokoDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('desktop:version'),
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
