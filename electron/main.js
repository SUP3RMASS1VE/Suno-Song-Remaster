const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

const previewDir = path.join(os.tmpdir(), 'spotify-worthy-preview');
if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 660,
    minWidth: 1000,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '../image.png')
  });

  // Always try to load from dist first, fall back to dev server
  const distPath = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(distPath);
  }
  
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// Window control handlers
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());

// File selection
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

// Read audio file
ipcMain.handle('read-audio-file', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  
  try {
    const buffer = fs.readFileSync(filePath);
    return Array.from(new Uint8Array(buffer));
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

// Write file (for WAV export)
ipcMain.handle('write-file', async (event, filePath, data) => {
  if (!filePath) {
    throw new Error('No file path specified');
  }
  
  try {
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

// Get system info
ipcMain.handle('get-system-info', () => ({
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node
}));

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try {
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
});
