const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* Electron 32 removed File.path, so drop targets have to be resolved in the
   preload world where webUtils is available. The resolved list is stashed and
   picked up by the renderer as soon as it hears the `byazen:drop` event. */
let pendingDrop = [];
window.addEventListener(
  'drop',
  (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const paths = [];
    for (const f of files) {
      try {
        const p = webUtils.getPathForFile(f);
        if (p) paths.push(p);
      } catch {
        /* not a real file */
      }
    }
    if (!paths.length) return;
    pendingDrop = paths;
    window.dispatchEvent(new CustomEvent('byazen:drop'));
  },
  true
);

contextBridge.exposeInMainWorld('byazen', {
  platform: process.platform,

  /* window */
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  appIcon: () => ipcRenderer.invoke('app:icon'),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },

  /* local library */
  libraryState: () => ipcRenderer.invoke('library:state'),
  chooseFolder: () => ipcRenderer.invoke('library:chooseFolder'),
  addFolders: (folders) => ipcRenderer.invoke('library:addFolders', folders),
  removeFolder: (folder) => ipcRenderer.invoke('library:removeFolder', folder),
  scan: () => ipcRenderer.invoke('library:scan'),
  refresh: () => ipcRenderer.invoke('library:refresh'),
  onProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('library:progress', handler);
    return () => ipcRenderer.removeListener('library:progress', handler);
  },

  /* online catalogue (Audius) */
  audiusStatus: () => ipcRenderer.invoke('audius:status'),
  audiusBrowse: (opts) => ipcRenderer.invoke('audius:browse', opts || {}),
  audiusSearch: (query, limit) => ipcRenderer.invoke('audius:search', { query, limit }),
  audiusArtist: (artistId, limit) => ipcRenderer.invoke('audius:artist', { artistId, limit }),
  audiusTrack: (id) => ipcRenderer.invoke('audius:track', { id }),
  audiusPlaylist: (id) => ipcRenderer.invoke('audius:playlist', { id }),
  audiusOpenPage: (permalink) => ipcRenderer.invoke('audius:openPage', { permalink }),

  /* recommendations */
  history: () => ipcRenderer.invoke('rec:history'),
  recEvent: (id, type) => ipcRenderer.invoke('rec:event', { id, type }),

  /* prefs and files */
  prefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  reveal: (file) => ipcRenderer.invoke('fs:reveal', file),
  droppedFolders: (paths) => ipcRenderer.invoke('fs:droppedFolders', paths),
  takeDroppedPaths: () => {
    const out = pendingDrop;
    pendingDrop = [];
    return out;
  },
});
