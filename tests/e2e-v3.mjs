// STORGE scene 01 — wheel / swipe controls, full regression. Real Chrome input events.
// Runs WITHOUT the autoplay override, so audio behaves like a normal browser.
// usage: node tests/e2e-v3.mjs <baseUrl>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'tests/shots/v3';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const check = (k, pass, detail) => { results[k] = { pass: !!pass, detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${k}  — ${detail}`); };
const TAU = Math.PI * 2;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(viewport, { realAutoplayPolicy = true } = {}) {
  const page = await browser.newPage();
  if (realAutoplayPolicy) await page.evaluateOnNewDocument(() => {
    // same rule as normal Chrome/Safari: audio may only start after a click / key / touch-end
    // (headless Chrome marks every page as already activated, so the gestures are tracked here)
    let gestured = false;
    const mark = (e) => {
      if (e.type === 'pointerup' && e.pointerType === 'mouse') return;
      if (e.type === 'keydown' && ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;   // modifier alone is not a gesture
      gestured = true;
    };
    for (const t of ['mousedown', 'keydown', 'touchend', 'click', 'pointerup']) window.addEventListener(t, mark, true);
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...a) { super(...a); if (!gestured) super.suspend(); }
      get state() { return gestured ? super.state : 'suspended'; }      // locked until a real gesture
      resume() { return gestured ? super.resume() : Promise.resolve(); }
    };
  });
  const errors = [], warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warn') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.setViewport(viewport);
  await page.goto(BASE + '?debug', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
  // record, on window (bubble phase, after the app), whether every wheel was prevented
  await page.evaluate(() => {
    window.__wheelLog = [];
    window.addEventListener('wheel', (e) => window.__wheelLog.push({ prevented: e.defaultPrevented, ctrl: e.ctrlKey }), { passive: true });
    window.__frames = []; const loop = () => { const st = window.__storge.state; window.__frames.push([st.crankAngle, st.wheelEvents]); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    window.__touchLog = [];
    window.addEventListener('touchmove', (e) => window.__touchLog.push(e.defaultPrevented || getComputedStyle(document.getElementById('stage')).touchAction === 'none'), { passive: true });
  });
  await sleep(1000);
  return { page, errors, warnings };
}
const state = (page) => page.evaluate(() => window.__storge.state);
const settle = async (page, ms = 20000) => {        // wait until queued input is fully turned and melody caught up
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page);
    if (Math.abs(s.pending) < 1e-6 && Math.abs(s.progress - s.shownProgress) < 0.003) return s;
    await sleep(120);
  }
  return state(page);
};
const visibleHint = (page) => page.evaluate(() => [...document.querySelectorAll('.hint-text')].filter((e) => e.offsetParent && getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim()));
const camState = (page) => page.evaluate(() => { const c = window.__storge.stage.camera; return [...c.position.toArray(), c.fov, c.zoom].map((v) => +v.toFixed(6)); });
const scrollState = (page) => page.evaluate(() => ({ y: window.scrollY, x: window.scrollX, top: document.scrollingElement.scrollTop, vv: window.visualViewport?.scale ?? 1 }));

// ======================================================================= PC
{
  const { page, errors, warnings } = await open({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const s0 = await state(page);
  check('pc_loaded', s0.layout === 'horizontal' && s0.progress === 0, `layout ${s0.layout}, progress ${s0.progress}`);
  const hint = await visibleHint(page);
  check('pc_hint_text', hint.length === 1 && hint[0] === '마우스 휠을 굴려 태엽을 감아보세요.', `visible hint: ${JSON.stringify(hint)}`);
  const mat = await page.evaluate(() => { const o = {}; window.__storge.musicBox.root.traverse((m) => { if (m.isMesh) o[m.material.name] = [m.material.map ? m.material.map.image.width : 0, m.material.metalness, +m.material.roughness.toFixed(2), +(m.material.clearcoat ?? 0).toFixed(2)]; }); return o; });
  check('materials_unchanged', mat.M_Maple_Wood[0] === 1024 && mat.M_Maple_Wood[3] === 0.15 && mat.M_RoseGold_Copper[1] === 1 && mat.M_RoseGold_Copper[2] === 0.3, JSON.stringify(mat));
  const comp = await page.evaluate(() => {
    const S = window.__storge, T = S.THREE, W = innerWidth, b = new T.Box3().setFromObject(S.musicBox.root); let x0 = 1e9, x1 = -1e9;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new T.Vector3(x, y, z).project(S.stage.camera); const px = (v.x + 1) / 2 * W; x0 = Math.min(x0, px); x1 = Math.max(x1, px); }
    return [+(x0 / W * 100).toFixed(1), +(x1 / W * 100).toFixed(1)];
  });
  check('composition_unchanged', Math.abs(comp[0] - 5) < 1 && Math.abs(comp[1] - 40.8) < 1, `music box spans ${comp[0]}%–${comp[1]}% of width (previous: 5%–40.8%)`);
  await page.screenshot({ path: `${OUT}/P1_pc_start.png` });

  // --- one wheel notch: crank turns smoothly over several rendered frames, then stops
  const cam0 = await camState(page);
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());
  await page.mouse.move(1100, 450);
  await page.evaluate(() => { window.__frames = []; });
  await page.mouse.wheel({ deltaY: 100 });
  await settle(page);
  // only frames after the wheel event was handled (earlier ones are the idle "turn me" nudge)
  const frames = (await page.evaluate(() => window.__frames)).filter(([, n]) => n > 0).map(([a]) => Math.abs(a));
  const moving = frames.filter((a, i) => i > 0 && a - frames[i - 1] > 1e-6).length;
  const total = frames[frames.length - 1];
  await page.evaluate(() => { window.__frames = []; });
  await page.waitForFunction(() => window.__frames.length >= 4, { timeout: 30000 });   // slow software renderer: wait for frames, not time
  const tail = await page.evaluate(() => window.__frames.map(([a]) => Math.abs(a)));
  check('wheel_one_notch_turns', Math.abs(total - 0.6) < 0.01, `one 100px notch -> crank turned ${total.toFixed(3)} rad (${(total * 180 / Math.PI).toFixed(1)}°), expected 0.600 rad`);
  check('wheel_smooth_interpolation', moving >= 4 && frames.every((a, i) => i === 0 || a >= frames[i - 1] - 1e-9),
    `one notch spread over ${moving} rendered frames, always forward: ${frames.slice(0, 12).map((a) => a.toFixed(3)).join(' → ')}`);
  check('wheel_stops', tail.length >= 4 && Math.max(...tail) - Math.min(...tail) < 1e-6, `${tail.length} frames rendered after the turn finished, angle range ${(Math.max(...tail) - Math.min(...tail)).toExponential(1)}`);
  fs.writeFileSync(`${OUT}/wheel_one_notch_frames.json`, JSON.stringify(frames.map((a) => +a.toFixed(4))));

  // --- 25 quick notches: proportional, fast but continuous
  const w1 = (await state(page)).wound;
  for (let i = 0; i < 25; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(16); }
  const s1 = await settle(page);
  const gain = s1.wound - w1;
  check('wheel_proportional', Math.abs(gain - 25 * 0.6) < 0.6, `25 notches -> +${gain.toFixed(2)} rad wound (expected 15.0)`);
  check('progress_follows_wheel', Math.abs(s1.progress - s1.wound / (TAU * 6)) < 1e-9 && s1.shownProgress > 0.39, `progress ${s1.progress.toFixed(3)}, visible melody ${(s1.shownProgress * 100).toFixed(1)}%`);
  check('prompt_switched', s1.prompt === 'winding', `prompt "${s1.prompt}"`);
  check('notes_follow_wheel', s1.notes >= 15, `${s1.notes} melody steps triggered`);
  const body1 = await page.evaluate(() => window.__storge.bodyMatrix());
  check('body_static', JSON.stringify(body0) === JSON.stringify(body1), 'MusicBox_Body matrixWorld identical');

  // --- audio: wheel alone cannot unlock it in a real browser -> tip shown; a click unlocks
  const sa = await state(page);
  const tipShown = await page.evaluate(() => document.getElementById('sound').classList.contains('has-tip'));
  check('audio_locked_tip_when_wheel_only', sa.audioState !== 'running' ? tipShown : !tipShown, `AudioContext after wheel only: ${sa.audioState}; sound tip ${tipShown ? 'shown' : 'hidden'}`);
  // --- no page scroll / no zoom
  const cam1 = await camState(page), sc1 = await scrollState(page);
  await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: 120 }); await page.mouse.wheel({ deltaY: -120 }); await page.keyboard.up('Control');
  await sleep(300);
  const cam2 = await camState(page), sc2 = await scrollState(page);
  const wl = await page.evaluate(() => window.__wheelLog);
  check('wheel_no_page_scroll', sc1.y === 0 && sc2.y === 0 && sc2.top === 0 && sc2.vv === 1, `scrollY ${sc2.y}, visualViewport scale ${sc2.vv}`);
  check('wheel_no_camera_zoom', JSON.stringify(cam0) === JSON.stringify(cam1) && JSON.stringify(cam1) === JSON.stringify(cam2), `camera [x,y,z,fov,zoom] unchanged: ${JSON.stringify(cam2)}`);
  const sz = await state(page);
  check('ctrl_wheel_pinch_does_not_wind', Math.abs(sz.wound - sa.wound) < 1e-9, `wound ${sa.wound.toFixed(3)} -> ${sz.wound.toFixed(3)} after ctrl+wheel (trackpad pinch)`);
  check('wheel_default_prevented', wl.length > 0 && wl.every((x) => x.prevented), `${wl.filter((x) => x.prevented).length}/${wl.length} wheel events prevented (incl. ${wl.filter((x) => x.ctrl).length} ctrl+wheel)`);

  await page.mouse.click(1100, 300);                     // one click anywhere on the scene
  await sleep(400);
  const sClick = await state(page);
  const nb = sClick.notesAudible;
  for (let i = 0; i < 8; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(40); }
  const s2 = await settle(page);
  const tipAfter = await page.evaluate(() => document.getElementById('sound').classList.contains('has-tip'));
  check('audio_plays_with_wheel', s2.audioState === 'running' && s2.notesAudible > nb && !tipAfter, `after one click: AudioContext ${s2.audioState}, audible notes ${nb} -> ${s2.notesAudible}, tip ${tipAfter ? 'shown' : 'hidden'}`);
  check('click_does_not_wind', Math.abs(sClick.wound - sa.wound) < 1e-9, `wound ${sa.wound.toFixed(3)} before click / ${sClick.wound.toFixed(3)} after click`);

  // --- old left-drag no longer turns the crank
  const g = await page.evaluate(() => { const p = window.__storge.gripScreen(); const b = window.__storge.crankScreenBasis(); return { gx: p.x, gy: p.y, C: { x: b.C.x, y: b.C.y }, u: { x: b.u.x, y: b.u.y }, v: { x: b.v.x, y: b.v.y } }; });
  await page.mouse.move(g.gx, g.gy); await page.mouse.down();
  for (let a = 0; a <= TAU * 1.5; a += 0.2) await page.mouse.move(g.C.x + Math.cos(a) * g.u.x + Math.sin(a) * g.v.x, g.C.y + Math.cos(a) * g.u.y + Math.sin(a) * g.v.y);
  await page.mouse.up(); await sleep(400);
  const sd = await state(page);
  check('pc_left_drag_removed', Math.abs(sd.wound - s2.wound) < 1e-9, `wound ${s2.wound.toFixed(3)} -> ${sd.wound.toFixed(3)} after a 1.5-turn left-button drag around the handle`);


  // --- reverse wheel never adds progress
  const wr0 = sd.wound;
  for (let i = 0; i < 20; i++) { await page.mouse.wheel({ deltaY: -100 }); await sleep(20); }
  await sleep(800);
  const sr = await state(page);
  check('reverse_wheel_no_gain', Math.abs(sr.wound - wr0) < 1e-9, `wound ${wr0.toFixed(3)} -> ${sr.wound.toFixed(3)} after 20 reverse notches`);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel({ deltaY: -100 }); await sleep(30); await page.mouse.wheel({ deltaY: 100 }); await sleep(30); }
  await settle(page);
  const sw = await state(page);
  check('wheel_back_and_forth_no_gain', sw.wound - wr0 < 0.02, `wound +${(sw.wound - wr0).toFixed(3)} rad after 4 back/forth notch pairs`);
  // honest forward winding still works right after reversing
  await page.mouse.wheel({ deltaY: 100 }); await page.mouse.wheel({ deltaY: 100 }); await page.mouse.wheel({ deltaY: 100 });
  const sh = await settle(page);
  check('forward_after_reverse_works', sh.wound - sw.wound > 0.5, `+${(sh.wound - sw.wound).toFixed(2)} rad from 3 notches right after reversing (first ≤ 90° repays the reverse turn)`);

  // --- volume slider: wheel over it does not wind, dragging it still works
  const vol = await page.evaluate(() => { const r = document.getElementById('sound-volume').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  const wv0 = (await state(page)).wound;
  await page.mouse.move(vol.x + vol.w / 2, vol.y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(20); }
  await sleep(500);
  const wv1 = (await state(page)).wound;
  await page.mouse.move(vol.x + vol.w * 0.8, vol.y); await page.mouse.down(); await page.mouse.move(vol.x + vol.w * 0.25, vol.y, { steps: 6 }); await page.mouse.up();
  await sleep(200);
  const av = await page.evaluate(() => ({ v: window.__storge.audio.volume, input: +document.getElementById('sound-volume').value }));
  const wv2 = (await state(page)).wound;
  check('volume_slider_not_disturbed', wv1 === wv0 && wv2 === wv0 && av.v < 0.45 && Math.abs(av.v - av.input) < 1e-9, `wheel over slider: wound unchanged (${wv0.toFixed(2)}); slider drag -> volume ${av.v.toFixed(2)}`);
  await page.evaluate(() => { const i = document.getElementById('sound-volume'); i.value = '0.7'; i.dispatchEvent(new Event('input')); });
  await page.mouse.move(1100, 450);
  await page.screenshot({ path: `${OUT}/P2_pc_half.png` });

  // --- wind to full, overwind safe, framing
  // (02–04 now exist: winding far past full would start the break, so wind just to full here)
  for (let i = 0; i < 80 && (await state(page)).progress < 1; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(12); if (i % 5 === 4) await settle(page); }
  const sf = await settle(page, 30000);
  check('full_length_stable', sf.progress === 1 && sf.shownProgress > 0.997, `progress ${sf.progress}, visible ${sf.shownProgress.toFixed(3)}`);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(12); }
  const so = await settle(page);
  check('full_then_tension_not_broken_yet', so.progress === 1 && so.story === 'TENSION' && so.melodyVisible, `a little past full: state ${so.story}, melody intact`);
  const geo = await page.evaluate(() => {
    const S = window.__storge, cam = S.stage.camera, W = innerWidth, H = innerHeight, mel = S.scenes.current.melody, pts = mel.curve.getSpacedPoints(300);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) { const v = p.clone().project(cam); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const body = new S.THREE.Box3().setFromObject(S.musicBox.body).expandByScalar(0.003);
    return { x0, x1, y0, y1, W, header: document.getElementById('hud-top').getBoundingClientRect().bottom, hint: document.querySelector('.hint').getBoundingClientRect().top, hits: pts.some((p) => body.containsPoint(p)), mesh: window.__storge.melodyMesh() };
  });
  check('melody_in_frame', geo.x0 > 0 && geo.x1 < geo.W && geo.y0 > geo.header && geo.y1 < geo.hint, `x ${geo.x0.toFixed(0)}–${geo.x1.toFixed(0)}/${geo.W}, y ${geo.y0.toFixed(0)}–${geo.y1.toFixed(0)} (text ends ${geo.header.toFixed(0)}, hint ${geo.hint.toFixed(0)})`);
  check('melody_not_overlapping_box', !geo.hits, 'no melody point inside the body');
  check('melody_3d_mesh_same_thickness', geo.mesh.type === 'Mesh' && geo.mesh.geometry === 'TubeGeometry' && geo.mesh.radius === 0.0016 && geo.mesh.closedTip, JSON.stringify(geo.mesh));
  await page.screenshot({ path: `${OUT}/P3_pc_full.png` });
  check('pc_console_clean', errors.length === 0, errors.join(' | ') || `0 errors, ${warnings.length} warnings`);
  await page.close();
}

// ======================================================================= MOBILE (portrait, touch)
async function swipe(page, x, y0, y1, steps = 14, pause = 12) {
  await page.touchscreen.touchStart(x, y0);
  for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(x, y0 + (y1 - y0) * i / steps); await sleep(pause); }
  await page.touchscreen.touchEnd();
}
{
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const s0 = await state(page);
  const hint = await visibleHint(page);
  check('mobile_layout', s0.layout === 'vertical', `layout ${s0.layout}`);
  check('mobile_hint_text', hint.length === 1 && hint[0] === '화면을 위로 밀어 태엽을 감아보세요.', `visible hint: ${JSON.stringify(hint)}`);
  await page.screenshot({ path: `${OUT}/M1_mobile_start.png` });
  const body0 = await page.evaluate(() => window.__storge.bodyMatrix());

  // swipe up 300px -> proportional; release -> stops
  await swipe(page, 200, 600, 300);
  const sA = await settle(page);
  const expected = 300 * 0.018;
  check('touch_swipe_up_winds', Math.abs(sA.wound - expected) < 0.3, `300 px swipe up -> ${sA.wound.toFixed(2)} rad (expected ≈ ${expected.toFixed(2)})`);
  const a1 = (await state(page)).crankAngle; await sleep(500); const a2 = (await state(page)).crankAngle;
  check('touch_release_stops', Math.abs(a1 - a2) < 1e-6, `crank angle change 0.5 s after lifting: ${Math.abs(a1 - a2).toExponential(1)}`);
  // proportional: a 150 px swipe gives half
  const w0 = sA.wound; await swipe(page, 200, 600, 450); const sB = await settle(page);
  check('touch_proportional', Math.abs((sB.wound - w0) - 150 * 0.018) < 0.2, `150 px -> +${(sB.wound - w0).toFixed(2)} rad (expected ${(150 * 0.018).toFixed(2)})`);
  // swipe down adds nothing
  await swipe(page, 200, 300, 700); await sleep(700);
  const sC = await state(page);
  check('touch_swipe_down_no_gain', Math.abs(sC.wound - sB.wound) < 1e-9, `wound ${sB.wound.toFixed(3)} -> ${sC.wound.toFixed(3)}`);
  const sc = await scrollState(page);
  const tl = await page.evaluate(() => window.__touchLog);
  check('touch_no_page_scroll', sc.y === 0 && sc.top === 0 && sc.vv === 1 && tl.every(Boolean), `scrollY ${sc.y}, zoom ${sc.vv}, canvas touch-action none`);
  check('mobile_audio_and_notes', sC.audioState === 'running' && sC.notesAudible > 0, `AudioContext ${sC.audioState} (unlocked by lifting the finger), audible notes ${sC.notesAudible}`);
  check('mobile_prompt_switched', sC.prompt === 'winding', `prompt "${sC.prompt}"`);
  for (let i = 0; i < 12 && (await settle(page)).progress < 1; i++) await swipe(page, 200, 700, 250, 10, 8);
  const sF = await settle(page, 30000);
  const body1 = await page.evaluate(() => window.__storge.bodyMatrix());
  check('mobile_full_and_body_static', sF.progress === 1 && JSON.stringify(body0) === JSON.stringify(body1), `progress ${sF.progress}, body unchanged`);
  const geo = await page.evaluate(() => {
    const S = window.__storge, cam = S.stage.camera, W = innerWidth, H = innerHeight; let ok = true, y0 = 1e9;
    for (const p of S.scenes.current.melody.curve.getSpacedPoints(300)) { const v = p.clone().project(cam); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; y0 = Math.min(y0, y); if (x < 0 || x > W || y < 0 || y > H) ok = false; }
    return { ok, y0, header: document.getElementById('hud-top').getBoundingClientRect().bottom };
  });
  check('mobile_melody_in_frame', geo.ok && geo.y0 > geo.header, `top of melody ${geo.y0.toFixed(0)}px, text ends ${geo.header.toFixed(0)}px`);
  await page.screenshot({ path: `${OUT}/M2_mobile_full.png` });
  check('mobile_console_clean', errors.length === 0, errors.join(' | ') || '0 errors');
  await page.close();
}

// ======================================================================= MOBILE landscape
{
  const { page, errors } = await open({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  for (let i = 0; i < 14 && (await settle(page)).progress < 1; i++) await swipe(page, 600, 360, 60, 10, 8);
  const s = await settle(page, 30000);
  const hint = await visibleHint(page);
  check('landscape_touch_full', s.layout === 'horizontal' && s.progress === 1 && hint[0] === '화면을 위로 밀어 태엽을 감아보세요.', `layout ${s.layout}, progress ${s.progress}, hint ${JSON.stringify(hint)}`);
  await page.screenshot({ path: `${OUT}/M3_landscape_full.png` });
  check('landscape_console_clean', errors.length === 0, errors.join(' | ') || '0 errors');
  await page.close();
}

const all = Object.values(results).every((r) => r.pass);
fs.writeFileSync(`${OUT}/e2e_v3_report.json`, JSON.stringify({ base: BASE, all_pass: all, total: Object.keys(results).length, results }, null, 1));
console.log(all ? `\nALL PASS (${Object.keys(results).length})` : '\nSOME FAILED');
await browser.close();
