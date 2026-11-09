const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

const on = (channel) => (cb) => {
  const h = (_, v) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const inv = (channel) => (...a) => ipcRenderer.invoke(channel, ...a);

contextBridge.exposeInMainWorld('ydrop', {
  // Fenêtre
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close'),

  // Paramètres & outils
  loadSettings: inv('settings:load'),
  saveSettings: inv('settings:save'),
  toolsStatus:  inv('tools:status'),
  updateYtdlp:  inv('tools:update-ytdlp'),
  installDeno:  inv('tools:install-deno'),
  onToolsProgress: on('tools:progress'),
  onToolsNotice:   on('tools:notice'),
  onToolsChanged:  on('tools:changed'),
  onAppUpdate:     on('app:update'),

  // Téléchargement
  getInfo:      inv('video:info'),
  getPlaylist:  inv('video:playlist'),
  enqueue:      inv('dl:enqueue'),
  listJobs:     inv('dl:list'),
  cancelJob:    inv('dl:cancel'),
  retryJob:     inv('dl:retry'),
  removeJob:    inv('dl:remove'),
  clearFinished: inv('dl:clear-finished'),
  onJobUpdate:  on('dl:update'),
  onJobRemoved: on('dl:removed'),
  onDlFocus:    on('dl:focus'),
  extractUrls:  inv('url:extract'),
  clipboardUrls: inv('clipboard:urls'),
  copyText:     inv('clipboard:write'),
  onClipboardUrl: on('clipboard:url'),

  // Historique
  historyList:  inv('history:list'),
  historyRemove: (id, deleteFile) => ipcRenderer.invoke('history:remove', { id, deleteFile }),
  historyClear: inv('history:clear'),
  redownload:   (id, format) => ipcRenderer.invoke('history:redownload', { id, format }),
  onHistoryChanged: on('history:changed'),

  // Découpe
  probe:        inv('cut:probe'),
  silences:     (file, duration) => ipcRenderer.invoke('cut:silences', { file, duration }),
  onSilenceProgress: on('cut:silence-progress'),
  cut:          inv('cut:start'),
  onCutProgress: on('cut:progress'),
  cancelTask:   inv('task:cancel'),
  siblingSubs:  inv('subs:siblings'),
  readSubs:     inv('subs:read'),
  pickSubs:     inv('subs:pick'),
  generateSubs: inv('subs:generate'),
  onSubsProgress: on('subs:progress'),
  openWhisperFolder: inv('whisper:open-folder'),

  // Dialogues / OS
  chooseFolder: inv('dialog:choose-folder'),
  openVideo:    inv('dialog:open-video'),
  openFile:     (p) => ipcRenderer.send('open:file', p),
  openFolder:   (p) => ipcRenderer.send('open:folder', p),
  openExternal: (u) => ipcRenderer.send('open:external', u),

  // Chemin d'un fichier glissé-déposé (File.path a disparu des versions récentes d'Electron)
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || file.path || ''; } catch (_) { return file.path || ''; } },
  fileUrl: (p) => pathToFileURL(p).href,
});
