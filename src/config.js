// Central tuning for the STORGE piece. Everything that a later scene may want
// to tweak lives here, so the behaviour code stays free of magic numbers.

export const CONFIG = {
  modelUrl: `${import.meta.env.BASE_URL}models/STORGE_MusicBox.glb`,

  // names verified in the Blender / GLB tests — do not rename in the GLB
  nodes: {
    root: 'STORGE_MusicBox',
    crankPivot: 'Crank_RotationPivot',   // rotate ONLY this, on local X
    crankParts: ['Crank_Shaft', 'Crank_Arm', 'Crank_Grip'],
    grip: 'Crank_Grip',
    body: 'MusicBox_Body',
  },
  crankThrow: 0.019,       // m, shaft axis -> grip axis (measured in tests)

  render: {
    background: 0x000000,
    toneMappingExposure: 1.15,
    environmentIntensity: 0.35,
    maxPixelRatio: 2,
  },

  camera: {
    fov: 24,
    azimuthDeg: -21,       // looking from front-left so the left crank reads clearly
    elevationDeg: 9,
    safeMarginX: 0.05,     // fraction of viewport width kept free on each side
  },

  winding: {
    turnsToFull: 6,        // forward turns until the melody reaches full length
    backlashDeg: 14,       // how far the crank may be pulled backwards (ratchet play)
    wheelRadPerPx: 0.006,  // PC: crank rotation per px of wheel (one notch ≈ 100 px ≈ 34°)
    touchRadPerPx: 0.018,  // mobile: crank rotation per px of upward swipe (≈ 1 turn per 350 px)
    inputSmoothing: 12,    // 1/s, how fast queued wheel/swipe input is turned (higher = snappier)
    maxQueuedTurns: 1.2,   // cap on queued input, so the crank never runs on long after input stops
    reverseMemoryDeg: 90,  // reverse input remembered beyond the play (must be undone before winding again)
    idleNudgeEverySec: 3.8,
    growthSmoothing: 4.5,  // 1/s, how quickly the visible melody catches up
  },

  melody: {
    radius: 0.0016,        // m — a thin round cylinder
    radialSegments: 20,
    tubularSegments: 640,
    color: 0x2a1204,          // dark base: the colour comes from the emissive glow
    emissive: 0xffa13c,       // (hue set in MelodyLine CORE_SHADE: yellow-amber core, orange rim)
    emissiveIntensity: 1.0,
    roughness: 0.32,
    bloomColor: [1.0, 0.36, 0.05],  // linear RGB of the light that spreads around the thread (orange)
    reflectionGain: 0.32,     // floor reflection of the melody: faint, so it never reads as a 2nd line
    startGap: 0.012,          // m from the right face of the box
    curveAmplitude: 1.35,     // wave height multiplier (1 = the calm stage-1b curve)
  },

  // soft halo around the melody only (selective bloom, added on top of the normal render;
  // the box, crank and text are never bloomed)
  glow: {
    enabled: true,
    strength: 0.9,
    levels: [0.16, 0.55, 0.62, 0.22, 0.05],   // weight per blur size, narrow -> wide
    resolutionScale: 0.5,      // bloom buffer size vs screen (cheaper on phones)
  },

  // 02–04: tension -> break -> repair
  story: {
    tensionTurns: 2.5,        // extra turns after the melody is complete until it breaks
    // 02 tension, all driven by how far past "full" the visitor has wound (0..1)
    tautMax: 0.6,             // waves flatten by up to 60 % (never a straight line)
    tautCurve: 0.8,           // <1: the flattening shows from the first notches on
    tremorMax: 0.0028,        // m, sideways tremor at the limit (thread radius is 1.6 mm)
    tremorStart: 0.12,        // share of the tremor that grows linearly; the rest builds up late (t^2.4)
    tremorHzMin: 5,           // slow, wide wobble right after the melody is complete ...
    tremorHzMax: 22,          // ... becoming a short, fast shiver just before the break
    snapHoldSec: 0.35,        // at the limit: a brief, tight held moment before "쨍!"
    snapTautExtra: 0.06,      // the thread is pulled a little tighter during that moment
    snapTremor: 0.25,         // tremor drops to this share during the held moment (a tense stillness)
    cuts: [0, 0.17, 0.37, 0.55, 0.79, 1],   // 5 pieces along the curve (piece 1 stays at the box)
    brokenHoldSec: 2.6,       // from the break until the pieces can be dragged (the only wait; no other delay adds to it)
    scatterSec: 1.5,
    sprinklesPerCut: 5,       // tiny crumbs at each break point
    // repair
    hitPx: { mouse: 30, touch: 50 },     // pick radius around a piece
    snapPx: { mouse: 60, touch: 90 },    // release this close to the open end -> snaps
    snapSec: 0.45,
    morphSec: 1.5,            // after joining, the piece turns angular, starting at the joint
    kinkDeg: [0, 13, -11, 10, -12],      // joint angle of each piece once reconnected (sums to ~0: stays level)
    jitter: 0.0036,           // m, sideways offset of the corner points in a repaired piece
    // 04: a music-box note each time a piece joins (pieces 2, 3, 4, 5) — rising to the home note
    connectTones: [{ note: 'G5' }, { note: 'A5' }, { note: 'B5' }, { note: 'C6', bass: 'C4', chord: ['E5', 'G5'], velocity: 0.8 }],
    looseDim: 0.58,           // brightness of pieces still to be reconnected
    grabDim: 0.86,            // while held
  },

  // 05–06 (seconds of story time; all start once the last piece has finished turning angular)
  ending: {
    questionAfter: 0.4,       // repaired (last piece angular) → the question (replaces the repair prompt)
    againAfter: 0.3,          // question → "태엽을 다시 감아보세요."; winding works from here (the question stays)
    lastMorphSec: 0.9,        // the last piece turns angular a little faster than the others (1.5 s)
    changedBeatsPerTurn: 4,   // crank → changed melody (12 notes / 12 beats per pass = 3 turns), repeats while winding
    answerAfterNotes: 15,     // the answer comes with the 15th note: the whole phrase + "E G C" of the next pass
    lightDelay: 0.15,         // 15th note → a light starts along the angular line (the question is fading, ≈0.4 s)
    lightSec: 0.9,            // the light's single run from the box to the end of the line
    formSec: 1.3,             // first mote loosening → the sentence is complete (motes gathering into the words)
    answerEnDelay: 0.4,       // complete Korean line → the English line fades in
    replayAfter: 1.6,         // complete Korean line → "다시 감기"
    spotWidth: 0.05,          // the small light on the line that follows the visitor's playing (share of length)
    spotBase: 0.2,            // its steady brightness while playing ...
    spotNote: 0.55,           // ... plus a soft flare on each note
    answerGlow: 1.12,         // in 06 the repaired line glows a little warmer (1 = unchanged), eased in slowly
  },



  // breakpoint between the landscape (left/right) and portrait (box bottom, melody up) compositions
  portraitAspect: 0.9,

  // the six scenes of the final work — only 01 is implemented in this stage
  scenes: [
    { id: '01-start', name: '시작', implemented: true },
    { id: '02', name: 'TBD', implemented: false },
    { id: '03', name: 'TBD', implemented: false },
    { id: '04', name: 'TBD', implemented: false },
    { id: '05', name: 'TBD', implemented: false },
    { id: '06', name: 'TBD', implemented: false },
  ],
};
