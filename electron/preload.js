const { contextBridge, ipcRenderer } = require('electron');

// Track listener to prevent accumulation
let progressListener = null;

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  saveFile: () => ipcRenderer.invoke('save-file'),

  // File data operations for FFmpeg.wasm
  readFileData: (filePath) => ipcRenderer.invoke('read-file-data', filePath),
  writeFileData: (filePath, data) => ipcRenderer.invoke('write-file-data', { filePath, data }),

  // Progress callback
  onProgress: (callback) => {
    // Remove previous listener to prevent stacking
    if (progressListener) {
      ipcRenderer.removeListener('processing-progress', progressListener);
    }
    progressListener = (event, progress) => callback(progress);
    ipcRenderer.on('processing-progress', progressListener);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close')
});
