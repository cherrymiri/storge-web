import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://127.0.0.1:5173/?debug&speed=4', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
await page.click('#start-btn'); await sleep(1200);
await page.evaluate(() => { window.__raw = 0; window.addEventListener('wheel', (e) => { window.__raw++; window.__tgt = e.target.tagName; }, { capture: true }); }); await page.mouse.move(800, 450);
for (let i = 0; i < 40; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(60); }
await sleep(3000);
const s = await page.evaluate(() => ({ started: window.__storge.state.started, en: window.__storge.state.crankEnabled, raw: window.__raw, tgt: window.__tgt, tag: document.elementFromPoint(800,450)?.tagName, at: document.elementFromPoint(800,450)?.id || document.elementFromPoint(800,450)?.className, wheel: window.__storge.state.wheelEvents, p: window.__storge.state.progress, notes: window.__storge.state.notes, mode: window.__storge.state.hintMode, btn: getComputedStyle(document.getElementById('wind-btn')).display }));
console.log(JSON.stringify(s), 'errors', JSON.stringify(errs));
await page.screenshot({ path: '/tmp/claude-0/m/pc.png' });
await browser.close();
