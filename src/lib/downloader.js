// File d'attente de téléchargements : progression réelle, annulation, relances, diagnostic d'erreurs
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');

const P = require('./paths');
const store = require('./store');
const tools = require('./tools');
const { classify } = require('./errors');
const { parseYouTube } = require('./youtube');
const U = require('./utils');
const Srt = require('../shared/srt');

// ── Formats ──
// -S (tri) privilégie H.264/AAC : lecture partout (TikTok, WhatsApp, Windows…), avec repli automatique.
const FORMATS = {
  video_best:    { label: 'Meilleure qualité', kind: 'video', sort: 'res,vcodec:h264,acodec:m4a' },
  video_4k:      { label: '4K',    kind: 'video', sort: 'res:2160,vcodec:h264,acodec:m4a' },
  video_1080:    { label: '1080p', kind: 'video', sort: 'res:1080,vcodec:h264,acodec:m4a' },
  video_720:     { label: '720p',  kind: 'video', sort: 'res:720,vcodec:h264,acodec:m4a' },
  video_480:     { label: '480p',  kind: 'video', sort: 'res:480,vcodec:h264,acodec:m4a' },
  video_360:     { label: '360p',  kind: 'video', sort: 'res:360,vcodec:h264,acodec:m4a' },
  audio_mp3_320: { label: 'MP3 320k', kind: 'audio', audio: 'mp3', quality: '320K' },
  audio_mp3_192: { label: 'MP3 192k', kind: 'audio', audio: 'mp3', quality: '192K' },
  audio_m4a:     { label: 'M4A',  kind: 'audio', audio: 'm4a' },
  audio_flac:    { label: 'FLAC', kind: 'audio', audio: 'flac' },
  audio_wav:     { label: 'WAV',  kind: 'audio', audio: 'wav' },
  audio_ogg:     { label: 'OGG',  kind: 'audio', audio: 'vorbis' },
};
const MEDIA_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4a', '.mp3', '.flac', '.wav', '.ogg', '.opus', '.aac']);
const MAX_ATTEMPTS = 3;
const STALL_MS = 180000;

class Downloader extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();       // id -> job
    this.order = [];             // ids, ordre d'ajout
    this.procs = new Set();      // processus yt-dlp vivants
    this.paused = false;         // vrai pendant une mise à jour d'outil
    this.updatePromise = null;
    this.lastUpdateAttempt = 0;
    this.ytdlpVer = null;
  }

  // ── Environnement ──
  _env() {
    const extra = [P.userBinDir(), P.bundledBinDir(), path.dirname(P.ffmpeg())].join(path.delimiter);
    return { ...process.env, PATH: extra + path.delimiter + (process.env.PATH || ''), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  }
  async _commonArgs() {
    const s = store.loadSettings();
    const a = ['--no-color', '--ffmpeg-location', P.ffmpeg()];
    if (s.cookiesBrowser) a.push('--cookies-from-browser', s.cookiesBrowser);
    if (!this.ytdlpVer) this.ytdlpVer = await tools.ytdlpVersion();
    if (tools.supportsJsRuntimes(this.ytdlpVer)) {
      const deno = P.deno(), node = P.nodeRuntime();
      if (deno) a.push('--js-runtimes', 'deno:' + deno);
      else if (node) a.push('--js-runtimes', 'node:' + node);
    }
    return a;
  }
  defaultOutputDir() {
    const s = store.loadSettings();
    if (s.dlDir) return s.dlDir;
    let base;
    try { base = require('electron').app.getPath('downloads'); } catch (_) { base = path.join(require('os').homedir(), 'Downloads'); }
    const d = path.join(base, 'YDrop');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // ── Info vidéo / playlist ──
  async info(url) {
    const p = parseYouTube(url);
    if (!p || p.kind !== 'video') throw Object.assign(new Error('Lien YouTube invalide'), { cls: classify('', 'Unsupported URL') });
    const args = [...(await this._commonArgs()), '--dump-json', '--no-playlist', '--skip-download', '--no-warnings', p.url];
    return new Promise((resolve, reject) => {
      execFile(P.ytdlp(), args, { maxBuffer: 100 * 1024 * 1024, timeout: 60000, windowsHide: true, env: this._env() }, (err, stdout, stderr) => {
        if (err && !stdout) {
          const cls = classify(stderr, err.message);
          return reject(Object.assign(new Error(cls.title + (cls.detail ? ' — ' + cls.detail : '')), { cls }));
        }
        try {
          const i = JSON.parse(stdout.trim().split('\n')[0]);
          const thumb = (i.thumbnails || []).filter(t => t.url && /^https/.test(t.url) && !/\.webp/.test(t.url))
            .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || `https://i.ytimg.com/vi/${i.id}/hqdefault.jpg`;
          resolve({
            id: i.id, url: p.url, listId: p.listId, title: i.title, author: i.uploader || i.channel || '—',
            duration: i.duration || 0, durationText: U.formatDuration(i.duration), views: U.formatViews(i.view_count),
            thumbnail: thumb, isLive: !!i.is_live,
          });
        } catch (e) { reject(new Error('Réponse illisible de yt-dlp : ' + e.message)); }
      });
    });
  }
  async playlist(url) {
    const p = parseYouTube(url);
    const target = p && p.listId ? 'https://www.youtube.com/playlist?list=' + p.listId : url;
    const args = [...(await this._commonArgs()), '--flat-playlist', '-J', '--no-warnings', target];
    return new Promise((resolve, reject) => {
      execFile(P.ytdlp(), args, { maxBuffer: 200 * 1024 * 1024, timeout: 120000, windowsHide: true, env: this._env() }, (err, stdout, stderr) => {
        if (err && !stdout) { const cls = classify(stderr, err.message); return reject(Object.assign(new Error(cls.title), { cls })); }
        try {
          const j = JSON.parse(stdout);
          const entries = (j.entries || []).filter(e => e && e.id).map(e => ({
            id: e.id, url: 'https://www.youtube.com/watch?v=' + e.id, title: e.title || e.id,
            duration: e.duration || 0, durationText: U.formatDuration(e.duration),
            author: e.uploader || e.channel || j.uploader || '—',
            thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
          }));
          resolve({ title: j.title || 'Playlist', author: j.uploader || j.channel || '', entries });
        } catch (e) { reject(new Error('Playlist illisible : ' + e.message)); }
      });
    });
  }

  // ── File d'attente ──
  snapshot(job) {
    const { _child, _tmp, _timer, ...pub } = job;
    return pub;
  }
  _emit(job) { this.emit('update', this.snapshot(job)); }
  list() { return this.order.map(id => this.snapshot(this.jobs.get(id))); }
  activeCount() { return this.order.filter(id => ['queued', 'fetching', 'downloading', 'processing', 'retrying', 'updating'].includes(this.jobs.get(id).status)).length; }

  // items : [{ url, format, subLang, info?, force? }]
  enqueue(items, opts = {}) {
    const s = store.loadSettings();
    const added = [], skipped = [];
    for (const it of items) {
      const p = parseYouTube(it.url);
      if (!p || p.kind !== 'video') { skipped.push({ url: it.url, reason: 'invalid' }); continue; }
      const format = FORMATS[it.format] ? it.format : (FORMATS[s.defaultFormat] ? s.defaultFormat : 'video_1080');
      if (!it.force) {
        const active = this.order.map(id => this.jobs.get(id)).find(j => j.videoId === p.id && j.format === format && ['queued', 'fetching', 'downloading', 'processing', 'retrying', 'updating'].includes(j.status));
        if (active) { skipped.push({ url: it.url, reason: 'active', title: active.title }); continue; }
        const done = store.history().find(h => h.videoId === p.id && h.format === format && h.status === 'done' && h.filePath && fs.existsSync(h.filePath));
        if (done) { skipped.push({ url: it.url, reason: 'already', title: done.title, historyId: done.id, filePath: done.filePath }); continue; }
      }
      const info = it.info || {};
      const job = {
        id: crypto.randomUUID(), url: p.url, videoId: p.id, format, formatLabel: FORMATS[format].label, kind: FORMATS[format].kind,
        subLang: it.subLang ?? s.subLang ?? '',
        title: info.title || '', author: info.author || '', thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg`,
        duration: info.duration || 0, durationText: info.durationText || '',
        outputDir: opts.outputDir || this.defaultOutputDir(),
        status: 'queued', stage: 'En attente', percent: 0, speed: '', eta: '', attempts: 0, error: null,
        filePath: '', size: 0, subFiles: [], warning: '', createdAt: Date.now(),
      };
      this.jobs.set(job.id, job); this.order.push(job.id);
      added.push(this.snapshot(job)); this._emit(job);
    }
    this._pump();
    return { added, skipped };
  }

  _pump() {
    if (this.paused) return;
    const max = Math.max(1, Math.min(4, +store.loadSettings().concurrency || 2));
    let running = this.order.filter(id => ['fetching', 'downloading', 'processing'].includes(this.jobs.get(id).status)).length;
    for (const id of this.order) {
      if (running >= max) break;
      const j = this.jobs.get(id);
      if (j.status === 'queued') { running++; this._run(j); }
    }
  }

  cancel(id) {
    const j = this.jobs.get(id); if (!j) return false;
    if (['done', 'error', 'cancelled'].includes(j.status)) return false;
    j.cancelled = true;
    if (j._child) U.killTree(j._child);
    if (j.status === 'queued') this._finishCancel(j);
    return true;
  }
  _finishCancel(j) {
    j.status = 'cancelled'; j.stage = 'Annulé'; j.speed = ''; j.eta = '';
    if (j._tmp) U.cleanup(j._tmp);
    this._emit(j); this._pump();
  }
  retry(id) {
    const j = this.jobs.get(id); if (!j || !['error', 'cancelled'].includes(j.status)) return false;
    Object.assign(j, { status: 'queued', stage: 'En attente', percent: 0, speed: '', eta: '', error: null, attempts: 0, cancelled: false, warning: '' });
    this._emit(j); this._pump(); return true;
  }
  remove(id) {
    const j = this.jobs.get(id); if (!j) return;
    if (!['done', 'error', 'cancelled'].includes(j.status)) this.cancel(id);
    this.jobs.delete(id); this.order = this.order.filter(x => x !== id);
    this.emit('removed', id);
  }
  clearFinished() {
    for (const id of [...this.order]) if (['done', 'cancelled'].includes(this.jobs.get(id).status)) this.remove(id);
  }

  // ── Exécution d'un job ──
  async _run(job) {
    job.status = 'fetching'; job.stage = 'Analyse du lien…'; job.percent = 0; job.attempts++;
    this._emit(job);
    try {
      if (!job.title) {
        const info = await this.info(job.url);
        Object.assign(job, { title: info.title, author: info.author, thumbnail: info.thumbnail, duration: info.duration, durationText: info.durationText });
        if (info.isLive) throw Object.assign(new Error('live'), { cls: classify('', 'This live event will begin') });
        this._emit(job);
      }
      if (job.cancelled) return this._finishCancel(job);
      const res = await this._download(job);
      if (job.cancelled) return this._finishCancel(job);
      await this._finalize(job, res);
    } catch (e) {
      if (job.cancelled) return this._finishCancel(job);
      await this._handleFailure(job, e.cls || classify(e.stderr || '', e.message), e.stderr || e.message);
    }
  }

  async _handleFailure(job, cls, rawText) {
    if (job._tmp) { U.cleanup(job._tmp); job._tmp = null; }
    // Réessais automatiques
    if (cls.retryable && job.attempts < MAX_ATTEMPTS) {
      if (cls.action === 'update-ytdlp' && Date.now() - this.lastUpdateAttempt > 10 * 60 * 1000) {
        job.status = 'updating'; job.stage = 'Mise à jour de yt-dlp, puis nouvel essai…'; this._emit(job);
        try { await this.updateYtdlp(); } catch (_) {}
        job.status = 'queued'; this._emit(job); return this._pump();
      }
      if (cls.code === 'network' || cls.code === 'rate-limit') {
        job.status = 'retrying'; job.stage = `Nouvel essai ${job.attempts + 1}/${MAX_ATTEMPTS} dans quelques secondes…`; this._emit(job);
        await new Promise(r => setTimeout(r, 4000 * job.attempts));
        if (job.cancelled) return this._finishCancel(job);
        job.status = 'queued'; this._emit(job); return this._pump();
      }
    }
    job.status = 'error'; job.stage = 'Échec'; job.speed = ''; job.eta = '';
    job.error = { code: cls.code, title: cls.title, hint: cls.hint, action: cls.action, detail: cls.detail, raw: String(rawText || '').slice(-1500) };
    // Un échec remplace un éventuel échec précédent du même téléchargement dans l'historique
    this._historyReplaceFailed(job);
    store.historyAdd(this._historyEntry(job, 'error'));
    this._emit(job); this.emit('failed', this.snapshot(job)); this._pump();
  }

  _historyReplaceFailed(job) {
    for (const h of store.history().slice()) if (h.status === 'error' && h.videoId === job.videoId && h.format === job.format) store.historyRemove(h.id);
  }
  _historyEntry(job, status) {
    return {
      id: job.id, status, url: job.url, videoId: job.videoId, title: job.title || job.url, author: job.author, thumbnail: job.thumbnail,
      duration: job.duration, durationText: job.durationText, format: job.format, formatLabel: job.formatLabel, kind: job.kind,
      subLang: job.subLang, filePath: job.filePath, size: job.size, subFiles: job.subFiles, date: Date.now(),
      error: job.error ? { code: job.error.code, title: job.error.title, hint: job.error.hint, detail: job.error.detail } : null,
    };
  }

  _buildArgs(job, tmp, common) {
    const f = FORMATS[job.format];
    const args = [...common, '--newline', '--no-playlist', '--retries', '10', '--fragment-retries', '10',
      '--socket-timeout', '30', '--concurrent-fragments', '4', '--no-mtime', '--windows-filenames',
      '-o', path.join(tmp, '%(id)s.%(ext)s')];
    if (f.kind === 'audio') {
      args.push('-f', 'ba/b', '-x', '--audio-format', f.audio, '--embed-metadata');
      if (f.quality) args.push('--audio-quality', f.quality);
    } else {
      args.push('-f', 'bv*+ba/b', '-S', f.sort, '--merge-output-format', 'mp4');
    }
    if (job.subLang) {
      // Sous-titres manuels si possibles, sinon automatiques ; convertis en .srt
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', `${job.subLang},${job.subLang}-orig`, '--convert-subs', 'srt');
    }
    args.push(job.url);
    return args;
  }

  async _download(job) {
    const tmp = U.makeTmpDir('ydrop'); job._tmp = tmp;
    const common = await this._commonArgs();
    const args = this._buildArgs(job, tmp, common);
    job.status = 'downloading'; job.stage = 'Connexion…'; this._emit(job);

    return new Promise((resolve, reject) => {
      let child;
      try { child = spawn(P.ytdlp(), args, { windowsHide: true, env: this._env() }); }
      catch (e) { return reject(Object.assign(e, { stderr: e.message })); }
      job._child = child; this.procs.add(child);

      let streams = 1, idx = -1, lastOut = Date.now(), stderr = '', outTail = '', lastEmit = 0, post = false;
      const watchdog = setInterval(() => {
        if (!post && Date.now() - lastOut > STALL_MS) { stderr += '\nTimed out: aucune activité pendant 3 minutes'; U.killTree(child); }
      }, 10000);

      const onLine = (line) => {
        lastOut = Date.now();
        outTail = (outTail + line + '\n').slice(-4000);
        let m;
        if ((m = line.match(/Downloading (\d+) format\(s\):\s*(.+)/))) streams = Math.max(1, m[2].split('+').length);
        if (/^\[download\] Destination:/.test(line)) idx++;
        if (/^\[download\]\s+[\d.]+%/.test(line) || /has already been downloaded/.test(line)) {
          const pm = line.match(/([\d.]+)%/); const p = pm ? parseFloat(pm[1]) : 100;
          const sp = line.match(/at\s+([\d.]+\s?[KMGT]?i?B\/s)/i), et = line.match(/ETA\s+([\d:]+)/);
          const cur = Math.max(0, idx);
          job.percent = Math.min(97, ((Math.min(cur, streams - 1) + p / 100) / streams) * 100);
          job.speed = sp ? sp[1].replace(/\s+/g, '') : job.speed; job.eta = et ? et[1] : '';
          const what = job.kind === 'audio' ? 'audio' : (streams > 1 ? (cur === 0 ? 'vidéo' : 'audio') : 'vidéo');
          job.stage = `Téléchargement ${what}${streams > 1 ? ` (${Math.min(cur + 1, streams)}/${streams})` : ''}`;
        } else if (/^\[Merger\]|^\[VideoRemuxer\]|^\[Fixup/.test(line)) {
          post = true; job.status = 'processing'; job.stage = 'Fusion vidéo + audio…'; job.speed = ''; job.eta = ''; job.percent = 98;
        } else if (/^\[ExtractAudio\]/.test(line)) {
          post = true; job.status = 'processing'; job.stage = 'Conversion audio…'; job.speed = ''; job.eta = ''; job.percent = 98;
        } else if (/^\[info\] Writing video subtitles|Downloading subtitles/.test(line)) {
          job.stage = 'Sous-titres…';
        } else return;
        const now = Date.now();
        if (now - lastEmit > 250) { lastEmit = now; this._emit(job); }
      };
      const lineSplitter = (cb) => { let acc = ''; return d => { acc += d.toString('utf8'); const parts = acc.split(/\r?\n|\r/); acc = parts.pop(); parts.forEach(cb); }; };
      child.stdout.on('data', lineSplitter(onLine));
      child.stderr.on('data', lineSplitter(l => { lastOut = Date.now(); stderr = (stderr + l + '\n').slice(-6000); }));
      child.on('error', err => { clearInterval(watchdog); this.procs.delete(child); reject(Object.assign(err, { stderr: err.code === 'ENOENT' ? 'spawn ENOENT' : String(err.message) })); });
      child.on('close', code => { clearInterval(watchdog); this.procs.delete(child); job._child = null; resolve({ code, stderr, outTail, tmp }); });
    });
  }

  async _finalize(job, res) {
    const tmp = res.tmp;
    let files = [];
    try { files = fs.readdirSync(tmp).map(f => ({ f, p: path.join(tmp, f), ext: path.extname(f).toLowerCase() })); } catch (_) {}
    const media = files.filter(x => MEDIA_EXT.has(x.ext)).map(x => ({ ...x, size: fs.statSync(x.p).size })).sort((a, b) => b.size - a.size)[0];
    if (!media) {
      const cls = classify(res.stderr || res.outTail, res.code ? 'yt-dlp a quitté avec le code ' + res.code : 'Aucun fichier généré');
      throw Object.assign(new Error(cls.title), { cls, stderr: res.stderr });
    }
    job.stage = 'Finalisation…'; job.percent = 99; this._emit(job);

    fs.mkdirSync(job.outputDir, { recursive: true });
    const base = U.sanitizeName(job.title, 'ydrop_' + job.videoId);
    const dest = U.uniquePath(job.outputDir, base, media.ext);
    U.moveFile(media.p, dest);
    const finalBase = path.basename(dest, media.ext);

    // Sous-titres : nettoyage des doublons des sous-titres automatiques puis rangés à côté de la vidéo
    const subFiles = [];
    for (const x of files.filter(x => x.ext === '.srt' || x.ext === '.vtt')) {
      try {
        const raw = fs.readFileSync(x.p, 'utf8');
        const cues = Srt.cleanAuto(Srt.parse(raw));
        if (!cues.length) continue;
        const lang = (x.f.match(/\.([A-Za-z-]+)\.(?:srt|vtt)$/) || [])[1] || job.subLang || 'sub';
        const target = U.uniquePath(job.outputDir, `${finalBase}.${lang}`, '.srt');
        fs.writeFileSync(target, Srt.stringify(cues), 'utf8');
        subFiles.push(target);
      } catch (_) {}
    }
    U.cleanup(tmp); job._tmp = null;

    job.filePath = dest; job.size = fs.statSync(dest).size; job.subFiles = subFiles;
    if (job.subLang && !subFiles.length) job.warning = 'Aucun sous-titre « ' + job.subLang + ' » disponible pour cette vidéo.';
    else if (res.code !== 0 && /ERROR/i.test(res.stderr || '')) job.warning = 'Terminé avec des avertissements (ex. sous-titres indisponibles).';
    job.status = 'done'; job.stage = 'Terminé'; job.percent = 100; job.speed = ''; job.eta = '';
    this._historyReplaceFailed(job);
    store.historyAdd(this._historyEntry(job, 'done'));
    this._emit(job); this.emit('done', this.snapshot(job)); this._pump();
  }

  // ── Mise à jour yt-dlp (attend la fin des processus en cours) ──
  updateYtdlp(onProgress) {
    if (this.updatePromise) return this.updatePromise;
    this.lastUpdateAttempt = Date.now();
    this.paused = true;
    this.updatePromise = (async () => {
      const t0 = Date.now();
      while (this.procs.size > 0 && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 400));
      const r = await tools.updateYtdlp(onProgress);
      this.ytdlpVer = await tools.ytdlpVersion();
      store.saveSettings({ lastYtdlpCheck: Date.now() });
      return r;
    })().finally(() => { this.paused = false; this.updatePromise = null; this._pump(); });
    return this.updatePromise;
  }
}

module.exports = { Downloader, FORMATS };
