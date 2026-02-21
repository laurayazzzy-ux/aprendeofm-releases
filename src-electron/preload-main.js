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
  acceptUpdate: () => ipcRenderer.invoke('update:accept'),
  getAppVersion: () => ipcRenderer.invoke('update:getVersion'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update:not-available', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update:error', (_, err) => callback(err))
});
