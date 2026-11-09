// Découpe vidéo 100 % locale : formats multiples (TikTok, Reels…), cadrage, sous-titres incrustés, détection des pauses, Whisper
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');

const P = require('./paths');
const U = require('./utils');
const Srt = require('../shared/srt');

// ── Formats de sortie ──
const RATIOS = {
  '9:16': { w: 1080, h: 1920, folder: '9x16' },
  '4:5':  { w: 1080, h: 1350, folder: '4x5' },
  '1:1':  { w: 1080, h: 1080, folder: '1x1' },
  '16:9': { w: 1920, h: 1080, folder: '16x9' },
  original: { folder: 'Original' },
};
const QUALITY = {
  fast:     { preset: 'ultrafast', crf: '26' },
  balanced: { preset: 'veryfast',  crf: '22' },
  high:     { preset: 'medium',    crf: '19' },
};

// ── Sous-titres : styles ASS (unités relatives à une hauteur de 288, comme libass pour les SRT) ──
const SUB_STYLES = {
  classic: { bold: 0, outline: 1.4, shadow: 0.6, primary: '&H00FFFFFF', border: 1, scale: 1.0 },
  tiktok:  { bold: 1, outline: 3.0, shadow: 0.0, primary: '&H00FFFFFF', border: 1, scale: 1.25 },
  yellow:  { bold: 1, outline: 3.0, shadow: 0.0, primary: '&H0000F0FF', border: 1, scale: 1.25 },
  box:     { bold: 1, outline: 3.5, shadow: 0.0, primary: '&H00FFFFFF', border: 3, scale: 1.05, box: '&H99000000' },
};
const SIZE_MULT = { s: 0.8, m: 1, l: 1.3 };

function subtitleStyle({ style = 'tiktok', size = 'm', position = 'bottom' }, outW, outH) {
  const st = SUB_STYLES[style] || SUB_STYLES.tiktok;
  const vertical = outH > outW * 1.2;
  const base = vertical ? 13 : (outW === outH ? 14 : 15);
  const fontSize = Math.round(base * st.scale * (SIZE_MULT[size] || 1));
  const align = position === 'top' ? 8 : position === 'middle' ? 5 : 2;
  // En vertical, on remonte les sous-titres au-dessus de l'interface des applications (TikTok, Reels…)
  const marginV = position === 'middle' ? 0 : position === 'top' ? (vertical ? 45 : 18) : (vertical ? 70 : 20);
  const parts = [
    'FontName=Arial', `FontSize=${fontSize}`, `Bold=${st.bold}`, `PrimaryColour=${st.primary}`,
    `OutlineColour=${st.box || '&H00000000'}`, 'BackColour=&H80000000', `BorderStyle=${st.border}`,
    `Outline=${st.outline}`, `Shadow=${st.shadow}`, `Alignment=${align}`, `MarginV=${marginV}`, 'MarginL=18', 'MarginR=18',
  ];
  return parts.join(',');
}

// ── Construction du graphe de filtres ──
// Les expressions sont entre apostrophes : les virgules n'ont pas besoin d'être échappées.
function buildFilterGraph({ ratio, fit = 'crop', cropPos = 50, outW, outH, subFile, subStyleStr }) {
  const steps = [];
  const pos = Math.max(0, Math.min(100, +cropPos)) / 100;
  if (ratio === 'original') {
    steps.push(`[0:v:0]scale='trunc(iw/2)*2':'trunc(ih/2)*2',setsar=1[vb]`);
  } else {
    const W = outW, H = outH, A = (W / H).toFixed(6);
    if (fit === 'blur') {
      steps.push(
        `[0:v:0]split=2[a][b]`,
        `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=${Math.round(W / 12)}:${Math.round(H / 12)},boxblur=3:2,scale=${W}:${H},eq=brightness=-0.08[bg]`,
        `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vb]`
      );
    } else if (fit === 'pad') {
      steps.push(`[0:v:0]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vb]`);
    } else {
      steps.push(`[0:v:0]crop=w='min(iw,ih*${A})':h='min(ih,iw/${A})':x='(iw-out_w)*${pos}':y='(ih-out_h)/2',scale=${W}:${H}:flags=lanczos,setsar=1[vb]`);
    }
  }
  if (subFile) steps.push(`[vb]subtitles=${subFile}:force_style='${subStyleStr}'[v]`);
  else steps[steps.length - 1] = steps[steps.length - 1].replace(/\[vb\]$/, '[v]');
  return steps.join(';');
}

// ── Utilitaires ffmpeg ──
function ffmpegBin() { return P.ffmpeg(); }

function runCapture(bin, args, { timeout = 30000, cwd } = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    let child;
    try { child = spawn(bin, args, { windowsHide: true, cwd }); } catch (e) { return resolve({ code: -1, out, err: e.message }); }
    const t = setTimeout(() => U.killTree(child), timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: err + e.message }); });
    child.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

// Lance ffmpeg avec -progress pipe:1 ; onTime reçoit le temps de sortie (secondes)
function runFfmpeg(args, { cwd, onTime, ctl } = {}) {
  return new Promise((resolve, reject) => {
    let child, err = '', buf = '';
    try { child = spawn(ffmpegBin(), ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true, cwd }); }
    catch (e) { return reject(e); }
    if (ctl) ctl.child = child;
    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && onTime) onTime(+m[1] / 1e6);
      }
    });
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.on('error', e => reject(Object.assign(e, { stderr: err })));
    child.on('close', code => {
      if (ctl) ctl.child = null;
      if (ctl && ctl.cancelled) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      code === 0 ? resolve() : reject(Object.assign(new Error('ffmpeg code ' + code), { stderr: err }));
    });
  });
}

function friendlyFfmpegError(stderr, fallback) {
  const t = String(stderr || '');
  if (/No such filter: 'subtitles'|Filter not found.*subtitles|libass/i.test(t))
    return 'Ce ffmpeg ne gère pas l\'incrustation de sous-titres (libass absent). Utilisez un build « full » (gyan.dev) ou désactivez l\'incrustation.';
  if (/Invalid data found|moov atom not found/i.test(t)) return 'Fichier vidéo illisible ou corrompu.';
  if (/No space left/i.test(t)) return 'Disque plein.';
  if (/Permission denied/i.test(t)) return 'Accès refusé au dossier de sortie.';
  const line = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
  return line ? line.slice(0, 220) : (fallback || 'Erreur ffmpeg');
}

// ── Analyse du fichier ──
async function probe(file) {
  const out = { duration: 0, width: 0, height: 0, hasAudio: false };
  const fp = P.ffprobe();
  if (fp) {
    const r = await runCapture(fp, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 20000 });
    try {
      const j = JSON.parse(r.out);
      out.duration = parseFloat(j.format?.duration) || 0;
      const v = (j.streams || []).find(s => s.codec_type === 'video');
      if (v) { out.width = v.width; out.height = v.height; }
      out.hasAudio = (j.streams || []).some(s => s.codec_type === 'audio');
      if (out.duration) return out;
    } catch (_) {}
  }
  const r = await runCapture(ffmpegBin(), ['-hide_banner', '-i', file], { timeout: 20000 });
  const txt = r.err + r.out;
  const m = txt.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (m) out.duration = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  const v = txt.match(/Video:.*?[, ](\d{2,5})x(\d{2,5})/);
  if (v) { out.width = +v[1]; out.height = +v[2]; }
  out.hasAudio = /Audio:/.test(txt);
  return out;
}

// ── Détection des pauses (pour couper entre deux phrases) ──
async function detectSilences(file, duration, onProgress, ctl) {
  const silences = []; let cur = null;
  await new Promise((resolve) => {
    const child = spawn(ffmpegBin(), ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', file, '-vn', '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-'], { windowsHide: true });
    if (ctl) ctl.child = child;
    let buf = '';
    child.stdout.on('data', d => {
      buf += d.toString(); const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) { const m = l.match(/^out_time_(?:us|ms)=(\d+)/); if (m && duration && onProgress) onProgress(Math.min(1, +m[1] / 1e6 / duration)); }
    });
    child.stderr.on('data', d => {
      for (const l of d.toString().split(/\r?\n/)) {
        let m;
        if ((m = l.match(/silence_start:\s*(-?[\d.]+)/))) cur = { start: Math.max(0, parseFloat(m[1])) };
        else if ((m = l.match(/silence_end:\s*([\d.]+)/)) && cur) { cur.end = parseFloat(m[1]); silences.push(cur); cur = null; }
      }
    });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
  return silences;
}

// ── Sous-titres : fichiers voisins de la vidéo ──
function findSiblingSubs(videoPath) {
  try {
    const dir = path.dirname(videoPath), base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
    return fs.readdirSync(dir)
      .filter(f => /\.srt$/i.test(f) && f.toLowerCase().startsWith(base + '.') || f.toLowerCase() === base + '.srt')
      .map(f => ({ path: path.join(dir, f), name: f, lang: (f.slice(base.length).match(/^\.(.+)\.srt$/i) || [])[1] || '' }));
  } catch (_) { return []; }
}

// ── Génération automatique avec whisper.cpp (optionnel) ──
function whisperStatus() {
  return { bin: P.whisperBin(), models: P.whisperModels(), dirs: P.whisperDirs() };
}
async function generateSubs({ file, lang = 'auto', model }, onProgress, ctl) {
  const bin = P.whisperBin();
  if (!bin) throw new Error('Whisper n\'est pas installé (voir Paramètres › Sous-titres automatiques).');
  const models = P.whisperModels();
  const mdl = (model && fs.existsSync(model) ? model : (models.find(m => /base/.test(m.name)) || models[0] || {}).path);
  if (!mdl) throw new Error('Aucun modèle Whisper trouvé (fichier ggml-*.bin).');
  const tmp = U.makeTmpDir('ydrop_whisper');
  try {
    const wav = path.join(tmp, 'audio.wav');
    const info = await probe(file);
    onProgress && onProgress({ phase: 'audio', percent: 0 });
    await runFfmpeg(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], {
      ctl, onTime: t => info.duration && onProgress && onProgress({ phase: 'audio', percent: Math.round(Math.min(1, t / info.duration) * 100) }),
    });
    onProgress && onProgress({ phase: 'transcribe', percent: 0 });
    const outBase = path.join(tmp, 'out');
    const args = ['-m', mdl, '-f', wav, '-l', lang || 'auto', '-osrt', '-of', outBase, '-pp', '-t', String(Math.max(2, Math.min(8, os.cpus().length - 1)))];
    await new Promise((resolve, reject) => {
      let err = '';
      const child = spawn(bin, args, { windowsHide: true, cwd: path.dirname(bin) });
      if (ctl) ctl.child = child;
      const onData = d => {
        const s = d.toString(); err = (err + s).slice(-3000);
        const m = s.match(/progress\s*=\s*(\d+)%/g);
        if (m && onProgress) onProgress({ phase: 'transcribe', percent: parseInt(m[m.length - 1].match(/(\d+)%/)[1], 10) });
      };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', code => {
        if (ctl && ctl.cancelled) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        code === 0 ? resolve() : reject(new Error('Whisper a échoué : ' + (err.trim().split('\n').pop() || 'code ' + code)));
      });
    });
    const srtPath = outBase + '.srt';
    if (!fs.existsSync(srtPath)) throw new Error('Whisper n\'a produit aucun sous-titre.');
    const text = fs.readFileSync(srtPath, 'utf8');
    // Enregistré à côté de la vidéo : retrouvé automatiquement la prochaine fois
    let saved = '';
    try {
      const dir = path.dirname(file), base = path.basename(file, path.extname(file));
      saved = path.join(dir, `${base}.${lang === 'auto' ? 'auto' : lang}.srt`);
      fs.writeFileSync(saved, text, 'utf8');
    } catch (_) { saved = ''; }
    return { text, path: saved };
  } finally { U.cleanup(tmp); }
}

// ── Découpe ──
// opts : { inputPath, segments, formats:[ratio], outputDir, baseVideoName, quality, fit, cropPos,
//          subtitles: { srt (texte), style, size, position, maxWords, burn, exportSrt } | null }
async function cut(opts, onProgress, ctl) {
  const ff = ffmpegBin();
  if (!fs.existsSync(ff) && !P.findInPath('ffmpeg')) throw new Error('ffmpeg introuvable dans bin/ — la découpe nécessite ffmpeg en local.');
  if (!fs.existsSync(opts.inputPath)) throw new Error('Fichier vidéo source introuvable : ' + opts.inputPath);

  const info = await probe(opts.inputPath);
  const formats = (opts.formats && opts.formats.length ? opts.formats : ['original']).filter(f => RATIOS[f]);
  const segments = opts.segments.filter(s => s.end - s.start > 0.2);
  if (!segments.length) throw new Error('Aucun segment à exporter.');
  const q = QUALITY[opts.quality] || QUALITY.balanced;

  const srcBase = U.sanitizeName(path.basename(opts.inputPath, path.extname(opts.inputPath)), 'video');
  const namePrefix = opts.baseVideoName ? U.sanitizeName(opts.baseVideoName, 'segment') : null;
  const rootDir = path.join(opts.outputDir, srcBase);

  // Sous-titres : on parse une fois, puis on découpe par segment
  let cues = [];
  const sub = opts.subtitles;
  if (sub && sub.srt) cues = Srt.rechunk(Srt.parse(sub.srt), sub.maxWords || 0);
  const burn = !!(sub && cues.length && sub.burn !== false);
  const subTmp = (burn || (sub && sub.exportSrt)) ? U.makeTmpDir('ydrop_sub') : null;

  const total = segments.length * formats.length;
  const t0 = Date.now(); let doneCount = 0;
  const results = [];
  const emit = (frac, label) => {
    const overall = Math.min(1, (doneCount + frac) / total);
    const el = (Date.now() - t0) / 1000;
    const eta = overall > 0.02 ? Math.max(0, Math.round(el / overall - el)) : null;
    onProgress && onProgress({ done: doneCount, total, percent: Math.round(overall * 100), eta, label });
  };

  try {
    for (const sg of segments) {
      for (const fmt of formats) {
        if (ctl && ctl.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
        const R = RATIOS[fmt];
        const outW = R.w || (info.width - (info.width % 2)), outH = R.h || (info.height - (info.height % 2));
        const outDir = formats.length > 1 ? path.join(rootDir, R.folder) : rootDir;
        fs.mkdirSync(outDir, { recursive: true });
        const outName = (namePrefix ? `${namePrefix}_part${String(sg.index).padStart(2, '0')}` : `segment_${String(sg.index).padStart(2, '0')}`) + '.mp4';
        const outPath = path.join(outDir, outName);
        const dur = sg.end - sg.start;

        // Sous-titres du segment, recalés à 0
        let subFile = null, segCues = [];
        if (subTmp && cues.length) {
          segCues = Srt.slice(cues, sg.start, sg.end);
          if (burn && segCues.length) { fs.writeFileSync(path.join(subTmp, 'sub.srt'), Srt.stringify(segCues), 'utf8'); subFile = 'sub.srt'; }
        }
        const graph = buildFilterGraph({
          ratio: fmt, fit: opts.fit, cropPos: opts.cropPos, outW, outH, subFile,
          subStyleStr: subFile ? subtitleStyle(sub, outW, outH) : '',
        });
        const args = [
          '-y', '-ss', sg.start.toFixed(3), '-i', opts.inputPath, '-t', dur.toFixed(3),
          '-filter_complex', graph, '-map', '[v]', ...(info.hasAudio !== false ? ['-map', '0:a:0?'] : []),
          '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
          '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath,
        ];
        emit(0, `Segment ${sg.index}/${segments.length} · ${fmt === 'original' ? 'Original' : fmt}`);
        try {
          await runFfmpeg(args, { cwd: subFile ? subTmp : undefined, ctl, onTime: t => emit(Math.min(1, t / dur), `Segment ${sg.index}/${segments.length} · ${fmt === 'original' ? 'Original' : fmt}`) });
        } catch (e) {
          try { fs.unlinkSync(outPath); } catch (_) {}
          if (e.cancelled) throw e;
          throw new Error(`Segment ${sg.index} (${fmt}) : ` + friendlyFfmpegError(e.stderr, e.message));
        }
        if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new Error(`Segment ${sg.index} : fichier de sortie vide.`);
        let srtOut = '';
        if (sub && sub.exportSrt && segCues.length) {
          srtOut = outPath.replace(/\.mp4$/, '.srt');
          fs.writeFileSync(srtOut, Srt.stringify(segCues), 'utf8');
        }
        doneCount++;
        results.push({ name: outName, path: outPath, size: fs.statSync(outPath).size, format: fmt, index: sg.index, srt: srtOut, start: sg.start, end: sg.end });
        emit(0, '');
      }
    }
  } finally { if (subTmp) U.cleanup(subTmp); }
  return { results, folder: rootDir };
}

module.exports = { probe, detectSilences, findSiblingSubs, whisperStatus, generateSubs, cut, buildFilterGraph, subtitleStyle, RATIOS };
