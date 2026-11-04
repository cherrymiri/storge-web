// quick walkthrough of 01→04 with screenshots: node tests/story-smoke.mjs <url> <outDir> [mobile]
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
await p.goto(url + '?debug&speed=' + (process.env.SPEED || 1), { waitUntil: 'networkidle0' });
await p.waitForFunction('window.__storgeReady');
const st = () => p.evaluate(() => window.__storge.state);
const press = async (n) => { for (let i = 0; i < n; i++) await p.keyboard.press('ArrowRight'); };
await press(185);
await p.waitForFunction(() => window.__storge.state.story === 'TENSION', { timeout: 60000 });
await sleep(800); await p.screenshot({ path: `${OUT}/a_full.png` });
await press(45); await sleep(2500); await p.screenshot({ path: `${OUT}/b_tension.png` });
console.log('tension', JSON.stringify(await st()).slice(0, 300));
await press(40);
await p.waitForFunction(() => window.__storge.state.story === 'BROKEN', { timeout: 60000 });
await p.screenshot({ path: `${OUT}/c_break.png` });
await sleep(1800); await p.screenshot({ path: `${OUT}/d_scattered.png` });
await p.waitForFunction(() => window.__storge.state.story === 'REPAIRING', { timeout: 60000 });
await sleep(500); await p.screenshot({ path: `${OUT}/e_repair_start.png` });
for (let k = 1; k <= 4; k++) {
  const info = await p.evaluate((k) => ({ piece: window.__storge.pieces()[k], end: window.__storge.chainEndScreen() }), k);
  const g = info.piece.screenPts[8], s = info.piece.start, e = info.end;
  const tx = g.x + (e.x - s.x), ty = g.y + (e.y - s.y);
  if (mobile) {
    await p.touchscreen.touchStart(g.x, g.y);
    for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(g.x + (tx - g.x) * i / 12, g.y + (ty - g.y) * i / 12); await sleep(10); }
    await p.touchscreen.touchEnd();
  } else {
    await p.mouse.move(g.x, g.y); await p.mouse.down();
    await p.mouse.move(tx, ty, { steps: 12 }); await p.mouse.up();
  }
  await sleep(2400);
  if (k === 2) await p.screenshot({ path: `${OUT}/f_two_connected.png` });
  console.log('after', k, JSON.stringify(await st()).slice(0, 200));
}
await p.waitForFunction(() => window.__storge.state.story === 'REPAIRED', { timeout: 60000 }).catch(() => {});
await sleep(1500); await p.screenshot({ path: `${OUT}/g_repaired.png` });
if (process.env.ENDING) {
  await p.waitForFunction(() => window.__storge.state.story === 'CHANGED', { timeout: 240000 });
  await sleep(1500); await p.screenshot({ path: `${OUT}/h_changed.png` });
  await p.waitForFunction(() => window.__storge.state.prompt === 'question', { timeout: 240000 });
  await sleep(2500); await p.screenshot({ path: `${OUT}/i_question.png` });
  await p.waitForFunction(() => window.__storge.state.story === 'ANSWERED', { timeout: 240000 });
  await p.waitForFunction(() => window.__storge.state.ending.replay, { timeout: 240000 });
  await sleep(2500); await p.screenshot({ path: `${OUT}/j_answer.png` });
  console.log('ending', JSON.stringify(await st()).slice(0, 600));
  const r = await p.evaluate(() => { const b = document.getElementById('replay').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  if (mobile) { await p.touchscreen.tap(r.x, r.y); } else { await p.mouse.click(r.x, r.y); }
  await sleep(1500); await p.screenshot({ path: `${OUT}/k_after_replay.png` });
  console.log('after replay', JSON.stringify(await st()).slice(0, 500));
}
console.log('final', JSON.stringify(await st()).slice(0, 400));
console.log('errors', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
