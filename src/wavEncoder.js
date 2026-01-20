/**
 * Pure JavaScript WAV Encoder
 * Supports 16-bit and 24-bit PCM encoding
 */

/**
 * Encode AudioBuffer to WAV format
 * @param {AudioBuffer} audioBuffer - The audio buffer to encode
 * @param {Object} options - Encoding options
 * @param {number} options.bitDepth - 16 or 24 bit
 * @returns {ArrayBuffer} - WAV file as ArrayBuffer
 */
export function encodeWAV(audioBuffer, options = {}) {
  const bitDepth = options.bitDepth || 16;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  
  // Interleave channels
  const interleaved = interleaveChannels(audioBuffer);
  
  // Calculate sizes
  const bytesPerSample = bitDepth / 8;
  const dataSize = interleaved.length * bytesPerSample;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;
  
  // Create buffer
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitDepth, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write audio data
  let offset = 44;
  
  if (bitDepth === 16) {
    for (let i = 0; i < interleaved.length; i++) {
      // Clamp and convert to 16-bit signed integer
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < interleaved.length; i++) {
      // Clamp and convert to 24-bit signed integer
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      const int24 = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
      const int24Clamped = Math.floor(int24);
      
      // Write 24-bit little-endian
      view.setUint8(offset, int24Clamped & 0xFF);
      view.setUint8(offset + 1, (int24Clamped >> 8) & 0xFF);
      view.setUint8(offset + 2, (int24Clamped >> 16) & 0xFF);
      offset += 3;
    }
  }
  
  return buffer;
}

/**
 * Interleave audio channels
 */
function interleaveChannels(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const interleaved = new Float32Array(length * numChannels);
  
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }
  
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[i * numChannels + ch] = channels[ch][i];
    }
  }
  
  return interleaved;
}

/**
 * Write string to DataView
 */
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Create a downloadable blob from WAV data
 */
export function createWAVBlob(wavBuffer) {
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
