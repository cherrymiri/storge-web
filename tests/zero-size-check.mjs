// loads the page in a 0-wide window, then a normal one: no console errors, score laid out
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width: 1, height: 1 });
await p.goto(process.argv[2] || 'http://localhost:5173/?debug', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 3000));
await p.setViewport({ width: 1280, height: 720 });
await new Promise((r) => setTimeout(r, 3000));
const box = await p.evaluate(() => { const r = document.getElementById('score').getBoundingClientRect(); return [r.width, r.height]; });
console.log(JSON.stringify({ errs, box }));
await b.close();
