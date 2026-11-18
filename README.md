# ByAzen — UI/UX concept sheet

A premium desktop music player, presented as a single portrait presentation board
with four labelled sections:

1. **Main player window** — 1280 × 800 layout: sidebar + wordmark, now playing with
   large album art, transport, volume, up-next queue and a frosted synced-lyrics card.
2. **Expanded library view** — grid of warm album cards, filter chips (All / Albums /
   Artists / Genres / Playlists), recently-played list, genre and stat panels.
3. **App icon** — abstract "BA" monogram built from two soundwave ribbons, matte
   embossed on a cream → terracotta gradient, with a hidden music note in the
   negative space, plus a scale test (120 / 72 / 40 px).
4. **Color & typography** — warm cream, card white, graphite, terracotta and soft
   sage swatches; Playfair Display (display) + Inter (UI) pairing.

## Windows app

`release v1.0.0` ships a portable build (no installer):

**https://github.com/gggvkvh405-rgb/ByAzenPlayer/releases/download/v1.0.0/ByAzen-win32-x64-portable.zip**
(≈143 MB — Electron runtime + app + eight demo tracks)

Unzip anywhere and run `ByAzen.exe`. It is unsigned, so Windows SmartScreen will
ask once: *More info → Run anyway*.

What actually works in the app: play/pause, next/prev, shuffle, repeat, seeking,
volume, queue, per-track synced lyrics, library grid with search, playlists,
generated radio stations, settings, and hotkeys (`Space`, `←/→`, `↑/↓`, `S`, `R`,
`M`, `/`). Audio is eight original tracks synthesised in `tools/gen-assets.js`.

Rebuild it: push to `app/` (or run *Actions → Build Windows app → Run workflow*).
The workflow smoke-tests the renderer, assembles the portable folder, stamps the
icon/version, launches the exe to prove it starts, and attaches the zip to the
release. See `app/README.md`.

## Deliverables

| File | What it is |
| --- | --- |
| `byazen-concept-sheet.png` | Master board, 3200 × 5608 (2× of 1600 × 2804), sharp at any print size |
| `exports/byazen-concept-sheet-1600.png` | 1× board for the web / quick viewing |
| `exports/byazen-app-icon-1024.png` | App icon, 1024 × 1024 |
| `exports/byazen-app-icon-512.png` / `-180.png` | Icon at 512 and touch-icon 180 |
| `exports/byazen-app-icon-*.svg` | Vector icon (crisp at any size) |
| `design/byazen-concept-sheet.svg` | Full board as vector artwork |
| `design/build.js` | Generator — the board is drawn in code |

## Rebuilding

```bash
npm install      # only dependency: @resvg/resvg-js (Rust SVG renderer)
npm run build    # writes the PNGs, SVGs into the repo root and exports/
```

`SCALE=1 npm run build` renders the master at 1× instead of 2×.

## Design tokens

| Token | Value |
| --- | --- |
| Warm Cream | `#F5F1EA` |
| Card White | `#FDFBF7` |
| Graphite | `#1E1E1E` |
| Terracotta | `#C4704F` |
| Soft Sage | `#8A9A7B` |
| Display | Playfair Display 400/500/600 |
| UI | Inter 400/500/600 |
| Radii | 16–24 px (icon 22.5%, i.e. squircle 92/400) |
| Elevation | 0 / 1 / 2, soft warm shadows — no glow, no neon |
| Texture | 3–4 % film grain over the whole board |

Fonts are bundled in `design/fonts/` (SIL Open Font License, via Fontsource), so the
build is fully offline and renders identically on any machine.
