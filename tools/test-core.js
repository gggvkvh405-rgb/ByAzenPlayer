/**
 * Unit tests for the local-library core: tag reader, scanner and the offline
 * recommendation engine. Fixtures are generated into a temp dir at runtime, so
 * this runs anywhere with plain Node — no native deps, no network.
 *   node tools/test-core.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const meta = require('../app/meta');
const { Library } = require('../app/library');
const rec = require('../app/recommend');

let passed = 0;
const fails = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    fails.push(`${name}\n    ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    fails.push(`${name}\n    ${e.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'byazen-core-'));

/* ------------------------------------------------------------ ID3 fixtures */
function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}
function id3v23(frames) {
  const body = Buffer.concat(
    frames.map(([id, payload]) => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(payload.length, 0);
      return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.alloc(2), payload]);
    })
  );
  return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), syncsafe(body.length), body]);
}
const utf16 = (s) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

const id3 = id3v23([
  ['TIT2', utf16('Северный свет')],
  ['TPE1', utf16('Kael Rivers')],
  ['TALB', utf16('Northern Light')],
  ['TCON', utf16('Ambient;Downtempo')],
  ['TRCK', Buffer.concat([Buffer.from([0]), Buffer.from('3/9')])],
  ['TYER', Buffer.concat([Buffer.from([0]), Buffer.from('2021')])],
  ['APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), Buffer.from('89504e470d0a1a0a' + '00'.repeat(120), 'hex')])],
]);
const id3File = path.join(tmp, 'id3.mp3');
fs.writeFileSync(id3File, Buffer.concat([id3, Buffer.alloc(64)]));

test('id3 tags', () => {
  const { tags } = meta.readTags(id3File);
  assert.strictEqual(tags.title, 'Северный свет');
  assert.strictEqual(tags.artist, 'Kael Rivers');
  assert.strictEqual(tags.album, 'Northern Light');
  assert.strictEqual(tags.track, '3/9');
  assert.ok(/ambient/i.test(tags.genre), tags.genre);
  assert.strictEqual(String(tags.year), '2021');
  assert.strictEqual(typeof tags, 'object');
});

test('id3 embedded artwork is exposed', () => {
  const { picture } = meta.readTags(id3File);
  assert.ok(picture, 'no picture');
  assert.strictEqual(picture.mime, 'image/png');
  assert.strictEqual(picture.data.length, 128);
});

/* ---------------------------------------------------------- FLAC fixtures */
function be24(n) {
  return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
function vorbisBlock(list) {
  const vendor = Buffer.from('reference libFLAC', 'latin1');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(vendor.length, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(list.length, 0);
  const items = list.map(([k, v]) => {
    const entry = Buffer.from(`${k.toUpperCase()}=${v}`, 'utf8');
    const l = Buffer.alloc(4);
    l.writeUInt32LE(entry.length, 0);
    return Buffer.concat([l, entry]);
  });
  const payload = Buffer.concat([size, vendor, count, ...items]);
  const pad = payload.length % 4 ? Buffer.alloc(4 - (payload.length % 4)) : Buffer.alloc(0);
  return Buffer.concat([payload, pad]);
}
function blockHeader(type, last, len) {
  return Buffer.from([type | (last ? 0x80 : 0), (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}
function flacFileWith(tags, picture) {
  const si = Buffer.alloc(34);
  si.writeUInt16BE(4096, 0);
  si.writeUInt16BE(4096, 2);
  si.writeUIntBE(0, 4, 3);
  si.writeUIntBE(0, 7, 3);
  const rate = 44100;
  si[10] = (rate >> 12) & 0xff;
  si[11] = (rate >> 4) & 0xff;
  si[12] = ((rate & 0x0f) << 4) | ((2 - 1) << 1) | (((16 - 1) & 0x10) >> 4);
  si[13] = ((16 - 1) & 0x0f) << 4;
  si.writeUIntBE(1234567, 14, 5);
  const blocks = [];
  blocks.push(blockHeader(0, tags ? false : true, 34), si);
  if (tags) {
    const vb = vorbisBlock(tags);
    blocks.push(blockHeader(4, !picture, vb.length), vb);
  }
  if (picture) blocks.push(blockHeader(6, true, picture.length), picture);
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), ...blocks, Buffer.alloc(32)]);
}
const flacPath = path.join(tmp, 'Nordic.flac');
const picPayload = Buffer.from('89504e470d0a1a0a', 'hex');
const pic = Buffer.concat([
  Buffer.from([0, 0, 0, 3]), // picture type: front cover
  Buffer.from([0, 0, 0, 9]), // mime length
  Buffer.from('image/png', 'latin1'),
  Buffer.from([0, 0, 0, 2]), // description length
  Buffer.from([0x61, 0x62]), // "ab"
  Buffer.from([0, 0, 0, 1]), // width
  Buffer.from([0, 0, 0, 1]), // height
  Buffer.from([0, 0, 0, 24]), // depth
  Buffer.from([0, 0, 0, 0]), // colors
  (() => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(picPayload.length, 0);
    return l;
  })(),
  picPayload,
]);
fs.writeFileSync(
  flacPath,
  flacFileWith(
    [
      ['TITLE', 'Paper Moons'],
      ['ARTIST', 'Nils Åberg'],
      ['ALBUM', 'Harbour Tapes'],
      ['GENRE', 'Downtempo'],
      ['DATE', '2020'],
    ],
    pic
  )
);

test('flac tags + stream info', () => {
  const { tags } = meta.readTags(flacPath);
  assert.strictEqual(tags.title, 'Paper Moons');
  assert.strictEqual(tags.artist, 'Nils Åberg');
  assert.strictEqual(tags.genre, 'Downtempo');
  assert.strictEqual(tags._rate, '44100');
  assert.strictEqual(tags._channels, '2');
  assert.strictEqual(tags._bits, '16');
});

/* ------------------------------------------------------------ M4A fixture */
function atom(name, body) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 8, 0);
  return Buffer.concat([size, Buffer.from(name, 'latin1'), body]);
}
function dataAtom(s) {
  const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8');
  return atom('data', Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.alloc(4), b]));
}
const ilst = atom(
  'ilst',
  Buffer.concat([
    atom('\u00a9nam', dataAtom('Low Tide')),
    atom('\u00a9ART', dataAtom('Sable & Co.')),
    atom('\u00a9alb', dataAtom('Night Bus')),
    atom('\u00a9gen', dataAtom('Downtempo')),
    atom('trkn', dataAtom(Buffer.from([0, 0, 0, 7, 0, 12]))),
  ])
);
const m4a = Buffer.concat([
  atom('ftyp', Buffer.from('M4A isomM4A ', 'latin1')),
  atom('moov', atom('udta', atom('meta', Buffer.concat([Buffer.from([0, 0, 0, 0]), atom('hdlr', Buffer.alloc(24)), ilst])))),
]);
const m4aPath = path.join(tmp, 'low-tide.m4a');
fs.writeFileSync(m4aPath, m4a);

test('m4a tags', () => {
  const { tags } = meta.readTags(m4aPath);
  assert.strictEqual(tags.title, 'Low Tide');
  assert.strictEqual(tags.artist, 'Sable & Co.');
  assert.strictEqual(tags.album, 'Night Bus');
  assert.strictEqual(tags.track, '7');
});

test('unknown file falls back to the filename', () => {
  const p = path.join(tmp, 'June Alba - Wildflower.mp3');
  fs.writeFileSync(p, Buffer.alloc(16));
  const res = meta.readTags(p);
  assert.strictEqual(res, null, 'plain bytes have no tags — library falls back to the filename');
});

/* --------------------------------------------------------------- scanning */
const music = path.join(tmp, 'music');
fs.mkdirSync(path.join(music, 'Kael Rivers', 'Northern Light'), { recursive: true });
fs.mkdirSync(path.join(music, '.hidden'), { recursive: true });
fs.mkdirSync(path.join(music, 'empty dir'), { recursive: true });
fs.copyFileSync(id3File, path.join(music, 'Kael Rivers', 'Northern Light', '01.mp3'));
const flac2 = path.join(music, 'Mira Voss', 'Four Rooms');
fs.mkdirSync(flac2, { recursive: true });
fs.copyFileSync(flacPath, path.join(flac2, '01.flac'));
fs.copyFileSync(m4aPath, path.join(flac2, '02.m4a'));
fs.writeFileSync(path.join(music, '.hidden', 'skip.mp3'), Buffer.alloc(8));
fs.writeFileSync(path.join(music, 'notes.txt'), 'not music');
fs.copyFileSync(path.join(APP_ART_SRC()), path.join(music, 'Mira Voss', 'Four Rooms', 'cover.png'));

function APP_ART_SRC() {
  // any small PNG already in the repo works as folder artwork
  return path.join(__dirname, '..', 'app', 'renderer', 'assets', 'covers', 'hush.png');
}

test('scanner walks, filters and reads tags', () => {
  const lib = new Library({ cacheDir: path.join(tmp, 'cache') });
  const snap = lib.scan([music]);
  assert.strictEqual(snap.tracks.length, 3, JSON.stringify(snap.tracks.map((t) => t.title)));
  const titles = snap.tracks.map((t) => `${t.artist} — ${t.title}`).sort();
  assert.deepStrictEqual(titles, ['Kael Rivers — Северный свет', 'Nils Åberg — Paper Moons', 'Sable & Co. — Low Tide']);
  const flacTrack = snap.tracks.find((t) => t.format === 'FLAC');
  assert.strictEqual(flacTrack.artist, 'Nils Åberg');
  assert.strictEqual(flacTrack.rate, 44100);
  assert.ok(flacTrack.art && fs.existsSync(flacTrack.art), 'flac should carry embedded art');
  const mp3 = snap.tracks.find((t) => t.format === 'MP3');
  assert.strictEqual(mp3.trackNo, 3);
  assert.ok(mp3.art && fs.existsSync(mp3.art), 'mp3 should carry embedded art');
  assert.ok(mp3.id && mp3.id.length === 16);
  assert.ok(mp3.file.endsWith('01.mp3'));
  assert.strictEqual(snap.stats.albums, 3);
  assert.strictEqual(snap.stats.tracks, 3);
  assert.ok(snap.stats.artists >= 3);
});

test('folder artwork is used when a track has none', () => {
  const lib = new Library({ cacheDir: path.join(tmp, 'cache2') });
  const snap = lib.scan([music]);
  const m4aTrack = snap.tracks.find((t) => t.format === 'M4A');
  assert.ok(m4aTrack, 'm4a should be indexed');
  assert.ok(m4aTrack.art && /cover\.png$/i.test(m4aTrack.art), String(m4aTrack.art));
});

test('index persists and reloads', () => {
  const cacheDir = path.join(tmp, 'cache3');
  const a = new Library({ cacheDir });
  a.scan([music]);
  assert.ok(fs.existsSync(path.join(cacheDir, 'library.json')));
  const b = new Library({ cacheDir });
  assert.strictEqual(b.load(), true);
  assert.strictEqual(b.snapshot().tracks.length, 3);
  assert.deepStrictEqual(b.snapshot().folders, [music]);
});

test('refresh picks up removed files and reports no change twice', () => {
  const cacheDir = path.join(tmp, 'cache4');
  const lib = new Library({ cacheDir });
  lib.scan([music]);
  const second = lib.refresh();
  assert.strictEqual(second, 0, String(second));
  const victim = path.join(music, 'Kael Rivers', 'Northern Light', '01.mp3');
  const backup = fs.readFileSync(victim);
  fs.rmSync(victim);
  lib.load();
  const after = lib.refresh();
  assert.ok(after >= 1, String(after));
  assert.strictEqual(lib.snapshot().tracks.length, 2, String(lib.snapshot().tracks.length));
  fs.writeFileSync(victim, backup);
});

test('removeMissing prunes the index', () => {
  const cacheDir = path.join(tmp, 'cache5');
  const lib = new Library({ cacheDir });
  lib.scan([music]);
  const victim = path.join(music, 'Kael Rivers', 'Northern Light', '01.mp3');
  const backup = fs.readFileSync(victim);
  fs.rmSync(victim);
  const removed = lib.removeMissing();
  assert.strictEqual(removed, 1, String(removed));
  assert.strictEqual(lib.snapshot().tracks.length, 2);
  fs.writeFileSync(victim, backup);
});

/* ------------------------------------------------------- recommendations */
const A = (o) => ({
  id: o.id,
  title: o.title || o.id,
  artist: o.artist || 'X',
  albumArtist: o.artist || 'X',
  album: o.album || 'Album',
  genre: o.genre || '',
  year: o.year || '2020',
  bpm: o.bpm || 0,
  duration: o.duration || 180,
});

const POOL = [
  A({ id: 'a1', artist: 'Kael Rivers', genre: 'Ambient', bpm: 84 }),
  A({ id: 'a2', artist: 'Kael Rivers', genre: 'Ambient', bpm: 86 }),
  A({ id: 'a3', artist: 'Nils Åberg', genre: 'Ambient', bpm: 80, album: 'Harbour' }),
  A({ id: 'a4', artist: 'Mira Voss', genre: 'Modern Classical', bpm: 62 }),
  A({ id: 'a5', artist: 'Sable & Co.', genre: 'Downtempo', bpm: 98 }),
  A({ id: 'a6', artist: 'June Alba', genre: 'Folk', bpm: 70 }),
];

test('similarity ranks same genre+artist above unrelated', () => {
  const seed = POOL[0];
  const near = rec.similarity(seed, POOL[1]);
  const far = rec.similarity(seed, POOL[5]);
  assert.ok(near > far, `${near} should beat ${far}`);
  assert.ok(near > 0.8, String(near));
});

test('affinity favours finishes and punishes skips', () => {
  const now = Date.now();
  const h = (o) => ({ x: o });
  const good = rec.affinity('x', h({ plays: 4, completed: 3, skips: 0, lastPlayed: now }));
  const bad = rec.affinity('x', h({ plays: 4, completed: 0, skips: 4, lastPlayed: now }));
  assert.ok(good > 0, String(good));
  assert.ok(bad < 0, String(bad));
  const stale = rec.affinity('x', h({ plays: 4, completed: 3, skips: 0, lastPlayed: now - 200 * 86400000 }));
  assert.ok(stale < good, 'old plays should decay');
  assert.strictEqual(rec.affinity('nope', h({})), 0);
});

test('station returns a seeded, deduplicated run', () => {
  const rnd = Math.random;
  Math.random = () => 0.5;
  const list = rec.station(POOL, { seedId: 'a1', length: 5, noRepeatArtists: false });
  Math.random = rnd;
  assert.strictEqual(list.length, 5);
  assert.strictEqual(new Set(list.map((t) => t.id)).size, 5);
  assert.strictEqual(list[0].id, 'a1', 'seed should open the station');
  // the ambient neighbour should beat the folk track
  // the same-artist ambient track opens the run right after the seed
  assert.strictEqual(list[1].id, 'a2', list.map((t) => t.id).join(','));
  assert.deepStrictEqual(list.slice(0, 3).map((t) => t.id), ['a1', 'a2', 'a3']);
});

test('station can filter by genre', () => {
  const list = rec.station(POOL, { genres: ['ambient'], length: 6 });
  assert.strictEqual(list.length, 3, list.map((t) => t.genre).join(','));
  assert.ok(list.every((t) => /ambient/i.test(t.genre)));
});

test('station honours noRepeatArtists', () => {
  const big = POOL.concat([
    A({ id: 'b1', artist: 'Kael Rivers', genre: 'Ambient' }),
    A({ id: 'b2', artist: 'Kael Rivers', genre: 'Ambient' }),
  ]);
  const list = rec.station(big, { seedId: 'a5', length: 4, noRepeatArtists: true });
  const artists = list.map((t) => t.artist);
  assert.strictEqual(new Set(artists).size, artists.length, artists.join(','));
});

test('shelves build from a library', () => {
  const history = { a1: { plays: 3, completed: 3, skips: 0, lastPlayed: Date.now() }, a5: { plays: 2, completed: 0, skips: 2, lastPlayed: Date.now() } };
  const shelves = rec.shelves(POOL, history);
  assert.ok(shelves.onRepeat.length >= 1);
  assert.strictEqual(shelves.onRepeat[0].id, 'a1');
  assert.strictEqual(shelves.recentlyAdded.length, POOL.length);
  assert.ok(shelves.genres.length >= 3, JSON.stringify(shelves.genres.map((g) => g.genre)));
});

test('shelves skip the artist shelf below three tracks', () => {
  const shelves = rec.shelves(POOL.slice(0, 3), {});
  assert.strictEqual(shelves.artists.length, 0);
});

test('continueQueue keeps going without repeats', () => {
  const history = { a1: { plays: 2, completed: 2, skips: 0, lastPlayed: Date.now() } };
  const queue = rec.continueQueue(POOL, 'a1', history, ['a1', 'a3'], 3);
  assert.ok(queue.length >= 1, 'empty continuation');
  const ids = queue.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('a1') && !ids.includes('a3'), ids.join(','));
});

test('continueQueue falls back to a plain station for a lost seed', () => {
  const queue = rec.continueQueue(POOL, 'gone', {}, [], 2);
  assert.strictEqual(queue.length, 2);
});

test('genreTokens splits messy tags', () => {
  assert.deepStrictEqual(rec.genreTokens('Ambient; Downtempo, ambient'), ['ambient', 'downtempo']);
  assert.deepStrictEqual(rec.genreTokens(''), []);
  assert.deepStrictEqual(rec.genreTokens(null), []);
});

/* ------------------------------------------------------------------ report */
fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.error(`CORE TESTS FAILED — ${fails.length} of ${passed + fails.length}`);
  fails.forEach((f) => console.error(' ✗', f));
  process.exit(1);
}
console.log(`core tests: ${passed} passed`);
