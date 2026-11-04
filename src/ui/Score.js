import { noteEvents } from '../audio/melodyTools.js';

/**
 * The small staff under the music box. It is drawn from the SAME theme data that the
 * music box plays (noteEvents), so pitch → height and length → note value/spacing always
 * match what you hear.
 *
 *  · notation: melody line only, written an octave below sounding pitch (as celesta /
 *    music-box parts usually are) so the tune sits on the staff; no clef, as in the reference
 *  · horizontal position = onset in beats (proportional), one 4-bar phrase (12 beats) per view
 *  · 1 beat = quarter, 0.5 = eighth (two on one beat are beamed), 1.5 = dotted quarter,
 *    2 = half note; a step without a note is a quarter rest
 *  · pages: 'o0' / 'o1' = the 01 theme bars 1–4 / 5–8;  'cmp' = 05: the 01 phrase as a faint
 *    grey-beige voice (stems down) and the changed phrase in warm gold (stems up) on one staff
 */
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PHRASE = 12;                  // beats per view (4 bars of 3/4)
const TOP_LINE = 38;                // F5 (written) — diatonic index of the top staff line
const MID_LINE = 34;                // B4

/** written staff position (diatonic steps), an octave below sounding pitch */
export function staffStep(midi) {
  const w = midi - 12, name = PC[w % 12];
  const oct = Math.floor(w / 12) - 1;
  return { d: oct * 7 + LETTER[name[0]], sharp: name.length > 1 };
}

export const noteValue = (beats) => ({ 0.5: 'eighth', 1: 'quarter', 1.5: 'dotted-quarter', 2: 'half', 3: 'dotted-half' }[beats] || 'quarter');

export class Score {
  constructor({ root, original, changed }) {
    this.root = root;
    this.original = original;
    this.changed = changed;
    this.orig = noteEvents(original);
    this.chg = noteEvents(changed);
    this.root.innerHTML = '<svg class="score-svg" aria-hidden="true" focusable="false"></svg>';
    this.svg = this.root.firstChild;
    this.reset();
  }

  // ------------------------------------------------------------------ state
  reset() {
    this.oState = this.orig.map(() => 'idle');
    this.cState = this.chg.map(() => 'idle');
    this.page = 'o0';
    this.mode = 'play';              // play | frozen | quiet | compare | done
    this.oCurrent = -1; this.cCurrent = -1; this.passes = 0; this.cPass = 0; this.passesChanged = 0;
    this.root.classList.add('instant');
    this.apply();
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('instant')));
  }

  /** 01–02: the music box just played step `stepIndex` of the 01 theme (it loops every 24 steps) */
  onOriginal(stepIndex) {
    const n = this.orig.length, i = stepIndex % n;
    if (i === 0 && stepIndex > 0) { this.oState = this.orig.map(() => 'idle'); this.passes++; }
    if (this.oCurrent >= 0 && this.oState[this.oCurrent] === 'current') this.oState[this.oCurrent] = 'played';
    this.oState[i] = this.orig[i].note ? 'current' : 'played';
    this.oCurrent = i;
    this.page = this.orig[i].beat < PHRASE ? 'o0' : 'o1';
    this.apply();
  }

  /** 03: the music stopped — the highlight fades, the score dims a little */
  freeze() {
    if (this.oCurrent >= 0 && this.oState[this.oCurrent] === 'current') this.oState[this.oCurrent] = 'played';
    this.mode = 'frozen'; this.apply();
  }
  /** 04: stays quiet while the pieces are put back */
  quiet() { this.mode = 'quiet'; this.apply(); }
  /** 05: the comparison view: the 01 phrase (faint) and the changed phrase (not played yet) */
  showCompare() { this.page = 'cmp'; this.mode = 'compare'; this.apply(); }

  /** 05–06: the visitor just played step `stepIndex` of the changed phrase (it repeats while they wind).
   *  On each new pass the highlight starts again at the first note; the notes of the pass before stay
   *  softly lit ('past') so the changed phrase remains readable. No timers. */
  onChanged(stepIndex, pass = 0) {
    if (pass !== this.cPass) {
      if (pass > 0) this.cState = this.cState.map((x) => (x === 'idle' ? 'idle' : 'past'));
      this.cPass = pass; this.passesChanged = pass;
    } else if (this.cCurrent >= 0 && this.cState[this.cCurrent] === 'current') this.cState[this.cCurrent] = 'played';
    this.cState[stepIndex] = 'current';
    this.cCurrent = stepIndex;
    this.apply();
  }

  apply() {
    this.root.dataset.mode = this.mode;
    this.svg.querySelectorAll('.sc-page').forEach((g) => g.classList.toggle('on', g.dataset.page === this.page));
    this.svg.querySelectorAll('[data-v="o"]').forEach((el) => { el.dataset.state = this.oState[+el.dataset.i]; });
    this.svg.querySelectorAll('[data-v="c"]').forEach((el) => { el.dataset.state = this.cState[+el.dataset.i]; });
  }

  // ------------------------------------------------------------------ layout & drawing
  /** size to the screen and sit just above the hint line; returns the score's box */
  layout(hintTop) {
    const W = window.innerWidth, H = window.innerHeight;
    const margin = W < 700 ? 16 : Math.max(24, W * 0.07);
    const w = Math.min(W - 2 * margin, 1180);
    this.pad = Math.max(10, w * 0.035);
    this.bw = (w - 2 * this.pad) / PHRASE;
    this.s = Math.max(6.5, Math.min(12, H * 0.0145, this.bw * 0.32));
    this.w = w;
    this.draw();
    const gap = Math.max(8, H * 0.018);
    const bottom = hintTop - gap;
    this.root.style.left = `${(W - w) / 2}px`;
    this.root.style.width = `${w}px`;
    this.root.style.top = `${bottom - this.h}px`;
    this.box = { left: (W - w) / 2, right: (W + w) / 2, top: bottom - this.h, bottom };
    return this.box;
  }

  y(d) { return this.y0 + (TOP_LINE - d) * this.s / 2; }
  x(beat) { return this.pad + ((beat % PHRASE) + 0.35) * this.bw; }

  draw() {
    const s = this.s;
    this.y0 = 0;                                           // provisional; shifted after the extent is known
    const pages = [
      ['o0', [{ v: 'o', kind: 'main', evs: this.orig.filter((e) => e.beat < PHRASE), stem: 'auto' }]],
      ['o1', [{ v: 'o', kind: 'main', evs: this.orig.filter((e) => e.beat >= PHRASE), stem: 'auto' }]],
      ['cmp', [
        { v: 'o', kind: 'ghost', evs: this.orig.filter((e) => e.beat < PHRASE), stem: 'down' },
        { v: 'c', kind: 'new', evs: this.chg, stem: 'up' },
      ]],
    ];
    // vertical extent of everything that can be drawn (stems, ledgers, halos)
    let lo = this.y(TOP_LINE) - 1.2 * s, hi = this.y(30) + 1.2 * s;
    this.glyphs = [];
    const body = pages.map(([id, voices]) => {
      const parts = voices.map((vc) => this.voice(vc));
      for (const p of parts) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
      return `<g class="sc-page" data-page="${id}">${parts.map((p) => p.svg).join('')}</g>`;
    }).join('');
    const shift = -lo + 2;
    this.h = Math.ceil(hi - lo + 4);
    this.y0 += shift;
    for (const g of this.glyphs) { g.y += shift; }
    const staff = [30, 32, 34, 36, 38].map((d) => `<line x1="0" x2="${this.w}" y1="${this.y(d)}" y2="${this.y(d)}"/>`).join('');
    this.svg.setAttribute('width', this.w);
    this.svg.setAttribute('height', this.h);
    this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
    this.svg.innerHTML = `
      <defs>
        <linearGradient id="scStaff" gradientUnits="userSpaceOnUse" x1="0" x2="${this.w}" y1="0" y2="0">
          <stop offset="0" stop-color="#8a6c4d" stop-opacity="0"/><stop offset="0.07" stop-color="#8a6c4d" stop-opacity="0.62"/>
          <stop offset="0.93" stop-color="#8a6c4d" stop-opacity="0.62"/><stop offset="1" stop-color="#8a6c4d" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="scHalo"><stop offset="0" stop-color="#ffc06e" stop-opacity="0.55"/><stop offset="0.45" stop-color="#ff9a3c" stop-opacity="0.16"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
      </defs>
      <g class="staff" stroke="url(#scStaff)" stroke-width="${Math.max(0.8, s * 0.085)}">${staff}</g>
      <g transform="translate(0 ${shift})">${body}</g>`;
    this.apply();
  }

  /** one melody voice: notes, rests, beams, contour; returns svg + vertical extent */
  voice({ v, kind, evs, stem }) {
    const s = this.s, out = [], segs = [];
    let lo = 1e9, hi = -1e9;
    const notes = evs.filter((e) => e.note);
    const pos = new Map();
    for (const e of notes) { const st = staffStep(e.midi); pos.set(e.index, { x: this.x(e.beat), y: this.y(st.d), d: st.d, sharp: st.sharp }); }
    // beams: two eighths on one beat (first on the beat, second half a beat later)
    const beamed = new Map();
    for (let k = 0; k + 1 < notes.length; k++) {
      const a = notes[k], b = notes[k + 1];
      if (a.beats === 0.5 && b.beats === 0.5 && Number.isInteger(a.beat) && b.beat === a.beat + 0.5) { beamed.set(a.index, b.index); beamed.set(b.index, a.index); }
    }
    const dirOf = (e) => (stem === 'auto' ? (pos.get(e.index).d >= MID_LINE ? 'down' : 'up') : stem);
    const stemLen = 3.3 * s;
    for (const e of evs) {
      const g = [];
      if (!e.note) {                                        // quarter rest on the middle of the staff
        const cx = this.x(e.beat), cy = this.y(MID_LINE);
        const P = (a, b) => `${(cx + a * s).toFixed(2)} ${(cy + b * s).toFixed(2)}`;
        g.push(`<path class="rest" d="M${P(-0.25, -1.45)} L${P(0.32, -0.78)} Q${P(-0.05, -0.42)} ${P(-0.1, -0.22)} L${P(0.34, 0.42)} Q${P(-0.42, 0.18)} ${P(-0.02, 1.3)}" fill="none" stroke="currentColor" stroke-width="${(0.26 * s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        out.push(`<g class="nt nt-rest k-${kind}" data-v="${v}" data-i="${e.index}">${g.join('')}</g>`);
        this.glyphs.push({ v, kind, index: e.index, rest: true, x: cx, y: cy, beat: e.beat });
        continue;
      }
      const p = pos.get(e.index), val = noteValue(e.beats);
      let dir = dirOf(e);
      const partner = beamed.get(e.index);
      if (partner !== undefined && stem === 'auto') {      // a beamed pair shares one direction
        const q = pos.get(partner);
        dir = Math.abs(p.d - MID_LINE) >= Math.abs(q.d - MID_LINE) ? (p.d >= MID_LINE ? 'down' : 'up') : (q.d >= MID_LINE ? 'down' : 'up');
      }
      const up = dir === 'up';
      const sx = p.x + (up ? 0.6 : -0.6) * s;
      let tip = p.y + (up ? -stemLen : stemLen);
      if (partner !== undefined) {                          // stem reaches the beam line
        const a = Math.min(e.index, partner), b = Math.max(e.index, partner), pa = pos.get(a), pb = pos.get(b);
        const ya = pa.y + (up ? -stemLen : stemLen), yb = pb.y + (up ? -stemLen : stemLen);
        const ext = up ? Math.min(ya, yb) : Math.max(ya, yb);
        const slope = Math.max(-0.5 * s, Math.min(0.5 * s, (pb.y - pa.y) * 0.4));
        const ax = pa.x + (up ? 0.6 : -0.6) * s, bx = pb.x + (up ? 0.6 : -0.6) * s;
        const yAt = (x) => ext + (up ? -0.15 * s : 0.15 * s) + slope * ((x - (ax + bx) / 2) / (bx - ax));
        tip = yAt(sx);
        if (e.index === a) {
          const th = 0.48 * s * (up ? 1 : -1);
          g.push(`<path class="beam" d="M${ax} ${yAt(ax)} L${bx + (up ? 0.05 : 0.05) * s} ${yAt(bx)} L${bx + 0.05 * s} ${yAt(bx) + th} L${ax} ${yAt(ax) + th} Z" fill="currentColor"/>`);
        }
      }
      // ledger lines (below the staff / above it)
      for (let d = 28; d >= p.d; d -= 2) g.push(`<line class="ledger" x1="${p.x - 1.0 * s}" x2="${p.x + 1.0 * s}" y1="${this.y(d)}" y2="${this.y(d)}" stroke="currentColor" stroke-width="${(0.11 * s).toFixed(2)}"/>`);
      for (let d = 40; d <= p.d; d += 2) g.push(`<line class="ledger" x1="${p.x - 1.0 * s}" x2="${p.x + 1.0 * s}" y1="${this.y(d)}" y2="${this.y(d)}" stroke="currentColor" stroke-width="${(0.11 * s).toFixed(2)}"/>`);
      g.unshift(`<circle class="halo" cx="${p.x}" cy="${p.y}" r="${(2.4 * s).toFixed(2)}" fill="url(#scHalo)"/>`);
      if (val === 'half' || val === 'dotted-half') {
        g.push(`<ellipse class="head" cx="${p.x}" cy="${p.y}" rx="${(0.56 * s).toFixed(2)}" ry="${(0.36 * s).toFixed(2)}" transform="rotate(-24 ${p.x} ${p.y})" fill="none" stroke="currentColor" stroke-width="${(0.2 * s).toFixed(2)}"/>`);
      } else {
        g.push(`<ellipse class="head" cx="${p.x}" cy="${p.y}" rx="${(0.68 * s).toFixed(2)}" ry="${(0.47 * s).toFixed(2)}" transform="rotate(-22 ${p.x} ${p.y})" fill="currentColor"/>`);
      }
      const y1 = p.y + (up ? -0.1 : 0.1) * s;
      g.push(`<line class="stem" x1="${sx}" x2="${sx}" y1="${y1}" y2="${tip}" stroke="currentColor" stroke-width="${(0.11 * s).toFixed(2)}" stroke-linecap="round"/>`);
      if (val === 'eighth' && partner === undefined) {     // single eighth: a flag
        const f = up ? 1 : -1, P = (a, b) => `${(sx + a * s).toFixed(2)} ${(tip + f * b * s).toFixed(2)}`;
        g.push(`<path class="flag" d="M${P(0, 0)} C${P(0.1, 1.0)} ${P(1.25, 1.2)} ${P(0.85, 2.75)} C${P(1.0, 1.65)} ${P(0.3, 1.45)} ${P(0, 1.5)} Z" fill="currentColor"/>`);
      }
      if (val.startsWith('dotted')) {
        const onLine = p.d % 2 === 0;
        g.push(`<circle class="dot" cx="${p.x + 1.05 * s}" cy="${p.y - (onLine ? s / 2 : 0)}" r="${(0.17 * s).toFixed(2)}" fill="currentColor"/>`);
      }
      lo = Math.min(lo, tip - 0.6 * s, p.y - 2.4 * s); hi = Math.max(hi, tip + 0.6 * s, p.y + 2.4 * s);
      out.push(`<g class="nt k-${kind}" data-v="${v}" data-i="${e.index}" data-value="${val}">${g.join('')}</g>`);
      this.glyphs.push({ v, kind, index: e.index, note: e.note, midi: e.midi, beat: e.beat, beats: e.beats, value: val, d: p.d, x: p.x, y: p.y, stem: dir, beamed: partner !== undefined });
    }
    // the melody's contour: a thin line through the note heads, as in the reference
    for (let k = 0; k + 1 < notes.length; k++) {
      const a = pos.get(notes[k].index), b = pos.get(notes[k + 1].index), dx = (b.x - a.x) / 2;
      segs.push(`<path class="seg k-${kind}" data-v="${v}" data-i="${notes[k + 1].index}" d="M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}" fill="none" stroke="currentColor" stroke-width="${(0.09 * s).toFixed(2)}"/>`);
    }
    return { svg: `<g class="voice v-${kind}">${segs.join('')}${out.join('')}</g>`, lo, hi };
  }

  // ------------------------------------------------------------------ tests
  info() {
    const r = this.root.getBoundingClientRect();
    return {
      page: this.page, mode: this.mode, s: this.s, box: { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom },
      opacity: +getComputedStyle(this.root).opacity,
      cPass: this.cPass, oState: [...this.oState], cState: [...this.cState], passes: this.passes,
      glyphs: this.glyphs.map((g) => ({ ...g, x: g.x + r.left, y: g.y + r.top, page: g.v === 'c' || g.kind === 'ghost' ? 'cmp' : (g.beat < PHRASE ? 'o0' : 'o1') })),
    };
  }
}
