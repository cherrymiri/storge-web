// End-to-end browser test for STORGE scene 01 (real Chrome, real pointer/touch input).
// usage: node tests/e2e.mjs <baseUrl>   (e.g. http://localhost:5173/)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tests/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required'],
});

async function open(viewport, tag) {
  const page = await browser.newPage();
  const errors = [], warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warn') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.setViewport(viewport);
  await page.goto(BASE + '?debug', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
  await sleep(1200);
  return { page, errors, warnings, tag };
}
const state = (page) => page.evaluate(() => window.__storge.state);
const waitShown = async (page, target, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await state(page); if (Math.abs(s.shownProgress - target) < 0.004) return s; await sleep(150); }
  return state(page);
};

/** screen point of the grip for crank angle a, from the live projection */
async function crankPath(page) {
  return page.evaluate(() => {
    const b = window.__storge.crankScreenBasis();
    const s = window.__storge.state;
    return { C: { x: b.C.x, y: b.C.y }, u: { x: b.u.x, y: b.u.y }, v: { x: b.v.x, y: b.v.y }, angle: s.crankAngle, fwd: s.forwardSign };
  });
}
const at = (p, a) => ({ x: p.C.x + Math.cos(a) * p.u.x + Math.sin(a) * p.v.x, y: p.C.y + Math.cos(a) * p.u.y + Math.sin(a) * p.v.y });

/** drag the handle `turns` turns (negative = backwards) with mouse or touch */
async function crankTurns(page, turns, { touch = false, stepsPerTurn = 36, pause = 8 } = {}) {
  const p = await crankPath(page);
  let a = p.angle;
  const dir = Math.sign(turns) * p.fwd;
  const n = Math.round(Math.abs(turns) * stepsPerTurn);
  const start = at(p, a);
  if (touch) await page.touchscreen.touchStart(start.x, start.y);
  else { await page.mouse.move(start.x, start.y); await page.mouse.down(); }
  for (let i = 1; i <= n; i++) {
    a += dir * (Math.PI * 2 / stepsPerTurn);
    const q = at(p, a);
    if (touch) await page.touchscreen.touchMove(q.x, q.y); else await page.mouse.move(q.x, q.y);
    if (pause) await sleep(pause);
  }
  if (touch) await page.touchscreen.touchEnd(); else await page.mouse.up();
}

/** one continuous drag made of several segments (turns, +forward / -backward) */
async function crankSegments(page, segments, { stepsPerTurn = 36, pause = 8 } = {}) {
  const p = await crankPath(page);
  let a = p.angle;
  const s = at(p, a);
  await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (const turns of segments) {
    const dir = Math.sign(turns) * p.fwd, n = Math.round(Math.abs(turns) * stepsPerTurn);
    for (let i = 0; i < n; i++) { a += dir * (Math.PI * 2 / stepsPerTurn); const q = at(p, a); await page.mouse.move(q.x, q.y); if (pause) await sleep(pause); }
  }
  await page.mouse.up();
}

// =================================================================== DESKTOP
{
  const { page, errors, warnings } = await open({ width: 1600, height: 900, deviceScaleFactor: 1 }, 'desktop');
  const s0 = await state(page);
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());
  check('desktop_glb_loaded', s0 && s0.layout === 'horizontal', `layout ${s0.layout}, prompt "${s0.prompt}"`);

  const mat = await page.evaluate(() => {
    const out = {};
    window.__storge.musicBox.root.traverse((o) => { if (o.isMesh) out[o.material.name] = { type: o.material.type, map: o.material.map ? `${o.material.map.image.width}x${o.material.map.image.height}` : null, color: o.material.color.getHexString(), metal: o.material.metalness, rough: +o.material.roughness.toFixed(2), clearcoat: o.material.clearcoat ?? null }; });
    return out;
  });
  check('materials_unchanged', mat.M_Maple_Wood?.map === '1024x1024' && mat.M_Maple_Wood.clearcoat > 0.149 && mat.M_RoseGold_Copper?.metal === 1 && mat.M_RoseGold_Copper.rough === 0.3,
    JSON.stringify(mat));
  const comp = await page.evaluate(() => {
    const W = innerWidth; const S = window.__storge;
    const box = new S.THREE.Box3().setFromObject(S.musicBox.root);
    let x0 = 1e9, x1 = -1e9;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new S.THREE.Vector3(x, y, z).project(S.stage.camera); const px = (v.x + 1) / 2 * W; x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    }
    return { boxRightPct: +(x1 / W * 100).toFixed(1), boxLeftPct: +(x0 / W * 100).toFixed(1) };
  });
  check('composition_box_left_35pct', comp.boxRightPct < 42 && comp.boxLeftPct > 2, `music box spans ${comp.boxLeftPct}%–${comp.boxRightPct}% of width`);
  await page.screenshot({ path: `${OUT}/D1_desktop_initial.png` });
  check('melody_hidden_at_start', s0.shownProgress === 0, `progress ${s0.progress}`);

  // hit test: pressing far from the handle must not turn it
  await page.mouse.move(1300, 450); await page.mouse.down(); await page.mouse.move(1320, 520, { steps: 6 }); await page.mouse.up();
  const sFar = await state(page);
  check('drag_elsewhere_does_nothing', sFar.wound === 0, `wound after dragging empty space: ${sFar.wound}`);

  // forward 2 turns with the mouse
  await crankTurns(page, 2);
  const s1 = await waitShown(page, (await state(page)).progress);
  const body1 = await page.evaluate(() => window.__storge.bodyMatrix());
  check('mouse_drag_rotates_crank', Math.abs(s1.crankAngle) > 1, `crank rotation.x ${s1.crankAngle.toFixed(3)} rad after 2 turns`);
  check('progress_follows_winding', Math.abs(s1.progress - 2 / 6) < 0.03, `progress ${s1.progress.toFixed(3)} (expected ≈ 0.333)`);
  check('body_static', JSON.stringify(body0) === JSON.stringify(body1), 'MusicBox_Body matrixWorld identical before/after');
  check('prompt_switched', s1.prompt === 'winding', `prompt "${s1.prompt}"`);
  check('melody_grows', s1.shownProgress > 0.3, `visible melody ${(s1.shownProgress * 100).toFixed(1)}%`);
  check('audio_notes', s1.notes >= 11 && s1.audioState === 'running' && s1.notesAudible > 0,
    `steps ${s1.notes}, audible notes ${s1.notesAudible}, AudioContext ${s1.audioState}`);
  await page.screenshot({ path: `${OUT}/D2_desktop_wound_2turns.png` });

  // stop: melody must stay, not grow further
  await sleep(1500);
  const sStop = await state(page);
  check('stop_keeps_melody', Math.abs(sStop.shownProgress - s1.shownProgress) < 0.005 && sStop.shownProgress > 0.3, `after 1.5 s idle: ${sStop.shownProgress.toFixed(3)}`);

  // reverse: one full backward turn must not add progress
  await crankTurns(page, -1);
  await sleep(600);
  const s2 = await state(page);
  check('reverse_adds_nothing', Math.abs(s2.wound - s1.wound) < 1e-9, `wound before ${s1.wound.toFixed(3)} / after reverse ${s2.wound.toFixed(3)}`);
  // wiggling inside ONE drag (back half a turn, forward half a turn, x3) must gain nothing
  await sleep(500);
  const sw0 = await state(page);
  await crankSegments(page, [-0.5, 0.5, -0.5, 0.5, -0.25, 0.25]);
  await sleep(500);
  const sw1 = await state(page);
  check('wiggle_gains_nothing', Math.abs(sw1.wound - sw0.wound) < 0.02, `wound before ${sw0.wound.toFixed(3)} / after wiggling ${sw1.wound.toFixed(3)} rad`);
  // an honest forward quarter turn still counts
  await crankTurns(page, 0.25);
  const sw2 = await state(page);
  check('honest_forward_counts', Math.abs(sw2.wound - sw1.wound - Math.PI / 2) < 0.12, `+${(sw2.wound - sw1.wound).toFixed(3)} rad for a quarter turn (expected ≈ 1.571)`);

  // wind to full and beyond — must stay intact (no breaking in stage 1)
  await crankTurns(page, 5.5, { stepsPerTurn: 24, pause: 4 });
  const s4 = await waitShown(page, 1, 20000);
  check('full_length_stable', s4.progress === 1 && s4.shownProgress > 0.995, `progress ${s4.progress}, visible ${s4.shownProgress.toFixed(3)}`);
  await crankTurns(page, 1.2, { stepsPerTurn: 24, pause: 4 });
  const s5 = await state(page);
  check('overwind_does_not_break', s5.progress === 1, 'still 1.0 after extra turns');

  // melody inside the frame and not touching the box
  const geo = await page.evaluate(() => {
    const S = window.__storge, T = S.THREE, cam = S.stage.camera, W = innerWidth, H = innerHeight;
    const mel = S.scenes.current.melody;
    const pts = mel.curve.getSpacedPoints(200);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) { const v = p.clone().project(cam); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const body = new T.Box3().setFromObject(S.musicBox.body).expandByScalar(0.003);
    const hitsBox = pts.some((p) => body.containsPoint(p));
    const header = document.getElementById('hud-top').getBoundingClientRect().bottom;
    const hint = document.querySelector('.hint').getBoundingClientRect().top;
    return { minX, maxX, minY, maxY, W, H, hitsBox, header, hint };
  });
  check('melody_in_frame', geo.minX > 0 && geo.maxX < geo.W && geo.minY > geo.header && geo.maxY < geo.hint,
    `melody px x ${geo.minX.toFixed(0)}–${geo.maxX.toFixed(0)} / ${geo.W}, y ${geo.minY.toFixed(0)}–${geo.maxY.toFixed(0)} (text ends ${geo.header.toFixed(0)}, hint at ${geo.hint.toFixed(0)})`);
  check('melody_not_overlapping_box', !geo.hitsBox, 'no melody point inside the body bounds');
  await page.screenshot({ path: `${OUT}/D3_desktop_full.png` });

  const mesh = await page.evaluate(() => window.__storge.melodyMesh());
  check('melody_is_3d_mesh', mesh.type === 'Mesh' && mesh.geometry === 'TubeGeometry' && mesh.closedTip, JSON.stringify(mesh));

  // orbit camera to look at the tube's volume
  await page.evaluate(async () => {
    const S = window.__storge, c = await S.orbit(), T = S.THREE;
    const tip = S.scenes.current.melody.curve.getPointAt(0.55);
    c.target.copy(tip);
    S.stage.camera.position.copy(tip).add(new T.Vector3(-0.012, 0.026, 0.05));
    c.update();
  });
  await sleep(700);
  await page.screenshot({ path: `${OUT}/D4_melody_closeup_orbit.png` });
  await page.evaluate(() => {
    const S = window.__storge, T = S.THREE;
    const c = S.rig.target.clone();
    S.stage.camera.position.copy(c).add(new T.Vector3(0.32, 0.22, 0.42));
    S.stage.camera.lookAt(c.x + 0.08, c.y, c.z);
  });
  await sleep(700);
  await page.screenshot({ path: `${OUT}/D5_orbit_three_quarter.png` });

  check('desktop_console_clean', errors.length === 0, errors.length ? errors.join(' | ') : `0 errors, ${warnings.length} warnings ${warnings.join(' | ')}`);
  await page.close();
}

// =================================================================== MOBILE PORTRAIT (touch)
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'mobile');
  const s0 = await state(page);
  check('mobile_layout', s0.layout === 'vertical', `layout ${s0.layout}`);
  const g = await page.evaluate(() => { const p = window.__storge.gripScreen(); return { x: p.x, y: p.y, W: innerWidth, H: innerHeight }; });
  check('mobile_grip_on_screen', g.x > 10 && g.x < g.W - 10 && g.y > 0 && g.y < g.H, `grip at ${g.x.toFixed(0)},${g.y.toFixed(0)}`);
  await page.screenshot({ path: `${OUT}/M1_mobile_initial.png` });
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());
  await crankTurns(page, 3, { touch: true, stepsPerTurn: 30, pause: 10 });
  const s1 = await waitShown(page, 0.5);
  const body1 = await page.evaluate(() => window.__storge.bodyMatrix());
  check('touch_winds', Math.abs(s1.progress - 0.5) < 0.03 && Math.abs(s1.crankAngle) > 1, `progress ${s1.progress.toFixed(3)} after 3 touch turns`);
  check('mobile_body_static', JSON.stringify(body0) === JSON.stringify(body1), 'body unchanged');
  await crankTurns(page, 3.5, { touch: true, stepsPerTurn: 24, pause: 4 });
  await waitShown(page, 1, 20000);
  const geo = await page.evaluate(() => {
    const S = window.__storge, cam = S.stage.camera, W = innerWidth, H = innerHeight;
    const pts = S.scenes.current.melody.curve.getSpacedPoints(200);
    let ok = true; let minY = 1e9;
    for (const p of pts) { const v = p.clone().project(cam); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; minY = Math.min(minY, y); if (x < 0 || x > W || y < 0 || y > H) ok = false; }
    return { ok, minY, header: document.getElementById('hud-top').getBoundingClientRect().bottom };
  });
  check('mobile_melody_in_frame', geo.ok && geo.minY > geo.header, `top of melody ${geo.minY.toFixed(0)}px, text ends ${geo.header.toFixed(0)}px`);
  await page.screenshot({ path: `${OUT}/M2_mobile_full.png` });
  check('mobile_console_clean', errors.length === 0, errors.join(' | ') || '0 errors');
  await page.close();
}

// =================================================================== MOBILE LANDSCAPE
{
  const { page, errors } = await open({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'landscape');
  await crankTurns(page, 6.5, { touch: true, stepsPerTurn: 24, pause: 4 });
  const s = await waitShown(page, 1, 20000);
  check('landscape_touch_full', s.layout === 'horizontal' && s.progress === 1, `layout ${s.layout}, progress ${s.progress}`);
  await page.screenshot({ path: `${OUT}/M3_mobile_landscape_full.png` });
  check('landscape_console_clean', errors.length === 0, errors.join(' | ') || '0 errors');
  await page.close();
}

const all = Object.values(results).every((r) => r.pass);
fs.writeFileSync(`${OUT}/e2e_report.json`, JSON.stringify({ base: BASE, all_pass: all, results }, null, 1));
console.log(all ? '\nALL PASS' : '\nSOME FAILED');
await browser.close();
