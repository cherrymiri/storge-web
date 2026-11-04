import puppeteer from 'puppeteer-core';
const url = process.argv[2], out = process.argv[3];
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [tag, vp] of [['pc', { width: 1600, height: 900 }], ['mobile', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage(); const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport(vp); await p.goto(url + '?debug', { waitUntil: 'networkidle0' });
  await p.waitForFunction('window.__storgeReady', { timeout: 60000 });
  if (tag === 'pc') { await p.mouse.move(1100, 450); for (let i = 0; i < 70; i++) { await p.mouse.wheel({ deltaY: 120 }); await new Promise((r) => setTimeout(r, 15)); } }
  else for (let k = 0; k < 7; k++) { await p.touchscreen.touchStart(200, 700); for (let i = 1; i <= 10; i++) await p.touchscreen.touchMove(200, 700 - 45 * i); await p.touchscreen.touchEnd(); }
  await p.waitForFunction(() => { const s = window.__storge.state; return s.pending === 0 && s.progress === 1 && s.shownProgress > 0.998; }, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 600));
  const s = await p.evaluate(() => ({ ...window.__storge.state, hint: [...document.querySelectorAll('.hint-text')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent) }));
  await p.screenshot({ path: `${out}_${tag}.png` });
  console.log(tag, JSON.stringify({ progress: s.progress, layout: s.layout, lastInput: s.lastInput, hint: s.hint, errors: errs }));
  await p.close();
}
await b.close();
