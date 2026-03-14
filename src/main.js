const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { execFile } = require('child_process');
const os    = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function getBinDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin');
  return path.join(__dirname, '..', 'bin');
}
function getBin(name) {
  return IS_WIN
    ? path.join(getBinDir(), name + '.exe')
    : path.join(getBinDir(), name);
}

const YT_DLP = getBin('yt-dlp');
const FFMPEG  = getBin('ffmpeg');

// ─── Persistance des paramètres (stockés dans userData) ──────────────────────
const SETTINGS_FILE = path.join(app.getPath('userData'), 'ydrop-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {}
  return { dlDir: '', cutDir: '' };
}
function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

// ─── Window ───────────────────────────────────────────────────────────────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1060, height: 720, minWidth: 820, minHeight: 580,
    frame: false, transparent: false, backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

// ─── Utils ────────────────────────────────────────────────────────────────────
function sanitizeFilename(raw) {
  const T = {
    'à':'a','â':'a','ä':'a','á':'a','ã':'a','å':'a','æ':'ae','è':'e','é':'e','ê':'e','ë':'e',
    'ì':'i','í':'i','î':'i','ï':'i','ò':'o','ó':'o','ô':'o','ö':'o','õ':'o','ø':'o','œ':'oe',
    'ù':'u','ú':'u','û':'u','ü':'u','ý':'y','ÿ':'y','ñ':'n','ç':'c','ß':'ss',
    'À':'A','Â':'A','Ä':'A','Á':'A','Ã':'A','Å':'A','Æ':'AE','È':'E','É':'E','Ê':'E','Ë':'E',
    'Ì':'I','Í':'I','Î':'I','Ï':'I','Ò':'O','Ó':'O','Ô':'O','Ö':'O','Õ':'O','Ø':'O','Œ':'OE',
    'Ù':'U','Ú':'U','Û':'U','Ü':'U','Ý':'Y','Ñ':'N','Ç':'C',
  };
  const dot  = raw.lastIndexOf('.');
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext  = dot > 0 ? raw.slice(dot) : '';
  const clean = base
    .replace(/[^\x00-\x7F]/g, c => T[c] ?? '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"\\\/|?*]/g, '_')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s{2,}/g, ' ').replace(/_{2,}/g, '_')
    .replace(/^[\s._]+|[\s._]+$/g, '').trim();
  return (clean || ('ydrop_' + Date.now())) + ext;
}

function cleanUrl(url) {
  try { const u = new URL(url); const v = u.searchParams.get('v'); if (v) return 'https://www.youtube.com/watch?v=' + v; } catch (_) {}
  return url;
}
function isValidYouTubeUrl(url) {
  return /youtube\.com\/watch\?v=[\w-]{11}|youtu\.be\/[\w-]{11}|youtube\.com\/shorts\/[\w-]{11}/.test(url);
}
function formatDuration(s) {
  if (!s) return '0:00';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(1)+'G';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return String(n);
}
function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'ydrop_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win:close',    () => win?.close());

// ─── Settings ─────────────────────────────────────────────────────────────────
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_, data) => { saveSettings(data); return true; });

// ─── Check binaries ───────────────────────────────────────────────────────────
ipcMain.handle('check-bins', () => ({
  ytdlp: fs.existsSync(YT_DLP), ffmpeg: fs.existsSync(FFMPEG),
  ytdlpPath: YT_DLP, ffmpegPath: FFMPEG, platform: process.platform,
}));

// ─── Fetch video info ─────────────────────────────────────────────────────────
ipcMain.handle('video:info', (_, url) => {
  if (!isValidYouTubeUrl(url)) throw new Error('URL YouTube invalide');
  const clean = cleanUrl(url);
  return new Promise((resolve, reject) => {
    execFile(YT_DLP, ['--dump-json', '--no-playlist', '--skip-download', clean],
      { maxBuffer: 50 * 1024 * 1024, timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error('Impossible d\'analyser : ' + (stderr || err.message).slice(0, 200)));
        try {
          const info = JSON.parse(stdout.trim());
          const thumb = (info.thumbnails || []).filter(t => t.url)
            .sort((a,b) => (b.width||0)-(a.width||0))[0]?.url
            || `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`;
          resolve({
            id: info.id, title: info.title,
            author: info.uploader || info.channel || '—',
            duration: formatDuration(info.duration),
            views: formatViews(info.view_count),
            thumbnail: thumb,
          });
        } catch (e) { reject(new Error('Erreur JSON : ' + e.message)); }
      }
    );
  });
});

// ─── Download video (logique identique à server.js original : execFile) ───────
ipcMain.handle('video:download', (event, { url, format, outputDir }) => {
  if (!isValidYouTubeUrl(url)) throw new Error('URL invalide');
  const clean = cleanUrl(url);

  const configs = {
    video_4k:      { f:'bestvideo[height<=2160]+bestaudio/best', merge:'mp4', ext:'mp4' },
    video_1080:    { f:'bestvideo[height<=1080]+bestaudio/best', merge:'mp4', ext:'mp4' },
    video_720:     { f:'bestvideo[height<=720]+bestaudio/best',  merge:'mp4', ext:'mp4' },
    video_480:     { f:'bestvideo[height<=480]+bestaudio/best',  merge:'mp4', ext:'mp4' },
    video_360:     { f:'bestvideo[height<=360]+bestaudio/best',  merge:'mp4', ext:'mp4' },
    audio_mp3_320: { audio:'mp3', quality:'0',  ext:'mp3' },
    audio_mp3_192: { audio:'mp3', quality:'5',  ext:'mp3' },
    audio_m4a:     { audio:'m4a',               ext:'m4a' },
    audio_flac:    { audio:'flac',              ext:'flac' },
    audio_wav:     { audio:'wav',               ext:'wav'  },
    audio_ogg:     { audio:'vorbis',            ext:'ogg'  },
  };

  const cfg = configs[format];
  if (!cfg) throw new Error('Format inconnu : ' + format);

  const tmpDir  = makeTmpDir();
  const outTmpl = path.join(tmpDir, '%(title)s.%(ext)s');

  const args = cfg.audio ? [
    '-f', 'bestaudio/best',
    '-x', '--audio-format', cfg.audio,
    ...(cfg.quality ? ['--audio-quality', cfg.quality] : []),
    '--ffmpeg-location', FFMPEG,
    '--no-playlist',
    '-o', outTmpl,
    clean,
  ] : [
    '-f', cfg.f,
    '--merge-output-format', cfg.merge,
    '--ffmpeg-location', FFMPEG,
    '--no-playlist',
    '-o', outTmpl,
    clean,
  ];

  // Progression simulée pendant execFile (indéterminée mais rassurante)
  let pct = 0;
  const progressTimer = setInterval(() => {
    if (pct < 90) { pct += 2; event.sender.send('download:progress', pct); }
  }, 800);

  return new Promise((resolve, reject) => {
    // execFile — identique à l'original server.js, maxBuffer 500 Mo, timeout 10 min
    execFile(YT_DLP, args,
      { maxBuffer: 500 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        clearInterval(progressTimer);

        if (stderr) console.log('[yt-dlp stderr]\n', stderr.slice(-600));

        let files = [];
        try {
          files = fs.readdirSync(tmpDir).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
        } catch (_) {}

        console.log('[download] fichiers trouvés:', files);

        // Si pas de fichier ET erreur → on remonte le message yt-dlp
        if (files.length === 0) {
          cleanup(tmpDir);
          const detail = (stderr || err?.message || 'Aucun fichier généré').slice(0, 400);
          return reject(new Error(detail));
        }

        // Succès même si err (yt-dlp peut renvoyer code ≠ 0 avec un fichier valide)
        const srcPath  = path.join(tmpDir, files[0]);
        const safeName = sanitizeFilename(files[0]) || ('ydrop_' + Date.now() + '.' + cfg.ext);
        const destPath = path.join(outputDir, safeName);

        try {
          fs.copyFileSync(srcPath, destPath);
          cleanup(tmpDir);
          event.sender.send('download:progress', 100);
          resolve({ filename: safeName, path: destPath, size: fs.statSync(destPath).size });
        } catch (e) {
          cleanup(tmpDir);
          reject(new Error('Erreur copie : ' + e.message));
        }
      }
    );
  });
});

// ─── Cut video (100% hors ligne — ffmpeg local uniquement) ────────────────────
ipcMain.handle('video:cut', (event, { inputPath, segments, ratio, outputDir, baseVideoName }) => {
  // Vérification préalable : ffmpeg doit être présent
  if (!fs.existsSync(FFMPEG)) throw new Error('ffmpeg introuvable dans bin/ — la découpe nécessite ffmpeg en local.');
  // Vérification que le fichier source existe localement
  if (!fs.existsSync(inputPath)) throw new Error('Fichier vidéo source introuvable : ' + inputPath);

  const ratioFilters = {
    '9:16': 'crop=ih*9/16:ih,scale=1080:1920',
    '1:1':  'crop=min(iw\\,ih):min(iw\\,ih),scale=1080:1080',
    '4:5':  'crop=ih*4/5:ih,scale=1080:1350',
    '16:9': 'crop=iw:iw*9/16,scale=1920:1080',
  };

  const safeBase = baseVideoName
    ? sanitizeFilename(baseVideoName + '.tmp').replace(/\.tmp$/, '')
    : 'segment';

  const results = [];

  const runSegment = (idx) => {
    if (idx >= segments.length) return Promise.resolve(results);
    const sg  = segments[idx];
    const dur = sg.end - sg.start;
    if (dur <= 0) return runSegment(idx + 1);

    const outName = `${safeBase}_part${String(sg.index).padStart(2,'0')}.mp4`;
    const outPath = path.join(outputDir, outName);
    const vf      = ratioFilters[ratio];

    // -ss avant -i = seek rapide (pas de décodage inutile) → 100% local, 0 réseau
    const args = [
      '-y',
      '-ss', sg.start.toFixed(3),
      '-i',  inputPath,
      '-t',  dur.toFixed(3),
      ...(vf ? ['-vf', vf] : []),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ];

    return new Promise((resolve, reject) => {
      execFile(FFMPEG, args, { timeout: 10 * 60 * 1000 }, err => {
        if (err && !fs.existsSync(outPath)) return reject(err);
        event.sender.send('cut:progress', { done: idx + 1, total: segments.length });
        results.push({ name: outName, path: outPath, size: fs.statSync(outPath).size });
        resolve();
      });
    }).then(() => runSegment(idx + 1));
  };

  return runSegment(0);
});

// ─── Dialogs ──────────────────────────────────────────────────────────────────
ipcMain.handle('dialog:choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory','createDirectory'], title: 'Choisir un dossier' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:open-video', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'], title: 'Ouvrir une vidéo',
    filters: [{ name: 'Vidéos', extensions: ['mp4','mov','avi','mkv','webm','m4v'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ─── OS actions ───────────────────────────────────────────────────────────────
ipcMain.on('open:file',   (_, p) => shell.openPath(p));
ipcMain.on('open:folder', (_, p) => shell.openPath(path.dirname(p)));

// ─── Probe video duration (local, aucun réseau) ───────────────────────────────
ipcMain.handle('video:probe', (_, filePath) => {
  const ffprobe = getBin('ffprobe');
  const probe   = fs.existsSync(ffprobe) ? ffprobe : FFMPEG;
  const args    = fs.existsSync(ffprobe)
    ? ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath]
    : ['-i', filePath];
  return new Promise(resolve => {
    execFile(probe, args, { timeout: 15000 }, (_, stdout, stderr) => {
      const m = (stdout || stderr || '').match(/Duration:\s*([\d:.]+)/);
      if (m) { const [h,mn,s] = m[1].split(':').map(Number); resolve(h*3600+mn*60+s); }
      else resolve(0);
    });
  });
});
