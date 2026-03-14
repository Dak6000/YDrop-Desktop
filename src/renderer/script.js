// ══════════════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════════════
let curUrl = '',
  outDir = '',
  cutDir = '';
let cFile = '',
  cDur = 0,
  cS = 0,
  cE = 0,
  segs = [],
  drag = null;
let namingMode = 'video';
let settings = { dlDir: '', cutDir: '' };
let tTmr = null;

// ══════════════════════════════════════════════════════════════════════════════
//  UTILS (déclarées en premier pour être disponibles partout)
// ══════════════════════════════════════════════════════════════════════════════
function ft(s) {
  if (isNaN(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sc = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`
    : `${m}:${String(sc).padStart(2, '0')}`;
}

function parseFT(str) {
  const p = str
    .trim()
    .split(':')
    .map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || NaN;
}

function toast(type, msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  document.getElementById('ti').textContent =
    type === 'ok' ? '✓' : type === 'info' ? '✂' : '⚠';
  document.getElementById('tmsg').textContent = msg;
  el.className = 'toast ' + type + ' on';
  clearTimeout(tTmr);
  tTmr = setTimeout(() => el.classList.remove('on'), 4000);
}

function setDot(id, ok) {
  const d = document.getElementById(id);
  if (!d) return;
  d.classList.toggle('ok', !!ok);
  d.classList.toggle('err', !ok);
}

function updateDlBtn() {
  const btn = document.getElementById('btn-dl');
  if (btn) btn.disabled = !(curUrl && outDir);
}

// ══════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function switchSec(btn) {
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const id = btn.dataset.sec;
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('on'));
  const target = document.getElementById('sec-' + id);
  if (target) target.classList.add('on');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PARAMÈTRES
// ══════════════════════════════════════════════════════════════════════════════
async function persistSettings() {
  try {
    await window.ydrop.saveSettings(settings);
    const badge = document.getElementById('save-badge');
    if (badge) {
      badge.classList.add('show');
      setTimeout(() => badge.classList.remove('show'), 2000);
    }
  } catch (e) {
    console.warn('persistSettings:', e);
  }
}

async function paramChooseFolder(type) {
  const dir = await window.ydrop.chooseFolder();
  if (!dir) return;
  applyFolder(type, dir);
  await persistSettings();
}

function paramClearFolder(type) {
  applyFolder(type, '');
  persistSettings();
}

async function chooseFolder(type) {
  const dir = await window.ydrop.chooseFolder();
  if (!dir) return;
  applyFolder(type, dir);
  await persistSettings();
}

function applyFolder(type, dir) {
  const label = dir || (type === 'dl' ? '— Choisir un dossier —' : '— Choisir un dossier —');
  const paramLabel = dir || '— Non défini —';
  if (type === 'dl') {
    outDir = dir;
    settings.dlDir = dir;
    const el1 = document.getElementById('out-path');
    if (el1) el1.textContent = label;
    const el2 = document.getElementById('param-dl-path');
    if (el2) el2.textContent = paramLabel;
    updateDlBtn();
  } else {
    cutDir = dir;
    settings.cutDir = dir;
    const el1 = document.getElementById('cut-out-path');
    if (el1) el1.textContent = label;
    const el2 = document.getElementById('param-cut-path');
    if (el2) el2.textContent = paramLabel;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOWNLOAD
// ══════════════════════════════════════════════════════════════════════════════
async function fetchInfo() {
  const url = document.getElementById('url-inp').value.trim();
  if (!url) {
    toast('err', '✗ Collez un lien YouTube');
    return;
  }
  const btn = document.getElementById('btn-info');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Analyse…';
  document.getElementById('vcard').style.display = 'none';
  document.getElementById('fmt-card').style.display = 'none';
  document.getElementById('dl-res').style.display = 'none';
  try {
    const info = await window.ydrop.getInfo(url);
    curUrl = url;
    document.getElementById('vthumb').src = info.thumbnail;
    document.getElementById('vtitle').textContent = info.title;
    document.getElementById('vauthor').textContent = info.author;
    document.getElementById('vdur').textContent = info.duration;
    document.getElementById('vviews').textContent = info.views;
    document.getElementById('vcard').style.display = '';
    document.getElementById('fmt-card').style.display = '';
    updateDlBtn();
    toast('ok', '✓ ' + info.title.slice(0, 50));
  } catch (e) {
    toast('err', '✗ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> Analyser';
  }
}

function switchFTab(btn, type) {
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('fgrid-v').style.display = type === 'v' ? '' : 'none';
  document.getElementById('fgrid-a').style.display = type === 'a' ? '' : 'none';
  const first = document.querySelector('#fgrid-' + type + ' input');
  if (first) {
    first.checked = true;
    first.closest('.fmt').classList.add('on');
  }
}

document.querySelectorAll('.fmt').forEach(el =>
  el.addEventListener('click', () => {
    el.closest('.fgrid').querySelectorAll('.fmt').forEach(f => f.classList.remove('on'));
    el.classList.add('on');
  })
);

async function startDownload() {
  const fmt = document.querySelector('input[name="fmt"]:checked')?.value;
  if (!fmt || !curUrl || !outDir) {
    toast('err', '✗ Paramètres incomplets');
    return;
  }
  const btn = document.getElementById('btn-dl');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Téléchargement…';
  document.getElementById('dl-prog').style.display = '';
  document.getElementById('dl-res').style.display = 'none';
  setDP(0, 'Connexion…');
  window.ydrop.removeProgress();
  window.ydrop.onProgress(v => setDP(v, `Téléchargement… ${v.toFixed(0)} %`));
  try {
    const r = await window.ydrop.download({ url: curUrl, format: fmt, outputDir: outDir });
    setDP(100, 'Terminé !');
    setTimeout(() => {
      document.getElementById('dl-prog').style.display = 'none';
    }, 1500);
    const sp = r.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    document.getElementById('dl-rlist').innerHTML = `<div class="ri"><div class="rico">📦</div><div class="rinfo"><div class="rname">${
      r.filename
    }</div><div class="rmeta">${(r.size / 1048576).toFixed(1)} Mo · ${
      r.path
    }</div></div><div class="ract"><button class="btn bg" onclick="window.ydrop.openFile('${sp}')">▶ Ouvrir</button><button class="btn bg" onclick="window.ydrop.openFolder('${sp}')">📂</button></div></div>`;
    document.getElementById('dl-res').style.display = '';
    toast('ok', '✓ Téléchargé : ' + r.filename);
  } catch (e) {
    toast('err', '✗ ' + e.message);
    document.getElementById('dl-prog').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇ Télécharger';
  }
}

function setDP(v, l) {
  document.getElementById('dl-pbar').style.width = v + '%';
  document.getElementById('dl-pct').textContent = v.toFixed(0) + ' %';
  document.getElementById('dl-lbl').textContent = l;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CUT
// ══════════════════════════════════════════════════════════════════════════════
async function openVideoFile() {
  const p = await window.ydrop.openVideo();
  if (p) loadVideoFile(p);
}

async function loadVideoFile(p) {
  cFile = p;
  const vid = document.getElementById('cvid');
  vid.src = 'file://' + p;
  cDur = await window.ydrop.probe(p);
  if (!cDur)
    await new Promise(res => {
      vid.onloadedmetadata = () => {
        cDur = vid.duration || 60;
        res();
      };
    });
  cS = 0;
  cE = cDur;
  segs = [];
  document.getElementById('cut-editor').style.display = '';
  document.getElementById('cut-res').style.display = 'none';
  document.getElementById('slist').innerHTML = '';
  updTL();
  updTI();
  buildTicks();
  const baseName = p
    .split(/[\\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '');
  document.getElementById('name-custom').value = baseName;
  updNamePreview();
  vid.addEventListener('timeupdate', () => {
    if (cDur) document.getElementById('tlprog').style.width = (vid.currentTime / cDur) * 100 + '%';
  });
  toast('ok', '✓ Vidéo chargée (' + ft(cDur) + ')');
}

const dz = document.getElementById('dz');
dz.addEventListener('dragover', e => {
  e.preventDefault();
  dz.classList.add('ov');
});
dz.addEventListener('dragleave', () => dz.classList.remove('ov'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('ov');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadVideoFile(f.path);
});

function updTL() {
  if (!cDur) return;
  const pS = (cS / cDur) * 100,
    pE = (cE / cDur) * 100;
  document.getElementById('tlsel').style.left = pS + '%';
  document.getElementById('tlsel').style.width = pE - pS + '%';
  document.getElementById('tlhs').style.left = pS + '%';
  document.getElementById('tlhe').style.left = pE + '%';
}

function buildTicks() {
  let h = '';
  for (let i = 0; i <= 6; i++) h += `<span>${ft((cDur * i) / 6)}</span>`;
  document.getElementById('tlticks').innerHTML = h;
}

function tlClick(e) {
  if (!cDur) return;
  const r = e.currentTarget.getBoundingClientRect();
  document.getElementById('cvid').currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cDur;
}

['tlhs', 'tlhe'].forEach(id => {
  document.getElementById(id).addEventListener('mousedown', e => {
    e.preventDefault();
    drag = id;
  });
});
document.addEventListener('mousemove', e => {
  if (!drag || !cDur) return;
  const r = document.getElementById('tl').getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cDur;
  if (drag === 'tlhs') cS = Math.max(0, Math.min(t, cE - 0.5));
  else cE = Math.min(cDur, Math.max(t, cS + 0.5));
  updTL();
  updTI();
});
document.addEventListener('mouseup', () => {
  drag = null;
});

function updTI() {
  document.getElementById('ts').value = ft(cS);
  document.getElementById('te').value = ft(cE);
}

function onTI(w) {
  const v = parseFT(document.getElementById(w === 's' ? 'ts' : 'te').value);
  if (isNaN(v)) return;
  if (w === 's') cS = Math.max(0, Math.min(v, cE - 0.5));
  else cE = Math.min(cDur, Math.max(v, cS + 0.5));
  updTL();
}

function prevSel() {
  const v = document.getElementById('cvid');
  v.currentTime = cS;
  v.play();
  const stop = () => {
    if (v.currentTime >= cE) {
      v.pause();
      v.removeEventListener('timeupdate', stop);
    }
  };
  v.addEventListener('timeupdate', stop);
}

function rstSel() {
  cS = 0;
  cE = cDur;
  updTL();
  updTI();
}

document.querySelectorAll('.ratio-card').forEach(el =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.ratio-card').forEach(r => r.classList.remove('on'));
    el.classList.add('on');
  })
);

function onDC() {
  const isCustom = document.getElementById('sdur').value === '0';
  document.getElementById('cdur-wrap').style.display = isCustom ? '' : 'none';
  if (segs.length > 0) calcSegs();
}

function getSD() {
  const v = document.getElementById('sdur').value;
  return v === '0' ? parseFloat(document.getElementById('csec').value) || 60 : parseFloat(v);
}

function getSelectedRatio() {
  return document.querySelector('input[name="ratio"]:checked')?.value || 'original';
}

function setNamingMode(m) {
  namingMode = m;
  document.getElementById('ntog-video').classList.toggle('on', m === 'video');
  document.getElementById('ntog-seg').classList.toggle('on', m === 'segment');
  document.getElementById('name-custom-wrap').style.display = m === 'video' ? '' : 'none';
  updNamePreview();
}

function getBaseVideoName() {
  if (namingMode === 'segment') return null;
  const c = document.getElementById('name-custom').value.trim();
  if (c) return c;
  return cFile
    ? cFile
        .split(/[\\\/]/)
        .pop()
        .replace(/\.[^.]+$/, '')
    : null;
}

function updNamePreview() {
  const el = document.getElementById('name-preview');
  if (!el) return;
  if (namingMode === 'segment') {
    el.innerHTML = '<b>segment_01.mp4</b>, segment_02.mp4, …';
    return;
  }
  const base =
    document.getElementById('name-custom').value.trim() ||
    (cFile
      ? cFile
          .split(/[\\\/]/)
          .pop()
          .replace(/\.[^.]+$/, '')
      : 'ma_video');
  el.innerHTML = `<b>${base}_part01.mp4</b>, ${base}_part02.mp4, …`;
}

function calcSegs() {
  if (!cFile) return;
  const dur = getSD(),
    sel = cE - cS,
    cnt = Math.ceil(sel / dur);
  segs = [];
  for (let i = 0; i < cnt; i++) {
    const s = cS + i * dur,
      e = Math.min(s + dur, cE);
    segs.push({ index: i + 1, start: s, end: e });
  }
  const list = document.getElementById('slist');
  list.innerHTML = '';
  segs.forEach(sg => {
    const d = document.createElement('div');
    d.className = 'si';
    d.innerHTML = `<div class="sn">#${sg.index}</div><div class="st">${ft(sg.start)} → ${ft(
      sg.end
    )}</div><div class="sd">${ft(sg.end - sg.start)}</div>`;
    list.appendChild(d);
  });
  toast('info', `✂ ${cnt} segment${cnt > 1 ? 's' : ''} · ~${ft(dur)}`);
}

async function startCut() {
  if (!cFile) {
    toast('err', '✗ Importe une vidéo d\'abord');
    return;
  }
  if (!cutDir) {
    toast('err', '✗ Choisissez un dossier de sortie');
    return;
  }
  if (segs.length === 0) calcSegs();
  if (segs.length === 0) return;
  const btn = document.getElementById('btn-cut');
  btn.disabled = true;
  document.getElementById('cut-prog').style.display = '';
  document.getElementById('cut-res').style.display = 'none';
  setCP(0, 'Préparation…');
  const ratio = getSelectedRatio(),
    baseVideoName = getBaseVideoName();
  window.ydrop.removeCutProgress();
  window.ydrop.onCutProgress(({ done, total }) =>
    setCP(Math.round((done / total) * 100), `Segment ${done} / ${total}…`)
  );
  try {
    const results = await window.ydrop.cut({
      inputPath: cFile,
      segments: segs,
      ratio,
      outputDir: cutDir,
      baseVideoName
    });
    setCP(100, `Terminé — ${results.length} segment${results.length > 1 ? 's' : ''}`);
    setTimeout(() => {
      document.getElementById('cut-prog').style.display = 'none';
    }, 1500);
    showCutResults(results, ratio);
    toast('ok', `✓ ${results.length} segment${results.length > 1 ? 's' : ''} exporté${results.length > 1 ? 's' : ''}!`);
  } catch (e) {
    toast('err', '✗ ' + e.message);
    document.getElementById('cut-prog').style.display = 'none';
  } finally {
    btn.disabled = false;
  }
}

function setCP(v, l) {
  document.getElementById('cut-pbar').style.width = v + '%';
  document.getElementById('cut-pct').textContent = v + ' %';
  document.getElementById('cut-lbl').textContent = l;
}

function showCutResults(results, ratio) {
  const rL = {
    original: 'Original',
    '9:16': 'TikTok 9:16',
    '1:1': 'Carré 1:1',
    '4:5': 'Portrait 4:5',
    '16:9': 'Paysage 16:9'
  };
  const list = document.getElementById('cut-rlist');
  list.innerHTML = '';
  results.forEach(r => {
    const sp = r.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    list.innerHTML += `<div class="ri"><div class="rico">🎞️</div><div class="rinfo"><div class="rname">${
      r.name
    }</div><div class="rmeta">${(r.size / 1048576).toFixed(1)} Mo · ${rL[ratio] || ratio}</div></div><div class="ract"><button class="btn bg" onclick="window.ydrop.openFile('${sp}')">▶</button><button class="btn bg" onclick="window.ydrop.openFolder('${sp}')">📂</button></div></div>`;
  });
  document.getElementById('cut-res').style.display = '';
  document.getElementById('cut-res').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openCutFolder() {
  if (cutDir) window.ydrop.openFile(cutDir);
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT — en dernier, après toutes les déclarations
// ══════════════════════════════════════════════════════════════════════════════
async function init() {
  try {
    settings = await window.ydrop.loadSettings();
    if (settings.dlDir) applyFolder('dl', settings.dlDir);
    if (settings.cutDir) applyFolder('cut', settings.cutDir);
  } catch (e) {
    console.warn('loadSettings failed:', e);
  }

  try {
    const bins = await window.ydrop.checkBins();
    setDot('dot-ytdlp', bins.ytdlp);
    setDot('dot-ffmpeg', bins.ffmpeg);
    setDot('param-dot-ytdlp', bins.ytdlp);
    setDot('param-dot-ffmpeg', bins.ffmpeg);
    const el1 = document.getElementById('param-ytdlp-path');
    if (el1) el1.textContent = bins.ytdlpPath;
    const el2 = document.getElementById('param-ffmpeg-path');
    if (el2) el2.textContent = bins.ffmpegPath;
    const pLabels = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    const el3 = document.getElementById('bin-platform');
    if (el3) el3.textContent = pLabels[bins.platform] || bins.platform;
    if (!bins.ffmpeg) toast('err', '⚠ ffmpeg manquant — voir le Guide');
  } catch (e) {
    console.warn('checkBins failed:', e);
  }
}

// Listeners URL input
document.getElementById('url-inp').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchInfo();
});
document.getElementById('url-inp').addEventListener('paste', () => {
  setTimeout(() => {
    const v = document.getElementById('url-inp').value.trim();
    if (/youtube\.com|youtu\.be/.test(v)) fetchInfo();
  }, 60);
});

// Démarrage
window.addEventListener('DOMContentLoaded', init);