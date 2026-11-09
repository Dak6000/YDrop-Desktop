// ══════════════════════════════════════════════════════════════════════════════
//  PARAMÈTRES & OUTILS
// ══════════════════════════════════════════════════════════════════════════════
async function refreshTools() {
  try { toolsStatus = await window.ydrop.toolsStatus(); } catch (e) { return; }
  const t = toolsStatus;
  setDot('dot-ytdlp', t.ytdlp); setDot('dot-ffmpeg', t.ffmpeg); setDot('dot-js', !!t.jsRuntime);
  setDot('param-dot-ytdlp', t.ytdlp); setDot('param-dot-ffmpeg', t.ffmpeg); setDot('param-dot-js', !!t.jsRuntime);
  setDot('param-dot-whisper', t.whisper.installed && t.whisper.models.length > 0);
  $('param-ytdlp-path').textContent = t.ytdlp ? t.ytdlpPath : 'Introuvable — cliquez sur « Mettre à jour » pour l\'installer automatiquement.';
  $('t-ytdlp-ver').textContent = t.ytdlpVersion ? 'v' + t.ytdlpVersion : '';
  $('param-ffmpeg-path').textContent = t.ffmpeg ? t.ffmpegPath : 'Introuvable — placez ffmpeg dans le dossier bin/ (voir README).';
  $('param-js-path').textContent = t.jsRuntime ? `${t.jsRuntime} : ${t.jsRuntimePath}` : 'Requis par YouTube depuis fin 2025 pour éviter des échecs. Cliquez sur « Installer ».';
  $('btn-inst-deno').style.display = t.jsRuntime ? 'none' : '';
  $('param-whisper').textContent = !t.whisper.installed ? 'Optionnel — non installé (voir README).'
    : t.whisper.models.length ? `Prêt · ${t.whisper.models.map((m) => m.name).join(', ')}` : 'whisper-cli trouvé mais aucun modèle ggml-*.bin.';
  $('bin-platform').textContent = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[t.platform] || t.platform;
  $('about-ver').textContent = t.appVersion;
  $('badge-params').hidden = !(!t.ytdlp || !t.ffmpeg);
}

function toolProgress(tool, p) {
  const box = $('tool-prog'); box.style.display = '';
  $('tool-prog-lbl').textContent = 'Téléchargement de ' + tool + '…'; $('tool-prog-pct').textContent = p + ' %'; $('tool-prog-bar').style.width = p + '%';
  if (p >= 100) setTimeout(() => { box.style.display = 'none'; }, 1200);
}

function initSettings() {
  const fsel = $('p-format');
  FMT_OPTS.forEach(([id, l]) => fsel.add(new Option(l, id)));
  const bind = (id, key, type) => {
    const el = $(id);
    if (type === 'bool') { el.checked = !!settings[key]; el.onchange = () => saveSettings({ [key]: el.checked }); }
    else if (type === 'num') { el.value = String(settings[key] ?? ''); el.onchange = () => saveSettings({ [key]: +el.value }); }
    else { el.value = settings[key] ?? ''; el.onchange = () => saveSettings({ [key]: el.value }); }
  };
  bind('p-format', 'defaultFormat'); bind('p-subs', 'subLang'); bind('p-quick', 'quickMode', 'bool'); bind('p-clip', 'watchClipboard', 'bool');
  bind('p-shortcut', 'globalShortcut', 'bool'); bind('p-conc', 'concurrency', 'num'); bind('p-notify', 'notify', 'bool');
  bind('p-cookies', 'cookiesBrowser'); bind('p-cutq', 'cutQuality'); bind('p-substyle', 'subStyle'); bind('p-autoupd', 'autoUpdateYtdlp', 'bool');
  // Les réglages rapides de l'onglet Télécharger restent synchronisés
  $('p-format').addEventListener('change', () => { $('opt-format').value = $('p-format').value; });
  $('p-subs').addEventListener('change', () => { $('opt-subs').value = $('p-subs').value; });
  $('p-quick').addEventListener('change', () => { $('opt-quick').checked = $('p-quick').checked; });
  $('p-cutq').addEventListener('change', () => { $('cut-quality').value = $('p-cutq').value; });
  $('p-substyle').addEventListener('change', () => { $('sub-style').value = $('p-substyle').value; });

  $('p-dl-choose').onclick = () => pickFolder('dlDir');
  $('p-dl-clear').onclick = async () => { await saveSettings({ dlDir: '' }); refreshFolderLabels(); };
  $('p-cut-choose').onclick = () => pickFolder('cutDir');
  $('p-cut-clear').onclick = async () => { await saveSettings({ cutDir: '' }); refreshFolderLabels(); };

  $('btn-upd-ytdlp').onclick = async () => {
    const b = $('btn-upd-ytdlp'); b.disabled = true;
    try { const r = await window.ydrop.updateYtdlp(); toast('ok', r.changed ? `✓ yt-dlp mis à jour : ${r.before || '—'} → ${r.after}` : `✓ yt-dlp déjà à jour (${r.after})`); }
    catch (e) { toast('err', '✗ ' + e.message); }
    b.disabled = false; refreshTools();
  };
  $('btn-inst-deno').onclick = async () => {
    const b = $('btn-inst-deno'); b.disabled = true;
    try { const r = await window.ydrop.installDeno(); toast('ok', '✓ Composant JavaScript installé (' + r.version + ')'); }
    catch (e) { toast('err', '✗ ' + e.message); }
    b.disabled = false; refreshTools();
  };
  $('btn-whisper-folder').onclick = () => window.ydrop.openWhisperFolder();

  window.ydrop.onToolsProgress(({ tool, percent }) => toolProgress(tool, percent));
  window.ydrop.onToolsChanged(refreshTools);
  window.ydrop.onToolsNotice(({ type, text }) => showNotice({ key: 'tools', type: type === 'err' ? 'warn' : type, text: '🔧 ' + esc(text), timeout: type === 'info' ? 0 : 8000 }));
  window.ydrop.onAppUpdate((u) => showNotice({
    key: 'appupd', type: 'info', text: `🎉 Nouvelle version de YDrop disponible : <b>v${esc(u.version)}</b>`,
    actions: [{ label: 'Télécharger', primary: true, onClick: () => window.ydrop.openExternal(u.url) }],
  }));
}
