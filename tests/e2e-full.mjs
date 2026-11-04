// STORGE 01–06 integration test with real Chrome input (wheel / touch / mouse & finger drag / button).
// Normal-browser audio rule emulated (sound only after a click / touch-end).
// usage: node tests/e2e-full.mjs <baseUrl> [pc|mobile|landscape]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const ONLY = process.argv[3];
const OUT = 'tests/shots/v6/e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
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
const waitFor = (page, fn, arg, timeout = 400000) => page.waitForFunction(fn, { timeout, polling: 200 }, arg);
const settle = (page) => waitFor(page, () => { const s = window.__storge.state; return Math.abs(s.pending) < 1e-6 && Math.abs(s.progress - s.shownProgress) < 0.003; });
const wind = async (page, touch, n) => {
  for (let i = 0; i < n; i++) {
    if (touch) { await page.touchscreen.touchStart(200, 640); for (let j = 1; j <= 8; j++) await page.touchscreen.touchMove(200, 640 - 40 * j); await page.touchscreen.touchEnd(); }
    else { await page.mouse.wheel({ deltaY: 120 }); await sleep(14); }
  }
};
const windTouchAt = async (page, x, y0, y1, n) => { for (let i = 0; i < n; i++) { await page.touchscreen.touchStart(x, y0); for (let j = 1; j <= 8; j++) await page.touchscreen.touchMove(x, y0 + (y1 - y0) * j / 8); await page.touchscreen.touchEnd(); } };
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
/** wind past full -> tension -> break, then reconnect all pieces */
async function playToRepaired(page, touch, swipe) {
  const windIt = (n) => (swipe ? windTouchAt(page, ...swipe, n) : wind(page, touch, n));
  for (let i = 0; i < 80 && (await S(page)).story !== 'TENSION'; i++) { await windIt(1); if (i % 4 === 3) await settle(page); }
  await waitFor(page, () => window.__storge.state.story === 'TENSION');
  for (let i = 0; i < 80 && ['TENSION'].includes((await S(page)).story); i++) await windIt(1);
  await waitFor(page, () => window.__storge.state.story === 'REPAIRING');
  for (let k = 1; k <= 4; k++) {
    await dragPiece(page, k, touch);
    await waitFor(page, (k) => window.__storge.state.connected === k + 1, k, 120000).catch(() => {});
  }
  await waitFor(page, () => ['REPAIRED', 'CHANGED', 'ANSWERED'].includes(window.__storge.state.story));
}
const rect = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }, sel);
const chainBox = (page, pad = 0) => page.evaluate((pad) => {
  const P = window.__storge.pieces(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of P) for (const q of p.screenPts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad, pts: P.flatMap((p) => p.screenPts) };
}, pad);
const boxRect = (page) => page.evaluate(() => {
  const S = window.__storge, T = S.THREE, b = new T.Box3().setFromObject(S.musicBox.root), c = S.stage.camera; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new T.Vector3(x, y, z).project(c); const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  return { x0, x1, y0, y1 };
});
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
// text box vs the actual line: any line sample (with its glow margin) inside the text box?
const hitsLine = (r, pts, m = 10) => pts.some((q) => q.x > r.x0 - m && q.x < r.x1 + m && q.y > r.y0 - m && q.y < r.y1 + m);
const shape = (page) => page.evaluate(() => window.__storge.scenes.current.fragments.pieces.map((p) => p.worldPoints(30).map((v) => v.toArray())).flat());
const maxDiff = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2])));
const counts = (page) => page.evaluate(() => ({ scene: window.__storge.stage.scene.children.length, mirror: window.__storge.state.mirrorChildren }));

const runs = [
  ['pc', { width: 1600, height: 900, deviceScaleFactor: 1 }, false],
  ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true],
].filter(([t]) => !ONLY || ONLY === t);

for (const [tag, vp, touch] of runs) {
  const T = (k) => `${tag}_${k}`;
  const { page, errors } = await open(vp, 1);
  const c0 = await counts(page);
  const s0 = await S(page);
  const mats = await page.evaluate(() => { const o = {}; window.__storge.musicBox.root.traverse((m) => { if (m.isMesh) o[m.material.name] = [m.material.map ? m.material.map.image.width : 0, m.material.metalness, +m.material.roughness.toFixed(2)]; }); return o; });
  check(T('glb_loaded_materials'), s0.story === 'INTRO' && mats.M_Maple_Wood[0] === 1024 && mats.M_RoseGold_Copper[1] === 1, JSON.stringify(mats));
  if (!touch) { await page.mouse.move(1100, 450); await page.mouse.click(1100, 300); }
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());

  // 01–02
  await wind(page, touch, touch ? 2 : 12); await settle(page);
  const s1 = await S(page);
  const log1 = await page.evaluate(() => window.__storge.audio.playedLog.map((l) => l.theme));
  check(T('01_crank_turns_original_melody'), Math.abs(s1.crankAngle) > 1 && s1.notesAudible > 0 && log1.length > 0 && log1.every((t) => t === 'storge-theme-v0'),
    `crank ${s1.crankAngle.toFixed(2)} rad, ${log1.length} notes, all from the 01 theme`);
  check(T('01_melody_glow'), s1.melodyVisible && await page.evaluate(() => window.__storge.stage.glowSource.active()), 'line visible, selective glow on');
  await page.screenshot({ path: `${OUT}/${tag}_01_02.png` });

  // 02 tension -> 03 break -> 04 repair
  await playToRepaired(page, touch);
  const s2 = await S(page);
  const H = Object.fromEntries(s2.history.map((h) => [h.state, h.t]));
  check(T('02_03_04_sequence'), ['INTRO', 'LOVE_EXPANDING', 'TENSION', 'BROKEN', 'REPAIRING', 'REPAIRED'].every((k) => k in H) && s2.shatterPlayed === 1 && s2.pieces === 5,
    s2.history.map((h) => `${h.state}@${h.t}`).join(' → '));
  const wait = +(H.REPAIRING - H.BROKEN).toFixed(2);
  check(T('04_drag_after_2_6s'), Math.abs(wait - 2.6) <= 0.06, `break → drag enabled: ${wait} s of story time (target 2.6 s, one frame tolerance)`);
  check(T('04_all_connected_angular'), s2.connected === 5 && await page.evaluate(() => window.__storge.scenes.current.fragments.pieces.slice(1).every((p) => p.morph === 1 || p.morphing)), '4 pieces dragged and snapped, angular shape');
  check(T('box_static_through_break'), JSON.stringify(await page.evaluate(() => window.__storge.bodyMatrix())) === JSON.stringify(body0), 'music box never moved');

  // 05
  await waitFor(page, () => window.__storge.state.story === 'CHANGED');
  const shapeAtChange = await shape(page);
  const s3 = await S(page); const H3 = Object.fromEntries(s3.history.map((h) => [h.state, h.t]));
  await sleep(4000);
  const s4 = await S(page);
  const log5 = await page.evaluate((t0) => window.__storge.audio.playedLog.filter((l) => l.t >= t0).map((l) => l.theme), (await page.evaluate(() => performance.now() / 1000)) - 4);
  check(T('05_auto_after_repair'), Math.abs((H3.CHANGED - H3.REPAIRED) - 1.6) <= 0.06, `repaired → new melody after ${(H3.CHANGED - H3.REPAIRED).toFixed(2)} s`);
  check(T('05_new_melody_plays'), s4.variantRunning && s4.variantNotes > 3 && log5.length > 0 && log5.every((t) => t === 'storge-theme-changed-v1') && s4.audioState === 'running',
    `${s4.variantNotes} notes of the changed theme scheduled; notes in the last 4 s: ${[...new Set(log5)].join(',')}`);
  const spots = [];
  for (let i = 0; i < 4; i++) { spots.push(await page.evaluate(() => [window.__storge.state.spot, window.__storge.state.spotK])); await sleep(700); }
  check(T('05_light_moves_with_music'), spots.every((s) => s[1] > 0) && new Set(spots.map((s) => s[0])).size >= 3, `spot position ${spots.map((s) => s[0]).join(' → ')}, strength ${spots.map((s) => s[1]).join('/')}`);
  const mel = await page.evaluate(async () => {
    const a = (await import('/src/audio/melodies/storgeTheme.js')).storgeTheme, b = (await import('/src/audio/melodies/storgeThemeChanged.js')).storgeThemeChanged;
    const { noteToMidi } = await import('/src/audio/melodyTools.js');
    const pa = a.steps.filter((s) => s.note).map((s) => noteToMidi(s.note) + (a.transpose || 0));
    const pb = b.steps.filter((s) => s.note).map((s) => noteToMidi(s.note) + (b.transpose || 0));
    const ia = pa.slice(1).map((x, i) => x - pa[i]), ib = pb.slice(1).map((x, i) => x - pb[i]);
    // longest common subsequence of melodic steps (handles a note that was dropped/added)
    const L = Array.from({ length: ia.length + 1 }, () => new Array(ib.length + 1).fill(0));
    for (let i = 1; i <= ia.length; i++) for (let j = 1; j <= ib.length; j++) L[i][j] = ia[i - 1] === ib[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    const n = ia.length, same = L[ia.length][ib.length];
    const durs = new Set(b.steps.map((s) => s.beats)), bass = a.steps.filter((s) => s.bass).map((s) => s.bass).join(), bassB = b.steps.filter((s) => s.bass).map((s) => s.bass).join();
    return { motifSame: ia.slice(0, 5).join() === ib.slice(0, 5).join(), intervalShare: +(same / n).toFixed(2), pitchesChanged: pa.filter((x, i) => pb[i] !== x).length, of: pa.length, rhythms: [...durs], bassChanged: bass !== bassB, bpm: b.bpm, transpose: b.transpose };
  });
  check(T('05_recognisable_but_different'), mel.motifSame && mel.intervalShare >= 0.6 && mel.intervalShare < 1 && mel.pitchesChanged > 10 && mel.rhythms.length >= 3 && mel.bassChanged,
    `opening motif kept; ${Math.round(mel.intervalShare * 100)} % of the original melodic steps still there (in order); every pitch moved (transpose ${mel.transpose}) + changed notes; note lengths ${mel.rhythms.join('/')} beats; new harmony; ${mel.bpm} bpm`);
  await waitFor(page, () => window.__storge.state.prompt === 'question');
  const qOp0 = await page.evaluate(() => +getComputedStyle(document.querySelector('[data-prompt="question"]')).opacity);
  await sleep(2200);
  const q = await page.evaluate(() => { const e = document.querySelector('[data-prompt="question"]'); return { text: e.textContent.replace(/\s+/g, ' ').trim(), op: +getComputedStyle(e).opacity, font: getComputedStyle(e).fontFamily, size: parseFloat(getComputedStyle(e).fontSize) }; });
  const qr = await rect(page, '[data-prompt="question"]'), ch = await chainBox(page), br = await boxRect(page);
  check(T('05_question_text'), q.text === '멜로디가 바뀐 나, 가족들은 날 기억할까요?' && q.font.includes('Pretendard') && q.size >= 15, `"${q.text}" · ${q.size}px Pretendard`);
  check(T('05_question_fades_in'), qOp0 < 0.9 && q.op > 0.98, `opacity when it appears ${qOp0.toFixed(2)} → ${q.op}`);
  check(T('05_question_clear_of_line_and_box'), !hitsLine(qr, ch.pts) && !overlaps(qr, br) && qr.x0 >= 0 && qr.x1 <= vp.width, `question box ${JSON.stringify(Object.fromEntries(Object.entries(qr).map(([k, v]) => [k, Math.round(v)])))}`);
  await page.screenshot({ path: `${OUT}/${tag}_05_question.png` });

  // pause, then 06
  await waitFor(page, () => window.__storge.state.prompt === null);
  const gap = await S(page);
  check(T('06_pause_between'), !gap.ending.ko && gap.story === 'CHANGED', 'question gone, answer not yet shown (empty moment)');
  await waitFor(page, () => window.__storge.state.story === 'ANSWERED');
  const s5 = await S(page); const H5 = Object.fromEntries(s5.history.map((h) => [h.state, h.t]));
  await waitFor(page, () => window.__storge.state.ending.replay);
  await sleep(2500);
  const ans = await page.evaluate(() => ({ ko: document.querySelector('.answer-ko').textContent, en: document.querySelector('.answer-en').textContent,
    koOp: +getComputedStyle(document.querySelector('.answer-ko')).opacity, enOp: +getComputedStyle(document.querySelector('.answer-en')).opacity,
    koSize: parseFloat(getComputedStyle(document.querySelector('.answer-ko')).fontSize), enSize: parseFloat(getComputedStyle(document.querySelector('.answer-en')).fontSize) }));
  const ak = await rect(page, '.answer-ko'), ae = await rect(page, '.answer-en'), rb = await rect(page, '#replay');
  const ch2 = await chainBox(page);
  check(T('06_answer_exact_text'), ans.ko === '그럼, 다시 외우면 되지.' && ans.en === "Then I'll learn it again.", `"${ans.ko}" / "${ans.en}"`);
  check(T('06_answer_visible_ko_main_en_below'), ans.koOp > 0.98 && ans.enOp > 0.98 && ans.koSize > ans.enSize * 1.6 && ae.y0 >= ak.y1 - 2, `Korean ${ans.koSize}px, English ${ans.enSize}px below it`);
  check(T('06_answer_clear_and_inside'), !hitsLine(ak, ch2.pts) && !hitsLine(ae, ch2.pts) && !overlaps(ak, br) && !overlaps(ae, br) && ak.x0 >= 8 && ak.x1 <= vp.width - 8 && ae.x0 >= 8 && ae.x1 <= vp.width - 8 && !overlaps(ak, rb),
    `answer ${Math.round(ak.x0)}–${Math.round(ak.x1)} × ${Math.round(ak.y0)}–${Math.round(ae.y1)}, not over the line, the box or the button, not cut off`);
  check(T('06_timing'), Math.abs((H5.ANSWERED - H5.CHANGED) - (5.5 + 7 + 1.6 + 2.2)) <= 0.08, `new melody → question 5.5 s → shown 7 s → fade 1.6 s → pause 2.2 s → answer (${(H5.ANSWERED - H5.CHANGED).toFixed(2)} s)`);
  const shapeEnd = await shape(page);
  check(T('06_angular_shape_kept'), maxDiff(shapeAtChange, shapeEnd) < 1e-6, `repaired shape unchanged from 05 to 06 (max ${(maxDiff(shapeAtChange, shapeEnd) * 1000).toFixed(4)} mm)`);
  check(T('06_melody_keeps_playing_and_glows'), s5.variantRunning && (await S(page)).variantNotes > s4.variantNotes && (await S(page)).glow > 1.05, `still playing the changed melody; line glow ${(await S(page)).glow}`);
  await page.screenshot({ path: `${OUT}/${tag}_06_answer.png` });
  await sleep(6000);
  const stay = await S(page);
  check(T('06_ending_stays'), stay.ending.ko && stay.ending.en && stay.ending.replay && stay.story === 'ANSWERED', 'answer and "다시 감기" still there 6 s later');

  // replay
  const btn = await rect(page, '#replay');
  const bx = (btn.x0 + btn.x1) / 2, by = (btn.y0 + btn.y1) / 2;
  if (touch) await page.touchscreen.tap(bx, by); else await page.mouse.click(bx, by);
  await sleep(1500);
  const r = await S(page), c1 = await counts(page);
  const hintOp = await page.evaluate(() => +getComputedStyle(document.getElementById('hud-bottom')).opacity);
  await waitFor(page, () => +getComputedStyle(document.getElementById('hud-bottom')).opacity > 0.95, null, 60000).catch(() => {});
  const hintOp2 = await page.evaluate(() => +getComputedStyle(document.getElementById('hud-bottom')).opacity);
  const crankRest = await page.evaluate(() => window.__storge.scenes.current.melody && Math.abs(window.__storge.state.crankAngle) <= 0.29);   // only the idle "turn me" nudge (≤16°)
  const conds = { story: r.story === 'INTRO', wound: r.wound === 0, pending: r.pending === 0, crankAtRest: crankRest, progress: r.progress === 0, melodyHidden: !r.melodyVisible, noPieces: r.pieces === 0,
    changedMelodyOff: !r.variantRunning, firstNote: r.notes === 0, musicReady: !r.musicStopped, noShatter: r.shatterPlayed === 0, prompt: r.prompt === 'intro',
    endingHidden: !r.ending.ko && !r.ending.en && !r.ending.replay, inputs: r.crankEnabled && !r.dragEnabled, hint: hintOp2 > 0.9, relaxed: r.tremor === 0 && r.taut === 0 };
  const bad = Object.entries(conds).filter(([, v]) => !v).map(([k]) => k);
  check(T('replay_resets_everything'), bad.length === 0, bad.length ? `not reset: ${bad.join(', ')}` : `all ${Object.keys(conds).length} items back to the start (state, wound, crank, line, pieces, both melodies, prompt, ending, inputs, hint, tension)`);
  check(T('replay_no_leftovers'), c1.scene === c0.scene && c1.mirror === c0.mirror, `scene objects ${c0.scene} → ${c1.scene}, reflections ${c0.mirror} → ${c1.mirror}`);
  await page.screenshot({ path: `${OUT}/${tag}_replay_start.png` });

  // second run: everything works again, nothing doubled
  const before2 = await page.evaluate(() => window.__storge.audio.playedLog.length);
  await wind(page, touch, touch ? 2 : 12); await settle(page);
  const r2 = await S(page);
  const log2 = await page.evaluate((n) => window.__storge.audio.playedLog.slice(n).map((l) => l.theme), before2);
  check(T('replay_second_run_original_melody'), r2.story === 'LOVE_EXPANDING' && log2.length > 0 && log2.every((t) => t === 'storge-theme-v0') && !r2.variantRunning, `${log2.length} notes of the 01 theme again, changed melody silent`);
  await playToRepaired(page, touch);
  const r3 = await S(page);
  check(T('replay_second_run_no_duplicates'), r3.shatterPlayed === 1 && r3.pieces === 5 && (await counts(page)).scene === c0.scene + 5 + 2 * 0, `one "쨍", 5 pieces (not 10), scene objects ${(await counts(page)).scene}`);
  await waitFor(page, () => window.__storge.state.story === 'CHANGED');
  await sleep(3000);
  const r4 = await S(page);
  const perSec = await page.evaluate(async () => { const a = window.__storge.state.variantNotes; await new Promise((r) => setTimeout(r, 5000)); return (window.__storge.state.variantNotes - a) / 5; });
  check(T('replay_music_not_doubled'), r4.variantRunning && perSec > 0.5 && perSec < 2.4, `changed melody ${perSec.toFixed(2)} notes/s (one player: 72 bpm ≈ 1.1 notes/s)`);
  const wp = await page.evaluate(() => window.__wheelPrevented);
  check(T('no_scroll'), (await page.evaluate(() => window.scrollY)) === 0 && (touch || wp.every(Boolean)), touch ? 'page never scrolled' : `${wp.length} wheel events, all prevented`);
  check(T('console_clean'), errors.length === 0, errors.slice(0, 3).join(' | ') || '0 errors');
  await page.close();
}

// ======================================================================= mobile landscape: ending layout
if (!ONLY || ONLY === 'landscape') {
  const { page, errors } = await open({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 4);
  await playToRepaired(page, true, [600, 350, 70]);
  await waitFor(page, () => window.__storge.state.ending.replay);
  await sleep(2500);
  const ak = await rect(page, '.answer-ko'), ae = await rect(page, '.answer-en'), rb = await rect(page, '#replay'), ch = await chainBox(page), br = await boxRect(page);
  const ans = await page.evaluate(() => [document.querySelector('.answer-ko').textContent, document.querySelector('.answer-en').textContent]);
  check('landscape_answer_not_cut_or_covering', ans[0] === '그럼, 다시 외우면 되지.' && !hitsLine(ak, ch.pts) && !hitsLine(ae, ch.pts) && !overlaps(ak, br) && !overlaps(ae, rb) && ak.x0 >= 8 && ak.x1 <= 836 && ak.y0 >= 0 && ae.y1 <= 390,
    `answer ${Math.round(ak.x0)}–${Math.round(ak.x1)} × ${Math.round(ak.y0)}–${Math.round(ae.y1)} in 844×390`);
  await page.screenshot({ path: `${OUT}/landscape_06_answer.png` });
  check('landscape_console_clean', errors.length === 0, errors.slice(0, 3).join(' | ') || '0 errors');
  await page.close();
}

const all = Object.values(results).every((r) => r.pass);
fs.writeFileSync(`${OUT}/e2e_full_report${ONLY ? '_' + ONLY : ''}.json`, JSON.stringify({ all_pass: all, total: Object.keys(results).length, results }, null, 1));
console.log(all ? `\nALL PASS (${Object.keys(results).length})` : '\nSOME FAILED');
await browser.close();
