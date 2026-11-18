const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Library } = require('./library');

const isDev = !app.isPackaged;

/** @type {BrowserWindow|null} */
let win = null;
/** @type {Library|null} */
let library = null;
let prefsFile = null;

/* --------------------------------------------------------------- local media */
// the renderer needs to load artwork and audio from arbitrary folders on disk,
// so we serve them through a dedicated, read-only scheme instead of file://
protocol.registerSchemesAsPrivileged([
  { scheme: 'byazen', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

function registerMediaProtocol() {
  protocol.handle('byazen', (request) => {
    try {
      const url = new URL(request.url);
      // byazen://media/<base64 path>
      const b64 = url.pathname.replace(/^\//, '');
      if (url.host !== 'media' || !b64) return new Response('forbidden', { status: 403 });
      const file = Buffer.from(decodeURIComponent(b64), 'base64').toString('utf8');
      if (!path.isAbsolute(file)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
}

/* ------------------------------------------------------------------- prefs */
function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  try {
    fs.writeFileSync(prefsFile, JSON.stringify(next, null, 2));
  } catch {
    /* non fatal */
  }
  return next;
}

/* ------------------------------------------------------------------ window */
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#F5F1EA',
    title: 'ByAzen',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const send = () => win && win.webContents.send('window:state', { maximized: win.isMaximized() });
  win.on('maximize', send);
  win.on('unmaximize', send);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // hand drag-and-dropped folders/files to the renderer
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (isDev && process.env.BYAZEN_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.byazen.player');
  const userData = app.getPath('userData');
  prefsFile = path.join(userData, 'prefs.json');
  library = new Library({ cacheDir: path.join(userData, 'cache') });
  library.load();

  registerMediaProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* --------------------------------------------------------- window controls */
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:isMaximized', () => !!(win && win.isMaximized()));

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
  userData: app.getPath('userData'),
}));

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:icon', () => {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
  return img.isEmpty() ? null : img.toDataURL();
});

/* ------------------------------------------------------------- media helper */
const toMediaUrl = (file) => (file ? `byazen://media/${encodeURIComponent(Buffer.from(file, 'utf8').toString('base64'))}` : null);

/** a `.lrc` sidecar next to the track, when there is one */
function lrcFor(file) {
  if (!file) return null;
  const guess = file.replace(/\.[^.\\/]+$/, '.lrc');
  try {
    return fs.statSync(guess).isFile() ? toMediaUrl(guess) : null;
  } catch {
    return null;
  }
}

const decorate = (t) => ({ ...t, url: toMediaUrl(t.file), art: toMediaUrl(t.art), lrc: lrcFor(t.file) });

/* ------------------------------------------------------------------ library */
ipcMain.handle('library:state', () => {
  if (!library) return null;
  const snap = library.snapshot();
  return {
    ...snap,
    tracks: snap.tracks.map(decorate),
  };
});

ipcMain.handle('library:chooseFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose music folder',
    properties: ['openDirectory', 'multiSelections'],
    buttonLabel: 'Add to library',
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  res.filePaths.forEach((f) => library.addFolder(f));
  return { canceled: false, folders: res.filePaths };
});

ipcMain.handle('library:addFolders', (_e, folders) => {
  if (!Array.isArray(folders)) return { added: 0 };
  let added = 0;
  folders.forEach((f) => {
    try {
      if (fs.statSync(f).isDirectory()) {
        library.addFolder(f);
        added++;
      }
    } catch {
      /* ignore */
    }
  });
  return { added };
});

ipcMain.handle('library:removeFolder', (_e, folder) => {
  library.folders = library.folders.filter((f) => f !== folder);
  library.save();
  return library.folders;
});

ipcMain.handle('library:scan', async (event) => {
  if (!library) return null;
  const sender = event.sender;
  const snap = await library.scanAsync(library.folders, (progress) => {
    if (!sender.isDestroyed()) sender.send('library:progress', progress);
  });
  return {
    ...snap,
    tracks: snap.tracks.map(decorate),
  };
});

ipcMain.handle('library:refresh', () => {
  const changed = library.refresh();
  const removed = library.removeMissing();
  const snap = library.snapshot();
  return {
    changed,
    removed,
    ...snap,
    tracks: snap.tracks.map(decorate),
  };
});

/* ----------------------------------------------------------- recommendations */
ipcMain.handle('rec:history', () => loadPrefs().history || {});

ipcMain.handle('rec:event', (_e, { id, type }) => {
  if (!id || !type) return null;
  const prefs = loadPrefs();
  const history = prefs.history || {};
  const h = history[id] || { plays: 0, skips: 0, completed: 0, lastPlayed: 0 };
  if (type === 'play') {
    h.plays += 1;
    h.lastPlayed = Date.now();
  } else if (type === 'skip') {
    h.skips += 1;
    h.lastPlayed = Date.now();
  } else if (type === 'complete') {
    h.completed += 1;
    h.lastPlayed = Date.now();
  }
  history[id] = h;
  savePrefs({ history });
  return h;
});

/* --------------------------------------------------------------------- prefs */
ipcMain.handle('prefs:get', () => loadPrefs());
ipcMain.handle('prefs:set', (_e, patch) => savePrefs(patch || {}));

/* ---------------------------------------------------------------- filesystem */
ipcMain.handle('fs:reveal', (_e, file) => {
  if (typeof file === 'string' && path.isAbsolute(file)) shell.showItemInFolder(file);
});

ipcMain.handle('fs:droppedFolders', (_e, paths) => {
  const out = [];
  (Array.isArray(paths) ? paths : []).forEach((p) => {
    try {
      if (fs.statSync(p).isDirectory()) out.push(p);
      else out.push(path.dirname(p));
    } catch {
      /* ignore */
    }
  });
  return [...new Set(out)];
});
