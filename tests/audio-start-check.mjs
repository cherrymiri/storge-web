// first-sound behaviour, with the normal browser rule emulated (sound only after click / tap / key)
// node tests/audio-start-check.mjs <url> [click-first]
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:5173/?debug';
const clickFirst = process.argv[3] === 'click-first';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  let g = false; const mark = (e) => { if (e.type === 'pointerup' && e.pointerType === 'mouse') return; g = true; };
  for (const t of ['mousedown', 'keydown', 'touchend', 'click', 'pointerup']) window.addEventListener(t, mark, true);
  const O = window.AudioContext;
  window.AudioContext = class extends O { constructor(...a) { super(...a); if (!g) super.suspend(); } get state() { return g ? super.state : 'suspended'; } resume() { return g ? super.resume() : Promise.resolve(); } };
});
await p.setViewport({ width: 1280, height: 720 });
await p.goto(url, { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
const st = () => p.evaluate(() => ({ ctx: window.__storge.audio.ctx?.state ?? null, button: !document.getElementById('sound-start').hidden, notes: window.__storge.state.notes, heard: window.__storge.audio.notesPlayed }));
const out = { start: await st() };
if (clickFirst) { await p.mouse.click(900, 200); out.afterClick = await st(); }
for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: 120 }); await new Promise((r) => setTimeout(r, 30)); }
await new Promise((r) => setTimeout(r, 1200)); out.afterWheel = await st();
if (out.afterWheel.button) {
  const r = await p.evaluate(() => { const e = document.querySelector('.sound-start-btn').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
  await p.mouse.click(...r); await new Promise((r) => setTimeout(r, 800)); out.afterButton = await st();
  for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: 120 }); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 1200)); out.afterMoreWheel = await st();
}
console.log(JSON.stringify(out));
await b.close();
