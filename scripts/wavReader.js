/**
 * Minimal WAV reader for PCM 16/24-bit (Node.js)
 */

function readString(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function readWAV(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (readString(view, 0, 4) !== 'RIFF' || readString(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a valid WAV file');
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < view.byteLength - 8) {
    const chunkId = readString(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(chunkData, true),
        numChannels: view.getUint16(chunkData + 2, true),
        sampleRate: view.getUint32(chunkData + 4, true),
        bitsPerSample: view.getUint16(chunkData + 14, true)
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkData;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!fmt || !dataOffset) throw new Error('Invalid WAV: missing fmt or data chunk');
  if (fmt.audioFormat !== 1) throw new Error(`Unsupported WAV format: ${fmt.audioFormat}`);

  const { numChannels, sampleRate, bitsPerSample } = fmt;
  const numSamples = Math.floor(dataSize / (bitsPerSample / 8) / numChannels);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(numSamples));

  let pos = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample;
      if (bitsPerSample === 16) {
        sample = view.getInt16(pos, true) / 32768;
        pos += 2;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos);
        const b1 = view.getUint8(pos + 1);
        const b2 = view.getInt8(pos + 2);
        const val = (b2 << 16) | (b1 << 8) | b0;
        sample = val / 8388608;
        pos += 3;
      } else if (bitsPerSample === 32) {
        sample = view.getInt32(pos, true) / 2147483648;
        pos += 4;
      } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
      }
      channels[ch][i] = sample;
    }
  }

  return { sampleRate, numChannels, channels, length: numSamples };
}

export function createAudioBuffer(wavData, targetSampleRate = null) {
  let { sampleRate, numChannels, channels, length } = wavData;

  if (targetSampleRate && targetSampleRate !== sampleRate) {
    const ratio = targetSampleRate / sampleRate;
    const newLength = Math.floor(length * ratio);
    const resampled = Array.from({ length: numChannels }, () => new Float32Array(newLength));

    for (let i = 0; i < newLength; i++) {
      const srcPos = i / ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      for (let ch = 0; ch < numChannels; ch++) {
        const s0 = channels[ch][Math.min(idx, length - 1)] || 0;
        const s1 = channels[ch][Math.min(idx + 1, length - 1)] || 0;
        resampled[ch][i] = s0 + (s1 - s0) * frac;
      }
    }

    channels = resampled;
    length = newLength;
    sampleRate = targetSampleRate;
  }

  const channelData = channels;
  return {
    sampleRate,
    numberOfChannels: numChannels,
    length,
    duration: length / sampleRate,
    getChannelData(ch) {
      return channelData[ch];
    }
  };
}
