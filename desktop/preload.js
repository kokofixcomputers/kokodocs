// Runs before the page. The page only learns the platform and whether the window is full screen (the title bar adapts to that).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kokoDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('desktop:version'),
  fullscreen: (cb) => ipcRenderer.on('desktop:fullscreen', (_e, on) => cb(!!on)),
})

// the local setup and offline pages (not the website) can also choose the server
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('kokoSetup', {
    current: () => ipcRenderer.invoke('setup:current'),
    save: (url) => ipcRenderer.invoke('setup:save', url),
    retry: () => ipcRenderer.invoke('setup:retry'),
  })
}
