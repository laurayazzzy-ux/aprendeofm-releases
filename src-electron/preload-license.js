const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAPI', {
  validateLicense: (key) => ipcRenderer.invoke('license:validate', key),
  onResult: (callback) => ipcRenderer.on('license:result', (_, data) => callback(data)),
  closeWindow: () => ipcRenderer.send('app:close'),
  minimizeWindow: () => ipcRenderer.send('app:minimize')
});
