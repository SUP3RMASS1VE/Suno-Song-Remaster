/**
 * Copy FFmpeg files to project root for local bundling
 * Files are placed at root level (same as index.html) for proper path resolution
 */

import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// @ffmpeg/core ESM build
const CORE_SOURCE_DIR = join(projectRoot, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
// FFmpeg wrapper UMD build
const WRAPPER_SOURCE_DIR = join(projectRoot, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'umd');

// Files go to project root (same level as index.html)
const DEST_DIR = projectRoot;

async function copyFFmpegFiles() {
  console.log('[copy-ffmpeg] Copying FFmpeg files to project root...');

  // Copy core files (WASM)
  const coreFiles = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

  if (!existsSync(CORE_SOURCE_DIR)) {
    console.error(`[copy-ffmpeg] Core source not found: ${CORE_SOURCE_DIR}`);
    console.error('[copy-ffmpeg] Run "npm install" first');
    process.exit(1);
  }

  for (const file of coreFiles) {
    const srcPath = join(CORE_SOURCE_DIR, file);
    const destPath = join(DEST_DIR, file);

    if (!existsSync(srcPath)) {
      console.warn(`[copy-ffmpeg] Core file not found: ${srcPath}`);
      continue;
    }

    await copyFile(srcPath, destPath);
    console.log(`[copy-ffmpeg] Copied ${file}`);
  }

  // Copy wrapper files (UMD)
  const wrapperFiles = ['ffmpeg.js', '814.ffmpeg.js'];

  if (!existsSync(WRAPPER_SOURCE_DIR)) {
    console.error(`[copy-ffmpeg] Wrapper source not found: ${WRAPPER_SOURCE_DIR}`);
    console.error('[copy-ffmpeg] Run "npm install" first');
    process.exit(1);
  }

  for (const file of wrapperFiles) {
    const srcPath = join(WRAPPER_SOURCE_DIR, file);
    const destPath = join(DEST_DIR, file);

    if (!existsSync(srcPath)) {
      console.warn(`[copy-ffmpeg] Wrapper file not found: ${srcPath}`);
      continue;
    }

    await copyFile(srcPath, destPath);
    console.log(`[copy-ffmpeg] Copied ${file}`);
  }

  console.log('[copy-ffmpeg] Done! All FFmpeg files ready at project root.');
}

copyFFmpegFiles().catch((error) => {
  console.error('[copy-ffmpeg] Error:', error);
  process.exit(1);
});
