// Gestion des outils : mise à jour de yt-dlp, installation de Deno (runtime JavaScript requis par YouTube)
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execFile } = require('child_process');
const P = require('./paths');
const { cmpVersion } = require('./utils');

const UA = 'YDrop-Desktop';

// ── Téléchargement HTTPS avec redirections et progression ──
function httpGet(url, { headers = {}, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).href, { headers, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' sur ' + url)); }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Délai dépassé')));
  });
}
async function getJson(url) {
  const res = await httpGet(url, { headers: { Accept: 'application/vnd.github+json' } });
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function downloadToFile(url, dest, onProgress) {
  const res = await httpGet(url);
  const total = +res.headers['content-length'] || 0;
  let got = 0;
  const out = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.on('data', ch => { got += ch.length; if (onProgress && total) onProgress(got / total); });
    res.on('error', reject); out.on('error', reject); out.on('finish', resolve);
    res.pipe(out);
  });
}
async function downloadToBuffer(url, onProgress) {
  const res = await httpGet(url);
  const total = +res.headers['content-length'] || 0;
  const chunks = []; let got = 0;
  for await (const c of res) { chunks.push(c); got += c.length; if (onProgress && total) onProgress(got / total); }
  return Buffer.concat(chunks);
}

// ── Lecture d'une entrée d'un ZIP (sans dépendance) ──
function extractFromZip(buf, matchName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Archive ZIP invalide');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (matchName(name)) {
      const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.slice(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('Fichier introuvable dans l\'archive');
}

function run(file, args, timeout = 20000, env) {
  return new Promise(resolve => execFile(file, args, { timeout, windowsHide: true, env }, (err, stdout, stderr) =>
    resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

// ── yt-dlp ──
async function ytdlpVersion() {
  const bin = P.ytdlp();
  if (!fs.existsSync(bin)) return null;
  const r = await run(bin, ['--version'], 15000);
  return r.err ? null : r.stdout.trim() || null;
}
async function latestYtdlpVersion() {
  const j = await getJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
  return j.tag_name || null;
}
function ytdlpAsset() {
  if (P.IS_WIN) return 'yt-dlp.exe';
  if (P.IS_MAC) return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}
// Télécharge la dernière version dans le dossier utilisateur (toujours inscriptible)
async function updateYtdlp(onProgress) {
  const dest = path.join(P.userBinDir(), P.exe('yt-dlp'));
  const tmp = dest + '.new';
  const before = await ytdlpVersion();
  await downloadToFile(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`, tmp, onProgress);
  if (!P.IS_WIN) fs.chmodSync(tmp, 0o755);
  const check = await run(tmp, ['--version'], 20000);
  if (check.err) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error('Le fichier téléchargé est inutilisable : ' + (check.err.message || '')); }
  fs.renameSync(tmp, dest);
  const after = check.stdout.trim();
  return { before, after, changed: before !== after };
}
async function checkYtdlp() {
  const current = await ytdlpVersion();
  let latest = null;
  try { latest = await latestYtdlpVersion(); } catch (_) {}
  return { current, latest, upToDate: !!(current && latest && cmpVersion(current, latest) >= 0) };
}
// --js-runtimes n'existe que depuis yt-dlp 2025.10.22
function supportsJsRuntimes(version) { return !!version && cmpVersion(version, '2025.10.22') >= 0; }

// ── Deno ──
function denoAsset() {
  if (P.IS_WIN) return 'deno-x86_64-pc-windows-msvc.zip';
  if (P.IS_MAC) return process.arch === 'arm64' ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip';
  return process.arch === 'arm64' ? 'deno-aarch64-unknown-linux-gnu.zip' : 'deno-x86_64-unknown-linux-gnu.zip';
}
async function installDeno(onProgress) {
  const buf = await downloadToBuffer(`https://github.com/denoland/deno/releases/latest/download/${denoAsset()}`, onProgress);
  const exeName = P.exe('deno');
  const data = extractFromZip(buf, n => n === exeName || n.endsWith('/' + exeName));
  const dest = path.join(P.userBinDir(), exeName);
  const tmp = dest + '.new';
  fs.writeFileSync(tmp, data);
  if (!P.IS_WIN) fs.chmodSync(tmp, 0o755);
  const check = await run(tmp, ['--version'], 20000);
  if (check.err) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error('Deno téléchargé mais inutilisable'); }
  fs.renameSync(tmp, dest);
  return { version: (check.stdout.split('\n')[0] || '').trim() };
}

// ── Version de l'application (GitHub Releases) ──
async function checkAppUpdate(currentVersion) {
  const j = await getJson('https://api.github.com/repos/Dak6000/YDrop-Desktop/releases/latest');
  const latest = String(j.tag_name || '').replace(/^v/i, '');
  if (!latest || cmpVersion(latest, currentVersion) <= 0) return null;
  return { version: latest, url: j.html_url, notes: (j.body || '').slice(0, 400) };
}

module.exports = {
  ytdlpVersion, latestYtdlpVersion, updateYtdlp, checkYtdlp, supportsJsRuntimes,
  installDeno, checkAppUpdate, extractFromZip, run,
};
