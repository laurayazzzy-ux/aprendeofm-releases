const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateAPI', {
  onStatus: (callback) => ipcRenderer.on('update:status', (event, data) => callback(data))
});
