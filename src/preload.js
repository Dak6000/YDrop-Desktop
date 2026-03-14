const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ydrop', {
  // Fenêtre
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close'),

  // Paramètres persistants
  loadSettings: ()     => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),

  // Binaires
  checkBins: () => ipcRenderer.invoke('check-bins'),

  // Info vidéo YouTube
  getInfo: (url) => ipcRenderer.invoke('video:info', url),

  // Téléchargement
  download:       (opts) => ipcRenderer.invoke('video:download', opts),
  onProgress:     (cb)   => ipcRenderer.on('download:progress', (_, v) => cb(v)),
  removeProgress: ()     => ipcRenderer.removeAllListeners('download:progress'),

  // Découpe (100% locale)
  cut:              (opts) => ipcRenderer.invoke('video:cut', opts),
  onCutProgress:    (cb)   => ipcRenderer.on('cut:progress', (_, v) => cb(v)),
  removeCutProgress:()     => ipcRenderer.removeAllListeners('cut:progress'),

  // Dialogues OS
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  openVideo:    () => ipcRenderer.invoke('dialog:open-video'),
  probe:        (p)=> ipcRenderer.invoke('video:probe', p),

  // Ouvrir dans l'OS
  openFile:   (p) => ipcRenderer.send('open:file',   p),
  openFolder: (p) => ipcRenderer.send('open:folder', p),
});
