// ============================================================================
// FFmpeg.wasm Processor (runs in renderer)
// ============================================================================
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;

async function initFFmpeg(onProgress) {
  if (ffmpegLoaded) return;
  if (ffmpegLoading) {
    // Wait for loading to complete
    while (ffmpegLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }

  ffmpegLoading = true;

  try {
    console.log('[FFmpeg] Starting initialization...');
    console.log('[FFmpeg] SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');

    ffmpeg = new FFmpeg();

    // Progress callback
    ffmpeg.on('progress', ({ progress }) => {
      if (onProgress) {
        // Scale progress to 10-100% (first 10% is loading)
        onProgress(10 + Math.round(progress * 90));
      }
    });

    // Log FFmpeg events for debugging
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg Log]', message);
    });

    // Use toBlobURL to convert URLs to blob URLs (required for proper module loading)
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

    console.log('[FFmpeg] Loading FFmpeg core...');

    // Load FFmpeg core with timeout
    const loadPromise = ffmpeg.load({
      coreURL,
      wasmURL,
    });

    // Add 60 second timeout for loading
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('FFmpeg loading timed out after 60 seconds')), 60000);
    });

    await Promise.race([loadPromise, timeoutPromise]);

    console.log('[FFmpeg] Core loaded successfully!');
    ffmpegLoaded = true;
  } catch (error) {
    console.error('[FFmpeg] Initialization failed:', error);
    throw error;
  } finally {
    ffmpegLoading = false;
  }
}

function buildFilterChain(settings) {
  const filters = [];

  // 1. High-pass filter (clean low end)
  if (settings.cleanLowEnd) {
    filters.push('highpass=f=30');
  }

  // 2. Center bass frequencies (mono below 200Hz)
  // Note: crossfeed filter not available in FFmpeg.wasm, using stereotools instead
  if (settings.centerBass) {
    // stereotools with sbal=1 at low frequencies centers the bass
    // This is a compatible alternative that works in FFmpeg.wasm
    filters.push('pan=stereo|FL<0.5*FL+0.5*FR|FR<0.5*FL+0.5*FR');
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

  // 5. Tame harshness (4-6kHz)
  if (settings.tameHarsh) {
    filters.push('equalizer=f=4000:t=q:w=2:g=-2');
    filters.push('equalizer=f=6000:t=q:w=1.5:g=-1.5');
  }

  // 6. Add air (12kHz)
  if (settings.addAir) {
    filters.push('treble=g=2.5:f=12000:t=s');
  }

  // 7. Glue compression
  if (settings.glueCompression) {
    filters.push('acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1');
  }

  // 8. Loudness normalization
  if (settings.normalizeLoudness) {
    filters.push('loudnorm=I=-14:TP=-2:LRA=11:linear=false');
  }

  // 9. Final limiter
  if (settings.truePeakLimit) {
    const ceiling = settings.truePeakCeiling || -1;
    const limitLinear = Math.pow(10, ceiling / 20);
    filters.push(`alimiter=limit=${limitLinear}:attack=0.1:release=50`);
  }

  return filters;
}

async function processAudioWithFFmpeg(inputData, inputName, outputName, settings, onProgress) {
  if (!ffmpegLoaded) {
    if (onProgress) onProgress(5);
    await initFFmpeg(onProgress);
  }

  // Write input file to FFmpeg's virtual filesystem
  await ffmpeg.writeFile(inputName, inputData);

  if (onProgress) onProgress(10);

  // Build filter chain
  const filters = buildFilterChain(settings);

  // Build FFmpeg command
  const args = ['-i', inputName];

  if (filters.length > 0) {
    args.push('-af', filters.join(','));
  }

  // Output format
  const sampleRate = settings.sampleRate || 44100;
  const bitDepth = settings.bitDepth || 16;

  args.push(
    '-ar', String(sampleRate),
    '-ac', '2',
    '-c:a', `pcm_s${bitDepth}le`,
    outputName
  );

  // Run FFmpeg
  await ffmpeg.exec(args);

  // Read output
  const outputData = await ffmpeg.readFile(outputName);

  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return outputData;
}

// ============================================================================
// Application State
// ============================================================================

// Grouped state for better organization and easier resets
const playerState = {
  isPlaying: false,
  isBypassed: false,
  isSeeking: false,
  startTime: 0,
  pauseTime: 0,
  seekUpdateInterval: null
};

const audioNodes = {
  context: null,
  source: null,
  buffer: null,
  analyser: null,
  gain: null,
  // Effects chain
  highpass: null,
  lowshelf: null,    // mud cut
  highshelf: null,   // air boost
  midPeak: null,     // harshness
  compressor: null,
  limiter: null,
  // 5-band EQ
  eqLow: null,
  eqLowMid: null,
  eqMid: null,
  eqHighMid: null,
  eqHigh: null
};

const fileState = {
  selectedFilePath: null
};

let isProcessing = false;
let processingCancelled = false;

// ============================================================================
// Window Controls
// ============================================================================

document.getElementById('minimizeBtn').addEventListener('click', () => {
  window.electronAPI.minimizeWindow();
});

document.getElementById('maximizeBtn').addEventListener('click', () => {
  window.electronAPI.maximizeWindow();
});

document.getElementById('closeBtn').addEventListener('click', () => {
  window.electronAPI.closeWindow();
});

// ============================================================================
// DOM Elements
// ============================================================================

const selectFileBtn = document.getElementById('selectFile');
const changeFileBtn = document.getElementById('changeFile');
const fileZoneContent = document.getElementById('fileZoneContent');
const fileLoaded = document.getElementById('fileLoaded');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const dropZone = document.getElementById('dropZone');
const processBtn = document.getElementById('processBtn');
const cancelBtn = document.getElementById('cancelBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusMessage = document.getElementById('statusMessage');

// Player elements
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const playIcon = document.getElementById('playIcon');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const bypassBtn = document.getElementById('bypassBtn');

// Settings
const normalizeLoudness = document.getElementById('normalizeLoudness');
const truePeakLimit = document.getElementById('truePeakLimit');
const truePeakSlider = document.getElementById('truePeakCeiling');
const ceilingValue = document.getElementById('ceilingValue');
const cleanLowEnd = document.getElementById('cleanLowEnd');
const glueCompression = document.getElementById('glueCompression');
const centerBass = document.getElementById('centerBass');
const cutMud = document.getElementById('cutMud');
const addAir = document.getElementById('addAir');
const tameHarsh = document.getElementById('tameHarsh');
const sampleRate = document.getElementById('sampleRate');
const bitDepth = document.getElementById('bitDepth');

// EQ elements
const eqLow = document.getElementById('eqLow');
const eqLowMid = document.getElementById('eqLowMid');
const eqMid = document.getElementById('eqMid');
const eqHighMid = document.getElementById('eqHighMid');
const eqHigh = document.getElementById('eqHigh');

// Mini checklist
const miniLufs = document.getElementById('mini-lufs');
const miniPeak = document.getElementById('mini-peak');
const miniFormat = document.getElementById('mini-format');

// ============================================================================
// Web Audio API (for real-time preview)
// ============================================================================

function initAudioContext() {
  if (!audioNodes.context) {
    audioNodes.context = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioNodes.context;
}

function createAudioChain() {
  const ctx = initAudioContext();

  // Create analyser for visualization
  audioNodes.analyser = ctx.createAnalyser();
  audioNodes.analyser.fftSize = 2048;

  // Create nodes
  audioNodes.gain = ctx.createGain();
  audioNodes.highpass = ctx.createBiquadFilter();
  audioNodes.lowshelf = ctx.createBiquadFilter();
  audioNodes.highshelf = ctx.createBiquadFilter();
  audioNodes.midPeak = ctx.createBiquadFilter();
  audioNodes.compressor = ctx.createDynamicsCompressor();
  audioNodes.limiter = ctx.createDynamicsCompressor();

  // 5-band EQ nodes
  audioNodes.eqLow = ctx.createBiquadFilter();
  audioNodes.eqLowMid = ctx.createBiquadFilter();
  audioNodes.eqMid = ctx.createBiquadFilter();
  audioNodes.eqHighMid = ctx.createBiquadFilter();
  audioNodes.eqHigh = ctx.createBiquadFilter();

  // Configure EQ bands
  audioNodes.eqLow.type = 'lowshelf';
  audioNodes.eqLow.frequency.value = 80;

  audioNodes.eqLowMid.type = 'peaking';
  audioNodes.eqLowMid.frequency.value = 250;
  audioNodes.eqLowMid.Q.value = 1;

  audioNodes.eqMid.type = 'peaking';
  audioNodes.eqMid.frequency.value = 1000;
  audioNodes.eqMid.Q.value = 1;

  audioNodes.eqHighMid.type = 'peaking';
  audioNodes.eqHighMid.frequency.value = 4000;
  audioNodes.eqHighMid.Q.value = 1;

  audioNodes.eqHigh.type = 'highshelf';
  audioNodes.eqHigh.frequency.value = 12000;

  // Configure highpass (clean low end)
  audioNodes.highpass.type = 'highpass';
  audioNodes.highpass.frequency.value = 30;
  audioNodes.highpass.Q.value = 0.7;

  // Configure cut mud (250Hz cut)
  audioNodes.lowshelf.type = 'peaking';
  audioNodes.lowshelf.frequency.value = 250;
  audioNodes.lowshelf.Q.value = 1.5;
  audioNodes.lowshelf.gain.value = 0;

  // Configure add air (12kHz boost)
  audioNodes.highshelf.type = 'highshelf';
  audioNodes.highshelf.frequency.value = 12000;
  audioNodes.highshelf.gain.value = 0;

  // Configure tame harshness (4-6kHz cut)
  audioNodes.midPeak.type = 'peaking';
  audioNodes.midPeak.frequency.value = 5000;
  audioNodes.midPeak.Q.value = 2;
  audioNodes.midPeak.gain.value = 0;

  // Configure glue compressor
  audioNodes.compressor.threshold.value = -18;
  audioNodes.compressor.knee.value = 10;
  audioNodes.compressor.ratio.value = 3;
  audioNodes.compressor.attack.value = 0.02;
  audioNodes.compressor.release.value = 0.25;

  // Configure limiter
  audioNodes.limiter.threshold.value = -1;
  audioNodes.limiter.knee.value = 0;
  audioNodes.limiter.ratio.value = 20;
  audioNodes.limiter.attack.value = 0.001;
  audioNodes.limiter.release.value = 0.05;

  updateAudioChain();
  updateEQ();
}

function updateAudioChain() {
  if (!audioNodes.context || !audioNodes.highpass) return;

  // Highpass (clean low end)
  audioNodes.highpass.frequency.value = (cleanLowEnd.checked && !playerState.isBypassed) ? 30 : 1;

  // Cut Mud
  audioNodes.lowshelf.gain.value = (cutMud.checked && !playerState.isBypassed) ? -3 : 0;

  // Add Air
  audioNodes.highshelf.gain.value = (addAir.checked && !playerState.isBypassed) ? 2.5 : 0;

  // Tame Harshness
  audioNodes.midPeak.gain.value = (tameHarsh.checked && !playerState.isBypassed) ? -2 : 0;

  // Glue Compression
  if (glueCompression.checked && !playerState.isBypassed) {
    audioNodes.compressor.threshold.value = -18;
    audioNodes.compressor.ratio.value = 3;
  } else {
    audioNodes.compressor.threshold.value = 0;
    audioNodes.compressor.ratio.value = 1;
  }

  // Limiter
  if (truePeakLimit.checked && !playerState.isBypassed) {
    const ceiling = parseFloat(truePeakSlider.value);
    audioNodes.limiter.threshold.value = ceiling;
    audioNodes.limiter.ratio.value = 20;
  } else {
    audioNodes.limiter.threshold.value = 0;
    audioNodes.limiter.ratio.value = 1;
  }
}

function connectAudioChain(source) {
  source
    .connect(audioNodes.highpass)
    .connect(audioNodes.eqLow)
    .connect(audioNodes.eqLowMid)
    .connect(audioNodes.eqMid)
    .connect(audioNodes.eqHighMid)
    .connect(audioNodes.eqHigh)
    .connect(audioNodes.lowshelf)
    .connect(audioNodes.midPeak)
    .connect(audioNodes.highshelf)
    .connect(audioNodes.compressor)
    .connect(audioNodes.limiter)
    .connect(audioNodes.analyser)
    .connect(audioNodes.gain)
    .connect(audioNodes.context.destination);
}

function updateEQ() {
  if (!audioNodes.eqLow) return;

  if (playerState.isBypassed) {
    audioNodes.eqLow.gain.value = 0;
    audioNodes.eqLowMid.gain.value = 0;
    audioNodes.eqMid.gain.value = 0;
    audioNodes.eqHighMid.gain.value = 0;
    audioNodes.eqHigh.gain.value = 0;
  } else {
    audioNodes.eqLow.gain.value = parseFloat(eqLow.value);
    audioNodes.eqLowMid.gain.value = parseFloat(eqLowMid.value);
    audioNodes.eqMid.gain.value = parseFloat(eqMid.value);
    audioNodes.eqHighMid.gain.value = parseFloat(eqHighMid.value);
    audioNodes.eqHigh.gain.value = parseFloat(eqHigh.value);
  }

  // Update display values
  document.getElementById('eqLowVal').textContent = `${eqLow.value} dB`;
  document.getElementById('eqLowMidVal').textContent = `${eqLowMid.value} dB`;
  document.getElementById('eqMidVal').textContent = `${eqMid.value} dB`;
  document.getElementById('eqHighMidVal').textContent = `${eqHighMid.value} dB`;
  document.getElementById('eqHighVal').textContent = `${eqHigh.value} dB`;
}

// ============================================================================
// EQ Presets
// ============================================================================

const eqPresets = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -2, lowMid: -1, mid: 2, highMid: 3, high: 1 },
  bass: { low: 6, lowMid: 3, mid: 0, highMid: -1, high: -2 },
  bright: { low: -1, lowMid: 0, mid: 1, highMid: 3, high: 5 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -2, high: -3 },
  suno: { low: 1, lowMid: -2, mid: 1, highMid: -1, high: 2 }
};

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = eqPresets[btn.dataset.preset];
    if (preset) {
      eqLow.value = preset.low;
      eqLowMid.value = preset.lowMid;
      eqMid.value = preset.mid;
      eqHighMid.value = preset.highMid;
      eqHigh.value = preset.high;
      updateEQ();

      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });
});

[eqLow, eqLowMid, eqMid, eqHighMid, eqHigh].forEach(slider => {
  slider.addEventListener('input', () => {
    updateEQ();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  });
});

// ============================================================================
// Audio File Loading
// ============================================================================

async function loadAudioFile(filePath) {
  const ctx = initAudioContext();

  try {
    // Use IPC to read file data (more reliable than direct file:// fetch)
    const fileData = await window.electronAPI.readFileData(filePath);

    // Handle IPC serialization - may return Uint8Array or serialized object
    let arrayBuffer;
    if (fileData instanceof Uint8Array) {
      arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
    } else if (fileData.buffer) {
      // Already has a buffer property
      arrayBuffer = fileData.buffer.slice(fileData.byteOffset || 0, (fileData.byteOffset || 0) + fileData.byteLength);
    } else {
      // Serialized as plain object with numeric keys
      const uint8 = new Uint8Array(Object.values(fileData));
      arrayBuffer = uint8.buffer;
    }

    audioNodes.buffer = await ctx.decodeAudioData(arrayBuffer);

    createAudioChain();

    // Update duration display
    const duration = audioNodes.buffer.duration;
    durationEl.textContent = formatTime(duration);
    seekBar.max = duration;

    playBtn.disabled = false;
    stopBtn.disabled = false;
    processBtn.disabled = false;

    return true;
  } catch (error) {
    console.error('Error loading audio:', error);
    return false;
  }
}

// ============================================================================
// Audio Playback
// ============================================================================

function playAudio() {
  if (!audioNodes.buffer || !audioNodes.context) return;

  if (audioNodes.context.state === 'suspended') {
    audioNodes.context.resume();
  }

  stopAudio();

  audioNodes.source = audioNodes.context.createBufferSource();
  audioNodes.source.buffer = audioNodes.buffer;

  connectAudioChain(audioNodes.source);

  audioNodes.source.onended = () => {
    if (playerState.isPlaying) {
      playerState.isPlaying = false;
      playIcon.textContent = '▶️';
      clearInterval(playerState.seekUpdateInterval);
    }
  };

  const offset = playerState.pauseTime;
  playerState.startTime = audioNodes.context.currentTime - offset;
  audioNodes.source.start(0, offset);
  playerState.isPlaying = true;
  playIcon.textContent = '⏸️';

  clearInterval(playerState.seekUpdateInterval);
  playerState.seekUpdateInterval = setInterval(() => {
    if (playerState.isPlaying && audioNodes.buffer && !playerState.isSeeking) {
      const currentTime = audioNodes.context.currentTime - playerState.startTime;
      if (currentTime >= audioNodes.buffer.duration) {
        stopAudio();
        playerState.pauseTime = 0;
        seekBar.value = 0;
        currentTimeEl.textContent = '0:00';
      } else {
        seekBar.value = currentTime;
        currentTimeEl.textContent = formatTime(currentTime);
      }
    }
  }, 100);
}

function pauseAudio() {
  if (!playerState.isPlaying) return;

  playerState.pauseTime = audioNodes.context.currentTime - playerState.startTime;
  stopAudio();
}

function stopAudio() {
  if (audioNodes.source) {
    try {
      audioNodes.source.stop();
      audioNodes.source.disconnect();
    } catch (e) {}
    audioNodes.source = null;
  }
  playerState.isPlaying = false;
  playIcon.textContent = '▶️';
  clearInterval(playerState.seekUpdateInterval);
}

function seekTo(time) {
  playerState.pauseTime = time;

  if (playerState.isPlaying) {
    if (audioNodes.source) {
      try {
        audioNodes.source.stop();
        audioNodes.source.disconnect();
      } catch (e) {}
    }
    clearInterval(playerState.seekUpdateInterval);

    audioNodes.source = audioNodes.context.createBufferSource();
    audioNodes.source.buffer = audioNodes.buffer;
    connectAudioChain(audioNodes.source);

    audioNodes.source.onended = () => {
      if (playerState.isPlaying) {
        playerState.isPlaying = false;
        playIcon.textContent = '▶️';
        clearInterval(playerState.seekUpdateInterval);
      }
    };

    playerState.startTime = audioNodes.context.currentTime - time;
    audioNodes.source.start(0, time);

    clearInterval(playerState.seekUpdateInterval);
    playerState.seekUpdateInterval = setInterval(() => {
      if (playerState.isPlaying && audioNodes.buffer && !playerState.isSeeking) {
        const currentTime = audioNodes.context.currentTime - playerState.startTime;
        if (currentTime >= audioNodes.buffer.duration) {
          stopAudio();
          playerState.pauseTime = 0;
          seekBar.value = 0;
          currentTimeEl.textContent = '0:00';
        } else {
          seekBar.value = currentTime;
          currentTimeEl.textContent = formatTime(currentTime);
        }
      }
    }, 100);
  } else {
    currentTimeEl.textContent = formatTime(time);
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// File Selection
// ============================================================================

selectFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) {
    await loadFile(filePath);
  }
});

changeFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) {
    stopAudio();
    playerState.pauseTime = 0;
    await loadFile(filePath);
  }
});

async function loadFile(filePath) {
  fileState.selectedFilePath = filePath;

  // Load into Web Audio first to get metadata
  const loaded = await loadAudioFile(filePath);

  if (loaded && audioNodes.buffer) {
    // Get file info from the decoded audio buffer and file path
    const name = filePath.split(/[\\/]/).pop();
    const ext = name.split('.').pop().toUpperCase();
    const sampleRateKHz = Math.round(audioNodes.buffer.sampleRate / 1000);
    const duration = formatTime(audioNodes.buffer.duration);

    fileName.textContent = name;
    fileMeta.textContent = `${ext} • ${sampleRateKHz}kHz • ${duration}`;

    fileZoneContent.classList.add('hidden');
    fileLoaded.classList.remove('hidden');

    updateChecklist();
  }
}

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (file && /\.(mp3|wav|flac|aac|m4a)$/i.test(file.name)) {
    stopAudio();
    playerState.pauseTime = 0;
    await loadFile(file.path);
  }
});

// ============================================================================
// Player Controls
// ============================================================================

playBtn.addEventListener('click', () => {
  if (playerState.isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
});

stopBtn.addEventListener('click', () => {
  stopAudio();
  playerState.pauseTime = 0;
  seekBar.value = 0;
  currentTimeEl.textContent = '0:00';
});

seekBar.addEventListener('change', () => {
  playerState.isSeeking = false;
  seekTo(parseFloat(seekBar.value));
});

seekBar.addEventListener('input', () => {
  playerState.isSeeking = true;
  currentTimeEl.textContent = formatTime(parseFloat(seekBar.value));
});

seekBar.addEventListener('mousedown', () => {
  playerState.isSeeking = true;
});

seekBar.addEventListener('mouseup', () => {
  playerState.isSeeking = false;
});

bypassBtn.addEventListener('click', () => {
  playerState.isBypassed = !playerState.isBypassed;
  bypassBtn.textContent = playerState.isBypassed ? '🔇 FX Off' : '🔊 FX On';
  bypassBtn.classList.toggle('active', playerState.isBypassed);
  updateAudioChain();
  updateEQ();
});

// ============================================================================
// Export/Processing (using FFmpeg.wasm)
// ============================================================================

processBtn.addEventListener('click', async () => {
  if (!fileState.selectedFilePath) return;

  const outputPath = await window.electronAPI.saveFile();
  if (!outputPath) return;

  isProcessing = true;
  processingCancelled = false;
  progressContainer.classList.remove('hidden');
  processBtn.disabled = true;
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';

  const settings = {
    normalizeLoudness: normalizeLoudness.checked,
    truePeakLimit: truePeakLimit.checked,
    truePeakCeiling: parseFloat(truePeakSlider.value),
    cleanLowEnd: cleanLowEnd.checked,
    glueCompression: glueCompression.checked,
    centerBass: centerBass.checked,
    cutMud: cutMud.checked,
    addAir: addAir.checked,
    tameHarsh: tameHarsh.checked,
    sampleRate: parseInt(sampleRate.value),
    bitDepth: parseInt(bitDepth.value),
    eqLow: parseFloat(eqLow.value),
    eqLowMid: parseFloat(eqLowMid.value),
    eqMid: parseFloat(eqMid.value),
    eqHighMid: parseFloat(eqHighMid.value),
    eqHigh: parseFloat(eqHigh.value)
  };

  const updateProgress = (percent) => {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  };

  try {
    // Read input file via IPC
    updateProgress(2);
    statusMessage.textContent = 'Reading file...';
    const inputData = await window.electronAPI.readFileData(fileState.selectedFilePath);

    if (processingCancelled) {
      throw new Error('Cancelled');
    }

    // Get input filename extension
    const inputName = fileState.selectedFilePath.split(/[\\/]/).pop();
    const outputName = 'output.wav';

    // Process with FFmpeg.wasm
    updateProgress(5);
    statusMessage.textContent = 'Loading FFmpeg...';

    const outputData = await processAudioWithFFmpeg(
      new Uint8Array(inputData),
      inputName,
      outputName,
      settings,
      updateProgress
    );

    if (processingCancelled) {
      throw new Error('Cancelled');
    }

    // Write output file via IPC (pass Uint8Array directly - more efficient)
    updateProgress(98);
    statusMessage.textContent = 'Saving file...';
    await window.electronAPI.writeFileData(outputPath, outputData);

    updateProgress(100);
    statusMessage.textContent = '✓ Export complete! Your mastered file is ready.';
    statusMessage.className = 'status-message success';

  } catch (error) {
    if (processingCancelled || error.message === 'Cancelled') {
      statusMessage.textContent = 'Export cancelled.';
      statusMessage.className = 'status-message';
    } else {
      console.error('Processing error:', error);
      statusMessage.textContent = `✗ Error: ${error.message || error}`;
      statusMessage.className = 'status-message error';
    }
  }

  isProcessing = false;
  progressContainer.classList.add('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  processBtn.disabled = false;
});

cancelBtn.addEventListener('click', () => {
  if (isProcessing) {
    processingCancelled = true;
    isProcessing = false;
  }
});

// ============================================================================
// Settings & Checklist
// ============================================================================

function updateChecklist() {
  miniLufs.classList.toggle('active', normalizeLoudness.checked);
  miniPeak.classList.toggle('active', truePeakLimit.checked);
  miniFormat.classList.toggle('active', fileState.selectedFilePath !== null);
}

[normalizeLoudness, truePeakLimit, cleanLowEnd, glueCompression, centerBass, cutMud, addAir, tameHarsh].forEach(el => {
  el.addEventListener('change', () => {
    updateAudioChain();
    updateChecklist();
  });
});

truePeakSlider.addEventListener('input', () => {
  ceilingValue.textContent = `${truePeakSlider.value} dB`;
  updateAudioChain();
});

// Output format presets
const outputPresets = {
  streaming: { sampleRate: 44100, bitDepth: 16 },
  studio: { sampleRate: 48000, bitDepth: 24 }
};

document.querySelectorAll('.output-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = outputPresets[btn.dataset.preset];
    if (preset) {
      sampleRate.value = preset.sampleRate;
      bitDepth.value = preset.bitDepth;

      document.querySelectorAll('.output-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });
});

[sampleRate, bitDepth].forEach(el => {
  el.addEventListener('change', () => {
    const currentRate = parseInt(sampleRate.value);
    const currentDepth = parseInt(bitDepth.value);

    document.querySelectorAll('.output-preset-btn').forEach(btn => {
      const preset = outputPresets[btn.dataset.preset];
      const isMatch = preset.sampleRate === currentRate && preset.bitDepth === currentDepth;
      btn.classList.toggle('active', isMatch);
    });
  });
});

// ============================================================================
// Tooltip System
// ============================================================================

const tooltip = document.getElementById('tooltip');
const showTipsCheckbox = document.getElementById('showTips');
let tooltipTimeout = null;

const savedTipsPref = localStorage.getItem('showTips');
if (savedTipsPref !== null) {
  showTipsCheckbox.checked = savedTipsPref === 'true';
}

showTipsCheckbox.addEventListener('change', () => {
  localStorage.setItem('showTips', showTipsCheckbox.checked);
  if (!showTipsCheckbox.checked) {
    tooltip.classList.remove('visible');
  }
});

document.querySelectorAll('[data-tip]').forEach(el => {
  el.addEventListener('mouseenter', () => {
    if (!showTipsCheckbox.checked) return;

    const tipText = el.getAttribute('data-tip');
    if (!tipText) return;

    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.textContent = tipText;

      const rect = el.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 8;

      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.classList.add('visible');

      const tooltipRect = tooltip.getBoundingClientRect();

      if (left + tooltipRect.width > window.innerWidth - 20) {
        left = window.innerWidth - tooltipRect.width - 20;
      }
      if (top + tooltipRect.height > window.innerHeight - 20) {
        top = rect.top - tooltipRect.height - 8;
      }

      tooltip.style.left = `${Math.max(10, left)}px`;
      tooltip.style.top = `${top}px`;
    }, 400);
  });

  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeout);
    tooltip.classList.remove('visible');
  });
});

// ============================================================================
// Initialize
// ============================================================================

updateChecklist();
