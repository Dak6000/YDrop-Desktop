// ══════════════════════════════════════════════════════════════════════════════
//  DÉCOUPE : plage, formats multiples, segments, sous-titres, export
// ══════════════════════════════════════════════════════════════════════════════
let cFile = '', cDur = 0, cS = 0, cE = 0, segs = [], drag = null, dragged = false;
let namingMode = 'video';
const selRatios = new Set(['original']);
let fitMode = 'crop';
let silenceCache = { file: '', list: null };
let sub = { text: '', name: '', cues: [] };
let cutBusy = false;

const baseNameOf = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
const RATIO_LABEL = { original: 'Original', '9:16': '9:16 (TikTok/Reels/Shorts)', '4:5': '4:5 (Instagram)', '1:1': '1:1 (Carré)', '16:9': '16:9 (Paysage)' };

// ── Import ──
async function openVideoFile() { const p = await window.ydrop.openVideo(); if (p) loadVideoFile(p); }
window.openInCutter = (p) => loadVideoFile(p);

async function loadVideoFile(p) {
  cFile = p; segs = []; silenceCache = { file: '', list: null };
  const vid = $('cvid');
  $('vid-warn').style.display = 'none';
  vid.src = window.ydrop.fileUrl(p);
  let info = { duration: 0 };
  try { info = await window.ydrop.probe(p); } catch (_) {}
  cDur = info.duration;
  if (!cDur) await new Promise((res) => { vid.onloadedmetadata = () => { cDur = vid.duration || 60; res(); }; setTimeout(res, 4000); });
  cS = 0; cE = cDur;
  $('cut-editor').style.display = ''; $('cut-res').style.display = 'none';
  $('slist').innerHTML = ''; $('smart-status').textContent = '';
  $('cut-fname').textContent = '— ' + p.split(/[\\/]/).pop() + (info.width ? ` · ${info.width}×${info.height}` : '');
  updTL(); updTI(); buildTicks();
  $('name-custom').value = baseNameOf(p); updNamePreview();
  clearSubs(true); await detectSiblingSubs();
  toast('ok', '✓ Vidéo chargée (' + ft(cDur) + ')');
  $('cut-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Timeline ──
function updTL() {
  if (!cDur) return;
  const pS = (cS / cDur) * 100, pE = (cE / cDur) * 100;
  $('tlsel').style.left = pS + '%'; $('tlsel').style.width = pE - pS + '%';
  $('tlhs').style.left = pS + '%'; $('tlhe').style.left = pE + '%';
}
function buildTicks() { let h = ''; for (let i = 0; i <= 6; i++) h += `<span>${ft((cDur * i) / 6)}</span>`; $('tlticks').innerHTML = h; }
function updTI() { $('ts').value = ft(cS); $('te').value = ft(cE); }
function onTI(w) {
  const v = parseFT($(w === 's' ? 'ts' : 'te').value); if (isNaN(v)) return;
  if (w === 's') cS = Math.max(0, Math.min(v, cE - 0.5)); else cE = Math.min(cDur, Math.max(v, cS + 0.5));
  updTL(); segs = []; $('slist').innerHTML = '';
}
function prevRange(a, b) {
  const v = $('cvid'); v.currentTime = a; v.play().catch(() => {});
  const stop = () => { if (v.currentTime >= b) { v.pause(); v.removeEventListener('timeupdate', stop); } };
  v.addEventListener('timeupdate', stop);
}

// ── Formats ──
function refreshFormatUI() {
  const nonOrig = [...selRatios].some((r) => r !== 'original');
  $('fit-wrap').style.display = nonOrig ? '' : 'none';
  $('crop-pos-wrap').style.display = fitMode === 'crop' ? '' : 'none';
  $('fit-hint').textContent = fitMode === 'crop' ? 'Recadrer garde une partie de l\'image. Déplacez le curseur pour suivre la personne qui parle.'
    : fitMode === 'blur' ? 'La vidéo reste entière, le fond est une version floutée de la même image (très utilisé sur TikTok/Reels).'
    : 'La vidéo reste entière avec des bandes noires autour.';
  document.querySelectorAll('#ratio-grid .ratio-card').forEach((c) => c.classList.toggle('on', selRatios.has(c.dataset.ratio)));
  document.querySelectorAll('#fit-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.fit === fitMode));
}

// ── Segments ──
function getSD() { const v = $('sdur').value; return v === '0' ? parseFloat($('csec').value) || 60 : parseFloat(v); }
function setDuration(sec) {
  const sel = $('sdur');
  if ([...sel.options].some((o) => o.value === String(sec))) { sel.value = String(sec); $('cdur-wrap').style.display = 'none'; }
  else { sel.value = '0'; $('cdur-wrap').style.display = ''; $('csec').value = sec; }
  document.querySelectorAll('#plat-chips .chip').forEach((c) => c.classList.toggle('on', +c.dataset.sec === sec));
  if (segs.length) calcSegs();
}
async function calcSegs() {
  if (!cFile) return;
  const smart = $('smart-cut').checked;
  let sil = null;
  if (smart) {
    if (silenceCache.file !== cFile) {
      $('smart-status').textContent = 'Analyse des pauses… 0 %';
      const off = window.ydrop.onSilenceProgress((p) => { $('smart-status').textContent = `Analyse des pauses… ${Math.round(p * 100)} %`; });
      try { silenceCache = { file: cFile, list: await window.ydrop.silences(cFile, cDur) }; } finally { off(); }
    }
    sil = silenceCache.list;
    $('smart-status').textContent = sil.length ? `✓ ${sil.length} pauses détectées — les coupes tombent entre deux phrases.` : 'Aucune pause nette détectée : découpe à durée fixe.';
  } else $('smart-status').textContent = '';
  segs = YPlan.plan({ start: cS, end: cE, target: getSD(), smartCut: smart, silences: sil }).map((s) => ({ ...s, on: true }));
  renderSegs();
}
function renderSegs() {
  const list = $('slist');
  const n = segs.filter((s) => s.on).length;
  list.innerHTML = `<div class="hint-line" style="margin:6px 0">${segs.length} segment${segs.length > 1 ? 's' : ''} · ${n} sélectionné${n > 1 ? 's' : ''}</div>`;
  segs.forEach((sg, i) => {
    const d = document.createElement('div'); d.className = 'si sel';
    d.innerHTML = `<input type="checkbox" data-i="${i}" ${sg.on ? 'checked' : ''}/><div class="sn">#${sg.index}</div><div class="st">${ft(sg.start)} → ${ft(sg.end)}</div><div class="sd">${ft(sg.end - sg.start)}</div><button class="ib" data-prev="${i}" title="Aperçu">▶</button>`;
    list.appendChild(d);
  });
}

// ── Nommage ──
function setNamingMode(m) {
  namingMode = m;
  $('ntog-video').classList.toggle('on', m === 'video'); $('ntog-seg').classList.toggle('on', m === 'segment');
  $('name-custom-wrap').style.display = m === 'video' ? '' : 'none'; updNamePreview();
}
function getBaseVideoName() { return namingMode === 'segment' ? null : ($('name-custom').value.trim() || (cFile ? baseNameOf(cFile) : null)); }
function updNamePreview() {
  const el = $('name-preview');
  if (namingMode === 'segment') { el.innerHTML = '<b>segment_01.mp4</b>, segment_02.mp4, …'; return; }
  const b = esc($('name-custom').value.trim() || (cFile ? baseNameOf(cFile) : 'ma_video'));
  el.innerHTML = `<b>${b}_part01.mp4</b>, ${b}_part02.mp4, …`;
}

// ── Sous-titres ──
function previewCues() { return YSrt.rechunk(sub.cues, +$('sub-words').value || 0); }
function setSubs(text, name) {
  const cues = YSrt.parse(text);
  if (!cues.length) return toast('err', '✗ Fichier de sous-titres vide ou illisible');
  sub = { text, name, cues };
  $('sub-status').innerHTML = `💬 <b>${esc(name)}</b> — ${cues.length} sous-titres`;
  $('sub-opts').style.display = ''; updateSubOverlay();
  toast('ok', '✓ Sous-titres chargés');
}
function clearSubs(silent) {
  sub = { text: '', name: '', cues: [] };
  $('sub-status').textContent = 'Aucun sous-titre sélectionné.';
  $('sub-opts').style.display = 'none'; $('sub-overlay').style.display = 'none';
  if (!silent) toast('info', 'Sous-titres retirés');
}
async function detectSiblingSubs() {
  const box = $('sub-detected'); box.innerHTML = '';
  let found = [];
  try { found = await window.ydrop.siblingSubs(cFile); } catch (_) {}
  if (!found.length) return;
  found.forEach((f) => {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.path = f.path;
    b.textContent = '📄 ' + f.name; box.appendChild(b);
  });
  const pref = found.find((f) => settings.subLang && f.lang.startsWith(settings.subLang)) || found[0];
  try { setSubs(await window.ydrop.readSubs(pref.path), pref.name); } catch (_) {}
}
async function generateSubtitles() {
  if (!cFile) return;
  if (!toolsStatus || !toolsStatus.whisper.installed) {
    return showNotice({
      key: 'whisper', type: 'warn',
      text: '🤖 La génération automatique utilise <b>Whisper</b> (whisper.cpp), à installer une fois : placez <code>whisper-cli</code> et un modèle <code>ggml-base.bin</code> dans le dossier Whisper de YDrop. Détails dans le README.',
      actions: [{ label: '📂 Ouvrir le dossier Whisper', primary: true, onClick: () => window.ydrop.openWhisperFolder() }],
    });
  }
  const box = $('sub-gen-prog'); box.style.display = '';
  const off = window.ydrop.onSubsProgress((p) => {
    $('sub-gen-lbl').textContent = p.phase === 'audio' ? 'Extraction de l\'audio…' : 'Transcription (peut prendre quelques minutes)…';
    $('sub-gen-pct').textContent = p.percent + ' %'; $('sub-gen-bar').style.width = p.percent + '%';
  });
  $('btn-sub-gen').disabled = true;
  try {
    const r = await window.ydrop.generateSubs({ file: cFile, lang: settings.whisperLang || 'auto', model: settings.whisperModel || '' });
    if (r) { setSubs(r.text, r.path ? r.path.split(/[\\/]/).pop() : 'Sous-titres générés'); if (r.path) detectSiblingSubs(); }
  } catch (e) { toast('err', '✗ ' + e.message); }
  finally { off(); box.style.display = 'none'; $('btn-sub-gen').disabled = false; }
}
function updateSubOverlay() {
  const ov = $('sub-overlay'), v = $('cvid');
  if (!sub.cues.length || !v.clientHeight) { ov.style.display = 'none'; return; }
  const cue = YSrt.activeAt(previewCues(), v.currentTime);
  if (!cue) { ov.style.display = 'none'; return; }
  const style = $('sub-style').value, size = { s: 0.8, m: 1, l: 1.3 }[$('sub-size').value], pos = $('sub-pos').value;
  const k = { tiktok: 1.25, yellow: 1.25, box: 1.05, classic: 1 }[style] || 1;
  ov.style.display = ''; ov.textContent = cue.text;
  ov.className = 'sub-overlay st-' + style + ' pos-' + pos;
  ov.style.fontSize = (v.clientHeight * 0.05 * k * size) + 'px';
}

// ── Export ──
function setCP(v, l, eta) {
  $('cut-pbar').style.width = v + '%'; $('cut-pct').textContent = v + ' %'; $('cut-lbl').textContent = l;
  $('cut-eta').textContent = eta != null ? 'Temps restant ≈ ' + ft(eta) : '';
}
function cutOutputDir() {
  if (settings.cutDir) return settings.cutDir;
  const i = Math.max(cFile.lastIndexOf('\\'), cFile.lastIndexOf('/'));
  return cFile.slice(0, i) + cFile.slice(i, i + 1) + 'YDrop-decoupes';
}
async function startCut() {
  if (!cFile) return toast('err', '✗ Importez une vidéo d\'abord');
  if (cutBusy) return;
  if (!segs.length) await calcSegs();
  const chosen = segs.filter((s) => s.on);
  if (!chosen.length) return toast('err', '✗ Aucun segment sélectionné');
  cutBusy = true; $('btn-cut').disabled = true;
  $('cut-prog').style.display = ''; $('cut-res').style.display = 'none';
  setCP(0, 'Préparation…');
  const off = window.ydrop.onCutProgress((p) => setCP(p.percent, p.label || 'Découpage…', p.eta));
  const outDir = cutOutputDir();
  const opts = {
    inputPath: cFile, segments: chosen.map(({ index, start, end }) => ({ index, start, end })),
    formats: [...selRatios], fit: fitMode, cropPos: +$('crop-pos').value, quality: $('cut-quality').value,
    outputDir: outDir, baseVideoName: getBaseVideoName(),
    subtitles: sub.text ? { srt: sub.text, style: $('sub-style').value, size: $('sub-size').value, position: $('sub-pos').value, maxWords: +$('sub-words').value || 0, burn: $('sub-burn').checked, exportSrt: $('sub-export').checked } : null,
  };
  try {
    const r = await window.ydrop.cut(opts);
    if (r.cancelled) { toast('info', 'Découpe annulée'); }
    else {
      setCP(100, `Terminé — ${r.results.length} fichier${r.results.length > 1 ? 's' : ''}`);
      showCutResults(r);
      toast('ok', `✓ ${r.results.length} fichier${r.results.length > 1 ? 's' : ''} exporté${r.results.length > 1 ? 's' : ''} !`);
    }
  } catch (e) { toast('err', '✗ ' + e.message); }
  finally { off(); cutBusy = false; $('btn-cut').disabled = false; setTimeout(() => { $('cut-prog').style.display = 'none'; }, 1200); }
}
let lastCutFolder = '';
function showCutResults(r) {
  lastCutFolder = r.folder;
  const list = $('cut-rlist'); list.innerHTML = '';
  r.results.forEach((x, i) => {
    const d = document.createElement('div'); d.className = 'ri';
    d.innerHTML = `<div class="rico">🎞️</div><div class="rinfo"><div class="rname">${esc(x.name)}</div><div class="rmeta">${fmtSize(x.size)} · ${esc(RATIO_LABEL[x.format] || x.format)}${x.srt ? ' · + .srt' : ''}</div></div>
      <div class="ract"><button class="btn bg" data-open="${i}">▶</button><button class="btn bg" data-folder="${i}">📂</button></div>`;
    list.appendChild(d);
  });
  list._results = r.results;
  $('cut-res').style.display = '';
  $('cut-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Init ──
function initCut() {
  const vid = $('cvid'), dz = $('dz');
  dz.onclick = openVideoFile;
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('ov'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('ov'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('ov');
    const f = e.dataTransfer.files[0]; if (!f) return;
    const p = window.ydrop.pathForFile(f);
    if (p && /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(p)) loadVideoFile(p); else toast('err', '✗ Format vidéo non pris en charge');
  });

  vid.addEventListener('timeupdate', () => { if (cDur) $('tlprog').style.width = (vid.currentTime / cDur) * 100 + '%'; updateSubOverlay(); });
  vid.addEventListener('error', () => { $('vid-warn').style.display = ''; });
  window.addEventListener('resize', updateSubOverlay);

  $('tl').addEventListener('click', (e) => {
    if (!cDur || dragged) { dragged = false; return; }
    const r = $('tl').getBoundingClientRect();
    vid.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cDur;
  });
  ['tlhs', 'tlhe'].forEach((id) => $(id).addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); drag = id; dragged = false; }));
  document.addEventListener('mousemove', (e) => {
    if (!drag || !cDur) return; dragged = true;
    const r = $('tl').getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cDur;
    if (drag === 'tlhs') cS = Math.max(0, Math.min(t, cE - 0.5)); else cE = Math.min(cDur, Math.max(t, cS + 0.5));
    updTL(); updTI();
  });
  document.addEventListener('mouseup', () => { if (drag) { drag = null; segs = []; $('slist').innerHTML = ''; setTimeout(() => { dragged = false; }, 0); } });
  $('ts').addEventListener('input', () => onTI('s')); $('te').addEventListener('input', () => onTI('e'));
  $('btn-prevsel').onclick = () => prevRange(cS, cE);
  $('btn-rstsel').onclick = () => { cS = 0; cE = cDur; updTL(); updTI(); segs = []; $('slist').innerHTML = ''; };

  $('ratio-grid').addEventListener('click', (e) => {
    const c = e.target.closest('[data-ratio]'); if (!c) return;
    const r = c.dataset.ratio;
    if (selRatios.has(r)) { if (selRatios.size > 1) selRatios.delete(r); } else selRatios.add(r);
    refreshFormatUI();
  });
  $('fit-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-fit]'); if (c) { fitMode = c.dataset.fit; refreshFormatUI(); } });

  $('plat-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-sec]'); if (c) setDuration(+c.dataset.sec); });
  $('sdur').addEventListener('change', () => {
    $('cdur-wrap').style.display = $('sdur').value === '0' ? '' : 'none';
    document.querySelectorAll('#plat-chips .chip').forEach((c) => c.classList.toggle('on', +c.dataset.sec === getSD()));
    if (segs.length) calcSegs();
  });
  $('csec').addEventListener('change', () => { if (segs.length) calcSegs(); });
  $('smart-cut').addEventListener('change', () => { if (segs.length) calcSegs(); else if (!$('smart-cut').checked) $('smart-status').textContent = ''; });
  $('btn-calc').onclick = calcSegs;
  $('slist').addEventListener('change', (e) => { const c = e.target.closest('input[data-i]'); if (c) { segs[+c.dataset.i].on = c.checked; renderSegs(); } });
  $('slist').addEventListener('click', (e) => { const b = e.target.closest('[data-prev]'); if (b) { const s = segs[+b.dataset.prev]; prevRange(s.start, s.end); } });

  $('ntog-video').onclick = () => setNamingMode('video'); $('ntog-seg').onclick = () => setNamingMode('segment');
  $('name-custom').addEventListener('input', updNamePreview);
  $('btn-folder-cut').onclick = () => pickFolder('cutDir');
  $('cut-quality').value = settings.cutQuality || 'balanced';
  $('cut-quality').onchange = () => saveSettings({ cutQuality: $('cut-quality').value });

  $('sub-style').value = settings.subStyle || 'tiktok';
  $('sub-style').addEventListener('change', () => { saveSettings({ subStyle: $('sub-style').value }); updateSubOverlay(); });
  ['sub-size', 'sub-pos', 'sub-words'].forEach((id) => $(id).addEventListener('change', updateSubOverlay));
  $('btn-sub-none').onclick = () => clearSubs();
  $('btn-sub-import').onclick = async () => { const r = await window.ydrop.pickSubs(); if (r) setSubs(r.text, r.name); };
  $('btn-sub-gen').onclick = generateSubtitles;
  $('btn-sub-cancel').onclick = () => window.ydrop.cancelTask();
  $('sub-detected').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-path]'); if (!b) return;
    try { setSubs(await window.ydrop.readSubs(b.dataset.path), b.textContent.replace('📄 ', '')); } catch (_) { toast('err', '✗ Lecture impossible'); }
  });

  $('btn-cut').onclick = startCut;
  $('btn-cut-cancel').onclick = () => window.ydrop.cancelTask();
  $('btn-open-cut').onclick = () => lastCutFolder && window.ydrop.openFolder(lastCutFolder);
  $('cut-rlist').addEventListener('click', (e) => {
    const l = $('cut-rlist')._results || [];
    const o = e.target.closest('[data-open]'), f = e.target.closest('[data-folder]');
    if (o) window.ydrop.openFile(l[+o.dataset.open].path); if (f) window.ydrop.openFolder(l[+f.dataset.folder].path);
  });
  refreshFormatUI(); updNamePreview();
}
