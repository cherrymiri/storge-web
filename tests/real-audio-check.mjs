// REAL autoplay policy (no emulation): Chrome flag document-user-activation-required.
// Measures actual signal level after the master node with an AnalyserNode.
// node tests/real-audio-check.mjs <url> <scenario: wheel | button | click-first | touch>
import puppeteer from 'puppeteer-core';
const [url = 'http://localhost:5173/?debug', sc = 'wheel'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });
const p = await b.newPage(); const logs = [];
p.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 160)));
const touch = sc === 'touch';
await p.setViewport(touch ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1280, height: 720 });
await p.goto(url, { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
const level = () => p.evaluate(async () => {
  const a = window.__storge.audio; if (!a.ctx) return { ctx: null };
  if (!a._an) { a._an = a.ctx.createAnalyser(); a._an.fftSize = 2048; (a.master || a.out || a.musicBus).connect(a._an); }
  const buf = new Float32Array(2048); let peak = 0;
  for (let i = 0; i < 20; i++) { a._an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise((r) => setTimeout(r, 40)); }
  return { ctx: a.ctx.state, heard: a.notesPlayed, steps: window.__storge.state.notes, peak: +peak.toFixed(4), button: !document.getElementById('sound-start')?.hidden, muted: a.muted, vol: a.volume };
});
const wind = async (n) => { for (let i = 0; i < n; i++) { if (touch) { await p.touchscreen.touchStart(200, 640); for (let j = 1; j <= 8; j++) await p.touchscreen.touchMove(200, 640 - j * 40); await p.touchscreen.touchEnd(); } else { await p.mouse.move(640, 360); await p.mouse.wheel({ deltaY: 120 }); } await new Promise((r) => setTimeout(r, 60)); } };
const out = {};
if (sc === 'click-first') { await p.mouse.click(900, 150); }
await wind(touch ? 1 : 5); await new Promise((r) => setTimeout(r, 600)); out.first = await level();
if (sc === 'button' && out.first.button) {
  const r = await p.evaluate(() => { const e = document.querySelector('.sound-start-btn').getBoundingClientRect(); return [e.left + e.width / 2, e.top + e.height / 2]; });
  await p.mouse.click(...r); await new Promise((r) => setTimeout(r, 500)); out.afterButton = await level();
}
await wind(touch ? 1 : 5); out.next = await level();
console.log(sc, JSON.stringify(out)); console.log(logs.filter((l) => /audio|Audio|error/.test(l)).slice(0, 5).join('\n'));
await b.close();
