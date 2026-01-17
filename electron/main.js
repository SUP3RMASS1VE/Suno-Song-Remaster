const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 800,
    minWidth: 1000,
    minHeight: 750,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#080808',
    icon: path.join(__dirname, '..', 'image.png')
  });

  // Load from Vite dev server or built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Window control handlers
ipcMain.handle('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// File selection dialog
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] }]
  });
  return result.filePaths[0] || null;
});

// Save file dialog
ipcMain.handle('save-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'WAV File', extensions: ['wav'] }]
  });
  return result.filePath || null;
});

// Read file data - returns Uint8Array for FFmpeg.wasm
ipcMain.handle('read-file-data', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }
  const buffer = fs.readFileSync(filePath);
  return new Uint8Array(buffer);
});

// Write file data - receives Uint8Array from renderer
ipcMain.handle('write-file-data', async (event, { filePath, data }) => {
  if (!filePath) {
    throw new Error('No output path specified');
  }
  // Handle both Uint8Array and regular arrays (IPC may serialize differently)
  const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(Object.values(data)));
  fs.writeFileSync(filePath, buffer);
  return { success: true };
});

// Send progress updates to renderer
ipcMain.handle('send-progress', (event, progress) => {
  mainWindow.webContents.send('processing-progress', progress);
});
