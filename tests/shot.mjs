// quick screenshot helper: node tests/shot.mjs <url> <out.png> [w] [h] [mobile]
import puppeteer from 'puppeteer-core';
const [url, out, w = 1600, h = 900, mobile] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__storgeReady', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
