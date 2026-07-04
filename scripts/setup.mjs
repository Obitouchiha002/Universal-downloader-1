#!/usr/bin/env node
/**
 * One-time setup: fetch a portable Python + the yt-dlp binary used by the server.
 *
 * Why a portable Python?  The standalone yt-dlp (PyInstaller) binary re-extracts
 * and gets re-scanned by macOS on every launch (~19s). Running the yt-dlp *zipapp*
 * (shipped in node_modules/youtube-dl-exec) with a bundled CPython starts in ~0.6s.
 *
 * Idempotent — safe to re-run; it skips anything already present.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { execFileSync } from 'child_process';

// In Docker/cloud we install yt-dlp another way (pip) — skip this download step.
if (process.env.SKIP_YTDLP_DOWNLOAD === '1') {
  console.log('Skipping yt-dlp/python download (SKIP_YTDLP_DOWNLOAD=1).');
  process.exit(0);
}

const ROOT = process.cwd();
const BIN = path.join(ROOT, 'bin');
fs.mkdirSync(BIN, { recursive: true });

const PY_DIR = path.join(BIN, 'python');
const PY_BIN = path.join(PY_DIR, 'bin', 'python3');
const STANDALONE = path.join(BIN, 'yt-dlp');

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, fs.createWriteStream(dest));
}

async function setupPortablePython() {
  if (fs.existsSync(PY_BIN)) {
    console.log('✓ portable Python already present');
    return;
  }
  const platform = os.platform();
  const arch = os.arch(); // 'x64' | 'arm64'
  // python-build-standalone target triples
  const triple =
    platform === 'darwin'
      ? arch === 'arm64'
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
      : platform === 'linux'
        ? arch === 'arm64'
          ? 'aarch64-unknown-linux-gnu'
          : 'x86_64-unknown-linux-gnu'
        : null;

  if (!triple) {
    console.log(`! No portable Python target for ${platform}/${arch}; will use the slower standalone yt-dlp binary.`);
    return;
  }

  console.log('• Finding latest portable Python (python-build-standalone)…');
  const rel = await (
    await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest')
  ).json();
  const asset = (rel.assets || []).find((a) =>
    new RegExp(`cpython-3\\.12\\.[0-9]+\\+.*${triple}-install_only\\.tar\\.gz$`).test(a.name)
  );
  if (!asset) throw new Error('Could not find a portable Python asset for ' + triple);

  const tarPath = path.join(os.tmpdir(), 'uvd-python.tar.gz');
  console.log('• Downloading', asset.name);
  await download(asset.browser_download_url, tarPath);
  console.log('• Extracting…');
  execFileSync('tar', ['-xzf', tarPath, '-C', BIN]); // extracts to bin/python/
  fs.rmSync(tarPath, { force: true });
  console.log('✓ portable Python ready');
}

async function setupStandaloneYtDlp() {
  // Fallback binary (used only if portable Python is unavailable).
  if (fs.existsSync(STANDALONE)) return;
  const platform = os.platform();
  const file =
    platform === 'darwin' ? 'yt-dlp_macos' : platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux';
  console.log('• Downloading standalone yt-dlp fallback (' + file + ')…');
  await download(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${file}`,
    STANDALONE
  );
  fs.chmodSync(STANDALONE, 0o755);
  console.log('✓ standalone yt-dlp ready');
}

try {
  await setupPortablePython();
  await setupStandaloneYtDlp();
  console.log('\n✅ Setup complete. Run:  npm run dev\n');
} catch (err) {
  console.error('\n⚠️  Setup step failed:', err.message);
  console.error('   You can retry with:  node scripts/setup.mjs\n');
  process.exitCode = 0; // don't hard-fail npm install
}
