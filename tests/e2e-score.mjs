// STORGE 01–06 with the score, played like a visitor: real wheel / touch swipes / mouse & finger drags / button.
// Normal-browser audio rule emulated (sound only after a click / touch-end).
// usage: node tests/e2e-score.mjs <baseUrl> [pc|mobile|landscape]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const ONLY = process.argv[3];
const OUT = 'tests/shots/v7/e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(viewport, speed = 1, reducedMotion = false) {
  const page = await browser.newPage();
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
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

const runs = [
  ['pc', { width: 1600, height: 900, deviceScaleFactor: 1 }, false, null],
  ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true, [200, 640, 320]],
].filter(([t]) => !ONLY || ONLY === t);

for (const [tag, vp, touch, at] of runs) {
  const T = (k) => `${tag}_${k}`;
  const { page, errors } = await open(vp, 1);
  const { a: th0, b: th1 } = await themes(page);
  const c0 = await counts(page);
  const s0 = await S(page);
  const mats = await page.evaluate(() => { const o = {}; window.__storge.musicBox.root.traverse((m) => { if (m.isMesh) o[m.material.name] = [m.material.map ? m.material.map.image.width : 0, m.material.metalness]; }); return o; });
  check(T('01_model'), s0.story === 'INTRO' && mats.M_Maple_Wood[0] === 1024 && mats.M_RoseGold_Copper[1] === 1, 'GLB music box with maple wood texture and rose-gold crank');
  if (!touch) { await page.mouse.move(1100, 450); await page.mouse.click(1100, 300); }
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());

  // ---- 01: score before playing
  const sc0 = await SC(page);
  const g0 = sc0.glyphs.filter((g) => g.v === 'o' && g.kind === 'main');
  const bad0 = scoreMatches(g0, th0.steps, (sc0.glyphs.find((g) => g.index === 1 && g.kind === 'main').x - sc0.glyphs.find((g) => g.index === 0 && g.kind === 'main').x));
  check(T('01_score_from_real_data'), bad0.length === 0 && g0.length === th0.steps.length && sc0.page === 'o0' && sc0.oState.every((x) => x === 'idle'),
    bad0.length ? bad0.slice(0, 5).join('; ') : `${g0.filter((g) => !g.rest).length} notes + ${g0.filter((g) => g.rest).length} rests of the 01 theme: heights follow pitch, quarter notes = 1 beat, spacing by beat; nothing lit yet`);

  // ---- 01: wind a little, check sound + score in step; stop; resume
  await wind(page, touch, touch ? 1 : 8, at); await settleGrow(page);
  const s1 = await S(page), sc1 = await SC(page);
  const log1 = await page.evaluate(() => window.__storge.audio.playedLog.map((l) => l.theme));
  check(T('01_input_turns_crank'), Math.abs(s1.crankAngle) > 0.8 && s1.notes > 0, `${touch ? 'swipe' : 'wheel'}: crank ${s1.crankAngle.toFixed(2)} rad, ${s1.notes} steps`);
  check(T('01_original_melody_plays'), log1.length > 0 && log1.every((t) => t === 'storge-theme-v0') && s1.audioState === 'running', `${log1.length} notes, all from the 01 theme, audio ${s1.audioState}`);
  const lastIdx = (s1.notes - 1) % 24;
  const lit = sc1.oState.filter((x) => x !== 'idle').length;
  check(T('01_score_highlight_in_step'), sc1.oState[lastIdx] === (th0.steps[lastIdx].note ? 'current' : 'played') && lit === s1.notes && sc1.oState.filter((x) => x === 'current').length <= 1,
    `music box played ${s1.notes} steps → score: ${lit} lit, current = step ${lastIdx} (${th0.steps[lastIdx].note})`);
  await sleep(3000);
  const s1b = await S(page), sc1b = await SC(page);
  check(T('01_stop_means_stop'), s1b.notes === s1.notes && JSON.stringify(sc1b.oState) === JSON.stringify(sc1.oState), `3 s without input: still ${s1b.notes} steps, score unchanged`);
  await wind(page, touch, touch ? 1 : 4, at); await settleGrow(page);
  const s1c = await S(page), sc1c = await SC(page);
  const cur = sc1c.oState.findIndex((x) => x === 'current');
  check(T('01_resume_next_note'), s1c.notes > s1.notes && sc1c.oState.filter((x) => x !== 'idle').length === s1c.notes && (cur === -1 || cur === (s1c.notes - 1) % 24),
    `resumed from step ${s1.notes} → ${s1c.notes}; score follows (page ${sc1c.page})`);
  await page.screenshot({ path: `${OUT}/${tag}_01_score.png` });

  // ---- 02 → 03
  const tens = await windToBreak(page, touch, at);
  const maxTaut = Math.max(...tens.map((t) => t[0])), maxTrem = Math.max(...tens.map((t) => t[1]));
  check(T('02_tension_kept'), maxTaut > 0.4 && maxTrem > 0.001, `taut up to ${maxTaut.toFixed(2)}, tremor up to ${(maxTrem * 1000).toFixed(2)} mm`);
  await waitFor(page, () => window.__storge.state.story === 'BROKEN');
  await sleep(2200);
  await waitFor(page, () => +getComputedStyle(document.getElementById('score')).opacity < 0.75, null, 20000).catch(() => {});
  const s2 = await S(page), sc2 = await SC(page);
  check(T('03_break'), s2.shatterPlayed === 1 && s2.pieces === 5 && s2.musicStopped && !s2.melodyVisible, 'one "쨍", music stopped, the line in 5 curved pieces');
  check(T('03_score_stops'), sc2.mode === 'frozen' && !sc2.oState.includes('current') && sc2.opacity < 0.75 && sc2.opacity > 0.4 && (sc2.page === 'o0' || sc2.page === 'o1'),
    `score stopped where the music stopped, highlight gone, dimmed to ${sc2.opacity.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/${tag}_03_break.png` });

  // ---- 04 (the last piece is filmed: 04 → 06 continuous screenshots on PC)
  const notesBeforeRepair = s2.notes;
  await page.evaluate(() => {
    const B = window.__storge.bus; window.__ev = [];
    const sc = () => window.__storge.scenes.current;
    for (const n of ['story:state', 'piece:connect', 'changed:note']) B.on(n, (d) => window.__ev.push({ n, d, wall: performance.now() / 1000, clock: window.__storge.state.clock, beat: sc().changed.beat, againShown: window.__storge.state.againShown }));
  });
  await waitFor(page, () => window.__storge.state.story === 'REPAIRING');
  for (let k = 1; k <= 3; k++) { await dragPiece(page, k, touch); await waitFor(page, (k) => window.__storge.state.connected === k + 1, k, 120000).catch(() => {}); }
  const frames = [];
  const FR = `${OUT}/${tag}_frames`; fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const grab = async () => { if (tag !== 'pc' || frames.length >= 140) return; const f = `${FR}/f${String(frames.length).padStart(3, '0')}.jpg`; await page.screenshot({ path: f, type: 'jpeg', quality: 72 }); const st = await S(page); frames.push({ f, clock: st.clock, story: st.story }); };
  await grab();
  await dragPiece(page, 4, touch);
  // watch the story without touching anything until the "wind again" hint is up
  for (let i = 0; i < 60 && !(await S(page)).againShown; i++) await grab();
  await waitFor(page, () => window.__storge.state.againShown);
  await grab();
  const s3 = await S(page), sc3 = await SC(page);
  const ev3 = await page.evaluate(() => window.__ev);
  const H = Object.fromEntries(s3.history.map((h) => [h.state, h.t]));
  const Hw = Object.fromEntries(ev3.filter((e) => e.n === 'story:state').map((e) => [e.d.state, e.wall]));
  const lastConn = ev3.filter((e) => e.n === 'piece:connect').at(-1);
  const wait = +(H.REPAIRING - H.BROKEN).toFixed(2);
  check(T('04_drag_after_2_6s'), Math.abs(wait - 2.6) <= 0.06, `break → drag enabled after ${wait} s (story clock)`);
  check(T('04_four_pieces_snapped'), s3.connected === 5 && await page.evaluate(() => window.__storge.dragStats().connects) === 4, '4 pieces dragged by ' + (touch ? 'finger' : 'mouse') + ' and snapped on');
  check(T('04_tone_per_piece'), s3.repairTones.map((t) => t.note).join() === 'G5,A5,B5,C6' && s3.repairTones.map((t) => t.k).join() === '0,1,2,3', `music-box tones as pieces 2–5 land: ${s3.repairTones.map((t) => t.note).join(' → ')}`);
  check(T('04_joint_flash'), s3.jointFlashes === 4, `${s3.jointFlashes} joint flashes`);
  check(T('04_angular'), await page.evaluate(() => window.__storge.scenes.current.fragments.pieces.slice(1).every((p) => p.morph === 1)), 'all joined pieces angular');
  check(T('box_never_moves'), JSON.stringify(await page.evaluate(() => window.__storge.bodyMatrix())) === JSON.stringify(body0), 'music box unchanged through break and repair');
  const tRep = H.REPAIRED - lastConn.clock, tQ = H.CHANGED - H.REPAIRED, tAgain = s3.timeline.again - H.CHANGED;
  check(T('05_fast_after_repair'), tRep <= 1.35 && tQ >= 0.3 && tQ <= 0.55 && Math.abs(tAgain - 0.3) < 0.06,
    `story clock: last piece released → angular & repaired ${tRep.toFixed(2)} s → question ${tQ.toFixed(2)} s → "태엽을 다시 감아보세요." ${tAgain.toFixed(2)} s (release → can wind ${(s3.timeline.again - lastConn.clock).toFixed(2)} s; this slow test browser took ${(Hw.CHANGED - lastConn.wall).toFixed(1)} s wall-clock to the question)`);
  const q = await page.evaluate(() => { const e = document.querySelector('[data-prompt="question"]'); return { text: e.textContent.replace(/\s+/g, ' ').trim(), size: parseFloat(getComputedStyle(e).fontSize), weight: getComputedStyle(e).fontWeight, color: getComputedStyle(e).color }; });
  await waitFor(page, () => +getComputedStyle(document.querySelector('[data-prompt="question"]')).opacity > 0.95, null, 30000).catch(() => {});
  const again = await page.evaluate(() => { const e = document.querySelector('.hint-again'); return { text: e.textContent, shown: getComputedStyle(e).display !== 'none' }; });
  check(T('05_question_and_hint'), q.text === '멜로디가 바뀐 나, 가족들은 날 기억할까요?' && again.text === '태엽을 다시 감아보세요.' && again.shown && s3.crankEnabled && s3.prompt === 'question',
    `"${q.text}" (caption style ${q.size}px / ${q.weight}) stays while "${again.text}" is shown; crank on`);
  const gC = sc3.glyphs.filter((g) => g.v === 'c'), gG = sc3.glyphs.filter((g) => g.kind === 'ghost');
  const bw = gG.find((g) => g.index === 1).x - gG.find((g) => g.index === 0).x;
  const badC = scoreMatches(gC, th1.steps, bw), badG = scoreMatches(gG, th0.steps.slice(0, 12), bw);
  check(T('05_score_compare'), sc3.page === 'cmp' && gG.length === 12 && gC.length === 12 && badC.length + badG.length === 0 && sc3.cState.every((x) => x === 'idle') && s3.changedCount === 0,
    'compare view (01 phrase faint + changed phrase); notes match the data; nothing played by itself');

  // ---- 05: winding plays; immediately available
  const shape05 = await shape(page);
  const logN = await page.evaluate(() => window.__storge.audio.playedLog.length);
  await wind(page, touch, 1, touch ? [200, 700, 380] : null); await settle(page);
  const s4 = await S(page);
  check(T('05_wind_at_once'), s4.changedCount >= 1, `first ${touch ? 'swipe (started on the score)' : 'wheel notch'} right after the hint → ${s4.changedCount} note(s)`);
  await playChanged(page, touch, 6, null, null, grab);
  const s5 = await S(page), sc5 = await SC(page);
  check(T('05_score_in_step'), sc5.cState.findIndex((x) => x === 'current') === s5.changedPlayed.at(-1) && sc5.cState.filter((x) => x !== 'idle').length === s5.changedCount,
    `${s5.changedCount} notes → ${s5.changedCount} lit, current = step ${s5.changedPlayed.at(-1)}`);
  const sp1 = s5.spot;
  await sleep(3500);
  const s6 = await S(page), sc6 = await SC(page);
  check(T('05_stop_means_stop'), s6.changedCount === s5.changedCount && JSON.stringify(sc6.cState) === JSON.stringify(sc5.cState) && s6.story === 'CHANGED' && Math.abs(s6.spot - sp1) < 0.02,
    `3.5 s without input: still ${s6.changedCount} notes, score and light still, no ending`);
  await page.screenshot({ path: `${OUT}/${tag}_05_playing.png` });

  // ---- through the whole phrase (12) into the repeat — the ending must arrive while winding
  await playChanged(page, touch, 12, null, null, grab);
  const s7 = await S(page), sc7 = await SC(page);
  check(T('05_all_12_and_on'), s7.changedCount >= 12 && s7.crankEnabled && s7.story === 'CHANGED', `${s7.changedCount} notes played, crank still on`);
  await playChanged(page, touch, 99, null, (st) => st.story === 'ANSWERED', grab);
  // keep winding as the answer arrives; photograph the motes leaving the line and the finished sentence
  let shotStart = false, shotForm = false, revealSeen = [];
  for (let i = 0; i < 40; i++) {
    const st = await S(page);
    revealSeen.push(st.answerFx.reveal); (globalThis.__r1 ||= []).push([st.answerFx.reveal1, st.answerFx.reveal]);
    if (!shotStart && st.answerFx.active && st.answerFx.reveal === 0 && st.clock > st.timeline.light + 0.2) { shotStart = true; await page.screenshot({ path: `${OUT}/${tag}_06_particles_start.png` }); }
    else if (!shotForm && st.answerFx.reveal > 0.2 && st.answerFx.reveal < 0.95) { shotForm = true; await page.screenshot({ path: `${OUT}/${tag}_06_particles_forming.png` }); }
    if (st.ending.ko && i > 8) break;
    if (i % 2 === 0) await wind(page, touch, 1);
    await grab();
  }
  await settle(page);
  await waitFor(page, () => window.__storge.state.ending.en);
  const s8 = await S(page), sc8 = await SC(page), ev8 = await page.evaluate(() => window.__ev);
  const nts = ev8.filter((e) => e.n === 'changed:note');
  const ansEv = ev8.find((e) => e.n === 'story:state' && e.d.state === 'ANSWERED');
  const before = nts.filter((e) => e.clock <= ansEv.clock), after = nts.filter((e) => e.clock > ansEv.clock);
  const gapBefore = ansEv.clock - nts[14].clock;
  const n11 = nts.find((e) => e.d.index === 11 && e.d.pass === 0), n12 = nts.find((e) => e.d.pass === 1 && e.d.index === 0);
  check(T('05_repeat_keeps_last_note'), n12 && n11.beat >= 10 - 1e-6 && n12.beat >= 12 - 1e-6 && nts.slice(0, 15).map((e) => e.d.index).join() === '0,1,2,3,4,5,6,7,8,9,10,11,0,1,2',
    `order 0…11 then 0,1,2 again; the last note (C, half note) at beat ${n11.beat.toFixed(2)}, the phrase came round at beat ${n12.beat.toFixed(2)} (repeat at 12 beats = after the full 2 beats, not at 10)`);
  check(T('06_light_and_motes'), s8.timeline.lightRun && s8.answerFx.count >= (touch ? 300 : 600) && s8.answerFx.started === 1 && revealSeen.some((r) => r > 0 && r < 1) && revealSeen.at(-1) === 1 && !s8.answerFx.reduced,
    `light ran along the line; ${s8.answerFx.count} motes from the line gathered into the sentence (text reveal seen at ${revealSeen.filter((r) => r > 0 && r < 1).map((r) => r.toFixed(2)).join(', ')}); formation ${(s8.timeline.koDone - s8.timeline.light).toFixed(2)} s`);
  check(T('06_while_playing'), before.length >= 15 && gapBefore <= 0.45 && after.length > 0 && s8.crankEnabled,
    `answer ${gapBefore.toFixed(2)} s after the 15th note (no wait; ${before.length - 15} more notes during that moment), ${after.length} more notes played as it appeared; crank stays on`);
  check(T('06_score_keeps_going'), sc8.cState.findIndex((x) => x === 'current') === s8.changedPlayed.at(-1) && sc8.cPass === Math.floor((s8.changedCount - 1) / 12) && sc8.cPass >= 1 && (sc8.cState.filter((x) => x === 'past').length > 0 || sc8.cState.every((x) => x !== 'idle')) && sc8.glyphs.length === sc3.glyphs.length,
    `pass ${sc8.cPass + 1}: current = step ${s8.changedPlayed.at(-1)}, the previous pass stays softly lit, no extra glyphs (${sc8.glyphs.length})`);
  await grab();

  // typography: the family's voice
  await sleep(1500);
  const ans = await page.evaluate(() => { const k = document.querySelector('.answer-ko'), l1 = k.querySelector('.ans-l1'), l2 = k.querySelector('.ans-l2'), e = document.querySelector('.answer-en'), q = document.querySelector('[data-prompt="question"]'); const g = (el) => getComputedStyle(el);
    const r1 = l1.getBoundingClientRect(), r2 = l2.getBoundingClientRect();
    return { ko: k.textContent, en: e.textContent, koSize: parseFloat(g(l2).fontSize), l1Size: parseFloat(g(l1).fontSize), enSize: parseFloat(g(e).fontSize), koW: g(l2).fontWeight, l1W: g(l1).fontWeight, enW: g(e).fontWeight, koC: g(l2).color, l1C: g(l1).color, enC: g(e).color, koOp: +g(k).opacity, enOp: +g(e).opacity, cap: parseFloat(g(q).fontSize), qOp: +g(q).opacity, shadow: g(l2).textShadow, twoLines: r2.top >= r1.bottom - 2 }; });
  const tl8 = s8.timeline;
  check(T('06_answer_text'), ans.ko === '그럼, 다시 외우면 되지.' && ans.en === "Then I'll learn it again.", `"${ans.ko}" / "${ans.en}"`);
  const ratio = ans.koSize / ans.cap;
  const crisp = await page.evaluate(() => ({ filter: [...document.querySelectorAll('.ans-l1, .ans-l2')].map((x) => getComputedStyle(x).filter).every((f) => f === 'none') ? 'none' : 'blur', fx: +getComputedStyle(document.querySelector('.answer-fx')).opacity, n: document.querySelectorAll('.answer-fx').length }));
  const sizeOk = touch ? ans.koSize >= 28 && ans.koSize <= 40 : ans.koSize >= 48 && ans.koSize <= 64;
  const order = (globalThis.__r1 || []).some(([a, b]) => a >= 0.95 && b < 0.6);
  globalThis.__r1 = [];
  check(T('06_two_lines_in_order'), ans.twoLines && order, '"그럼," on its own line, formed first (complete while the main line was still forming); "다시 외우면 되지." below');
  check(T('06_answer_distinct'), sizeOk && ratio >= 1.7 && ans.l1Size < ans.koSize * 0.7 && ['500', '600'].includes(ans.koW) && ans.koC === 'rgb(244, 189, 169)' && ans.l1C === 'rgb(244, 189, 169)' && ans.enSize / ans.koSize <= 0.4 && +ans.enW <= 400 && ans.koOp > 0.98 && ans.enOp > 0.98 && ans.qOp < 0.05,
    `main line ${ans.koSize}px weight ${ans.koW} (${ratio.toFixed(2)}× the ${ans.cap}px captions), "그럼," ${ans.l1Size}px, apricot ${ans.koC}; English ${ans.enSize}px weight ${ans.enW} ${ans.enC}; question gone`);
  check(T('06_text_crisp'), crisp.filter === 'none' && crisp.fx === 0 && crisp.n === 1, `final sentence is sharp HTML text (filter ${crisp.filter}), particle layer cleared, one particle layer`);
  check(T('06_timing'), Math.abs(tl8.answerEn - tl8.koDone - 0.4) < 0.01 && Math.abs(tl8.replay - tl8.koDone - 1.6) < 0.01 && tl8.koDone - tl8.answerAt <= 1.6, `15th note → sentence complete ${(tl8.koDone - tl8.answerAt).toFixed(2)} s; English +${(tl8.answerEn - tl8.koDone).toFixed(2)} s; "다시 감기" +${(tl8.replay - tl8.koDone).toFixed(2)} s`);
  await waitFor(page, () => window.__storge.state.ending.replay);
  await sleep(1800);
  const ak = await rect(page, '.answer-ko'), ae = await rect(page, '.answer-en'), rb = await rect(page, '#replay'), ch = await chainBox(page), br = await boxRect(page), sbt = await rect(page, '#hud-top .subtitle');
  const sb = (await SC(page)).box;
  check(T('06_layout_clear'), !hitsLine(ak, ch.pts) && !hitsLine(ae, ch.pts) && !overlaps(ak, br) && !overlaps(ae, br) && !overlaps(ae, sb) && !overlaps(ak, sb) && !overlaps(rb, sb) && !overlaps(ak, sbt)
    && ak.x0 >= 8 && ak.x1 <= vp.width - 8 && ae.x0 >= 8 && ae.x1 <= vp.width - 8 && ae.y1 <= vp.height,
    `answer ${R({ ...ak, y1: ae.y1 })}, score ${R(sb)}, button ${R(rb)} — nothing overlaps, nothing cut off`);
  await grab();
  await page.screenshot({ path: `${OUT}/${tag}_06_answer.png` });

  // ---- after the answer: still playable, stops when you stop, no duplicate audio
  const a0 = await S(page);
  await sleep(3000);
  const a1 = await S(page);
  await playChanged(page, touch, a1.changedCount + 5, null, null, grab);
  const a2 = await S(page), sc9 = await SC(page);
  const logAll = await page.evaluate((n) => window.__storge.audio.playedLog.slice(n), logN);
  const seq = (await page.evaluate(() => window.__ev)).filter((e) => e.n === 'changed:note').map((e) => e.d.index);
  const seqOk = seq.every((x, i) => i === 0 || x === (seq[i - 1] + 1) % 12);
  check(T('06_play_after_answer'), a1.changedCount === a0.changedCount && a2.changedCount >= a1.changedCount + 5 && a2.story === 'ANSWERED' && sc9.cState.findIndex((x) => x === 'current') === a2.changedPlayed.at(-1),
    `in 06: 3 s still → no new notes; wound again → ${a2.changedCount - a1.changedCount} more notes, score follows; the answer stays`);
  check(T('audio_no_overlap'), logAll.length === a2.changedCount && logAll.every((l) => l.theme === 'storge-theme-changed-v2') && a2.notes === notesBeforeRepair && seqOk,
    `${logAll.length} notes since 05, all the changed melody, one per step in order (${seq.length} steps, no repeats/skips); 01 melody silent`);
  check(T('06_shape_and_glow'), maxDiff(shape05, await shape(page)) < 1e-6 && a2.glow > 1.1 && a2.glow <= 1.19 && a2.spotK > 0,
    `angular line unchanged 05→06 (0 mm), line glow eased to ${a2.glow}, the small light still follows the playing`);
  await grab();
  // film: 04 last piece → 06, as a GIF
  if (tag === 'pc' && frames.length) {
    fs.writeFileSync(`${FR}/frames.json`, JSON.stringify(frames));
  }

  // resize while in 06 (PC: window size, mobile: rotate)
  const vp2 = touch ? { ...vp, width: 844, height: 390 } : { ...vp, width: 1280, height: 720 };
  await page.setViewport(vp2); await sleep(2500);
  const ak2 = await rect(page, '.answer-ko'), ae2 = await rect(page, '.answer-en'), sb2 = (await SC(page)).box, br2 = await boxRect(page), rb2 = await rect(page, '#replay'), ch2 = await chainBox(page);
  const ks2 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ans-l2')).fontSize));
  check(T('resize_ok'), ak2.x0 >= 8 && ak2.x1 <= vp2.width - 8 && ae2.y1 <= vp2.height && sb2.x0 >= 0 && sb2.x1 <= vp2.width && !overlaps(ak2, sb2) && !overlaps(ae2, sb2) && !overlaps(ak2, br2) && !overlaps(rb2, sb2) && !hitsLine(ak2, ch2.pts) && ks2 >= 28,
    `${vp2.width}×${vp2.height}: answer ${R({ ...ak2, y1: ae2.y1 })} at ${ks2}px, score ${R(sb2)}`);
  await page.screenshot({ path: `${OUT}/${tag}_06_resized.png` });
  await page.setViewport(vp); await sleep(2500);

  // ---- replay
  const btn = await rect(page, '#replay');
  const bx = (btn.x0 + btn.x1) / 2, by = (btn.y0 + btn.y1) / 2;
  if (touch) await page.touchscreen.tap(bx, by); else await page.mouse.click(bx, by);
  await sleep(1800);
  await waitFor(page, () => +getComputedStyle(document.getElementById('hud-bottom')).opacity > 0.9, null, 60000).catch(() => {});
  const r = await S(page), rs = await SC(page), c1 = await counts(page);
  const hintOp = await page.evaluate(() => +getComputedStyle(document.getElementById('hud-bottom')).opacity);
  const conds = { story: r.story === 'INTRO', wound: r.wound === 0, crank: Math.abs(r.crankAngle) <= 0.29, line: !r.melodyVisible && r.progress === 0, tension: r.tremor === 0 && r.taut === 0,
    pieces: r.pieces === 0, repaired: r.connected === 0, music: !r.musicStopped && r.notes === 0 && r.shatterPlayed === 0, changedMelody: r.changedCount === 0 && r.changedBeat === 0,
    scoreProgress: rs.oState.every((x) => x === 'idle') && rs.cState.every((x) => x === 'idle') && rs.cPass === 0, scoreView: rs.page === 'o0' && rs.mode === 'play', texts: r.prompt === 'intro' && r.hintPhase === '' && hintOp > 0.9,
    ending: !r.ending.ko && !r.ending.en && !r.ending.replay && !r.answerFx.active && r.answerFx.reveal === 0, inputs: r.crankEnabled && !r.dragEnabled, light: r.spotK === 0 && r.glow === 1, tones: r.repairTones.length === 0 };
  const bad = Object.entries(conds).filter(([, v]) => !v).map(([k]) => k);
  check(T('replay_resets_everything'), bad.length === 0, bad.length ? `not reset: ${bad.join(', ')}` : `all ${Object.keys(conds).length} groups back to 01`);
  check(T('replay_no_leftovers'), c1.scene === c0.scene && c1.mirror === c0.mirror && c1.notes === c0.notes, `scene objects ${c0.scene}→${c1.scene}, reflections ${c0.mirror}→${c1.mirror}, score glyphs ${c0.notes}→${c1.notes}`);

  // ---- second complete run (story clock ×4 for the waits; input is still real)
  await page.evaluate(() => window.__storge.setSpeed(4));
  const n0 = await page.evaluate(() => window.__storge.audio.playedLog.length);
  await windToBreak(page, touch, at);
  await repairAll(page, touch);
  await waitFor(page, () => window.__storge.state.againShown);
  const r2 = await S(page);
  await playChanged(page, touch, 99, null, (st) => st.story === 'ANSWERED');
  await playChanged(page, touch, (await S(page)).changedCount + 4);
  await waitFor(page, () => window.__storge.state.ending.replay);
  const r3 = await S(page), log2 = await page.evaluate((n) => window.__storge.audio.playedLog.slice(n).map((l) => l.theme), n0);
  const fxN = await page.evaluate(() => document.querySelectorAll('.answer-fx').length);
  check(T('second_run_ok'), fxN === 1 && r3.answerFx.started === 1 && r2.shatterPlayed === 1 && r2.pieces === 5 && r2.changedCount === 0 && log2.filter((t) => t.includes('changed')).length === r3.changedCount && r3.changedCount >= 19 && r3.repairTones.length === 4 && r3.story === 'ANSWERED' && r3.crankEnabled && (await counts(page)).notes === c0.notes,
    `again: one "쨍", 5 pieces, 4 repair tones, ${r3.changedCount} changed notes = ${r3.changedCount} sounds (no doubling), ending reached while playing, particles once (layers: ${fxN})`);
  const wp = await page.evaluate(() => window.__wheelPrevented);
  check(T('no_page_scroll'), (await page.evaluate(() => window.scrollY)) === 0 && (touch || wp.every(Boolean)), touch ? 'page never scrolled' : `${wp.length} wheel events, all kept from scrolling`);
  check(T('console_clean'), errors.length === 0, errors.slice(0, 3).join(' | ') || '0 errors');
  await page.close();
}

// ======================================================================= mobile landscape
if (!ONLY || ONLY === 'landscape') {
  const vp = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const { page, errors } = await open(vp, 4, true);
  const at = [600, 330, 60];
  const sc0 = await SC(page), br0 = await boxRect(page), hint = await rect(page, '#hint'), top = await rect(page, '#hud-top');
  check('landscape_01_layout', !overlaps(sc0.box, br0) && !overlaps(sc0.box, hint) && sc0.box.y0 > top.y1 && sc0.s >= 6.5, `score ${R(sc0.box)} (line gap ${sc0.s.toFixed(1)} px), box ${R(br0)}, hint ${R(hint)}`);
  await page.screenshot({ path: `${OUT}/landscape_01.png` });
  await windToBreak(page, true, at);
  await repairAll(page, true);
  await waitFor(page, () => window.__storge.state.againShown);
  await playChanged(page, true, 6, at);
  await page.screenshot({ path: `${OUT}/landscape_05.png` });
  await playChanged(page, true, 99, at, (st) => st.story === 'ANSWERED');
  await waitFor(page, () => window.__storge.state.ending.replay);
  await sleep(2600);
  const ak = await rect(page, '.answer-ko'), ae = await rect(page, '.answer-en'), rb = await rect(page, '#replay'), ch = await chainBox(page), br = await boxRect(page), sb = (await SC(page)).box;
  const lks = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ans-l2')).fontSize));
  const lst = await S(page);
  check('landscape_reduced_motion', lst.answerFx.reduced && lst.answerFx.count === 0 && lst.ending.ko && lst.ending.en, 'with "reduce motion": no particles, the sentence simply fades in; English follows');
  check('landscape_06_layout', lks >= 24 && !hitsLine(ak, ch.pts) && !hitsLine(ae, ch.pts) && !overlaps(ak, br) && !overlaps(ae, rb) && !overlaps(ae, sb) && !overlaps(rb, sb) && ak.x0 >= 8 && ak.x1 <= 836 && ak.y0 >= 0 && ae.y1 <= 390,
    `answer ${R({ ...ak, y1: ae.y1 })} at ${lks}px, score ${R(sb)}, button ${R(rb)} in 844×390`);
  await page.screenshot({ path: `${OUT}/landscape_06.png` });
  check('landscape_console_clean', errors.length === 0, errors.slice(0, 3).join(' | ') || '0 errors');
  await page.close();
}

const all = Object.values(results).every((r) => r.pass);
fs.writeFileSync(`${OUT}/e2e_score_report${ONLY ? '_' + ONLY : ''}.json`, JSON.stringify({ all_pass: all, total: Object.keys(results).length, results }, null, 1));
console.log(all ? `\nALL PASS (${Object.keys(results).length})` : '\nSOME FAILED');
await browser.close();
