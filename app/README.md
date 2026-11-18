# ByAzen — desktop app

Electron shell around the concept design. Plays the eight generated demo tracks
from `renderer/assets/tracks` (44.1 kHz / 16-bit WAV), no network at runtime.

```
app/
  main.js              frameless window + IPC (min/max/close, app info)
  preload.js           contextBridge API (window.byazen)
  renderer/index.html  UI shell
  renderer/styles.css  design tokens + layout
  renderer/app.js      library, queue, transport, lyrics, views, hotkeys
  renderer/assets/     covers, tracks, fonts (bundled)
  build/icon.ico       app icon (from the concept sheet)
```

Controls: `Space` play/pause · `←/→` prev/next · `↑/↓` volume · `S` shuffle ·
`R` repeat · `M` mute · `/` search.

Build (needs Windows or Wine for a win32 target):

```bash
cd app
npm install --no-save electron@32.2.0 @electron/packager@18.3.6
npx electron-packager . ByAzen --platform=win32 --arch=x64 --out=dist \
  --overwrite --icon=build/icon.ico --asar
```

Run from source:

```bash
cd app && npm install --no-save electron@32.2.0 && npx electron .
```
