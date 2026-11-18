/**
 * Local music library: folder scan, tag reading, artwork cache, persistence,
 * and the recommendation engine behind Radio. No network, no accounts.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readTags } = require('./meta');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma', '.aiff', '.aif']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'artwork', 'art'];

class Library {
  /**
   * @param {object} opts
   * @param {string} opts.cacheDir directory for artwork + index cache
   */
  constructor(opts) {
    this.cacheDir = opts.cacheDir;
    this.artDir = path.join(opts.cacheDir, 'art');
    this.indexFile = path.join(opts.cacheDir, 'library.json');
    fs.mkdirSync(this.artDir, { recursive: true });
    /** @type {Map<string, object>} */
    this.tracks = new Map();
    this.folders = [];
  }

  /* --------------------------------------------------------------- scanning */
  /**
   * Walk one or more folders and build the library.
   * @param {string[]} folders
   * @param {(progress:{done:number,total:number,file:string})=>void} [onProgress]
   */
  scan(folders, onProgress) {
    this.folders = folders.slice();
    const files = this._collect();
    const tracks = this._readAll(files, onProgress);
    this.tracks = tracks;
    this.save();
    return this.snapshot();
  }

  /**
   * Same as scan(), but yields to the event loop between batches so that a big
   * folder cannot freeze the window while tags are being read.
   */
  async scanAsync(folders, onProgress, batch = 24) {
    this.folders = folders.slice();
    const files = this._collect();
    const tracks = new Map();
    let done = 0;
    const total = files.length;
    for (const file of files) {
      const t = this._readTrack(file, tracks);
      if (t) tracks.set(t.id, t);
      done += 1;
      if (onProgress && (done % 5 === 0 || done === total)) {
        onProgress({ done, total, file: path.basename(file) });
      }
      if (done % batch === 0) await new Promise((r) => setImmediate(r));
    }
    this.tracks = tracks;
    this.save();
    return this.snapshot();
  }

  _collect() {
    const files = [];
    this.folders.forEach((root) => this._walk(root, files, 0));
    return files;
  }

  _readAll(files, onProgress) {
    const tracks = new Map();
    const total = files.length;
    let done = 0;
    for (const file of files) {
      const t = this._readTrack(file, tracks);
      if (t) tracks.set(t.id, t);
      done += 1;
      if (onProgress && (done % 5 === 0 || done === total)) {
        onProgress({ done, total, file: path.basename(file) });
      }
    }
    return tracks;
  }

  _walk(dir, out, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        this._walk(full, out, depth + 1);
      } else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }

  _readTrack(file, existing) {
    const stat = (() => {
      try {
        return fs.statSync(file);
      } catch {
        return null;
      }
    })();
    if (!stat) return null;

    let tags = null;
    let picture = null;
    const meta = readTags(file);
    if (meta) {
      tags = meta.tags || {};
      picture = meta.picture || null;
    }

    const base = path.basename(file, path.extname(file));
    const cleanBase = base.replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim();
    const dirName = path.basename(path.dirname(file));

    // "Artist - Title" in the filename is a very common convention
    let fileArtist = '';
    let fileTitle = cleanBase;
    const dash = cleanBase.indexOf(' - ');
    if (dash > 0) {
      fileArtist = cleanBase.slice(0, dash).trim();
      fileTitle = cleanBase.slice(dash + 3).trim();
    }

    const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
    const title = (tags && tags.title) || fileTitle || base;
    const artist = (tags && tags.artist) || fileArtist || 'Unknown artist';
    const album = (tags && tags.album) || dirName || 'Unknown album';
    const trackNo = tags && tags.track ? parseInt(String(tags.track).split('/')[0], 10) || 0 : 0;

    // artwork: embedded first, then cover.jpg in the folder, then the app icon
    let art = null;
    if (picture && picture.data && picture.data.length > 64) {
      art = this._writeArt(id, picture.data, picture.mime);
    }
    if (!art) {
      art = this._folderArt(path.dirname(file));
    }

    return {
      id,
      file,
      title,
      artist,
      album,
      albumArtist: (tags && tags.albumArtist) || artist,
      genre: (tags && tags.genre) || '',
      year: (tags && tags.year) || '',
      bpm: tags && tags.bpm ? Number(tags.bpm) || 0 : 0,
      trackNo,
      format: path.extname(file).slice(1).toUpperCase(),
      rate: tags && tags._rate ? Number(tags._rate) : 0,
      bits: tags && tags._bits ? Number(tags._bits) : 0,
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      addedAt: Math.round(stat.birthtimeMs || stat.mtimeMs),
      art,
    };
  }

  _writeArt(id, buf, mime) {
    const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    const file = path.join(this.artDir, id + ext);
    try {
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      return file;
    } catch {
      return null;
    }
  }

  _folderArt(dir) {
    for (const name of COVER_NAMES) {
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const p = path.join(dir, name + ext);
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ persistence */
  save() {
    try {
      const data = { version: 2, folders: this.folders, tracks: Array.from(this.tracks.values()) };
      fs.writeFileSync(this.indexFile, JSON.stringify(data), 'utf8');
    } catch {
      /* non fatal */
    }
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (!raw || raw.version !== 2 || !Array.isArray(raw.tracks)) return false;
      this.folders = raw.folders || [];
      this.tracks = new Map(raw.tracks.map((t) => [t.id, t]));
      return this.tracks.size > 0;
    } catch {
      return false;
    }
  }

  /** refresh only files whose mtime changed; cheap for big libraries */
  refresh() {
    let changed = 0;
    for (const [id, t] of this.tracks) {
      let st;
      try {
        st = fs.statSync(t.file);
      } catch {
        this.tracks.delete(id);
        changed++;
        continue;
      }
      if (Math.round(st.mtimeMs) !== t.mtime) {
        const fresh = this._readTrack(t.file, this.tracks);
        if (fresh) this.tracks.set(id, fresh);
        changed++;
      }
    }
    if (changed) this.save();
    return changed;
  }

  removeMissing() {
    let removed = 0;
    for (const [id, t] of this.tracks) {
      if (!fs.existsSync(t.file)) {
        this.tracks.delete(id);
        removed++;
      }
    }
    if (removed) this.save();
    return removed;
  }

  addFolder(folder) {
    if (!this.folders.includes(folder)) this.folders.push(folder);
  }

  snapshot() {
    const tracks = Array.from(this.tracks.values()).sort(
      (a, b) =>
        a.artist.localeCompare(b.artist) ||
        a.album.localeCompare(b.album) ||
        a.trackNo - b.trackNo ||
        a.title.localeCompare(b.title)
    );
    return {
      folders: this.folders.slice(),
      tracks,
      stats: this.stats(tracks),
    };
  }

  stats(tracks = Array.from(this.tracks.values())) {
    const albums = new Set(tracks.map((t) => t.artist + '\u0000' + t.album));
    const artists = new Set(tracks.map((t) => t.albumArtist || t.artist));
    const genres = new Set(tracks.map((t) => t.genre).filter(Boolean));
    return { tracks: tracks.length, albums: albums.size, artists: artists.size, genres: genres.size };
  }
}

module.exports = { Library, AUDIO_EXT };
