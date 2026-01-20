const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  saveFile: () => ipcRenderer.invoke('save-file'),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close')
});
