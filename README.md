# AI Music Remastering

A professional desktop app for mastering AI-generated music to streaming-ready quality.
<img width="1372" height="1092" alt="Screenshot 2026-03-06 184721" src="https://github.com/user-attachments/assets/433ed7d2-fa81-4c88-9370-30c8b466814c" />

## Features

- **Batch Processing** - Queue multiple files, apply the same settings, and export all at once
- **Metadata Editor** - Add title, artist, album, genre, year, track number, and comments per file
- **Loudness Normalization** - Adjustable target LUFS (-20 to -6 LUFS)
- **True Peak Limiting** - ITU-R BS.1770 4x-oversampled inter-sample peak limiting with adjustable ceiling (real dBTP, not just sample peak)
- **Center Bass** - Collapse low frequencies (below 120 Hz) to mono for a tighter, phase-safe low end
- **Input Gain Control** - Adjust input level before processing (-12 to +12 dB)
- **Stereo Width** - Control stereo image (0% mono to 200% extra wide)
- **5-Band EQ** - Fine-tune with visual faders and presets (Flat, Vocal Boost, Bass Boost, Bright, Warm, AI Fix)
- **Quick Fix Tools** - Glue compression, clean low end
- **Polish Effects** - Cut mud, add air, tame harshness
- **Audio Editor** - Mini DAW tab with waveform selection, fade in/out, trim, cut, silence, normalize, and reverse
- **Real-time Preview** - Hear all changes live before exporting, preview any queued file
- **Clipping Detection** - Visual CLIP indicators on meters
- **High-Quality Export** - WAV output at 44.1/48kHz, 16/24-bit with embedded metadata

## Download

Get the latest release for your platform:

- **Windows** - `.exe` installer
- **macOS** - `.dmg` disk image  
- **Linux** - `.AppImage`

### ⚠️ Important Note for macOS Users

The macOS build is **not signed with an Apple Developer certificate**, so Gatekeeper will block it on first launch with a message like *"AI Music Remastering is damaged and can't be opened"* or *"cannot be opened because the developer cannot be verified"* (with a "Move to Bin" option).

This is expected for unsigned apps — the app is safe to run. To open it:

**Option 1 — Open Anyway (recommended)**
1. Try to open the app once (you'll see the warning), then click **Cancel**.
2. Go to **System Settings → Privacy & Security**.
3. Scroll to the **Security** section — you'll see a message about the app being blocked.
4. Click **Open Anyway**, then confirm.

**Option 2 — Remove the quarantine flag via Terminal**

If the app still won't open (common on Apple Silicon), run this once after moving the app to `/Applications`:

```bash
xattr -cr "/Applications/AI Music Remastering.app"
```

Then open the app normally. You only need to do this once.

## Usage

1. Drag & drop an audio file (MP3, WAV, FLAC, AAC, M4A)
2. Preview with the built-in player
3. Adjust EQ, loudness, and mastering settings
4. Toggle FX bypass to compare before/after
5. Click "Export WAV" for a single file

### Batch Processing

1. Click "+ Add Files" or drag multiple files into the batch queue
2. Preview any queued file by clicking the ▶ button to load it into the player
3. Switch to the "Metadata" tab to add tags (title, artist, album, etc.) per file
4. Use "Apply to All" to copy metadata across the entire queue
5. Click "Export All" and choose an output folder

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
npm run electron:build:mac    # macOSnpm run electron:build:linux  # Linux
```

## Tech Stack

- Electron + Vite
- Pure JavaScript audio processing (no FFmpeg)
- Web Audio API for real-time preview
- ITU-R BS.1770-4 compliant LUFS measurement
- ITU-R BS.1770 4x-oversampled true-peak (dBTP) limiting
- Native JavaScript WAV encoder


## Changelog

### v2.2.0

**Bug Fixes**
- Fixed loudness normalization running *after* the limiter, which could push peaks back above the true-peak ceiling. Both preview and export now normalize first and limit last, so make-up gain can never exceed the ceiling
- Fixed the "Center Bass" toggle, which was wired to the UI but never applied to the audio. It now high-passes the stereo side signal at 120 Hz to mono the low end

**Audio Quality**
- Genuine true-peak (dBTP) limiting: the export now upsamples 4x (ITU-R BS.1770), clips inter-sample overshoots in the oversampled domain, and resamples back — so exported files are true-peak compliant, not just sample-peak. Audio that's already compliant is left untouched
- Real-time preview uses a 4x-oversampled brickwall clip after the limiter so what you hear matches the exported file
- Loudness readout now reports measured true peak in dBTP

### v2.1.0

**New Features**
- Audio Editor (mini DAW) — a new "✂️ Editor" tab with an interactive waveform
- Click-drag on the waveform to select a region, single-click to move the playhead
- Fade In / Fade Out with an adjustable duration slider (equal-power curve)
- Trim to Selection, Delete Selection, and Silence
- Normalize (peak to -0.3 dBFS) and Reverse (selection or whole track)
- Editor transport: Play / Pause / Stop with selection looping
- Per-session Undo Edit (up to 30 steps) and Reset to Original
- Edits update the loaded buffer, re-measure LUFS, and flow directly into the mastering chain and export

**Bug Fixes**
- Fixed batch "Export All" using a hardcoded Windows path separator (`\`), which produced mangled output paths on macOS and Linux

### v2.0.2

**New Features**
- Light/dark mode toggle — click the sun/moon button in the top bar to switch themes
- Theme preference is saved to localStorage and persists across restarts

**Bug Fixes**
- Fixed spectrogram rendering issue caused by devicePixelRatio canvas scaling mismatch

### v2.0.1

**Bug Fixes**
- Fixed metadata tab file list being too narrow to read filenames with many songs queued
- Widened file list panel, increased font size, and expanded scroll area for better readability

### v2.0.0

**New Features**
- Batch processing queue — add multiple files, apply the same mastering settings, and export all at once
- Per-file metadata editor with tabbed UI (title, artist, album, genre, year, track #, comment)
- "Apply to All" button to copy metadata across the entire queue
- WAV metadata embedding via LIST/INFO chunks (INAM, IART, IPRD, IGNR, ICRD, ITRK, ICMT)
- Queue preview — click ▶ on any queued file to load it into the player and audition before exporting
- Files loaded into the player are automatically added to the batch queue
- Single-file "Export WAV" now includes metadata if the file has tags set in the queue
- Multi-file and directory selection dialogs for batch workflows

**Improvements**
- UI yields to the event loop between batch processing steps to prevent freezing
- Batch progress shows per-file status (pending, processing, done, error) and current filename
- Currently loaded file is highlighted in the queue with a "Loaded" indicator

### v1.2.2

**Bug Fixes**
- Fixed incomplete spectrogram rendering (was truncated mid-function)
- Fixed stereo width being applied twice during export (preview and export now match)
- Fixed seek race condition — `isSeeking` flag now properly guards playback restart
- Fixed `stopAudio` ghost callbacks from `onended` firing after stop

**Architecture**
- Extracted shared `createProcessingNodes()` factory for both preview and export chains (DRY)
- Shared `configureFilterNodes()` accepts settings object — no more duplicated filter setup
- Reduced analyser FFT size to 512 for level meters (faster response)
- Spectrogram throttled to ~30fps with offscreen canvas created once outside draw loop

**New Features**
- Undo/redo system (Ctrl+Z / Ctrl+Shift+Z) with 50-level history
- Settings persistence via localStorage — all settings and EQ presets survive restarts
- Keyboard shortcuts: Space (play/pause), Escape (stop), B (bypass), ←→ (seek ±5s), Ctrl+E (export)
- Shortcuts hint bar in the UI
- Status messages now appear as floating toasts that auto-dismiss

**Audio Quality**
- TPDF dithering for 16-bit WAV exports (reduces quantization artifacts)
- Proper 44.1kHz K-weighting filter coefficients for LUFS measurement

**Accessibility**
- ARIA labels on all interactive controls
- ARIA roles on meters, regions, status areas, and progress bars
- `focus-visible` outlines for keyboard navigation
- Decorative elements marked `aria-hidden`

### v1.2.0
- Initial release

## License

ISC
