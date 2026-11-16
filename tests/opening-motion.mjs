import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
console.log(await page.evaluate(() => document.getAnimations().filter((a) => a.effect.target.closest('#opening')).map((a) => { const t = a.effect.getTiming(); const el = a.effect.target; return `${el.className || el.tagName}: delay ${t.delay}ms, ${t.duration}ms`; }).join('\n')));
console.log('close transition:', await page.evaluate(() => getComputedStyle(document.getElementById('opening')).transition));
await browser.close();
