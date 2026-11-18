/* ByAzen — renderer. Local library, offline recommendations, real playback. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const api = window.byazen || null; // present inside Electron, absent in bare tests

/* ------------------------------------------------------------------- state */
const state = {
  /** @type {any[]} */
  tracks: [],
  queue: [],
  index: 0,
  view: 'home',
  shuffle: false,
  repeat: false,
  scanning: false,
  reducedMotion: false,
  volume: 0.72,
  muted: false,
  favourites: new Set(),
  history: {},
  folders: [],
  filter: 'all',
  station: null,
  recents: [],
  /* online catalogue */
  remote: new Map(), // id -> track coming from Audius
  online: { genre: 'All', time: 'week', kind: 'trending', tracks: [], loading: false, error: null, cachedAt: null, status: null },
  results: [],
  onlineEnabled: true,
};

const audio = $('#audio');
audio.volume = state.volume;

const allTracks = () => (state.remote.size ? state.tracks.concat([...state.remote.values()]) : state.tracks);
const byId = (id) => state.tracks.find((t) => t.id === id) || state.remote.get(id) || null;
const current = () => byId(state.queue[state.index]) || state.tracks[0] || null;
const isRemote = (t) => !!t && t.source === 'audius';

/* -------------------------------------------------------------------- utils */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const initials = (s) =>
  String(s || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

const ART_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4E3D0"/><stop offset="1" stop-color="#D8B49B"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><g fill="none" stroke="#8A5B42" stroke-opacity="0.35" stroke-width="2"><circle cx="150" cy="128" r="26"/><circle cx="150" cy="128" r="40"/><path d="M150 168v46"/></g></svg>`
  );

/* -------------------------------------------------------------- window chrome */
if (api) {
  if (api.platform === 'darwin') document.body.classList.add('is-mac');
  $('#btn-min')?.addEventListener('click', () => api.minimize());
  $('#btn-max')?.addEventListener('click', () => api.toggleMaximize());
  $('#btn-close')?.addEventListener('click', () => api.close());
  api.onWindowState?.(({ maximized }) => {
    const btn = $('#btn-max svg');
    if (btn)
      btn.innerHTML = maximized
        ? '<path d="M3.4 4.6h5.8M3.4 4.6v5.8M8.6 7.4h5.8M8.6 7.4v5.8"/>'
        : '<rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.4"/>';
  });
  api.info().then((info) => {
    const el = $('#app-meta');
    if (el) el.textContent = `ByAzen ${info.version} · Electron ${info.electron} · ${info.platform}`;
    const pathEl = $('#library-path');
    if (pathEl) pathEl.textContent = info.userData || '';
  });
  $('#titlebar')?.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.win-btn')) api.toggleMaximize();
  });
  api.onProgress(({ done, total }) => {
    const el = $('#scan-banner');
    if (el && state.scanning) el.textContent = total ? `Reading tags ${done} / ${total}…` : 'Scanning…';
  });
}

/* ---------------------------------------------------------------- rendering */
function albumArt(t) {
  return t && t.art ? t.art : ART_FALLBACK;
}

function trackRow(t, i, opts = {}) {
  const el = document.createElement('button');
  el.className = 'row' + (opts.active ? ' is-on' : '');
  el.dataset.id = t.id;
  el.innerHTML = `
    <span class="row-no">${opts.number ?? i + 1}</span>
    <img class="row-art" src="${albumArt(t)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
    <span class="row-meta">
      <span class="row-title">${esc(t.title)}</span>
      <span class="row-sub">${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</span>
    </span>
    <span class="row-tag">${esc(t.format || '')}${t.rate ? ' ' + Math.round(t.rate / 100) / 10 + 'k' : ''}</span>
    <span class="row-dur">${fmt(t.duration)}</span>`;
  el.addEventListener('click', () => playTrack(t.id));
  return el;
}

function albumCard(album, tracks) {
  const el = document.createElement('div');
  el.className = 'album';
  el.dataset.key = album.key;
  const first = tracks[0];
  el.innerHTML = `
    <div class="album-art">
      <img src="${albumArt(first)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span class="badge-playing">PLAYING</span>
      <button class="album-play" title="Play ${esc(album.name)}" aria-label="Play ${esc(album.name)}">
        <svg viewBox="0 0 24 24"><path d="M8.6 5.2 18 12l-9.4 6.8z"/></svg>
      </button>
    </div>
    <div class="album-name">${esc(album.name)}</div>
    <div class="album-sub">${esc(album.artist)} · ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}</div>`;
  el.addEventListener('click', () => playList(tracks));
  return el;
}

function registerRemote(tracks) {
  tracks.forEach((t) => {
    if (t && t.source === 'audius') state.remote.set(t.id, t);
  });
}

function playList(tracks) {
  if (!tracks.length) return;
  registerRemote(tracks);
  state.queue = tracks.map((t) => t.id);
  state.index = 0;
  state.station = null;
  noteRecent(tracks[0].id);
  renderQueue();
  renderRecents();
  loadCurrent(true);
  go('home');
}

function artistCard(name, tracks) {
  const el = document.createElement('div');
  el.className = 'album';
  el.innerHTML = `
    <div class="album-art">
      <div class="album-art-ph" style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--serif);font-size:34px;color:rgba(90,52,34,0.42)">${esc(initials(name))}</div>
      <button class="album-play" title="Play ${esc(name)}" aria-label="Play ${esc(name)}">
        <svg viewBox="0 0 24 24"><path d="M8.6 5.2 18 12l-9.4 6.8z"/></svg>
      </button>
    </div>
    <div class="album-name">${esc(name)}</div>
    <div class="album-sub">${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}</div>`;
  el.addEventListener('click', () => playList(tracks));
  return el;
}

function genreCard(name, tracks) {
  const el = document.createElement('div');
  el.className = 'album';
  el.innerHTML = `
    <div class="album-art">
      <img src="${albumArt(tracks[0])}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <button class="album-play" title="Play ${esc(name)}" aria-label="Play ${esc(name)}">
        <svg viewBox="0 0 24 24"><path d="M8.6 5.2 18 12l-9.4 6.8z"/></svg>
      </button>
    </div>
    <div class="album-name">${esc(name)}</div>
    <div class="album-sub">${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}</div>`;
  el.addEventListener('click', () => playList(tracks));
  return el;
}

function albumKey(t) {
  return `${String(t.albumArtist || t.artist).toLowerCase()}\u0000${String(t.album).toLowerCase()}`;
}

function groupAlbums(tracks) {
  const map = new Map();
  tracks.forEach((t) => {
    const key = albumKey(t);
    if (!map.has(key)) map.set(key, { key, name: t.album, artist: t.albumArtist || t.artist, tracks: [] });
    map.get(key).tracks.push(t);
  });
  const albums = [...map.values()];
  albums.forEach((a) => a.tracks.sort((x, y) => x.trackNo - y.trackNo || x.title.localeCompare(y.title)));
  return albums.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
}

function renderLibrary() {
  const grid = $('#grid');
  const q = ($('#search-lib').value || '').trim().toLowerCase();
  const filtered = state.tracks.filter((t) => {
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q) ||
      (t.genre || '').toLowerCase().includes(q)
    );
  });

  grid.innerHTML = '';
  if (!state.tracks.length) {
    grid.innerHTML = emptyLibraryHTML();
    wireEmptyLibrary(grid);
    $('#lib-count').textContent = 'no music yet';
    updateStats();
    return;
  }
  const albums = groupAlbums(filtered);
  if (state.filter === 'artists') {
    const byArtist = new Map();
    filtered.forEach((t) => {
      const k = t.albumArtist || t.artist;
      if (!byArtist.has(k)) byArtist.set(k, []);
      byArtist.get(k).push(t);
    });
    if (!byArtist.size) grid.innerHTML = '<div class="empty">Nothing matches that search.</div>';
    [...byArtist.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, list]) => grid.appendChild(artistCard(name, list)));
    $('#lib-count').textContent = `${byArtist.size} artists · ${filtered.length} tracks`;
    updateStats();
    return;
  }
  if (state.filter === 'genres') {
    const byGenre = new Map();
    filtered.forEach((t) =>
      String(t.genre || 'untagged')
        .split(/[;,/]/)
        .map((g) => g.trim())
        .filter(Boolean)
        .forEach((g) => {
          if (!byGenre.has(g)) byGenre.set(g, []);
          byGenre.get(g).push(t);
        })
    );
    if (!byGenre.size) grid.innerHTML = '<div class="empty">Nothing matches that search.</div>';
    [...byGenre.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([name, list]) => grid.appendChild(genreCard(name, list)));
    $('#lib-count').textContent = `${byGenre.size} genres · ${filtered.length} tracks`;
    updateStats();
    return;
  }
  if (!albums.length) grid.innerHTML = '<div class="empty">Nothing matches that search.</div>';
  albums.forEach((a) => grid.appendChild(albumCard(a, a.tracks)));
  $('#lib-count').textContent = `${albums.length} albums · ${filtered.length} tracks`;
  updateStats();
  paintPlaying();
}

function emptyLibraryHTML() {
  return `<div class="empty-state">
    <div class="empty-art">${'<svg viewBox="0 0 20 20"><path d="M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2M2.8 2.8a10.2 10.2 0 0 0 0 14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4"/></svg>'}</div>
    <h2>Your library is empty</h2>
    <p>Point ByAzen at a folder of music — MP3, FLAC, M4A, OGG, Opus or WAV.
       Tags and embedded artwork are read locally, nothing is uploaded.</p>
    <div class="empty-actions">
      <button class="btn btn--primary" data-act="folder">Choose folder…</button>
      <button class="btn" data-act="demo">Load demo tracks</button>
    </div>
    <div class="empty-hint">…or drop a folder anywhere on this window.</div>
  </div>`;
}

function wireEmptyLibrary(root) {
  $$('[data-act]', root).forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.act === 'folder') await chooseFolder();
      else await loadDemo();
    });
  });
}

function updateStats() {
  const albums = groupAlbums(state.tracks).length;
  const artists = new Set(state.tracks.map((t) => t.albumArtist || t.artist)).size;
  const genres = new Set(state.tracks.map((t) => t.genre).filter(Boolean)).size;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('st-albums', albums);
  set('st-artists', artists);
  set('st-genres', genres);
  const folders = $('#lib-folders');
  if (folders) folders.textContent = `${state.folders.length} ${state.folders.length === 1 ? 'folder' : 'folders'}`;
  const pathEl = $('#library-path');
  if (pathEl) pathEl.textContent = state.folders.length ? state.folders.join('   ·   ') : 'No folders added yet';
}

/* --------------------------------------------------------------- home view */
function renderHome() {
  const t = current();
  const hasMusic = !!t;

  $('#np-title').textContent = hasMusic ? t.title : 'Nothing playing yet';
  $('#np-artist').textContent = hasMusic ? `${t.artist}${t.album ? ' · ' + t.album : ''}` : 'Add a folder to get started';
  $('#np-art').src = hasMusic ? albumArt(t) : ART_FALLBACK;
  $('#np-art').onerror = () => {
    $('#np-art').src = ART_FALLBACK;
  };
  document.documentElement.style.setProperty('--glow', `url("${hasMusic ? albumArt(t) : ART_FALLBACK}")`);
  $('#bar-art').src = hasMusic ? albumArt(t) : ART_FALLBACK;
  $('#bar-title').textContent = hasMusic ? t.title : '—';
  $('#bar-sub').textContent = hasMusic ? t.artist : '—';
  $('#mini-title').textContent = hasMusic ? t.title : 'No track';
  $('#mini-sub').textContent = hasMusic
    ? `${t.artist} · ${t.format || 'audio'}${t.bits ? ' ' + t.bits + '-bit' : ''}`
    : 'Library empty';
  $('#t-dur').textContent = fmt(hasMusic ? t.duration : 0);
  document.title = hasMusic ? `${t.title} — ByAzen` : 'ByAzen';
  $('#btn-fav').classList.toggle('is-on', hasMusic && state.favourites.has(t.id));

  renderLyrics();
  renderShelves();
}

/** a small "from the catalogue" row, shared by the empty and the filled home */
function renderCatalogueShelf(wrap) {
  const sec = document.createElement('section');
  sec.className = 'shelf';
  sec.innerHTML = `<div class="shelf-head"><h3>From the catalogue</h3><span>Audius · open catalogue</span></div><div class="shelf-row"></div>`;
  const row = sec.querySelector('.shelf-row');
  wrap.appendChild(sec);
  if (!state.online.tracks.length) {
    row.innerHTML = '<div class="shelf-loading">Loading charts…</div>';
    loadOnline().then(() => {
      row.innerHTML = '';
      if (!state.online.tracks.length) {
        row.innerHTML = '<div class="shelf-loading">Catalogue unavailable right now.</div>';
        return;
      }
      state.online.tracks.slice(0, 12).forEach((t) => {
        const el = document.createElement('button');
        el.className = 'tile';
        el.innerHTML = `<img src="${esc(t.art || ART_FALLBACK)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
          <span class="tile-t">${esc(t.title)}</span><span class="tile-s">${esc(t.artist)}</span>`;
        el.addEventListener('click', () => {
          playList(state.online.tracks);
          const i = state.queue.indexOf(t.id);
          if (i >= 0) {
            state.index = i;
            renderQueue();
            loadCurrent(true);
          }
        });
        row.appendChild(el);
      });
    });
    return;
  }
  state.online.tracks.slice(0, 12).forEach((t) => {
    const el = document.createElement('button');
    el.className = 'tile';
    el.innerHTML = `<img src="${esc(t.art || ART_FALLBACK)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span class="tile-t">${esc(t.title)}</span><span class="tile-s">${esc(t.artist)}</span>`;
    el.addEventListener('click', () => {
      playList(state.online.tracks);
      const i = state.queue.indexOf(t.id);
      if (i >= 0) {
        state.index = i;
        renderQueue();
        loadCurrent(true);
      }
    });
    row.appendChild(el);
  });
}

function renderShelves() {
  const wrap = $('#shelves');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.tracks.length) {
    wrap.innerHTML = `<div class="shelf-empty">
      <b>Two ways to get music in here.</b>
      <span>Add a folder of your own files for an offline library and offline radio,
      or open <b>Catalogue</b> to stream from Audius — an open catalogue of
      artist-uploaded, openly licensed music.</span>
      <span class="shelf-empty-actions">
        <button class="btn btn--sm btn--primary" data-act="folder">Add folder…</button>
        <button class="btn btn--sm" data-act="online">Open catalogue</button>
        <button class="btn btn--sm" data-act="demo">Load demo tracks</button>
      </span>
    </div>`;
    $$('[data-act]', wrap).forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.act === 'folder') chooseFolder();
        else if (b.dataset.act === 'online') go('online');
        else loadDemo();
      })
    );
    if (state.onlineEnabled) renderCatalogueShelf(wrap);
    return;
  }
  const shelves = buildShelves();

  const add = (title, subtitle, items, renderItem) => {
    if (!items.length) return;
    const sec = document.createElement('section');
    sec.className = 'shelf';
    sec.innerHTML = `<div class="shelf-head"><h3>${esc(title)}</h3><span>${esc(subtitle)}</span></div><div class="shelf-row"></div>`;
    const row = sec.querySelector('.shelf-row');
    items.forEach((it) => row.appendChild(renderItem(it)));
    wrap.appendChild(sec);
  };

  const card = (t) => {
    const el = document.createElement('button');
    el.className = 'tile';
    el.innerHTML = `<img src="${albumArt(t)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span class="tile-t">${esc(t.title)}</span>
      <span class="tile-s">${esc(t.artist)}</span>`;
    el.addEventListener('click', () => playTrack(t.id));
    return el;
  };

  if (shelves.onRepeat.length) add('On repeat', 'Things you finish', shelves.onRepeat, card);
  add('Recently added', `${state.tracks.length} in library`, shelves.recentlyAdded, card);

  const stationCard = (s) => {
    const el = document.createElement('button');
    el.className = 'tile tile--station';
    el.innerHTML = `<span class="tile-glyph"><svg viewBox="0 0 20 20"><path d="M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2M2.8 2.8a10.2 10.2 0 0 0 0 14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4"/></svg></span>
      <span class="tile-t">${esc(s.name)}</span>
      <span class="tile-s">${esc(s.sub)}</span>`;
    el.addEventListener('click', () => startStation(s));
    return el;
  };
  if (shelves.stations.length) add('Radio', 'From your library', shelves.stations, stationCard);
  if (state.onlineEnabled) renderCatalogueShelf(wrap);
}

/* ---------------------------------------------------------------- queue etc */
function renderQueue() {
  const wrap = $('#queue');
  wrap.innerHTML = '';
  let order = state.queue.map(byId).filter(Boolean);
  if (state.station) {
    const head = document.createElement('div');
    head.className = 'q-station';
    head.innerHTML = `<span class="cap">STATION</span><b>${esc(state.station.name)}</b>
      <button class="link" id="q-exit">Exit</button>`;
    wrap.appendChild(head);
    head.querySelector('#q-exit').addEventListener('click', () => {
      state.station = null;
      renderQueue();
    });
  }
  order.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'q-item' + (i === state.index ? ' is-on' : '');
    b.innerHTML = `
      <img class="q-art" src="${albumArt(t)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span class="q-meta"><span class="q-title">${esc(t.title)}${isRemote(t) ? ' <span class="badge-src">audius</span>' : ''}</span><span class="q-artist">${esc(t.artist)}</span></span>
      <span class="q-dur">${fmt(t.duration)}</span>`;
    b.addEventListener('click', () => {
      state.index = i;
      loadCurrent(true);
    });
    wrap.appendChild(b);
  });
  $('#q-count').textContent = order.length;
}

function renderRecents() {
  const wrap = $('#recent');
  if (!wrap) return;
  wrap.innerHTML = '';
  const ids = state.recents.length ? state.recents : state.tracks.slice(0, 7).map((t) => t.id);
  ids.slice(0, 7).forEach((id, i) => {
    const t = byId(id);
    if (!t) return;
    const b = document.createElement('button');
    b.className = 'rec' + (i === 0 && !state.recents.length ? ' is-on' : '');
    b.innerHTML = `<img src="${albumArt(t)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span><span class="rec-t">${esc(t.title)}</span><span class="rec-s">${esc(t.artist)}</span></span>
      <span class="rec-d">${fmt(t.duration)}</span>`;
    b.addEventListener('click', () => playTrack(t.id));
    wrap.appendChild(b);
  });
  if (!ids.length) wrap.innerHTML = '<div class="empty">Nothing played yet.</div>';
}

/* ------------------------------------------------------------------ lyrics */
/* Local files rarely ship lyrics; this looks for a sidecar .lrc next to the
   track and otherwise shows an honest placeholder instead of fake text. */
const lrcCache = new Map();
async function loadLyrics(t) {
  if (!t) return [];
  if (lrcCache.has(t.id)) return lrcCache.get(t.id);
  let lines = [];
  // main resolved the sidecar through the same media scheme; older builds fall back
  const guess = t.lrc || null;
  if (guess) {
    try {
      const res = await fetch(guess);
      if (res.ok) {
        const text = await res.text();
        lines = text
          .split(/\r?\n/)
          .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 40);
      }
    } catch {
      lines = [];
    }
  }
  lrcCache.set(t.id, lines);
  return lines;
}

async function renderLyrics() {
  const t = current();
  const body = $('#lyr-body');
  const head = $('#lyr-head-note');
  if (!body) return;
  if (!t) {
    body.innerHTML = '<div class="lyr-empty">No track loaded.</div>';
    if (head) head.textContent = '—';
    return;
  }
  const lines = await loadLyrics(t);
  if (!lines.length) {
    const base = String(t.file || '')
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, '');
    body.innerHTML = `<div class="lyr-empty">No lyrics file next to this track.<br />
      Save <b>${esc(base)}.lrc</b> beside the audio file and it will show up here, synced.</div>`;
    if (head) head.textContent = 'not found';
    return;
  }
  body.innerHTML = lines.map((l) => `<div class="lyr-line">${esc(l)}</div>`).join('');
  if (head) head.textContent = 'from .lrc';
  paintLyrics();
}

function paintLyrics() {
  const lines = $$('.lyr-line');
  if (!lines.length || !audio.duration) return;
  const p = clamp(audio.currentTime / audio.duration, 0, 1);
  const active = Math.min(lines.length - 1, Math.floor(p * lines.length));
  lines.forEach((l, i) => {
    l.classList.toggle('is-now', i === active);
    l.classList.toggle('is-past', i < active);
  });
}

/* ----------------------------------------------------------------- playback */
function paintPlaying() {
  const t = current();
  const key = t ? albumKey(t) : null;
  $$('.album').forEach((el) => {
    const active = !!key && el.dataset.key === key;
    el.classList.toggle('is-playing', active && document.body.classList.contains('is-playing'));
  });
  $$('.q-item').forEach((el, i) => el.classList.toggle('is-on', i === state.index));
}

function loadCurrent(autoplay = false) {
  const t = current();
  if (!t) return;
  state.streamTried = false;
  audio.src = t.url || '';
  audio.load();
  renderHome();
  if (autoplay) play();
}

function play() {
  audio
    .play()
    .then(() => {
      document.body.classList.add('is-playing');
      $('#btn-play').setAttribute('aria-label', 'Pause');
    })
    .catch(() => document.body.classList.remove('is-playing'));
}

function pause() {
  audio.pause();
  document.body.classList.remove('is-playing');
  $('#btn-play').setAttribute('aria-label', 'Play');
}

const isPlaying = () => document.body.classList.contains('is-playing') && !audio.paused;
const toggle = () => (isPlaying() ? pause() : play());

function playTrack(id) {
  const t = byId(id);
  if (!t) return;
  if (t.id !== current()?.id) noteSkip();
  if (!state.queue.includes(id)) state.queue.push(id);
  state.index = state.queue.indexOf(id);
  state.station = null;
  noteRecent(id);
  renderQueue();
  renderRecents();
  loadCurrent(true);
  go('home');
}

function noteRecent(id) {
  state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 12);
  api?.recEvent(id, 'play');
}

function noteSkip() {
  const t = current();
  if (!t) return;
  const d = audio.duration || t.duration || 0;
  const played = audio.currentTime || 0;
  // leaving a track before ~35% (or before 20s of a long one) counts as a skip
  if (state.skipGuard && d > 0 && played / d < 0.35 && played < 20) {
    api?.recEvent(t.id, 'skip');
    state.skipGuard = false;
  }
}

function next(auto = false) {
  if (!state.queue.length) return;
  if (!auto) noteSkip();
  if (state.shuffle) {
    let n = state.index;
    while (state.queue.length > 1 && n === state.index) n = Math.floor(Math.random() * state.queue.length);
    state.index = n;
  } else if (state.index + 1 < state.queue.length) {
    state.index += 1;
  } else if (state.station) {
    const last = state.queue[state.queue.length - 1];
    const more = continueStation(last);
    if (more.length) {
      state.queue.push(...more.map((t) => t.id));
      state.index += 1;
    } else if (state.repeat) state.index = 0;
    else return pause();
  } else if (state.repeat) {
    state.index = 0;
  } else if (auto) {
    return pause();
  } else {
    state.index = 0;
  }
  renderQueue();
  loadCurrent(true);
}

function prev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  noteSkip();
  if (!state.queue.length) return;
  state.index = state.index > 0 ? state.index - 1 : state.queue.length - 1;
  renderQueue();
  loadCurrent(true);
}

/* ------------------------------------------------------------- recommendations */
function historyWeights() {
  // recompute locally from what main has recorded (mirrored on each event)
  return state.history;
}

function buildShelves() {
  const tracks = state.tracks;
  const hist = historyWeights();
  const byArtist = new Map();
  tracks.forEach((t) => {
    const k = (t.albumArtist || t.artist).toLowerCase();
    if (!byArtist.has(k)) byArtist.set(k, []);
    byArtist.get(k).push(t);
  });

  const aff = (id) => {
    const h = hist[id];
    if (!h) return 0;
    const net = (h.plays || 0) + (h.completed || 0) * 1.5 - (h.skips || 0) * 2.2;
    const days = h.lastPlayed ? (Date.now() - h.lastPlayed) / 86400000 : 30;
    return net * (0.35 + 0.65 * Math.exp(-days / 21));
  };

  const onRepeat = tracks
    .map((t) => ({ t, a: aff(t.id) }))
    .filter((x) => x.a > 0)
    .sort((a, b) => b.a - a.a)
    .map((x) => x.t);

  const recentlyAdded = tracks.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const genres = new Map();
  tracks.forEach((t) =>
    String(t.genre || '')
      .split(/[;,/]/)
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean)
      .forEach((g) => {
        if (!genres.has(g)) genres.set(g, []);
        genres.get(g).push(t);
      })
  );

  // stations come from the biggest genre clusters, plus an all-library mix
  const stations = [];
  const topGenres = [...genres.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  topGenres.forEach(([g, list]) => {
    if (list.length >= 3) stations.push({ name: g.replace(/\b\w/g, (c) => c.toUpperCase()), sub: `${list.length} tracks`, genres: [g] });
  });
  if (!stations.length && tracks.length >= 3) stations.push({ name: 'Library mix', sub: 'Everything, shuffled', genres: [] });
  if (state.favourites.size >= 3)
    stations.push({ name: 'Favourites radio', sub: 'Built from ♥', genres: [], favourites: true });
  const topArtist = [...byArtist.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topArtist && topArtist[1].length >= 4)
    stations.push({ name: `More like ${topArtist[1][0].albumArtist || topArtist[1][0].artist}`, sub: `${topArtist[1].length} tracks`, seedArtist: topArtist[1][0].artist });

  return { onRepeat, recentlyAdded: recentlyAdded.slice(0, 12), stations: stations.slice(0, 6) };
}

function similarity(a, b) {
  let score = 0;
  let weight = 0;
  const gsplit = (t) =>
    String(t.genre || '')
      .split(/[;,/]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  weight += 3.2;
  const ga = new Set(gsplit(a));
  const gb = new Set(gsplit(b));
  if (ga.size && gb.size) {
    let inter = 0;
    ga.forEach((g) => {
      if (gb.has(g)) inter += 1;
      else if ([...gb].some((x) => x.includes(g) || g.includes(x))) inter += 0.6;
    });
    score += 3.2 * Math.min(1, inter / Math.max(ga.size, gb.size));
  }

  weight += 2.6;
  if (String(a.artist).toLowerCase() === String(b.artist).toLowerCase()) score += 2.6;
  else if (a.albumArtist && a.albumArtist === b.albumArtist) score += 0.8;

  weight += 1.1;
  if (String(a.album).toLowerCase() === String(b.album).toLowerCase()) score += 1.1;

  weight += 1.3;
  if (a.bpm && b.bpm) score += 1.3 * Math.max(0, 1 - Math.abs(a.bpm - b.bpm) / 40);

  weight += 0.9;
  const ya = parseInt(a.year, 10);
  const yb = parseInt(b.year, 10);
  if (ya && yb) score += 0.9 * Math.max(0, 1 - Math.abs(ya - yb) / 15);

  return weight ? score / weight : 0;
}

/** build the next batch for a running station */
function continueStation(lastId, count = 8) {
  const seed = byId(lastId) || current();
  if (!seed) return [];
  const inQueue = new Set(state.queue);
  const pool = state.tracks.filter((t) => !inQueue.has(t.id));
  const scored = pool
    .map((t) => ({ t, s: similarity(seed, t) * 4 + Math.random() * 0.4 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.t);
  return scored;
}

function startStation(s) {
  if (!state.tracks.length) return;
  let list;
  if (s.favourites) {
    const favs = state.tracks.filter((t) => state.favourites.has(t.id));
    const seed = favs[0];
    list = [seed, ...state.tracks.filter((t) => t.id !== seed.id).map((t) => ({ t, s: similarity(seed, t) })).sort((a, b) => b.s - a.s).map((x) => x.t)].filter(Boolean);
  } else if (s.seedArtist) {
    const seed = state.tracks.find((t) => t.artist === s.seedArtist);
    list = [seed, ...state.tracks.filter((t) => t.id !== seed.id).map((t) => ({ t, s: similarity(seed, t) })).sort((a, b) => b.s - a.s).map((x) => x.t)];
  } else if (s.genres && s.genres.length) {
    const g = s.genres[0];
    const inGenre = state.tracks.filter((t) => String(t.genre).toLowerCase().includes(g));
    const rest = state.tracks
      .filter((t) => !inGenre.includes(t))
      .map((t) => ({ t, s: similarity(inGenre[0] || t, t) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.t);
    list = [...inGenre.sort(() => Math.random() - 0.5), ...rest];
  } else {
    list = state.tracks.slice().sort(() => Math.random() - 0.5);
  }
  list = list.filter(Boolean).slice(0, 30);
  state.station = { name: s.name };
  state.queue = list.map((t) => t.id);
  state.index = 0;
  state.shuffle = false;
  renderQueue();
  loadCurrent(true);
  go('home');
}

/* --------------------------------------------------------------- radio view */
function renderStations() {
  const wrap = $('#stations');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.tracks.length) {
    wrap.innerHTML = '<div class="empty">Add music first — stations are built from your own library.</div>';
    return;
  }
  const shelves = buildShelves();
  shelves.stations.forEach((s) => {
    const el = document.createElement('button');
    el.className = 'card is-station';
    el.innerHTML = `<div class="card-art"><svg viewBox="0 0 20 20"><path d="M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2M2.8 2.8a10.2 10.2 0 0 0 0 14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4"/></svg></div>
      <div class="card-title">${esc(s.name)}</div><div class="card-sub">${esc(s.sub)}</div>`;
    el.addEventListener('click', () => startStation(s));
    wrap.appendChild(el);
  });
}

/* ------------------------------------------------------------- playlists view */
function renderPlaylists() {
  const wrap = $('#playlists');
  if (!wrap) return;
  wrap.innerHTML = '';
  const artists = new Map();
  state.tracks.forEach((t) => {
    const k = t.albumArtist || t.artist;
    if (!artists.has(k)) artists.set(k, []);
    artists.get(k).push(t);
  });
  if (!artists.size) {
    wrap.innerHTML = '<div class="empty">Artists appear here once your library has tracks.</div>';
  }
  [...artists.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 24)
    .forEach(([name, list]) => {
      const el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `<div class="card-art card-art--artist">${esc(initials(name))}</div>
        <div class="card-title">${esc(name)}</div>
        <div class="card-sub">${list.length} ${list.length === 1 ? 'track' : 'tracks'}</div>`;
      el.addEventListener('click', () => {
        state.queue = list.map((t) => t.id);
        state.index = 0;
        renderQueue();
        loadCurrent(true);
        go('home');
      });
      wrap.appendChild(el);
    });
}

/* --------------------------------------------------------- online catalogue */
function paintOnlineStatus() {
  const el = $('#online-status');
  if (!el) return;
  const st = state.online;
  if (!state.onlineEnabled) {
    el.dataset.state = 'offline';
    el.textContent = 'off';
    return;
  }
  if (st.loading) {
    el.dataset.state = 'idle';
    el.textContent = 'loading…';
    return;
  }
  if (st.error) {
    el.dataset.state = 'offline';
    el.textContent = st.cachedAt ? 'offline · cached' : 'offline';
    return;
  }
  el.dataset.state = 'online';
  el.textContent = 'connected';
}

function onlineCard(t) {
  const el = document.createElement('button');
  el.className = 'on-card';
  el.title = `${t.title} — ${t.artist}`;
  const mins = t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : '';
  el.innerHTML = `
    <div class="on-art">
      <img src="${esc(t.art || ART_FALLBACK)}" alt="" draggable="false" onerror="this.src='${ART_FALLBACK}'" />
      <span class="on-play"><svg viewBox="0 0 24 24"><path d="M8.6 5.2 18 12l-9.4 6.8z"/></svg></span>
    </div>
    <span class="on-title">${esc(t.title)}</span>
    <span class="on-sub">${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</span>
    <span class="on-meta">${[t.genre, mins, t.playCount ? fmtCount(t.playCount) + ' plays' : '']
      .filter(Boolean)
      .map((x) => `<span>${esc(x)}</span>`)
      .join('')}</span>`;
  el.addEventListener('click', () => {
    playList(state.online.tracks);
    const i = state.queue.indexOf(t.id);
    if (i >= 0) {
      state.index = i;
      renderQueue();
      loadCurrent(true);
    }
  });
  return el;
}

const fmtCount = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

function renderOnline() {
  const grid = $('#online-grid');
  if (!grid) return;
  paintOnlineStatus();
  grid.innerHTML = '';
  const st = state.online;

  if (!state.onlineEnabled) {
    grid.innerHTML = `<div class="on-error"><b>Online catalogue is switched off.</b><br />
      Turn it back on in Settings to stream from Audius.</div>`;
    return;
  }
  if (st.loading && !st.tracks.length) {
    for (let i = 0; i < 8; i++) {
      const sk = document.createElement('div');
      sk.className = 'on-skel';
      grid.appendChild(sk);
    }
    return;
  }
  if (st.error && !st.tracks.length) {
    grid.innerHTML = `<div class="on-error"><b>Can't reach the catalogue.</b><br />
      ${esc(st.error)}<br />Your local library keeps working while this is down.</div>`;
    return;
  }
  if (!st.tracks.length) {
    grid.innerHTML = `<div class="on-error"><b>Nothing came back for “${esc(st.genre)}”.</b><br />
      Try another genre or the search field.</div>`;
    return;
  }
  st.tracks.forEach((t) => grid.appendChild(onlineCard(t)));
}

async function loadOnline({ genre = state.online.genre, time = state.online.time, kind = state.online.kind } = {}) {
  state.online.genre = genre;
  state.online.time = time;
  state.online.kind = kind;
  if (!api || !api.audiusBrowse) {
    state.online.error = 'Online catalogue needs the desktop app.';
    renderOnline();
    return;
  }
  state.online.loading = true;
  state.online.error = null;
  renderOnline();
  const res = await api.audiusBrowse({ kind, genre, time, limit: 24 });
  state.online.loading = false;
  if (res && res.tracks && res.tracks.length) {
    registerRemote(res.tracks);
    state.online.tracks = res.tracks;
    state.online.cachedAt = res.cachedAt || null;
    state.online.error = res.ok ? null : res.error || 'offline';
  } else {
    state.online.tracks = [];
    state.online.error = res && res.error ? res.error : 'no tracks';
  }
  renderOnline();
}

async function runOnlineSearch(q) {
  const panel = $('#online-search');
  const list = $('#online-results');
  if (!panel || !list) return;
  if (!q) {
    panel.hidden = true;
    state.results = [];
    return;
  }
  panel.hidden = false;
  list.innerHTML = '<div class="on-error">Searching…</div>';
  const res = await api?.audiusSearch?.(q, 30);
  const tracks = (res && res.tracks) || [];
  state.results = tracks;
  registerRemote(tracks);
  $('#online-search-note').textContent = tracks.length ? `${tracks.length} tracks for “${q}”` : 'nothing found';
  list.innerHTML = '';
  if (!tracks.length) {
    list.innerHTML = `<div class="on-error">${res && res.error ? esc(res.error) : `No tracks for “${esc(q)}” on Audius.`}</div>`;
    return;
  }
  tracks.forEach((t, i) => list.appendChild(trackRow(t, i)));
}

/* ------------------------------------------------------------------- views */
function go(view) {
  state.view = view;
  document.body.dataset.view = view;
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  $$('.nav').forEach((n) => n.classList.toggle('is-active', n.dataset.view === view));
  if (view === 'library') {
    renderLibrary();
    renderRecents();
  }
  if (view === 'online') {
    renderOnline();
    if (!state.online.tracks.length && !state.online.loading) loadOnline();
  }
  if (view === 'radio') renderStations();
  if (view === 'playlists') renderPlaylists();
  if (view === 'home') renderShelves();
}
$$('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

/* ------------------------------------------------------------ library actions */
async function chooseFolder() {
  if (!api) return alert('Folder picker is available in the desktop app.');
  const res = await api.chooseFolder();
  if (res.canceled) return;
  await scanLibrary();
}

async function scanLibrary() {
  if (!api) return;
  if (state.scanning) return;
  state.scanning = true;
  const banner = $('#scan-banner');
  banner?.classList.add('is-on');
  if (banner) banner.textContent = 'Scanning…';
  const snap = await api.scan();
  banner?.classList.remove('is-on');
  state.scanning = false;
  if (snap) applyLibrary(snap);
}

function applyLibrary(snap) {
  state.tracks = (snap.tracks || []).map((t) => ({ ...t }));
  state.folders = snap.folders || [];
  if (!state.queue.length && state.tracks.length) {
    state.queue = state.tracks.map((t) => t.id);
    state.index = 0;
  }
  state.queue = state.queue.filter((id) => state.tracks.some((t) => t.id === id));
  if (state.index >= state.queue.length) state.index = 0;
  renderLibrary();
  renderShelves();
  renderStations();
  renderPlaylists();
  renderQueue();
  renderRecents();
  updateStats();
}

async function loadDemo() {
  // the demo WAVs ship inside the app; they behave exactly like scanned tracks
  const banner = $('#scan-banner');
  banner?.classList.add('is-on');
  if (banner) banner.textContent = 'Loading demo tracks…';
  let manifest = [];
  try {
    const res = await fetch('assets/tracks/manifest.json');
    manifest = await res.json();
  } catch {
    manifest = [];
  }
  banner?.classList.remove('is-on');
  state.tracks = manifest.map((m, i) => ({
    id: 'demo-' + m.id,
    file: m.file,
    url: m.file || 'assets/tracks/' + m.id + '.wav',
    art: m.cover || 'assets/covers/' + m.id + '.png',
    title: m.title,
    artist: m.artist || 'ByAzen',
    album: m.album || m.title,
    albumArtist: m.artist || 'ByAzen',
    genre: m.genre || '',
    year: String(m.year || ''),
    bpm: m.bpm,
    trackNo: m.trackNo || i + 1,
    format: 'WAV',
    rate: 44100,
    bits: 16,
    duration: m.duration,
    addedAt: Date.now() - i * 86400000,
    demo: true,
  }));
  if (!state.tracks.length) {
    const b = document.getElementById('scan-banner');
    if (b) {
      b.textContent = 'Demo tracks unavailable';
      b.classList.add('is-on');
      setTimeout(() => b.classList.remove('is-on'), 2200);
    }
    return;
  }
  state.recents = [];
  state.queue = state.tracks.map((t) => t.id);
  state.index = 0;
  applyLibrary({ tracks: state.tracks, folders: [] });
  loadCurrent(false);
  go('home');
}

/* ---------------------------------------------------------------- scrubbing */
function makeScrubber(bar, onChange) {
  let dragging = false;
  const ratio = (e) => {
    const r = bar.getBoundingClientRect();
    return r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0;
  };
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.classList.add('is-drag');
    bar.setPointerCapture?.(e.pointerId);
    onChange(ratio(e), false);
  });
  bar.addEventListener('pointermove', (e) => dragging && onChange(ratio(e), false));
  bar.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-drag');
    try {
      bar.releasePointerCapture?.(e.pointerId);
    } catch {
      /* released */
    }
    onChange(ratio(e), true);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = audio.duration || 0;
      audio.currentTime = clamp(audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5), 0, d);
      onChange(d ? audio.currentTime / d : 0, true);
    }
  });
}

makeScrubber($('#seek'), (p, commit) => {
  const d = audio.duration || current()?.duration || 0;
  if (commit && d) audio.currentTime = p * d;
  $('#seek-fill').style.width = `${p * 100}%`;
  $('#seek-knob').style.left = `${p * 100}%`;
  $('#t-cur').textContent = fmt(p * d);
});

makeScrubber($('#vol'), (p, commit) => {
  state.volume = clamp(p, 0, 1);
  audio.volume = state.volume;
  audio.muted = false;
  state.muted = false;
  $('#vol-fill').style.width = `${state.volume * 100}%`;
  $('#vol-val').textContent = String(Math.round(state.volume * 100));
  if (commit) api?.setPrefs({ volume: state.volume });
});

/* ------------------------------------------------------------------ buttons */
$('#btn-play').addEventListener('click', toggle);
$('#btn-play2').addEventListener('click', toggle);
$('#btn-prev').addEventListener('click', prev);
$('#btn-next').addEventListener('click', () => next(false));
$('#btn-shuffle').addEventListener('click', (e) => {
  state.shuffle = !state.shuffle;
  e.currentTarget.classList.toggle('is-on', state.shuffle);
});
$('#btn-repeat').addEventListener('click', (e) => {
  state.repeat = !state.repeat;
  e.currentTarget.classList.toggle('is-on', state.repeat);
});
$('#btn-mute-all').addEventListener('click', (e) => {
  state.muted = !state.muted;
  audio.muted = state.muted;
  e.currentTarget.classList.toggle('is-on', state.muted);
});
$('#btn-fav').addEventListener('click', (e) => {
  const t = current();
  if (!t) return;
  if (state.favourites.has(t.id)) state.favourites.delete(t.id);
  else state.favourites.add(t.id);
  e.currentTarget.classList.toggle('is-on', state.favourites.has(t.id));
  api?.setPrefs({ favourites: [...state.favourites] });
});
$('#q-clear').addEventListener('click', () => {
  const t = current();
  state.queue = t ? [t.id] : [];
  state.index = 0;
  state.station = null;
  renderQueue();
});
$('#btn-add-folder')?.addEventListener('click', chooseFolder);
$('#btn-rescan')?.addEventListener('click', scanLibrary);
$('#btn-add-folder-2')?.addEventListener('click', chooseFolder);
$('#btn-rescan-2')?.addEventListener('click', scanLibrary);
$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.chip').forEach((c) => c.classList.toggle('is-on', c === chip));
  state.filter = chip.dataset.filter;
  renderLibrary();
});
$('#search-lib').addEventListener('input', renderLibrary);
let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (!q) {
    if ($('#online-search')) $('#online-search').hidden = true;
    return;
  }
  if (!state.onlineEnabled) return;
  searchTimer = setTimeout(() => {
    go('online');
    runOnlineSearch(q);
  }, 320);
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q && state.onlineEnabled) {
      clearTimeout(searchTimer);
      go('online');
      runOnlineSearch(q);
    }
  }
});

/* ------------------------------------------------------- online controls */
const onlineChips = $('#online-chips');
if (onlineChips) {
  const GENRES = ['All', 'Electronic', 'Hip-Hop/Rap', 'Pop', 'R&B/Soul', 'Rock', 'Lo-Fi', 'House', 'Techno', 'Ambient', 'Jazz', 'Classical', 'Downtempo'];
  GENRES.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'chip' + (g === 'All' ? ' is-on' : '');
    b.dataset.genre = g;
    b.textContent = g === 'Hip-Hop/Rap' ? 'Hip-Hop' : g === 'R&B/Soul' ? 'R&B' : g;
    onlineChips.appendChild(b);
  });
  onlineChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    Array.from(onlineChips.children).forEach((c) => c.classList.toggle('is-on', c === chip));
    loadOnline({ genre: chip.dataset.genre, kind: 'trending' });
  });
}

$('#online-time')?.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  $$('#online-time .seg-btn').forEach((x) => x.classList.toggle('is-on', x === b));
  loadOnline({ time: b.dataset.time, kind: 'trending' });
});
$('#btn-online-underground')?.addEventListener('click', (e) => {
  const on = state.online.kind !== 'underground';
  e.currentTarget.classList.toggle('is-on', on);
  loadOnline({ kind: on ? 'underground' : 'trending' });
});
$('#btn-online-refresh')?.addEventListener('click', () => {
  state.online.tracks = [];
  loadOnline();
});
$('#online-search-close')?.addEventListener('click', () => {
  $('#online-search').hidden = true;
  $('#search').value = '';
  state.results = [];
});
$('#set-online')?.addEventListener('change', (e) => {
  state.onlineEnabled = e.target.checked;
  api?.setPrefs({ onlineCatalogue: state.onlineEnabled });
  renderOnline();
  if (state.onlineEnabled && !state.online.tracks.length) loadOnline();
});

/* drag and drop folders onto the window */
['dragenter', 'dragover'].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    document.body.classList.add('is-dragging');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop') handleDrop(e);
    document.body.classList.remove('is-dragging');
  })
);

async function importPaths(paths) {
  if (!api || !paths.length) return;
  const folders = await api.droppedFolders(paths);
  if (!folders.length) return;
  await api.addFolders(folders);
  await scanLibrary();
}

/** native Electron drops: preload resolves real paths and pings us */
window.addEventListener('byazen:drop', () => {
  const paths = api && api.takeDroppedPaths ? api.takeDroppedPaths() : [];
  if (paths && paths.length) importPaths(paths);
});

async function handleDrop(e) {
  if (!api) return;
  // older Electron still exposes File.path; fall back to it when present
  const dropped = Array.from(e.dataTransfer?.files || [])
    .map((f) => f.path)
    .filter(Boolean);
  if (dropped.length) await importPaths(dropped);
}

/* audio events */
audio.addEventListener('loadedmetadata', () => {
  $('#t-dur').textContent = fmt(audio.duration);
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || current()?.duration || 0;
  const p = d ? audio.currentTime / d : 0;
  $('#seek-fill').style.width = `${p * 100}%`;
  $('#seek-knob').style.left = `${p * 100}%`;
  $('#t-cur').textContent = fmt(audio.currentTime);
  $('#mini-fill').style.width = `${p * 100}%`;
  $('#bar-fill').style.width = `${p * 100}%`;
  $('#bar-time').textContent = fmt(Math.max(0, d - audio.currentTime));
  paintLyrics();
  // count a skip if the track is abandoned early
  if (state.skipGuard && p > 0.92) {
    api?.recEvent(current()?.id, 'complete');
    state.skipGuard = false;
  }
});
audio.addEventListener('play', () => {
  document.body.classList.add('is-playing');
  state.wasPlaying = true;
  state.skipGuard = true;
  paintPlaying();
});
audio.addEventListener('pause', () => document.body.classList.remove('is-playing'));
audio.addEventListener('error', () => {
  document.body.classList.remove('is-playing');
  const t = current();
  const el = $('#np-artist');
  if (isRemote(t) && !state.streamTried) {
    // a signed content-node URL can expire mid-session: fall back to the proxy
    state.streamTried = true;
    if (el) el.textContent = 'Reconnecting to the catalogue…';
    audio.src = t.url;
    audio.load();
    if (document.body.classList.contains('is-playing') || state.wasPlaying) play();
    return;
  }
  if (el && t) el.textContent = isRemote(t) ? 'Track unavailable — it may have been removed' : 'Could not read this file (codec not supported)';
});
audio.addEventListener('ended', () => next(true));

/* hotkeys */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (typing) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  const bump = (dv) => {
    state.volume = clamp(state.volume + dv, 0, 1);
    audio.volume = state.volume;
    $('#vol-fill').style.width = `${state.volume * 100}%`;
    $('#vol-val').textContent = String(Math.round(state.volume * 100));
  };
  switch (e.key) {
    case ' ':
      e.preventDefault();
      toggle();
      break;
    case 'ArrowRight':
      next(false);
      break;
    case 'ArrowLeft':
      prev();
      break;
    case 'ArrowUp':
      e.preventDefault();
      bump(0.05);
      break;
    case 'ArrowDown':
      e.preventDefault();
      bump(-0.05);
      break;
    case '/':
      e.preventDefault();
      go('home');
      $('#search').focus();
      break;
    default:
      if (e.key.toLowerCase() === 's') state.shuffle = !state.shuffle, $('#btn-shuffle').classList.toggle('is-on', state.shuffle);
      if (e.key.toLowerCase() === 'r') state.repeat = !state.repeat, $('#btn-repeat').classList.toggle('is-on', state.repeat);
      if (e.key.toLowerCase() === 'm') {
        state.muted = !state.muted;
        audio.muted = state.muted;
        $('#btn-mute-all').classList.toggle('is-on', state.muted);
      }
  }
});

/* prefs */
async function loadPrefs() {
  if (!api) return;
  const p = await api.prefs();
  if (p.volume != null) {
    state.volume = p.volume;
    audio.volume = p.volume;
  }
  if (Array.isArray(p.favourites)) state.favourites = new Set(p.favourites);
  if (p.history) state.history = p.history;
  $('#vol-fill').style.width = `${state.volume * 100}%`;
  $('#vol-val').textContent = String(Math.round(state.volume * 100));
  if (p.onlineCatalogue === false) {
    state.onlineEnabled = false;
    const cb = $('#set-online');
    if (cb) cb.checked = false;
  }
  if (p.reducedMotion) {
    state.reducedMotion = true;
    document.body.classList.add('reduce-motion');
  }
}

/* -------------------------------------------------------------------- boot */
(async function boot() {
  $('#vol-fill').style.width = `${state.volume * 100}%`;
  $('#vol-val').textContent = String(Math.round(state.volume * 100));
  await loadPrefs();
  let initial = null;
  if (api) {
    try {
      initial = await api.libraryState();
    } catch {
      initial = null;
    }
  }
  if (initial && initial.tracks && initial.tracks.length) {
    applyLibrary(initial);
    state.queue = state.tracks.map((t) => t.id);
    state.index = 0;
  }
  try {
    state.history = (api && (await api.history())) || state.history || {};
  } catch {
    state.history = state.history || {};
  }
  go('home');
  renderHome();
  renderQueue();
  renderRecents();
  renderLibrary();
  if (state.tracks.length) loadCurrent(false);
  // refresh the index quietly in the background
  if (api && state.onlineEnabled && !state.online.tracks.length) loadOnline().catch(() => {});
  if (api && state.tracks.length) {
    api.refresh().then((snap) => {
      if (snap && snap.changed) applyLibrary(snap);
    });
  }
})();

/* expose a tiny hook for the smoke test */
window.__byazen = {
  state,
  applyLibrary,
  loadDemo,
  playTrack,
  next,
  go,
  buildShelves,
  renderLibrary,
  renderHome,
  loadOnline,
  renderOnline,
  runOnlineSearch,
  registerRemote,
};
