// ══════════════════════════════════════════════════════════════════════════════
//  COMMUN : utilitaires, état, notifications, navigation
// ══════════════════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let settings = {};
let toolsStatus = null;

function ft(s) {
  if (isNaN(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}` : `${m}:${String(sc).padStart(2, '0')}`;
}
function parseFT(str) {
  const p = String(str).trim().split(':').map(Number);
  if (p.some(isNaN)) return NaN;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0];
}
function fmtSize(b) {
  if (!b) return '';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' Go';
  return (b / 1048576).toFixed(1) + ' Mo';
}
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  const y = new Date(now - 864e5).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return same ? `Aujourd'hui ${hm}` : y ? `Hier ${hm}` : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + hm;
}

// ── Toast ──
let tTmr = null;
function toast(type, msg) {
  const el = $('toast'); if (!el) return;
  $('ti').textContent = type === 'ok' ? '✓' : type === 'info' ? 'ℹ' : '⚠';
  $('tmsg').textContent = msg;
  el.className = 'toast ' + type + ' on';
  clearTimeout(tTmr);
  tTmr = setTimeout(() => el.classList.remove('on'), type === 'err' ? 6000 : 4000);
}

// ── Bandeaux d'information (lien détecté, mise à jour, outils…) ──
const noticeTimers = {};
function dismissNotice(key) {
  const el = document.querySelector(`#notices [data-key="${key}"]`);
  if (el) el.remove();
  clearTimeout(noticeTimers[key]);
}
function showNotice({ key, type = 'info', text, actions = [], timeout = 0 }) {
  dismissNotice(key);
  const el = document.createElement('div');
  el.className = 'notice ' + type; el.dataset.key = key;
  el.innerHTML = `<div class="ntext">${text}</div><div class="nact"></div><button class="nclose" title="Fermer">✕</button>`;
  const box = el.querySelector('.nact');
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn xs ' + (a.primary ? 'by' : 'bg'); b.textContent = a.label;
    b.onclick = () => { if (!a.keep) dismissNotice(key); a.onClick && a.onClick(); };
    box.appendChild(b);
  });
  el.querySelector('.nclose').onclick = () => dismissNotice(key);
  $('notices').prepend(el);
  if (timeout) noticeTimers[key] = setTimeout(() => dismissNotice(key), timeout);
}

// ── Navigation ──
function switchSec(id) {
  document.querySelectorAll('.stab').forEach((b) => b.classList.toggle('on', b.dataset.sec === id));
  document.querySelectorAll('.sec').forEach((s) => s.classList.remove('on'));
  const t = $('sec-' + id); if (t) t.classList.add('on');
  if (id === 'hist' && window.refreshHistory) refreshHistory();
  if (id === 'params' && window.refreshTools) refreshTools();
  document.querySelector('.main').scrollTop = 0;
}

// ── Paramètres ──
let saveTmr = null;
async function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    await window.ydrop.saveSettings(patch);
    const b = $('save-badge');
    if (b) { b.classList.add('show'); clearTimeout(saveTmr); saveTmr = setTimeout(() => b.classList.remove('show'), 1800); }
  } catch (e) { console.warn('saveSettings:', e); }
}

function refreshFolderLabels() {
  $('out-path').textContent = settings.dlDir || 'Téléchargements/YDrop (par défaut)';
  $('param-dl-path').textContent = settings.dlDir || '— Par défaut (Téléchargements/YDrop) —';
  $('cut-out-path').textContent = settings.cutDir || '— À côté de la vidéo (dossier « YDrop-decoupes ») —';
  $('param-cut-path').textContent = settings.cutDir || '— Non défini —';
}
async function pickFolder(key) {
  const dir = await window.ydrop.chooseFolder();
  if (!dir) return;
  await saveSettings({ [key]: dir });
  refreshFolderLabels();
}

function setDot(id, ok) {
  const d = $(id); if (!d) return;
  d.classList.toggle('ok', !!ok); d.classList.toggle('err', !ok);
}
