// Small helpers so later scenes can reshape the same theme (pitch / rhythm changes)
// without touching the synth.

const NAMES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function noteToMidi(name) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return (parseInt(m[2], 10) + 1) * 12 + NAMES[m[1]];
}
export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export const noteToFreq = (name, transpose = 0) => midiToFreq(noteToMidi(name) + transpose);

/** returns a copy of a theme transposed by n semitones */
export const transposeTheme = (theme, n) => ({ ...theme, transpose: (theme.transpose || 0) + n });

/** returns a copy with every step passed through fn(step, index) — e.g. for future "broken" variants */
export const mapSteps = (theme, fn) => ({ ...theme, steps: theme.steps.map(fn) });

/**
 * The one shared view of a theme for sound AND score: every step with its onset (in beats)
 * and length. Steps without `beats` last one beat (the 01 theme: one crank step = one quarter note).
 */
export function noteEvents(theme) {
  let beat = 0;
  return theme.steps.map((s, index) => {
    const e = { index, beat, beats: s.beats ?? 1, note: s.note ?? null, midi: s.note ? noteToMidi(s.note) + (theme.transpose || 0) : null };
    beat += e.beats;
    return e;
  });
}
export const themeBeats = (theme) => theme.steps.reduce((a, s) => a + (s.beats ?? 1), 0);
