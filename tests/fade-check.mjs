import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 900 });
await p.goto(process.argv[2] + '?debug&speed=4', { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
// jump straight to 05: wind, break, and snap the pieces programmatically (fade timing is what is measured here)
for (let i = 0; i < 280; i++) await p.keyboard.press('ArrowRight');
await p.waitForFunction(() => window.__storge.state.story === 'REPAIRING', { timeout: 300000, polling: 300 });
await p.evaluate(() => { const S = window.__storge.scenes.current, F = S.fragments; for (let k = 1; k <= 4; k++) F.connect(F.pieces[k], window.__storge.state.clock); });
await p.waitForFunction(() => window.__storge.state.prompt === 'question', { timeout: 300000, polling: 100 });
const t0 = Date.now(), out = [];
for (let i = 0; i < 14; i++) { out.push([Date.now() - t0, await p.evaluate(() => +getComputedStyle(document.querySelector('[data-prompt="question"]').firstChild.parentElement).opacity)]); await new Promise((r) => setTimeout(r, 350)); }
console.log(out.map(([t, o]) => `${t}ms:${o.toFixed(2)}`).join('  '));
await b.close();
