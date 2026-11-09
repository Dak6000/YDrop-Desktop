// Chemins des binaires et dossiers de données (yt-dlp, ffmpeg, deno, whisper)
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let app = null;
try { const e = require('electron'); app = e && e.app ? e.app : null; } catch (_) {}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const exe = (n) => (IS_WIN ? n + '.exe' : n);

function userDir() {
  const d = app ? app.getPath('userData') : path.join(os.tmpdir(), 'ydrop-test');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function bundledBinDir() {
  if (process.env.YDROP_BIN_DIR) return process.env.YDROP_BIN_DIR;
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'bin');
  return path.join(__dirname, '..', '..', 'bin');
}
// Dossier modifiable (mises à jour yt-dlp, deno…) : l'installation peut être en lecture seule
function userBinDir() {
  const d = path.join(userDir(), 'bin');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function findInPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, exe(name));
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}
function firstExisting(list) {
  for (const p of list) { try { if (p && fs.statSync(p).isFile()) return p; } catch (_) {} }
  return null;
}

// Les chemins sont recalculés à chaque appel : une mise à jour peut créer un nouveau binaire
function ytdlp()  { return firstExisting([path.join(userBinDir(), exe('yt-dlp')), path.join(bundledBinDir(), exe('yt-dlp')), findInPath('yt-dlp')]) || path.join(bundledBinDir(), exe('yt-dlp')); }
function ffmpeg() { return firstExisting([path.join(bundledBinDir(), exe('ffmpeg')), path.join(userBinDir(), exe('ffmpeg')), findInPath('ffmpeg')]) || path.join(bundledBinDir(), exe('ffmpeg')); }
function ffprobe(){ return firstExisting([path.join(bundledBinDir(), exe('ffprobe')), path.join(userBinDir(), exe('ffprobe')), path.join(path.dirname(ffmpeg()), exe('ffprobe')), findInPath('ffprobe')]); }
function deno()   { return firstExisting([path.join(userBinDir(), exe('deno')), path.join(bundledBinDir(), exe('deno')), findInPath('deno')]); }
function nodeRuntime() { return findInPath('node'); }

// Whisper.cpp (optionnel) : bin/whisper/whisper-cli(.exe) + bin/whisper/models/ggml-*.bin
function whisperDirs() { return [path.join(userDir(), 'whisper'), path.join(bundledBinDir(), 'whisper')]; }
function whisperBin() {
  const names = ['whisper-cli', 'whisper-cpp', 'main'];
  for (const d of whisperDirs()) for (const n of names) {
    const p = firstExisting([path.join(d, exe(n))]); if (p) return p;
  }
  return findInPath('whisper-cli') || findInPath('whisper-cpp');
}
function whisperModels() {
  const out = [];
  for (const d of whisperDirs()) for (const sub of [path.join(d, 'models'), d]) {
    try {
      for (const f of fs.readdirSync(sub)) if (/^ggml-.*\.bin$/i.test(f)) out.push({ name: f, path: path.join(sub, f) });
    } catch (_) {}
  }
  return out;
}

module.exports = {
  IS_WIN, IS_MAC, exe, userDir, userBinDir, bundledBinDir, findInPath,
  ytdlp, ffmpeg, ffprobe, deno, nodeRuntime, whisperBin, whisperModels, whisperDirs,
};
