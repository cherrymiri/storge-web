// screenshot after winding with the keyboard: node tests/wound-shot.mjs <url> <out> <w> <h> <presses> [mobile]
import puppeteer from 'puppeteer-core';
const [url, out, w, h, presses, mobile] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: mobile ? 3 : 1, isMobile: !!mobile, hasTouch: !!mobile });
await p.goto(url, { waitUntil: 'networkidle0' });
await p.waitForFunction('window.__storgeReady');
for (let i = 0; i < +presses; i++) await p.keyboard.press('ArrowRight');
await p.waitForFunction(() => { const s = window.__storge.state; return Math.abs(s.progress - s.shownProgress) < 0.003; }, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: out });
console.log('errors:', errs.length, errs.join(' | '));
await b.close();
