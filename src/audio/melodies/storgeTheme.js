// STORGE — test theme (original, written for this prototype; not based on any existing song).
// A gentle 3/4 lullaby in C major. One "step" plays each time the crank advances by
// 1/notesPerTurn of a turn, so the tempo follows the visitor's hand like a real crank music box.
//
// Edit freely: change notes, add/remove steps, set `bass` on downbeats, use `null` for a rest.
// Later scenes can derive variants (pitch / rhythm / angular versions) from this data
// with the helpers in ../melodyTools.js instead of rewriting the tune.

export const storgeTheme = {
  id: 'storge-theme-v0',
  notesPerTurn: 6,          // 6 steps per crank revolution  (= two 3/4 bars of quarter notes)
  transpose: 0,             // semitones
  velocity: 0.8,
  steps: [
    // bar 1-2
    { note: 'E5', bass: 'C4' }, { note: 'G5' }, { note: 'C6' },
    { note: 'B5', bass: 'G3' }, { note: 'A5' }, { note: 'G5' },
    // bar 3-4
    { note: 'F5', bass: 'F3' }, { note: 'A5' }, { note: 'C6' },
    { note: 'E6', bass: 'C4' }, { note: 'D6' }, { note: 'C6' },
    // bar 5-6
    { note: 'B5', bass: 'G3' }, { note: 'G5' }, { note: 'D6' },
    { note: 'C6', bass: 'A3' }, { note: 'B5' }, { note: 'A5' },
    // bar 7-8 (cadence, then a breath)
    { note: 'G5', bass: 'F3' }, { note: 'E5' }, { note: 'F5' },
    { note: 'E5', bass: 'C4', chord: ['G4'] }, { note: null }, { note: null },
  ],
};
