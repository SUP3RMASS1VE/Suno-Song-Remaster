#!/usr/bin/env node
/**
 * LMCHZ Release Pipeline
 * Organize → Master (-14 LUFS) → Distribution export
 *
 * Usage: node scripts/lmchz-release.mjs [--skip-master]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readWAV, createAudioBuffer } from './wavReader.js';
import { measureLUFS, calculateNormalizationGain } from '../src/lufs.js';
import { encodeWAV } from '../src/wavEncoder.js';
import { AUDIO_CONSTANTS } from '../src/audioConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LMCHZ_ROOT = process.env.LMCHZ_ROOT || '/Users/daniil/LMCHZ';
const RELEASE_ROOT = path.join(LMCHZ_ROOT, 'release');
const MANIFEST_PATH = path.join(RELEASE_ROOT, 'manifest.json');

const DIRS = {
  sourcesAlbum: path.join(RELEASE_ROOT, '01-sources', 'album'),
  sourcesSingles: path.join(RELEASE_ROOT, '01-sources', 'singles'),
  masteredAlbum: path.join(RELEASE_ROOT, '02-mastered', 'album'),
  masteredSingles: path.join(RELEASE_ROOT, '02-mastered', 'singles'),
  distributionAlbum: path.join(RELEASE_ROOT, '03-distribution', 'album'),
  distributionSingles: path.join(RELEASE_ROOT, '03-distribution', 'singles'),
  docs: path.join(RELEASE_ROOT, 'docs'),
  assets: path.join(RELEASE_ROOT, 'assets')
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function copySource(srcRel, destDir, destName) {
  const src = path.join(LMCHZ_ROOT, srcRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Source not found: ${src}`);
  }
  const dest = path.join(destDir, destName);
  fs.copyFileSync(src, dest);
  return dest;
}

function applyHighpass(buffer, freqHz = 30) {
  const sr = buffer.sampleRate;
  const rc = 1 / (2 * Math.PI * freqHz);
  const dt = 1 / sr;
  const alpha = rc / (rc + dt);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let prevIn = data[0];
    let prevOut = data[0];
    for (let i = 1; i < data.length; i++) {
      const x = data[i];
      const y = alpha * (prevOut + x - prevIn);
      data[i] = y;
      prevIn = x;
      prevOut = y;
    }
  }
}

function applyGain(buffer, gain) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] *= gain;
    }
  }
}

function measureTruePeakDb(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function masterBuffer(inputBuffer, settings) {
  const buffer = createAudioBuffer(
    {
      sampleRate: inputBuffer.sampleRate,
      numChannels: inputBuffer.numberOfChannels,
      channels: Array.from({ length: inputBuffer.numberOfChannels }, (_, ch) =>
        new Float32Array(inputBuffer.getChannelData(ch))
      ),
      length: inputBuffer.length
    },
    settings.sampleRate
  );

  if (settings.cleanLowEnd) {
    applyHighpass(buffer, settings.highpassHz || 30);
  }

  const preLufs = measureLUFS(buffer);
  let gain = 1.0;

  if (settings.targetLufs !== undefined) {
    gain = calculateNormalizationGain(preLufs.integratedLUFS, settings.targetLufs);
    if (isFinite(gain) && gain > 0) {
      applyGain(buffer, gain);
    }
  }

  const ceilingDb = settings.truePeakCeilingDb ?? -1.0;
  const ceilingLin = Math.pow(10, ceilingDb / 20);
  let peakDb = measureTruePeakDb(buffer);
  if (peakDb > ceilingDb) {
    const limitGain = ceilingLin / Math.pow(10, peakDb / 20);
    applyGain(buffer, limitGain);
    gain *= limitGain;
  }

  const postLufs = measureLUFS(buffer);
  peakDb = measureTruePeakDb(buffer);

  return {
    buffer,
    stats: {
      inputLufs: round(preLufs.integratedLUFS, 2),
      outputLufs: round(postLufs.integratedLUFS, 2),
      truePeakDb: round(peakDb, 2),
      gainDb: round(20 * Math.log10(gain), 2)
    }
  };
}

function round(n, d = 2) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function masterFile(inputPath, outputPath, metadata, settings) {
  const raw = fs.readFileSync(inputPath);
  const wav = readWAV(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const audioBuffer = createAudioBuffer(wav);
  const { buffer, stats } = masterBuffer(audioBuffer, settings);

  const wavOut = encodeWAV(buffer, {
    bitDepth: settings.bitDepth || 16,
    dither: true,
    metadata: {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album || '',
      genre: metadata.genre || '',
      year: metadata.year || '2026',
      track: metadata.track ? String(metadata.track) : '',
      comment: 'Mastered for streaming -14 LUFS'
    }
  });

  fs.writeFileSync(outputPath, Buffer.from(wavOut));
  return { ...stats, duration: buffer.length / buffer.sampleRate };
}

function escapeCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function generateCsv(manifest, report) {
  const rows = [['release_type', 'track_number', 'title', 'artist', 'album', 'genre', 'release_date', 'filename', 'duration', 'input_lufs', 'output_lufs', 'true_peak_db', 'explicit', 'language']];

  for (const t of manifest.album.tracks.filter(t => t.include)) {
    const r = report.album[t.filename];
    rows.push([
      'album', t.track, t.title, manifest.artist, manifest.album.title,
      t.genre, manifest.album.releaseDate, t.filename,
      r ? formatDuration(r.duration) : '', r?.inputLufs ?? '', r?.outputLufs ?? '', r?.truePeakDb ?? '',
      manifest.album.explicit ? 'yes' : 'no', manifest.album.language
    ]);
  }

  for (const s of manifest.singles) {
    const r = report.singles[s.filename];
    rows.push([
      'single', '', s.title, manifest.artist, s.title,
      s.genre, s.releaseDate, s.filename,
      r ? formatDuration(r.duration) : '', r?.inputLufs ?? '', r?.outputLufs ?? '', r?.truePeakDb ?? '',
      'no', s.language || 'English'
    ]);
  }

  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
}

function generateChecklist(manifest) {
  return `# LMCHZ — чеклист загрузки

## Статус автоматизации
- [x] Структура релиза создана
- [x] Треки переименованы и разложены
- [x] Batch-мастеринг (-14 LUFS, true peak -1 dB)
- [x] Метаданные и CSV для дистрибьютора
- [ ] Обложка 3000×3000 → \`release/assets/cover-album.jpg\`
- [ ] Обложки синглов → \`release/assets/singles/\`
- [ ] Выбор дистрибьютора (SoundCloud Artist Pro / DistroKid)
- [ ] Загрузка альбома (дата: **${manifest.album.releaseDate}**)
- [ ] Spotify Editorial Pitch (за 4 недели до релиза)
- [ ] Profile mapping: LMCHZ → Spotify / Apple Music

## Альбом: ${manifest.album.title}
**Дата релиза:** ${manifest.album.releaseDate}  
**Треков:** ${manifest.album.tracks.filter(t => t.include).length}  
**Папка для загрузки:** \`release/03-distribution/album/\`

### Tracklist
${manifest.album.tracks.filter(t => t.include).map(t => `${t.track}. ${t.title}`).join('\n')}

## Синглы (по фазам)
${[...new Set(manifest.singles.map(s => s.phase))].map(phase => {
  const items = manifest.singles.filter(s => s.phase === phase);
  return `### Фаза ${phase} — ${items[0].releaseDate}\n${items.map(s => `- ${s.title}`).join('\n')}`;
}).join('\n\n')}

## Файлы
| Файл | Назначение |
|------|------------|
| \`docs/metadata.csv\` | Таблица для дистрибьютора |
| \`docs/mastering-report.json\` | LUFS/peak по каждому треку |
| \`docs/spotify-pitch.md\` | Текст питча для Spotify |
| \`docs/artist-bio.md\` | Bio для профилей |
| \`03-distribution/album/\` | Готовые WAV для альбома |
| \`03-distribution/singles/\` | Готовые WAV для синглов |

## Осталось сделать вручную (~30 мин)
1. Положить обложку в \`assets/cover-album.jpg\`
2. Прослушать \`02-mastered/album/13 - Amigo.wav\` — решить, обрезать ли
3. Загрузить альбом в дистрибьютор
4. Заполнить Spotify pitch из \`docs/spotify-pitch.md\`
`;
}

function generateSpotifyPitch(manifest) {
  const tracks = manifest.album.tracks.filter(t => t.include);
  const focus = tracks.slice(0, 5).map(t => t.title).join(', ');

  return `# Spotify Editorial Pitch — ${manifest.artist}

**Release title:** ${manifest.album.title}  
**Release date:** ${manifest.album.releaseDate}  
**Genre:** ${manifest.album.genre} / ${manifest.album.secondaryGenre}

---

## Pitch (English, max ~500 chars)

${manifest.artist} presents "${manifest.album.title}" — a ${tracks.length}-track journey blending ${manifest.album.genre.toLowerCase()} and ${manifest.album.secondaryGenre.toLowerCase()}. Built from late-night sessions and raw energy, the album opens with "${tracks[0]?.title}" and moves through standouts like ${focus}. For fans of melodic hip-hop with electronic textures. Recorded and produced independently.

---

## Pitch (Russian)

${manifest.artist} представляет альбом «${manifest.album.title}» — ${tracks.length} треков на стыке ${manifest.album.genre.toLowerCase()} и ${manifest.album.secondaryGenre.toLowerCase()}. От "${tracks[0]?.title}" до "${tracks[tracks.length - 1]?.title}" — личная, атмосферная работа независимого артиста.

---

## Focus tracks for playlists
1. ${tracks[1]?.title || tracks[0]?.title}
2. ${tracks[4]?.title || tracks[2]?.title}
3. ${tracks[6]?.title || tracks[3]?.title}

## Mood / activity tags
- late night, driving, workout, chill, party

## Примечание
Отправить питч в Spotify for Artists **не позднее чем за 4 недели** до ${manifest.album.releaseDate}.
`;
}

function generateArtistBio(manifest) {
  return `# ${manifest.artist} — Artist Bio

## Short (English, ~150 chars)
${manifest.artist} — independent artist blending hip-hop and electronic sounds. New album "${manifest.album.title}" out ${manifest.album.releaseDate}.

## Short (Russian)
${manifest.artist} — независимый артист на стыке хип-хопа и электроники. Альбом «${manifest.album.title}» — ${manifest.album.releaseDate}.

## Long (English)
${manifest.artist} is an independent music artist creating at the intersection of hip-hop and electronic production. With a catalog spanning energetic club tracks and introspective melodies, ${manifest.artist} builds a distinct sonic identity — raw, melodic, and forward-moving. The debut album "${manifest.album.title}" (${tracksCount(manifest)} tracks) marks the first official streaming release, mastered for Spotify, Apple Music, and global DSPs.

## Links (fill in)
- SoundCloud: [your SoundCloud URL]
- Instagram: 
- Spotify: (after distribution)
`;
}

function tracksCount(manifest) {
  return manifest.album.tracks.filter(t => t.include).length;
}

function generateCoverSpec(manifest) {
  return `# Cover Art Spec — ${manifest.album.title}

## Requirements
- Size: **3000 × 3000 px** (minimum)
- Format: JPG or PNG (RGB, no transparency for JPG)
- No URLs, prices, QR codes, or streaming logos on artwork

## Files to create
| File | Purpose |
|------|---------|
| \`assets/cover-album.jpg\` | Album "${manifest.album.title}" |
| \`assets/cover-single-speed-star.jpg\` | Double single Speed + Star |
| \`assets/cover-single-paradise.jpg\` | Single Paradise |
| \`assets/cover-single-birds.jpg\` | Single Birds |

## Style direction
- Artist: ${manifest.artist}
- Mood: night, California, urban, electronic
- Palette: dark background + accent (neon / gold)
- Typography: bold sans-serif, artist name readable at thumbnail size

## Quick option
Use Canva → Album Cover 3000×3000 → export as JPG → save to \`assets/cover-album.jpg\`
`;
}

async function main() {
  const skipMaster = process.argv.includes('--skip-master');
  const manifest = readManifest();
  const settings = { ...manifest.mastering };
  const report = { album: {}, singles: {}, processedAt: new Date().toISOString() };

  console.log('LMCHZ Release Pipeline');
  console.log('======================\n');

  Object.values(DIRS).forEach(ensureDir);

  // Step 1: Organize sources
  console.log('Step 1: Organizing sources...');
  for (const track of manifest.album.tracks.filter(t => t.include)) {
    copySource(track.source, DIRS.sourcesAlbum, track.filename);
    console.log(`  album: ${track.filename}`);
  }
  for (const single of manifest.singles) {
    copySource(single.source, DIRS.sourcesSingles, single.filename);
    console.log(`  single: ${single.filename}`);
  }

  if (skipMaster) {
    console.log('\n--skip-master: skipping mastering step');
  } else {
    // Step 2: Master album
    console.log('\nStep 2: Mastering album...');
    for (const track of manifest.album.tracks.filter(t => t.include)) {
      const input = path.join(DIRS.sourcesAlbum, track.filename);
      const output = path.join(DIRS.masteredAlbum, track.filename);
      const stats = masterFile(input, output, {
        title: track.title,
        artist: manifest.artist,
        album: manifest.album.title,
        genre: track.genre,
        year: manifest.album.releaseDate.slice(0, 4),
        track: track.track
      }, settings);
      report.album[track.filename] = stats;
      console.log(`  ✓ ${track.filename}  ${stats.inputLufs} → ${stats.outputLufs} LUFS  peak ${stats.truePeakDb} dBFS`);
    }

    // Step 3: Master singles
    console.log('\nStep 3: Mastering singles...');
    for (const single of manifest.singles) {
      const input = path.join(DIRS.sourcesSingles, single.filename);
      const output = path.join(DIRS.masteredSingles, single.filename);
      const stats = masterFile(input, output, {
        title: single.title,
        artist: manifest.artist,
        album: single.title,
        genre: single.genre,
        year: single.releaseDate.slice(0, 4)
      }, settings);
      report.singles[single.filename] = stats;
      console.log(`  ✓ ${single.filename}  ${stats.inputLufs} → ${stats.outputLufs} LUFS  peak ${stats.truePeakDb} dBFS`);
    }
  }

  // Step 4: Distribution copies
  console.log('\nStep 4: Preparing distribution folders...');
  if (!skipMaster) {
    for (const f of fs.readdirSync(DIRS.masteredAlbum)) {
      fs.copyFileSync(path.join(DIRS.masteredAlbum, f), path.join(DIRS.distributionAlbum, f));
    }
    for (const f of fs.readdirSync(DIRS.masteredSingles)) {
      fs.copyFileSync(path.join(DIRS.masteredSingles, f), path.join(DIRS.distributionSingles, f));
    }
  }

  // Step 5: Generate docs
  console.log('\nStep 5: Generating documentation...');
  fs.writeFileSync(path.join(DIRS.docs, 'metadata.csv'), generateCsv(manifest, report));
  fs.writeFileSync(path.join(DIRS.docs, 'mastering-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(DIRS.docs, 'UPLOAD-CHECKLIST.md'), generateChecklist(manifest));
  fs.writeFileSync(path.join(DIRS.docs, 'spotify-pitch.md'), generateSpotifyPitch(manifest));
  fs.writeFileSync(path.join(DIRS.docs, 'artist-bio.md'), generateArtistBio(manifest));
  fs.writeFileSync(path.join(DIRS.docs, 'cover-art-spec.md'), generateCoverSpec(manifest));

  const albumTracks = manifest.album.tracks.filter(t => t.include).length;
  const singleCount = manifest.singles.length;

  console.log('\n======================');
  console.log('Done!');
  console.log(`  Album tracks:  ${albumTracks} mastered → 03-distribution/album/`);
  console.log(`  Singles:       ${singleCount} mastered → 03-distribution/singles/`);
  console.log(`  Docs:          release/docs/`);
  console.log(`  Next:          Add cover to release/assets/cover-album.jpg`);
  console.log(`  Release date:  ${manifest.album.releaseDate}`);
}

main().catch(err => {
  console.error('Pipeline failed:', err.message);
  process.exit(1);
});
