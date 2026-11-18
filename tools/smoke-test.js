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
const audiusCalls = [];
const REMOTE = [
  {
    id: 'audius:A1',
    audiusId: 'A1',
    source: 'audius',
    title: 'Light the way',
    artist: 'Stony100',
    album: '',
    albumArtist: 'Stony100',
    genre: 'Deep House',
    year: '2026',
    bpm: 130,
    duration: 227,
    art: 'https://cdn/1000.jpg',
    url: 'byazen://stream/A1',
    playCount: 1520,
  },
  {
    id: 'audius:A2',
    audiusId: 'A2',
    source: 'audius',
    title: 'The Search',
    artist: 'JXNKO',
    album: '',
    albumArtist: 'JXNKO',
    genre: 'Trap',
    year: '2026',
    bpm: 140,
    duration: 163,
    art: 'https://cdn/2.jpg',
    url: 'byazen://stream/A2',
    playCount: 313,
  },
  {
    id: 'audius:A3',
    audiusId: 'A3',
    source: 'audius',
    title: 'Aurora',
    artist: 'EIME',
    album: 'The Real Old School Hip Hop, Vol. 3',
    albumArtist: 'EIME',
    genre: 'Jazz',
    year: '2021',
    bpm: 120,
    duration: 225,
    art: 'https://cdn/3.jpg',
    url: 'byazen://stream/A3',
    playCount: 9609,
  },
];
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
  takeDroppedPaths: () => [],
  /* online catalogue */
  audiusBrowse: async ({ kind = 'trending', genre = 'All' } = {}) => {
    audiusCalls.push({ kind, genre });
    const list = [REMOTE[0], REMOTE[1]].map((t) => ({ ...t, genre: genre === 'All' ? t.genre : genre }));
    return { ok: true, genre, tracks: list.map((t) => ({ ...t, url: `byazen://stream/${t.audiusId}` })) };
  },
  audiusSearch: async (q) => {
    audiusCalls.push({ search: q });
    return { ok: true, tracks: [{ ...REMOTE[2], url: `byazen://stream/${REMOTE[2].audiusId}` }] };
  },
  audiusArtist: async () => ({ ok: true, tracks: [] }),
  audiusTrack: async () => ({ ok: true, track: REMOTE[0] }),
  audiusPlaylist: async () => ({ ok: false }),
  audiusStatus: async () => ({ online: true }),
  audiusOpenPage: async () => true,
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

  /* ------------------------------------------------------ online catalogue */
  click(q('.nav[data-view="online"]'));
  await tick();
  await tick();
  check('online view opens', d.body.dataset.view === 'online', d.body.dataset.view);
  check('chart cards render', qa('#online-grid .on-card').length === 2, String(qa('#online-grid .on-card').length));
  check('status shows connected', q('#online-status').dataset.state === 'online', q('#online-status').textContent);
  check('genre chips built', qa('#online-chips .chip').length > 5, String(qa('#online-chips .chip').length));
  check('chart fetched for the catalogue view', audiusCalls.some((c) => c.kind === 'trending'), JSON.stringify(audiusCalls));
  check('catalogue shelf on home', qa('#shelves .shelf-row .tile').length >= 2, String(qa('#shelves .shelf-row .tile').length));

  click(q('#online-chips .chip[data-genre="House"]'));
  await tick();
  await tick();
  check('genre switch refetches', audiusCalls.some((c) => c.genre === 'House'), JSON.stringify(audiusCalls));

  click(q('#btn-online-underground'));
  await tick();
  await tick();
  check('underground requests underground', audiusCalls.some((c) => c.kind === 'underground'), JSON.stringify(audiusCalls));
  click(q('#btn-online-underground'));

  const chartCard = qa('#online-grid .on-card')[0];
  click(chartCard);
  await tick();
  check('remote track plays', q('#np-title').textContent.length > 0 && d.body.dataset.view === 'home', d.body.dataset.view);
  check('remote marked in queue', /audius/.test(q('#queue').textContent), 'queue has no source badge');
  check('remote id in queue', window.__byazen.state.queue.some((id) => id.startsWith('audius:')), JSON.stringify(window.__byazen.state.queue));

  click(q('#btn-next'));
  await tick();
  check('next walks the online queue', window.__byazen.state.queue[window.__byazen.state.index].startsWith('audius:'), String(window.__byazen.state.index));

  q('#search').value = 'aurora';
  q('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 420));
  check('search hits the catalogue', audiusCalls.some((c) => c.search === 'aurora'), JSON.stringify(audiusCalls));
  check('search results listed', qa('#online-results .row').length === 1, String(qa('#online-results .row').length));
  check('search panel visible', q('#online-search').hidden === false);
  click(q('#online-results .row'));
  await tick();
  check('search result plays', q('#np-title').textContent === 'Aurora', q('#np-title').textContent);
  click(q('#online-search-close'));
  check('search panel closes', q('#online-search').hidden === true);

  q('#set-online').checked = false;
  q('#set-online').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  check('catalogue can be switched off', /switched off/i.test(q('#online-grid').textContent), q('#online-grid').textContent.slice(0, 40));
  q('#set-online').checked = true;
  q('#set-online').dispatchEvent(new window.Event('change', { bubbles: true }));

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
