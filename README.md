# AI Music Remastering

A professional desktop app for mastering AI-generated music to streaming-ready quality.
<img width="1046" height="655" alt="Screenshot 2026-01-20 191847" src="https://github.com/user-attachments/assets/1c91071e-b269-42fc-acbc-e590e7d31e58" />

## Features

- **Loudness Normalization** - Adjustable target LUFS (-20 to -6 LUFS)
- **True Peak Limiting** - Prevents clipping with adjustable ceiling
- **Input Gain Control** - Adjust input level before processing (-12 to +12 dB)
- **Stereo Width** - Control stereo image (0% mono to 200% extra wide)
- **5-Band EQ** - Fine-tune with visual faders and presets (Flat, Vocal Boost, Bass Boost, Bright, Warm, AI Fix)
- **Quick Fix Tools** - Glue compression, clean low end
- **Polish Effects** - Cut mud, add air, tame harshness
- **Real-time Preview** - Hear all changes live before exporting
- **Clipping Detection** - Visual CLIP indicators on meters
- **High-Quality Export** - WAV output at 44.1/48kHz, 16/24-bit

## Download

Get the latest release for your platform:

- **Windows** - `.exe` installer
- **macOS** - `.dmg` disk image  
- **Linux** - `.AppImage`

## Usage

1. Drag & drop an audio file (MP3, WAV, FLAC, AAC, M4A)
2. Preview with the built-in player
3. Adjust EQ, loudness, and mastering settings
4. Toggle FX bypass to compare before/after
5. Click "Export WAV"

## Building from Source

```bash
# Install dependencies
npm install

# Build the app
npm run build

# Run in development
npm run electron:dev

# Build for your platform
npm run electron:build:win    # Windows
npm run electron:build:mac    # macOS
npm run electron:build:linux  # Linux
```

## Tech Stack

- Electron + Vite
- Pure JavaScript audio processing (no FFmpeg)
- Web Audio API for real-time preview
- ITU-R BS.1770-4 compliant LUFS measurement
- Native JavaScript WAV encoder

## Version

v1.2.0

## License

ISC

