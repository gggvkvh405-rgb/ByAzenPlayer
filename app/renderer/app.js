/* ByAzen — renderer logic.  No frameworks, no network: everything ships in the app. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ library */
/** @type {{id:string,title:string,artist:string,album:string,file:string,cover:string,duration:number,bpm:number,lyrics:string[]}[]} */
const LIBRARY = [
  {
    id: 'aurora-lines',
    title: 'Aurora Lines',
    artist: 'Kael Rivers',
    album: 'Northern Light',
    file: 'assets/tracks/aurora-lines.wav',
    cover: 'assets/covers/aurora-lines.png',
    duration: 25.3,
    bpm: 84,
    lyrics: [
      'We drift through aurora lines,',
      'a slow and golden thread —',
      'the night folds into morning',
      'and nothing needs to be said.',
    ],
  },
  {
    id: 'paper-moons',
    title: 'Paper Moons',
    artist: 'Nils Åberg',
    album: 'Paper Moons',
    file: 'assets/tracks/paper-moons.wav',
    cover: 'assets/covers/paper-moons.png',
    duration: 23.3,
    bpm: 92,
    lyrics: [
      'Paper moons above the harbour,',
      'cut from letters never sent —',
      'we hang them in the window',
      'and call it an event.',
    ],
  },
  {
    id: 'low-tide',
    title: 'Low Tide',
    artist: 'Mira Voss',
    album: 'Low Tide',
    file: 'assets/tracks/low-tide.wav',
    cover: 'assets/covers/low-tide.png',
    duration: 27.7,
    bpm: 76,
    lyrics: [
      'Low tide, and the stones come out',
      'to breathe a little light —',
      'I keep the long way home',
      'and walk it every night.',
    ],
  },
  {
    id: 'felt-piano',
    title: 'Felt Piano',
    artist: 'Aster Quartet',
    album: 'Quiet Rooms',
    file: 'assets/tracks/felt-piano.wav',
    cover: 'assets/covers/felt-piano.png',
    duration: 30.6,
    bpm: 68,
    lyrics: [
      'A felt piano in an empty room',
      'keeps time with nothing at all —',
      'the dust turns over slowly',
      'and the walls lean in to hear.',
    ],
  },
  {
    id: 'northbound',
    title: 'Northbound',
    artist: 'Kael Rivers',
    album: 'Northern Light',
    file: 'assets/tracks/northbound.wav',
    cover: 'assets/covers/northbound.png',
    duration: 24.2,
    bpm: 88,
    lyrics: [
      'Northbound with the windows down,',
      'the pines a running chord —',
      'I left the map at home',
      'and let the cold record.',
    ],
  },
  {
    id: 'slow-light',
    title: 'Slow Light',
    artist: 'Sable & Co.',
    album: 'Slow Light',
    file: 'assets/tracks/slow-light.wav',
    cover: 'assets/covers/slow-light.png',
    duration: 29.1,
    bpm: 72,
    lyrics: [
      'Slow light on the kitchen floor,',
      'a whole hour going gold —',
      'we are not in a hurry,',
      'we are, for once, not told.',
    ],
  },
  {
    id: 'harbour',
    title: 'Harbour',
    artist: 'Ines Roux',
    album: 'Harbour',
    file: 'assets/tracks/harbour.wav',
    cover: 'assets/covers/harbour.png',
    duration: 26.4,
    bpm: 80,
    lyrics: [
      'The harbour keeps a low sound',
      'like hands along a wall —',
      'the boats nod in the evening',
      'and the gulls forgive it all.',
    ],
  },
  {
    id: 'wildflower',
    title: 'Wildflower',
    artist: 'June Alba',
    album: 'Wildflower',
    file: 'assets/tracks/wildflower.wav',
    cover: 'assets/covers/wildflower.png',
    duration: 22.4,
    bpm: 96,
    lyrics: [
      'Wildflower by the road sign,',
      'nobody planted you —',
      'you took the worst of the weather',
      'and made it something new.',
    ],
  },
];

const PLAYLISTS = [
  { name: 'Aurora Sessions', tracks: ['aurora-lines', 'northbound', 'slow-light', 'harbour'] },
  { name: 'Slow Mornings', tracks: ['felt-piano', 'low-tide', 'harbour', 'slow-light'] },
  { name: 'Deep Focus', tracks: ['low-tide', 'felt-piano', 'slow-light', 'aurora-lines'] },
  { name: 'Golden Hour', tracks: ['paper-moons', 'wildflower', 'harbour'] },
];

const STATIONS = [
  { name: 'ByAzen Radio', desc: 'Everything, gently shuffled' },
  { name: 'Terracotta', desc: 'Warm keys & slow tempos' },
  { name: 'Sage', desc: 'Quiet, green, unhurried' },
  { name: 'Night Bus', desc: 'Late, low and a little blue' },
];

const byId = (id) => LIBRARY.find((t) => t.id === id);

/* ------------------------------------------------------------------- state */
const state = {
  queue: LIBRARY.map((t) => t.id),
  index: 0,
  view: 'home',
  shuffle: false,
  repeat: false,
  crossfade: true,
  reducedMotion: false,
  volume: 0.72,
  muted: false,
  favourites: new Set(['aurora-lines']),
  filter: 'all',
  recents: [],
};

const audio = $('#audio');
audio.volume = state.volume;

const current = () => byId(state.queue[state.index]) || LIBRARY[0];

/* -------------------------------------------------------------------- utils */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* -------------------------------------------------------------- window chrome */
if (window.byazen) {
  if (window.byazen.platform === 'darwin') document.body.classList.add('is-mac');
  $('#btn-min')?.addEventListener('click', () => window.byazen.minimize());
  $('#btn-max')?.addEventListener('click', () => window.byazen.toggleMaximize());
  $('#btn-close')?.addEventListener('click', () => window.byazen.close());
  window.byazen.onWindowState?.(({ maximized }) => {
    const svg = maximized
      ? '<path d="M3.4 4.6h5.8M3.4 4.6v5.8M8.6 7.4h5.8M8.6 7.4v5.8"/>'
      : '';
    const btn = $('#btn-max svg');
    if (btn) btn.innerHTML = svg || '<rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.4"/>';
  });
  window.byazen.info().then((info) => {
    const el = $('#app-meta');
    if (el) {
      el.textContent = `ByAzen ${info.version} · Electron ${info.electron} · ${info.platform}`;
    }
  });
  // double-click the titlebar background to maximise (native behaviour for frameless)
  $('#titlebar')?.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.win-btn')) window.byazen.toggleMaximize();
  });
}

/* ---------------------------------------------------------------- rendering */
function albumCard(track) {
  const el = document.createElement('div');
  el.className = 'album';
  el.dataset.id = track.id;
  el.innerHTML = `
    <div class="album-art">
      <img src="${track.cover}" alt="" draggable="false" />
      <span class="badge-playing">PLAYING</span>
      <button class="album-play" title="Play ${track.title}" aria-label="Play ${track.title}">
        <svg viewBox="0 0 24 24"><path d="M8.6 5.2 18 12l-9.4 6.8z"/></svg>
      </button>
    </div>
    <div class="album-name">${track.title}</div>
    <div class="album-sub">${track.artist} · ${track.album}</div>`;
  el.addEventListener('click', () => playTrack(track.id));
  el.querySelector('.album-play').addEventListener('click', (e) => {
    e.stopPropagation();
    playTrack(track.id);
  });
  return el;
}

function renderLibrary() {
  const grid = $('#grid');
  const q = ($('#search-lib').value || '').trim().toLowerCase();
  grid.innerHTML = '';
  const list = LIBRARY.filter((t) => {
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
    );
  });
  if (!list.length) {
    grid.innerHTML = '<div class="empty">Nothing matches that search.</div>';
  }
  list.forEach((t) => grid.appendChild(albumCard(t)));
  $('#lib-count').textContent = `${LIBRARY.length} albums · ${LIBRARY.length} tracks`;
  $('#st-albums').textContent = LIBRARY.length;
  $('#st-artists').textContent = new Set(LIBRARY.map((t) => t.artist)).size;
  const mins = LIBRARY.reduce((s, t) => s + t.duration, 0) / 60;
  $('#st-min').textContent = mins.toFixed(1);
  paintPlaying();
}

function renderQueue() {
  const wrap = $('#queue');
  wrap.innerHTML = '';
  const order = state.queue.map((id) => byId(id)).filter(Boolean);
  order.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'q-item' + (i === state.index ? ' is-on' : '');
    b.innerHTML = `
      <img class="q-art" src="${t.cover}" alt="" draggable="false" />
      <span class="q-meta">
        <span class="q-title">${t.title}</span>
        <span class="q-artist">${t.artist}</span>
      </span>
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
  wrap.innerHTML = '';
  const list = (state.recents.length ? state.recents : LIBRARY.map((t) => t.id)).slice(0, 7);
  list.forEach((id, i) => {
    const t = byId(id);
    if (!t) return;
    const b = document.createElement('button');
    b.className = 'rec' + (i === 0 && !state.recents.length ? ' is-on' : '');
    b.innerHTML = `
      <img src="${t.cover}" alt="" draggable="false" />
      <span>
        <span class="rec-t">${t.title}</span>
        <span class="rec-s">${t.artist}</span>
      </span>
      <span class="rec-d">${fmt(t.duration)}</span>`;
    b.addEventListener('click', () => playTrack(t.id));
    wrap.appendChild(b);
  });
}

function renderPlaylists() {
  const side = $('#playlist-list');
  side.innerHTML = '';
  PLAYLISTS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'pl' + (i === 0 ? ' is-on' : '');
    b.innerHTML = `<i></i><span>${p.name}</span><em>${p.tracks.length}</em>`;
    b.addEventListener('click', () => {
      state.queue = p.tracks.slice();
      state.index = 0;
      state.shuffle = false;
      renderQueue();
      loadCurrent(true);
      go('home');
    });
    side.appendChild(b);
  });

  const cards = $('#playlists');
  cards.innerHTML = '';
  PLAYLISTS.forEach((p) => {
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-rows">
        ${p.tracks
          .slice(0, 4)
          .map((id) => `<img src="${byId(id).cover}" alt="" draggable="false" />`)
          .join('')}
      </div>
      <div class="card-title">${p.name}</div>
      <div class="card-sub">${p.tracks.length} tracks · ${(
        p.tracks.reduce((s, id) => s + byId(id).duration, 0) / 60
      ).toFixed(1)} min</div>`;
    el.addEventListener('click', () => {
      state.queue = p.tracks.slice();
      state.index = 0;
      renderQueue();
      loadCurrent(true);
      go('home');
    });
    cards.appendChild(el);
  });
}

function renderStations() {
  const wrap = $('#stations');
  wrap.innerHTML = '';
  STATIONS.forEach((s, i) => {
    const el = document.createElement('button');
    el.className = 'card is-station';
    el.innerHTML = `
      <div class="card-art">
        <svg viewBox="0 0 20 20"><path d="M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2M2.8 2.8a10.2 10.2 0 0 0 0 14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4"/></svg>
      </div>
      <div class="card-title">${s.name}</div>
      <div class="card-sub">${s.desc}</div>`;
    el.addEventListener('click', () => {
      const ids = LIBRARY.map((t) => t.id).sort(() => Math.random() - 0.5);
      state.queue = ids;
      state.index = 0;
      state.shuffle = true;
      renderQueue();
      loadCurrent(true);
      go('home');
    });
    wrap.appendChild(el);
  });
}

function renderLyrics() {
  const t = current();
  const body = $('#lyr-body');
  body.innerHTML = '';
  (t.lyrics || []).forEach((line, i) => {
    const d = document.createElement('div');
    d.className = 'lyr-line';
    d.dataset.i = String(i);
    d.textContent = line;
    body.appendChild(d);
  });
  paintLyrics();
}

function paintLyrics() {
  const lines = $$('.lyr-line');
  if (!lines.length) return;
  const t = current();
  const dur = audio.duration || t.duration;
  const p = dur ? clamp(audio.currentTime / dur, 0, 1) : 0;
  const active = Math.min(lines.length - 1, Math.floor(p * lines.length));
  lines.forEach((l, i) => {
    l.classList.toggle('is-now', i === active);
    l.classList.toggle('is-past', i < active);
  });
}

function paintPlaying() {
  const t = current();
  $$('.album').forEach((el) => {
    el.classList.toggle('is-playing', el.dataset.id === t.id);
  });
  $$('.q-item').forEach((el, i) => el.classList.toggle('is-on', i === state.index));
  $$('.rec').forEach((el) => el.classList.remove('is-on'));
}

function paintAll() {
  const t = current();
  $('#np-art').src = t.cover;
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = `${t.artist} · ${t.album}`;
  $('#np-art').style.backgroundImage = `url("${t.cover}")`;
  document.documentElement.style.setProperty('--glow', `url("${t.cover}")`);
  $('#bar-art').src = t.cover;
  $('#bar-title').textContent = t.title;
  $('#bar-sub').textContent = t.artist;
  $('#mini-title').textContent = t.title;
  $('#mini-sub').textContent = `${t.artist} · WAV 24/48`;
  $('#t-dur').textContent = fmt(t.duration);
  document.title = `${t.title} — ByAzen`;
  $('#btn-fav').classList.toggle('is-on', state.favourites.has(t.id));
  paintPlaying();
  renderLyrics();
}

/* ---------------------------------------------------------------- playback */
function loadCurrent(autoplay = false) {
  const t = current();
  audio.src = t.file;
  audio.load();
  paintAll();
  if (autoplay) play();
}

function play() {
  audio
    .play()
    .then(() => {
      document.body.classList.add('is-playing');
      $('#btn-play').setAttribute('aria-label', 'Pause');
    })
    .catch(() => {
      document.body.classList.remove('is-playing');
    });
}

function pause() {
  audio.pause();
  document.body.classList.remove('is-playing');
  $('#btn-play').setAttribute('aria-label', 'Play');
}

function toggle() {
  if (audio.paused) play();
  else pause();
}

function playTrack(id) {
  const t = byId(id);
  if (!t) return;
  if (!state.queue.includes(id)) state.queue.push(id);
  state.index = state.queue.indexOf(id);
  state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 7);
  renderQueue();
  renderRecents();
  loadCurrent(true);
  go('home');
}

function next(auto = false) {
  if (state.shuffle) {
    let n = state.index;
    while (state.queue.length > 1 && n === state.index) {
      n = Math.floor(Math.random() * state.queue.length);
    }
    state.index = n;
  } else if (state.index + 1 < state.queue.length) {
    state.index += 1;
  } else if (state.repeat || auto) {
    state.index = 0;
  } else {
    pause();
    return;
  }
  loadCurrent(true);
}

function prev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  state.index = state.index > 0 ? state.index - 1 : state.queue.length - 1;
  loadCurrent(true);
}

audio.addEventListener('loadedmetadata', () => {
  $('#t-dur').textContent = fmt(audio.duration);
  $('#seek').setAttribute('aria-valuemax', '100');
});

audio.addEventListener('timeupdate', () => {
  const d = audio.duration || current().duration;
  const p = d ? audio.currentTime / d : 0;
  $('#seek-fill').style.width = `${p * 100}%`;
  $('#seek-knob').style.left = `${p * 100}%`;
  $('#t-cur').textContent = fmt(audio.currentTime);
  $('#mini-fill').style.width = `${p * 100}%`;
  $('#bar-fill').style.width = `${p * 100}%`;
  $('#bar-time').textContent = fmt(Math.max(0, d - audio.currentTime));
  $('#seek').setAttribute('aria-valuenow', String(Math.round(p * 100)));
  paintLyrics();
});

audio.addEventListener('play', () => {
  document.body.classList.add('is-playing');
  paintPlaying();
});
audio.addEventListener('pause', () => document.body.classList.remove('is-playing'));
audio.addEventListener('ended', () => next(true));

/* seek interaction */
function makeScrubber(bar, onChange, hoverOnly) {
  let dragging = false;
  const apply = (e) => {
    const r = bar.getBoundingClientRect();
    if (!r.width) return;
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    onChange(p, dragging);
  };
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.classList.add('is-drag');
    bar.setPointerCapture(e.pointerId);
    apply(e);
  });
  bar.addEventListener('pointermove', (e) => {
    if (dragging) apply(e);
  });
  bar.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-drag');
    try {
      bar.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    const r = bar.getBoundingClientRect();
    if (r.width) onChange(clamp((e.clientX - r.left) / r.width, 0, 1), true);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') onChange(-1, true);
    if (e.key === 'ArrowLeft') onChange(-2, true);
  });
}

makeScrubber(
  $('#seek'),
  (p, commit) => {
    if (p === -1) return void (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5));
    if (p === -2) return void (audio.currentTime = Math.max(0, audio.currentTime - 5));
    const d = audio.duration || current().duration;
    if (commit) audio.currentTime = p * d;
    $('#seek-fill').style.width = `${p * 100}%`;
    $('#seek-knob').style.left = `${p * 100}%`;
    $('#t-cur').textContent = fmt(p * d);
  }
);

makeScrubber($('#vol'), (p) => {
  state.volume = clamp(p, 0, 1);
  audio.volume = state.muted ? 0 : state.volume;
  audio.muted = false;
  state.muted = false;
  $('#vol-fill').style.width = `${state.volume * 100}%`;
  $('#vol-val').textContent = String(Math.round(state.volume * 100));
  $('#vol').setAttribute('aria-valuenow', String(Math.round(state.volume * 100)));
});

/* ------------------------------------------------------------------ controls */
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
  const id = current().id;
  if (state.favourites.has(id)) state.favourites.delete(id);
  else state.favourites.add(id);
  e.currentTarget.classList.toggle('is-on', state.favourites.has(id));
});
$('#q-clear').addEventListener('click', () => {
  state.queue = [current().id];
  state.index = 0;
  renderQueue();
});

/* ---------------------------------------------------------------- navigation */
function go(view) {
  state.view = view;
  document.body.dataset.view = view;
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  $$('.nav').forEach((n) => n.classList.toggle('is-active', n.dataset.view === view));
  if (view === 'library') {
    renderLibrary();
    renderRecents();
  }
}
$$('.nav').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.view)));

/* search */
$('#search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = LIBRARY.find(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
  );
  if (hit) {
    go('library');
    $('#search-lib').value = e.target.value;
    renderLibrary();
  }
});
$('#search-lib').addEventListener('input', renderLibrary);

$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.chip').forEach((c) => c.classList.toggle('is-on', c === chip));
  state.filter = chip.dataset.filter;
  renderLibrary();
});

/* settings */
$('#set-crossfade').addEventListener('change', (e) => (state.crossfade = e.target.checked));
$('#set-repeat').addEventListener('change', (e) => {
  state.repeat = e.target.checked;
  $('#btn-repeat').classList.toggle('is-on', state.repeat);
});
$('#set-motion').addEventListener('change', (e) => {
  state.reducedMotion = e.target.checked;
  document.body.classList.toggle('reduce-motion', state.reducedMotion);
});

$('#new-playlist').addEventListener('click', () => {
  PLAYLISTS.push({
    name: `New playlist ${PLAYLISTS.length + 1}`,
    tracks: LIBRARY.slice(0, 3).map((t) => t.id),
  });
  renderPlaylists();
  go('playlists');
});

/* ------------------------------------------------------------------ hotkeys */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (typing) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
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
      state.volume = clamp(state.volume + 0.05, 0, 1);
      audio.volume = state.volume;
      $('#vol-fill').style.width = `${state.volume * 100}%`;
      $('#vol-val').textContent = String(Math.round(state.volume * 100));
      break;
    case 'ArrowDown':
      e.preventDefault();
      state.volume = clamp(state.volume - 0.05, 0, 1);
      audio.volume = state.volume;
      $('#vol-fill').style.width = `${state.volume * 100}%`;
      $('#vol-val').textContent = String(Math.round(state.volume * 100));
      break;
    case 's':
    case 'S':
      state.shuffle = !state.shuffle;
      $('#btn-shuffle').classList.toggle('is-on', state.shuffle);
      break;
    case 'r':
    case 'R':
      state.repeat = !state.repeat;
      $('#btn-repeat').classList.toggle('is-on', state.repeat);
      break;
    case 'm':
    case 'M':
      state.muted = !state.muted;
      audio.muted = state.muted;
      $('#btn-mute-all').classList.toggle('is-on', state.muted);
      break;
    case '/':
      e.preventDefault();
      go('home');
      $('#search').focus();
      break;
    default:
      break;
  }
});

/* -------------------------------------------------------------------- boot */
(function boot() {
  renderQueue();
  renderRecents();
  renderLibrary();
  renderPlaylists();
  renderStations();
  $('#vol-fill').style.width = `${state.volume * 100}%`;
  $('#vol-val').textContent = String(Math.round(state.volume * 100));
  $('#st-artists').textContent = new Set(LIBRARY.map((t) => t.artist)).size;
  go('home');
  loadCurrent(false);
  // preload the next track so transitions feel immediate
  const pre = new Audio();
  pre.preload = 'auto';
  pre.src = LIBRARY[1].file;
})();
