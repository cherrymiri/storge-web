// 02 tension: measure how the curve flattens and the tremor grows step by step, capture the moment before the break.
// usage: node tests/tension-check.mjs <url> <outDir> [mobile]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url, OUT, mobile] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
await p.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1600, height: 900 });
await p.goto(url + '?debug', { waitUntil: 'networkidle0' });
await p.waitForFunction('window.__storgeReady');
const press = async (n) => { for (let i = 0; i < n; i++) await p.keyboard.press('ArrowRight'); };
const W = (fn, arg, t = 240000) => p.waitForFunction(fn, { timeout: t, polling: 150 }, arg);

const measure = () => p.evaluate(() => {
  const S = window.__storge, cam = S.stage.camera, m = S.scenes.current.melody, W = innerWidth, H = innerHeight;
  const sc = (v) => { const q = v.clone().project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
  // waviness on screen: max distance of the (tremor-free) displayed line from its chord, skipping the first 12 % (turn out of the box)
  const pts = []; for (let i = 12; i <= 100; i++) pts.push(sc(m.pointAt(i / 100, false)));
  const a = pts[0], z = pts[pts.length - 1], dx = z[0] - a[0], dy = z[1] - a[1], L = Math.hypot(dx, dy);
  let dev = 0; for (const q of pts) dev = Math.max(dev, Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L);
  // tremor peak on screen: displacement of the full tremor amplitude at the middle of the line
  const u = m.uniforms, mid = m.pointAt(0.5, false);
  const t0 = sc(mid), t1 = sc(mid.clone().addScaledVector(u.uTremorDir.value, u.uTremor.value));
  const st = S.state;
  return { tension: st.tensionShown, story: st.story, wavePx: +dev.toFixed(1), tremorPx: +Math.hypot(t1[0] - t0[0], t1[1] - t0[1]).toFixed(2),
    tremorMm: +(u.uTremor.value * 1000).toFixed(2), taut: +u.uTaut.value.toFixed(3), hz: st.tremorHz, hi: st.tremorHi, snapping: st.snapping, radius: S.melodyMesh().radius };
});
// 4 consecutive rendered frames layered (lighten) -> shows the trembling envelope in a still
async function motionStill(name) {
  const frames = await p.evaluate(() => new Promise((res) => {
    const out = [], c = window.__storge.stage.renderer.domElement;
    const grab = () => { out.push(c.toDataURL('image/png')); if (out.length < 4) requestAnimationFrame(grab); else res(out); };
    requestAnimationFrame(grab);
  }));
  frames.forEach((d, i) => fs.writeFileSync(`${OUT}/${name}_f${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
}

await press(185);
await W(() => window.__storge.state.story === 'TENSION');
const rows = [];
const steps = [0, 0.25, 0.5, 0.75, 0.97];
const fullW = Math.PI * 2 * 6, perPress = Math.PI / 15, tensionW = Math.PI * 2 * 2.5;
for (const target of steps) {
  // wound updates immediately on each key press (tension is only recomputed per rendered frame)
  const liveT = () => p.evaluate((f, w) => (window.__storge.state.wound - f) / w, fullW, tensionW);
  for (let i = 0; i < 200 && (await liveT()) < target; i++) await press(1);
  const goal = Math.min(1, await liveT());
  await W((g) => { const s = window.__storge.state; return Math.abs(s.tensionShown - g) < 0.006 || s.snapping; }, goal);
  await sleep(300);
  const m = await measure();
  rows.push(m);
  const tag = `t${String(Math.round(target * 100)).padStart(2, '0')}`;
  await p.screenshot({ path: `${OUT}/${tag}.png` });
  if (target >= 0.5) await motionStill(tag);
  console.log(tag, JSON.stringify(m));
}
// the limit: a brief held moment, then the break
await press(10);
await W(() => window.__storge.state.snapping || window.__storge.state.story === 'BROKEN');
const hold = await measure();
await p.screenshot({ path: `${OUT}/snap_hold.png` });
console.log('hold', JSON.stringify(hold));
await W(() => window.__storge.state.story === 'BROKEN');
await p.screenshot({ path: `${OUT}/broken.png` });
const fr = await p.evaluate(() => {
  const F = window.__storge.scenes.current.fragments, c = F.curve;   // pieces were cut from this (taut) curve
  const m = window.__storge.scenes.current.melody;
  // shape comparison: every point of the baked curve vs. the nearest point of the line as last drawn
  const shown = []; for (let i = 0; i <= 600; i++) shown.push(m.pointAt(i / 600, true));
  let d = 0;
  for (let i = 0; i <= 200; i++) { const q = c.getPointAt(i / 200); let best = 1e9; for (const s of shown) best = Math.min(best, s.distanceTo(q)); d = Math.max(d, best); }
  return { pieces: F.pieces.length, bakedVsLastShownMm: +(d * 1000).toFixed(3) };
});
console.log('break', JSON.stringify(fr));
fs.writeFileSync(`${OUT}/tension_report.json`, JSON.stringify({ rows, hold, break: fr, errors: errs }, null, 1));
console.log('errors', errs.length);
await b.close();
