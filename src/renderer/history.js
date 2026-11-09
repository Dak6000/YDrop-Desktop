// ══════════════════════════════════════════════════════════════════════════════
//  HISTORIQUE
// ══════════════════════════════════════════════════════════════════════════════
let histData = [], histFilter = 'all';
const FMT_OPTS = [
  ['video_1080', '1080p'], ['video_best', 'Meilleure qualité'], ['video_4k', '4K'], ['video_720', '720p'], ['video_480', '480p'], ['video_360', '360p'],
  ['audio_mp3_320', 'MP3 320k'], ['audio_mp3_192', 'MP3 192k'], ['audio_m4a', 'M4A'], ['audio_flac', 'FLAC'], ['audio_wav', 'WAV'], ['audio_ogg', 'OGG'],
];

async function refreshHistory() {
  try { histData = await window.ydrop.historyList(); } catch (e) { histData = []; }
  renderHistory();
}
function histItemHtml(h) {
  const ok = h.status === 'done';
  const missing = ok && !h.exists;
  const badges = ok ? (missing ? '<span class="badge2 warn">Fichier introuvable</span>' : '<span class="badge2 ok">✓ Réussi</span>') : '<span class="badge2 bad">✗ Échec</span>';
  const fmtSel = `<select class="mini" data-act="redl-fmt" title="Télécharger dans un autre format"><option value="">Autre format…</option>${FMT_OPTS.filter(([id]) => id !== h.format).map(([id, l]) => `<option value="${id}">${l}</option>`).join('')}</select>`;
  let act = '';
  if (ok && h.exists) act += '<button class="ib" data-act="open" title="Ouvrir">▶</button><button class="ib" data-act="folder" title="Afficher dans le dossier">📂</button>' + (h.kind === 'video' ? '<button class="ib" data-act="cut" title="Découper cette vidéo">✂</button>' : '');
  act += ok ? '<button class="ib" data-act="redl" title="Retélécharger">↻</button>' : '<button class="ib" data-act="redl" title="Réessayer">↻</button>';
  act += fmtSel + '<button class="ib" data-act="copy" title="Copier le lien">🔗</button>';
  if (ok && h.exists) act += '<button class="ib" data-act="trash" title="Supprimer le fichier (corbeille)">🗑</button>';
  act += '<button class="ib" data-act="remove" title="Retirer de l\'historique">✕</button>';
  const err = !ok && h.error ? `<div class="hmeta bad">${esc(h.error.title)}${h.error.detail ? ' — ' + esc(h.error.detail) : ''}</div><div class="hmeta">${esc(h.error.hint || '')}</div>` : '';
  return `<img class="qthumb" src="${esc(h.thumbnail)}" alt="" onerror="this.style.visibility='hidden'"/>
    <div class="qmain"><div class="qtitle">${esc(h.title)}</div>
      <div class="hmeta">${esc([h.author, h.formatLabel, h.durationText, ok ? fmtSize(h.size) : '', fmtDate(h.date)].filter(Boolean).join(' · '))}</div>
      <div>${badges}${h.subFiles && h.subFiles.length ? '<span class="badge2">💬 sous-titres</span>' : ''}</div>${err}</div>
    <div class="hact">${act}</div>`;
}
function renderHistory() {
  const q = $('hist-q').value.trim().toLowerCase();
  const list = histData.filter((h) => (histFilter === 'all' || h.status === histFilter) &&
    (!q || (h.title + ' ' + (h.author || '')).toLowerCase().includes(q)));
  $('hist-count').textContent = `${list.length} élément${list.length > 1 ? 's' : ''}` + (histData.length !== list.length ? ` sur ${histData.length}` : '');
  const box = $('hist-list');
  box.innerHTML = list.length ? '' : `<div class="empty-hint">${histData.length ? 'Aucun résultat.' : 'Votre historique est vide. Les vidéos téléchargées apparaîtront ici.'}</div>`;
  list.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'qitem hitem ' + (h.status === 'done' ? 'st-done' : 'st-error'); el.dataset.id = h.id;
    el.innerHTML = histItemHtml(h); box.appendChild(el);
  });
}

async function histAction(act, id, value) {
  const h = histData.find((x) => x.id === id); if (!h) return;
  switch (act) {
    case 'open': return window.ydrop.openFile(h.filePath);
    case 'folder': return window.ydrop.openFolder(h.filePath);
    case 'cut': switchSec('cut'); return openInCutter(h.filePath);
    case 'copy': await window.ydrop.copyText(h.url); return toast('ok', '✓ Lien copié');
    case 'redl': case 'redl-fmt': {
      if (act === 'redl-fmt' && !value) return;
      try {
        const r = await window.ydrop.redownload(id, value || undefined);
        if (r.added.length) { toast('ok', '✓ Ajouté à la file d\'attente'); switchSec('dl'); }
        else toast('info', 'Déjà en cours de téléchargement');
      } catch (e) { toast('err', '✗ ' + e.message); }
      return;
    }
    case 'remove': await window.ydrop.historyRemove(id, false); break;
    case 'trash':
      if (!confirm('Envoyer ce fichier à la corbeille ?\n\n' + h.filePath)) return;
      await window.ydrop.historyRemove(id, true); toast('ok', '✓ Fichier envoyé à la corbeille'); break;
  }
  refreshHistory();
}

function initHistory() {
  $('hist-q').addEventListener('input', renderHistory);
  $('hist-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hf]'); if (!b) return;
    histFilter = b.dataset.hf;
    document.querySelectorAll('#hist-filters .chip').forEach((c) => c.classList.toggle('on', c === b));
    renderHistory();
  });
  $('btn-hist-clear').onclick = async () => {
    if (!histData.length || !confirm('Effacer tout l\'historique ? (les fichiers téléchargés ne sont pas supprimés)')) return;
    await window.ydrop.historyClear(); refreshHistory();
  };
  $('hist-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const item = b.closest('.hitem'); if (item) histAction(b.dataset.act, item.dataset.id);
  });
  $('hist-list').addEventListener('change', (e) => {
    const s = e.target.closest('select[data-act]'); if (!s) return;
    const item = s.closest('.hitem'); if (item) { histAction(s.dataset.act, item.dataset.id, s.value); s.value = ''; }
  });
  window.ydrop.onHistoryChanged(() => { if ($('sec-hist').classList.contains('on')) refreshHistory(); });
}
