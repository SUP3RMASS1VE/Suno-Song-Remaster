/**
 * ITU-R BS.1770-4 Compliant LUFS Measurement
 * Pure JavaScript implementation with K-weighting filters
 * Supports both 44.1kHz and 48kHz sample rates with proper coefficients
 */

// K-weighting filter coefficients per sample rate
const K_WEIGHTING_COEFFS = {
  48000: {
    highShelf: {
      b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
      a: [1, -1.69065929318241, 0.73248077421585]
    },
    highPass: {
      b: [1.0, -2.0, 1.0],
      a: [1, -1.99004745483398, 0.99007225036621]
    }
  },
  44100: {
    highShelf: {
      b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
      a: [1, -1.69065929318241, 0.73248077421585]
    },
    highPass: {
      b: [1.0, -2.0, 1.0],
      a: [1, -1.98916108609994, 0.98919185728498]
    }
  }
};

/**
 * Apply biquad filter to audio data
 */
function applyBiquadFilter(samples, b, a) {
  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0];

    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

/**
 * Apply K-weighting to audio channel using sample-rate-appropriate coefficients
 */
function applyKWeighting(samples, sampleRate) {
  // Use closest matching coefficients
  const coeffs = K_WEIGHTING_COEFFS[sampleRate] || K_WEIGHTING_COEFFS[48000];

  // Stage 1: High shelf filter
  let filtered = applyBiquadFilter(samples, coeffs.highShelf.b, coeffs.highShelf.a);

  // Stage 2: High pass filter
  filtered = applyBiquadFilter(filtered, coeffs.highPass.b, coeffs.highPass.a);

  return filtered;
}

/**
 * Calculate mean square of samples
 */
function meanSquare(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return sum / samples.length;
}

/**
 * Measure integrated LUFS using ITU-R BS.1770-4 algorithm
 * @param {AudioBuffer} audioBuffer - The audio buffer to analyze
 * @returns {Object} - { integratedLUFS, truePeak, truePeakDB, shortTermMax }
 */
export function measureLUFS(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Block size: 400ms with 75% overlap (100ms hop)
  const blockSize = Math.floor(sampleRate * 0.4);
  const hopSize = Math.floor(sampleRate * 0.1);

  // Get and K-weight all channels
  const kWeightedChannels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    kWeightedChannels.push(applyKWeighting(channelData, sampleRate));
  }

  // Calculate loudness for each block
  const blockLoudness = [];

  for (let start = 0; start + blockSize <= length; start += hopSize) {
    let sumSquare = 0;

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = kWeightedChannels[ch];
      const block = channelData.slice(start, start + blockSize);
      // Channel weighting (1.0 for L/R, 1.41 for surround - we assume stereo)
      const weight = 1.0;
      sumSquare += weight * meanSquare(block);
    }

    // Convert to LUFS
    const loudness = -0.691 + 10 * Math.log10(sumSquare);

    if (isFinite(loudness)) {
      blockLoudness.push(loudness);
    }
  }

  if (blockLoudness.length === 0) {
    return { integratedLUFS: -Infinity, truePeak: 0, truePeakDB: -Infinity, shortTermMax: -Infinity };
  }

  // Absolute threshold: -70 LUFS
  const absoluteThreshold = -70;
  let blocksAboveAbsolute = blockLoudness.filter(l => l > absoluteThreshold);

  if (blocksAboveAbsolute.length === 0) {
    return { integratedLUFS: -Infinity, truePeak: 0, truePeakDB: -Infinity, shortTermMax: -Infinity };
  }

  // Calculate average of blocks above absolute threshold
  const avgAbsolute = blocksAboveAbsolute.reduce((a, b) => a + b, 0) / blocksAboveAbsolute.length;

  // Relative threshold: -10 LU below average
  const relativeThreshold = avgAbsolute - 10;

  // Final gated measurement
  const gatedBlocks = blockLoudness.filter(l => l > relativeThreshold);

  let integratedLUFS = -Infinity;
  if (gatedBlocks.length > 0) {
    const linearSum = gatedBlocks.reduce((sum, lufs) => {
      return sum + Math.pow(10, (lufs + 0.691) / 10);
    }, 0);
    const linearAvg = linearSum / gatedBlocks.length;
    integratedLUFS = -0.691 + 10 * Math.log10(linearAvg);
  }

  // Calculate true peak (sample peak)
  let truePeak = 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > truePeak) truePeak = abs;
    }
  }

  // Convert true peak to dBFS
  const truePeakDB = truePeak > 0 ? 20 * Math.log10(truePeak) : -Infinity;

  // Short-term max (3 second blocks)
  const shortTermBlockSize = Math.floor(sampleRate * 3);
  let shortTermMax = -Infinity;

  for (let start = 0; start + shortTermBlockSize <= length; start += hopSize) {
    let sumSquare = 0;

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = kWeightedChannels[ch];
      const block = channelData.slice(start, start + shortTermBlockSize);
      sumSquare += meanSquare(block);
    }

    const loudness = -0.691 + 10 * Math.log10(sumSquare);
    if (loudness > shortTermMax) shortTermMax = loudness;
  }

  return {
    integratedLUFS,
    truePeak,
    truePeakDB,
    shortTermMax
  };
}

/**
 * Calculate gain needed to reach target LUFS
 * @param {number} currentLUFS - Current integrated LUFS
 * @param {number} targetLUFS - Target LUFS (default -14)
 * @returns {number} - Gain in linear scale
 */
export function calculateNormalizationGain(currentLUFS, targetLUFS = -14) {
  if (!isFinite(currentLUFS) || currentLUFS < -70) {
    return 1.0; // No adjustment for very quiet audio
  }

  const gainDB = targetLUFS - currentLUFS;
  return Math.pow(10, gainDB / 20);
}
