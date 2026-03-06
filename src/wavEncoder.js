/**
 * Pure JavaScript WAV Encoder
 * Supports 16-bit and 24-bit PCM encoding with optional TPDF dithering
 */

/**
 * Generate TPDF (Triangular Probability Density Function) dither noise
 * Two uniform random values subtracted gives triangular distribution
 * @returns {number} Dither value in range [-1, 1]
 */
function tpdfDither() {
  return Math.random() - Math.random();
}

/**
 * Encode AudioBuffer to WAV format
 * @param {AudioBuffer} audioBuffer - The audio buffer to encode
 * @param {Object} options - Encoding options
 * @param {number} options.bitDepth - 16 or 24 bit
 * @param {boolean} options.dither - Enable TPDF dithering (default: true for 16-bit)
 * @param {Object} options.metadata - Optional metadata { title, artist, album, genre, year, track, comment }
 * @returns {ArrayBuffer} - WAV file as ArrayBuffer
 */
export function encodeWAV(audioBuffer, options = {}) {
  const bitDepth = options.bitDepth || 16;
  const dither = options.dither !== undefined ? options.dither : (bitDepth === 16);
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  // Interleave channels
  const interleaved = interleaveChannels(audioBuffer);

  // Calculate sizes
  const bytesPerSample = bitDepth / 8;
  const dataSize = interleaved.length * bytesPerSample;

  // Build LIST/INFO chunk for metadata
  const infoChunkData = buildInfoChunk(options.metadata);
  const infoChunkSize = infoChunkData ? infoChunkData.byteLength : 0;

  const headerSize = 44;
  const fileSize = headerSize + dataSize + infoChunkSize;

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
    const maxVal = 0x7FFF;
    const minVal = -0x8000;
    for (let i = 0; i < interleaved.length; i++) {
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      // Apply TPDF dither: add 1 LSB of triangular noise before quantization
      const scaled = sample * maxVal + (dither ? tpdfDither() : 0);
      const quantized = Math.max(minVal, Math.min(maxVal, Math.round(scaled)));
      view.setInt16(offset, quantized, true);
      offset += 2;
    }
  } else if (bitDepth === 24) {
    const maxVal = 0x7FFFFF;
    const minVal = -0x800000;
    for (let i = 0; i < interleaved.length; i++) {
      const sample = Math.max(-1, Math.min(1, interleaved[i]));
      const scaled = sample * maxVal + (dither ? tpdfDither() : 0);
      const quantized = Math.max(minVal, Math.min(maxVal, Math.round(scaled)));

      // Write 24-bit little-endian
      view.setUint8(offset, quantized & 0xFF);
      view.setUint8(offset + 1, (quantized >> 8) & 0xFF);
      view.setUint8(offset + 2, (quantized >> 16) & 0xFF);
      offset += 3;
    }
  }

  // Append LIST/INFO metadata chunk
  if (infoChunkData) {
    const infoBytes = new Uint8Array(infoChunkData);
    for (let i = 0; i < infoBytes.length; i++) {
      view.setUint8(offset + i, infoBytes[i]);
    }
  }

  return buffer;
}

/**
 * Build a LIST/INFO chunk from metadata object
 * WAV INFO sub-chunks: INAM=title, IART=artist, IPRD=album, IGNR=genre, ICRD=year, ITRK=track, ICMT=comment
 * @returns {ArrayBuffer|null}
 */
function buildInfoChunk(metadata) {
  if (!metadata) return null;

  const tags = [];
  const tagMap = {
    title: 'INAM',
    artist: 'IART',
    album: 'IPRD',
    genre: 'IGNR',
    year: 'ICRD',
    track: 'ITRK',
    comment: 'ICMT'
  };

  for (const [key, chunkId] of Object.entries(tagMap)) {
    const val = metadata[key];
    if (val && val.trim()) {
      tags.push({ id: chunkId, value: val.trim() });
    }
  }

  if (tags.length === 0) return null;

  // Calculate total size: 4 bytes for "INFO" + each sub-chunk (4 id + 4 size + string + null + pad)
  let payloadSize = 4; // "INFO"
  for (const tag of tags) {
    const strBytes = encodeUTF8(tag.value);
    const strLen = strBytes.length + 1; // include null terminator
    const padded = strLen % 2 === 0 ? strLen : strLen + 1; // RIFF chunks are word-aligned
    payloadSize += 4 + 4 + padded; // id + size + data
  }

  // LIST chunk: 4 ("LIST") + 4 (size) + payload
  const totalSize = 8 + payloadSize;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  let off = 0;

  // LIST header
  writeStringBuf(view, off, 'LIST'); off += 4;
  view.setUint32(off, payloadSize, true); off += 4;
  writeStringBuf(view, off, 'INFO'); off += 4;

  for (const tag of tags) {
    const strBytes = encodeUTF8(tag.value);
    const strLen = strBytes.length + 1;
    const padded = strLen % 2 === 0 ? strLen : strLen + 1;

    writeStringBuf(view, off, tag.id); off += 4;
    view.setUint32(off, strLen, true); off += 4;
    for (let i = 0; i < strBytes.length; i++) {
      view.setUint8(off + i, strBytes[i]);
    }
    view.setUint8(off + strBytes.length, 0); // null terminator
    off += padded;
  }

  return buf;
}

function encodeUTF8(str) {
  return new TextEncoder().encode(str);
}

function writeStringBuf(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
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
