/**
 * Minimal, dependency-free audio tag reader.
 * Supports: MP3 (ID3v2.2/2.3/2.4), FLAC (Vorbis comments + picture),
 * M4A/MP4 (iTunes ilst atoms). Returns null when nothing can be read.
 */
'use strict';
const fs = require('fs');

/* ------------------------------------------------------------------ helpers */
function syncsafe(buf, off) {
  return ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);
}
function be32(buf, off) {
  return buf.readUInt32BE(off);
}
function decodeText(buf, enc) {
  if (!buf || !buf.length) return '';
  let out;
  switch (enc) {
    case 0:
      out = buf.toString('latin1');
      break;
    case 1: {
      // UTF-16 with BOM
      if (buf[0] === 0xff && buf[1] === 0xfe) out = buf.slice(2).toString('utf16le');
      else if (buf[0] === 0xfe && buf[1] === 0xff) out = swap16(buf.slice(2)).toString('utf16le');
      else out = buf.toString('utf16le');
      break;
    }
    case 2:
      out = swap16(buf).toString('utf16le');
      break;
    default:
      out = buf.toString('utf8');
  }
  return out.replace(/\u0000+$/g, '').replace(/^\uFEFF/, '').trim();
}
function swap16(buf) {
  const b = Buffer.from(buf);
  for (let i = 0; i + 1 < b.length; i += 2) {
    const t = b[i];
    b[i] = b[i + 1];
    b[i + 1] = t;
  }
  return b;
}

/* ---------------------------------------------------------------------- ID3 */
const ID3_FRAMES = {
  TIT2: 'title',
  TT2: 'title',
  TPE1: 'artist',
  TP1: 'artist',
  TPE2: 'albumArtist',
  TALB: 'album',
  TAL: 'album',
  TCON: 'genre',
  TCO: 'genre',
  TRCK: 'track',
  TRK: 'track',
  TDRC: 'year',
  TYER: 'year',
  TYE: 'year',
  TBPM: 'bpm',
  TCOM: 'composer',
};

function parseID3(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null;
  const major = buf[3];
  const flags = buf[5];
  const size = syncsafe(buf, 6);
  let off = 10;
  if (flags & 0x40) {
    // extended header
    if (major >= 4) off += syncsafe(buf, off);
    else off += be32(buf, off) + 4;
  }
  const end = Math.min(10 + size, buf.length);
  const tags = {};
  let picture = null;

  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;

  while (off + headLen <= end) {
    const id = buf.toString('latin1', off, off + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsize;
    if (major === 2) fsize = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
    else if (major >= 4) fsize = syncsafe(buf, off + 4);
    else fsize = be32(buf, off + 4);
    const fflags = major === 2 ? 0 : buf.readUInt16BE(off + 8);
    const bodyStart = off + headLen;
    if (fsize <= 0 || bodyStart + fsize > buf.length) break;
    const body = buf.slice(bodyStart, bodyStart + fsize);

    if (major < 4 && fflags & 0x0040) {
      // compressed — skip
    } else if (major >= 4 && fflags & 0x000c) {
      // compressed / encrypted — skip
    } else if (id === 'APIC' || id === 'PIC') {
      if (!picture) picture = parseAPIC(body, id === 'PIC');
    } else if (ID3_FRAMES[id]) {
      const val = decodeText(body.slice(1), body[0]);
      if (val) tags[ID3_FRAMES[id]] = val;
    }
    off = bodyStart + fsize;
  }
  return { tags, picture };
}

function parseAPIC(body, isPic22) {
  const enc = body[0];
  let p = 1;
  let mime;
  if (isPic22) {
    mime = 'image/' + body.toString('latin1', 1, 4).toLowerCase();
    p = 4;
  } else {
    let z = p;
    while (z < body.length && body[z] !== 0) z++;
    mime = body.toString('latin1', p, z) || 'image/jpeg';
    p = z + 1;
  }
  p += 1; // picture type
  // description (null terminated, encoding dependent)
  if (enc === 1 || enc === 2) {
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < body.length && body[p] !== 0) p++;
    p += 1;
  }
  if (p >= body.length) return null;
  return { mime: guessMime(mime, body.slice(p, p + 8)), data: body.slice(p) };
}

function guessMime(mime, head) {
  const m = (mime || '').toLowerCase();
  if (m.includes('png') || head[0] === 0x89) return 'image/png';
  if (m.includes('webp')) return 'image/webp';
  if (m.includes('gif')) return 'image/gif';
  return 'image/jpeg';
}

/* --------------------------------------------------------------------- FLAC */
function parseFLAC(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  let off = 4;
  const tags = {};
  let picture = null;
  let guard = 0;
  while (off + 4 <= buf.length && guard++ < 64) {
    const header = buf[off];
    const last = header & 0x80;
    const type = header & 0x7f;
    const len = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    const body = buf.slice(off + 4, off + 4 + len);
    if (type === 0 && body.length >= 18) {
      // STREAMINFO: sample rate in bits 80.. of the block, then total samples
      const rate = (body[10] << 12) | (body[11] << 4) | (body[12] >> 4);
      const channels = ((body[12] >> 1) & 0x07) + 1;
      const bps = (((body[12] & 0x01) << 4) | (body[13] >> 4)) + 1;
      if (rate) tags._rate = String(rate);
      tags._channels = String(channels);
      tags._bits = String(bps);
    } else if (type === 4) {
      const vendorLen = body.readUInt32LE(0);
      let p = 4 + vendorLen;
      const count = body.readUInt32LE(p);
      p += 4;
      for (let i = 0; i < count && p + 4 <= body.length; i++) {
        const l = body.readUInt32LE(p);
        p += 4;
        const entry = body.toString('utf8', p, p + l);
        p += l;
        const eq = entry.indexOf('=');
        if (eq < 0) continue;
        const k = entry.slice(0, eq).toUpperCase();
        const v = entry.slice(eq + 1);
        const map = {
          TITLE: 'title',
          ARTIST: 'artist',
          ALBUM: 'album',
          ALBUMARTIST: 'albumArtist',
          GENRE: 'genre',
          DATE: 'year',
          TRACKNUMBER: 'track',
          BPM: 'bpm',
        };
        if (map[k] && v) tags[map[k]] = v;
      }
    } else if (type === 6) {
      if (!picture && body.length > 32) {
        let p = 4; // picture type (0-20), then the MIME string
        const mimeLen = body.readUInt32BE(p);
        p += 4;
        const mime = body.toString('latin1', p, p + mimeLen);
        p += mimeLen;
        const descLen = body.readUInt32BE(p);
        p += 4 + descLen;
        p += 16; // width + height + depth + colors
        if (p + 4 > body.length) return { tags, picture };
        const dataLen = body.readUInt32BE(p);
        p += 4;
        if (p + dataLen > body.length) return { tags, picture };
        picture = { mime: guessMime(mime, body.slice(p, p + 8)), data: body.slice(p, p + dataLen) };
      }
    }
    off += 4 + len;
    if (last) break;
  }
  return { tags, picture };
}

/* ---------------------------------------------------------------------- M4A */
function parseM4A(buf) {
  // quick sanity: 'ftyp' near the start
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const tags = {};
  let picture = null;

  const atom = (p) => {
    if (p + 8 > buf.length) return null;
    const size = be32(buf, p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size < 8 || p + size > buf.length) return null;
    return { size, type, start: p + 8, end: p + size };
  };

  const walk = (start, end, depth) => {
    let p = start;
    let guard = 0;
    while (p + 8 <= end && guard++ < 500) {
      const a = atom(p);
      if (!a) return;
      const map = {
        '\u00a9nam': 'title',
        '\u00a9ART': 'artist',
        '\u00a9alb': 'album',
        '\u00a9gen': 'genre',
        '\u00a9day': 'year',
        aART: 'albumArtist',
      };
      if (map[a.type]) {
        const data = atom(a.start);
        if (data && data.type === 'data') {
          const payload = buf.slice(data.start + 8, data.end);
          const v = payload.toString('utf8').replace(/\u0000+$/, '').trim();
          if (v) tags[map[a.type]] = v;
        }
      } else if (a.type === 'trkn') {
        const data = atom(a.start);
        if (data) {
          const payload = buf.slice(data.start + 8, data.end);
          if (payload.length >= 4) tags.track = String(payload.readUInt16BE(2));
        }
      } else if (a.type === 'covr' && !picture) {
        const data = atom(a.start);
        if (data) {
          const payload = buf.slice(data.start + 8, data.end);
          picture = { mime: guessMime('', payload.slice(0, 8)), data: payload };
        }
      } else if (['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia'].includes(a.type) && depth < 6) {
        // 'meta' has a 4-byte version/flags prefix
        const inner = a.type === 'meta' ? a.start + 4 : a.start;
        walk(inner, a.end, depth + 1);
      }
      p = a.end;
    }
  };
  walk(0, buf.length, 0);
  if (!Object.keys(tags).length && !picture) return null;
  return { tags, picture };
}

/* --------------------------------------------------------------------- entry */
function sniff(buf) {
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') return 'id3';
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'fLaC') return 'flac';
  if (buf.length >= 8 && buf.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

/**
 * @param {string} file absolute path
 * @returns {{tags:object, picture:null|{mime:string,data:Buffer}}|null}
 */
function readTags(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    // tags live near the start; 4 MB is plenty for art + text frames
    const fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, 4 * 1024 * 1024);
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  const kind = sniff(buf);
  try {
    if (kind === 'id3') return parseID3(buf);
    if (kind === 'flac') return parseFLAC(buf);
    if (kind === 'm4a') return parseM4A(buf);
  } catch {
    return null;
  }
  return null;
}

module.exports = { readTags, parseID3, parseFLAC, parseM4A, syncsafe };
