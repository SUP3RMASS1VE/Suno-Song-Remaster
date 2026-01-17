# Suno Song Remaster

A desktop app for mastering AI-generated music (Suno, Udio, etc.) to streaming-ready quality.

<p align="center">
  <img src="image.png" alt="Suno Song Remaster" width="300">
  <img src="https://github.com/user-attachments/assets/3e06bc4a-9bda-4340-9497-22b894678ddd" alt="Screenshot" width="500">
</p>

## Features

### Loudness & Dynamics
- **Loudness Normalization** - Automatically adjusts to Spotify's -14 LUFS standard
- **True Peak Limiting** - Prevents clipping with adjustable ceiling (-3dB to 0dB)
- **Glue Compression** - Light compression to glue the mix together and add punch

### EQ & Tonal
- **5-Band Parametric EQ** - Fine-tune frequencies (80Hz, 250Hz, 1kHz, 4kHz, 12kHz)
- **EQ Presets** - Flat, Vocal Boost, Bass Boost, Bright, Warm, Suno Fix
- **Cut Mud** - Reduce muddy frequencies around 250Hz
- **Add Air** - Sparkle and brightness with 12kHz high shelf boost
- **Tame Harshness** - Reduce harsh frequencies around 4-6kHz

### Low End
- **Clean Low End** - Removes sub-bass rumble below 30Hz
- **Center Bass** - Makes bass frequencies mono for better speaker compatibility

### Output
- **Real-time Preview** - Hear EQ and effect changes before exporting
- **FX Bypass** - Toggle all effects to compare before/after
- **Streaming Preset** - 44.1kHz/16-bit (Spotify, Apple Music, CD quality)
- **Studio Preset** - 48kHz/24-bit (Studio quality, video production)
- **High-Quality WAV Export** - Lossless output with all processing applied

## Download

Get the latest release for your platform:

- **Windows** - `.exe` installer
- **macOS** - `.dmg` disk image
- **Linux** - `.AppImage`

[Download from Releases](https://github.com/SUP3RMASS1VE/Suno-Song-Remaster/releases)

## Usage

1. Drag & drop an audio file (MP3, WAV, FLAC, AAC, M4A)
2. Preview with the built-in player
3. Adjust EQ and mastering settings
4. Toggle FX bypass to compare before/after
5. Click "Export Mastered WAV"

## Building from Source

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for your platform
npm run build:win    # Windows
npm run build:mac    # macOS (requires Mac)
npm run build:linux  # Linux
```

## Tech Stack

- Electron 39
- Vite 7 (build system)
- FFmpeg.wasm (browser-based audio processing)
- Web Audio API (real-time preview)

## License

ISC

---

## Changelog

### v1.1.0 (2026-01-17)

**Major Refactor: Vite Build System**

- Migrated from vanilla JavaScript to Vite build system
- Replaced native FFmpeg (fluent-ffmpeg) with FFmpeg.wasm for browser-based processing
- Added proper ES Modules support with cross-origin isolation headers
- Improved development experience with hot module replacement
- Reduced app bundle size by eliminating native FFmpeg binary

**FFmpeg.wasm Integration**

- Using single-threaded core (`@ffmpeg/core-st`) - no SharedArrayBuffer requirement
- All FFmpeg files bundled locally (no CDN dependency at runtime)
- Replaced `crossfeed` filter with `pan` filter (crossfeed unavailable in FFmpeg.wasm)
- Added 60-second timeout for FFmpeg loading (prevents infinite hang)
- Fixed Uint8Array handling for large file IPC transfers
- Added `worker-src 'self' blob:` to Content Security Policy

**Features**
- Added M4A format support
- Added output presets (Streaming/Studio)
- Added "Show Tips" toggle in sidebar
- Improved audio player with seek bar and stop button
- Added FFmpeg processing cancellation (cancel button during export)
- Added "Export Only" badge to Center Bass feature

**Architecture Improvements**
- Created `audioConstants.js` with shared constants for audio parameters
- Grouped global state into organized objects (`playerState`, `audioNodes`, `fileState`)
- Added settings validation layer with `SETTINGS_SCHEMA` and `validateSettings()`
- Fixed IPC listener accumulation in preload.js with proper listener tracking
- Fixed seek interval race condition with safety clears
- Added console warnings for loudness analysis failures (instead of silent null)
- Aligned harshness taming parameters between Web Audio (preview) and FFmpeg (export)
- Smoothed progress bar transitions (no more 5%→10% jump)
- Removed dead `previewDir` code

**Fixes**
- Fixed audio file loading via IPC for proper file:// protocol handling
- Fixed null reference errors in audio chain initialization

### v1.0.0 (Initial Release)

- Initial release with core mastering features
- 5-band EQ with presets
- Loudness normalization to -14 LUFS
- True peak limiting
- Quick fix tools (compression, low end cleanup, center bass)
- Polish effects (cut mud, add air, tame harshness)
- Real-time preview with FX bypass
- WAV export at 44.1/48kHz, 16/24-bit
