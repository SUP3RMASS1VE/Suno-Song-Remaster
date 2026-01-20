// Shared audio processing constants
export const AUDIO_CONSTANTS = {
  // Sample rates
  SAMPLE_RATE_44K: 44100,
  SAMPLE_RATE_48K: 48000,
  
  // Bit depths
  BIT_DEPTH_16: 16,
  BIT_DEPTH_24: 24,
  
  // Loudness normalization (ITU-R BS.1770-4)
  TARGET_LUFS: -14,
  TARGET_TRUE_PEAK: -1,
  TARGET_LRA: 11,
  ABSOLUTE_THRESHOLD_LUFS: -70,
  RELATIVE_THRESHOLD_LU: -10,
  
  // Frequency bands (Hz)
  FREQ_LOW: 80,
  FREQ_LOW_MID: 250,
  FREQ_MID: 1000,
  FREQ_HIGH_MID: 4000,
  FREQ_HIGH: 12000,
  
  // Filter frequencies
  HIGHPASS_FREQ: 30,
  MUD_CUT_FREQ: 250,
  HARSHNESS_FREQ_1: 4000,
  HARSHNESS_FREQ_2: 6000,
  AIR_FREQ: 12000,
  
  // Compression settings
  GLUE_THRESHOLD: -18,
  GLUE_RATIO: 3,
  GLUE_ATTACK: 0.02,
  GLUE_RELEASE: 0.25,
  
  // Limiter settings
  LIMITER_RATIO: 20,
  LIMITER_ATTACK: 0.001,
  LIMITER_RELEASE: 0.05,
  
  // Harshness reduction (aligned between preview and export)
  HARSHNESS_Q_4K: 2,
  HARSHNESS_GAIN_4K: -2,
  HARSHNESS_Q_6K: 1.5,
  HARSHNESS_GAIN_6K: -1.5
};

// Default settings
export const DEFAULT_SETTINGS = {
  normalizeLoudness: true,
  truePeakLimit: true,
  truePeakCeiling: -1.0,
  cleanLowEnd: true,
  glueCompression: false,
  centerBass: false,
  cutMud: false,
  addAir: false,
  tameHarsh: false,
  sampleRate: AUDIO_CONSTANTS.SAMPLE_RATE_44K,
  bitDepth: AUDIO_CONSTANTS.BIT_DEPTH_16,
  eqLow: 0,
  eqLowMid: 0,
  eqMid: 0,
  eqHighMid: 0,
  eqHigh: 0
};

// Validate settings
export function validateSettings(settings) {
  const validated = { ...DEFAULT_SETTINGS, ...settings };
  
  // Clamp values
  validated.truePeakCeiling = Math.max(-3, Math.min(0, validated.truePeakCeiling));
  validated.eqLow = Math.max(-12, Math.min(12, validated.eqLow));
  validated.eqLowMid = Math.max(-12, Math.min(12, validated.eqLowMid));
  validated.eqMid = Math.max(-12, Math.min(12, validated.eqMid));
  validated.eqHighMid = Math.max(-12, Math.min(12, validated.eqHighMid));
  validated.eqHigh = Math.max(-12, Math.min(12, validated.eqHigh));
  
  // Validate enums
  if (![44100, 48000].includes(validated.sampleRate)) {
    validated.sampleRate = AUDIO_CONSTANTS.SAMPLE_RATE_44K;
  }
  if (![16, 24].includes(validated.bitDepth)) {
    validated.bitDepth = AUDIO_CONSTANTS.BIT_DEPTH_16;
  }
  
  return validated;
}
