/**
 * ByAzen — UI/UX concept sheet generator.
 * Draws the board as SVG in a 1600 × PAGE_H coordinate space, then renders a
 * 2x PNG with resvg.
 *
 *   npm i @resvg/resvg-js        (see design/README.md)
 *   node design/build.js
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

/* ------------------------------------------------------------------ palette */
const C = {
  cream: '#F5F1EA',
  paper: '#FBF8F3',
  card: '#FDFBF7',
  deskin: '#F1EBE1',
  graphite: '#1E1E1E',
  ink: '#2B2825',
  body: '#6B6259',
  muted: '#8A8177',
  faint: '#B3A99D',
  terra: '#C4704F',
  terraDeep: '#A85A3B',
  terraSoft: '#E4C6B6',
  sage: '#8A9A7B',
  sageDeep: '#5E6B52',
  hair: 'rgba(30,30,30,0.08)',
};

const FONTS = fs
  .readdirSync(path.join(__dirname, 'fonts'))
  .filter((f) => f.endsWith('.ttf'))
  .map((f) => path.join(__dirname, 'fonts', f));

/* --------------------------------------------------------------- primitives */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => Math.round(v * 100) / 100;

function rect(x, y, w, h, r = 0, fill = 'none', extra = '') {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(
    r
  )}" fill="${fill}" ${extra}/>`;
}
function circ(cx, cy, r, fill = 'none', extra = '') {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" ${extra}/>`;
}
function line(x1, y1, x2, y2, stroke = C.hair, w = 1, extra = '') {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(
    y2
  )}" stroke="${stroke}" stroke-width="${n(w)}" ${extra}/>`;
}
// resvg matches fonts by family name and ignores numeric weight, so each weight
// maps to the family name baked into the font file (e.g. "Inter SemiBold").
const FAMILY = {
  Inter: {
    300: 'Inter Light',
    400: 'Inter',
    500: 'Inter Medium',
    600: 'Inter SemiBold',
    700: 'Inter SemiBold',
    800: 'Inter ExtraBold',
  },
  'Playfair Display': {
    400: 'Playfair Display',
    500: 'Playfair Display Medium',
    600: 'Playfair Display SemiBold',
    700: 'Playfair Display',
    800: 'Playfair Display ExtraBold',
    900: 'Playfair Display Black',
  },
};
function faceFor(family, weight) {
  const table = FAMILY[family];
  if (!table) return family;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let pick = keys[0];
  for (const k of keys) if (weight >= k) pick = k;
  return table[pick];
}

function txt(x, y, s, o = {}) {
  const {
    size = 14,
    fill = C.ink,
    weight = 400,
    family = 'Inter',
    anchor = 'start',
    ls = 0,
    opacity = 1,
    extra = '',
  } = o;
  const face = faceFor(family, weight);
  return `<text x="${n(x)}" y="${n(y)}" font-family="${face}" font-size="${n(
    size
  )}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${n(
    ls
  )}" opacity="${opacity}" ${extra}>${esc(s)}</text>`;
}
const caps = (x, y, s, size = 8, fill = C.faint, ls = 2.2, anchor = 'start') =>
  txt(x, y, s, { size, weight: 600, ls, fill, anchor });

/* --------------------------------------------------------------- line icons */
const ICONS = {
  home: 'M3 10.6 10 4.2l7 6.4V17a1 1 0 0 1-1 1h-3.4v-4.6H7.4V18H4a1 1 0 0 1-1-1z',
  library: 'M4 4.6h3.1v12.8H4zM9.3 4.6h3.1v12.8H9.3zM14.9 5.9l2.9-1.2 4.3 10.4-2.9 1.2z',
  playlist: 'M4 6h9M4 10.5h9M4 15h6M16.8 8.6v7.1M16.8 8.6l2.8-.9v7.2M16.8 15.7a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0',
  radio:
    'M10 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M5.4 5.4a6.5 6.5 0 0 0 0 9.2M14.6 5.4a6.5 6.5 0 0 1 0 9.2M2.8 2.8a10.2 10.2 0 0 0 0 14.4M17.2 2.8a10.2 10.2 0 0 1 0 14.4',
  settings:
    'M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4',
  search: 'M9.2 3.6a5.6 5.6 0 1 1 0 11.2 5.6 5.6 0 0 1 0-11.2M13.4 13.4 17 17',
  shuffle:
    'M2.8 6h2.4c1.4 0 2.3.6 3.2 1.8l2.8 4c.9 1.2 1.8 1.8 3.2 1.8h2.4M13.4 10.8l2.6 2.8-2.6 2.6M2.8 13.6h2.4c1 0 1.7-.3 2.4-1M12 7.4c1-.9 2-1.4 3.2-1.4h2.8M13.4 3.2 16 6l-2.6 2.6',
  prev: 'M5 4.4v11.2M14.8 5 6.6 10l8.2 5z',
  next: 'M15 4.4v11.2M5.2 5 13.4 10 5.2 15z',
  play: 'M7.6 4.8 15 10l-7.4 5.2z',
  repeat:
    'M4 8.4V7.4A2.4 2.4 0 0 1 6.4 5h7M13.6 12v1a2.4 2.4 0 0 1-2.4 2.4H4M11.2 2.8 13.6 5l-2.4 2.2M6.8 12.6 4.4 14.8l2.4 2.2',
  volume: 'M3 8h2.6L9.4 5v10L5.6 12H3zM12 7.6a3.4 3.4 0 0 1 0 4.8M14.4 5.2a6.8 6.8 0 0 1 0 9.6',
  heart: 'M10 16.4s-6.2-3.7-6.2-8A3.3 3.3 0 0 1 10 6.4a3.3 3.3 0 0 1 6.2 2c0 4.3-6.2 8-6.2 8z',
  plus: 'M10 4.6v10.8M4.6 10h10.8',
  chev: 'm6.5 8.2 3.5 3.5 3.5-3.5',
  grid: 'M3.4 3.4h5.2v5.2H3.4zM11.4 3.4h5.2v5.2h-5.2zM3.4 11.4h5.2v5.2H3.4zM11.4 11.4h5.2v5.2h-5.2z',
  list: 'M3 5.4h14M3 10h14M3 14.6h14',
  clock: 'M10 3.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8M10 6.6V10l2.4 1.6',
  speak: 'M3 8.4h3.2L10 5.2v9.6L6.2 11.6H3zM12.4 8a2.8 2.8 0 0 1 0 4M14.4 5.8a5.8 5.8 0 0 1 0 8.4',
  check: 'm5 10.6 3.2 3.2L15 6.6',
  down: 'M10 4v9M6.4 9.8 10 13.4l3.6-3.6M4 16.4h12',
  bell: 'M10 3.4a4.4 4.4 0 0 1 4.4 4.4c0 4 1.4 5.2 1.4 5.2H4.2s1.4-1.2 1.4-5.2A4.4 4.4 0 0 1 10 3.4M8.4 16.4a1.8 1.8 0 0 0 3.2 0',
  expand: 'M12.6 3.6h3.8v3.8M7.4 16.4H3.6v-3.8M16.4 3.6l-4.1 4.1M3.6 16.4l4.1-4.1',
  sparkle: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.6 5.6l2.2 2.2M12.2 12.2l2.2 2.2M14.4 5.6l-2.2 2.2M7.8 12.2l-2.2 2.2',
};

function icon(name, x, y, s = 18, color = C.ink, w = 1.4, opacity = 1) {
  const k = s / 20;
  return `<g transform="translate(${n(x)},${n(y)}) scale(${n(
    k
  )})" fill="none" stroke="${color}" stroke-width="${n(
    w / k
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"><path d="${
    ICONS[name]
  }"/></g>`;
}
// corner-bracket "expand" glyph (explicit segments — reads better at 14px)
function expandGlyph(x, y, s = 14, color = C.faint, w = 1.5) {
  const k = s / 20;
  const seg = (a, b, c, d) =>
    `<path d="M${a} ${b}L${c} ${d}" />`;
  return `<g transform="translate(${n(x)},${n(y)}) scale(${n(
    k
  )})" fill="none" stroke="${color}" stroke-width="${n(
    w / k
  )}" stroke-linecap="round" stroke-linejoin="round">${seg(3, 8.2, 3, 3, 3)}${seg(
    3,
    3,
    8.2,
    3
  )}${seg(17, 11.8, 17, 17)}${seg(17, 17, 11.8, 17)}</g>`;
}
function iconFill(name, x, y, s = 18, color = C.ink, opacity = 1) {
  const k = s / 20;
  return `<g transform="translate(${n(x)},${n(y)}) scale(${n(
    k
  )})" fill="${color}" stroke="${color}" stroke-width="${n(
    1.1 / k
  )}" stroke-linejoin="round" opacity="${opacity}"><path d="${ICONS[name]}"/></g>`;
}

/* --------------------------------------------------------------- cover art */
const COVERS = {
  aurora: { a: '#F7E4CD', b: '#D98A5F', c: '#8E4A32', d: '#EFC79F', ink: '#5E3322' },
  sage: { a: '#EEEDDD', b: '#93A381', c: '#59654C', d: '#DDE2CC', ink: '#3E4936' },
  clay: { a: '#F5DFD2', b: '#BC7452', c: '#7C4A31', d: '#E9C0A8', ink: '#59301F' },
  sand: { a: '#F8F0E2', b: '#CBAA7D', c: '#8F7047', d: '#EEDCC0', ink: '#5C4629' },
  stone: { a: '#EAE5DC', b: '#7C766D', c: '#3E3A35', d: '#D6CFC3', ink: '#332F2B' },
  dusk: { a: '#EFE0D5', b: '#A16E5F', c: '#67413A', d: '#DCBCA9', ink: '#4B2E28' },
  olive: { a: '#F0ECDE', b: '#A5AA84', c: '#666C4C', d: '#DFE2C7', ink: '#454A33' },
  rose: { a: '#F7E7E1', b: '#C68F82', c: '#8A5E53', d: '#EDD2C7', ink: '#5E3C34' },
};

/** abstract warm album cover; `comp` picks the composition */
function cover(x, y, size, palKey = 'aurora', seed = 1, comp = 3, uid = 'c') {
  const p = COVERS[palKey] || COVERS.aurora;
  const k = size / 100;
  const id = `cv${uid}${seed}${comp}`;
  const r = mulberry(seed * 977 + 13);
  const ribbon = (y1, c1, w1, o1, y2, c2, w2, o2) =>
    `<path d="M-8 ${n(y1)}C16 ${n(y1 - 8)} 30 ${n(y1 - 16)} 50 ${n(
      y1 - 16
    )}s34 8 58 8" fill="none" stroke="${c1}" stroke-width="${w1}" opacity="${o1}"/>
     <path d="M-8 ${n(y2)}C18 ${n(y2 - 10)} 32 ${n(y2 - 20)} 52 ${n(
      y2 - 20
    )}s32 10 56 10" fill="none" stroke="${c2}" stroke-width="${w2}" opacity="${o2}"/>`;
  let art = '';
  if (comp === 0) {
    const sy = 44 + r() * 6;
    art = `<rect width="100" height="100" fill="${p.d}" opacity="0.55"/>
      <circle cx="50" cy="${n(sy)}" r="23" fill="#FFF3E1" opacity="0.78"/>
      <circle cx="50" cy="${n(sy)}" r="23" fill="none" stroke="${p.a}" stroke-width="0.6" opacity="0.7"/>
      ${ribbon(72, p.b, 10, 0.55, 64, p.a, 5, 0.5)}
      ${ribbon(85, p.c, 14, 0.34, 81, p.d, 3, 0.45)}`;
  } else if (comp === 1) {
    art = `<rect width="100" height="100" fill="${p.d}" opacity="0.42"/>
      <ellipse cx="50" cy="124" rx="88" ry="66" fill="${p.b}" opacity="0.5"/>
      <ellipse cx="50" cy="30" rx="56" ry="21" fill="#FFF4E5" opacity="0.55"/>
      ${[...Array(7)]
        .map(
          (_, i) =>
            `<circle cx="50" cy="120" r="${18 + i * 11}" fill="none" stroke="${p.a}" stroke-width="0.45" opacity="${(
              0.38 -
              i * 0.04
            ).toFixed(2)}"/>`
        )
        .join('')}
      <circle cx="50" cy="27" r="6.5" fill="#FFF6E9" opacity="0.85"/>`;
  } else if (comp === 2) {
    art = `<rect width="100" height="100" fill="${p.d}" opacity="0.5"/>
      <path d="M0 60C22 54 34 26 56 24s30 22 52 14v62H0z" fill="${p.b}" opacity="0.52"/>
      <path d="M0 73C24 67 36 45 58 43s28 20 50 12v45H0z" fill="${p.c}" opacity="0.34"/>
      <path d="M0 86C22 82 34 64 56 62s30 18 52 12v26H0z" fill="${p.b}" opacity="0.3"/>
      <circle cx="${n(64 + r() * 10)}" cy="${n(20 + r() * 5)}" r="11" fill="#FFF6E9" opacity="0.82"/>
      ${[0, 6, 12]
        .map(
          (o) =>
            `<path d="M0 ${52 + o}C24 ${46 + o} 38 ${22 + o} 60 ${20 + o}s26 18 48 12" fill="none" stroke="${
              p.a
            }" stroke-width="0.4" opacity="0.4"/>`
        )
        .join('')}`;
  } else if (comp === 3) {
    const dy = 6 + r() * 10;
    art = `<path d="M-6 ${78 + dy}C18 ${66 + dy} 26 ${34 + dy} 52 ${
      30 + dy
    }s34 22 56 8" fill="none" stroke="${p.b}" stroke-width="15" opacity="0.82"/>
      <path d="M-6 ${62 + dy}C18 ${50 + dy} 26 ${18 + dy} 52 ${
      14 + dy
    }s34 22 56 8" fill="none" stroke="${p.c}" stroke-width="4" opacity="0.42"/>
      <path d="M-6 ${94 + dy}C20 ${84 + dy} 30 ${60 + dy} 56 ${
      56 + dy
    }s30 18 52 6" fill="none" stroke="${p.a}" stroke-width="7" opacity="0.6"/>`;
  } else {
    art = `<path d="M0 100 42 0h22L24 100z" fill="${p.b}" opacity="0.68"/>
      <path d="M40 100 82 0h14L54 100z" fill="${p.c}" opacity="0.5"/>
      <circle cx="72" cy="30" r="17" fill="${p.a}" opacity="0.78"/>`;
  }
  return `<g>
  <defs>
    <linearGradient id="${id}g" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.d}"/>
    </linearGradient>
    <filter id="${id}b" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="0.32"/>
    </filter>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#3A2318" stop-opacity="0.15"/>
    </linearGradient>
    <clipPath id="${id}c"><rect width="100" height="100" rx="22"/></clipPath>
  </defs>
  <g transform="translate(${n(x)},${n(y)}) scale(${n(k)})" clip-path="url(#${id}c)">
    <rect width="100" height="100" fill="url(#${id}g)"/>
    <g filter="url(#${id}b)">${art}</g>
    <rect width="100" height="100" fill="url(#${id}s)"/>
  </g></g>`;
}

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================== 1. PLAYER */
function mainPlayer(uid) {
  const sbW = 236,
    upW = 308,
    cx0 = sbW,
    cw = 1280 - sbW - upW; // 736
  const P = [];
  const mid = cx0 + cw / 2;

  /* ---------------------------------------------------------- sidebar */
  P.push(rect(0, 0, sbW, 800, 0, C.deskin));
  P.push(rect(sbW - 1, 0, 1, 800, 0, 'rgba(30,30,30,0.05)'));
  P.push(txt(28, 52, 'By', { family: 'Playfair Display', size: 26, fill: C.graphite, ls: 0.4 }));
  P.push(txt(62, 52, 'Azen', { size: 21, weight: 600, fill: C.graphite, ls: 1.2 }));
  P.push(circ(122, 43, 2.1, C.terra));
  P.push(caps(29, 72, 'PREMIUM AUDIO', 7.4, C.faint, 2.6));

  P.push(caps(28, 124, 'BROWSE', 7.8, C.faint, 2.4));
  const nav = [
    ['home', 'Home', true],
    ['library', 'Library', false],
    ['playlist', 'Playlists', false],
    ['radio', 'Radio', false],
    ['settings', 'Settings', false],
  ];
  let ny = 142;
  nav.forEach(([ic, label, active]) => {
    if (active) {
      P.push(rect(16, ny - 5, sbW - 32, 38, 11, '#FFFFFF', 'opacity="0.92"'));
      P.push(rect(16, ny - 5, sbW - 32, 38, 11, 'none', 'stroke="rgba(30,30,30,0.045)"'));
      P.push(rect(16, ny + 7, 2.6, 14, 1.3, C.terra));
    }
    P.push(icon(ic, 34, ny + 6, 17, active ? C.terraDeep : C.muted, active ? 1.6 : 1.35));
    P.push(
      txt(64, ny + 19, label, {
        size: 13.4,
        weight: active ? 600 : 450,
        fill: active ? C.graphite : C.muted,
        ls: 0.1,
      })
    );
    ny += 42;
  });

  P.push(line(28, 374, sbW - 28, 374, 'rgba(30,30,30,0.07)'));
  P.push(caps(28, 400, 'YOUR LIBRARY', 7.8, C.faint, 2.4));
  [
    ['Aurora Sessions', '24'],
    ['Slow Mornings', '18'],
    ['Deep Focus', '42'],
  ].forEach(([t, cnt], i) => {
    P.push(circ(33, 424 + i * 25, 2.1, i === 0 ? C.terra : C.terraSoft));
    P.push(txt(46, 428 + i * 25, t, { size: 12.2, weight: 450, fill: '#5E574F' }));
    P.push(txt(sbW - 28, 428 + i * 25, cnt, { size: 9, fill: C.faint, anchor: 'end' }));
  });
  P.push(icon('plus', 30, 496, 13, C.terra, 1.5));
  P.push(txt(46, 506, 'New playlist', { size: 11.8, fill: C.terra }));

  /* sidebar footer card */
  const fy = 636;
  P.push(rect(20, fy, sbW - 40, 124, 16, '#FBF8F3', 'opacity="0.92"'));
  P.push(rect(20, fy, sbW - 40, 124, 16, 'none', 'stroke="rgba(30,30,30,0.05)"'));
  P.push(rect(34, fy + 16, 27, 27, 9, C.terra, 'opacity="0.13"'));
  P.push(icon('speak', 40, fy + 22, 15, C.terraDeep, 1.5));
  P.push(txt(70, fy + 28, 'Lossless', { size: 11.6, weight: 600, fill: C.graphite }));
  P.push(txt(70, fy + 43, '24-bit / 96 kHz', { size: 9.2, fill: C.faint, ls: 0.2 }));
  P.push(line(34, fy + 60, sbW - 34, fy + 60, 'rgba(30,30,30,0.06)'));
  P.push(txt(34, fy + 79, 'Aurora Lines', { size: 10.4, weight: 500, fill: '#5E574F' }));
  P.push(txt(34, fy + 93, 'Kael Rivers · FLAC', { size: 8.8, fill: C.faint }));
  P.push(rect(34, fy + 103, 168, 2.4, 1.2, '#E2D8CC'));
  P.push(rect(34, fy + 103, 64, 2.4, 1.2, C.terra));

  /* ---------------------------------------------------------- top bar */
  P.push(line(cx0, 76, 1280, 76, 'rgba(30,30,30,0.055)'));
  P.push(rect(cx0 + 24, 21, 338, 34, 17, C.deskin, 'opacity="0.95"'));
  P.push(icon('search', cx0 + 38, 30, 15, C.muted, 1.35));
  P.push(txt(cx0 + 62, 43, 'Search albums, artists, tracks', { size: 11.4, fill: C.faint }));
    // keycap hint
  P.push(rect(cx0 + 314, 30, 26, 17, 5, '#FFFFFF', 'opacity="0.85"'));
  P.push(txt(cx0 + 327, 42.4, '/', { size: 9, weight: 500, fill: C.faint, anchor: 'middle' }));
  P.push(icon('bell', 1234, 29, 16, C.muted, 1.3));
  P.push(circ(1212, 38, 15.5, '#E9D3C5'));
  P.push(circ(1212, 38, 15.5, 'none', 'stroke="rgba(255,255,255,0.85)" stroke-width="1.6"'));
  P.push(
    txt(1212, 42.4, 'KR', { size: 9.4, weight: 600, fill: '#8A4E36', anchor: 'middle', ls: 0.5 })
  );

  /* ---------------------------------------------------------- album art */
  const artS = 330,
    artX = mid - artS / 2,
    artY = 100;
  P.push(rect(artX + 2, artY + 16, artS, artS, 24, '#7A4A34', 'opacity="0.16" filter="url(#softBig)"'));
  P.push(cover(artX, artY, artS, 'aurora', 7, 2, `${uid}art`));
  P.push(rect(artX, artY, artS, artS, 24, 'none', 'stroke="rgba(255,255,255,0.5)" stroke-width="1"'));
  P.push(caps(artX, artY + artS + 28, 'AURORA LINES', 7, C.faint, 2.6));
  P.push(txt(artX + artS, artY + artS + 28, '2024 · LP', { size: 8.4, fill: C.faint, anchor: 'end' }));

  /* titles */
  P.push(
    txt(mid, 508, 'Aurora Lines', {
      family: 'Playfair Display',
      size: 34,
      fill: C.graphite,
      anchor: 'middle',
      ls: 0.2,
    })
  );
  P.push(txt(mid, 531, 'Kael Rivers  ·  Northern Light', { size: 12, fill: C.muted, anchor: 'middle', ls: 0.3 }));
  P.push(iconFill('heart', mid + 132, 494, 14, C.terra, 0.92));

  /* progress */
  const pbx = cx0 + 78,
    pbw = cw - 156,
    pby = 566;
  P.push(rect(pbx, pby, pbw, 4, 2, '#E4DACE'));
  P.push(rect(pbx, pby, pbw * 0.41, 4, 2, C.terra));
  P.push(circ(pbx + pbw * 0.41, pby + 2, 4.6, '#FFFFFF', `stroke="${C.terra}" stroke-width="1.6"`));
  P.push(txt(pbx, pby + 22, '1:42', { size: 10, fill: C.faint, ls: 0.2 }));
  P.push(txt(pbx + pbw, pby + 22, '−3:58', { size: 10, fill: C.faint, anchor: 'end', ls: 0.2 }));

  /* controls */
  const cy = 640;
  P.push(icon('shuffle', mid - 178, cy - 9, 17, C.muted, 1.35));
  P.push(iconFill('prev', mid - 110, cy - 10, 20, C.graphite, 0.92));
  P.push(circ(mid, cy, 27, C.terra));
  P.push(circ(mid, cy, 27, 'none', 'stroke="rgba(255,255,255,0.3)" stroke-width="1"'));
  P.push(`<path d="M${n(mid - 7)} ${n(cy - 9.6)} ${n(mid + 8.4)} ${n(cy)} ${n(mid - 7)} ${
    n(cy + 9.6)
  }z" fill="#FDF8F2"/>`);
  P.push(iconFill('next', mid + 90, cy - 10, 20, C.graphite, 0.92));
  P.push(icon('repeat', mid + 161, cy - 9, 17, C.muted, 1.35));

  /* volume */
  const vy = 712;
  P.push(icon('volume', mid - 98, vy - 8, 16, C.muted, 1.3));
  P.push(rect(mid - 66, vy, 108, 3.4, 1.7, '#E4DACE'));
  P.push(rect(mid - 66, vy, 62, 3.4, 1.7, '#B3A99D'));
  P.push(circ(mid - 4, vy + 1.7, 3.6, '#FFFFFF', 'stroke="#B3A99D" stroke-width="1.3"'));
  P.push(expandGlyph(mid + 82, vy - 7, 14, C.faint));

  /* ---------------------------------------------------------- right panel */
  const p0 = 1280 - upW;
  P.push(rect(p0, 0, upW, 800, 0, '#FCFAF6'));
  P.push(rect(p0, 0, 1, 800, 0, 'rgba(30,30,30,0.05)'));
  P.push(caps(p0 + 24, 104, 'UP NEXT', 8.2, C.faint, 2.4));
  P.push(txt(p0 + 24 + 72, 104, '12', { size: 8.2, weight: 600, fill: C.terra, ls: 1 }));
  P.push(txt(1256, 104, 'Clear', { size: 10, fill: C.terra, anchor: 'end' }));

  [
    ['Paper Moons', 'Nils Åberg', '3:24', 'sand', 3, 2],
    ['Low Tide', 'Mira Voss', '4:02', 'sage', 5, 3],
    ['Felt Piano', 'Aster Quartet', '2:58', 'clay', 9, 4],
    ['Northbound', 'Kael Rivers', '3:47', 'stone', 11, 2],
    ['Slow Light', 'Sable & Co.', '5:12', 'olive', 14, 3],
  ].forEach(([t, a, d, pal, sd, cp], i) => {
    const qy = 122 + i * 66;
    P.push(rect(p0 + 18, qy, upW - 36, 58, 13, i === 0 ? '#F4ECE0' : '#FFFFFF', `opacity="${i === 0 ? 1 : 0.68}"`));
    P.push(rect(p0 + 18, qy, upW - 36, 58, 13, 'none', 'stroke="rgba(30,30,30,0.045)"'));
    P.push(cover(p0 + 30, qy + 11, 36, pal, sd, cp, `${uid}q${i}`));
    P.push(txt(p0 + 78, qy + 25, t, { size: 11.6, weight: 500, fill: C.graphite }));
    P.push(txt(p0 + 78, qy + 40, a, { size: 9.4, fill: C.faint }));
    P.push(txt(p0 + upW - 34, qy + 25, d, { size: 9, fill: C.faint, anchor: 'end' }));
    if (i === 0) P.push(circ(p0 + upW - 37, qy + 40, 1.7, C.terra));
  });

  /* frosted lyric card */
  const gx = p0 + 18,
    gy = 476,
    gw = upW - 36,
    gh = 196;
  P.push(`<g>
    <defs>
      <linearGradient id="lgw${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#F6E7D8"/><stop offset="0.5" stop-color="#EBD3BF"/>
        <stop offset="1" stop-color="#DCC4AC"/>
      </linearGradient>
      <clipPath id="lgc${uid}"><rect x="${n(gx)}" y="${n(gy)}" width="${n(gw)}" height="${n(gh)}" rx="18"/></clipPath>
    </defs>
    <g clip-path="url(#lgc${uid})">
      <rect x="${n(gx)}" y="${n(gy)}" width="${n(gw)}" height="${n(gh)}" fill="url(#lgw${uid})"/>
      <circle cx="${n(gx + 36)}" cy="${n(gy + 44)}" r="92" fill="#FFF7EC" opacity="0.7" filter="url(#softBig)"/>
      <circle cx="${n(gx + gw - 16)}" cy="${n(gy + gh - 6)}" r="80" fill="#C0704B" opacity="0.22" filter="url(#softBig)"/>
      <rect x="${n(gx + 10)}" y="${n(gy + 10)}" width="${n(gw - 20)}" height="${n(gh - 20)}" rx="12" fill="#FFFDF8" opacity="0.45"/>
    </g>
    <rect x="${n(gx + 0.5)}" y="${n(gy + 0.5)}" width="${n(gw - 1)}" height="${n(gh - 1)}" rx="18" fill="none" stroke="rgba(255,255,255,0.55)"/>
    <rect x="${n(gx + 10.5)}" y="${n(gy + 10.5)}" width="${n(gw - 21)}" height="${n(gh - 21)}" rx="12" fill="none" stroke="rgba(255,255,255,0.28)"/>
  </g>`);
  P.push(caps(gx + 22, gy + 36, 'LYRICS', 7.4, 'rgba(60,36,24,0.55)', 2.4));
  [
    'We drift through aurora lines,',
    'a slow and golden thread —',
    'the night folds into morning',
    'and nothing needs to be said.',
  ].forEach((l, i) => {
    P.push(
      txt(gx + 22, gy + 68 + i * 22, l, {
        family: 'Playfair Display',
        size: 12.4,
        fill: i > 1 ? 'rgba(58,34,22,0.4)' : 'rgba(48,28,18,0.84)',
        ls: 0.1,
      })
    );
  });
  P.push(line(gx + 22, gy + 162, gx + gw - 22, gy + 162, 'rgba(60,36,24,0.16)'));
  P.push(txt(gx + 22, gy + 178, 'Synced · line by line', { size: 8.4, fill: 'rgba(48,28,18,0.62)' }));
  P.push(icon('chev', gx + gw - 38, gy + 167, 12, 'rgba(48,28,18,0.6)', 1.4));

  return P.join('\n');
}

/* ============================================================= 2. LIBRARY */
function libraryView(uid) {
  const sbW = 236,
    cx0 = sbW,
    cw = 1280 - sbW;
  const P = [];

  /* sidebar */
  P.push(rect(0, 0, sbW, 800, 0, C.deskin));
  P.push(rect(sbW - 1, 0, 1, 800, 0, 'rgba(30,30,30,0.05)'));
  P.push(txt(28, 52, 'By', { family: 'Playfair Display', size: 26, fill: C.graphite, ls: 0.4 }));
  P.push(txt(62, 52, 'Azen', { size: 21, weight: 600, fill: C.graphite, ls: 1.2 }));
  P.push(circ(122, 43, 2.1, C.terra));
  P.push(caps(29, 72, 'PREMIUM AUDIO', 7.4, C.faint, 2.6));
  P.push(caps(28, 124, 'BROWSE', 7.8, C.faint, 2.4));
  const nav = [
    ['home', 'Home', false],
    ['library', 'Library', true],
    ['playlist', 'Playlists', false],
    ['radio', 'Radio', false],
    ['settings', 'Settings', false],
  ];
  let ny = 142;
  nav.forEach(([ic, label, active]) => {
    if (active) {
      P.push(rect(16, ny - 5, sbW - 32, 38, 11, '#FFFFFF', 'opacity="0.92"'));
      P.push(rect(16, ny - 5, sbW - 32, 38, 11, 'none', 'stroke="rgba(30,30,30,0.045)"'));
      P.push(rect(16, ny + 7, 2.6, 14, 1.3, C.terra));
    }
    P.push(icon(ic, 34, ny + 6, 17, active ? C.terraDeep : C.muted, active ? 1.6 : 1.35));
    P.push(
      txt(64, ny + 19, label, {
        size: 13.4,
        weight: active ? 600 : 450,
        fill: active ? C.graphite : C.muted,
        ls: 0.1,
      })
    );
    ny += 42;
  });

  P.push(line(28, 374, sbW - 28, 374, 'rgba(30,30,30,0.07)'));
  P.push(caps(28, 400, 'YOUR LIBRARY', 7.8, C.faint, 2.4));
  ['Aurora Sessions', 'Slow Mornings', 'Deep Focus', 'Vinyl Rips'].forEach((t, i) => {
    P.push(circ(33, 424 + i * 25, 2.1, i === 0 ? C.terra : C.terraSoft));
    P.push(txt(46, 428 + i * 25, t, { size: 12.2, weight: i === 0 ? 550 : 450, fill: i === 0 ? C.graphite : '#5E574F' }));
  });
  P.push(line(28, 536, sbW - 28, 536, 'rgba(30,30,30,0.07)'));
  P.push(caps(28, 562, 'SMART', 7.8, C.faint, 2.4));
  [
    ['clock', 'Recently added'],
    ['heart', 'Loved'],
    ['down', 'Downloaded'],
  ].forEach(([ic, label], i) => {
    P.push(icon(ic, 34, 580 + i * 27, 15, C.muted, 1.3));
    P.push(txt(60, 592 + i * 27, label, { size: 11.8, fill: '#5E574F' }));
  });

  P.push(rect(20, 686, sbW - 40, 68, 14, 'rgba(255,255,255,0.6)'));
  P.push(rect(20, 686, sbW - 40, 68, 14, 'none', 'stroke="rgba(30,30,30,0.05)"'));
  P.push(circ(44, 720, 11, '#C9D2BC'));
  P.push(icon('check', 37, 713, 13, C.sageDeep, 1.7));
  P.push(txt(64, 716, 'Library synced', { size: 11, weight: 550, fill: C.graphite }));
  P.push(txt(64, 731, '12,406 tracks · just now', { size: 8.6, fill: C.faint }));

  /* header */
  P.push(txt(cx0 + 32, 62, 'Library', { family: 'Playfair Display', size: 29, fill: C.graphite, ls: 0.2 }));
  P.push(txt(cx0 + 158, 60, '1,284 albums  ·  12,406 tracks', { size: 10.4, fill: C.faint, ls: 0.3 }));

  P.push(rect(cx0 + 404, 31, 236, 33, 16.5, C.deskin, 'opacity="0.9"'));
  P.push(icon('search', cx0 + 418, 40, 14, C.muted, 1.35));
  P.push(txt(cx0 + 440, 52, 'Search library', { size: 10.8, fill: C.faint }));
  P.push(rect(cx0 + 656, 31, 132, 33, 16.5, '#FFFFFF', 'opacity="0.85"'));
  P.push(rect(cx0 + 656, 31, 132, 33, 16.5, 'none', 'stroke="rgba(30,30,30,0.055)"'));
  P.push(icon('clock', cx0 + 668, 40, 14, C.muted, 1.25));
  P.push(txt(cx0 + 688, 51.5, 'Recently added', { size: 9.4, fill: '#6B6259' }));
  P.push(icon('chev', cx0 + 764, 42, 11, C.faint, 1.4));
  P.push(rect(cx0 + 800, 31, 64, 33, 16.5, 'rgba(255,255,255,0.8)'));
  P.push(rect(cx0 + 800, 31, 64, 33, 16.5, 'none', 'stroke="rgba(30,30,30,0.055)"'));
  P.push(rect(cx0 + 803.5, 34.5, 29, 26, 13, '#FFFFFF', 'stroke="rgba(30,30,30,0.05)"'));
  P.push(icon('grid', cx0 + 811, 42, 13, C.terraDeep, 1.45));
  P.push(icon('list', cx0 + 840, 42, 13, C.faint, 1.3));

  /* chips */
  const chips = ['All', 'Albums', 'Artists', 'Genres', 'Playlists'];
  let chx = cx0 + 32;
  chips.forEach((c, i) => {
    const on = i === 0;
    const w = 20 + c.length * 6.2;
    P.push(rect(chx, 84, w, 27, 13.5, on ? C.graphite : 'rgba(255,255,255,0.75)'));
    if (!on) P.push(rect(chx, 84, w, 27, 13.5, 'none', 'stroke="rgba(30,30,30,0.06)"'));
    P.push(
      txt(chx + w / 2, 101.5, c, {
        size: 10.2,
        weight: on ? 550 : 450,
        fill: on ? '#F7F2EA' : '#6B6259',
        anchor: 'middle',
        ls: 0.2,
      })
    );
    chx += w + 8;
  });
  P.push(txt(cx0 + cw - 32, 101, '1,284 albums', { size: 9.2, fill: C.faint, anchor: 'end', ls: 0.3 }));

  /* album grid */
  const gx0 = cx0 + 32,
    gy0 = 130,
    cs = 138,
    gap = 20;
  const albums = [
    ['Aurora Lines', 'Kael Rivers', 'aurora', 7, 2],
    ['Paper Moons', 'Nils Åberg', 'sand', 3, 2],
    ['Low Tide', 'Mira Voss', 'sage', 5, 3],
    ['Felt Piano', 'Aster Quartet', 'clay', 9, 4],
    ['Northbound', 'Kael Rivers', 'stone', 11, 2],
    ['Slow Light', 'Sable & Co.', 'olive', 14, 3],
    ['Harbour', 'Ines Roux', 'dusk', 17, 2],
    ['Wildflower', 'June Alba', 'rose', 21, 4],
  ];
  albums.forEach(([t, a, pal, sd, cp], i) => {
    const x = gx0 + (i % 4) * (cs + gap),
      y = gy0 + Math.floor(i / 4) * 200;
    P.push(rect(x + 1, y + 12, cs, cs, 12, '#7A5A45', 'opacity="0.14" filter="url(#softSm)"'));
    P.push(cover(x, y, cs, pal, sd, cp, `${uid}g${i}`));
    P.push(rect(x, y, cs, cs, 12, 'none', 'stroke="rgba(255,255,255,0.45)"'));
    if (i === 0) {
      P.push(rect(x + 9, y + 9, 58, 19, 9.5, 'rgba(255,255,255,0.8)'));
      P.push(txt(x + 38, y + 22, 'PLAYING', { size: 6.4, weight: 600, ls: 1.6, fill: '#7C462F', anchor: 'middle' }));
    }
    P.push(txt(x, y + cs + 21, t, { size: 11.6, weight: 550, fill: C.graphite }));
    P.push(txt(x, y + cs + 35, `${a}  ·  ${12 + i * 3}`, { size: 9.4, fill: C.faint }));
  });
  // third row — cropped by the bottom bar, implying scroll
  [
    ['Clay & Ash', 'Oren Vale', 'clay', 26, 2],
    ['Night Bus', 'Mira Voss', 'dusk', 29, 3],
    ['Pale Coast', 'Sable & Co.', 'sand', 32, 4],
    ['Hush', 'June Alba', 'stone', 35, 2],
  ].forEach(([t, a, pal, sd, cp], i) => {
    const x = gx0 + i * (cs + gap),
      y = gy0 + 2 * 200 - 24;
    P.push(cover(x, y, cs, pal, sd, cp, `${uid}h${i}`));
    P.push(txt(x, y + cs + 21, t, { size: 11.6, weight: 550, fill: C.graphite }));
    P.push(txt(x, y + cs + 35, `${a}  ·  ${14 + i * 4}`, { size: 9.4, fill: C.faint }));
  });
  // sidebar-style right list
  const lx = cx0 + 726,
    lw = cw - 726 - 32;
  P.push(rect(lx, 84, lw, 616, 16, 'rgba(255,255,255,0.62)'));
  P.push(rect(lx, 84, lw, 616, 16, 'none', 'stroke="rgba(30,30,30,0.055)"'));
  P.push(caps(lx + 22, 114, 'RECENTLY PLAYED', 7.8, C.faint, 2.2));
  P.push(txt(lx + lw - 22, 114, 'View all', { size: 9.2, fill: C.terra, anchor: 'end' }));
  const recents = [
    ['Aurora Lines', 'Kael Rivers', '3:58', 'aurora', 7, 2],
    ['Low Tide', 'Mira Voss', '4:02', 'sage', 5, 3],
    ['Felt Piano', 'Aster Quartet', '2:58', 'clay', 9, 4],
    ['Paper Moons', 'Nils Åberg', '3:24', 'sand', 3, 2],
    ['Wildflower', 'June Alba', '3:12', 'rose', 21, 4],
    ['Harbour', 'Ines Roux', '4:41', 'dusk', 17, 2],
    ['Slow Light', 'Sable & Co.', '5:12', 'olive', 14, 3],
  ];
  recents.forEach(([t, a, d, pal, sd, cp], i) => {
    const ry = 146 + i * 43;
    if (i === 0) P.push(rect(lx + 12, ry - 7, lw - 24, 41, 10, '#F5EDE1'));
    P.push(cover(lx + 20, ry - 2, 32, pal, sd, cp, `${uid}r${i}`));
    P.push(txt(lx + 64, ry + 11, t, { size: 11, weight: i === 0 ? 600 : 500, fill: C.graphite }));
    P.push(txt(lx + 64, ry + 24, a, { size: 8.8, fill: C.faint }));
    P.push(txt(lx + lw - 22, ry + 16, d, { size: 8.8, fill: C.faint, anchor: 'end' }));
  });
  let ry = 146 + recents.length * 43 - 2;
  P.push(line(lx + 22, ry, lx + lw - 22, ry, 'rgba(30,30,30,0.07)'));
  P.push(caps(lx + 22, ry + 26, 'GENRES', 7.8, C.faint, 2.2));
  let gyy = ry + 42,
    gxx = lx + 22;
  ['Ambient', 'Modern Classical', 'Soul', 'Folk', 'Jazz', 'Downtempo'].forEach((g, i) => {
    const gw = 18 + g.length * 5.3;
    if (gxx + gw > lx + lw - 22) {
      gxx = lx + 22;
      gyy += 31;
    }
    P.push(rect(gxx, gyy, gw, 23, 11.5, i === 1 ? '#EFE1D3' : 'rgba(255,255,255,0.9)'));
    P.push(rect(gxx, gyy, gw, 23, 11.5, 'none', 'stroke="rgba(30,30,30,0.05)"'));
    P.push(
      txt(gxx + gw / 2, gyy + 15, g, {
        size: 9.2,
        fill: i === 1 ? '#8A4E36' : '#6B6259',
        anchor: 'middle',
      })
    );
    gxx += gw + 7;
  });
  P.push(caps(lx + 22, gyy + 60, 'LIBRARY', 7.8, C.faint, 2.2));
  [['1,284', 'Albums'], ['1,096', 'Artists'], ['386', 'Playlists']].forEach(([v, k], i) => {
    P.push(txt(lx + 22 + i * 88, gyy + 96, v, { family: 'Playfair Display', size: 22, fill: C.graphite }));
    P.push(txt(lx + 22 + i * 88, gyy + 114, k, { size: 8.4, ls: 0.6, fill: C.faint }));
  });

  /* bottom now-playing bar */
  P.push(rect(cx0, 728, cw, 72, 0, '#FCFAF6'));
  P.push(rect(cx0, 728, cw, 1, 0, 'rgba(30,30,30,0.06)'));
  P.push(cover(cx0 + 24, 744, 40, 'aurora', 7, 2, `${uid}bar`));
  P.push(txt(cx0 + 76, 762, 'Aurora Lines', { size: 11.4, weight: 550, fill: C.graphite }));
  P.push(txt(cx0 + 76, 776, 'Kael Rivers', { size: 9, fill: C.faint }));
  P.push(iconFill('heart', cx0 + 198, 754, 13, C.terra, 0.85));
  const m2 = cx0 + cw / 2;
  P.push(icon('shuffle', m2 - 120, 752, 14, C.faint, 1.3));
  P.push(iconFill('prev', m2 - 68, 751, 16, C.graphite, 0.9));
  P.push(circ(m2 - 2, 764, 19, C.terra));
  P.push(`<path d="M${n(m2 - 7)} 756 ${n(m2 + 7)} 764 ${n(m2 - 7)} 772z" fill="#FDF8F2"/>`);
  P.push(iconFill('next', m2 + 48, 751, 16, C.graphite, 0.9));
  P.push(icon('repeat', m2 + 98, 752, 14, C.faint, 1.3));
  P.push(rect(cx0 + 250, 794, cw - 500, 2, 1, '#E6DCD0'));
  P.push(rect(cx0 + 250, 794, (cw - 500) * 0.41, 2, 1, C.terra));
  P.push(icon('volume', cx0 + cw - 176, 752, 15, C.muted, 1.3));
  P.push(rect(cx0 + cw - 152, 760, 78, 3, 1.5, '#E4DACE'));
  P.push(rect(cx0 + cw - 152, 760, 44, 3, 1.5, '#B3A99D'));
  P.push(icon('playlist', cx0 + cw - 48, 752, 15, C.muted, 1.3));

  return P.join('\n');
}

/* =============================================================== 3. ICON */
const GLYPH_B =
  'M48 54V146M48 54C48 54 88 48 97 71C105 92 79 100 53 100M53 100C88 100 109 111 104 127C99 143 78 148 48 146';
const GLYPH_A = 'M118 147 146 57 174 147';
const GLYPH_BAR = 'M128 121h36';

/** app icon tile; local coordinate space is 400 x 400 */
function appIcon(size = 380, x = 0, y = 0, uid = 'ai', opt = {}) {
  const k = size / 400;
  const gs = opt.glyphScale || 1.72;
  const gx = opt.glyphX || 0;
  const ox = 200 - 100 * gs + gx,
    oy = 200 - 100 * gs;
  return `<g transform="translate(${n(x)},${n(y)}) scale(${n(k)})">
  <defs>
    <linearGradient id="${uid}bg" x1="0.08" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#FDF7ED"/><stop offset="0.42" stop-color="#F2DCC8"/>
      <stop offset="1" stop-color="#C4704F"/>
    </linearGradient>
    <radialGradient id="${uid}gl" cx="0.22" cy="0.1" r="0.95">
      <stop offset="0" stop-color="#FFFCF6" stop-opacity="0.8"/>
      <stop offset="0.5" stop-color="#FFF9F1" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#A85A3B" stop-opacity="0.12"/>
    </radialGradient>
    <linearGradient id="${uid}ink" x1="0.15" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#9A5133"/><stop offset="0.6" stop-color="#AB5F3D"/>
      <stop offset="1" stop-color="#B96F4B"/>
    </linearGradient>
    <filter id="${uid}blur" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
    <filter id="${uid}emb" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
    <filter id="${uid}lift" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2.4" stdDeviation="3" flood-color="#6E3A22" flood-opacity="0.28"/>
    </filter>
    <clipPath id="${uid}cl"><rect width="400" height="400" rx="92"/></clipPath>
  </defs>
  <g clip-path="url(#${uid}cl)">
    <rect width="400" height="400" fill="url(#${uid}bg)"/>
    <rect width="400" height="400" fill="url(#${uid}gl)"/>
    <circle cx="96" cy="70" r="126" fill="#FFFAF1" opacity="0.55" filter="url(#${uid}blur)"/>
    <circle cx="352" cy="386" r="130" fill="#A0553A" opacity="0.22" filter="url(#${uid}blur)"/>
    <g opacity="0.1" fill="#FFF7EA">
      <ellipse cx="110" cy="332" rx="11" ry="8" transform="rotate(-20 110 332)"/>
      <rect x="117.6" y="272" width="4.2" height="60" rx="2.1"/>
      <path d="M121.8 272 160 264v12l-38.2 8z"/>
      <rect x="155.8" y="270" width="4.2" height="38" rx="2.1"/>
      <ellipse cx="148" cy="308" rx="11" ry="8" transform="rotate(-20 148 308)"/>
    </g>
    <g transform="translate(${n(ox)},${n(oy)}) scale(${gs})">
      <g filter="url(#${uid}emb)" opacity="0.5" transform="translate(0.8,2)">
        <g fill="none" stroke="#8A4A2C" stroke-width="15.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="${GLYPH_B}"/><path d="${GLYPH_A}"/><path d="${GLYPH_BAR}"/>
        </g>
      </g>
      <g filter="url(#${uid}lift)" fill="none" stroke="url(#${uid}ink)" stroke-width="15.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="${GLYPH_B}"/><path d="${GLYPH_A}"/><path d="${GLYPH_BAR}"/>
      </g>
      <g fill="none" stroke="#FBEFE2" stroke-width="1.7" opacity="0.26" stroke-linecap="round" stroke-linejoin="round" transform="translate(-0.7,-1.6)">
        <path d="${GLYPH_B}"/><path d="${GLYPH_A}"/><path d="${GLYPH_BAR}"/>
      </g>
    </g>
  </g>
  <rect x="3" y="3" width="394" height="394" rx="90" fill="none" stroke="rgba(255,253,248,0.6)" stroke-width="2.6"/>
  <rect x="9" y="9" width="382" height="382" rx="85" fill="none" stroke="rgba(120,64,40,0.07)"/>
</g>`;
}

/* ============================================================== ASSEMBLE */
const W = 1600;
const M = 80;
const CW = W - M * 2; // 1440
const metaX = W - M;
const S = [];

/* header */
S.push(caps(M, 92, 'PRODUCT DESIGN  ·  CONCEPT SHEET  ·  V1.0', 9.2, C.faint, 3.4));
// hybrid wordmark: Playfair "By" + Inter SemiBold "Azen"
S.push(txt(M, 158, 'By', { family: 'Playfair Display', size: 64, fill: C.graphite, ls: 0.6 }));
S.push(txt(M + 78, 157, 'Azen', { size: 51, weight: 600, fill: C.graphite, ls: 1.6 }));
S.push(circ(M + 280, 127, 3.6, C.terra));
S.push(
  txt(M, 188, 'A premium desktop music player — quiet surfaces, warm light, generous air.', {
    size: 14.4,
    fill: C.body,
    ls: 0.1,
  })
);
S.push(caps(metaX, 92, 'UI / UX', 9.2, C.faint, 2.6, 'end'));
[
  'Desktop · macOS / Windows',
  'Inter + Playfair Display',
  'Warm cream / graphite / terracotta',
].forEach((t, i) => S.push(txt(metaX, 114 + i * 19, t, { size: 11.2, fill: C.body, anchor: 'end' })));
S.push(line(M, 216, metaX, 216, 'rgba(30,30,30,0.12)'));

/* section header helper */
function sectionLabel(num, title, caption, yy, endX = metaX, startX = M) {
  const out = [];
  out.push(txt(startX, yy, num, { family: 'Playfair Display', size: 16, fill: C.terra, ls: 1 }));
  out.push(caps(startX + 36, yy - 1, title, 9.2, '#4A443D', 2.6));
  const tw = startX + 36 + title.length * 8.6 + 18;
  out.push(line(tw, yy - 4, endX, yy - 4, 'rgba(30,30,30,0.1)'));
  if (caption) out.push(txt(endX, yy - 1, caption, { size: 9, fill: C.faint, anchor: 'end', ls: 0.3 }));
  return out.join('\n');
}

/* ---- 01 main player ---- */
let y = 256;
S.push(sectionLabel('01', 'MAIN PLAYER WINDOW', '1280 × 800  ·  Now playing, queue & lyrics', y));
const winW = 1320,
  winH = 825,
  winX = (W - winW) / 2,
  winY = y + 16;
const sc = winW / 1280;

S.push(`<g>
  ${rect(winX - 30, winY + 20, winW + 60, winH, 46, '#8B6E56', 'opacity="0.09" filter="url(#softHuge)"')}
  ${rect(winX + 2, winY + 20, winW, winH, 30, '#7A5942', 'opacity="0.16" filter="url(#softHuge)"')}
  ${rect(winX, winY, winW, winH, 22, C.paper)}
  <g transform="translate(${n(winX)},${n(winY)}) scale(${n(sc)})">
    <clipPath id="clipMain"><rect width="1280" height="800" rx="${n(22 / sc)}"/></clipPath>
    <g clip-path="url(#clipMain)">${mainPlayer('m')}</g>
  </g>
  ${rect(winX + 0.5, winY + 0.5, winW - 1, winH - 1, 22, 'none', 'stroke="rgba(30,30,30,0.10)"')}
  ${rect(winX + 0.5, winY + 0.5, winW - 1, winH - 1, 22, 'none', 'stroke="rgba(255,255,255,0.5)" stroke-width="1"')}
</g>`);

/* ---- 02 library ---- */
y = winY + winH + 76;
S.push(sectionLabel('02', 'EXPANDED LIBRARY VIEW', '1280 × 800  ·  Grid, filters & detail list', y));
const libY = y + 16;
S.push(`<g>
  ${rect(winX + 2, libY + 20, winW, winH, 30, '#7A5942', 'opacity="0.16" filter="url(#softHuge)"')}
  ${rect(winX, libY, winW, winH, 22, C.paper)}
  <g transform="translate(${n(winX)},${n(libY)}) scale(${n(sc)})">
    <clipPath id="clipLib"><rect width="1280" height="800" rx="${n(22 / sc)}"/></clipPath>
    <g clip-path="url(#clipLib)">${libraryView('l')}</g>
  </g>
  ${rect(winX + 0.5, libY + 0.5, winW - 1, winH - 1, 22, 'none', 'stroke="rgba(30,30,30,0.10)"')}
  ${rect(winX + 0.5, libY + 0.5, winW - 1, winH - 1, 22, 'none', 'stroke="rgba(255,255,255,0.5)" stroke-width="1"')}
</g>`);

/* ---- 03 + 04 ---- */
const rowY = libY + winH + 80;
const cardW = (CW - 40) / 2; // 700
const cardH = 560;
const icY = rowY + 16;

/* 03 app icon */
S.push(sectionLabel('03', 'APP ICON', '1024 × 1024  ·  Monogram & scale test', rowY, M + cardW - 8));
S.push(rect(M, icY, cardW, cardH, 24, 'rgba(255,255,255,0.55)'));
S.push(rect(M + 0.5, icY + 0.5, cardW - 1, cardH - 1, 24, 'none', 'stroke="rgba(30,30,30,0.07)"'));
S.push(caps(M + 26, icY + 32, 'MATTE EMBOSS  ·  NO GLOW', 7.6, C.faint, 2.4));
S.push(txt(M + cardW - 26, icY + 32, 'BA', { family: 'Playfair Display', size: 15, fill: C.terra, anchor: 'end' }));

const icS = 330;
const icX = M + 74;
const icCardY = icY + 58;
S.push(rect(icX + 4, icCardY + 26, icS, icS, 76, '#7A5238', 'opacity="0.22" filter="url(#softBig)"'));
S.push(appIcon(icS, icX, icCardY, 'big'));

const varX = icX + icS + 48;
S.push(caps(varX, icCardY + 10, 'SCALE TEST', 7.4, C.faint, 2.2));
[
  [120, 0],
  [72, 140],
  [40, 232],
].forEach(([s, dy]) => {
  S.push(appIcon(s, varX, icCardY + 26 + dy, `ic${s}`, { glyphScale: s < 60 ? 1.8 : 1.72, glyphX: 0 }));
  S.push(txt(varX + s + 12, icCardY + 26 + dy + s / 2 + 3, `${s} px`, { size: 8.4, fill: C.faint }));
});
S.push(caps(varX, icCardY + 330, 'DOCK / RETAIL', 7.4, C.faint, 2.2));

S.push(line(M + 26, icY + cardH - 88, M + cardW - 26, icY + cardH - 88, 'rgba(30,30,30,0.08)'));
S.push(txt(M + 26, icY + cardH - 60, 'Two flowing soundwave ribbons intertwine into B and A;', { size: 9.8, fill: C.body }));
S.push(txt(M + 26, icY + cardH - 45, 'a music note rests in the negative space, 10% opacity.', { size: 9.8, fill: C.body }));
// arrow drawn as a path — U+2192 is not in the bundled subsets
{
  const ay = icY + cardH - 27;
  const ax = M + 26 + 141;
  S.push(
    txt(M + 26, icY + cardH - 24, 'Rounded square 22.5%  ·  Cream', {
      size: 8.6,
      fill: C.faint,
      ls: 0.2,
    })
  );
  S.push(
    `<g stroke="${C.faint}" stroke-width="0.9" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${n(ax)} ${n(ay)}h11"/><path d="M${n(ax + 7.6)} ${n(ay - 3.2)}l3.4 3.2-3.4 3.2"/>
    </g>`
  );
  S.push(
    txt(ax + 17, icY + cardH - 24, 'terracotta gradient  ·  Embossed, matte', {
      size: 8.6,
      fill: C.faint,
      ls: 0.2,
    })
  );
}

/* 04 palette + type */
const px = M + cardW + 40;
S.push(sectionLabel('04', 'COLOR & TYPOGRAPHY', 'Palette · Inter + Playfair Display', rowY, metaX, px));
S.push(rect(px, icY, cardW, cardH, 24, 'rgba(255,255,255,0.55)'));
S.push(rect(px + 0.5, icY + 0.5, cardW - 1, cardH - 1, 24, 'none', 'stroke="rgba(30,30,30,0.07)"'));

S.push(caps(px + 28, icY + 34, 'COLOR', 8, C.faint, 2.6));
[
  ['#F5F1EA', 'Warm Cream', 'F5F1EA'],
  ['#FDFBF7', 'Card White', 'FDFBF7'],
  ['#1E1E1E', 'Graphite', '1E1E1E'],
  ['#C4704F', 'Terracotta', 'C4704F'],
  ['#8A9A7B', 'Soft Sage', '8A9A7B'],
].forEach(([hex, name, code], i) => {
  const sw = (cardW - 56 - 4 * 14) / 5;
  const sx = px + 28 + i * (sw + 14);
  S.push(rect(sx, icY + 48, sw, 96, 14, hex));
  S.push(rect(sx + 0.5, icY + 48.5, sw - 1, 95, 14, 'none', 'stroke="rgba(30,30,30,0.09)"'));
  S.push(txt(sx, icY + 164, name, { size: 9.6, weight: 550, fill: C.graphite }));
  S.push(txt(sx, icY + 178, `#${code}`, { size: 7.8, fill: C.faint, ls: 0.4 }));
});

S.push(line(px + 28, icY + 204, px + cardW - 28, icY + 204, 'rgba(30,30,30,0.08)'));
S.push(caps(px + 28, icY + 232, 'TYPE', 8, C.faint, 2.6));
S.push(txt(px + 26, icY + 342, 'Aa', { family: 'Playfair Display', size: 112, fill: C.graphite, ls: -1 }));
S.push(txt(px + 176, icY + 268, 'Playfair Display', { family: 'Playfair Display', size: 22, fill: C.graphite }));
S.push(caps(px + 176, icY + 288, 'DISPLAY  ·  400 / 500 / 600', 7.6, C.faint, 1.8));
S.push(txt(px + 176, icY + 316, 'Wordmark, titles, lyrics', { size: 10.6, fill: C.body }));
S.push(txt(px + 176, icY + 332, 'Set tight, −2% tracking', { size: 10.6, fill: C.body }));
S.push(line(px + 28, icY + 384, px + cardW - 28, icY + 384, 'rgba(30,30,30,0.08)'));
S.push(txt(px + 26, icY + 484, 'Aa', { size: 92, weight: 500, fill: C.graphite, ls: -2 }));
S.push(txt(px + 176, icY + 420, 'Inter', { size: 22, weight: 600, fill: C.graphite }));
S.push(caps(px + 176, icY + 440, 'UI  ·  400 / 500 / 600', 7.6, C.faint, 1.8));
S.push(txt(px + 176, icY + 468, 'Navigation, metadata, controls', { size: 10.6, fill: C.body }));
S.push(txt(px + 176, icY + 484, 'Medium 12–14px · +2% tracking on caps', { size: 10.6, fill: C.body }));
S.push(line(px + 28, icY + 512, px + cardW - 28, icY + 512, 'rgba(30,30,30,0.08)'));
S.push(
  txt(px + 28, icY + 536, 'Radii 16–24 px   ·   Elevation 0/1/2   ·   Grain 3%   ·   No neon, no glow', {
    size: 9,
    fill: C.faint,
    ls: 0.3,
  })
);

/* footer */
const footY = icY + cardH + 60;
S.push(line(M, footY, metaX, footY, 'rgba(30,30,30,0.12)'));
S.push(txt(M, footY + 30, 'ByAzen', { family: 'Playfair Display', size: 16, fill: C.graphite }));
S.push(txt(M + 74, footY + 29, 'Premium desktop music player — design concept', { size: 10, fill: C.faint }));
S.push(
  txt(metaX, footY + 29, 'Warm cream  ·  Graphite  ·  Terracotta  ·  Sage', {
    size: 9.2,
    fill: C.faint,
    anchor: 'end',
    ls: 0.9,
  })
);
const PAGE_H = Math.round(footY + 74);

/* ------------------------------------------------------------- page chrome */
const defs = `
<defs>
  <filter id="softSm" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="9"/>
  </filter>
  <filter id="softBig" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="18"/>
  </filter>
  <filter id="softHuge" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="34"/>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="7" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0"/>
  </filter>
  <pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(30,30,30,0.05)"/>
  </pattern>
  <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
    <path d="M80 0H0V80" fill="none" stroke="rgba(30,30,30,0.04)" stroke-width="1"/>
  </pattern>
  <radialGradient id="vig" cx="0.5" cy="0.32" r="0.8">
    <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="1" stop-color="#C9B49C" stop-opacity="0.2"/>
  </radialGradient>
</defs>`;

const SCALE = Number(process.env.SCALE || 2);
// resvg ignores fitTo.zoom above ~16 Mpx, so bake the scale into the root size.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${
  PAGE_H * SCALE
}" viewBox="0 0 ${W} ${PAGE_H}">
${defs}
<rect width="${W}" height="${PAGE_H}" fill="${C.cream}"/>
<rect width="${W}" height="${PAGE_H}" fill="url(#dots)" opacity="0.55"/>
<rect x="${M / 2}" y="${M / 2}" width="${W - M}" height="${PAGE_H - M}" fill="url(#grid)" opacity="0.6"/>
<rect width="${W}" height="${PAGE_H}" fill="url(#vig)"/>
${S.join('\n')}
<rect width="${W}" height="${PAGE_H}" filter="url(#grain)" opacity="0.042"/>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'byazen-concept-sheet.svg'), svg);

const resvg = new Resvg(svg, {
  font: {
    fontFiles: FONTS,
    loadSystemFonts: false,
  },
});
const img = resvg.render();
const png = img.asPng();
const out = path.join(__dirname, '..', 'byazen-concept-sheet.png');
fs.writeFileSync(out, png);
// 1x companion render (same vector source) for quick preview / web use
const pngScaled = new Resvg(
  svg.replace(
    `width="${W * SCALE}" height="${PAGE_H * SCALE}"`,
    `width="${W}" height="${PAGE_H}"`
  ),
  { font: { fontFiles: FONTS, loadSystemFonts: false } }
)
  .render()
  .asPng();
console.log(
  'board',
  W + '×' + PAGE_H,
  '→ png',
  img.width + '×' + img.height,
  (png.length / 1e6).toFixed(2) + ' MB'
);

/* ------------------------------------------------------- extra exports */
const outDir = path.join(__dirname, '..', 'exports');
fs.mkdirSync(outDir, { recursive: true });
// downscaled preview of the board for quick viewing
fs.writeFileSync(path.join(outDir, 'byazen-concept-sheet-1600.png'), pngScaled);

// standalone app-icon PNGs (master is designed in a 400 × 400 space)
[
  [1024, 'byazen-app-icon-1024.png'],
  [512, 'byazen-app-icon-512.png'],
  [180, 'byazen-app-icon-180.png'],
].forEach(([px, name]) => {
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 400 400">${appIcon(
    400,
    0,
    0,
    'x' + px
  )}</svg>`;
  fs.writeFileSync(path.join(outDir, `byazen-app-icon-${px}.svg`), iconSvg);
  const r = new Resvg(iconSvg, {
    font: { fontFiles: FONTS, loadSystemFonts: false },
  });
  fs.writeFileSync(path.join(outDir, name), r.render().asPng());
});
console.log('icon exports: 1024 / 512 / 180');
