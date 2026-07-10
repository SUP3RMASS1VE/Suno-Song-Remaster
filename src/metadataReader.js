/**
 * metadataReader.js
 *
 * Lightweight, dependency-free reader for embedded audio tags.
 * Parses the common tag formats for the file types this app accepts:
 *   - MP3 / AAC : ID3v2 (v2.2, v2.3, v2.4)
 *   - WAV       : RIFF LIST/INFO chunk (matches wavEncoder.js output)
 *   - FLAC      : Vorbis comments
 *   - M4A / MP4 : iTunes-style ilst atoms
 *
 * Returns a normalized object with any of the following string fields that
 * were found: { title, artist, album, genre, year, track, comment }.
 * Fields that aren't present are simply omitted.
 */

const ID3V1_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge',
  'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B',
  'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska',
  'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient',
  'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical',
  'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave',
  'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream',
  'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap',
  'Pop/Funk', 'Jungle', 'Native US', 'Cabaret', 'New Wave', 'Psychadelic',
  'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'
];

const EMPTY = () => ({});

/**
 * Detect format from the leading bytes and dispatch to the right parser.
 * @param {Uint8Array} bytes - the full (or head) file bytes
 * @returns {{title?:string,artist?:string,album?:string,genre?:string,year?:string,track?:string,comment?:string}}
 */
export function readAudioMetadata(bytes) {
  if (!bytes || bytes.length < 12) return EMPTY();
  try {
    // ID3v2 (MP3 and often AAC): starts with "ID3"
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return parseID3v2(bytes);
    }
    // RIFF/WAVE
    if (str(bytes, 0, 4) === 'RIFF' && str(bytes, 8, 4) === 'WAVE') {
      return parseWavInfo(bytes);
    }
    // FLAC
    if (str(bytes, 0, 4) === 'fLaC') {
      return parseFlac(bytes);
    }
    // MP4 / M4A: second word of first atom is "ftyp"
    if (str(bytes, 4, 4) === 'ftyp') {
      return parseMp4(bytes);
    }
    // Fallback: some MP3s have ID3 later or none; nothing to read.
    return EMPTY();
  } catch (err) {
    console.warn('metadataReader: failed to parse tags', err);
    return EMPTY();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function str(bytes, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}

function readUint32BE(bytes, o) {
  return (bytes[o] * 0x1000000) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
}

function readUint32LE(bytes, o) {
  return bytes[o] + (bytes[o + 1] << 8) + (bytes[o + 2] << 16) + (bytes[o + 3] * 0x1000000);
}

function clean(value) {
  if (typeof value !== 'string') return '';
  // Strip trailing NULs and surrounding whitespace
  return value.replace(/\u0000+$/g, '').replace(/\u0000/g, '').trim();
}

function decodeGenre(raw) {
  if (!raw) return '';
  // "(17)" or "17" style numeric ID3v1 references
  const m = raw.match(/^\(?(\d{1,3})\)?$/);
  if (m) {
    const idx = parseInt(m[1], 10);
    if (idx >= 0 && idx < ID3V1_GENRES.length) return ID3V1_GENRES[idx];
  }
  // "(17)Refined" -> prefer the trailing text
  const m2 = raw.match(/^\(\d+\)(.+)$/);
  if (m2) return m2[1].trim();
  return raw;
}

// ─── ID3v2 (MP3 / AAC) ──────────────────────────────────────────────────────

function decodeID3Text(bytes, start, end) {
  if (start >= end) return '';
  const encoding = bytes[start];
  const dataStart = start + 1;
  const slice = bytes.subarray(dataStart, end);
  try {
    switch (encoding) {
      case 0: return new TextDecoder('iso-8859-1').decode(slice);
      case 1: return new TextDecoder('utf-16').decode(slice); // BOM-driven
      case 2: return new TextDecoder('utf-16be').decode(slice);
      case 3: return new TextDecoder('utf-8').decode(slice);
      default: return new TextDecoder('iso-8859-1').decode(slice);
    }
  } catch {
    return str(bytes, dataStart, end - dataStart);
  }
}

function decodeCommentFrame(bytes, start, end) {
  // COMM: encoding(1) + language(3) + short desc (null-terminated) + text
  if (end - start < 5) return '';
  const encoding = bytes[start];
  let p = start + 4; // skip encoding + 3-byte language
  const wide = (encoding === 1 || encoding === 2);
  // Skip the short description up to its terminator
  if (wide) {
    while (p + 1 < end && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < end && bytes[p] !== 0) p += 1;
    p += 1;
  }
  if (p > end) p = end;
  const slice = bytes.subarray(p, end);
  try {
    switch (encoding) {
      case 0: return new TextDecoder('iso-8859-1').decode(slice);
      case 1: return new TextDecoder('utf-16').decode(slice);
      case 2: return new TextDecoder('utf-16be').decode(slice);
      case 3: return new TextDecoder('utf-8').decode(slice);
      default: return new TextDecoder('iso-8859-1').decode(slice);
    }
  } catch {
    return str(bytes, p, end - p);
  }
}

function parseID3v2(bytes) {
  const meta = {};
  const major = bytes[3];
  const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const tagEnd = Math.min(10 + tagSize, bytes.length);

  // Frame layout differs between v2.2 (3-byte ids/sizes) and v2.3/2.4 (4-byte)
  const v22 = major === 2;
  const idLen = v22 ? 3 : 4;
  const sizeLen = v22 ? 3 : 4;
  const flagsLen = v22 ? 0 : 2;
  const headerLen = idLen + sizeLen + flagsLen;

  // Map frame id -> field
  const map = v22
    ? { TT2: 'title', TP1: 'artist', TAL: 'album', TCO: 'genre', TYE: 'year', TRK: 'track', COM: 'comment' }
    : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TYER: 'year', TDRC: 'year', TRCK: 'track', COMM: 'comment' };

  let p = 10;
  while (p + headerLen <= tagEnd) {
    const id = str(bytes, p, idLen);
    if (id.charCodeAt(0) === 0) break; // padding

    let frameSize;
    if (v22) {
      frameSize = (bytes[p + 3] << 16) | (bytes[p + 4] << 8) | bytes[p + 5];
    } else if (major === 4) {
      // synchsafe in v2.4
      frameSize = (bytes[p + 4] << 21) | (bytes[p + 5] << 14) | (bytes[p + 6] << 7) | bytes[p + 7];
    } else {
      frameSize = readUint32BE(bytes, p + 4);
    }

    const dataStart = p + headerLen;
    const dataEnd = Math.min(dataStart + frameSize, tagEnd);
    if (frameSize <= 0 || dataEnd <= dataStart) { p = dataStart + Math.max(frameSize, 0); continue; }

    const field = map[id];
    if (field) {
      let value;
      if (field === 'comment') {
        value = decodeCommentFrame(bytes, dataStart, dataEnd);
      } else {
        value = decodeID3Text(bytes, dataStart, dataEnd);
      }
      value = clean(value);
      if (field === 'genre') value = decodeGenre(value);
      if (field === 'year') value = value.slice(0, 4); // TDRC may be full timestamp
      if (value && !meta[field]) meta[field] = value;
    }

    p = dataEnd;
  }

  return meta;
}

// ─── WAV LIST/INFO ────────────────────────────────────────────────────────

function parseWavInfo(bytes) {
  const meta = {};
  const tagMap = {
    INAM: 'title', IART: 'artist', IPRD: 'album',
    IGNR: 'genre', ICRD: 'year', ITRK: 'track', ICMT: 'comment'
  };

  let p = 12; // skip RIFF header + WAVE
  const len = bytes.length;
  while (p + 8 <= len) {
    const chunkId = str(bytes, p, 4);
    const chunkSize = readUint32LE(bytes, p + 4);
    const chunkDataStart = p + 8;

    if (chunkId === 'LIST' && str(bytes, chunkDataStart, 4) === 'INFO') {
      let q = chunkDataStart + 4;
      const listEnd = Math.min(chunkDataStart + chunkSize, len);
      while (q + 8 <= listEnd) {
        const subId = str(bytes, q, 4);
        const subSize = readUint32LE(bytes, q + 4);
        const subDataStart = q + 8;
        const field = tagMap[subId];
        if (field) {
          const raw = str(bytes, subDataStart, subSize);
          const value = field === 'genre' ? decodeGenre(clean(raw)) : clean(raw);
          if (value && !meta[field]) meta[field] = value;
        }
        // sub-chunks are word-aligned
        q = subDataStart + subSize + (subSize % 2);
      }
      break;
    }

    // chunks are word-aligned
    p = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  return meta;
}

// ─── FLAC Vorbis comments ───────────────────────────────────────────────────

function parseFlac(bytes) {
  const meta = {};
  const map = {
    TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', GENRE: 'genre',
    DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track',
    COMMENT: 'comment', DESCRIPTION: 'comment'
  };

  let p = 4; // skip "fLaC"
  const len = bytes.length;
  while (p + 4 <= len) {
    const header = bytes[p];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockSize = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    const blockStart = p + 4;

    if (blockType === 4) { // VORBIS_COMMENT
      let q = blockStart;
      const vendorLen = readUint32LE(bytes, q); q += 4 + vendorLen;
      const count = readUint32LE(bytes, q); q += 4;
      const decoder = new TextDecoder('utf-8');
      for (let i = 0; i < count && q + 4 <= len; i++) {
        const cLen = readUint32LE(bytes, q); q += 4;
        const entry = decoder.decode(bytes.subarray(q, q + cLen));
        q += cLen;
        const eq = entry.indexOf('=');
        if (eq > 0) {
          const key = entry.slice(0, eq).toUpperCase();
          const field = map[key];
          if (field) {
            let value = clean(entry.slice(eq + 1));
            if (field === 'genre') value = decodeGenre(value);
            if (field === 'year') value = value.slice(0, 4);
            if (value && !meta[field]) meta[field] = value;
          }
        }
      }
      break;
    }

    if (isLast) break;
    p = blockStart + blockSize;
  }

  return meta;
}

// ─── MP4 / M4A iTunes atoms ─────────────────────────────────────────────────

function parseMp4(bytes) {
  const meta = {};
  const len = bytes.length;

  // Find a child atom by type within [start, end); returns [dataStart, dataEnd] or null
  function findAtom(type, start, end) {
    let p = start;
    while (p + 8 <= end) {
      let size = readUint32BE(bytes, p);
      const atomType = str(bytes, p + 4, 4);
      let headerSize = 8;
      if (size === 1) { // 64-bit size
        size = readUint32BE(bytes, p + 8) * 0x100000000 + readUint32BE(bytes, p + 12);
        headerSize = 16;
      } else if (size === 0) {
        size = end - p; // extends to end
      }
      if (atomType === type) return [p + headerSize, Math.min(p + size, end)];
      if (size <= 0) break;
      p += size;
    }
    return null;
  }

  // Navigate moov > udta > meta > ilst
  const moov = findAtom('moov', 0, len);
  if (!moov) return meta;
  const udta = findAtom('udta', moov[0], moov[1]);
  if (!udta) return meta;
  const metaAtom = findAtom('meta', udta[0], udta[1]);
  if (!metaAtom) return meta;
  // 'meta' has a 4-byte version/flags before its children
  const ilst = findAtom('ilst', metaAtom[0] + 4, metaAtom[1]);
  if (!ilst) return meta;

  const map = {
    '\u00A9nam': 'title', '\u00A9ART': 'artist', 'aART': 'artist',
    '\u00A9alb': 'album', '\u00A9gen': 'genre', 'gnre': 'genre',
    '\u00A9day': 'year', 'trkn': 'track', '\u00A9cmt': 'comment'
  };

  let p = ilst[0];
  const decoder = new TextDecoder('utf-8');
  while (p + 8 <= ilst[1]) {
    const size = readUint32BE(bytes, p);
    const type = str(bytes, p + 4, 4);
    const atomEnd = Math.min(p + size, ilst[1]);
    const field = map[type];
    if (field) {
      const data = findAtom('data', p + 8, atomEnd);
      if (data) {
        // data atom: 4-byte type flags + 4-byte reserved, then value
        const valStart = data[0] + 8;
        if (field === 'track') {
          // trkn value is binary: bytes [2..3] hold the track number
          if (valStart + 4 <= data[1]) {
            const trackNo = (bytes[valStart + 2] << 8) | bytes[valStart + 3];
            if (trackNo > 0) meta.track = String(trackNo);
          }
        } else if (type === 'gnre') {
          // numeric genre (ID3v1 index + 1)
          if (valStart + 2 <= data[1]) {
            const idx = ((bytes[valStart] << 8) | bytes[valStart + 1]) - 1;
            if (idx >= 0 && idx < ID3V1_GENRES.length && !meta.genre) meta.genre = ID3V1_GENRES[idx];
          }
        } else {
          let value = clean(decoder.decode(bytes.subarray(valStart, data[1])));
          if (field === 'genre') value = decodeGenre(value);
          if (field === 'year') value = value.slice(0, 4);
          if (value && !meta[field]) meta[field] = value;
        }
      }
    }
    if (size <= 0) break;
    p += size;
  }

  return meta;
}
