/**
 * Headless smoke test for the renderer: boots app.js inside jsdom, exercises the
 * main interactions, and fails the build on any thrown error.
 *   node tools/smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = path.join(__dirname, '..', 'app', 'renderer');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'file://' + APP + '/index.html',
});
const { window } = dom;

// minimal media stubs
window.HTMLMediaElement.prototype.play = function () {
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () {
  this.dispatchEvent(new window.Event('pause'));
};
window.HTMLMediaElement.prototype.load = function () {};
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
  get: () => 25.3,
  configurable: true,
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  get() {
    return this._t || 0;
  },
  set(v) {
    this._t = v;
  },
  configurable: true,
});

window.eval(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'));

const d = window.document;
const q = (s) => d.querySelector(s);
const qa = (s) => Array.from(d.querySelectorAll(s));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const fail = [];
const check = (name, cond, extra = '') => {
  if (!cond) fail.push(`${name}${extra ? ' — ' + extra : ''}`);
};

check('now playing title', q('#np-title').textContent === 'Aurora Lines', q('#np-title').textContent);
check('queue rendered', qa('.q-item').length === 8, String(qa('.q-item').length));
check('library grid', qa('.album').length === 8, String(qa('.album').length));
check('recents list', qa('.rec').length === 7, String(qa('.rec').length));
check('playlists', qa('#playlists .card').length === 4);
check('stations', qa('#stations .card').length === 4);
check('lyrics lines', qa('.lyr-line').length === 4);
check('duration label', /^\d:\d\d$/.test(q('#t-dur').textContent), q('#t-dur').textContent);

click(q('.nav[data-view="library"]'));
check('nav switches view', d.body.dataset.view === 'library', d.body.dataset.view);

click(qa('.album')[2]);
check('album click plays', q('#np-title').textContent === 'Low Tide', q('#np-title').textContent);
check('returns home', d.body.dataset.view === 'home', d.body.dataset.view);

click(q('#btn-shuffle'));
check('shuffle toggles', q('#btn-shuffle').classList.contains('is-on'));

q('#search-lib').value = 'piano';
q('#search-lib').dispatchEvent(new window.Event('input', { bubbles: true }));
check('library search filters', qa('.album').length === 1, String(qa('.album').length));

d.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
check('space toggles playback', d.body.classList.contains('is-playing'));

click(q('#btn-fav'));
check('favourite toggles', q('#btn-fav').classList.contains('is-on'));

click(q('#q-clear'));
check('clear queue keeps one', qa('.q-item').length === 1, String(qa('.q-item').length));

errors.forEach((e) => fail.push(e));

if (fail.length) {
  console.error('SMOKE TEST FAILED');
  fail.forEach((f) => console.error(' ✗', f));
  process.exit(1);
}
console.log('smoke test: all checks passed');
