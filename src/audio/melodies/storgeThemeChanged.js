// STORGE 05 — "달라진 나": the first phrase of the 01 theme (bars 1–4), after the break and the
// clumsy repair. The visitor plays it by winding the crank again (no autoplay).
//
// Same key as the 01 theme so the score can compare note-for-note on one staff:
//   bar 1  E G C        — identical (the motif you recognise)
//   bar 2  B. A G       — same notes, dotted rhythm (was even quarters)
//   bar 3  F A G E      — two eighths (beamed) and the line turns down (was F A C, rising)
//   bar 4  D C––        — lands low and stays: C held over a low C (was E D C, an octave higher)
// Under it the harmony is darker (A minor / E minor / D minor, then home to C).
// 12 notes, 12 beats = 3 crank turns at 4 beats per turn. Consonant throughout.
//
// Format: { note, bass?, chord?, beats } — beats in 3/4. The score reads this same data.

export const storgeThemeChanged = {
  id: 'storge-theme-changed-v2',
  basedOn: 'storge-theme-v0',
  transpose: 0,
  velocity: 0.74,
  steps: [
    // bar 1 — same notes; A minor underneath (was C major)
    { note: 'E5', bass: 'A3', beats: 1 }, { note: 'G5', beats: 1 }, { note: 'C6', beats: 1 },
    // bar 2 — dotted: B. A G ; E minor underneath
    { note: 'B5', bass: 'E3', beats: 1.5 }, { note: 'A5', beats: 0.5 }, { note: 'G5', beats: 1 },
    // bar 3 — F A G E: turns down instead of climbing to C ; D minor underneath
    { note: 'F5', bass: 'D3', beats: 1 }, { note: 'A5', beats: 0.5 }, { note: 'G5', beats: 0.5 }, { note: 'E5', beats: 1 },
    // bar 4 — D, then the low C held (half note) over C major: a calm, lower ending
    { note: 'D5', bass: 'G3', beats: 1 }, { note: 'C5', bass: 'C3', chord: ['E4', 'G4'], beats: 2 },
  ],
};
