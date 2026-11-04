import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const vp of [{width:1600,height:900},{width:1280,height:720},{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2},{width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2}]) {
  const p = await b.newPage(); await p.setViewport(vp); await p.goto('http://localhost:5173/?debug',{waitUntil:'networkidle0'}); await p.waitForFunction('window.__storgeReady',{timeout:60000});
  const r = await p.evaluate(() => { const s = window.__storge.score().box, rb = document.getElementById('replay'), h = document.querySelector('.hint').getBoundingClientRect(); return { scoreBottom: Math.round(s.y1), replayTop: rb.offsetTop, hintTop: Math.round(h.top), err: 0 }; });
  console.log(vp.width+'x'+vp.height, JSON.stringify(r), r.scoreBottom <= Math.min(r.replayTop, r.hintTop) ? 'OK' : 'OVERLAP'); await p.close();
}
await b.close();
