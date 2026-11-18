const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Library } = require('./library');

const isDev = !app.isPackaged;
/** `ByAzen.exe --byazen-selftest` boots the UI, then exits 0 (used by CI). */
const SELFTEST = process.argv.includes('--byazen-selftest');

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

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.lrc': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function decodeMediaPath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== 'media') return null;
  const b64 = url.pathname.replace(/^\//, '');
  if (!b64) return null;
  const file = Buffer.from(decodeURIComponent(b64), 'base64').toString('utf8');
  return path.isAbsolute(file) ? file : null;
}

/**
 * Serve a local file with byte-range support, so <audio> can seek and start
 * playback without downloading a whole FLAC first. Everything is read-only and
 * limited to paths the renderer asked for explicitly.
 */
function registerMediaProtocol() {
  protocol.handle('byazen', (request) => {
    const file = decodeMediaPath(request.url);
    if (!file) return new Response('forbidden', { status: 403 });

    let stat;
    try {
      stat = fs.statSync(file);
      if (!stat.isFile()) return new Response('not a file', { status: 404 });
    } catch {
      return new Response('not found', { status: 404 });
    }

    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('range');
    const headers = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    };

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m) return new Response('bad range', { status: 416, headers: { 'content-range': `bytes */${stat.size}` } });
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end === null) return new Response('bad range', { status: 416 });
      if (start === null) {
        // suffix range: last N bytes
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        return new Response('range not satisfiable', { status: 416, headers: { 'content-range': `bytes */${stat.size}` } });
      }
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          ...headers,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const stream = fs.createReadStream(file);
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: { ...headers, 'content-length': String(stat.size) },
    });
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
  win.once('ready-to-show', () => {
    win.show();
    // CI proof that the packaged payload boots: window shown => preload +
    // renderer + every required module loaded, so exit successfully.
    if (SELFTEST) {
      console.log('BYAZEN_SELFTEST_OK');
      setTimeout(() => app.exit(0), 250);
    }
  });

  const send = () => win && win.webContents.send('window:state', { maximized: win.isMaximized() });
  win.on('maximize', send);
  win.on('unmaximize', send);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Chromium refuses to mix a custom media scheme with plain file:// pages in
  // some builds; if the renderer ever fails to load the shell, say so loudly.
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('renderer failed to load', code, desc);
  });

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
