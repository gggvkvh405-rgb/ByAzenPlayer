# ByAzen — desktop app

Electron shell around the concept design. **It plays your own music files** —
point it at a folder and it reads the tags, the artwork and the audio locally.
There is no account, no login, no upload: everything happens on this machine.

```
app/
  main.js              frameless window, media protocol, IPC, prefs
  preload.js           contextBridge API (window.byazen) + native drag & drop
  meta.js              dependency-free tag reader (ID3v2.2/2.3/2.4, FLAC, M4A)
  library.js           folder walk, artwork cache, index in userData
  recommend.js         offline "Radio": similarity + play/skip affinity
  audius.js            public Audius API client (charts, search, streams)
  renderer/index.html  UI shell
  renderer/styles.css  design tokens + layout
  renderer/app.js      library, queue, transport, lyrics, views, hotkeys
  renderer/assets/     demo covers/tracks/fonts (bundled)
  build/icon.ico       app icon (from the concept sheet)
```

## What it plays

`MP3 · FLAC · M4A/AAC · OGG · Opus · WAV · AIFF · WMA` — whatever Chromium can
decode, which is everything common except DRM-protected files.

Tags are parsed in-process (no native modules):

* **ID3v2.2 / 2.3 / 2.4** — title, artist, album, album artist, track, genre, year,
  BPM, embedded APIC artwork (UTF-8, UTF-16, Latin-1).
* **FLAC** — STREAMINFO (rate/channels/bit depth), Vorbis comments, PICTURE block.
* **M4A/MP4** — `moov.udta.meta.ilst` atoms (`©nam`, `©ART`, `©alb`, `©gen`, `©day`,
  `aART`, `trkn`, `covr`).

Artwork resolution order: embedded → `cover/folder/front/album/artwork/art.jpg|png|webp`
in the track's folder → a soft placeholder. Files without tags fall back to the
`Artist - Title` filename convention and the folder name as the album.

## Library

* **Add folder…** (Library or Settings) or **drag a folder onto the window**.
* Folders are rescanned on demand; the index lives in
  `%APPDATA%/ByAzen/cache/library.json`, artwork is extracted once into
  `%APPDATA%/ByAzen/cache/art/`.
* A background refresh on launch only re-reads files whose mtime changed and
  drops files that disappeared.
* Searches match title, artist, album and genre; the chips switch the grid
  between albums, artists and genres.

## Catalogue (Audius)

`app/audius.js` talks to the public Audius API: `GET https://api.audius.co` lists
discovery hosts, then `/v1/tracks/trending`, `/v1/tracks/trending/underground`,
`/v1/tracks/search`, `/v1/users/{id}/tracks`, `/v1/playlists/{id}` and
`/v1/tracks/{id}/stream`. Requests identify the app with `app_name=ByAzen`,
results are cached for two minutes, hosts rotate on failure, and gated
(purchase-only) tracks are filtered out.

Streams are played through `byazen://stream/<trackId>`, which proxies the
redirect target with `net.fetch` and forwards Range headers, so seeking behaves
like a local file and the page never depends on a remote CORS policy. The last
successful chart is stored in `%APPDATA%/ByAzen/audius-cache.json` and shown when
the network is down.

## Recommendations (offline)

Radio is generated from your own collection — no servers involved:

* `similarity()` mixes genre overlap, same artist / album artist, same album,
  tempo proximity, era and track length into a 0..1 score.
* `affinity()` scores tracks from local play counts: `plays + 1.5·completions −
  2.2·skips`, decaying with a 21-day half-life, so skipped tracks sink.
* **Stations** come from genre clusters, "more like this artist" and favourites;
  when a station runs out the renderer asks for a fresh batch seeded on the last
  track instead of stopping.
* Home shows **On repeat**, **Recently added** and **Radio** shelves.

Play/skip/finish events are stored in `%APPDATA%/ByAzen/prefs.json`, together
with volume and favourites. Nothing leaves the machine.

## Lyrics

There is no lyrics provider, so ByAzen reads a **`.lrc` sidecar**: put
`Track.lrc` next to `Track.mp3` and the lines appear, highlighted as playback
advances. Without one the panel says so instead of showing fabricated lyrics.

## Controls

`Space` play/pause · `←/→` prev/next · `↑/↓` volume · `S` shuffle · `R` repeat ·
`M` mute · `/` search.

## Tests

```bash
node tools/test-core.js    # tag reader, scanner, recommendation engine (20 checks)
node tools/smoke-test.js   # boots the renderer in jsdom with a fake bridge
```

Both run in CI before the Windows build is packaged.

## Run from source

```bash
cd app && npm install --no-save electron@32.2.0 && npx electron .
```

The Windows `.exe` is built by `.github/workflows/build-windows.yml` and attached
to the GitHub release.
