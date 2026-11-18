/**
 * ByAzen app asset generator.
 *   node tools/gen-assets.js
 *
 * Produces:
 *   app/renderer/assets/covers/*.png   album artwork (reuses the sheet's cover art)
 *   app/renderer/assets/tracks/*.wav   eight original generative demo tracks
 *
 * Everything is synthesised / drawn from scratch — no third-party audio or images.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { cover, FONTS } = require('./assets-lib');

const APP = path.join(__dirname, '..', 'app');
const COVERS = path.join(APP, 'renderer', 'assets', 'covers');
const TRACKS = path.join(APP, 'renderer', 'assets', 'tracks');
fs.mkdirSync(COVERS, { recursive: true });
fs.mkdirSync(TRACKS, { recursive: true });

/* ------------------------------------------------------------------ covers */
const ALBUM_COVERS = [
  ['aurora-lines', 'aurora', 7, 2],
  ['paper-moons', 'sand', 3, 2],
  ['low-tide', 'sage', 5, 3],
  ['felt-piano', 'clay', 9, 4],
  ['northbound', 'stone', 11, 2],
  ['slow-light', 'olive', 14, 3],
  ['harbour', 'dusk', 17, 2],
  ['wildflower', 'rose', 21, 4],
  ['clay-and-ash', 'clay', 26, 2],
  ['night-bus', 'dusk', 29, 3],
  ['pale-coast', 'sand', 32, 4],
  ['hush', 'stone', 35, 2],
];

const PX = 640;
ALBUM_COVERS.forEach(([name, pal, seed, comp]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 640 640">${cover(
    0,
    0,
    PX,
    pal,
    seed,
    comp,
    'a' + seed
  )}</svg>`;
  // cover() clips with rx 22 in a 100-unit box at any scale; add a plain corner crop
  const r = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false } });
  fs.writeFileSync(path.join(COVERS, name + '.png'), r.render().asPng());
});
console.log('covers:', ALBUM_COVERS.length);

/* ------------------------------------------------------------------- audio */
const SR = 44100;

function note(freq, dur, t0, opts = {}) {
  return { freq, dur, t0, ...opts };
}

/** simple additive pluck / pad voice */
function voice(F, dur, kind) {
  // returns amplitude at time tau for frequency F
  const w = 2 * Math.PI * F;
  if (kind === 'pluck') return (t) => {
    const e = Math.exp(-t * 3.2) * Math.min(1, t * 220);
    return (Math.sin(w * t) * 0.6 + Math.sin(2 * w * t) * 0.24 + Math.sin(3 * w * t) * 0.1) * e;
  };
  if (kind === 'bell') return (t) => {
    const e = Math.exp(-t * 1.5) * Math.min(1, t * 120);
    return (
      (Math.sin(w * t) * 0.5 + Math.sin(2.01 * w * t) * 0.22 + Math.sin(4.02 * w * t) * 0.1) * e
    );
  };
  if (kind === 'pad') return (t) => {
    const e = Math.min(1, t / 0.5) * Math.min(1, (dur - t) / 0.8);
    return (
      (Math.sin(w * t) * 0.34 +
        Math.sin(w * 1.003 * t) * 0.26 +
        Math.sin(2 * w * t) * 0.09) *
      Math.max(0, e)
    );
  };
  // bass
  return (t) => {
    const e = Math.exp(-t * 2.4) * Math.min(1, t * 160);
    return (Math.sin(w * t) * 0.75 + Math.sin(2 * w * t) * 0.14) * e;
  };
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Renders a track from a chord/scale spec.
 *  chords: arrays of midi notes played as pads, one per bar
 *  melody: array of {bar, beat, midi, dur}
 */
function render(spec) {
  const { bpm, bars, beatsPerBar = 4, chords, melody, bassRoot, kind = 'pluck', seed = 1 } = spec;
  const beat = 60 / bpm;
  const barLen = beat * beatsPerBar;
  const total = bars * barLen + 2.4; // tail
  const N = Math.ceil(total * SR);
  const buf = new Float32Array(N);
  let rndState = seed * 9301 + 49297;
  const rnd = () => {
    rndState = (rndState * 9301 + 49297) % 233280;
    return rndState / 233280;
  };

  // pads
  chords.forEach((chord, bi) => {
    const t0 = bi * barLen;
    chord.forEach((m) => {
      const F = midiToFreq(m);
      const g = voice(F, barLen, 'pad');
      const start = Math.floor(t0 * SR);
      const len = Math.floor(Math.min(barLen * 1.15, total - t0) * SR);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        buf[start + i] += g(t) * 0.30;
      }
    });
  });

  // bass
  chords.forEach((chord, bi) => {
    const root = bassRoot ? bassRoot[bi] : chord[0] - 24;
    [0, 2].forEach((b) => {
      const t0 = bi * barLen + b * beat;
      const g = voice(midiToFreq(root), beat * 1.6, 'bass');
      const start = Math.floor(t0 * SR);
      const len = Math.floor(beat * 2.4 * SR);
      for (let i = 0; i < len && start + i < N; i++) buf[start + i] += g(i / SR) * 0.5;
    });
  });

  // melody
  melody.forEach((n) => {
    const t0 = n.bar * barLen + n.beat * beat;
    const F = midiToFreq(n.midi);
    const dur = (n.dur || 1) * beat;
    const g = voice(F, dur, kind);
    const start = Math.floor(t0 * SR);
    const len = Math.floor(Math.min(dur * 3.2, total - t0) * SR);
    const vel = n.vel || 0.5;
    for (let i = 0; i < len && start + i < N; i++) {
      buf[start + i] += g(i / SR) * vel * (0.85 + rnd() * 0.15);
    }
  });

  // gentle low-pass (one-pole) + soft clip
  let prev = 0;
  const a = 0.42;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    prev = prev + a * (buf[i] - prev);
    buf[i] = prev;
    peak = Math.max(peak, Math.abs(prev));
  }
  const norm = peak > 0 ? 0.86 / peak : 1;

  // fade in/out
  const fadeIn = Math.floor(0.06 * SR);
  const fadeOut = Math.floor(1.6 * SR);
  for (let i = 0; i < N; i++) {
    let g = norm;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > N - fadeOut) g *= Math.max(0, (N - i) / fadeOut);
    buf[i] = Math.tanh(buf[i] * g * 1.05) * 0.92;
  }
  return { buf, duration: total };
}

function writeWav(file, buf) {
  const N = buf.length;
  const out = Buffer.alloc(44 + N * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + N * 4, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(2, 22); // stereo
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(N * 4, 40);
  // duplicate to stereo with a tiny width difference
  for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    const s = Math.round(v * 32000);
    out.writeInt16LE(s, 44 + i * 4);
    out.writeInt16LE(s, 46 + i * 4);
  }
  fs.writeFileSync(file, out);
}

/* ------------------------------------------------------- eight demo tracks */
// All in A / D centred warm keys; nothing repetitive enough to get annoying.
const TRACK_SPECS = [
  {
    id: 'aurora-lines',
    title: 'Aurora Lines',
    bpm: 84,
    bars: 8,
    chords: [
      [53, 57, 60, 64],
      [51, 55, 58, 62],
      [48, 52, 55, 60],
      [50, 53, 57, 62],
      [53, 57, 60, 64],
      [51, 55, 58, 62],
      [48, 52, 55, 60],
      [46, 50, 53, 58],
    ],
    melody: [
      note(0, 0, 76, { dur: 1.5 }), note(0, 1.5, 74), note(0, 2.5, 72, { dur: 1.5 }),
      note(1, 0, 70, { dur: 1 }), note(1, 1, 72), note(1, 2, 74, { dur: 2 }),
      note(2, 0, 67, { dur: 1.5 }), note(2, 1.5, 72), note(2, 2.5, 76, { dur: 1.5 }),
      note(3, 0, 74, { dur: 1 }), note(3, 1, 72), note(3, 2, 70, { dur: 2 }),
      note(4, 0, 77, { dur: 1.5 }), note(4, 2, 76, { dur: 2 }),
      note(5, 0, 74, { dur: 1.5 }), note(5, 2, 72, { dur: 2 }),
      note(6, 0, 72, { dur: 1 }), note(6, 1, 74), note(6, 2, 67, { dur: 2 }),
      note(7, 0, 70, { dur: 4 }),
    ],
    kind: 'bell',
  },
  {
    id: 'paper-moons',
    title: 'Paper Moons',
    bpm: 92,
    bars: 8,
    chords: [
      [50, 54, 57, 62],
      [55, 59, 62, 66],
      [48, 52, 55, 60],
      [53, 57, 60, 64],
      [50, 54, 57, 62],
      [55, 59, 62, 66],
      [57, 60, 64, 67],
      [52, 55, 59, 64],
    ],
    melody: [
      note(0, 0.5, 69), note(0, 1.5, 74), note(0, 2.5, 69), note(0, 3, 67),
      note(1, 0.5, 74), note(1, 1.5, 79), note(1, 2.5, 78), note(1, 3, 74),
      note(2, 0.5, 67), note(2, 1.5, 72), note(2, 2.5, 67), note(2, 3, 64),
      note(3, 0.5, 72), note(3, 1.5, 76), note(3, 2.5, 74), note(3, 3, 72),
      note(4, 0.5, 69), note(4, 1.5, 74), note(4, 2.5, 76), note(4, 3, 74),
      note(5, 0.5, 71), note(5, 1.5, 74), note(5, 2.5, 79), note(5, 3, 78),
      note(6, 0.5, 76), note(6, 1.5, 79), note(6, 2.5, 76), note(6, 3, 74),
      note(7, 0.5, 71), note(7, 1.5, 74), note(7, 2.5, 71),
    ],
    kind: 'pluck',
  },
  {
    id: 'low-tide',
    title: 'Low Tide',
    bpm: 76,
    bars: 8,
    chords: [
      [48, 55, 60, 64],
      [50, 57, 62, 65],
      [45, 52, 57, 60],
      [43, 50, 55, 58],
      [48, 55, 60, 64],
      [50, 57, 62, 65],
      [41, 48, 53, 57],
      [43, 50, 55, 62],
    ],
    melody: [
      note(0, 0, 72, { dur: 2 }), note(0, 2, 76, { dur: 2 }),
      note(1, 0, 74, { dur: 1.5 }), note(1, 1.5, 77, { dur: 2.5 }),
      note(2, 0, 69, { dur: 2 }), note(2, 2, 72, { dur: 2 }),
      note(3, 0, 67, { dur: 1.5 }), note(3, 2, 70, { dur: 2 }),
      note(4, 0, 72, { dur: 1.5 }), note(4, 1.5, 74, { dur: 2 }),
      note(5, 0, 77, { dur: 2 }), note(5, 2, 74, { dur: 2 }),
      note(6, 0, 72, { dur: 1.5 }), note(6, 1.5, 69, { dur: 2.5 }),
      note(7, 0, 67, { dur: 4 }),
    ],
    kind: 'pad2',
  },
  {
    id: 'felt-piano',
    title: 'Felt Piano',
    bpm: 68,
    bars: 8,
    chords: [
      [48, 55, 60, 63],
      [46, 53, 58, 62],
      [41, 48, 53, 57],
      [43, 50, 55, 59],
      [48, 55, 60, 63],
      [46, 53, 58, 62],
      [45, 52, 57, 60],
      [41, 48, 53, 56],
    ],
    melody: [
      note(0, 0, 75, { dur: 1 }), note(0, 1, 72), note(0, 2, 67, { dur: 2 }),
      note(1, 0, 74, { dur: 1 }), note(1, 1, 70), note(1, 2, 65, { dur: 2 }),
      note(2, 0, 72, { dur: 1 }), note(2, 1, 69), note(2, 2, 65, { dur: 2 }),
      note(3, 0, 71, { dur: 1 }), note(3, 1, 67), note(3, 2, 62, { dur: 2 }),
      note(4, 0, 75, { dur: 1 }), note(4, 1, 72), note(4, 2, 68, { dur: 2 }),
      note(5, 0, 74, { dur: 1 }), note(5, 1, 70), note(5, 2, 65, { dur: 2 }),
      note(6, 0, 72, { dur: 1 }), note(6, 1, 69), note(6, 2, 64, { dur: 2 }),
      note(7, 0, 68, { dur: 4 }),
    ],
    kind: 'bell',
  },
  {
    id: 'northbound',
    title: 'Northbound',
    bpm: 88,
    bars: 8,
    chords: [
      [45, 52, 57, 60],
      [43, 50, 55, 59],
      [48, 55, 60, 63],
      [50, 57, 62, 65],
      [45, 52, 57, 60],
      [43, 50, 55, 59],
      [41, 48, 53, 57],
      [43, 50, 55, 58],
    ],
    melody: [
      note(0, 0, 69, { dur: 1 }), note(0, 1, 72), note(0, 2, 76, { dur: 1.5 }),
      note(1, 0, 74, { dur: 1 }), note(1, 1, 71), note(1, 2, 67, { dur: 1.5 }),
      note(2, 0, 72, { dur: 1 }), note(2, 1, 75), note(2, 2, 79, { dur: 1.5 }),
      note(3, 0, 77, { dur: 1 }), note(3, 1, 74), note(3, 2, 69, { dur: 1.5 }),
      note(4, 0, 69, { dur: 1 }), note(4, 1, 72), note(4, 2, 77, { dur: 1.5 }),
      note(5, 0, 74, { dur: 1 }), note(5, 1, 71), note(5, 2, 67, { dur: 1.5 }),
      note(6, 0, 72, { dur: 1 }), note(6, 1, 69), note(6, 2, 65, { dur: 1.5 }),
      note(7, 0, 70, { dur: 4 }),
    ],
    kind: 'pluck',
  },
  {
    id: 'slow-light',
    title: 'Slow Light',
    bpm: 72,
    bars: 8,
    chords: [
      [52, 59, 64, 67],
      [50, 57, 62, 65],
      [47, 54, 59, 62],
      [45, 52, 57, 60],
      [52, 59, 64, 67],
      [50, 57, 62, 66],
      [48, 55, 60, 64],
      [45, 52, 57, 62],
    ],
    melody: [
      note(0, 0, 76, { dur: 2 }), note(0, 2, 79, { dur: 2 }),
      note(1, 0, 74, { dur: 2 }), note(1, 2, 77, { dur: 2 }),
      note(2, 0, 71, { dur: 2 }), note(2, 2, 74, { dur: 2 }),
      note(3, 0, 69, { dur: 2 }), note(3, 2, 72, { dur: 2 }),
      note(4, 0, 76, { dur: 2 }), note(4, 2, 80, { dur: 2 }),
      note(5, 0, 75, { dur: 2 }), note(5, 2, 78, { dur: 2 }),
      note(6, 0, 72, { dur: 2 }), note(6, 2, 76, { dur: 2 }),
      note(7, 0, 69, { dur: 4 }),
    ],
    kind: 'bell',
  },
  {
    id: 'harbour',
    title: 'Harbour',
    bpm: 80,
    bars: 8,
    chords: [
      [50, 57, 62, 66],
      [48, 55, 60, 63],
      [45, 52, 57, 60],
      [46, 53, 58, 62],
      [50, 57, 62, 66],
      [53, 60, 65, 68],
      [48, 55, 60, 64],
      [45, 52, 57, 60],
    ],
    melody: [
      note(0, 0, 74, { dur: 1.5 }), note(0, 2, 77, { dur: 2 }),
      note(1, 0, 72, { dur: 1.5 }), note(1, 2, 75, { dur: 2 }),
      note(2, 0, 69, { dur: 1.5 }), note(2, 2, 72, { dur: 2 }),
      note(3, 0, 70, { dur: 2 }), note(3, 2, 74, { dur: 2 }),
      note(4, 0, 74, { dur: 1.5 }), note(4, 2, 78, { dur: 2 }),
      note(5, 0, 77, { dur: 1.5 }), note(5, 2, 81, { dur: 2 }),
      note(6, 0, 72, { dur: 1.5 }), note(6, 2, 76, { dur: 2 }),
      note(7, 0, 69, { dur: 4 }),
    ],
    kind: 'pluck',
  },
  {
    id: 'wildflower',
    title: 'Wildflower',
    bpm: 96,
    bars: 8,
    chords: [
      [55, 62, 67, 71],
      [53, 60, 65, 68],
      [48, 55, 60, 64],
      [50, 57, 62, 65],
      [55, 62, 67, 71],
      [57, 64, 69, 72],
      [53, 60, 65, 69],
      [48, 55, 60, 64],
    ],
    melody: [
      note(0, 0, 79, { dur: 1 }), note(0, 1, 79), note(0, 2, 83, { dur: 1.5 }),
      note(1, 0, 77, { dur: 1 }), note(1, 1, 77), note(1, 2, 81, { dur: 1.5 }),
      note(2, 0, 72, { dur: 1 }), note(2, 1, 72), note(2, 2, 76, { dur: 1.5 }),
      note(3, 0, 74, { dur: 1 }), note(3, 1, 74), note(3, 2, 77, { dur: 1.5 }),
      note(4, 0, 79, { dur: 1 }), note(4, 1, 81), note(4, 2, 83, { dur: 1.5 }),
      note(5, 0, 81, { dur: 1 }), note(5, 1, 81), note(5, 2, 84, { dur: 1.5 }),
      note(6, 0, 77, { dur: 1 }), note(6, 1, 77), note(6, 2, 81, { dur: 1.5 }),
      note(7, 0, 76, { dur: 4 }),
    ],
    kind: 'bell',
  },
];

const manifest = [];
TRACK_SPECS.forEach((spec) => {
  const t0 = Date.now();
  const { buf, duration } = render(spec);
  const file = spec.id + '.wav';
  writeWav(path.join(TRACKS, file), buf);
  manifest.push({
    id: spec.id,
    title: spec.title,
    file: 'assets/tracks/' + file,
    cover: 'assets/covers/' + spec.id + '.png',
    duration: Math.round(duration * 10) / 10,
    bpm: spec.bpm,
  });
  console.log(
    `  ${spec.title.padEnd(14)} ${duration.toFixed(1)}s  ${(fs.statSync(path.join(TRACKS, file)).size / 1e6).toFixed(2)} MB  (${Date.now() - t0} ms)`
  );
});
fs.writeFileSync(
  path.join(TRACKS, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log('tracks:', manifest.length);
