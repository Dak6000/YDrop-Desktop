// ══════════════════════════════════════════════════════════════════════════════
//  DÉMARRAGE
// ══════════════════════════════════════════════════════════════════════════════
async function init() {
  try { settings = await window.ydrop.loadSettings(); } catch (e) { settings = {}; console.warn('loadSettings', e); }
  document.querySelectorAll('.stab').forEach((b) => b.addEventListener('click', () => switchSec(b.dataset.sec)));
  refreshFolderLabels();
  initDownload(); initHistory(); initCut(); initSettings();
  await refreshTools();
  if (toolsStatus && !toolsStatus.ffmpeg) toast('err', '⚠ ffmpeg manquant — voir Paramètres › Outils');
}
window.addEventListener('DOMContentLoaded', init);
