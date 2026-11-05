import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
console.log(await p.evaluate(() => { const ov = document.querySelector('.ending'); const sc = window.__storge.scenes.current; sc.placeAnswer(); const k = document.querySelector('.answer-ko'); return JSON.stringify({ style: ov.getAttribute('style'), sw: k.scrollWidth, oh: ov.offsetHeight, fs: getComputedStyle(k.querySelector('.ans-l2')).fontSize, cap: getComputedStyle(document.querySelector('[data-prompt]')).fontSize }); }));
await b.close();
