// mobile flow snapshot: node tests/mobile-shot.mjs <out-prefix> [w] [h]
import puppeteer from 'puppeteer-core';
const [out, w = 390, h = 844] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:5173/?debug&speed=' + (process.env.SPEED || 1), { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
const b = await page.evaluate(() => { const e = document.getElementById('start-btn').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
await page.touchscreen.tap(...b); await sleep(1500);
await page.screenshot({ path: `${out}-a.png` });
const st = () => page.evaluate(() => { const s = window.__storge.state; return { story: s.story, progress: +s.progress.toFixed(3), notes: s.notes }; });
console.log('start', JSON.stringify(await st()));
if (process.env.ACT) { const fn = new Function('return ' + process.env.ACT)(); await fn(page, sleep); }
await sleep(2500);
console.log('after', JSON.stringify(await st()));
await page.evaluate(() => window.__storge.debugGrow?.(0.75));
await page.screenshot({ path: `${out}-b.png` });
console.log('errors', JSON.stringify(errs));
await browser.close();
