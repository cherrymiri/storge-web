// Glow + curve verification: same page, same frame, glow ON vs OFF, plus curve metrics old vs new.
// usage: node tests/glow-check.mjs <baseUrl> <outDir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [BASE, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};

for (const [tag, vp] of [['pc', { width: 1600, height: 900, deviceScaleFactor: 1 }],
                         ['mobile', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
  const p = await browser.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport(vp);
  await p.goto(BASE + '?debug', { waitUntil: 'networkidle0' });
  await p.waitForFunction('window.__storgeReady');
  for (let i = 0; i < 200; i++) await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => { const s = window.__storge.state; return s.progress === 1 && s.shownProgress > 0.999; }, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400));

  // freeze the loop so ON/OFF frames are identical apart from the glow
  const info = await p.evaluate(() => {
    const S = window.__storge, st = S.stage;
    st.renderer.setAnimationLoop(null);
    const src = st.glowSource;
    const m = S.scenes.current.melody;
    // screen-space thread width in px from geometry (radius projected at the middle of the curve)
    const mid = m.curve.getPointAt(0.5), cam = st.camera;
    const dist = cam.position.distanceTo(mid);
    const pxPerM = innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360) * dist);
    st.render();
    const on = st.renderer.domElement.toDataURL('image/png');
    st.glowSource = null; st.render();
    const off = st.renderer.domElement.toDataURL('image/png');
    st.glowSource = src; st.render();
    // box screen rect
    const T = S.THREE, bb = new T.Box3().setFromObject(S.musicBox.root);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const v = new T.Vector3(x, y, z).project(cam); const px = (v.x + 1) / 2 * innerWidth, py = (1 - v.y) / 2 * innerHeight;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { on, off, dpr: devicePixelRatio, threadDiameterCssPx: +(2 * m.tube.geometry.parameters.radius * pxPerM).toFixed(2),
      radius: m.tube.geometry.parameters.radius, box: { x0, x1, y0, y1 }, layout: S.state.layout,
      composerOk: !!st.bloomComposer, bloomPassOk: !!st.bloomPass };
  });
  fs.writeFileSync(`${OUT}/${tag}_glow_on.png`, Buffer.from(info.on.split(',')[1], 'base64'));
  fs.writeFileSync(`${OUT}/${tag}_glow_off.png`, Buffer.from(info.off.split(',')[1], 'base64'));
  delete info.on; delete info.off;
  info.errors = errors;
  report[tag] = info;
  await p.close();
}

// curve metrics: old (stage-1) vs new presets, computed with the same code path as the app
const p = await browser.newPage();
await p.goto(BASE + '?debug', { waitUntil: 'networkidle0' });
await p.waitForFunction('window.__storgeReady');
report.curves = await p.evaluate(async () => {
  const T = window.__storge.THREE;
  const { MelodyPaths } = await import('/src/objects/MelodyLine.js');
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const OLD = {
    horizontal(s) { const L = 0.36, pts = []; for (let i = 0; i <= 240; i++) { const t = i / 240, ramp = smooth(0, 0.28, t), amp = 0.021 * ramp * (0.42 + 0.58 * t);
      pts.push(new T.Vector3(s.x + L * t, s.y + 0.013 * t + amp * Math.sin(Math.PI * 2 * 1.85 * t - 0.5), s.z + 0.011 * ramp * Math.sin(Math.PI * 2 * 1.05 * t + 0.4))); }
      return new T.CatmullRomCurve3(pts, false, 'centripetal'); },
    vertical(s) { const c = [[0,0,0],[0.026,0.002,0.002],[0.046,0.028,0.006],[0.040,0.075,0.004],[-0.010,0.135,-0.004],[-0.070,0.195,-0.006],[-0.040,0.250,0],[0.040,0.300,0.006],[0.060,0.355,0.004],[0.010,0.405,-0.002]]
      .map(([x, y, z]) => new T.Vector3(s.x + x, s.y + y, s.z + z)); return new T.CatmullRomCurve3(new T.CatmullRomCurve3(c, false, 'centripetal').getSpacedPoints(240), false, 'centripetal'); },
  };
  const start = new T.Vector3(0.077, 0.024, 0.004);
  // lateral = coordinate across the main direction (Y for horizontal, X for vertical), ignoring the first 8% (the turn out of the box)
  function metrics(curve, mode) {
    const pts = curve.getSpacedPoints(400).slice(mode === 'vertical' ? 60 : 32);
    const lat = pts.map((q) => (mode === 'horizontal' ? q.y : q.x));
    let turns = 0, prevSign = 0;
    for (let i = 1; i < lat.length; i++) { const d = lat[i] - lat[i - 1]; const sg = Math.abs(d) < 1e-6 ? 0 : Math.sign(d); if (sg && prevSign && sg !== prevSign) turns++; if (sg) prevSign = sg; }
    // max distance from the straight chord, relative to curve length
    const a = pts[0], b = pts[pts.length - 1], ab = b.clone().sub(a); const len = curve.getLength();
    let dev = 0; for (const q of pts) { const t = q.clone().sub(a).dot(ab) / ab.lengthSq(); dev = Math.max(dev, q.distanceTo(a.clone().addScaledVector(ab, t))); }
    // peak curvature (1/m) — tight bends show up here
    let kmax = 0; for (let i = 8; i <= 392; i += 4) { const u = i / 400; const t1 = curve.getTangentAt(Math.max(0, u - 0.005)), t2 = curve.getTangentAt(Math.min(1, u + 0.005)); kmax = Math.max(kmax, t1.angleTo(t2) / (0.01 * len)); }
    return { lateralTurns: turns, maxDeviationPctOfLength: +(dev / len * 100).toFixed(1), peakCurvature: +kmax.toFixed(1), lengthM: +len.toFixed(3) };
  }
  const out = {};
  for (const mode of ['horizontal', 'vertical']) {
    const prev = metrics(MelodyPaths[mode](start, 1), mode);       // previous version (amplitude x1)
    const now = metrics(MelodyPaths[mode](start), mode);           // current (config amplitude)
    out[mode] = { stage1: metrics(OLD[mode](start), mode), previous: prev, now, amplitudeRatio: +(now.maxDeviationPctOfLength / prev.maxDeviationPctOfLength).toFixed(2) };
  }
  return out;
});
fs.writeFileSync(`${OUT}/glow_curve_report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
