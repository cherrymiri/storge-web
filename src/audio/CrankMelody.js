import { noteEvents, themeBeats } from './melodyTools.js';

const TAU = Math.PI * 2;

/**
 * 05–06: the changed melody played by the crank, like the pin drum of a real music box.
 * Forward crank rotation moves a beat cursor (beatsPerTurn per revolution); every note whose
 * onset the cursor passes sounds once, in order. No input → the cursor does not move → no note.
 * Nothing here runs on a timer.
 *
 * The phrase repeats for as long as the visitor winds: pass k starts at k × totalBeats, so the
 * last note (a 2-beat half note) keeps its full length before the phrase comes round again.
 */
export class CrankMelody {
  constructor(audio, theme, beatsPerTurn) {
    this.audio = audio;
    this.theme = theme;
    this.beatsPerTurn = beatsPerTurn;
    this.events = noteEvents(theme).filter((e) => e.note);
    this.totalBeats = themeBeats(theme);        // 12 — the loop length (not the last onset)
    this.reset();
  }

  reset() {
    this.beat = 0;          // cursor position in beats, grows without limit
    this.count = 0;         // notes sounded so far (all passes)
    this.played = [];       // step indices in the order they sounded (tests; last 64)
  }

  get pass() { return Math.floor(this.count / this.events.length); }
  /** where the cursor is inside the phrase, 0..1 */
  get phase() { return (this.beat % this.totalBeats) / this.totalBeats; }
  /** onset (absolute beats) of the next note */
  nextOnset() {
    const n = this.events.length;
    return Math.floor(this.count / n) * this.totalBeats + this.events[this.count % n].beat;
  }

  /** forward crank radians → notes that sound now (in order) */
  advance(rad) {
    if (rad <= 0) return [];
    this.beat += rad * this.beatsPerTurn / TAU;
    const out = [];
    // the first note sounds on the very first movement, the others when the cursor reaches them
    while (this.nextOnset() <= this.beat + 1e-9 && (this.count > 0 || this.beat > 0) && out.length < 4) {
      const e = this.events[this.count % this.events.length];
      // several notes in one frame (very fast winding): keep them in order, a hair apart
      this.audio.playStep(this.theme.steps[e.index], this.theme, out.length * 0.07);
      out.push({ ...e, pass: this.pass, count: this.count });
      this.played.push(e.index);
      if (this.played.length > 64) this.played.shift();
      this.count++;
    }
    // never let the cursor run far ahead of the notes (an extreme fling cannot skip notes)
    this.beat = Math.min(this.beat, this.nextOnset() + 0.49);
    return out;
  }
}
