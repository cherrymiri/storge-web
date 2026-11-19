// mobile dial: clockwise winds, counter-clockwise pulls back (no progress), tap = one note
import puppeteer from 'puppeteer-core';
const [out = '/tmp/claude-0/dial', w = 390, h = 844] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5173/?debug', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
const sb = await page.evaluate(() => { const e = document.getElementById('start-btn').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
await page.touchscreen.tap(...sb); await sleep(1500);
await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; f(); });
await page.screenshot({ path: `${out}-start.png` });
const S = () => page.evaluate(() => { const s = window.__storge.state; return { progress: +s.progress.toFixed(3), notes: s.notes, crank: +s.crankAngle?.toFixed?.(2) || null }; });
const dial = await page.evaluate(() => { const r = document.getElementById('wind-btn').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 }; });
console.log('dial', JSON.stringify(dial), 'bottom row', await page.evaluate(() => JSON.stringify(document.getElementById('hud-bottom').getBoundingClientRect())));
async function circle(turns, dir) {        // dir +1 = clockwise on screen
  const r = dial.R * 0.62, steps = Math.round(turns * 36);
  let a = -Math.PI / 2;
  await page.touchscreen.touchStart(dial.cx + r * Math.cos(a), dial.cy + r * Math.sin(a));
  for (let i = 0; i < steps; i++) { a += dir * Math.PI * 2 / 36; await page.touchscreen.touchMove(dial.cx + r * Math.cos(a), dial.cy + r * Math.sin(a)); await sleep(16); }
  await page.touchscreen.touchEnd();
}
console.log('before', JSON.stringify(await S()));
await circle(1.5, +1); await sleep(1500);
const a1 = await S(); console.log('after 1.5 clockwise turns', JSON.stringify(a1));
await circle(0.5, -1); await sleep(100);
const a2 = await S(); console.log('right after 0.5 counter-clockwise', JSON.stringify(a2));
for (let i = 0; i < 4; i++) { await sleep(400); console.log('t', i, JSON.stringify(await page.evaluate(() => ({ p: window.__storge.state.pending, a: window.__storge.state.crankAngle, fr: window.__frames })))); }
console.log('1.5 s later (spring back)', JSON.stringify(await S()), JSON.stringify(await page.evaluate(() => ({ pending: window.__storge.state.pending, dialing: window.__storge.state.holding, wound: window.__storge.state.wound, touchId: window.__storge.ctx?.crank?.touchId }))));
for (let i = 0; i < 3; i++) { await page.touchscreen.tap(dial.cx, dial.cy); await sleep(400); }
await sleep(800); console.log('after 3 taps', JSON.stringify(await S()));
await circle(3, +1); await sleep(1200);
console.log('after 3 more turns', JSON.stringify(await S()));
await page.screenshot({ path: `${out}-wound.png` });
console.log('errors', JSON.stringify(errs));
await browser.close();
