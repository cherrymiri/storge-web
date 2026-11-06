// quick look at the note card over the first screen: node tests/card-preview.mjs out.png W H [dpr]
import puppeteer from 'puppeteer-core';
const [out, W = 1600, H = 980, dpr = 1] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: +W, height: +H, deviceScaleFactor: +dpr, isMobile: +W < 700, hasTouch: +W < 700 });
await p.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
await p.evaluate(() => { document.getElementById('start').hidden = true; document.getElementById('ending').classList.add('show-ko', 'show-en'); document.getElementById('replay').classList.add('is-visible'); });
await new Promise((r) => setTimeout(r, 2500));
const info = await p.evaluate(() => { const r = document.querySelector('.note-card').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, fonts: [...document.fonts].filter((f) => f.family.includes('Card') && f.status === 'loaded').length }; });
console.log(JSON.stringify(info));
await p.screenshot({ path: out }); await b.close();
