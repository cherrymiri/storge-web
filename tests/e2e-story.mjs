// STORGE 02–04 story test (real Chrome input: wheel, mouse drag, touch). usage: node tests/e2e-story.mjs <baseUrl>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tests/shots/v4/e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument(() => {      // normal-browser audio rule (see e2e-v3)
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
  await page.goto(BASE + '?debug', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
  // logged after the app's own listener, so it sees whether the app prevented the scroll
  await page.evaluate(() => { window.__wheelPrevented = []; window.addEventListener('wheel', (e) => window.__wheelPrevented.push(e.defaultPrevented), { passive: true }); });
  await sleep(800);
  return { page, errors };
}
const S = (page) => page.evaluate(() => window.__storge.state);
const waitFor = (page, fn, arg, timeout = 180000) => page.waitForFunction(fn, { timeout, polling: 200 }, arg);
const settle = (page) => waitFor(page, () => { const s = window.__storge.state; return Math.abs(s.pending) < 1e-6 && Math.abs(s.progress - s.shownProgress) < 0.003; });

// geometry helpers evaluated in the page
const geo = (page) => page.evaluate(() => {
  const st = window.__storge, T = st.THREE, F = st.scenes.current.fragments;
  const body = new T.Box3().setFromObject(st.musicBox.body).expandByScalar(0.002);
  const turn = (pts) => { let mx = 0; for (let i = 2; i < pts.length; i++) { const a = pts[i - 1].clone().sub(pts[i - 2]).normalize(), b = pts[i].clone().sub(pts[i - 1]).normalize(); mx = Math.max(mx, Math.acos(Math.min(1, a.dot(b))) * 180 / Math.PI); } return mx; };
  return F.pieces.map((p) => {
    const w = p.worldPoints(60);
    return {
      index: p.index, connected: p.connected, morph: p.morph, dim: p.dim.value, radius: p.mesh.geometry.parameters.radius,
      insideBody: w.some((q) => body.containsPoint(q)),
      maxTurnDeg: +turn(w).toFixed(1),
      start: p.worldStart().toArray(), end: p.worldEnd().toArray(),
      endTangent: w[60].clone().sub(w[57]).normalize().toArray(), startTangent: w[3].clone().sub(w[0]).normalize().toArray(),
      pts: w.map((q) => q.toArray()),
    };
  });
});
const screenBounds = (page) => page.evaluate(() => {
  const st = window.__storge, P = st.pieces(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of P) for (const q of p.screenPts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  return { x0, x1, y0, y1, W: innerWidth, H: innerHeight, header: document.getElementById('hud-top').getBoundingClientRect().bottom };
});
const angleDeg = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI;

async function dragPiece(page, k, touch, { toChain = true, grabOff = 0 } = {}) {
  const info = await page.evaluate((k) => ({ piece: window.__storge.pieces()[k], end: window.__storge.chainEndScreen() }), k);
  const g0 = info.piece.screenPts[8], g1 = info.piece.screenPts[9];
  // grab point, optionally offset sideways from the line (tests the generous pick radius)
  const nx = -(g1.y - g0.y), ny = g1.x - g0.x, nl = Math.hypot(nx, ny) || 1;
  const gx = g0.x + nx / nl * grabOff, gy = g0.y + ny / nl * grabOff;
  const s = info.piece.start, e = info.end;
  const tx = gx + (toChain ? e.x - s.x : 0) + (toChain ? 6 : 140), ty = gy + (toChain ? e.y - s.y : 0) + (toChain ? -5 : -60);
  const steps = 14;
  if (touch) {
    await page.touchscreen.touchStart(gx, gy);
    for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(gx + (tx - gx) * i / steps, gy + (ty - gy) * i / steps); await sleep(12); }
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(gx, gy); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(gx + (tx - gx) * i / steps, gy + (ty - gy) * i / steps); await sleep(12); }
    await page.mouse.up();
  }
}
const wind = async (page, touch, n) => {
  for (let i = 0; i < n; i++) {
    if (touch) { await page.touchscreen.touchStart(200, 640); for (let j = 1; j <= 8; j++) await page.touchscreen.touchMove(200, 640 - 40 * j); await page.touchscreen.touchEnd(); }
    else { await page.mouse.wheel({ deltaY: 120 }); await sleep(14); }
  }
};

for (const [tag, vp, touch] of [
  ['pc', { width: 1600, height: 900, deviceScaleFactor: 1 }, false],
  ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true],
]) {
  const T = (k) => `${tag}_${k}`;
  const { page, errors } = await open(vp);
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());
  const nodes0 = await page.evaluate(() => { const n = []; window.__storge.musicBox.root.traverse((o) => n.push(o.name)); return n.join(','); });
  if (!touch) { await page.mouse.move(1100, 450); await page.mouse.click(1100, 300); }   // a click lets the browser play sound

  // ---- 01 → 02
  const s0 = await S(page);
  check(T('01_intro'), s0.story === 'INTRO' && s0.prompt === 'intro', `state ${s0.story}, prompt ${s0.prompt}`);
  await wind(page, touch, touch ? 3 : 15);
  await settle(page);
  const s1 = await S(page);
  check(T('02_love_expanding'), s1.story === 'LOVE_EXPANDING' && s1.prompt === 'winding' && s1.progress > 0.1 && s1.progress < 1, `state ${s1.story}, progress ${s1.progress.toFixed(2)}, prompt "${s1.prompt}"`);
  check(T('02_no_tremor_before_full'), s1.tremor === 0 && s1.taut === 0, `tremor ${s1.tremor}, taut ${s1.taut} while the melody is still growing`);
  check(T('02_music_plays'), s1.audioState === 'running' && s1.notesAudible > 0, `AudioContext ${s1.audioState}, audible notes ${s1.notesAudible}`);
  for (let i = 0; i < 40 && (await S(page)).story !== 'TENSION'; i++) { await wind(page, touch, 1); if (i % 4 === 3) await settle(page); }
  await waitFor(page, () => window.__storge.state.story === 'TENSION');
  const s2 = await S(page);
  check(T('02_tension_after_full'), s2.story === 'TENSION' && s2.progress === 1, `state ${s2.story} once the melody is complete`);
  // a bit more winding -> taut + trembling, not broken yet
  await wind(page, touch, touch ? 1 : 7);
  await settle(page); await sleep(2500);
  const s3 = await S(page);
  check(T('02_trembles_and_taut'), s3.story === 'TENSION' && s3.tremor > 0 && s3.taut > 0 && s3.tremor < 0.003 && s3.taut <= 0.66, `tension ${s3.tensionShown.toFixed(2)}: tremor ${(s3.tremor * 1000).toFixed(2)} mm (thread radius 1.6 mm), waves flattened ${(s3.taut * 100).toFixed(1)} %`);
  const mesh = await page.evaluate(() => window.__storge.melodyMesh());
  check(T('02_one_thread_same_thickness'), mesh.radius === 0.0016 && mesh.type === 'Mesh', `one TubeGeometry, radius ${mesh.radius} m (tremor moves whole rings, never the radius)`);
  await page.screenshot({ path: `${OUT}/${tag}_1_tension.png` });

  // ---- 03 break
  const nb0 = s3.notesAudible;
  for (let i = 0; i < 40 && (await S(page)).story === 'TENSION'; i++) await wind(page, touch, 1);
  await waitFor(page, () => window.__storge.state.story === 'BROKEN');
  const s4 = await S(page);
  await page.screenshot({ path: `${OUT}/${tag}_2_break.png` });
  check(T('03_breaks_at_limit'), s4.story === 'BROKEN' && s4.pieces === 5 && !s4.melodyVisible, `state ${s4.story}, ${s4.pieces} pieces, whole melody hidden`);
  check(T('03_shatter_sound_once'), s4.shatterPlayed === 1, `"쨍" played ${s4.shatterPlayed}×`);
  check(T('03_music_stopped'), s4.musicStopped, 'music box notes cut at the break');
  check(T('03_prompt'), s4.prompt === 'broken', `prompt "${s4.prompt}"`);
  check(T('03_few_sprinkles'), s4.sprinkles > 0 && s4.sprinkles <= 20, `${s4.sprinkles} tiny crumbs`);
  // pieces are exact cuts of the curve that was on screen (checked right after the break)
  const fid = await page.evaluate(() => {
    const F = window.__storge.scenes.current.fragments, cuts = window.__storge.scenes.current.fragments.curve;
    let maxDev = 0;
    F.pieces.forEach((p, k) => {
      const u0 = [0, 0.17, 0.37, 0.55, 0.79, 1][k], u1 = [0, 0.17, 0.37, 0.55, 0.79, 1][k + 1];
      const loc = p.smooth.getSpacedPoints(20);
      // compare shape (rigid): distances from the piece start to each sample
      const orig = Array.from({ length: 21 }, (_, i) => cuts.getPointAt(u0 + (u1 - u0) * i / 20));
      for (let i = 0; i <= 20; i++) maxDev = Math.max(maxDev, Math.abs(loc[i].length() - orig[i].distanceTo(orig[0])));
    });
    return maxDev;
  });
  check(T('03_pieces_keep_original_bends'), fid < 0.0003, `pieces match the original curve shape within ${(fid * 1000).toFixed(3)} mm`);
  const g4 = await geo(page);
  check(T('03_piece_ends_closed_same_thickness'), g4.every((p) => p.radius === 0.0016), 'each piece: same radius 1.6 mm tube with rounded closed ends');
  // wheel / swipe after the break does nothing
  const w0 = s4.wound, a0 = s4.crankAngle;
  await wind(page, touch, touch ? 2 : 10);
  await sleep(800);
  const s5 = await S(page);
  check(T('03_winding_disabled'), s5.wound === w0 && s5.crankAngle === a0 && s5.notesAudible === s4.notesAudible && !s5.crankEnabled, `wound ${w0.toFixed(2)}→${s5.wound.toFixed(2)}, crank angle unchanged, no new notes`);
  await waitFor(page, () => window.__storge.state.sprinkles === 0);
  await page.screenshot({ path: `${OUT}/${tag}_3_scattered.png` });
  const b5 = await screenBounds(page);
  const g5 = await geo(page);
  check(T('03_pieces_stay_on_screen'), b5.x0 > 4 && b5.x1 < b5.W - 4 && b5.y0 > b5.header && b5.y1 < b5.H - 40, `pieces within x ${b5.x0.toFixed(0)}–${b5.x1.toFixed(0)}/${b5.W}, y ${b5.y0.toFixed(0)}–${b5.y1.toFixed(0)} (text ends ${b5.header.toFixed(0)})`);
  check(T('03_box_and_crank_intact'), g5.every((p) => !p.insideBody) && JSON.stringify(await page.evaluate(() => window.__storge.bodyMatrix())) === JSON.stringify(body0)
    && (await page.evaluate(() => { const n = []; window.__storge.musicBox.root.traverse((o) => n.push(o.name)); return n.join(','); })) === nodes0, 'body unmoved, all GLB parts present, no piece inside the box');

  // ---- 04 repair
  await waitFor(page, () => window.__storge.state.story === 'REPAIRING');
  const s6 = await S(page);
  check(T('04_repairing'), s6.prompt === 'repair' && s6.dragEnabled && !s6.crankEnabled, `prompt "${s6.prompt}", drag on, winding off`);
  await waitFor(page, () => Math.abs(window.__storge.pieces()[2].dim - 0.58) < 0.02);
  const looseDim = (await geo(page))[2].dim;
  // wrong order: piece 4 dropped at the open end does not attach
  await dragPiece(page, 3, touch);
  await sleep(600);
  const s7 = await S(page), st7 = await page.evaluate(() => window.__storge.dragStats());
  await waitFor(page, () => window.__storge.scenes.current.fragments.settled);
  const back = await page.evaluate(() => { const e = window.__storge.chainEndScreen(), p = window.__storge.pieces()[3].start; return Math.hypot(e.x - p.x, e.y - p.y); });
  check(T('04_order_enforced'), s7.connected === 1 && st7.snapsRejected >= 1 && back > 40, `piece 4 at the open end: not attached (connected ${s7.connected}), glided back ${back.toFixed(0)} px away`);
  // highlight while held
  const info = await page.evaluate(() => window.__storge.pieces()[1]);
  const gp = info.screenPts[8];
  if (touch) { await page.touchscreen.touchStart(gp.x, gp.y); await page.touchscreen.touchMove(gp.x + 10, gp.y - 8); }
  else { await page.mouse.move(gp.x, gp.y); await page.mouse.down(); await page.mouse.move(gp.x + 10, gp.y - 8, { steps: 3 }); }
  await waitFor(page, () => window.__storge.pieces()[1].dim > 0.8, null, 60000).catch(() => {});
  const held = await page.evaluate(() => window.__storge.pieces()[1].dim);
  if (touch) await page.touchscreen.touchEnd(); else await page.mouse.up();
  check(T('04_grab_highlight'), held > looseDim + 0.15, `held piece brightness ${held.toFixed(2)} vs loose ${looseDim.toFixed(2)}`);
  await sleep(600);
  // connect 2..5 in order; grab a bit off the line to test the generous hit area
  for (let k = 1; k <= 4; k++) {
    await dragPiece(page, k, touch, { grabOff: touch ? 30 : 18 });
    await waitFor(page, (k) => window.__storge.state.connected === k + 1, k, 60000).catch(() => {});
    if (k === 2) { await waitFor(page, () => window.__storge.scenes.current.fragments.settled); await page.screenshot({ path: `${OUT}/${tag}_4_two_connected.png` }); }
  }
  const s8 = await S(page);
  check(T('04_all_four_dragged_and_snapped'), s8.connected === 5, `connected pieces: ${s8.connected}/5 (grabbed ${touch ? 30 : 18} px off the line)`);
  await waitFor(page, () => window.__storge.state.story === 'REPAIRED');
  const g9 = await geo(page);
  let gap = 0, jointAngles = [];
  for (let k = 1; k < 5; k++) {
    const a = g9[k - 1].end, b = g9[k].start;
    gap = Math.max(gap, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    jointAngles.push(+angleDeg(g9[k - 1].endTangent, g9[k].startTangent).toFixed(1));
  }
  check(T('04_snapped_joints_touch'), gap < 0.0003, `largest gap at a joint ${(gap * 1000).toFixed(3)} mm`);
  check(T('04_joints_have_angles'), jointAngles.every((a) => a >= 8 && a <= 50), `angles at the 4 joints: ${jointAngles.join('°, ')}°`);
  const turns = g9.slice(1).map((p) => p.maxTurnDeg), turnsBefore = g5.slice(1).map((p) => p.maxTurnDeg);
  check(T('04_pieces_turned_angular'), g9.slice(1).every((p) => p.morph === 1) && turns.every((t, i) => t > turnsBefore[i] + 4), `sharpest bend inside pieces 2–5: before ${turnsBefore.join('°/')}° → after ${turns.join('°/')}°`);
  check(T('04_not_overdone'), turns.every((t) => t < 45), 'no extreme zigzag (each corner under 45°)');
  const b9 = await screenBounds(page);
  check(T('04_repaired_on_screen_clear_of_box'), b9.x0 > 4 && b9.x1 < b9.W - 4 && b9.y0 > b9.header && g9.every((p) => !p.insideBody), `x ${b9.x0.toFixed(0)}–${b9.x1.toFixed(0)}, y ${b9.y0.toFixed(0)}–${b9.y1.toFixed(0)}`);
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/${tag}_5_repaired.png` });
  // the new shape stays: no return to the smooth curve, even with more input
  await wind(page, touch, touch ? 2 : 10);
  await sleep(4000);
  const g10 = await geo(page);
  let drift = 0;
  g10.forEach((p, i) => p.pts.forEach((q, j) => { const r = g9[i].pts[j]; drift = Math.max(drift, Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2])); }));
  const s10 = await S(page);
  check(T('05_shape_kept'), drift < 1e-6 && ['REPAIRED', 'CHANGED', 'ANSWERED'].includes(s10.story) && !s10.crankEnabled && !s10.dragEnabled, `max change of the repaired shape after 4 s + input: ${(drift * 1000).toFixed(4)} mm; state ${s10.story}`);
  check(T('glow_kept'), await page.evaluate(() => { const st = window.__storge.stage; return !!st.bloomPass && st.glowSource.active() && st.glowSource.targets().length >= 15; }), 'selective glow active on the repaired melody');
  check(T('body_static_all_states'), JSON.stringify(await page.evaluate(() => window.__storge.bodyMatrix())) === JSON.stringify(body0), 'music box never moved');
  const wp = await page.evaluate(() => window.__wheelPrevented);
  const sy = await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement.scrollTop]);
  if (!touch) check(T('wheel_never_scrolls'), wp.length > 0 && wp.every(Boolean) && sy.every((v) => v === 0), `${wp.filter(Boolean).length}/${wp.length} wheel events prevented; scroll ${JSON.stringify(sy)}`);
  else check(T('touch_no_scroll'), (await page.evaluate(() => window.scrollY)) === 0, 'page never scrolled');
  check(T('console_clean'), errors.length === 0, errors.slice(0, 3).join(' | ') || '0 errors');
  const hist = (await S(page)).history.map((h) => h.state).join(' → ');
  check(T('state_sequence'), hist.startsWith('INTRO → LOVE_EXPANDING → TENSION → BROKEN → REPAIRING → REPAIRED'), hist);
  await page.close();
}
const all = Object.values(results).every((r) => r.pass);
fs.writeFileSync(`${OUT}/e2e_story_report.json`, JSON.stringify({ all_pass: all, total: Object.keys(results).length, results }, null, 1));
console.log(all ? `\nALL PASS (${Object.keys(results).length})` : '\nSOME FAILED');
await browser.close();
