import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: 1200, height: 700 });
await p.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__storgeReady');
const ua = () => p.evaluate(() => navigator.userActivation.hasBeenActive);
console.log('start', await ua());
await p.mouse.move(800, 350); console.log('after move', await ua());
await p.mouse.wheel({ deltaY: 100 }); console.log('after wheel', await ua());
await b.close();
