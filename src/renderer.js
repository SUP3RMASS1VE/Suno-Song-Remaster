import { AUDIO_CONSTANTS, validateSettings } from './audioConstants.js';
import { measureLUFS, calculateNormalizationGain } from './lufs.js';
import { encodeWAV } from './wavEncoder.js';

// ─── Settings Persistence ───────────────────────────────────────────────────
const STORAGE_KEY = 'ai-mastering-settings';

function saveSettingsToStorage() {
  try {
    const settings = {
      normalizeLoudness: dom.normalizeLoudness.checked,
      truePeakLimit: dom.truePeakLimit.checked,
      truePeakCeiling: parseFloat(dom.truePeakSlider.value),
      targetLufs: dom.targetLufs ? parseInt(dom.targetLufs.value) : -14,
      inputGain: dom.inputGain ? parseFloat(dom.inputGain.value) : 0,
      stereoWidth: dom.stereoWidth ? parseInt(dom.stereoWidth.value) : 100,
      cleanLowEnd: dom.cleanLowEnd.checked,
      glueCompression: dom.glueCompression.checked,
      centerBass: dom.centerBass.checked,
      cutMud: dom.cutMud.checked,
      addAir: dom.addAir.checked,
      tameHarsh: dom.tameHarsh.checked,
      sampleRate: parseInt(dom.sampleRate.value),
      bitDepth: parseInt(dom.bitDepth.value),
      eqLow: parseFloat(dom.eqLow.value),
      eqLowMid: parseFloat(dom.eqLowMid.value),
      eqMid: parseFloat(dom.eqMid.value),
      eqHighMid: parseFloat(dom.eqHighMid.value),
      eqHigh: parseFloat(dom.eqHigh.value),
      activePreset: document.querySelector('.preset-btn.active')?.dataset.preset || 'flat'
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) { /* ignore storage errors */ }
}

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);

    // Checkboxes
    if (s.normalizeLoudness !== undefined) dom.normalizeLoudness.checked = s.normalizeLoudness;
    if (s.truePeakLimit !== undefined) dom.truePeakLimit.checked = s.truePeakLimit;
    if (s.cleanLowEnd !== undefined) dom.cleanLowEnd.checked = s.cleanLowEnd;
    if (s.glueCompression !== undefined) dom.glueCompression.checked = s.glueCompression;
    if (s.centerBass !== undefined) dom.centerBass.checked = s.centerBass;
    if (s.cutMud !== undefined) dom.cutMud.checked = s.cutMud;
    if (s.addAir !== undefined) dom.addAir.checked = s.addAir;
    if (s.tameHarsh !== undefined) dom.tameHarsh.checked = s.tameHarsh;

    // Sliders / selects
    if (s.truePeakCeiling !== undefined) dom.truePeakSlider.value = s.truePeakCeiling;
    if (s.targetLufs !== undefined && dom.targetLufs) dom.targetLufs.value = s.targetLufs;
    if (s.inputGain !== undefined && dom.inputGain) dom.inputGain.value = s.inputGain;
    if (s.stereoWidth !== undefined && dom.stereoWidth) dom.stereoWidth.value = s.stereoWidth;
    if (s.sampleRate !== undefined) dom.sampleRate.value = s.sampleRate;
    if (s.bitDepth !== undefined) dom.bitDepth.value = s.bitDepth;

    // EQ
    if (s.eqLow !== undefined) dom.eqLow.value = s.eqLow;
    if (s.eqLowMid !== undefined) dom.eqLowMid.value = s.eqLowMid;
    if (s.eqMid !== undefined) dom.eqMid.value = s.eqMid;
    if (s.eqHighMid !== undefined) dom.eqHighMid.value = s.eqHighMid;
    if (s.eqHigh !== undefined) dom.eqHigh.value = s.eqHigh;

    // Preset highlight
    if (s.activePreset) {
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.preset === s.activePreset);
      });
    }

    // Update display values
    if (dom.ceilingValue) dom.ceilingValue.textContent = `${parseFloat(dom.truePeakSlider.value).toFixed(1)} dB`;
    if (dom.targetLufsValue && dom.targetLufs) dom.targetLufsValue.textContent = `${dom.targetLufs.value} LUFS`;
    if (dom.inputGainValue && dom.inputGain) dom.inputGainValue.textContent = `${parseFloat(dom.inputGain.value).toFixed(1)} dB`;
    if (dom.stereoWidthValue && dom.stereoWidth) dom.stereoWidthValue.textContent = `${dom.stereoWidth.value}%`;
  } catch (e) { /* ignore parse errors */ }
}

// ─── Undo / Redo ────────────────────────────────────────────────────────────
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function captureState() {
  return {
    normalizeLoudness: dom.normalizeLoudness.checked,
    truePeakLimit: dom.truePeakLimit.checked,
    truePeakCeiling: parseFloat(dom.truePeakSlider.value),
    targetLufs: dom.targetLufs ? parseInt(dom.targetLufs.value) : -14,
    inputGain: dom.inputGain ? parseFloat(dom.inputGain.value) : 0,
    stereoWidth: dom.stereoWidth ? parseInt(dom.stereoWidth.value) : 100,
    cleanLowEnd: dom.cleanLowEnd.checked,
    glueCompression: dom.glueCompression.checked,
    centerBass: dom.centerBass.checked,
    cutMud: dom.cutMud.checked,
    addAir: dom.addAir.checked,
    tameHarsh: dom.tameHarsh.checked,
    eqLow: parseFloat(dom.eqLow.value),
    eqLowMid: parseFloat(dom.eqLowMid.value),
    eqMid: parseFloat(dom.eqMid.value),
    eqHighMid: parseFloat(dom.eqHighMid.value),
    eqHigh: parseFloat(dom.eqHigh.value)
  };
}

function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

function applyState(s) {
  dom.normalizeLoudness.checked = s.normalizeLoudness;
  dom.truePeakLimit.checked = s.truePeakLimit;
  dom.truePeakSlider.value = s.truePeakCeiling;
  if (dom.targetLufs) dom.targetLufs.value = s.targetLufs;
  if (dom.inputGain) dom.inputGain.value = s.inputGain;
  if (dom.stereoWidth) dom.stereoWidth.value = s.stereoWidth;
  dom.cleanLowEnd.checked = s.cleanLowEnd;
  dom.glueCompression.checked = s.glueCompression;
  dom.centerBass.checked = s.centerBass;
  dom.cutMud.checked = s.cutMud;
  dom.addAir.checked = s.addAir;
  dom.tameHarsh.checked = s.tameHarsh;
  dom.eqLow.value = s.eqLow;
  dom.eqLowMid.value = s.eqLowMid;
  dom.eqMid.value = s.eqMid;
  dom.eqHighMid.value = s.eqHighMid;
  dom.eqHigh.value = s.eqHigh;

  // Refresh display values
  if (dom.ceilingValue) dom.ceilingValue.textContent = `${s.truePeakCeiling.toFixed(1)} dB`;
  if (dom.targetLufsValue) dom.targetLufsValue.textContent = `${s.targetLufs} LUFS`;
  if (dom.inputGainValue) dom.inputGainValue.textContent = `${s.inputGain.toFixed(1)} dB`;
  if (dom.stereoWidthValue) dom.stereoWidthValue.textContent = `${s.stereoWidth}%`;

  updateEQ();
  updateAudioChain();
  updateChecklist();
  refreshFaderFills();
  saveSettingsToStorage();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureState());
  applyState(undoStack.pop());
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureState());
  applyState(redoStack.pop());
}

// ─── Global State ───────────────────────────────────────────────────────────
const state = {
  file: {
    path: null,
    buffer: null,
    duration: 0,
    lufs: null,
    normGain: 1.0
  },
  audio: {
    context: null,
    sourceNode: null,
    analyser: null,
    analyserLeft: null,
    analyserRight: null,
    splitter: null,
    nodes: {}
  },
  playback: {
    isPlaying: false,
    startTime: 0,
    pauseTime: 0,
    isSeeking: false,
    seekInterval: null
  },
  meters: {
    interval: null,
    peakHoldLeft: 0,
    peakHoldRight: 0,
    peakHoldTimeLeft: 0,
    peakHoldTimeRight: 0,
    spectrogramAnim: null
  },
  ui: {
    isBypassed: false
  }
};

// ─── DOM Elements ───────────────────────────────────────────────────────────
const dom = {
  // Window controls
  minimizeBtn: document.getElementById('minimizeBtn'),
  maximizeBtn: document.getElementById('maximizeBtn'),
  closeBtn: document.getElementById('closeBtn'),

  // File zone
  selectFileBtn: document.getElementById('selectFile'),
  changeFileBtn: document.getElementById('changeFile'),
  fileZoneContent: document.getElementById('fileZoneContent'),
  fileLoaded: document.getElementById('fileLoaded'),
  fileName: document.getElementById('fileName'),
  fileMeta: document.getElementById('fileMeta'),
  dropZone: document.getElementById('dropZone'),

  // Player
  playBtn: document.getElementById('playBtn'),
  stopBtn: document.getElementById('stopBtn'),
  playIcon: document.getElementById('playIcon'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  waveformProgress: document.getElementById('waveformProgress'),
  currentTimeEl: document.getElementById('currentTime'),
  durationEl: document.getElementById('duration'),
  bypassBtn: document.getElementById('bypassBtn'),

  // Level meters
  meterLeft: document.getElementById('meterLeft'),
  meterRight: document.getElementById('meterRight'),
  peakLeft: document.getElementById('peakLeft'),
  peakRight: document.getElementById('peakRight'),
  meterLeftValue: document.getElementById('meterLeftValue'),
  meterRightValue: document.getElementById('meterRightValue'),
  clipLeft: document.getElementById('clipLeft'),
  clipRight: document.getElementById('clipRight'),

  // Vertical loudness meters
  inputGain: document.getElementById('inputGain'),
  inputGainValue: document.getElementById('inputGainValue'),
  inputFill: document.getElementById('inputFill'),
  ceilingFill: document.getElementById('ceilingFill'),

  // Settings
  normalizeLoudness: document.getElementById('normalizeLoudness'),
  truePeakLimit: document.getElementById('truePeakLimit'),
  truePeakSlider: document.getElementById('truePeakCeiling'),
  ceilingValue: document.getElementById('ceilingValue'),
  targetLufs: document.getElementById('targetLufs'),
  targetLufsValue: document.getElementById('targetLufsValue'),
  cleanLowEnd: document.getElementById('cleanLowEnd'),
  glueCompression: document.getElementById('glueCompression'),
  centerBass: document.getElementById('centerBass'),
  stereoWidth: document.getElementById('stereoWidth'),
  stereoWidthValue: document.getElementById('stereoWidthValue'),
  cutMud: document.getElementById('cutMud'),
  addAir: document.getElementById('addAir'),
  tameHarsh: document.getElementById('tameHarsh'),
  sampleRate: document.getElementById('sampleRate'),
  bitDepth: document.getElementById('bitDepth'),

  // EQ
  eqLow: document.getElementById('eqLow'),
  eqLowMid: document.getElementById('eqLowMid'),
  eqMid: document.getElementById('eqMid'),
  eqHighMid: document.getElementById('eqHighMid'),
  eqHigh: document.getElementById('eqHigh'),

  // Process
  processBtn: document.getElementById('processBtn'),
  progressContainer: document.getElementById('progressContainer'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  statusMessage: document.getElementById('statusMessage'),

  // Status indicators
  miniLufs: document.getElementById('mini-lufs'),
  miniPeak: document.getElementById('mini-peak'),
  miniFormat: document.getElementById('mini-format'),

  // Tooltip
  tooltip: document.getElementById('tooltip'),
  showTipsCheckbox: document.getElementById('showTips'),
  debugBtn: document.getElementById('debugBtn'),

  // Spectrogram
  spectrogramCanvas: document.getElementById('spectrogramCanvas')
};

// ─── Window Controls ────────────────────────────────────────────────────────
dom.minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
dom.maximizeBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
dom.closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());

// ─── Audio Context ──────────────────────────────────────────────────────────
function initAudioContext() {
  if (!state.audio.context) {
    state.audio.context = new AudioContext();
  }
  return state.audio.context;
}

// ─── Shared Audio Chain Configuration (DRY) ─────────────────────────────────
function configureEQNodes(nodes) {
  nodes.eqLow.type = 'lowshelf';
  nodes.eqLow.frequency.value = AUDIO_CONSTANTS.FREQ_LOW;

  nodes.eqLowMid.type = 'peaking';
  nodes.eqLowMid.frequency.value = AUDIO_CONSTANTS.FREQ_LOW_MID;
  nodes.eqLowMid.Q.value = 1;

  nodes.eqMid.type = 'peaking';
  nodes.eqMid.frequency.value = AUDIO_CONSTANTS.FREQ_MID;
  nodes.eqMid.Q.value = 1;

  nodes.eqHighMid.type = 'peaking';
  nodes.eqHighMid.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH_MID;
  nodes.eqHighMid.Q.value = 1;

  nodes.eqHigh.type = 'highshelf';
  nodes.eqHigh.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH;
}

function configureFilterNodes(nodes, settings = null) {
  const s = settings || {};

  nodes.highpass.type = 'highpass';
  nodes.highpass.frequency.value = (s.cleanLowEnd !== undefined ? s.cleanLowEnd : true)
    ? AUDIO_CONSTANTS.HIGHPASS_FREQ : 1;
  nodes.highpass.Q.value = 0.7;

  nodes.lowshelf.type = 'peaking';
  nodes.lowshelf.frequency.value = AUDIO_CONSTANTS.MUD_CUT_FREQ;
  nodes.lowshelf.Q.value = 1.5;
  nodes.lowshelf.gain.value = s.cutMud ? -3 : 0;

  nodes.highshelf.type = 'highshelf';
  nodes.highshelf.frequency.value = AUDIO_CONSTANTS.AIR_FREQ;
  nodes.highshelf.gain.value = s.addAir ? 2.5 : 0;

  nodes.midPeak.type = 'peaking';
  nodes.midPeak.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_1;
  nodes.midPeak.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_4K;
  nodes.midPeak.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_4K : 0;

  nodes.midPeak2.type = 'peaking';
  nodes.midPeak2.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_2;
  nodes.midPeak2.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_6K;
  nodes.midPeak2.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_6K : 0;

  if (s.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
    // Will be overridden by updateAudioChain for preview
  }

  nodes.limiter.threshold.value = -1;
  nodes.limiter.knee.value = 0;
  nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  nodes.limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
  nodes.limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;
}

/**
 * Create all audio nodes for a given AudioContext.
 * Used by both real-time preview and offline export.
 */
function createProcessingNodes(ctx) {
  const nodes = {};
  nodes.inputGain = ctx.createGain();
  nodes.gain = ctx.createGain();
  nodes.normGain = ctx.createGain();
  nodes.highpass = ctx.createBiquadFilter();
  nodes.lowshelf = ctx.createBiquadFilter();
  nodes.highshelf = ctx.createBiquadFilter();
  nodes.midPeak = ctx.createBiquadFilter();
  nodes.midPeak2 = ctx.createBiquadFilter();
  nodes.compressor = ctx.createDynamicsCompressor();
  nodes.limiter = ctx.createDynamicsCompressor();

  // Stereo width processing (mid-side)
  nodes.stereoSplitter = ctx.createChannelSplitter(2);
  nodes.stereoMerger = ctx.createChannelMerger(2);
  nodes.midGain = ctx.createGain();
  nodes.sideGain = ctx.createGain();
  nodes.leftToMid = ctx.createGain();
  nodes.rightToMid = ctx.createGain();
  nodes.leftToSide = ctx.createGain();
  nodes.rightToSide = ctx.createGain();
  nodes.midToLeft = ctx.createGain();
  nodes.midToRight = ctx.createGain();
  nodes.sideToLeft = ctx.createGain();
  nodes.sideToRight = ctx.createGain();

  // 5-band EQ
  nodes.eqLow = ctx.createBiquadFilter();
  nodes.eqLowMid = ctx.createBiquadFilter();
  nodes.eqMid = ctx.createBiquadFilter();
  nodes.eqHighMid = ctx.createBiquadFilter();
  nodes.eqHigh = ctx.createBiquadFilter();

  return nodes;
}

// ─── Preview Audio Chain ────────────────────────────────────────────────────
function createAudioChain() {
  const ctx = initAudioContext();

  // Analysers — use smaller FFT for level meters (faster)
  state.audio.analyser = ctx.createAnalyser();
  state.audio.analyser.fftSize = 2048; // keep 2048 for spectrogram
  state.audio.analyser.smoothingTimeConstant = 0.3;

  state.audio.splitter = ctx.createChannelSplitter(2);
  state.audio.analyserLeft = ctx.createAnalyser();
  state.audio.analyserLeft.fftSize = 512;
  state.audio.analyserLeft.smoothingTimeConstant = 0;

  state.audio.analyserRight = ctx.createAnalyser();
  state.audio.analyserRight.fftSize = 512;
  state.audio.analyserRight.smoothingTimeConstant = 0;

  // Create nodes using shared factory
  state.audio.nodes = createProcessingNodes(ctx);
  const nodes = state.audio.nodes;

  configureEQNodes(nodes);
  configureFilterNodes(nodes);

  updateAudioChain();
  updateEQ();
}

function updateAudioChain() {
  if (!state.audio.context) return;

  const nodes = state.audio.nodes;
  const bypassed = state.ui.isBypassed;

  if (nodes.inputGain && dom.inputGain) {
    const inputDb = bypassed ? 0 : parseFloat(dom.inputGain.value);
    nodes.inputGain.gain.value = Math.pow(10, inputDb / 20);
  }

  nodes.highpass.frequency.value = (dom.cleanLowEnd.checked && !bypassed)
    ? AUDIO_CONSTANTS.HIGHPASS_FREQ : 1;

  nodes.lowshelf.gain.value = (dom.cutMud.checked && !bypassed) ? -3 : 0;
  nodes.highshelf.gain.value = (dom.addAir.checked && !bypassed) ? 2.5 : 0;

  if (dom.tameHarsh.checked && !bypassed) {
    nodes.midPeak.gain.value = AUDIO_CONSTANTS.HARSHNESS_GAIN_4K;
    nodes.midPeak2.gain.value = AUDIO_CONSTANTS.HARSHNESS_GAIN_6K;
  } else {
    nodes.midPeak.gain.value = 0;
    nodes.midPeak2.gain.value = 0;
  }

  if (dom.glueCompression.checked && !bypassed) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
  } else {
    nodes.compressor.threshold.value = 0;
    nodes.compressor.ratio.value = 1;
  }

  if (dom.truePeakLimit.checked && !bypassed) {
    const ceiling = parseFloat(dom.truePeakSlider.value);
    nodes.limiter.threshold.value = ceiling;
    nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  } else {
    nodes.limiter.threshold.value = 0;
    nodes.limiter.ratio.value = 1;
  }

  if (nodes.midGain && nodes.sideGain && dom.stereoWidth) {
    const width = bypassed ? 100 : parseInt(dom.stereoWidth.value);
    const sideLevel = width / 100;
    nodes.sideGain.gain.value = sideLevel;
  }

  if (nodes.normGain) {
    if (dom.normalizeLoudness.checked && !bypassed && state.file.normGain !== 1.0) {
      nodes.normGain.gain.value = state.file.normGain;
    } else {
      nodes.normGain.gain.value = 1.0;
    }
  }
}

function connectAudioChain(source) {
  const nodes = state.audio.nodes;

  source
    .connect(nodes.inputGain)
    .connect(nodes.highpass)
    .connect(nodes.eqLow)
    .connect(nodes.eqLowMid)
    .connect(nodes.eqMid)
    .connect(nodes.eqHighMid)
    .connect(nodes.eqHigh)
    .connect(nodes.lowshelf)
    .connect(nodes.midPeak)
    .connect(nodes.midPeak2)
    .connect(nodes.highshelf)
    .connect(nodes.compressor)
    .connect(nodes.limiter);

  // Mid-side stereo width
  nodes.limiter.connect(nodes.stereoSplitter);

  nodes.stereoSplitter.connect(nodes.leftToMid, 0);
  nodes.stereoSplitter.connect(nodes.rightToMid, 1);
  nodes.leftToMid.gain.value = 0.5;
  nodes.rightToMid.gain.value = 0.5;
  nodes.leftToMid.connect(nodes.midGain);
  nodes.rightToMid.connect(nodes.midGain);

  nodes.stereoSplitter.connect(nodes.leftToSide, 0);
  nodes.stereoSplitter.connect(nodes.rightToSide, 1);
  nodes.leftToSide.gain.value = 0.5;
  nodes.rightToSide.gain.value = -0.5;
  nodes.leftToSide.connect(nodes.sideGain);
  nodes.rightToSide.connect(nodes.sideGain);

  nodes.midGain.gain.value = 1;
  nodes.sideGain.gain.value = 1;

  nodes.midToLeft.gain.value = 1;
  nodes.midToRight.gain.value = 1;
  nodes.sideToLeft.gain.value = 1;
  nodes.sideToRight.gain.value = -1;

  nodes.midGain.connect(nodes.midToLeft);
  nodes.midGain.connect(nodes.midToRight);
  nodes.sideGain.connect(nodes.sideToLeft);
  nodes.sideGain.connect(nodes.sideToRight);

  nodes.midToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.sideToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.midToRight.connect(nodes.stereoMerger, 0, 1);
  nodes.sideToRight.connect(nodes.stereoMerger, 0, 1);

  nodes.stereoMerger
    .connect(nodes.normGain)
    .connect(state.audio.analyser)
    .connect(nodes.gain);

  nodes.gain.connect(state.audio.splitter);
  state.audio.splitter.connect(state.audio.analyserLeft, 0);
  state.audio.splitter.connect(state.audio.analyserRight, 1);

  nodes.gain.connect(state.audio.context.destination);
}

// ─── EQ ─────────────────────────────────────────────────────────────────────
function updateEQ() {
  const nodes = state.audio.nodes;
  if (!nodes.eqLow) return;

  if (state.ui.isBypassed) {
    nodes.eqLow.gain.value = 0;
    nodes.eqLowMid.gain.value = 0;
    nodes.eqMid.gain.value = 0;
    nodes.eqHighMid.gain.value = 0;
    nodes.eqHigh.gain.value = 0;
  } else {
    nodes.eqLow.gain.value = parseFloat(dom.eqLow.value);
    nodes.eqLowMid.gain.value = parseFloat(dom.eqLowMid.value);
    nodes.eqMid.gain.value = parseFloat(dom.eqMid.value);
    nodes.eqHighMid.gain.value = parseFloat(dom.eqHighMid.value);
    nodes.eqHigh.gain.value = parseFloat(dom.eqHigh.value);
  }

  document.getElementById('eqLowVal').textContent = `${dom.eqLow.value} dB`;
  document.getElementById('eqLowMidVal').textContent = `${dom.eqLowMid.value} dB`;
  document.getElementById('eqMidVal').textContent = `${dom.eqMid.value} dB`;
  document.getElementById('eqHighMidVal').textContent = `${dom.eqHighMid.value} dB`;
  document.getElementById('eqHighVal').textContent = `${dom.eqHigh.value} dB`;

  updateEQFill('eqLow', 'eqLowFill');
  updateEQFill('eqLowMid', 'eqLowMidFill');
  updateEQFill('eqMid', 'eqMidFill');
  updateEQFill('eqHighMid', 'eqHighMidFill');
  updateEQFill('eqHigh', 'eqHighFill');
}

function updateEQFill(sliderId, fillId) {
  const slider = document.getElementById(sliderId);
  const fill = document.getElementById(fillId);
  if (!slider || !fill) return;

  const value = parseFloat(slider.value);
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const range = max - min;
  const center = 50;

  const percent = ((value - min) / range) * 100;

  if (value >= 0) {
    fill.style.bottom = `${center}%`;
    fill.style.top = 'auto';
    fill.style.height = `${percent - center}%`;
  } else {
    fill.style.top = `${100 - center}%`;
    fill.style.bottom = 'auto';
    fill.style.height = `${center - percent}%`;
  }
}

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
      pushUndo();
      dom.eqLow.value = preset.low;
      dom.eqLowMid.value = preset.lowMid;
      dom.eqMid.value = preset.mid;
      dom.eqHighMid.value = preset.highMid;
      dom.eqHigh.value = preset.high;
      updateEQ();

      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveSettingsToStorage();
    }
  });
});

[dom.eqLow, dom.eqLowMid, dom.eqMid, dom.eqHighMid, dom.eqHigh].forEach(slider => {
  slider.addEventListener('input', () => {
    updateEQ();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    saveSettingsToStorage();
  });
  // Push undo on mousedown (start of drag)
  slider.addEventListener('mousedown', () => pushUndo());
});

// ─── File Loading ───────────────────────────────────────────────────────────
async function loadAudioFile(filePath) {
  const ctx = initAudioContext();

  try {
    const arrayData = await window.electronAPI.readAudioFile(filePath);
    const uint8Array = new Uint8Array(arrayData);
    state.file.buffer = await ctx.decodeAudioData(uint8Array.buffer);

    dom.fileMeta.textContent = 'Analyzing loudness...';
    const lufsResult = measureLUFS(state.file.buffer);
    state.file.lufs = lufsResult.integratedLUFS;
    const targetLufs = dom.targetLufs ? parseInt(dom.targetLufs.value) : AUDIO_CONSTANTS.TARGET_LUFS;
    state.file.normGain = calculateNormalizationGain(state.file.lufs, targetLufs);

    createAudioChain();

    state.file.duration = state.file.buffer.duration;
    dom.durationEl.textContent = formatTime(state.file.duration);

    const sampleRate = state.file.buffer.sampleRate;
    const channels = state.file.buffer.numberOfChannels;
    const lufsDisplay = isFinite(state.file.lufs) ? `${state.file.lufs.toFixed(1)} LUFS` : 'N/A';
    dom.fileMeta.textContent = `${Math.round(sampleRate / 1000)}kHz • ${channels}ch • ${formatTime(state.file.duration)} • ${lufsDisplay}`;

    drawWaveform();

    dom.playBtn.disabled = false;
    dom.stopBtn.disabled = false;
    dom.processBtn.disabled = false;

    return true;
  } catch (error) {
    console.error('Error loading audio:', error);
    dom.statusMessage.textContent = `✗ Error loading audio: ${error.message}`;
    dom.statusMessage.className = 'status-message error visible';
    setTimeout(() => dom.statusMessage.classList.remove('visible'), 6000);
    return false;
  }
}

// ─── Waveform ───────────────────────────────────────────────────────────────
function drawWaveform() {
  if (!state.file.buffer || !dom.waveformCanvas) return;

  const canvas = dom.waveformCanvas;
  const ctx = canvas.getContext('2d');

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const width = rect.width;
  const height = rect.height;

  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, width, height);

  const data = state.file.buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = '#a855f7';

  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;

    for (let j = 0; j < step; j++) {
      const datum = data[(i * step) + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }

    const y1 = (1 + min) * amp;
    const y2 = (1 + max) * amp;

    ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
  }
}

// ─── Playback ───────────────────────────────────────────────────────────────
function playAudio() {
  if (!state.file.buffer || !state.audio.context) return;

  if (state.audio.context.state === 'suspended') {
    state.audio.context.resume();
  }

  stopAudio();

  state.audio.sourceNode = state.audio.context.createBufferSource();
  state.audio.sourceNode.buffer = state.file.buffer;

  connectAudioChain(state.audio.sourceNode);

  state.audio.sourceNode.onended = () => {
    if (state.playback.isPlaying) {
      state.playback.isPlaying = false;
      dom.playIcon.textContent = '▶';
      clearInterval(state.playback.seekInterval);
    }
  };

  const offset = state.playback.pauseTime;
  state.playback.startTime = state.audio.context.currentTime - offset;
  state.audio.sourceNode.start(0, offset);
  state.playback.isPlaying = true;
  dom.playIcon.textContent = '⏸';

  startLevelMeters();
  startSeekUpdate();
  startSpectrogram();
}

function pauseAudio() {
  if (!state.playback.isPlaying) return;
  state.playback.pauseTime = state.audio.context.currentTime - state.playback.startTime;
  stopAudio();
}

function stopAudio() {
  if (state.audio.sourceNode) {
    try {
      state.audio.sourceNode.onended = null;
      state.audio.sourceNode.stop();
      state.audio.sourceNode.disconnect();
    } catch (e) { /* already stopped */ }
    state.audio.sourceNode = null;
  }
  state.playback.isPlaying = false;
  dom.playIcon.textContent = '▶';
  clearInterval(state.playback.seekInterval);
  stopLevelMeters();
}

function startSeekUpdate() {
  clearInterval(state.playback.seekInterval);

  state.playback.seekInterval = setInterval(() => {
    if (state.playback.isPlaying && state.file.buffer && !state.playback.isSeeking) {
      const currentTime = state.audio.context.currentTime - state.playback.startTime;
      if (currentTime >= state.file.duration) {
        stopAudio();
        state.playback.pauseTime = 0;
        dom.waveformProgress.style.width = '0%';
        dom.currentTimeEl.textContent = '0:00';
      } else {
        const progress = (currentTime / state.file.duration) * 100;
        dom.waveformProgress.style.width = `${progress}%`;
        dom.currentTimeEl.textContent = formatTime(currentTime);
      }
    }
  }, 100);
}

function seekTo(time) {
  time = Math.max(0, Math.min(time, state.file.duration));
  const wasPlaying = state.playback.isPlaying;

  // Set seeking flag to prevent race conditions
  state.playback.isSeeking = true;
  state.playback.pauseTime = time;

  dom.currentTimeEl.textContent = formatTime(time);
  const progress = (time / state.file.duration) * 100;
  dom.waveformProgress.style.width = `${progress}%`;

  if (wasPlaying) {
    if (state.audio.sourceNode) {
      try {
        state.audio.sourceNode.onended = null;
        state.audio.sourceNode.stop();
        state.audio.sourceNode.disconnect();
      } catch (e) { /* already stopped */ }
      state.audio.sourceNode = null;
    }
    clearInterval(state.playback.seekInterval);
    stopLevelMeters();

    if (state.audio.context.state === 'suspended') {
      state.audio.context.resume();
    }

    state.audio.sourceNode = state.audio.context.createBufferSource();
    state.audio.sourceNode.buffer = state.file.buffer;
    connectAudioChain(state.audio.sourceNode);

    state.audio.sourceNode.onended = () => {
      if (state.playback.isPlaying && !state.playback.isSeeking) {
        state.playback.isPlaying = false;
        state.playback.pauseTime = 0;
        dom.playIcon.textContent = '▶';
        dom.waveformProgress.style.width = '0%';
        dom.currentTimeEl.textContent = '0:00';
        clearInterval(state.playback.seekInterval);
        stopLevelMeters();
      }
    };

    state.playback.startTime = state.audio.context.currentTime - time;
    state.audio.sourceNode.start(0, time);
    state.playback.isPlaying = true;

    startLevelMeters();
    startSeekUpdate();
    startSpectrogram();
  }

  // Clear seeking flag after a short delay to avoid race conditions
  setTimeout(() => { state.playback.isSeeking = false; }, 50);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─── Level Meters ───────────────────────────────────────────────────────────
function startLevelMeters() {
  if (!state.audio.analyserLeft || !state.audio.analyserRight) return;

  stopLevelMeters();

  const bufferLength = state.audio.analyserLeft.frequencyBinCount;
  const dataArrayLeft = new Uint8Array(bufferLength);
  const dataArrayRight = new Uint8Array(bufferLength);

  state.meters.interval = setInterval(() => {
    if (!state.playback.isPlaying) return;

    state.audio.analyserLeft.getByteTimeDomainData(dataArrayLeft);
    state.audio.analyserRight.getByteTimeDomainData(dataArrayRight);

    let peakL = 0;
    let peakR = 0;

    for (let i = 0; i < bufferLength; i++) {
      const normalizedL = (dataArrayLeft[i] - 128) / 128;
      const normalizedR = (dataArrayRight[i] - 128) / 128;
      peakL = Math.max(peakL, Math.abs(normalizedL));
      peakR = Math.max(peakR, Math.abs(normalizedR));
    }

    const dbL = peakL > 0 ? 20 * Math.log10(peakL) : -Infinity;
    const dbR = peakR > 0 ? 20 * Math.log10(peakR) : -Infinity;

    const percentL = Math.max(0, Math.min(100, ((dbL + 60) / 60) * 100));
    const percentR = Math.max(0, Math.min(100, ((dbR + 60) / 60) * 100));

    dom.meterLeft.style.width = `${percentL}%`;
    dom.meterRight.style.width = `${percentR}%`;

    const now = Date.now();

    if (percentL > state.meters.peakHoldLeft || now - state.meters.peakHoldTimeLeft > 1500) {
      state.meters.peakHoldLeft = percentL;
      state.meters.peakHoldTimeLeft = now;
    }

    if (percentR > state.meters.peakHoldRight || now - state.meters.peakHoldTimeRight > 1500) {
      state.meters.peakHoldRight = percentR;
      state.meters.peakHoldTimeRight = now;
    }

    if (state.meters.peakHoldLeft > 0) {
      dom.peakLeft.style.left = `${state.meters.peakHoldLeft}%`;
      dom.peakLeft.classList.add('visible');
    } else {
      dom.peakLeft.classList.remove('visible');
    }

    if (state.meters.peakHoldRight > 0) {
      dom.peakRight.style.left = `${state.meters.peakHoldRight}%`;
      dom.peakRight.classList.add('visible');
    } else {
      dom.peakRight.classList.remove('visible');
    }

    const displayDbL = dbL === -Infinity ? '-∞' : dbL.toFixed(1);
    const displayDbR = dbR === -Infinity ? '-∞' : dbR.toFixed(1);

    dom.meterLeftValue.textContent = `${displayDbL} dB`;
    dom.meterRightValue.textContent = `${displayDbR} dB`;

    const isClippingL = dbL > -0.5;
    const isClippingR = dbR > -0.5;

    dom.meterLeftValue.classList.toggle('overload', isClippingL);
    dom.meterRightValue.classList.toggle('overload', isClippingR);

    if (dom.clipLeft) dom.clipLeft.classList.toggle('visible', isClippingL);
    if (dom.clipRight) dom.clipRight.classList.toggle('visible', isClippingR);
  }, 50);
}

function stopLevelMeters() {
  if (state.meters.interval) {
    clearInterval(state.meters.interval);
    state.meters.interval = null;
  }

  if (state.meters.spectrogramAnim) {
    cancelAnimationFrame(state.meters.spectrogramAnim);
    state.meters.spectrogramAnim = null;
  }

  dom.meterLeft.style.width = '0%';
  dom.meterRight.style.width = '0%';
  dom.peakLeft.classList.remove('visible');
  dom.peakRight.classList.remove('visible');
  dom.meterLeftValue.textContent = '-∞ dB';
  dom.meterRightValue.textContent = '-∞ dB';
  dom.meterLeftValue.classList.remove('overload');
  dom.meterRightValue.classList.remove('overload');

  if (dom.clipLeft) dom.clipLeft.classList.remove('visible');
  if (dom.clipRight) dom.clipRight.classList.remove('visible');

  state.meters.peakHoldLeft = 0;
  state.meters.peakHoldRight = 0;
  state.meters.peakHoldTimeLeft = 0;
  state.meters.peakHoldTimeRight = 0;

  // Clear spectrogram
  if (dom.spectrogramCanvas) {
    const ctx = dom.spectrogramCanvas.getContext('2d');
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, dom.spectrogramCanvas.width, dom.spectrogramCanvas.height);
  }
}

// ─── Spectrogram (complete implementation) ──────────────────────────────────
function startSpectrogram() {
  if (!state.audio.analyser || !dom.spectrogramCanvas) return;

  // Cancel any existing animation
  if (state.meters.spectrogramAnim) {
    cancelAnimationFrame(state.meters.spectrogramAnim);
    state.meters.spectrogramAnim = null;
  }

  const canvas = dom.spectrogramCanvas;
  const ctx = canvas.getContext('2d');

  // Set canvas size once
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const width = rect.width;
  const height = rect.height;

  const analyser = state.audio.analyser;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  // Create offscreen canvas once (outside draw loop)
  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const offCtx = offscreen.getContext('2d');
  offCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // Clear both canvases
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, width, height);
  offCtx.fillStyle = '#0a0a1a';
  offCtx.fillRect(0, 0, width, height);

  // Throttle to ~30fps for performance
  let lastDrawTime = 0;
  const FRAME_INTERVAL = 1000 / 30;

  function getColor(value) {
    const normalized = value / 255;
    let r, g, b;

    if (normalized < 0.2) {
      const t = normalized / 0.2;
      r = 0; g = 0; b = Math.floor(50 + t * 150);
    } else if (normalized < 0.4) {
      const t = (normalized - 0.2) / 0.2;
      r = 0; g = Math.floor(t * 255); b = 200;
    } else if (normalized < 0.6) {
      const t = (normalized - 0.4) / 0.2;
      r = 0; g = 255; b = Math.floor(200 * (1 - t));
    } else if (normalized < 0.8) {
      const t = (normalized - 0.6) / 0.2;
      r = Math.floor(t * 255); g = 255; b = 0;
    } else {
      const t = (normalized - 0.8) / 0.2;
      r = 255; g = Math.floor(255 * (1 - t)); b = 0;
    }

    return `rgb(${r},${g},${b})`;
  }

  function draw(timestamp) {
    if (!state.playback.isPlaying) return;

    state.meters.spectrogramAnim = requestAnimationFrame(draw);

    // Throttle
    if (timestamp - lastDrawTime < FRAME_INTERVAL) return;
    lastDrawTime = timestamp;

    analyser.getByteFrequencyData(dataArray);

    // Shift existing image left by 2 pixels
    offCtx.drawImage(offscreen, -2, 0);

    // Draw new column on the right
    const columnWidth = 2;
    const x = width - columnWidth;

    // Draw frequency bins (logarithmic scale, low freq at bottom)
    for (let i = 0; i < height; i++) {
      const freqRatio = 1 - (i / height);
      const binIndex = Math.floor(Math.pow(freqRatio, 2) * bufferLength * 0.5);
      const value = dataArray[binIndex] || 0;

      offCtx.fillStyle = getColor(value);
      offCtx.fillRect(x, i, columnWidth, 1);
    }

    // Copy to main canvas
    ctx.drawImage(offscreen, 0, 0, width, height, 0, 0, width, height);
  }

  state.meters.spectrogramAnim = requestAnimationFrame(draw);
}

// ─── File Events ────────────────────────────────────────────────────────────
dom.selectFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) await loadFile(filePath);
});

dom.changeFileBtn.addEventListener('click', async () => {
  const filePath = await window.electronAPI.selectFile();
  if (filePath) {
    stopAudio();
    state.playback.pauseTime = 0;
    await loadFile(filePath);
  }
});

async function loadFile(filePath) {
  if (!filePath) return;

  state.file.path = filePath;

  try {
    const name = filePath.split(/[\\/]/).pop();
    dom.fileName.textContent = name;
    dom.fileMeta.textContent = 'Loading...';

    dom.fileZoneContent.classList.add('hidden');
    dom.fileLoaded.classList.remove('hidden');

    await loadAudioFile(filePath);
    updateChecklist();
  } catch (error) {
    console.error('Error loading file:', error);
    dom.statusMessage.textContent = `✗ Error: ${error.message}`;
    dom.statusMessage.className = 'status-message error visible';
    setTimeout(() => dom.statusMessage.classList.remove('visible'), 6000);
  }
}

dom.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dom.dropZone.classList.add('drag-over');
});

dom.dropZone.addEventListener('dragleave', () => {
  dom.dropZone.classList.remove('drag-over');
});

dom.dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dom.dropZone.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (file && /\.(mp3|wav|flac|aac|m4a)$/i.test(file.name)) {
    const filePath = window.electronAPI.getPathForFile(file);
    if (filePath) {
      stopAudio();
      state.playback.pauseTime = 0;
      await loadFile(filePath);
    }
  }
});

// ─── Player Controls ────────────────────────────────────────────────────────
dom.playBtn.addEventListener('click', () => {
  state.playback.isPlaying ? pauseAudio() : playAudio();
});

dom.stopBtn.addEventListener('click', () => {
  stopAudio();
  state.playback.pauseTime = 0;
  dom.waveformProgress.style.width = '0%';
  dom.currentTimeEl.textContent = '0:00';
});

dom.waveformCanvas.addEventListener('click', (e) => {
  if (!state.file.buffer) return;

  const rect = dom.waveformCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percent = x / rect.width;
  const time = percent * state.file.duration;

  seekTo(time);
});

dom.bypassBtn.addEventListener('click', () => {
  state.ui.isBypassed = !state.ui.isBypassed;
  dom.bypassBtn.textContent = state.ui.isBypassed ? '🔇 FX Off' : '🔊 FX On';
  dom.bypassBtn.classList.toggle('active', state.ui.isBypassed);
  updateAudioChain();
  updateEQ();
});

// ─── Offline Export (uses shared node factory, no duplicate stereo width) ────
async function processAudioOffline(settings) {
  const inputBuffer = state.file.buffer;
  const targetSampleRate = settings.sampleRate;
  const numChannels = inputBuffer.numberOfChannels;

  const outputLength = Math.ceil(inputBuffer.length * targetSampleRate / inputBuffer.sampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, outputLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // Use shared node factory
  const nodes = createProcessingNodes(offlineCtx);

  // Configure input gain
  const inputGainDb = settings.inputGain || 0;
  nodes.inputGain.gain.value = Math.pow(10, inputGainDb / 20);

  // Configure EQ
  configureEQNodes(nodes);
  nodes.eqLow.gain.value = settings.eqLow;
  nodes.eqLowMid.gain.value = settings.eqLowMid;
  nodes.eqMid.gain.value = settings.eqMid;
  nodes.eqHighMid.gain.value = settings.eqHighMid;
  nodes.eqHigh.gain.value = settings.eqHigh;

  // Configure filters using shared function
  configureFilterNodes(nodes, settings);

  // Override compressor/limiter based on settings
  if (settings.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = 0;
    nodes.compressor.ratio.value = 1;
  }

  if (settings.truePeakLimit) {
    nodes.limiter.threshold.value = settings.truePeakCeiling;
    nodes.limiter.knee.value = 0;
    nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
    nodes.limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
    nodes.limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;
  } else {
    nodes.limiter.threshold.value = 0;
    nodes.limiter.ratio.value = 1;
  }

  nodes.normGain.gain.value = 1.0;

  // Configure stereo width via mid-side nodes
  const stereoWidth = settings.stereoWidth !== undefined ? settings.stereoWidth : 100;
  const sideLevel = stereoWidth / 100;

  // Connect the chain including mid-side processing
  source
    .connect(nodes.inputGain)
    .connect(nodes.highpass)
    .connect(nodes.eqLow)
    .connect(nodes.eqLowMid)
    .connect(nodes.eqMid)
    .connect(nodes.eqHighMid)
    .connect(nodes.eqHigh)
    .connect(nodes.lowshelf)
    .connect(nodes.midPeak)
    .connect(nodes.midPeak2)
    .connect(nodes.highshelf)
    .connect(nodes.compressor)
    .connect(nodes.limiter);

  // Mid-side stereo width processing (same as preview chain)
  nodes.limiter.connect(nodes.stereoSplitter);

  nodes.stereoSplitter.connect(nodes.leftToMid, 0);
  nodes.stereoSplitter.connect(nodes.rightToMid, 1);
  nodes.leftToMid.gain.value = 0.5;
  nodes.rightToMid.gain.value = 0.5;
  nodes.leftToMid.connect(nodes.midGain);
  nodes.rightToMid.connect(nodes.midGain);

  nodes.stereoSplitter.connect(nodes.leftToSide, 0);
  nodes.stereoSplitter.connect(nodes.rightToSide, 1);
  nodes.leftToSide.gain.value = 0.5;
  nodes.rightToSide.gain.value = -0.5;
  nodes.leftToSide.connect(nodes.sideGain);
  nodes.rightToSide.connect(nodes.sideGain);

  nodes.midGain.gain.value = 1;
  nodes.sideGain.gain.value = sideLevel;

  nodes.midToLeft.gain.value = 1;
  nodes.midToRight.gain.value = 1;
  nodes.sideToLeft.gain.value = 1;
  nodes.sideToRight.gain.value = -1;

  nodes.midGain.connect(nodes.midToLeft);
  nodes.midGain.connect(nodes.midToRight);
  nodes.sideGain.connect(nodes.sideToLeft);
  nodes.sideGain.connect(nodes.sideToRight);

  nodes.midToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.sideToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.midToRight.connect(nodes.stereoMerger, 0, 1);
  nodes.sideToRight.connect(nodes.stereoMerger, 0, 1);

  nodes.stereoMerger
    .connect(nodes.normGain)
    .connect(offlineCtx.destination);

  source.start(0);

  let renderedBuffer = await offlineCtx.startRendering();

  // Loudness normalization (post-render, using same target as preview)
  if (settings.normalizeLoudness) {
    const lufsResult = measureLUFS(renderedBuffer);
    const targetLufs = settings.targetLufs || AUDIO_CONSTANTS.TARGET_LUFS;
    const normGain = calculateNormalizationGain(lufsResult.integratedLUFS, targetLufs);

    if (normGain !== 1.0 && isFinite(normGain)) {
      for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
        const channelData = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] *= normGain;
        }
      }
    }
  }

  return renderedBuffer;
}

// ─── Export ─────────────────────────────────────────────────────────────────
dom.processBtn.addEventListener('click', async () => {
  if (!state.file.path || !state.file.buffer) return;

  const outputPath = await window.electronAPI.saveFile();
  if (!outputPath) return;

  dom.progressContainer.classList.remove('hidden');
  dom.processBtn.disabled = true;
  dom.statusMessage.textContent = '';
  dom.statusMessage.className = 'status-message';

  const settings = validateSettings({
    normalizeLoudness: dom.normalizeLoudness.checked,
    truePeakLimit: dom.truePeakLimit.checked,
    truePeakCeiling: parseFloat(dom.truePeakSlider.value),
    targetLufs: dom.targetLufs ? parseInt(dom.targetLufs.value) : -14,
    inputGain: dom.inputGain ? parseFloat(dom.inputGain.value) : 0,
    stereoWidth: dom.stereoWidth ? parseInt(dom.stereoWidth.value) : 100,
    cleanLowEnd: dom.cleanLowEnd.checked,
    glueCompression: dom.glueCompression.checked,
    centerBass: dom.centerBass.checked,
    cutMud: dom.cutMud.checked,
    addAir: dom.addAir.checked,
    tameHarsh: dom.tameHarsh.checked,
    sampleRate: parseInt(dom.sampleRate.value),
    bitDepth: parseInt(dom.bitDepth.value),
    eqLow: parseFloat(dom.eqLow.value),
    eqLowMid: parseFloat(dom.eqLowMid.value),
    eqMid: parseFloat(dom.eqMid.value),
    eqHighMid: parseFloat(dom.eqHighMid.value),
    eqHigh: parseFloat(dom.eqHigh.value)
  });

  try {
    updateProgress(10);

    const processedBuffer = await processAudioOffline(settings);
    updateProgress(60);

    const wavBuffer = encodeWAV(processedBuffer, {
      bitDepth: settings.bitDepth,
      dither: settings.bitDepth === 16 // TPDF dithering for 16-bit
    });
    updateProgress(80);

    const uint8Array = new Uint8Array(wavBuffer);
    await window.electronAPI.writeFile(outputPath, Array.from(uint8Array));
    updateProgress(100);

    dom.statusMessage.textContent = '✓ Export complete! Your mastered file is ready.';
    dom.statusMessage.className = 'status-message success visible';
    setTimeout(() => dom.statusMessage.classList.remove('visible'), 4000);
  } catch (error) {
    console.error('Export error:', error);
    dom.statusMessage.textContent = `✗ Error: ${error.message}`;
    dom.statusMessage.className = 'status-message error visible';
    setTimeout(() => dom.statusMessage.classList.remove('visible'), 6000);
  }

  dom.progressContainer.classList.add('hidden');
  dom.progressFill.style.width = '0%';
  dom.progressText.textContent = '0%';
  dom.processBtn.disabled = false;
});

function updateProgress(percent) {
  dom.progressFill.style.width = `${percent}%`;
  dom.progressText.textContent = `${percent}%`;
}

// ─── Checklist / Status ─────────────────────────────────────────────────────
function updateChecklist() {
  if (dom.miniLufs) {
    dom.miniLufs.classList.toggle('active', dom.normalizeLoudness.checked);
    const targetLufs = dom.targetLufs ? parseInt(dom.targetLufs.value) : -14;
    dom.miniLufs.textContent = `• ${targetLufs} LUFS`;
  }
  if (dom.miniPeak) {
    dom.miniPeak.classList.toggle('active', dom.truePeakLimit.checked);
  }
  if (dom.miniFormat) {
    dom.miniFormat.classList.toggle('active', state.file.path !== null);
  }
}

// ─── Settings Change Handlers ───────────────────────────────────────────────
[dom.normalizeLoudness, dom.truePeakLimit, dom.cleanLowEnd, dom.glueCompression,
 dom.centerBass, dom.cutMud, dom.addAir, dom.tameHarsh].forEach(el => {
  el.addEventListener('change', () => {
    pushUndo();
    updateAudioChain();
    updateChecklist();
    saveSettingsToStorage();
  });
});

dom.truePeakSlider.addEventListener('mousedown', () => pushUndo());
dom.truePeakSlider.addEventListener('input', () => {
  const ceiling = parseFloat(dom.truePeakSlider.value);
  dom.ceilingValue.textContent = `${ceiling.toFixed(1)} dB`;

  if (dom.ceilingFill) {
    const percent = ((ceiling + 6) / 6) * 100;
    dom.ceilingFill.style.height = `${percent}%`;
  }

  updateAudioChain();
  saveSettingsToStorage();
});

if (dom.inputGain) {
  dom.inputGain.addEventListener('mousedown', () => pushUndo());
  dom.inputGain.addEventListener('input', () => {
    const gain = parseFloat(dom.inputGain.value);
    dom.inputGainValue.textContent = `${gain.toFixed(1)} dB`;

    if (dom.inputFill) {
      const percent = ((gain + 12) / 24) * 100;
      dom.inputFill.style.height = `${percent}%`;
    }

    updateAudioChain();
    saveSettingsToStorage();
  });

  dom.inputGain.addEventListener('dblclick', () => {
    pushUndo();
    dom.inputGain.value = 0;
    dom.inputGainValue.textContent = '0.0 dB';
    if (dom.inputFill) {
      dom.inputFill.style.height = '50%';
    }
    updateAudioChain();
    saveSettingsToStorage();
  });
}

if (dom.stereoWidth) {
  dom.stereoWidth.addEventListener('mousedown', () => pushUndo());
  dom.stereoWidth.addEventListener('input', () => {
    const width = parseInt(dom.stereoWidth.value);
    dom.stereoWidthValue.textContent = `${width}%`;
    updateAudioChain();
    saveSettingsToStorage();
  });
}

if (dom.targetLufs) {
  dom.targetLufs.addEventListener('mousedown', () => pushUndo());
  dom.targetLufs.addEventListener('input', () => {
    const targetLufs = parseInt(dom.targetLufs.value);
    dom.targetLufsValue.textContent = `${targetLufs} LUFS`;

    if (state.file.lufs !== null && isFinite(state.file.lufs)) {
      state.file.normGain = calculateNormalizationGain(state.file.lufs, targetLufs);
      updateAudioChain();
    }

    if (dom.miniLufs) {
      dom.miniLufs.textContent = `• ${targetLufs} LUFS`;
    }
    saveSettingsToStorage();
  });
}

// Save on sample rate / bit depth change
dom.sampleRate.addEventListener('change', saveSettingsToStorage);
dom.bitDepth.addEventListener('change', saveSettingsToStorage);

// ─── Fader Fill Helper ──────────────────────────────────────────────────────
function refreshFaderFills() {
  if (dom.inputFill && dom.inputGain) {
    const percent = ((parseFloat(dom.inputGain.value) + 12) / 24) * 100;
    dom.inputFill.style.height = `${percent}%`;
  }
  if (dom.ceilingFill) {
    const ceiling = parseFloat(dom.truePeakSlider.value);
    const percent = ((ceiling + 6) / 6) * 100;
    dom.ceilingFill.style.height = `${percent}%`;
  }
}

// ─── Tooltips (with boundary clamping) ──────────────────────────────────────
let tooltipTimeout = null;

const savedTipsPref = localStorage.getItem('showTips');
if (savedTipsPref !== null) {
  dom.showTipsCheckbox.checked = savedTipsPref === 'true';
}

dom.showTipsCheckbox.addEventListener('change', () => {
  localStorage.setItem('showTips', dom.showTipsCheckbox.checked);
  if (!dom.showTipsCheckbox.checked) {
    dom.tooltip.classList.remove('visible');
  }
});

document.querySelectorAll('[data-tip]').forEach(el => {
  el.addEventListener('mouseenter', () => {
    if (!dom.showTipsCheckbox.checked) return;

    const tipText = el.getAttribute('data-tip');
    if (!tipText) return;

    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      dom.tooltip.textContent = tipText;

      // Position off-screen first to measure
      dom.tooltip.style.left = '0px';
      dom.tooltip.style.top = '0px';
      dom.tooltip.classList.add('visible');

      const rect = el.getBoundingClientRect();
      const tooltipRect = dom.tooltip.getBoundingClientRect();

      let left = rect.left;
      let top = rect.bottom + 8;

      // Clamp to viewport
      if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
      }
      if (left < 10) left = 10;

      if (top + tooltipRect.height > window.innerHeight - 10) {
        top = rect.top - tooltipRect.height - 8;
      }
      if (top < 10) top = 10;

      dom.tooltip.style.left = `${left}px`;
      dom.tooltip.style.top = `${top}px`;
    }, 400);
  });

  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeout);
    dom.tooltip.classList.remove('visible');
  });
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  // Space = play/pause
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.file.buffer) {
      state.playback.isPlaying ? pauseAudio() : playAudio();
    }
  }

  // Escape = stop
  if (e.code === 'Escape') {
    stopAudio();
    state.playback.pauseTime = 0;
    dom.waveformProgress.style.width = '0%';
    dom.currentTimeEl.textContent = '0:00';
  }

  // B = bypass toggle
  if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) {
    state.ui.isBypassed = !state.ui.isBypassed;
    dom.bypassBtn.textContent = state.ui.isBypassed ? '🔇 FX Off' : '🔊 FX On';
    dom.bypassBtn.classList.toggle('active', state.ui.isBypassed);
    updateAudioChain();
    updateEQ();
  }

  // Ctrl+Z = undo
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }

  // Ctrl+Shift+Z or Ctrl+Y = redo
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' && e.shiftKey || e.code === 'KeyY')) {
    e.preventDefault();
    redo();
  }

  // Ctrl+E = export
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyE') {
    e.preventDefault();
    if (!dom.processBtn.disabled) {
      dom.processBtn.click();
    }
  }

  // Left/Right arrow = seek ±5s
  if (e.code === 'ArrowLeft' && state.file.buffer) {
    e.preventDefault();
    const currentTime = state.playback.isPlaying
      ? state.audio.context.currentTime - state.playback.startTime
      : state.playback.pauseTime;
    seekTo(currentTime - 5);
  }
  if (e.code === 'ArrowRight' && state.file.buffer) {
    e.preventDefault();
    const currentTime = state.playback.isPlaying
      ? state.audio.context.currentTime - state.playback.startTime
      : state.playback.pauseTime;
    seekTo(currentTime + 5);
  }
});

// ─── Debug ──────────────────────────────────────────────────────────────────
dom.debugBtn.addEventListener('click', async () => {
  const info = await window.electronAPI.getSystemInfo();
  const infoText = `
System Information:
-------------------
Platform: ${info.platform}
Architecture: ${info.arch}
Is Packaged: ${info.isPackaged}
Electron: ${info.electronVersion}
Node: ${info.nodeVersion}

Audio Processing:
-----------------
Engine: Pure JavaScript (Web Audio API)
LUFS: ITU-R BS.1770-4 compliant
WAV Encoder: Native JavaScript (TPDF dithering)
No FFmpeg dependency!

App Path: ${info.appPath}
  `.trim();

  console.log(infoText);
  alert(infoText);
});

// ─── Initialization ─────────────────────────────────────────────────────────
loadSettingsFromStorage();
updateChecklist();
updateEQ();
refreshFaderFills();
