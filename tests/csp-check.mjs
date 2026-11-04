import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); const logs = [];
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`)); p.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await p.setViewport({ width: 1300, height: 800 });
await p.goto(url, { waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 4000));
await p.screenshot({ path: out }); console.log(logs.join('\n')); await b.close();
