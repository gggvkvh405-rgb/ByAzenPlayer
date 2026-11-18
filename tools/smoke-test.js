/**
 * Headless smoke test for the renderer: boots app.js inside jsdom with a fake
 * `window.byazen` preload bridge, exercises the main interactions from an empty
 * library through a populated one, and fails the build on any thrown error.
 *   node tools/smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = path.join(__dirname, '..', 'app', 'renderer');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: pathToFileURL(path.join(APP, 'index.html')).href,
});
const { window } = dom;

/* ------------------------------------------------------------ media stubs */
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
  get() {
    return this._paused !== false;
  },
  configurable: true,
});
window.HTMLMediaElement.prototype.play = function () {
  this._paused = false;
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () {
  this._paused = true;
  this.dispatchEvent(new window.Event('pause'));
};
window.HTMLMediaElement.prototype.load = function () {};
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
  get: () => 25.3,
  configurable: true,
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  get() {
    return this._t || 0;
  },
  set(v) {
    this._t = v;
  },
  configurable: true,
});

/* --------------------------------------------------- fake preload bridge */
const NOW = Date.now();
const T = (id, title, artist, album, genre, extra = {}) => ({
  id,
  title,
  artist,
  album,
  albumArtist: artist,
  genre,
  year: '2022',
  bpm: 100,
  trackNo: 1,
  format: 'MP3',
  rate: 44100,
  bits: 16,
  duration: 180,
  file: `C:\\Music\\${artist}\\${title}.mp3`,
  url: `byazen://media/${Buffer.from(`C:\\Music\\${artist}\\${title}.mp3`).toString('base64')}`,
  art: null,
  addedAt: NOW - Math.random() * 1e8,
  ...extra,
});

const TRACKS = [
  T('t1', 'Aurora Lines', 'Kael Rivers', 'Northern Light', 'Ambient', { bpm: 84 }),
  T('t2', 'Paper Moons', 'Kael Rivers', 'Northern Light', 'Ambient', { bpm: 88, trackNo: 2 }),
  T('t3', 'Felt Piano', 'Mira Voss', 'Four Rooms', 'Modern Classical', { bpm: 62, format: 'FLAC', bits: 24 }),
  T('t4', 'Harbour', 'Mira Voss', 'Four Rooms', 'Modern Classical', { bpm: 66, trackNo: 2 }),
  T('t5', 'Low Tide', 'Sable & Co.', 'Night Bus', 'Downtempo', { bpm: 96 }),
  T('t6', 'Night Bus', 'Sable & Co.', 'Night Bus', 'Downtempo', { bpm: 98, trackNo: 2 }),
  T('t7', 'Slow Light', 'June Alba', 'Wildflower', 'Folk', { bpm: 70 }),
  T('t8', 'Wildflower', 'June Alba', 'Wildflower', 'Folk', { bpm: 72, trackNo: 2 }),
];

let library = { tracks: [], folders: [], scannedAt: 0 };
const recEvents = [];
const bridge = {
  platform: 'win32',
  minimize() {},
  toggleMaximize() {},
  close() {},
  isMaximized: async () => false,
  info: async () => ({ version: '1.0.0', electron: '32.2.0', platform: 'win32', userData: 'C:\\Users\\me\\AppData\\ByAzen' }),
  openExternal: async () => {},
  appIcon: async () => null,
  onWindowState() {},
  libraryState: async () => library,
  chooseFolder: async () => {
    library = { ...library, tracks: TRACKS, folders: ['C:\\Music'] };
    return { canceled: false };
  },
  addFolders: async (f) => {
    library = { ...library, folders: [...new Set([...(library.folders || []), ...f])] };
    return library.folders;
  },
  removeFolder: async () => true,
  scan: async () => {
    library = { ...library, tracks: TRACKS, scannedAt: Date.now() };
    return library;
  },
  refresh: async () => ({ ...library, changed: false }),
  onProgress() {},
  history: async () => ({ t1: { plays: 3, completed: 2, skips: 0, lastPlayed: NOW - 3600e3 } }),
  recEvent: (id, kind) => recEvents.push([id, kind]),
  prefs: async () => ({ volume: 0.72 }),
  setPrefs: async () => true,
  reveal: async () => true,
  droppedFolders: async (list) => list,
};
window.byazen = bridge;

try {
  window.eval(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'));
} catch (e) {
  console.error('renderer boot failed:', e && e.stack ? e.stack : e);
  process.exit(1);
}

const d = window.document;
const q = (s) => d.querySelector(s);
const qa = (s) => Array.from(d.querySelectorAll(s));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const fail = [];
const check = (name, cond, extra = '') => {
  if (!cond) fail.push(`${name}${extra ? ' — ' + extra : ''}`);
};
const tick = () => new Promise((r) => setTimeout(r, 30));

(async function run() {
  await tick();

  /* ---------------------------------------------------------- empty library */
  check('empty state shown', !!q('.empty-state'), 'no .empty-state');
  check('empty text', /library is empty/i.test(q('.empty-state h2')?.textContent || ''));
  check('empty hint mentions drop', /drop a folder/i.test(q('.empty-hint')?.textContent || ''));
  check('add-folder button present', !!q('#btn-add-folder'));
  check('rescan button present', !!q('#btn-rescan'));
  check('shelves placeholder', !!q('.shelf-empty'), 'no shelf-empty');
  check('lyrics placeholder', /no track loaded/i.test(q('#lyr-body').textContent));
  check('queue empty count', q('#q-count').textContent === '0', q('#q-count').textContent);

  /* ----------------------------------------------------- populate + rerender */
  click(q('#btn-add-folder'));
  await tick();
  await tick();

  check('library populated', qa('.album').length === 4, `${qa('.album').length} albums`);
  check('shelves render tiles', qa('.shelf .tile').length >= 3, String(qa('.shelf .tile').length));
  check('on-repeat shelf from history', /On repeat/.test(q('#shelves').textContent));
  check('artists stat', q('#st-artists').textContent === '4', q('#st-artists').textContent);
  check('genres stat', q('#st-genres').textContent === '4', q('#st-genres').textContent);
  check('library count text', /4 albums · 8 tracks/.test(q('#lib-count').textContent), q('#lib-count').textContent);
  check('folder listed in settings', /Music/.test(q('#library-path').textContent), q('#library-path').textContent);

  /* ------------------------------------------------------------- playback */
  const first = qa('.album')[0];
  click(first);
  await tick();
  check('now playing title set', !!q('#np-title').textContent && q('#np-title').textContent !== 'Nothing playing yet', q('#np-title').textContent);
  check('queue filled', qa('.q-item').length === 2, String(qa('.q-item').length));
  check('returned home', d.body.dataset.view === 'home', d.body.dataset.view);
  check('rec event recorded', recEvents.length >= 1, JSON.stringify(recEvents));
  check('playing class', d.body.classList.contains('is-playing'));
  check('bottom bar title', q('#bar-title').textContent === q('#np-title').textContent);
  check('album marked playing', !!q('.album.is-playing'), 'no .is-playing album');

  click(q('#btn-next'));
  await tick();
  check('next advances queue', qa('.q-item.is-on').length === 1, String(qa('.q-item.is-on').length));
  click(q('#btn-play2'));
  await tick();
  check('bottom bar pauses', !d.body.classList.contains('is-playing'));
  click(q('#btn-play2'));
  await tick();
  check('bottom bar resumes', d.body.classList.contains('is-playing'));

  click(q('#btn-shuffle'));
  check('shuffle toggles', q('#btn-shuffle').classList.contains('is-on'));
  click(q('#btn-repeat'));
  check('repeat toggles', q('#btn-repeat').classList.contains('is-on'));

  /* ---------------------------------------------------------------- views */
  click(q('.nav[data-view="library"]'));
  await tick();
  check('nav switches view', d.body.dataset.view === 'library', d.body.dataset.view);
  check('recents list', qa('.rec').length > 0, String(qa('.rec').length));

  q('#search-lib').value = 'felt';
  q('#search-lib').dispatchEvent(new window.Event('input', { bubbles: true }));
  check('search filters', qa('.album').length === 1, `${qa('.album').length} albums`);

  q('#search-lib').value = '';
  q('#search-lib').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(q('.chip[data-filter="artists"]'));
  check('artists filter', qa('.album').length === 4, String(qa('.album').length));
  click(q('.chip[data-filter="genres"]'));
  check('genres filter', qa('.album').length === 4, String(qa('.album').length));
  click(q('.chip[data-filter="all"]'));

  click(q('.nav[data-view="radio"]'));
  await tick();
  check('radio stations', qa('#stations .card').length >= 1, String(qa('#stations .card').length));

  click(q('.nav[data-view="playlists"]'));
  await tick();
  check('playlist cards per artist', qa('#playlists .card').length === 4, String(qa('#playlists').childElementCount));

  /* ------------------------------------------------------ station playback */
  click(q('.nav[data-view="radio"]'));
  await tick();
  click(qa('#stations .card')[0]);
  await tick();
  check('station starts a queue', qa('.q-item').length >= 2, String(qa('.q-item').length));
  check('station banner in queue', !!q('.q-station'), 'no .q-station');
  check('station exits', !!q('#q-exit'));

  /* ------------------------------------------------------------- controls */
  click(q('#btn-fav'));
  check('favourite toggles', q('#btn-fav').classList.contains('is-on'));

  d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
  check('volume up key', Number(q('#vol-val').textContent) > 72, q('#vol-val').textContent);

  click(q('#q-clear'));
  check('clear queue keeps one', qa('.q-item').length === 1, String(qa('.q-item').length));

  const exposed = window.__byazen || {};
  check('test hooks exported', typeof exposed.applyLibrary === 'function' && !!exposed.state);

  errors.forEach((e) => fail.push(e));

  if (fail.length) {
    console.error('SMOKE TEST FAILED');
    fail.forEach((f) => console.error(' ✗', f));
    process.exit(1);
  }
  console.log('smoke test: all checks passed');
})();
