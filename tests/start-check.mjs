import puppeteer from 'puppeteer-core';
const touch = process.argv[2] === 'touch';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  let g = false; const mark = (e) => { if (e.type === 'pointerup' && e.pointerType === 'mouse') return; g = true; };
  for (const t of ['mousedown', 'keydown', 'touchend', 'click', 'pointerup']) window.addEventListener(t, mark, true);
  const O = window.AudioContext;
  window.AudioContext = class extends O { constructor(...a) { super(...a); if (!g) super.suspend(); } get state() { return g ? super.state : 'suspended'; } resume() { return g ? super.resume() : Promise.resolve(); } };
});
await p.setViewport(touch ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1600, height: 900 });
await p.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
const st = () => p.evaluate(() => { const s = window.__storge.state; return { started: s.started, crank: s.crankEnabled, audio: s.audioState, notes: s.notes, wound: s.wound, prompt: s.prompt, startHidden: document.getElementById('start').hidden, startOp: getComputedStyle(document.getElementById('start')).opacity, hint: getComputedStyle(document.getElementById('hud-bottom')).opacity }; });
if (touch) { await p.touchscreen.touchStart(200, 640); for (let j = 1; j <= 8; j++) await p.touchscreen.touchMove(200, 640 - j * 40); await p.touchscreen.touchEnd(); }
else for (let i = 0; i < 6; i++) await p.mouse.wheel({ deltaY: 120 });
await new Promise((r) => setTimeout(r, 800)); console.log('pre', JSON.stringify(await st()));
const r = await p.evaluate(() => { const e = document.getElementById('start-btn').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
if (touch) await p.touchscreen.tap(...r); else await p.mouse.click(...r);
await new Promise((r) => setTimeout(r, 1500)); console.log('post', JSON.stringify(await st()));
await b.close();
