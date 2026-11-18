/**
 * Recommendation engine — "Radio".
 *
 * No servers, no listening history leaving the machine: stations are built from
 * the user's own library. Two signals are combined:
 *   1. similarity  — shared genre / artist / album / era / tempo
 *   2. affinity    — local play counts and skips (stored in userData)
 *
 * Pure functions only, so it is trivially testable.
 */
'use strict';

const norm = (s) => String(s || '').toLowerCase().trim();
const genreTokens = (g) =>
  Array.from(
    new Set(
      norm(g)
        .split(/[;,/]| - /)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

/** Jaccard-ish similarity between two tracks, 0..1 */
function similarity(a, b) {
  if (a.id === b.id) return 1;
  let score = 0;
  let weight = 0;

  // genre overlap — the strongest signal for "same mood"
  weight += 3.2;
  const ga = new Set(genreTokens(a.genre));
  const gb = new Set(genreTokens(b.genre));
  if (ga.size && gb.size) {
    let inter = 0;
    ga.forEach((g) => {
      if (gb.has(g)) inter += 1;
      else if ([...gb].some((x) => x.includes(g) || g.includes(x))) inter += 0.6;
    });
    score += 3.2 * Math.min(1, inter / Math.max(ga.size, gb.size));
  }

  // same artist / same album
  weight += 2.6;
  if (norm(a.artist) === norm(b.artist)) score += 2.6;
  else if (norm(a.albumArtist) === norm(b.albumArtist) && a.albumArtist) score += 0.8;

  weight += 1.1;
  if (norm(a.album) === norm(b.album) && norm(a.artist) === norm(b.artist)) score += 1.1;

  // tempo proximity (bpm 60..180)
  weight += 1.3;
  if (a.bpm && b.bpm) {
    const d = Math.abs(a.bpm - b.bpm);
    score += 1.3 * Math.max(0, 1 - d / 40);
  }

  // era proximity
  weight += 0.9;
  const ya = parseInt(a.year, 10);
  const yb = parseInt(b.year, 10);
  if (ya && yb) score += 0.9 * Math.max(0, 1 - Math.abs(ya - yb) / 15);

  // length similarity — mixes and interludes shouldn't follow 9-minute epics
  weight += 0.5;
  if (a.duration && b.duration) {
    score += 0.5 * Math.max(0, 1 - Math.abs(a.duration - b.duration) / 240);
  }

  return weight ? score / weight : 0;
}

/** play/skip history: { id: { plays, skips, completed, lastPlayed } } */
function affinity(id, history) {
  const h = history && history[id];
  if (!h) return 0;
  const plays = h.plays || 0;
  const skips = h.skips || 0;
  const completions = h.completed || 0;
  const net = plays + completions * 1.5 - skips * 2.2;
  // decays so old favourites don't dominate forever
  const days = h.lastPlayed ? (Date.now() - h.lastPlayed) / 86400000 : 30;
  const recency = Math.exp(-days / 21);
  return net * (0.35 + 0.65 * recency);
}

/**
 * Build a station queue.
 * @param {object[]} tracks
 * @param {object} opts
 * @param {string} [opts.seedId]        start from this track ("song radio")
 * @param {string[]} [opts.genres]      restrict to these genres
 * @param {number} [opts.bpmRange]      target tempo tolerance
 * @param {number} [opts.length=24]
 * @param {object} [opts.history]
 * @param {boolean} [opts.noRepeatArtists=true]
 */
function station(tracks, opts = {}) {
  const { seedId, genres, length = 24, history = {}, noRepeatArtists = true } = opts;
  if (!tracks.length) return [];
  const seed = seedId ? tracks.find((t) => t.id === seedId) : null;
  const pool = genres && genres.length ? tracks.filter((t) => genres.some((g) => norm(t.genre).includes(norm(g)))) : tracks;
  const list = pool.length ? pool : tracks;

  const scored = list
    .filter((t) => !seed || t.id !== seed.id)
    .map((t) => {
      const sim = seed ? similarity(seed, t) : 0.5;
      const aff = affinity(t.id, history);
      // slight jitter keeps consecutive stations from being identical
      return { t, score: sim * 4 + aff * 0.6 + Math.random() * 0.35 };
    })
    .sort((a, b) => b.score - a.score);

  let out = seed ? [seed] : [];
  const usedArtists = new Set(out.map((t) => norm(t.albumArtist || t.artist)));
  for (const { t } of scored) {
    if (out.length >= length) break;
    const key = norm(t.albumArtist || t.artist);
    if (noRepeatArtists && usedArtists.has(key) && scored.length > length) continue;
    out.push(t);
    usedArtists.add(key);
  }
  // if the artist rule starved the station, top it up
  if (out.length < Math.min(length, list.length)) {
    for (const { t } of scored) {
      if (out.length >= length) break;
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** "Made for you" shelves for the Home view */
function shelves(tracks, history = {}) {
  const byArtist = new Map();
  tracks.forEach((t) => {
    const k = norm(t.albumArtist || t.artist);
    if (!byArtist.has(k)) byArtist.set(k, []);
    byArtist.get(k).push(t);
  });

  const played = tracks
    .map((t) => ({ t, a: affinity(t.id, history) }))
    .filter((x) => x.a !== 0)
    .sort((a, b) => b.a - a.a)
    .map((x) => x.t);

  const recent = tracks.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const genres = new Map();
  tracks.forEach((t) => {
    genreTokens(t.genre).forEach((g) => {
      if (!genres.has(g)) genres.set(g, []);
      genres.get(g).push(t);
    });
  });

  const artists = [...byArtist.values()]
    .filter((list) => list.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6)
    .map((list) => ({ artist: list[0].albumArtist || list[0].artist, tracks: list }));

  return {
    onRepeat: played.slice(0, 12),
    recentlyAdded: recent.slice(0, 12),
    artists,
    genres: [...genres.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([g, list]) => ({ genre: g, tracks: list, count: list.length })),
  };
}

/** next track when the queue runs out — keeps the vibe going */
function continueQueue(tracks, lastId, history, alreadyIds, count = 6) {
  const seed = tracks.find((t) => t.id === lastId);
  if (!seed) return station(tracks, { history, length: count });
  const skip = new Set(alreadyIds || []);
  return station(tracks, { seedId: seed.id, history, length: count + skip.size })
    .filter((t) => !skip.has(t.id))
    .slice(0, count);
}

module.exports = { similarity, affinity, station, shelves, continueQueue, genreTokens };
