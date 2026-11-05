// STORGE 01–06 with the score, played like a visitor: real wheel / touch swipes / mouse & finger drags / button.
// Normal-browser audio rule emulated (sound only after a click / touch-end).
// usage: node tests/e2e-score.mjs <baseUrl> [pc|mobile|landscape]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const ONLY = process.argv[3];
const OUT = process.env.OUT || 'tests/shots/v9/film';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(viewport, speed = 1) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument(() => {
    let gestured = false;
    const mark = (e) => { if (e.type === 'pointerup' && e.pointerType === 'mouse') return; if (e.type === 'keydown' && ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; gestured = true; };
    for (const t of ['mousedown', 'keydown', 'touchend', 'click', 'pointerup']) window.addEventListener(t, mark, true);
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...a) { super(...a); if (!gestured) super.suspend(); }
      get state() { return gestured ? super.state : 'suspended'; }
      resume() { return gestured ? super.resume() : Promise.resolve(); }
    };
  });
  await page.setViewport(viewport);
  await page.goto(`${BASE}?debug&speed=${speed}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
  await page.evaluate(() => { window.__wheelPrevented = []; window.addEventListener('wheel', (e) => window.__wheelPrevented.push(e.defaultPrevented), { passive: true }); });
  await sleep(800);
  return { page, errors };
}
const S = (page) => page.evaluate(() => window.__storge.state);
const SC = (page) => page.evaluate(() => window.__storge.score());
const waitFor = (page, fn, arg, timeout = 600000) => page.waitForFunction(fn, { timeout, polling: 200 }, arg);
const settle = (page) => waitFor(page, () => Math.abs(window.__storge.state.pending) < 1e-6);
const settleGrow = (page) => waitFor(page, () => { const s = window.__storge.state; return Math.abs(s.pending) < 1e-6 && Math.abs(s.progress - s.shownProgress) < 0.003; });
const swipe = async (page, x, y0, y1) => { await page.touchscreen.touchStart(x, y0); for (let j = 1; j <= 8; j++) await page.touchscreen.touchMove(x, y0 + (y1 - y0) * j / 8); await page.touchscreen.touchEnd(); };
const wind = async (page, touch, n, at) => {
  for (let i = 0; i < n; i++) {
    if (touch) await swipe(page, ...(at || [200, 640, 320]));
    else { await page.mouse.wheel({ deltaY: 120 }); await sleep(14); }
  }
};
async function dragPiece(page, k, touch) {
  const info = await page.evaluate((k) => ({ piece: window.__storge.pieces()[k], end: window.__storge.chainEndScreen() }), k);
  const g = info.piece.screenPts[8], s = info.piece.start, e = info.end;
  const tx = g.x + e.x - s.x + 5, ty = g.y + e.y - s.y - 4, steps = 14;
  if (touch) {
    await page.touchscreen.touchStart(g.x, g.y);
    for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(g.x + (tx - g.x) * i / steps, g.y + (ty - g.y) * i / steps); await sleep(12); }
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(g.x + (tx - g.x) * i / steps, g.y + (ty - g.y) * i / steps); await sleep(12); }
    await page.mouse.up();
  }
}
async function windToBreak(page, touch, at) {
  for (let i = 0; i < 90 && (await S(page)).story !== 'TENSION'; i++) { await wind(page, touch, 1, at); if (i % 4 === 3) await settleGrow(page); }
  await waitFor(page, () => window.__storge.state.story === 'TENSION');
  const tens = [];
  for (let i = 0; i < 90 && (await S(page)).story === 'TENSION'; i++) { await wind(page, touch, 1, at); const s = await S(page); if (s.story === 'TENSION') tens.push([s.taut, s.tremor]); }
  return tens;
}
async function repairAll(page, touch) {
  await waitFor(page, () => window.__storge.state.story === 'REPAIRING');
  for (let k = 1; k <= 4; k++) {
    await dragPiece(page, k, touch);
    await waitFor(page, (k) => window.__storge.state.connected === k + 1, k, 120000).catch(() => {});
  }
  await waitFor(page, () => ['REPAIRED', 'CHANGED', 'ANSWERED'].includes(window.__storge.state.story));
}
/** wind in 05–06 until `n` changed notes have sounded in total (or `until` holds); optional frame grabber */
async function playChanged(page, touch, n, at, until, grab) {
  for (let i = 0; i < 400; i++) {
    const s = await S(page);
    if (s.changedCount >= n || (until && until(s))) break;
    await wind(page, touch, 1, at);
    if (grab) await grab(); else if (!touch) await sleep(60);
  }
  await settle(page);
}
const rect = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }, sel);
const chainBox = (page) => page.evaluate(() => {
  const P = window.__storge.pieces(); return { pts: P.flatMap((p) => p.screenPts) };
});
const boxRect = (page) => page.evaluate(() => {
  const S = window.__storge, T = S.THREE, b = new T.Box3().setFromObject(S.musicBox.root), c = S.stage.camera; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new T.Vector3(x, y, z).project(c); const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  return { x0, x1, y0, y1 };
});
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const hitsLine = (r, pts, m = 10) => pts.some((q) => q.x > r.x0 - m && q.x < r.x1 + m && q.y > r.y0 - m && q.y < r.y1 + m);
const shape = (page) => page.evaluate(() => window.__storge.scenes.current.fragments.pieces.map((p) => p.worldPoints(30).map((v) => v.toArray())).flat());
const maxDiff = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2])));
const counts = (page) => page.evaluate(() => ({ scene: window.__storge.stage.scene.children.length, mirror: window.__storge.state.mirrorChildren, notes: document.querySelectorAll('#score .nt').length }));
const themes = (page) => page.evaluate(async () => ({
  a: (await import('/src/audio/melodies/storgeTheme.js')).storgeTheme,
  b: (await import('/src/audio/melodies/storgeThemeChanged.js')).storgeThemeChanged,
}));
const R = (r) => `${Math.round(r.x0)}–${Math.round(r.x1)} × ${Math.round(r.y0)}–${Math.round(r.y1)}`;

/** score glyphs vs the theme data: height follows pitch, note value follows length, x follows the beat */
function scoreMatches(glyphs, steps, beatW) {
  const notes = glyphs.filter((g) => !g.rest);
  const bad = [];
  const val = { 0.5: 'eighth', 1: 'quarter', 1.5: 'dotted-quarter', 2: 'half' };
  let beat = 0;
  const onset = steps.map((s) => { const b = beat; beat += s.beats ?? 1; return b; });
  for (const g of notes) {
    const st = steps[g.index];
    if (st.note !== g.note) bad.push(`note ${g.index} ${g.note}≠${st.note}`);
    if (val[st.beats ?? 1] !== g.value) bad.push(`value ${g.index} ${g.value}`);
    if (Math.abs(onset[g.index] - g.beat) > 1e-9) bad.push(`beat ${g.index}`);
  }
  for (const a of notes) for (const b of notes) {
    if (a.midi > b.midi && !(a.y < b.y)) bad.push(`height ${a.note}/${b.note}`);
    if (a.midi === b.midi && Math.abs(a.y - b.y) > 0.01) bad.push(`same pitch ${a.note}`);
    const dx = (b.x - a.x) - (b.beat - a.beat) * beatW;
    if (Math.abs(dx) > 0.6 && Math.floor(a.beat / 12) === Math.floor(b.beat / 12)) bad.push(`spacing ${a.index}-${b.index}`);
  }
  const rests = steps.map((s, i) => (s.note ? null : i)).filter((i) => i !== null);
  for (const i of rests) if (!glyphs.some((g) => g.rest && g.index === i)) bad.push(`rest ${i} missing`);
  return [...new Set(bad)];
}

// ---- film the ending: run 01–05 quickly, then play at normal story speed into 06, grabbing frames
const [W, Hh, touch] = (process.env.VP || '1600x900').split('x').map(Number).concat([]);
const mobile = W < 700;
const vp = mobile ? { width: W, height: Hh, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: W, height: Hh, deviceScaleFactor: 1 };
const { page, errors } = await open(vp, 4);
const at = mobile ? (W > Hh ? [600, 330, 60] : [200, 640, 320]) : null;
if (!mobile) await page.mouse.click(W * 0.7, Hh * 0.3);
await windToBreak(page, mobile, at);
await repairAll(page, mobile);
await waitFor(page, () => window.__storge.state.againShown);
await playChanged(page, mobile, 13, at);
await page.evaluate(() => window.__storge.setSpeed(1));
const frames = [];
const grab = async () => { const f = `${OUT}/f${String(frames.length).padStart(3, '0')}.png`; await page.screenshot({ path: f }); const s = await S(page); frames.push({ f, clock: s.clock, story: s.story, fx: s.answerFx }); };
for (let i = 0; i < 60; i++) {
  const s = await S(page);
  if (s.ending.en && s.clock > s.timeline.koDone + 1.0) break;
  if (i % 2 === 0) await wind(page, mobile, 1, at);
  await grab();
}
fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames, null, 1));
console.log(frames.map((f) => `${f.f.split('/').pop()} ${f.clock.toFixed(2)} ${f.story} ${f.fx.reveal.toFixed(2)} ${f.fx.active}`).join('\n'));
console.log('errors', errors);
console.log(await page.evaluate(() => { const e = document.querySelector('.ending'); const r = e.getBoundingClientRect(); return JSON.stringify({ style: e.getAttribute('style'), r: [r.left, r.right, r.top, r.bottom].map(Math.round), fs: getComputedStyle(e.querySelector('.ans-l2')).fontSize }); }));
await page.evaluate(() => window.__storge.scenes.current.placeAnswer());
console.log('re-placed', await page.evaluate(() => document.querySelector('.ending').getAttribute('style')));
await browser.close();
