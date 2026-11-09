const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');

const P        = require('./lib/paths');
const store    = require('./lib/store');
const tools    = require('./lib/tools');
const cutter   = require('./lib/cutter');
const U        = require('./lib/utils');
const { Downloader, FORMATS } = require('./lib/downloader');
const { extractUrls } = require('./lib/youtube');

const IS_MAC = P.IS_MAC;
const SHORTCUT = 'CommandOrControl+Shift+Y';
const downloader = new Downloader();

// ─── Instance unique ─────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// ─── Fenêtre ─────────────────────────────────────────────────────────────────
let win = null;
function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 860, minHeight: 600,
    frame: false, transparent: false, backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternalSafe(url); } });
  win.on('focus', () => checkClipboard());
  win.webContents.on('did-finish-load', () => { setTimeout(checkClipboard, 600); setTimeout(startupChecks, 3500); });
  win.on('closed', () => { win = null; });
}
function openExternalSafe(url) { if (/^https:\/\//i.test(url)) shell.openExternal(url); }

app.whenReady().then(() => {
  createWindow();
  registerShortcut();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// ─── Notifications & barre des tâches ────────────────────────────────────────
function notify(title, body, onClick) {
  if (!store.loadSettings().notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}
function updateTaskbar() {
  if (!win || win.isDestroyed()) return;
  const act = downloader.list().filter(j => ['fetching', 'downloading', 'processing'].includes(j.status));
  if (!act.length) { win.setProgressBar(cutProgress >= 0 ? cutProgress : -1); return; }
  win.setProgressBar(act.reduce((a, j) => a + j.percent, 0) / act.length / 100);
}
let cutProgress = -1;

// ─── Téléchargements : événements ────────────────────────────────────────────
downloader.on('update', snap => { send('dl:update', snap); updateTaskbar(); });
downloader.on('removed', id => send('dl:removed', id));
downloader.on('done', job => {
  send('history:changed');
  notify('Téléchargement terminé ✓', job.title, () => { if (job.filePath) shell.showItemInFolder(job.filePath); });
});
downloader.on('failed', job => {
  send('history:changed');
  notify('Échec du téléchargement', `${job.title || job.url} — ${job.error?.title || ''}`);
});

// ─── Presse-papiers : détection des liens ────────────────────────────────────
let lastClipUrl = '';
function checkClipboard() {
  const s = store.loadSettings();
  if (!s.watchClipboard || !win || win.isDestroyed()) return;
  let text = '';
  try { text = clipboard.readText(); } catch (_) {}
  const first = extractUrls(text).find(u => u.kind === 'video');
  if (!first || first.url === lastClipUrl) return;
  lastClipUrl = first.url;
  const known = store.history().find(h => h.videoId === first.id && h.status === 'done' && h.filePath && fs.existsSync(h.filePath));
  send('clipboard:url', { url: first.url, known: known ? { id: known.id, title: known.title, filePath: known.filePath } : null });
}

// Raccourci global : copiez un lien dans le navigateur, Ctrl/Cmd+Maj+Y → téléchargement lancé
function registerShortcut() {
  globalShortcut.unregister(SHORTCUT);
  if (!store.loadSettings().globalShortcut) return;
  try {
    globalShortcut.register(SHORTCUT, () => {
      const urls = extractUrls(clipboard.readText()).filter(u => u.kind === 'video');
      if (!urls.length) return notify('YDrop', 'Aucun lien YouTube dans le presse-papiers.');
      const r = downloader.enqueue(urls.map(u => ({ url: u.url })));
      lastClipUrl = urls[0].url;
      send('dl:focus');
      if (r.added.length) notify('YDrop — téléchargement lancé', r.added.length === 1 ? r.added[0].title || r.added[0].url : `${r.added.length} vidéos ajoutées`);
      else if (r.skipped.length) notify('YDrop', r.skipped[0].reason === 'already' ? 'Déjà téléchargée : ' + (r.skipped[0].title || '') : 'Déjà en cours de téléchargement.');
    });
  } catch (_) {}
}

// ─── Vérifications au démarrage (en arrière-plan) ────────────────────────────
async function startupChecks() {
  const s = store.loadSettings();
  try {
    const upd = await tools.checkAppUpdate(app.getVersion());
    if (upd) send('app:update', upd);
  } catch (_) {}
  if (!s.autoUpdateYtdlp) return;
  try {
    const ver = await tools.ytdlpVersion();
    const stale = Date.now() - (s.lastYtdlpCheck || 0) > 24 * 3600 * 1000;
    if (!ver || stale) {
      const c = await tools.checkYtdlp();
      if (!ver || (c.latest && !c.upToDate)) {
        send('tools:notice', { type: 'info', text: ver ? 'Mise à jour de yt-dlp en cours…' : 'Installation de yt-dlp en cours…' });
        const r = await downloader.updateYtdlp();
        send('tools:notice', { type: 'ok', text: `yt-dlp est à jour (${r.after}).` });
      } else store.saveSettings({ lastYtdlpCheck: Date.now() });
    }
  } catch (e) { console.warn('[startup] yt-dlp:', e.message); }
  try {
    const ver = await tools.ytdlpVersion();
    if (!P.deno() && !P.nodeRuntime() && tools.supportsJsRuntimes(ver)) {
      send('tools:notice', { type: 'info', text: 'Installation du composant JavaScript (Deno) requis par YouTube…' });
      const r = await tools.installDeno();
      send('tools:notice', { type: 'ok', text: 'Composant JavaScript installé (Deno ' + r.version + ').' });
    }
  } catch (e) { console.warn('[startup] deno:', e.message); send('tools:notice', { type: 'err', text: 'Installation de Deno impossible : ' + e.message }); }
  send('tools:changed');
}

// ─── Contrôles fenêtre ───────────────────────────────────────────────────────
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('win:close',    () => win?.close());

// ─── Paramètres ──────────────────────────────────────────────────────────────
ipcMain.handle('settings:load', () => store.loadSettings());
ipcMain.handle('settings:save', (_, patch) => {
  const s = store.saveSettings(patch || {});
  if ('globalShortcut' in (patch || {})) registerShortcut();
  return s;
});

// ─── Outils ──────────────────────────────────────────────────────────────────
ipcMain.handle('tools:status', async () => {
  const ytdlpPath = P.ytdlp(), ffmpegPath = P.ffmpeg();
  const deno = P.deno(), node = P.nodeRuntime();
  const w = cutter.whisperStatus();
  return {
    platform: process.platform, appVersion: app.getVersion(),
    ytdlp: fs.existsSync(ytdlpPath), ytdlpPath, ytdlpVersion: await tools.ytdlpVersion(),
    ffmpeg: fs.existsSync(ffmpegPath) || !!P.findInPath('ffmpeg'), ffmpegPath, ffprobe: !!P.ffprobe(),
    jsRuntime: deno ? 'deno' : node ? 'node' : null, jsRuntimePath: deno || node || '',
    whisper: { installed: !!w.bin, bin: w.bin || '', models: w.models, dir: w.dirs[0] },
    formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, kind: f.kind })),
  };
});
ipcMain.handle('tools:update-ytdlp', async () => {
  const r = await downloader.updateYtdlp(p => send('tools:progress', { tool: 'yt-dlp', percent: Math.round(p * 100) }));
  send('tools:changed'); return r;
});
ipcMain.handle('tools:install-deno', async () => {
  const r = await tools.installDeno(p => send('tools:progress', { tool: 'deno', percent: Math.round(p * 100) }));
  send('tools:changed'); return r;
});
ipcMain.handle('tools:check-ytdlp', () => tools.checkYtdlp());

// ─── Téléchargement ──────────────────────────────────────────────────────────
const errOut = (e) => { throw new Error(e.message); };
ipcMain.handle('video:info', (_, url) => downloader.info(url).catch(errOut));
ipcMain.handle('video:playlist', (_, url) => downloader.playlist(url).catch(errOut));
ipcMain.handle('dl:enqueue', (_, items) => downloader.enqueue(items));
ipcMain.handle('dl:list', () => downloader.list());
ipcMain.handle('dl:cancel', (_, id) => downloader.cancel(id));
ipcMain.handle('dl:retry', (_, id) => downloader.retry(id));
ipcMain.handle('dl:remove', (_, id) => { downloader.remove(id); return true; });
ipcMain.handle('dl:clear-finished', () => { downloader.clearFinished(); return true; });
ipcMain.handle('clipboard:urls', () => extractUrls(clipboard.readText()));
ipcMain.handle('clipboard:write', (_, t) => { clipboard.writeText(String(t || '')); return true; });
ipcMain.handle('url:extract', (_, text) => extractUrls(text));

// ─── Historique ──────────────────────────────────────────────────────────────
ipcMain.handle('history:list', () => store.history().map(h => ({ ...h, exists: !!h.filePath && fs.existsSync(h.filePath) })));
ipcMain.handle('history:remove', async (_, { id, deleteFile }) => {
  const e = store.historyRemove(id);
  if (e && deleteFile && e.filePath && fs.existsSync(e.filePath)) { try { await shell.trashItem(e.filePath); } catch (_) { try { fs.unlinkSync(e.filePath); } catch (__) {} } }
  return true;
});
ipcMain.handle('history:clear', () => { store.historyClear(); return true; });
ipcMain.handle('history:redownload', (_, { id, format }) => {
  const e = store.historyFind(id); if (!e) throw new Error('Entrée introuvable');
  return downloader.enqueue([{
    url: e.url, format: format || e.format, subLang: e.subLang, force: true,
    info: { title: e.title, author: e.author, thumbnail: e.thumbnail, duration: e.duration, durationText: e.durationText },
  }]);
});

// ─── Découpe ─────────────────────────────────────────────────────────────────
let task = null; // tâche longue en cours (découpe, détection de pauses, Whisper)
function newTask() { task = { cancelled: false, child: null }; return task; }
ipcMain.handle('task:cancel', () => { if (task) { task.cancelled = true; U.killTree(task.child); } return true; });

ipcMain.handle('cut:probe', (_, f) => cutter.probe(f));
ipcMain.handle('cut:silences', async (_, { file, duration }) => {
  const t = newTask();
  const r = await cutter.detectSilences(file, duration, p => send('cut:silence-progress', p), t);
  return t.cancelled ? [] : r;
});
ipcMain.handle('cut:start', async (_, opts) => {
  const t = newTask();
  try {
    const r = await cutter.cut(opts, p => { cutProgress = p.percent / 100; send('cut:progress', p); updateTaskbar(); }, t);
    notify('Découpe terminée ✓', `${r.results.length} fichier${r.results.length > 1 ? 's' : ''} exporté${r.results.length > 1 ? 's' : ''}`, () => shell.openPath(r.folder));
    return r;
  } catch (e) {
    if (e.cancelled) return { cancelled: true, results: [] };
    throw new Error(e.message);
  } finally { cutProgress = -1; updateTaskbar(); }
});
ipcMain.handle('subs:siblings', (_, f) => cutter.findSiblingSubs(f));
ipcMain.handle('subs:read', (_, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('subs:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Choisir un fichier de sous-titres', filters: [{ name: 'Sous-titres', extensions: ['srt'] }] });
  if (r.canceled) return null;
  return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('subs:generate', async (_, opts) => {
  const t = newTask();
  try { return await cutter.generateSubs(opts, p => send('subs:progress', p), t); }
  catch (e) { if (e.cancelled) return null; throw new Error(e.message); }
});
ipcMain.handle('whisper:open-folder', () => {
  const d = P.whisperDirs()[0]; fs.mkdirSync(path.join(d, 'models'), { recursive: true }); shell.openPath(d); return d;
});

// ─── Dialogues & OS ──────────────────────────────────────────────────────────
ipcMain.handle('dialog:choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choisir un dossier' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:open-video', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'], title: 'Ouvrir une vidéo',
    filters: [{ name: 'Vidéos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('open:file',   (_, p) => { if (p && fs.existsSync(p)) shell.openPath(p); });
ipcMain.on('open:folder', (_, p) => { if (p && fs.existsSync(p)) (fs.statSync(p).isDirectory() ? shell.openPath(p) : shell.showItemInFolder(p)); });
ipcMain.on('open:external', (_, url) => openExternalSafe(url));
