/**
 * Shared audio processing constants
 * Used by both Web Audio API (renderer) and FFmpeg (main process)
 */

const AUDIO_CONSTANTS = {
  // EQ Frequencies (Hz)
  EQ: {
    LOW_FREQ: 80,
    LOW_MID_FREQ: 250,
    MID_FREQ: 1000,
    HIGH_MID_FREQ: 4000,
    HIGH_FREQ: 12000
  },

  // Highpass filter (Clean Low End)
  HIGHPASS: {
    FREQUENCY: 30,
    Q: 0.7
  },

  // Mud cut
  MUD_CUT: {
    FREQUENCY: 250,
    Q: 1.5,
    GAIN: -3
  },

  // Air boost
  AIR_BOOST: {
    FREQUENCY: 12000,
    GAIN: 2.5
  },

  // Harshness taming - using averaged values for Web Audio
  // FFmpeg uses two bands (4kHz and 6kHz), Web Audio uses single band at midpoint
  HARSHNESS: {
    // For Web Audio (single band approximation)
    WEB_AUDIO: {
      FREQUENCY: 5000,
      Q: 2,
      GAIN: -2
    },
    // For FFmpeg (dual band)
    FFMPEG: {
      BAND_1: { FREQUENCY: 4000, Q: 2, GAIN: -2 },
      BAND_2: { FREQUENCY: 6000, Q: 1.5, GAIN: -1.5 }
    }
  },

  // Glue compression
  COMPRESSION: {
    THRESHOLD_DB: -18,
    THRESHOLD_LINEAR: 0.125,  // Math.pow(10, -18/20) ≈ 0.125
    RATIO: 3,
    ATTACK_MS: 20,
    RELEASE_MS: 250,
    KNEE: 10,
    MAKEUP: 1
  },

  // Limiter
  LIMITER: {
    DEFAULT_CEILING_DB: -1,
    RATIO: 20,
    ATTACK_MS: 0.1,
    RELEASE_MS: 50,
    KNEE: 0
  },

  // Loudness normalization
  LOUDNESS: {
    TARGET_LUFS: -14,
    TRUE_PEAK_DB: -2,
    LRA: 11
  },

  // Crossfeed (Center Bass) - export only, no Web Audio equivalent
  CROSSFEED: {
    STRENGTH: 0.3
  },

  // Output formats
  OUTPUT: {
    SAMPLE_RATES: [44100, 48000],
    BIT_DEPTHS: [16, 24],
    DEFAULT_SAMPLE_RATE: 44100,
    DEFAULT_BIT_DEPTH: 16
  }
};

// EQ Presets
const EQ_PRESETS = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -2, lowMid: -1, mid: 2, highMid: 3, high: 1 },
  bass: { low: 6, lowMid: 3, mid: 0, highMid: -1, high: -2 },
  bright: { low: -1, lowMid: 0, mid: 1, highMid: 3, high: 5 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -2, high: -3 },
  suno: { low: 1, lowMid: -2, mid: 1, highMid: -1, high: 2 }
};

/**
 * Settings schema with defaults and validation
 */
const SETTINGS_SCHEMA = {
  // Loudness (export only)
  normalizeLoudness: { type: 'boolean', default: true },
  truePeakLimit: { type: 'boolean', default: true },
  truePeakCeiling: { type: 'number', default: -1, min: -3, max: 0 },

  // Quick Fix
  glueCompression: { type: 'boolean', default: false },
  cleanLowEnd: { type: 'boolean', default: true },
  centerBass: { type: 'boolean', default: false },

  // Polish
  cutMud: { type: 'boolean', default: false },
  addAir: { type: 'boolean', default: false },
  tameHarsh: { type: 'boolean', default: false },

  // Output
  sampleRate: { type: 'number', default: 44100, allowed: [44100, 48000] },
  bitDepth: { type: 'number', default: 16, allowed: [16, 24] },

  // EQ (range: -12 to +12 dB)
  eqLow: { type: 'number', default: 0, min: -12, max: 12 },
  eqLowMid: { type: 'number', default: 0, min: -12, max: 12 },
  eqMid: { type: 'number', default: 0, min: -12, max: 12 },
  eqHighMid: { type: 'number', default: 0, min: -12, max: 12 },
  eqHigh: { type: 'number', default: 0, min: -12, max: 12 }
};

/**
 * Validate and apply defaults to settings object
 * @param {Object} settings - Raw settings from UI
 * @returns {Object} Validated settings with defaults applied
 */
function validateSettings(settings = {}) {
  const validated = {};

  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    let value = settings[key];

    // Apply default if undefined
    if (value === undefined || value === null) {
      validated[key] = schema.default;
      continue;
    }

    // Type coercion and validation
    if (schema.type === 'boolean') {
      validated[key] = Boolean(value);
    } else if (schema.type === 'number') {
      value = Number(value);
      if (isNaN(value)) {
        validated[key] = schema.default;
      } else if (schema.allowed) {
        validated[key] = schema.allowed.includes(value) ? value : schema.default;
      } else {
        // Clamp to range
        const min = schema.min ?? -Infinity;
        const max = schema.max ?? Infinity;
        validated[key] = Math.max(min, Math.min(max, value));
      }
    } else {
      validated[key] = value;
    }
  }

  return validated;
}

/**
 * Get default settings
 * @returns {Object} Default settings object
 */
function getDefaultSettings() {
  const defaults = {};
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    defaults[key] = schema.default;
  }
  return defaults;
}

// For CommonJS (main process)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AUDIO_CONSTANTS, EQ_PRESETS, SETTINGS_SCHEMA, validateSettings, getDefaultSettings };
}
