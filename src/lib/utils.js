const fs = require('fs');
const os = require('os');
const path = require('path');

const LATIN = {
  'à':'a','â':'a','ä':'a','á':'a','ã':'a','å':'a','æ':'ae','è':'e','é':'e','ê':'e','ë':'e',
  'ì':'i','í':'i','î':'i','ï':'i','ò':'o','ó':'o','ô':'o','ö':'o','õ':'o','ø':'o','œ':'oe',
  'ù':'u','ú':'u','û':'u','ü':'u','ý':'y','ÿ':'y','ñ':'n','ç':'c','ß':'ss',
  'À':'A','Â':'A','Ä':'A','Á':'A','Ã':'A','Å':'A','Æ':'AE','È':'E','É':'E','Ê':'E','Ë':'E',
  'Ì':'I','Í':'I','Î':'I','Ï':'I','Ò':'O','Ó':'O','Ô':'O','Ö':'O','Õ':'O','Ø':'O','Œ':'OE',
  'Ù':'U','Ú':'U','Û':'U','Ü':'U','Ý':'Y','Ñ':'N','Ç':'C',
};

// Nom de fichier sûr. Les accents latins sont simplifiés (comme en v1.0) ; les autres
// écritures (arabe, cyrillique, CJK…) sont conservées au lieu d'être supprimées.
function sanitizeName(raw, fallback) {
  let s = String(raw || '')
    .replace(/[\u00C0-\u017F]/g, c => LATIN[c] ?? c)
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/["?*<>]/g, '')
    .replace(/[:\\/|]/g, ' - ')
    .replace(/(\s*-\s*){2,}/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '').trim();
  if (s.length > 150) s = s.slice(0, 150).trim();
  return s || fallback || ('ydrop_' + Date.now());
}
// Variante avec extension (compat. v1.0)
function sanitizeFilename(raw) {
  const dot = raw.lastIndexOf('.');
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot) : '';
  return sanitizeName(base) + ext;
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext), n = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);
  return p;
}
function makeTmpDir(prefix = 'ydrop') {
  const dir = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

// Déplacement fiable même entre deux disques
function moveFile(src, dest) {
  try { fs.renameSync(src, dest); }
  catch (_) { fs.copyFileSync(src, dest); try { fs.unlinkSync(src); } catch (_) {} }
}

function formatDuration(s) {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// Arrête un processus et ses enfants (yt-dlp lance ffmpeg)
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else child.kill('SIGTERM');
  } catch (_) {}
}

// Compare des versions de type 2025.10.22 ou 2025.10.22.1 ; renvoie -1, 0, 1
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

module.exports = { sanitizeName, sanitizeFilename, uniquePath, makeTmpDir, cleanup, moveFile, formatDuration, formatViews, killTree, cmpVersion };
