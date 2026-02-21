const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('app:minimize'),
  maximize: () => ipcRenderer.send('app:maximize'),
  close: () => ipcRenderer.send('app:close'),

  // License
  logout: () => ipcRenderer.invoke('license:logout'),
  getUser: () => ipcRenderer.invoke('app:getUser'),
  onLicenseError: (callback) => ipcRenderer.on('license:error', (_, msg) => callback(msg)),

  // Auto-updater
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('update:getVersion'),
  onUpdateChecking: (callback) => ipcRenderer.on('update:checking', () => callback()),
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update:not-available', () => callback()),
  onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', (_, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on('update:error', (_, err) => callback(err))
});
