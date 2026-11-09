// Stockage JSON simple et robuste (écriture atomique) : paramètres + historique
const fs   = require('fs');
const path = require('path');
const { userDir } = require('./paths');

function readJson(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  return fallback;
}
function writeJsonAtomic(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { console.warn('[store] écriture impossible', file, e.message); }
}

// ── Paramètres (même fichier que la v1.0 : les réglages existants sont conservés) ──
const SETTINGS_FILE = () => path.join(userDir(), 'ydrop-settings.json');
const DEFAULT_SETTINGS = {
  dlDir: '', cutDir: '',
  defaultFormat: 'video_1080',
  subLang: '',                // '' = pas de sous-titres
  quickMode: true,            // télécharger dès le collage
  watchClipboard: true,       // détecter les liens copiés
  globalShortcut: true,       // Ctrl/Cmd+Maj+Y : télécharger le lien du presse-papiers
  concurrency: 2,
  cookiesBrowser: '',         // chrome | firefox | edge | brave | safari…
  notify: true,
  autoUpdateYtdlp: true,
  lastYtdlpCheck: 0,
  cutQuality: 'balanced',     // fast | balanced | high
  subStyle: 'tiktok',
  whisperModel: '',
  whisperLang: 'auto',
};
let settingsCache = null;
function loadSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE(), {}) };
  return settingsCache;
}
function saveSettings(patch) {
  settingsCache = { ...loadSettings(), ...patch };
  writeJsonAtomic(SETTINGS_FILE(), settingsCache);
  return settingsCache;
}

// ── Historique ──
const HISTORY_FILE = () => path.join(userDir(), 'ydrop-history.json');
const HISTORY_MAX = 500;
let historyCache = null;
function history() {
  if (!historyCache) { const d = readJson(HISTORY_FILE(), []); historyCache = Array.isArray(d) ? d : []; }
  return historyCache;
}
function persistHistory() { writeJsonAtomic(HISTORY_FILE(), history()); }
function historyAdd(entry) {
  const h = history();
  h.unshift(entry);
  if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
  persistHistory();
}
function historyRemove(id) {
  const i = history().findIndex(e => e.id === id);
  if (i < 0) return null;
  const [e] = history().splice(i, 1);
  persistHistory();
  return e;
}
function historyClear() { historyCache = []; persistHistory(); }
function historyFind(id) { return history().find(e => e.id === id) || null; }

module.exports = { loadSettings, saveSettings, DEFAULT_SETTINGS, history, historyAdd, historyRemove, historyClear, historyFind };
