/**
 * Audius client — an open, legal music catalogue.
 *
 * Audius is a permissionless music network: every track on it is either
 * CC-licensed or uploaded by the artist, and streaming is served from public
 * content nodes. The discovery API is public, needs no key for reads, and
 * explicitly supports HTTP range requests, so seeking works like a local file.
 *
 * Everything here is plain fetch + JSON; `fetchImpl` is injectable so the client
 * can be unit-tested without a network.
 *
 *   https://api.audius.co            → list of discovery hosts
 *   GET /v1/tracks/trending          → charts, filterable by genre
 *   GET /v1/tracks/search?query=     → search
 *   GET /v1/tracks/{id}/stream       → 302 to a signed content-node URL
 */
'use strict';

const APP_NAME = 'ByAzen';
const HOST_LIST = 'https://api.audius.co';
const DEFAULT_TIMEOUT = 12000;

/** Audius genre strings that the trending endpoint actually knows about. */
const GENRES = [
  'All',
  'Electronic',
  'Hip-Hop/Rap',
  'Pop',
  'R&B/Soul',
  'Rock',
  'Alternative',
  'Lo-Fi',
  'House',
  'Techno',
  'Drum & Bass',
  'Dubstep',
  'Ambient',
  'Jazz',
  'Classical',
  'Folk',
  'Experimental',
  'Soundtrack',
  'Downtempo',
  'Deep House',
  'Trance',
  'Trap',
  'World',
];

class AudiusError extends Error {}

/** small TTL cache so browsing does not hammer the public API */
class Cache {
  constructor(ttl = 120000, max = 200) {
    this.ttl = ttl;
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttl) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }
  set(key, value) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { at: Date.now(), value });
    return value;
  }
  drop(prefix) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

const playable = (t) => t && t.isStreamable !== false;

const art = (t) => {
  const a = t.artwork || {};
  return a['1000x1000'] || a['480x480'] || a['150x150'] || null;
};

/**
 * Turn a raw Audius track into the shape the renderer already understands.
 * Keeping the same field names means the queue, transport and the offline
 * similarity engine work unchanged for remote tracks.
 */
function normalizeTrack(t) {
  if (!t || !t.id) return null;
  const user = t.user || {};
  const release = t.release_date || t.created_at || '';
  const year = release ? String(release).slice(0, 4) : '';
  const streamUrl = t.stream && t.stream.url ? t.stream.url : null;
  return {
    id: 'audius:' + t.id,
    source: 'audius',
    audiusId: t.id,
    title: t.title || 'Untitled',
    artist: user.name || user.handle || 'Audius artist',
    artistId: user.id || null,
    artistHandle: user.handle || null,
    album: t.album_backlink && t.album_backlink.playlist_name ? t.album_backlink.playlist_name : '',
    albumArtist: user.name || '',
    genre: t.genre || '',
    mood: t.mood || '',
    year,
    bpm: Number(t.bpm) || 0,
    trackNo: 0,
    duration: Number(t.duration) || 0,
    format: 'AUDIUS',
    rate: 0,
    bits: 0,
    art: art(t),
    addedAt: 0,
    permalink: t.permalink || null,
    url: streamUrl, // used directly when fresh; main re-resolves if expired
    streamUrl,
    playCount: Number(t.play_count) || 0,
    favouriteCount: Number(t.favorite_count) || 0,
    reposts: Number(t.repost_count) || 0,
    // gated tracks need a purchase/unlock, so they are not playable here
    isStreamable: t.is_streamable !== false && !t.is_stream_gated,
    permalinkUrl: t.permalink ? 'https://audius.co' + t.permalink : null,
  };
}

class Audius {
  constructor(opts = {}) {
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.timeout = opts.timeout || DEFAULT_TIMEOUT;
    this.cache = opts.cache || new Cache();
    this.appName = opts.appName || APP_NAME;
    this.host = null;
    this.hostsAt = 0;
  }

  /* --------------------------------------------------------------- transport */
  async _json(path, params = {}, { retry = true } = {}) {
    const hosts = await this._hosts();
    let lastErr = null;
    for (const host of hosts) {
      const url = new URL(host.replace(/\/$/, '') + path);
      url.searchParams.set('app_name', this.appName);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
      const key = 'json:' + url.toString();
      const hit = this.cache.get(key);
      if (hit) return hit;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeout);
        let res;
        try {
          res = await this.fetch(url.toString(), { signal: ctrl.signal, headers: { accept: 'application/json' } });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          lastErr = new AudiusError(`${res.status} ${res.statusText || ''} for ${path}`);
          if (res.status === 404) throw lastErr; // real "not found", don't rotate
          continue;
        }
        const json = await res.json();
        if (json && json.data !== undefined) {
          this.host = host;
          return this.cache.set(key, json.data);
        }
        lastErr = new AudiusError('unexpected payload for ' + path);
      } catch (e) {
        if (e instanceof AudiusError && /^404/.test(e.message)) throw e;
        lastErr = e;
      }
    }
    // every host failed: forget the host list so the next call re-discovers
    this.hostsAt = 0;
    throw new AudiusError(
      `Audius is unreachable (${lastErr ? lastErr.message : 'no hosts'}). Check the connection.`
    );
  }

  async _hosts() {
    const fresh = this.hostsAt && Date.now() - this.hostsAt < 10 * 60 * 1000;
    if (this.host && fresh) return [this.host];
    if (!fresh) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeout);
        let res;
        try {
          res = await this.fetch(HOST_LIST, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        } finally {
          clearTimeout(timer);
        }
        const json = await res.json();
        const list = Array.isArray(json) ? json : json && Array.isArray(json.data) ? json.data : [];
        const cleaned = list.filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
        if (cleaned.length) {
          this.hosts = cleaned;
          this.hostsAt = Date.now();
          if (!this.host || !cleaned.includes(this.host)) this.host = cleaned[0];
        }
      } catch {
        /* fall through: keep the previous host, if any */
      }
    }
    if (this.host) return [this.host, ...(this.hosts || []).filter((h) => h !== this.host)];
    // last resort: a well-known discovery node
    return ['https://discoveryprovider.audius.co'];
  }

  /* ------------------------------------------------------------------ browse */
  async trending({ genre, time = 'week', limit = 24 } = {}) {
    const params = { time, limit };
    if (genre && genre !== 'All') params.genre = genre;
    const data = await this._json('/v1/tracks/trending', params);
    return (Array.isArray(data) ? data : []).map(normalizeTrack).filter(playable);
  }

  async underground({ limit = 24 } = {}) {
    const data = await this._json('/v1/tracks/trending/underground', { limit });
    return (Array.isArray(data) ? data : []).map(normalizeTrack).filter(playable);
  }

  async search(query, { limit = 30 } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const data = await this._json('/v1/tracks/search', { query: q, limit });
    return (Array.isArray(data) ? data : []).map(normalizeTrack).filter(playable);
  }

  async track(id) {
    const clean = String(id || '').replace(/^audius:/, '');
    const data = await this._json(`/v1/tracks/${encodeURIComponent(clean)}`);
    const t = Array.isArray(data) ? data[0] : data;
    return normalizeTrack(t);
  }

  async artistTracks(artistId, { limit = 20 } = {}) {
    if (!artistId) return [];
    const data = await this._json(`/v1/users/${encodeURIComponent(artistId)}/tracks`, { limit, sort: 'plays' });
    return (Array.isArray(data) ? data : []).map(normalizeTrack).filter(playable);
  }

  async playlist(id) {
    const clean = String(id || '').replace(/^audius:/, '');
    const data = await this._json(`/v1/playlists/${encodeURIComponent(clean)}`);
    const p = Array.isArray(data) ? data[0] : data;
    if (!p) return null;
    const tracks = (p.tracks || []).map(normalizeTrack).filter(playable);
    return {
      id: 'audius:playlist:' + p.id,
      title: p.playlist_name || 'Playlist',
      artist: p.user ? p.user.name : '',
      art: art(p),
      tracks,
      permalink: p.permalink ? 'https://audius.co' + p.permalink : null,
    };
  }

  /**
   * A playable stream URL. Signed URLs in track payloads expire, so this asks
   * the API for a fresh one and returns the redirect target plus the stable
   * endpoint as a fallback.
   */
  async streamUrl(anything) {
    const id = typeof anything === 'string' ? anything.replace(/^audius:/, '') : anything && (anything.audiusId || anything.id);
    if (!id) throw new AudiusError('no track id');
    const direct = anything && typeof anything === 'object' ? anything.streamUrl : null;
    const hosts = await this._hosts();
    const endpoint = `${(this.host || hosts[0]).replace(/\/$/, '')}/v1/tracks/${encodeURIComponent(
      String(id).replace(/^audius:/, '')
    )}/stream?app_name=${encodeURIComponent(this.appName)}`;
    return { direct: direct && isFresh(direct) ? direct : null, endpoint };
  }
}

/** signed Audius URLs carry a timestamp; treat anything older than ~10 min as stale */
function isFresh(url) {
  try {
    const sig = new URL(url).searchParams.get('signature');
    if (!sig) return true;
    const parsed = JSON.parse(sig);
    const data = JSON.parse(parsed.data);
    if (!data.timestamp) return true;
    return data.timestamp > Date.now() + 60000;
  } catch {
    return false;
  }
}

module.exports = { Audius, AudiusError, normalizeTrack, isFresh, Cache, GENRES, APP_NAME };
