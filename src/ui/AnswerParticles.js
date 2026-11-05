/**
 * 06 — the family's answer gathers out of the melody's light.
 *
 *   1. a small warm light runs once along the angular line (the shader spot, driven by the scene)
 *   2. as it passes, tiny translucent gold / apricot motes come loose from the line
 *   3. they drift on a soft "wind" (curved paths, a little flutter) to points sampled from the actual
 *      shape of "그럼, 다시 외우면 되지." as it is laid out on screen
 *   4. while they settle, the real HTML text comes up underneath (blur → sharp) and the motes fade:
 *      what remains is crisp text, never text made only of dots
 *
 * One 2D canvas over the 3D view, pointer-events: none (wheel / swipe / drag pass straight through).
 * Driven by the story clock; nothing is created per frame; reset() clears everything.
 */
const GOLD = [255, 205, 140], APRICOT = [246, 182, 150], PALE = [255, 228, 196];

export class AnswerParticles {
  constructor(overlay) {
    this.overlay = overlay;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'answer-fx';
    this.canvas.setAttribute('aria-hidden', 'true');
    overlay.ending.before(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.sprites = [GOLD, APRICOT, PALE].map((c) => sprite(c));
    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.reset();
  }

  get active() { return !!this.parts; }

  reset() {
    this.parts = null; this.reveal = 0; this.done = false; this.started = 0; this.count = 0;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.opacity = '0';
    this.overlay.ending.classList.remove('forming');
    this.overlay.ending.style.removeProperty('--r1'); this.overlay.ending.style.removeProperty('--r2'); this.reveal1 = 0;
  }

  /**
   * @param line   screen polyline of the angular melody, from the box outwards: [{x,y}], evenly spaced
   * @param t0     story-clock time the light starts running along the line
   * @param sweep  seconds the light takes along the line
   * @param form   seconds from the first mote to the finished sentence
   */
  start({ line, t0, sweep, form }) {
    this.reset();
    this.started++;
    this.t0 = t0; this.sweep = sweep; this.form = form;
    this.tEnd = t0 + 0.1 + form;                         // "다시 외우면 되지." complete
    this.tEnd1 = t0 + 0.1 + form * 0.6;                  // "그럼," complete a little earlier
    const e = this.overlay.ending;
    e.classList.add('forming');
    e.style.setProperty('--r1', '0'); e.style.setProperty('--r2', '0');
    if (this.reduced) { this.parts = []; return; }        // reduced motion: a short plain fade instead

    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`;
    this.dpr = dpr;
    const small = W < 700;
    const targets = this.sampleText(small ? 820 : 1500);
    const L = line.length - 1;
    const parts = [];
    for (const tg of targets) {
      const end = tg.line === 1 ? this.tEnd1 : this.tEnd;
      // where on the line this mote comes loose: just behind the travelling light
      const u = Math.pow(Math.random(), 0.85) * 0.96 + 0.02;
      const src = line[Math.min(L, Math.round(u * L))];
      const emit = t0 + u * sweep * (tg.line === 1 ? 0.7 : 0.92) + Math.random() * 0.08;
      const arrive = Math.max(emit + 0.42, Math.min(end - 0.1 - Math.random() * 0.18, emit + 0.6 + Math.random() * 0.45));
      const stray = Math.random() < 0.1;                 // a few never join the words: they drift on and fade
      const dx = tg.x - src.x, dy = tg.y - src.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;               // perpendicular: the "wind" bends the path
      const bend = (0.18 + Math.random() * 0.22) * len * (Math.random() < 0.7 ? 1 : -1);
      parts.push({
        line: tg.line,
        sx: src.x + (Math.random() - 0.5) * 4, sy: src.y + (Math.random() - 0.5) * 4,
        c1x: src.x + dx * 0.25 + nx * bend - 10, c1y: src.y + dy * 0.25 + ny * bend - 14 - Math.random() * 24,
        c2x: tg.x - dx * 0.2 + nx * bend * 0.35, c2y: tg.y - dy * 0.2 + ny * bend * 0.35,
        tx: tg.x + (stray ? (Math.random() - 0.3) * 70 : 0), ty: tg.y + (stray ? -18 - Math.random() * 40 : 0),
        emit, arrive, stray,
        r: 0.7 + Math.random() * Math.random() * 1.5,    // mostly tiny, a few a little larger
        a: 0.35 + Math.random() * 0.6,
        sp: Math.random() < 0.5 ? 0 : (Math.random() < 0.65 ? 1 : 2),
        ph: Math.random() * 6.283, fl: 2 + Math.random() * 5, fq: 5 + Math.random() * 6,
      });
    }
    this.parts = parts; this.count = parts.length;
    this.canvas.style.opacity = '1';
  }

  /** points inside the glyphs of both Korean lines, exactly where the HTML text will be */
  sampleText(want) {
    const out = [];
    const lines = [...this.overlay.answerKo.querySelectorAll('.ans-l1, .ans-l2')].map((el, i) => {
      const cs = getComputedStyle(el), range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { line: i + 1, text: el.textContent, cs, r, area: r.width * r.height };
    });
    const total = lines.reduce((a, l) => a + l.area, 0);
    for (const l of lines) {
      const n = Math.round(want * l.area / total);
      const x0 = l.r.left - 6, y0 = l.r.top - 6, s = 2;
      const cw = Math.ceil((l.r.width + 12) * s), ch = Math.ceil((l.r.height + 12) * s);
      const off = document.createElement('canvas'); off.width = cw; off.height = ch;
      const c = off.getContext('2d', { willReadFrequently: true });
      c.scale(s, s);
      c.font = `${l.cs.fontWeight} ${l.cs.fontSize} ${l.cs.fontFamily}`;
      if ('letterSpacing' in c) c.letterSpacing = l.cs.letterSpacing;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      c.fillText(l.text, l.r.width / 2 + 6, l.r.height / 2 + 6 + parseFloat(l.cs.fontSize) * 0.04);
      const data = c.getImageData(0, 0, cw, ch).data, pts = [];
      for (let y = 0; y < ch; y += 2) for (let x = 0; x < cw; x += 2) if (data[(y * cw + x) * 4 + 3] > 140) pts.push({ x: x0 + x / s, y: y0 + y / s, line: l.line });
      for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
      out.push(...pts.slice(0, Math.min(n, pts.length)));
    }
    return out;
  }

  /** advance to story time `t`; returns the text reveal 0..1 (of the main line) */
  update(t) {
    if (!this.parts) return this.reveal;
    // the real text comes up while the motes settle (blur → sharp): "그럼," first, then the main line
    const ramp = (end, len) => smooth(Math.min(1, Math.max(0, (t - (end - len)) / len)));
    const r1 = ramp(this.tEnd1, this.reduced ? 0.5 : 0.45), r2 = ramp(this.tEnd, this.reduced ? 0.6 : this.form * 0.45);
    this.reveal = r2; this.reveal1 = r1;
    const e = this.overlay.ending;
    e.style.setProperty('--r1', r1.toFixed(3)); e.style.setProperty('--r2', r2.toFixed(3));
    if (t >= this.tEnd && !this.done) { this.done = true; e.classList.remove('forming'); this.overlay.showEnding('ko'); }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const fadeOut = t > this.tEnd ? Math.max(0, 1 - (t - this.tEnd) / 0.5) : 1;
    if (this.done && (fadeOut <= 0 || !this.parts.length)) { this.parts = null; this.canvas.style.opacity = '0'; return this.reveal; }
    if (!this.parts.length) return this.reveal;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      if (t < p.emit) continue;
      const k = Math.min(1, (t - p.emit) / (p.arrive - p.emit)), ee = easeInOut(k);
      const m = 1 - ee;
      let x = m * m * m * p.sx + 3 * m * m * ee * p.c1x + 3 * m * ee * ee * p.c2x + ee * ee * ee * p.tx;
      let y = m * m * m * p.sy + 3 * m * m * ee * p.c1y + 3 * m * ee * ee * p.c2y + ee * ee * ee * p.ty;
      const fl = p.fl * (1 - ee) * (1 - ee);             // flutter, calming as it arrives
      x += Math.sin(t * p.fq + p.ph) * fl; y += Math.cos(t * p.fq * 0.8 + p.ph) * fl * 0.7;
      let a = p.a * Math.min(1, (t - p.emit) / 0.18);    // loosen gently from the line
      if (p.stray) a *= 1 - k;                           // strays thin out on the way
      else if (k >= 1) a *= 0.6 + 0.4 * Math.sin(t * 7 + p.ph) ** 2;   // settled: a faint shimmer
      const rv = p.line === 1 ? r1 : r2;
      a *= (1 - rv * 0.8) * (p.line === 1 && t > this.tEnd1 ? Math.max(0, 1 - (t - this.tEnd1) / 0.5) : fadeOut);
      if (a < 0.01) continue;
      const sz = p.r * (k < 1 ? 3.4 : 2.8);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(this.sprites[p.sp], x - sz, y - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    return this.reveal;
  }

  info() { return { started: this.started, count: this.count, reveal: this.reveal, reveal1: this.reveal1 ?? 0, done: this.done, active: !!this.parts, reduced: this.reduced }; }
}

function sprite([r, g, b]) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, `rgba(255,248,236,1)`); gr.addColorStop(0.22, `rgba(${r},${g},${b},0.85)`);
  gr.addColorStop(0.55, `rgba(${r},${g},${b},0.18)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  return c;
}
const smooth = (x) => x * x * (3 - 2 * x);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
