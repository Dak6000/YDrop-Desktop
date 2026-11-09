// ══════════════════════════════════════════════════════════════════════════════
//  TÉLÉCHARGEMENT : saisie rapide, file d'attente, suivi, diagnostic
// ══════════════════════════════════════════════════════════════════════════════
const jobs = new Map();
let previewInfo = null;
const ACTIVE = ['queued', 'fetching', 'downloading', 'processing', 'retrying', 'updating'];

function dlOpts() { return { format: $('opt-format').value, subLang: $('opt-subs').value }; }

// ── Ajout à la file ──
async function enqueueUrls(urls, extra = {}) {
  const o = dlOpts();
  const items = urls.map((u) => ({ url: u, format: o.format, subLang: o.subLang, ...extra }));
  let res;
  try { res = await window.ydrop.enqueue(items); }
  catch (e) { return toast('err', '✗ ' + e.message); }
  if (res.added.length) toast('ok', res.added.length === 1 ? '✓ Ajouté à la file d\'attente' : `✓ ${res.added.length} vidéos ajoutées à la file`);
  for (const s of res.skipped) {
    if (s.reason === 'already') {
      showNotice({
        key: 'dup-' + s.historyId, type: 'warn',
        text: `Déjà téléchargée : <b>${esc(s.title)}</b>`,
        actions: [
          { label: '▶ Ouvrir', onClick: () => window.ydrop.openFile(s.filePath) },
          { label: '📂 Dossier', onClick: () => window.ydrop.openFolder(s.filePath) },
          { label: '↻ Retélécharger', primary: true, onClick: () => enqueueUrls([s.url], { force: true }) },
        ],
      });
    } else if (s.reason === 'active') toast('info', 'Déjà dans la file d\'attente : ' + (s.title || ''));
    else toast('err', '✗ Lien non reconnu');
  }
  return res;
}

// ── Traitement d'un texte contenant un ou plusieurs liens ──
async function handleInput(text, { auto = false } = {}) {
  const found = await window.ydrop.extractUrls(text || '');
  if (!found.length) { toast('err', '✗ Aucun lien YouTube valide trouvé'); return false; }
  const videos = found.filter((u) => u.kind === 'video'), lists = found.filter((u) => u.kind === 'playlist');
  lists.forEach((l) => showPlaylist(l.url));
  if (!videos.length) return true;
  if (videos.length > 1 || auto) {
    await enqueueUrls(videos.map((v) => v.url));
    $('url-inp').value = ''; hidePreview();
  } else {
    $('url-inp').value = videos[0].url;
    await showPreview(videos[0].url);
  }
  return true;
}

// ── Aperçu ──
function hidePreview() { previewInfo = null; $('vcard').style.display = 'none'; }
async function showPreview(url) {
  const btn = $('btn-info');
  btn.disabled = true; btn.innerHTML = '<div class="spin"></div> Analyse…';
  try {
    const info = await window.ydrop.getInfo(url);
    previewInfo = info;
    $('vthumb').src = info.thumbnail; $('vtitle').textContent = info.title;
    $('vauthor').textContent = info.author; $('vdur').textContent = info.durationText; $('vviews').textContent = info.views;
    $('btn-prev-pl').style.display = info.listId ? '' : 'none';
    $('vcard').style.display = '';
  } catch (e) { toast('err', '✗ ' + e.message); hidePreview(); }
  finally { btn.disabled = false; btn.innerHTML = '🔍 Aperçu'; }
}

async function showPlaylist(url) {
  toast('info', 'Lecture de la playlist…');
  try {
    const pl = await window.ydrop.getPlaylist(url);
    if (!pl.entries.length) return toast('err', '✗ Playlist vide ou privée');
    showNotice({
      key: 'pl', type: 'info',
      text: `📃 Playlist <b>${esc(pl.title)}</b> — ${pl.entries.length} vidéo${pl.entries.length > 1 ? 's' : ''}`,
      actions: [{ label: `⬇ Tout télécharger (${pl.entries.length})`, primary: true, onClick: () => { enqueueUrls(pl.entries.map((e) => e.url)); hidePreview(); } }],
    });
  } catch (e) { toast('err', '✗ ' + e.message); }
}

// ── Rendu de la file ──
function jobStatusLine(j) {
  if (ACTIVE.includes(j.status)) {
    const bits = [`<span class="qstage">${esc(j.stage)}</span>`];
    if (j.status === 'downloading' || j.status === 'processing') bits.push(`${Math.round(j.percent)} %`);
    if (j.speed) bits.push(esc(j.speed));
    if (j.eta) bits.push('reste ' + esc(j.eta));
    return bits.join(' · ');
  }
  if (j.status === 'done') return `<span class="ok">✓ Terminé</span> · ${fmtSize(j.size)}${j.subFiles && j.subFiles.length ? ' · 💬 sous-titres' : ''}`;
  if (j.status === 'error') return '<span class="bad">✗ Échec</span>';
  return '<span class="muted">Annulé</span>';
}
function jobHtml(j) {
  const active = ACTIVE.includes(j.status);
  let actions = '';
  if (active) actions = '<button class="ib" data-act="cancel" title="Annuler">✕</button>';
  else if (j.status === 'done') actions =
    `<button class="ib" data-act="open" title="Ouvrir">▶</button><button class="ib" data-act="folder" title="Afficher dans le dossier">📂</button>` +
    (j.kind === 'video' ? '<button class="ib" data-act="cut" title="Découper cette vidéo">✂</button>' : '') +
    '<button class="ib" data-act="remove" title="Retirer de la liste">✕</button>';
  else actions = '<button class="ib" data-act="retry" title="Réessayer">↻</button><button class="ib" data-act="remove" title="Retirer">✕</button>';

  let err = '';
  if (j.status === 'error' && j.error) {
    const e = j.error;
    const fix = e.action === 'update-ytdlp' ? '<button class="btn by xs" data-act="fix-update">⟳ Mettre à jour yt-dlp et réessayer</button>'
      : e.action === 'install-deno' ? '<button class="btn by xs" data-act="fix-deno">⬇ Installer le composant JS et réessayer</button>'
      : e.action === 'cookies' ? '<button class="btn by xs" data-act="goto-params">⚙ Ouvrir les paramètres</button>' : '';
    err = `<div class="qerr"><b>${esc(e.title)}</b><div>${esc(e.hint)}</div>
      <div class="qerr-act">${fix}<button class="btn bg xs" data-act="retry">↻ Réessayer</button><button class="btn bg xs" data-act="details">🛈 Détails techniques</button></div>
      <div class="qraw" hidden><pre>${esc(e.detail ? e.detail + '\n\n' : '')}${esc(e.raw || '')}</pre><button class="btn bg xs" data-act="copy-raw">📋 Copier</button></div></div>`;
  }
  const warn = j.status === 'done' && j.warning ? `<div class="qwarn">⚠ ${esc(j.warning)}</div>` : '';
  const bar = active ? `<div class="pbg thin"><div class="pbar py${j.status === 'fetching' || j.status === 'retrying' || j.status === 'updating' ? ' indet' : ''}" style="width:${j.percent}%"></div></div>` : '';
  return `<img class="qthumb" src="${esc(j.thumbnail)}" alt="" onerror="this.style.visibility='hidden'"/>
    <div class="qmain">
      <div class="qtitle">${esc(j.title || j.url)}</div>
      <div class="qmeta">${esc([j.author, j.formatLabel, j.durationText, j.subLang ? 'sous-titres ' + j.subLang : ''].filter(Boolean).join(' · '))}</div>
      <div class="qline">${jobStatusLine(j)}</div>${bar}${warn}${err}
    </div><div class="qact">${actions}</div>`;
}
function upsertJob(j) {
  const first = !jobs.has(j.id);
  jobs.set(j.id, j);
  let el = $('job-' + j.id);
  if (!el) { el = document.createElement('div'); el.id = 'job-' + j.id; el.dataset.id = j.id; $('queue-list').prepend(el); }
  el.className = 'qitem st-' + j.status;
  // On préserve l'état « détails ouverts »
  const open = el.querySelector('.qraw') && !el.querySelector('.qraw').hidden;
  el.innerHTML = jobHtml(j);
  if (open && el.querySelector('.qraw')) el.querySelector('.qraw').hidden = false;
  refreshQueueMeta();
  return first;
}
function refreshQueueMeta() {
  const all = [...jobs.values()], act = all.filter((j) => ACTIVE.includes(j.status)).length;
  $('queue-empty').style.display = all.length ? 'none' : '';
  $('queue-count').textContent = all.length ? `· ${act} en cours / ${all.length}` : '';
  $('btn-clear-done').style.display = all.some((j) => ['done', 'cancelled'].includes(j.status)) ? '' : 'none';
  const b = $('badge-dl'); b.hidden = !act; b.textContent = act;
}

async function jobAction(act, id) {
  const j = jobs.get(id); if (!j) return;
  switch (act) {
    case 'cancel': return window.ydrop.cancelJob(id);
    case 'retry': return window.ydrop.retryJob(id);
    case 'remove': return window.ydrop.removeJob(id);
    case 'open': return window.ydrop.openFile(j.filePath);
    case 'folder': return window.ydrop.openFolder(j.filePath);
    case 'cut': switchSec('cut'); return window.openInCutter && openInCutter(j.filePath);
    case 'goto-params': return switchSec('params');
    case 'details': { const r = $('job-' + id).querySelector('.qraw'); if (r) r.hidden = !r.hidden; return; }
    case 'copy-raw': await window.ydrop.copyText((j.error && (j.error.detail + '\n' + j.error.raw)) || ''); return toast('ok', '✓ Copié');
    case 'fix-update': toast('info', 'Mise à jour de yt-dlp…');
      try { const r = await window.ydrop.updateYtdlp(); toast('ok', '✓ yt-dlp : ' + r.after); window.ydrop.retryJob(id); } catch (e) { toast('err', '✗ ' + e.message); }
      return;
    case 'fix-deno': toast('info', 'Installation du composant JavaScript…');
      try { await window.ydrop.installDeno(); toast('ok', '✓ Installé'); window.ydrop.retryJob(id); } catch (e) { toast('err', '✗ ' + e.message); }
  }
}

// ── Init ──
function initDownload() {
  $('opt-format').value = settings.defaultFormat || 'video_1080';
  $('opt-subs').value = settings.subLang || '';
  $('opt-quick').checked = settings.quickMode !== false;
  $('kbd-shortcut').textContent = /Mac/i.test(navigator.platform) ? 'Cmd+Maj+Y' : 'Ctrl+Maj+Y';

  $('opt-format').onchange = () => saveSettings({ defaultFormat: $('opt-format').value });
  $('opt-subs').onchange = () => saveSettings({ subLang: $('opt-subs').value });
  $('opt-quick').onchange = () => { saveSettings({ quickMode: $('opt-quick').checked }); $('p-quick').checked = $('opt-quick').checked; };
  $('btn-folder-dl').onclick = () => pickFolder('dlDir');

  $('btn-paste').onclick = async () => {
    const urls = await window.ydrop.clipboardUrls();
    if (!urls.length) return toast('err', '✗ Aucun lien YouTube dans le presse-papiers');
    await handleInput(urls.map((u) => u.url).join('\n'), { auto: $('opt-quick').checked });
  };
  $('btn-go').onclick = async () => {
    let text = $('url-inp').value.trim();
    if (!text) { const u = await window.ydrop.clipboardUrls(); text = u.map((x) => x.url).join('\n'); }
    if (!text) return toast('err', '✗ Collez un lien YouTube');
    await handleInput(text, { auto: true });
  };
  $('btn-info').onclick = async () => {
    const text = $('url-inp').value.trim() || (await window.ydrop.clipboardUrls()).map((x) => x.url).join('\n');
    if (!text) return toast('err', '✗ Collez un lien YouTube');
    const found = (await window.ydrop.extractUrls(text)).find((u) => u.kind === 'video');
    if (!found) return toast('err', '✗ Aucun lien de vidéo valide');
    $('url-inp').value = found.url; showPreview(found.url);
  };
  $('url-inp').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-go').click(); });
  $('url-inp').addEventListener('paste', () => setTimeout(() => {
    const v = $('url-inp').value.trim();
    if (/youtube\.com|youtu\.be/i.test(v)) handleInput(v, { auto: $('opt-quick').checked });
  }, 40));

  // Ctrl+V n'importe où dans l'onglet Télécharger
  document.addEventListener('paste', (e) => {
    if (!$('sec-dl').classList.contains('on')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/youtube\.com|youtu\.be/i.test(t)) { e.preventDefault(); handleInput(t, { auto: $('opt-quick').checked }); }
  });
  // Glisser un lien (depuis le navigateur) sur la fenêtre
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) return;
    const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (t && /youtube\.com|youtu\.be/i.test(t) && !e.dataTransfer.files.length) { switchSec('dl'); handleInput(t, { auto: true }); }
  });

  $('btn-prev-dl').onclick = async () => { if (!previewInfo) return; const i = previewInfo; hidePreview(); $('url-inp').value = ''; await enqueueUrls([i.url], { info: i }); };
  $('btn-prev-pl').onclick = () => { if (previewInfo) showPlaylist(previewInfo.url + '&list=' + previewInfo.listId); };
  $('btn-prev-close').onclick = hidePreview;
  $('btn-clear-done').onclick = () => window.ydrop.clearFinished();

  $('queue-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const item = b.closest('.qitem'); if (item) jobAction(b.dataset.act, item.dataset.id);
  });

  window.ydrop.onJobUpdate(upsertJob);
  window.ydrop.onJobRemoved((id) => { jobs.delete(id); const el = $('job-' + id); if (el) el.remove(); refreshQueueMeta(); });
  window.ydrop.onDlFocus(() => switchSec('dl'));
  window.ydrop.onClipboardUrl(({ url, known }) => {
    if (known) {
      showNotice({
        key: 'clip', type: 'warn', timeout: 30000, text: `🔗 Lien copié — <b>${esc(known.title)}</b> est déjà téléchargée`,
        actions: [{ label: '▶ Ouvrir', onClick: () => window.ydrop.openFile(known.filePath) }, { label: '↻ Retélécharger', onClick: () => enqueueUrls([url], { force: true }) }],
      });
    } else {
      showNotice({
        key: 'clip', type: 'info', timeout: 30000, text: '🔗 Lien YouTube détecté dans le presse-papiers',
        actions: [
          { label: '⬇ Télécharger', primary: true, onClick: () => { switchSec('dl'); enqueueUrls([url]); } },
          { label: '🔍 Aperçu', onClick: () => { switchSec('dl'); $('url-inp').value = url; showPreview(url); } },
        ],
      });
    }
  });

  window.ydrop.listJobs().then((list) => list.forEach(upsertJob));
  refreshQueueMeta();
}
