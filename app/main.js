const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Library } = require('./library');
const { Audius, GENRES: AUDIUS_GENRES } = require('./audius');

const isDev = !app.isPackaged;
/** `ByAzen.exe --byazen-selftest` boots the UI, then exits 0 (used by CI). */
const SELFTEST = process.argv.includes('--byazen-selftest');

/** @type {BrowserWindow|null} */
let win = null;
/** @type {Library|null} */
let library = null;
/** @type {Audius|null} */
let audius = null;
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
    if (request.url.startsWith('byazen://stream')) return handleAudiusStream(request);
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

/* --------------------------------------------------------- remote streaming */
const AUDIUS_API = 'https://api.audius.co';

/**
 * byazen://stream/<trackId> — proxies bytes from public Audius content nodes.
 * Going through net.fetch keeps Range requests (seeking) and headers intact and
 * keeps the page independent of the remote host's CORS setup.
 */
async function handleAudiusStream(request) {
  let id;
  try {
    const url = new URL(request.url);
    id = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response('forbidden', { status: 403 });

  const range = request.headers.get('range');
  const target = `${AUDIUS_API}/v1/tracks/${encodeURIComponent(id)}/stream?app_name=ByAzen`;
  try {
    // follow the redirect to a content node; fetch() follows by default
    const upstream = await net.fetch(target, range ? { headers: { range } } : undefined);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response('stream unavailable', { status: upstream.status === 404 ? 404 : 502 });
    }
    const headers = {
      'content-type': upstream.headers.get('content-type') || 'audio/mpeg',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    };
    const len = upstream.headers.get('content-length');
    if (len) headers['content-length'] = len;
    const cr = upstream.headers.get('content-range');
    if (cr) headers['content-range'] = cr;
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response('stream unavailable', { status: 502 });
  }
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
  audius = new Audius();

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

/* -------------------------------------------------------------- audius (online) */
const AUDIUS_CACHE_FILE = () => path.join(app.getPath('userData'), 'audius-cache.json');

function readAudiusCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(AUDIUS_CACHE_FILE(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}
function writeAudiusCache(data) {
  try {
    fs.writeFileSync(AUDIUS_CACHE_FILE(), JSON.stringify(data));
  } catch {
    /* non fatal */
  }
}

/** attach a ready-to-play url; main owns stream resolution */
async function withStream(track) {
  if (!track) return null;
  const { direct, endpoint } = await audius.streamUrl(track).catch(() => ({ direct: null, endpoint: null }));
  return {
    ...track,
    // prefer a signed direct URL (fast start), the local proxy is the fallback
    url: `byazen://stream/${encodeURIComponent(track.audiusId)}`,
    fallbackUrl: direct || endpoint,
    resolvedAt: Date.now(),
  };
}

async function mapStreams(tracks) {
  const out = [];
  for (const t of tracks) {
    const s = await withStream(t).catch(() => null);
    if (s) out.push(s);
  }
  return out;
}

ipcMain.handle('audius:status', async () => {
  try {
    const tracks = await audius.trending({ limit: 1 });
    return { online: true, sample: tracks[0] ? tracks[0].title : null, genres: AUDIUS_GENRES };
  } catch (e) {
    return { online: false, error: String(e && e.message ? e.message : e), genres: AUDIUS_GENRES };
  }
});

ipcMain.handle('audius:browse', async (_e, { kind = 'trending', genre = 'All', time = 'week', limit = 24 } = {}) => {
  try {
    const cached = readAudiusCache();
    let tracks;
    if (kind === 'underground') tracks = await audius.underground({ limit });
    else tracks = await audius.trending({ genre, time, limit });
    if (cached && cached[kind + ':' + genre]) {
      // remember the last good chart so the UI can still open it offline
      delete cached[kind + ':' + genre];
    }
    const key = `${kind}:${genre}:${time}`;
    const store = cached || {};
    store[key] = { at: Date.now(), tracks };
    writeAudiusCache(store);
    return { ok: true, genre, time, tracks: await mapStreams(tracks) };
  } catch (e) {
    const store = readAudiusCache() || {};
    const fallback = store[`${kind}:${genre}:${time}`];
    return {
      ok: false,
      offline: !fallback,
      error: String(e && e.message ? e.message : e),
      cachedAt: fallback ? fallback.at : null,
      tracks: fallback ? await mapStreams(fallback.tracks) : [],
    };
  }
});

ipcMain.handle('audius:search', async (_e, { query, limit = 30 } = {}) => {
  try {
    const tracks = await audius.search(query, { limit });
    return { ok: true, tracks: await mapStreams(tracks) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), tracks: [] };
  }
});

ipcMain.handle('audius:artist', async (_e, { artistId, limit = 20 } = {}) => {
  try {
    const tracks = await audius.artistTracks(artistId, { limit });
    return { ok: true, tracks: await mapStreams(tracks) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), tracks: [] };
  }
});

ipcMain.handle('audius:track', async (_e, { id } = {}) => {
  try {
    const t = await audius.track(id);
    return { ok: !!t, track: t ? await withStream(t) : null };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('audius:playlist', async (_e, { id } = {}) => {
  try {
    const p = await audius.playlist(id);
    if (!p) return { ok: false, error: 'playlist not found' };
    return { ok: true, playlist: { ...p, tracks: await mapStreams(p.tracks.slice(0, 100)) } };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('audius:openPage', (_e, { permalink } = {}) => {
  if (typeof permalink === 'string' && /^https:\/\/audius\.co\//.test(permalink)) shell.openExternal(permalink);
});

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
