const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');

// Get ffmpeg path - handle both dev and packaged app
function getFfmpegPath() {
  try {
    let ffmpegPath = require('ffmpeg-static');
    
    console.log('Initial ffmpeg-static path:', ffmpegPath);
    console.log('Is packaged:', app.isPackaged);
    console.log('App path:', app.getAppPath());
    console.log('Resources path:', process.resourcesPath);
    
    // In packaged app, adjust the path for asar unpacking
    if (app.isPackaged && ffmpegPath) {
      // The path from ffmpeg-static will be inside app.asar
      // We need to redirect it to app.asar.unpacked
      if (ffmpegPath.includes('app.asar')) {
        // Replace app.asar with app.asar.unpacked
        ffmpegPath = ffmpegPath.replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
      } else {
        // If path doesn't contain app.asar, construct it manually
        const relativePath = path.relative(app.getAppPath(), ffmpegPath);
        ffmpegPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
      }
      
      console.log('Adjusted path for packaged app:', ffmpegPath);
    }
    
    // Verify the file exists
    if (!fs.existsSync(ffmpegPath)) {
      console.error('FFmpeg not found at:', ffmpegPath);
      
      // Try to find it in common locations
      const searchPaths = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'),
        path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
        path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
      ];
      
      for (const searchPath of searchPaths) {
        console.log('Searching:', searchPath);
        if (fs.existsSync(searchPath)) {
          console.log('✓ Found ffmpeg at:', searchPath);
          ffmpegPath = searchPath;
          break;
        }
      }
      
      if (!fs.existsSync(ffmpegPath)) {
        throw new Error('FFmpeg binary not found. Searched paths: ' + searchPaths.join(', '));
      }
    }
    
    console.log('✓ Final ffmpeg path:', ffmpegPath);
    console.log('✓ File exists:', fs.existsSync(ffmpegPath));
    
    return ffmpegPath;
  } catch (error) {
    console.error('Error in getFfmpegPath:', error);
    throw error;
  }
}

// Get ffprobe path
function getFfprobePath() {
  try {
    let ffprobePath = require('ffprobe-static').path;
    
    console.log('Initial ffprobe-static path:', ffprobePath);
    
    // In packaged app, adjust the path for asar unpacking
    if (app.isPackaged && ffprobePath) {
      if (ffprobePath.includes('app.asar')) {
        ffprobePath = ffprobePath.replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
      } else {
        const relativePath = path.relative(app.getAppPath(), ffprobePath);
        ffprobePath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
      }
      
      console.log('Adjusted ffprobe path for packaged app:', ffprobePath);
    }
    
    if (!fs.existsSync(ffprobePath)) {
      console.error('FFprobe not found at:', ffprobePath);
      
      // Try to find it in common locations
      const searchPaths = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe'),
        path.join(app.getAppPath(), 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe.exe'),
        path.join(app.getAppPath(), 'node_modules', 'ffprobe-static', 'bin', process.platform, process.arch, 'ffprobe'),
      ];
      
      for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
          console.log('✓ Found ffprobe at:', searchPath);
          ffprobePath = searchPath;
          break;
        }
      }
    }
    
    console.log('✓ Final ffprobe path:', ffprobePath);
    console.log('✓ File exists:', fs.existsSync(ffprobePath));
    
    return ffprobePath;
  } catch (error) {
    console.error('Error in getFfprobePath:', error);
    throw error;
  }
}

// Test if ffmpeg actually works
function testFfmpeg(ffmpegPath) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(ffmpegPath, ['-version'], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg test failed:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        if (stderr) console.error('Stderr:', stderr);
        resolve({ success: false, error: error.message });
      } else {
        console.log('✓ FFmpeg test passed');
        const versionLine = stdout.split('\n')[0];
        console.log('FFmpeg version:', versionLine);
        resolve({ success: true, version: versionLine });
      }
    });
  });
}

// Initialize ffmpeg
let ffmpegInitialized = false;
let ffmpegTestResult = null;

async function initializeFfmpeg() {
  try {
    const ffmpegPath = getFfmpegPath();
    
    // Test if ffmpeg works
    ffmpegTestResult = await testFfmpeg(ffmpegPath);
    if (!ffmpegTestResult.success) {
      throw new Error('FFmpeg exists but cannot execute: ' + ffmpegTestResult.error + 
        '\n\nThis is usually caused by:\n' +
        '• Windows Defender or antivirus blocking the file\n' +
        '• Missing Visual C++ Redistributables\n' +
        '• File permissions issue');
    }
    
    // Set both ffmpeg and ffprobe paths
    ffmpeg.setFfmpegPath(ffmpegPath);
    
    const ffprobePath = getFfprobePath();
    if (fs.existsSync(ffprobePath)) {
      ffmpeg.setFfprobePath(ffprobePath);
      console.log('✓ FFprobe path set:', ffprobePath);
    } else {
      console.warn('⚠ FFprobe not found at:', ffprobePath);
      throw new Error('FFprobe binary not found');
    }
    
    ffmpegInitialized = true;
    console.log('✓ FFmpeg initialized successfully');
    return true;
  } catch (error) {
    console.error('✗ Failed to initialize ffmpeg:', error);
    
    // Show error dialog to user
    setTimeout(() => {
      dialog.showErrorBox(
        'Audio Processing Error', 
        'Failed to initialize the audio processing engine.\n\n' +
        error.message + '\n\n' +
        'Solutions:\n' +
        '1. Add the app folder to your antivirus exclusions\n' +
        '2. Run as administrator\n' +
        '3. Install Visual C++ Redistributables from:\n' +
        '   https://aka.ms/vs/17/release/vc_redist.x64.exe\n' +
        '4. Reinstall the application'
      );
    }, 1000);
    
    return false;
  }
}

let mainWindow;
const previewDir = path.join(os.tmpdir(), 'spotify-worthy-preview');

if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir, { recursive: true });
}

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
    icon: path.join(__dirname, 'image.png')
  });

  mainWindow.loadFile('index.html');
  
  // Open DevTools in development or if ELECTRON_DEBUG is set
  if (!app.isPackaged || process.env.ELECTRON_DEBUG) {
    mainWindow.webContents.openDevTools();
  }
  
  // Log any console errors from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) { // 2 = warning, 3 = error
      console.log(`Renderer [${level}]:`, message);
    }
  });
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

// Get system info for debugging
ipcMain.handle('get-system-info', () => {
  try {
    let ffmpegPath = 'unknown';
    let ffmpegExists = false;
    let ffprobePath = 'unknown';
    let ffprobeExists = false;
    
    try {
      ffmpegPath = getFfmpegPath();
      ffmpegExists = fs.existsSync(ffmpegPath);
    } catch (e) {
      ffmpegPath = 'Error: ' + e.message;
    }
    
    try {
      ffprobePath = getFfprobePath();
      ffprobeExists = fs.existsSync(ffprobePath);
    } catch (e) {
      ffprobePath = 'Error: ' + e.message;
    }
    
    return {
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      ffmpegPath: ffmpegPath,
      ffmpegExists: ffmpegExists,
      ffprobePath: ffprobePath,
      ffprobeExists: ffprobeExists,
      ffmpegInitialized: ffmpegInitialized,
      ffmpegTestResult: ffmpegTestResult,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    };
  } catch (error) {
    return { error: error.message };
  }
});

app.whenReady().then(createWindow);

app.whenReady().then(async () => {
  await initializeFfmpeg();
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

// Two-pass loudness normalization
async function analyzeLoudness(inputPath) {
  return new Promise((resolve, reject) => {
    let output = '';
    ffmpeg(inputPath)
      .audioFilters('loudnorm=I=-14:TP=-2:LRA=11:print_format=json')
      .format('null')
      .on('stderr', (line) => { output += line; })
      .on('end', () => {
        try {
          const jsonMatch = output.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
          if (jsonMatch) {
            const stats = JSON.parse(jsonMatch[0]);
            resolve(stats);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      })
      .on('error', () => resolve(null))
      .save('-');
  });
}

// Process audio file
ipcMain.handle('process-audio', async (event, { inputPath, outputPath, settings }) => {
  // Validate inputs
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Input file not found: ' + inputPath);
  }
  if (!outputPath) {
    throw new Error('No output path specified');
  }
  
  const ceiling = settings.truePeakCeiling || -1.0;
  
  let loudnessStats = null;
  if (settings.normalizeLoudness) {
    mainWindow.webContents.send('processing-progress', 5);
    loudnessStats = await analyzeLoudness(inputPath);
  }
  
  return new Promise((resolve, reject) => {
    const filters = [];
    
    // 1. High-pass filter (clean low end)
    if (settings.cleanLowEnd) {
      filters.push('highpass=f=30');
    }
    
    // 2. Center bass frequencies
    if (settings.centerBass) {
      filters.push('crossfeed=strength=0.3');
    }
    
    // 3. 5-band EQ
    if (settings.eqLow && settings.eqLow !== 0) {
      filters.push(`equalizer=f=80:t=h:w=100:g=${settings.eqLow}`);
    }
    if (settings.eqLowMid && settings.eqLowMid !== 0) {
      filters.push(`equalizer=f=250:t=q:w=1:g=${settings.eqLowMid}`);
    }
    if (settings.eqMid && settings.eqMid !== 0) {
      filters.push(`equalizer=f=1000:t=q:w=1:g=${settings.eqMid}`);
    }
    if (settings.eqHighMid && settings.eqHighMid !== 0) {
      filters.push(`equalizer=f=4000:t=q:w=1:g=${settings.eqHighMid}`);
    }
    if (settings.eqHigh && settings.eqHigh !== 0) {
      filters.push(`equalizer=f=12000:t=h:w=2000:g=${settings.eqHigh}`);
    }
    
    // 4. Cut mud (250Hz)
    if (settings.cutMud) {
      filters.push('equalizer=f=250:t=q:w=1.5:g=-3');
    }
    
    // 4. Tame harshness (4-6kHz)
    if (settings.tameHarsh) {
      filters.push('equalizer=f=4000:t=q:w=2:g=-2');
      filters.push('equalizer=f=6000:t=q:w=1.5:g=-1.5');
    }
    
    // 5. Add air (12kHz)
    if (settings.addAir) {
      filters.push('treble=g=2.5:f=12000:t=s');
    }
    
    // 6. Glue compression
    if (settings.glueCompression) {
      filters.push('acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1');
    }
    
    // 7. Loudness normalization
    if (settings.normalizeLoudness) {
      if (loudnessStats) {
        filters.push(
          `loudnorm=I=-14:TP=-2:LRA=11:` +
          `measured_I=${loudnessStats.input_i}:` +
          `measured_TP=${loudnessStats.input_tp}:` +
          `measured_LRA=${loudnessStats.input_lra}:` +
          `measured_thresh=${loudnessStats.input_thresh}:` +
          `linear=true`
        );
      } else {
        filters.push('loudnorm=I=-14:TP=-2:LRA=20:linear=false');
      }
    }
    
    // 8. Final limiter
    if (settings.truePeakLimit) {
      const limitLinear = Math.pow(10, ceiling / 20);
      filters.push(`alimiter=limit=${limitLinear}:attack=0.1:release=50`);
    }

    let command = ffmpeg(inputPath);
    
    if (filters.length > 0) {
      command = command.audioFilters(filters);
    }
    
    const bitDepth = settings.bitDepth || 16;
    const sampleRate = settings.sampleRate || 44100;
    
    command
      .audioCodec('pcm_s' + bitDepth + 'le')
      .audioFrequency(sampleRate)
      .audioChannels(2)
      .format('wav')
      .on('progress', (progress) => {
        const actualProgress = settings.normalizeLoudness ? 10 + (progress.percent * 0.9) : progress.percent;
        mainWindow.webContents.send('processing-progress', actualProgress || 0);
      })
      .on('end', () => resolve({ success: true }))
      .on('error', (err) => reject(new Error(err.message)))
      .save(outputPath);
  });
});

// Read audio file
ipcMain.handle('read-audio-file', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found');
  }
  
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer;
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

// Analyze audio file
ipcMain.handle('analyze-audio', async (event, filePath) => {
  if (!ffmpegInitialized) {
    throw new Error('Audio processing engine not initialized. Please restart the application or check Debug Info.');
  }
  
  if (!filePath) {
    throw new Error('No input specified');
  }
  
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }
  
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('ffprobe error:', err);
        reject(new Error('Failed to analyze audio file: ' + err.message));
        return;
      }
      
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      if (!audioStream) {
        reject(new Error('No audio stream found in file'));
        return;
      }
      
      resolve({
        duration: metadata.format.duration,
        bitRate: metadata.format.bit_rate,
        sampleRate: audioStream?.sample_rate,
        channels: audioStream?.channels,
        codec: audioStream?.codec_name,
        format: metadata.format.format_name
      });
    });
  });
});

// Cleanup on exit
app.on('before-quit', () => {
  try {
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
    }
  } catch (e) {}
});
