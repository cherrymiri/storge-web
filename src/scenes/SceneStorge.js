import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MelodyLine, MelodyPaths } from '../objects/MelodyLine.js';
import { MelodyFragments } from '../objects/MelodyFragments.js';
import { CrankInteraction } from '../interaction/CrankInteraction.js';
import { FragmentDrag } from '../interaction/FragmentDrag.js';
import { CrankMelody } from '../audio/CrankMelody.js';
import { storgeThemeChanged } from '../audio/melodies/storgeThemeChanged.js';
import { Score } from '../ui/Score.js';
import { AnswerParticles } from '../ui/AnswerParticles.js';

const TAU = Math.PI * 2;

/** story states of STORGE 01–06, and what the visitor can do in each */
export const STATES = {
  INTRO: 'INTRO',                     // 01 nothing wound yet                 -> wind
  LOVE_EXPANDING: 'LOVE_EXPANDING',   // 01/02 melody grows                    -> wind
  TENSION: 'TENSION',                 // 02 melody complete, taut + trembling  -> wind
  BROKEN: 'BROKEN',                   // 03 shattered, music stopped, silence  -> nothing
  REPAIRING: 'REPAIRING',             // 04 drag pieces back                   -> drag only
  REPAIRED: 'REPAIRED',               // 04 complete, new angular melody kept  -> nothing (look at it)
  CHANGED: 'CHANGED',                 // 05 question, then "태엽을 다시 감아보세요." -> wind = play the changed melody
  ANSWERED: 'ANSWERED',               // 06 after the phrase was played: the answer; stays until "다시 감기" -> replay button
};
const CAN_WIND = new Set([STATES.INTRO, STATES.LOVE_EXPANDING, STATES.TENSION]);

/**
 * STORGE 01–06 as one continuous interaction.
 * 01 start  · wheel / swipe winds the crank, a single glowing melody grows (unchanged)
 * 02 love expanding · past full length the thread is pulled taut and trembles
 * 03 hate & clash · at the limit: "쨍!", music stops, the melody (not the box) breaks in 5 pieces
 * 04 clumsy repair · drag pieces 2–5 back in order; each joins with an angle and turns angular
 * 05 the changed me · "멜로디가 바뀐 나, 가족들은 날 기억할까요?", then "태엽을 다시 감아보세요.":
 *    winding plays the changed phrase note by note (no autoplay); the score compares it with the old one
 * 06 love's answer · only after the whole phrase was played: a pause, then the family's answer.
 *    The line stays angular, the changed phrase stays on the score. "다시 감기" starts over without reloading.
 */
export function createSceneStorge(ctx) {
  const { stage, musicBox, floor, bus, audio, overlay, rig } = ctx;
  const melody = new MelodyLine();
  const fragments = new MelodyFragments({
    scene: stage.scene, mirrorRoot: floor.mirrorRoot, shared: melody.uniforms,
    fade: (m) => floor.constructor.fadeMaterial(m, CONFIG.melody.reflectionGain),
  });
  let crank, drag, layoutMode = null;
  let state = STATES.INTRO;
  let shownProgress = 0, tension = 0, tensionShown = 0;
  let stepAccumulator = 0;
  let clock = 0;                        // seconds, advanced in update()
  let repairAt = Infinity, promptOffAt = Infinity, flash = 0;
  let phase = 0, snapAt = Infinity, snapT0 = 0;          // tremor phase; the held moment before the break
  const strain = { taut: 0, tremor: 0, hi: 0, hz: 0 };
  const changed = new CrankMelody(audio, storgeThemeChanged, CONFIG.ending.changedBeatsPerTurn);
  const score = new Score({ root: document.getElementById('score'), original: audio.theme, changed: storgeThemeChanged });
  let tl = {};                 // 04→06 timeline (story clock), set when the repair is complete
  let noteFlare = 0, spotIn = 0, spotPos = 0;
  let tones = [];              // 04 repair tones waiting for their piece to land
  const answerFx = new AnswerParticles(overlay);
  let resets = 0;
  const history = [{ state, t: 0 }];
  const offs = [];
  const fullWound = () => TAU * CONFIG.winding.turnsToFull;

  function melodyStart() {
    const bb = musicBox.bodyBox;
    return new THREE.Vector3(bb.max.x + CONFIG.melody.startGap, (bb.min.y + bb.max.y) * 0.5 - 0.002, 0.004);
  }

  function setState(s) {
    if (s === state) return;
    state = s;
    history.push({ state: s, t: +clock.toFixed(2) });
    crank.enabled = CAN_WIND.has(s) || (s === STATES.CHANGED && !!tl.againShown) || s === STATES.ANSWERED;
    if (!crank.enabled) crank.pending = 0;
    drag.enabled = s === STATES.REPAIRING;
    bus.emit('story:state', { state: s });
  }

  function breakMelody() {
    const baked = melody.bakedCurve();          // the curve exactly as it looks now
    setState(STATES.BROKEN);
    audio.stopMusic();
    audio.playShatter();
    melody.group.visible = false;
    melody.syncMirror();
    fragments.build(baked, layoutMode);
    fragments.burst(clock);
    fragments.scatter(clock);
    flash = 1;
    overlay.showPrompt('broken');
    overlay.hideHint();
    score.freeze();
    repairAt = clock + CONFIG.story.brokenHoldSec;
  }

  function frame(width, height) {
    const pts = [];
    const b = musicBox.box;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
    const r = CONFIG.melody.radius * 3;
    for (const p of melody.samplePoints(80)) pts.push(p.clone().addScalar(r), p.clone().addScalar(-r));
    rig.fit(pts, overlay.safeRect(width, height, CONFIG.camera.safeMarginX));
    const bb = new THREE.Box3().setFromPoints(pts);
    floor.setFocus((bb.min.x + bb.max.x) / 2, 0);
  }

  /** where the answer goes: the largest size (up to the design size) at which both lines fit in open
   *  space — clear of the line and its glow, the box, the title, the score, the button and the sound
   *  control — then, among those spots, the one nearest the middle of the screen. */
  function placeAnswer() {
    const W = window.innerWidth, H = window.innerHeight, toS = drag.toScreen, C = 4;
    const cols = Math.ceil(W / C), rows = Math.ceil(H / C);
    const occ = new Uint8Array(cols * rows);
    const mark = (x0, y0, x1, y1) => {
      const c0 = Math.max(0, Math.floor(x0 / C)), c1 = Math.min(cols - 1, Math.floor(x1 / C));
      const r0 = Math.max(0, Math.floor(y0 / C)), r1 = Math.min(rows - 1, Math.floor(y1 / C));
      for (let r = r0; r <= r1; r++) occ.fill(1, r * cols + c0, r * cols + c1 + 1);
    };
    const markRect = (r, m) => mark(r.left - m, r.top - m, r.right + m, r.bottom + m);
    const glow = 16;
    for (const p of fragments.pieces) for (const q of p.worldPoints(40)) { const v = toS(q); mark(v.x - glow, v.y - glow, v.x + glow, v.y + glow); }
    const b = musicBox.box; let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const v = toS(new THREE.Vector3(x, y, z)); bx0 = Math.min(bx0, v.x); bx1 = Math.max(bx1, v.x); by0 = Math.min(by0, v.y); by1 = Math.max(by1, v.y);
    }
    mark(bx0 - 12, by0 - 12, bx1 + 12, by1 + 12);
    for (const sel of ['.title-row', '.subtitle']) markRect(overlay.top.querySelector(sel).getBoundingClientRect(), 10);
    markRect(score.box, 10);
    const rb = overlay.replayBtn.getBoundingClientRect(); mark(rb.left - 10, rb.top - 16, rb.right + 10, rb.bottom + 10);
    markRect(overlay.sound.getBoundingClientRect(), 10);
    if (!overlay.soundStart.hidden) markRect(overlay.soundStart.getBoundingClientRect(), 10);
    // prefix sums: is a rectangle free?
    const P = new Int32Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) P[(r + 1) * (cols + 1) + c + 1] = occ[r * cols + c] + P[r * (cols + 1) + c + 1] + P[(r + 1) * (cols + 1) + c] - P[r * (cols + 1) + c];
    const busy = (c0, r0, c1, r1) => P[(r1 + 1) * (cols + 1) + c1 + 1] - P[r0 * (cols + 1) + c1 + 1] - P[(r1 + 1) * (cols + 1) + c0] + P[r0 * (cols + 1) + c0];
    const edge = 10, cx = W / 2, cy = H * 0.45;
    const findSpot = (w, h) => {
      const cw = Math.ceil(w / C), ch = Math.ceil(h / C);
      let best = null;
      for (let r0 = Math.ceil(edge / C); r0 + ch < rows - Math.ceil(edge / C); r0++) {
        for (let c0 = Math.ceil(edge / C); c0 + cw < cols - Math.ceil(edge / C); c0++) {
          if (busy(c0, r0, c0 + cw - 1, r0 + ch - 1)) continue;
          const x = (c0 + cw / 2) * C, y = (r0 + ch / 2) * C, d = (x - cx) ** 2 + ((y - cy) * 1.4) ** 2;
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      return best;
    };
    // the answer keeps its size: first look for room at full size (one line, then wrapped after "그럼,"),
    // and only then step the size down — never below 1.2× the caption size (and never below 21 px)
    // always two lines now ("그럼," / "다시 외우면 되지."); the main line never shrinks below 1.7× the captions (min 28 px)
    const one = overlay.answerMetrics(false), two = one;
    const minSize = Math.min(Math.floor(one.base), Math.max(24, Math.round(overlay.captionSize() * 1.7)));
    // below minSize only as a last resort (very short screens): smaller text is better than covering the work
    for (let size = Math.floor(one.base); size >= Math.min(minSize, 18); size--) {
      for (const m of [one]) {
        const k = size / m.base, spot = findSpot(m.w * k + 8, m.h * k + 6);
        if (spot) { overlay.setAnswer({ x: spot.x, y: spot.y, size, base: m.base, wrapped: m.wrapped }); return; }
      }
    }
    // never expected: smallest allowed size, wrapped, in the middle of the space above the score
    overlay.setAnswer({ x: W / 2, y: Math.min(H * 0.45, score.box.top - two.h * minSize / two.base), size: minSize, base: two.base, wrapped: true });
  }

  /** "다시 감기": everything back to the very start, nothing duplicated */
  function reset() {
    changed.reset();
    answerFx.reset();
    tones = [];
    audio.resetForReplay();
    fragments.clear();
    melody.reset();
    crank.reset();
    drag.reset();
    tl = {}; noteFlare = 0; spotIn = 0; spotPos = 0;
    const un = melody.uniforms; un.uSpotK.value = 0; un.uSpot.value = -1; un.uGlow.value = 1;
    shownProgress = 0; tension = 0; tensionShown = 0; stepAccumulator = 0;
    repairAt = Infinity; promptOffAt = Infinity; snapAt = Infinity; flash = 0; phase = 0;
    Object.assign(strain, { taut: 0, tremor: 0, hi: 0, hz: 0 });
    state = STATES.INTRO;
    history.length = 0; history.push({ state, t: +clock.toFixed(2) });
    crank.enabled = true; drag.enabled = false;
    stage.melodyLight.intensity = 0;
    overlay.reset();
    score.reset();
    layoutMode = null;                                 // rebuild the line for the current screen
    api.layout({ width: window.innerWidth, height: window.innerHeight });
    resets++;
    bus.emit('story:reset');
  }

  /** the angular line on screen, from the box outwards, in the shader's u (0..1) — where the light runs */
  function lineOnScreen(n = 140) {
    const cuts = CONFIG.story.cuts, per = fragments.pieces.map((p) => p.worldPoints(48).map((v) => drag.toScreen(v)));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      let k = 0; while (k < cuts.length - 2 && u > cuts[k + 1]) k++;
      const f = Math.min(1, Math.max(0, (u - cuts[k]) / (cuts[k + 1] - cuts[k]))) * 48, j = Math.min(47, Math.floor(f)), r = f - j;
      const a = per[k][j], b = per[k][j + 1];
      out.push({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r });
    }
    return out;
  }

  const PLAYS = () => (state === STATES.CHANGED && !!tl.againShown) || state === STATES.ANSWERED;

  /** 05–06: notes of the changed phrase just played by the crank (it repeats while the visitor winds) */
  function playedChanged(evs) {
    for (const ev of evs) { score.onChanged(ev.index, ev.pass); noteFlare = 1; bus.emit('changed:note', { index: ev.index, note: ev.note, pass: ev.pass }); }
    if (evs.length && tl.firstNote === undefined) { tl.firstNote = clock; overlay.quietHint(true); }
    // the answer comes WHILE the visitor plays: with the 15th note (the whole phrase + the opening of the
    // next pass). Nothing stops — winding, sound and score go on through the ending.
    if (tl.answerAt === undefined && changed.count >= CONFIG.ending.answerAfterNotes) {
      const e = CONFIG.ending;
      tl.answerAt = clock;
      overlay.showPrompt(null);                          // the question fades (≈0.4 s)
      tl.answer = tl.light = clock + e.lightDelay;       // a light runs along the line; motes come loose from it
      tl.koDone = tl.light + 0.1 + e.formSec;            // … and gather into the sentence
      tl.answerEn = tl.koDone + e.answerEnDelay;
      tl.replay = tl.koDone + e.replayAfter;
    }
  }

  /** 04 → 06 after the last piece has turned angular (story clock). Nothing here plays music. */
  function runEnding(dt) {
    const e = CONFIG.ending, un = melody.uniforms;
    if (state === STATES.REPAIRED && clock >= tl.question) {
      setState(STATES.CHANGED);
      overlay.showPrompt('question');                    // replaces "깨진 선율을 다시 이어주세요."
      score.showCompare();
    }
    if (state === STATES.CHANGED && clock >= tl.again && !tl.againShown) {
      tl.againShown = true;
      overlay.setHintPhase('again');
      overlay.showHint();
      crank.pending = 0;
      crank.enabled = true;                              // from now on winding plays the changed melody
    }
    if (state === STATES.CHANGED && clock >= tl.answer) {
      setState(STATES.ANSWERED);                         // the crank stays enabled
      overlay.hideHint();                                // its place is taken by "다시 감기" shortly
      placeAnswer();
      answerFx.start({ line: lineOnScreen(), t0: tl.light, sweep: e.lightSec, form: e.formSec });
    }
    if (answerFx.active) answerFx.update(clock);
    if (clock >= tl.answerEn && !tl.enShown) { tl.enShown = true; overlay.showEnding('en'); }
    if (clock >= tl.replay && !tl.replayShown) { tl.replayShown = true; overlay.showReplay(true); }

    // a small light on the angular line follows the visitor's playing (it moves only when they wind)
    if (tl.light !== undefined && clock >= tl.light && clock < tl.light + e.lightSec) {
      // 06: the light runs once along the whole line (no flash: a soft rise and fall)
      const k = (clock - tl.light) / e.lightSec;
      un.uSpot.value = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      un.uSpotW.value = e.spotWidth * 1.3;
      un.uSpotK.value = 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6;
      noteFlare *= Math.exp(-dt * 3.2);
      tl.lightRun = true; spotIn = 0; spotPos = changed.phase;
    } else if (tl.firstNote !== undefined) {
      noteFlare *= Math.exp(-dt * 3.2);
      const target = changed.phase;
      if (target < spotPos - 0.5) spotPos = target;      // a new pass: the light starts again at the box
      spotPos += (target - spotPos) * (1 - Math.exp(-dt * 8));
      spotIn = Math.min(1, spotIn + dt / 0.6);
      un.uSpot.value = spotPos;
      un.uSpotW.value = e.spotWidth;
      un.uSpotK.value = spotIn * (e.spotBase + e.spotNote * noteFlare);
    }
    // 06: the line warms a little, slowly (no flash)
    const glowTarget = state === STATES.ANSWERED ? e.answerGlow : 1;
    un.uGlow.value += (glowTarget - un.uGlow.value) * (1 - Math.exp(-dt * 0.9));
  }

  const api = {
    placeAnswer: () => placeAnswer(),   // debug / tests
    async enter() {
      stage.scene.add(melody.group);
      melody.setMirrorFade((m) => floor.constructor.fadeMaterial(m, CONFIG.melody.reflectionGain));
      stage.setGlowSource({
        targets: () => (melody.group.visible ? melody.bloomTargets() : []).concat(fragments.bloomTargets()),
        setMode: (on) => melody.setBloomMode(on),          // pieces share the same uniform
        active: () => melody.group.visible || fragments.active,
      });
      floor.mirrorRoot.add(melody.makeMirror());

      // no text-selection drag / autoscroll from presses on the 3D area
      stage.renderer.domElement.addEventListener('mousedown', (e) => e.preventDefault());
      crank = new CrankInteraction({ canvas: stage.renderer.domElement, camera: stage.camera, musicBox, bus });
      drag = new FragmentDrag({ canvas: stage.renderer.domElement, camera: stage.camera, fragments, bus, clock: () => clock });
      ctx.crank = crank;
      ctx.drag = drag;

      for (const ev of ['crank:first-touch', 'input:press', 'input:release', 'input:wheel', 'input:touch']) {
        offs.push(bus.on(ev, () => audio.unlock()));
      }
      offs.push(bus.on('input:wheel', () => overlay.setHintMode('wheel')));
      overlay.onReplay(() => reset());
      offs.push(bus.on('input:touch', () => { if (CAN_WIND.has(state) || PLAYS()) overlay.setHintMode('touch'); }));
      // 04: each piece that joins brings back one small music-box note when it lands
      offs.push(bus.on('piece:connect', () => {
        const k = fragments.pieces.filter((p) => p.connected).length - 2;       // pieces 2..5 → 0..3
        const tone = CONFIG.story.connectTones[k];
        if (tone) tones.push({ at: clock + CONFIG.story.snapSec * 0.8, tone, k });
      }));
      offs.push(bus.on('wind:start', () => {
        setState(STATES.LOVE_EXPANDING);
        overlay.showPrompt('winding');
        overlay.quietHint(true);
      }));
      offs.push(bus.on('wind:step', ({ deltaForward }) => {
        if (PLAYS()) { playedChanged(changed.advance(deltaForward)); return; }
        if (!CAN_WIND.has(state)) return;
        const stepAngle = TAU / audio.theme.notesPerTurn;
        stepAccumulator += deltaForward;
        if (audio.stepIndex === 0 && stepAccumulator > 0.05) { stepAccumulator = 0; const i = audio.playNextStep(); melody.notePulse(); bus.emit('wind:note', { index: i }); }
        while (stepAccumulator >= stepAngle) {
          stepAccumulator -= stepAngle;
          const i = audio.playNextStep();
          melody.notePulse();
          bus.emit('wind:note', { index: i });
        }
      }));
      offs.push(bus.on('wind:note', ({ index }) => score.onOriginal(index)));
    },

    layout({ width, height }) {
      overlay.scoreTop = score.layout(Math.min(overlay.hintTop(), overlay.replayBtn.offsetTop)).top;   // offsetTop: the button's resting place, whatever its fade-in transform
      const mode = width / height < CONFIG.portraitAspect ? 'vertical' : 'horizontal';
      // after the break the pieces belong to the layout they broke in; only the framing adapts
      if (mode !== layoutMode && !fragments.active) {
        layoutMode = mode;
        const start = melodyStart();
        const curve = MelodyPaths[mode](start);
        // pulled fully taut, the thread would run straight from its start at the box to its end:
        // the tension flattens the curve towards this line (never all the way, see story.tautMax)
        melody.setCurve(curve, new THREE.LineCurve3(curve.getPointAt(0), curve.getPointAt(1)));
        bus.emit('layout:change', { mode });
      }
      frame(width, height);
      crank.updateForwardSign();
      if (state === STATES.ANSWERED) {
        if (answerFx.active && !answerFx.done) { answerFx.reset(); overlay.showEnding('ko'); }   // resized mid-way: just show the text
        placeAnswer();
      }     // rotate / resize: the answer finds open space again
    },

    update(dt, now) {
      clock += dt;
      crank.update(dt, now);
      overlay.showSoundTip((CAN_WIND.has(state) || PLAYS()) && crank.lastInput === 'wheel' && !audio.muted && audio.ctx?.state !== 'running');

      if (CAN_WIND.has(state)) {
        const target = crank.progress;
        shownProgress += (target - shownProgress) * (1 - Math.exp(-dt * CONFIG.winding.growthSmoothing));
        if (Math.abs(target - shownProgress) < 1e-4) shownProgress = target;
        melody.setProgress(shownProgress);
        // 02: once the melody is complete, further winding pulls it taut
        if (state !== STATES.TENSION && crank.progress >= 1 && shownProgress > 0.995) setState(STATES.TENSION);
        tension = state === STATES.TENSION ? THREE.MathUtils.clamp((crank.wound - fullWound()) / (TAU * CONFIG.story.tensionTurns), 0, 1) : 0;
        tensionShown += (tension - tensionShown) * (1 - Math.exp(-dt * 3));
        // 02: the more it is wound past full, the flatter (tauter) the curve and the faster/finer the tremor
        const st = CONFIG.story, t = tensionShown;
        strain.taut = st.tautMax * Math.pow(t, st.tautCurve);
        strain.tremor = st.tremorMax * (st.tremorStart * t + (1 - st.tremorStart) * Math.pow(t, 2.4));
        strain.hi = t * t;
        strain.hz = st.tremorHzMin + (st.tremorHzMax - st.tremorHzMin) * Math.pow(t, 1.5);
        if (snapAt < Infinity) {                 // held moment: pulled a little tighter, the shiver almost stops
          const k = THREE.MathUtils.clamp((clock - snapT0) / st.snapHoldSec, 0, 1);
          const e = 1 - Math.pow(1 - k, 3);
          strain.taut = st.tautMax + st.snapTautExtra * e;
          strain.tremor = st.tremorMax * (1 - (1 - st.snapTremor) * e);
          strain.hi = 1;
          strain.hz = st.tremorHzMax * (1 + 0.6 * e);
        }
        phase += dt * strain.hz * TAU;
        const dir = layoutMode === 'vertical' ? new THREE.Vector3(0.94, 0, 0.34) : new THREE.Vector3(0, 0.94, 0.34);
        melody.setStrain({ ...strain, phase, dir });
        melody.update(dt);
        melody.syncMirror();
        stage.melodyLight.intensity = 0.0025 * Math.min(1, shownProgress * 6) * (1 + melody.pulse * 0.6);
        // 03: the limit — break once the trembling has been visible
        if (state === STATES.TENSION && snapAt === Infinity && tension >= 1 && tensionShown > 0.97) { snapT0 = clock; snapAt = clock + CONFIG.story.snapHoldSec; }
        if (state === STATES.TENSION && clock >= snapAt) breakMelody();
      } else {
        fragments.update(dt, clock);
        flash = Math.max(0, flash - dt * 4);
        const lit = fragments.pieces.filter((p) => p.connected).length / 5;
        stage.melodyLight.intensity = 0.0025 * (0.35 + 0.65 * lit) + 0.02 * flash;
        if (state === STATES.BROKEN && clock >= repairAt) {
          setState(STATES.REPAIRING);
          fragments.setRepairing(true);
          overlay.showPrompt('repair');
          score.quiet();
        }
        // 04: repair tones sound as their piece lands (same music-box tine as the melody)
        while (tones.length && clock >= tones[0].at) {
          const { tone, k } = tones.shift();
          audio.playStep(tone, { id: 'storge-repair-tones', transpose: 0, velocity: 0.66 });
          (audio.repairTones ||= []).push({ k, note: tone.note });
        }
        if (state === STATES.REPAIRING && fragments.allConnected && fragments.settled) {
          setState(STATES.REPAIRED);
          fragments.setRepairing(false);
          fragments.successPulse(clock);
          const e = CONFIG.ending, t0 = clock;
          tl = { question: t0 + e.questionAfter };
          tl.again = tl.question + e.againAfter;
        }
        if (tl.question !== undefined) runEnding(dt);
      }
    },

    exit() { offs.forEach((f) => f()); crank.dispose(); drag.dispose(); },

    reset() { reset(); },

    // read-only state for tests / debugging
    get state() {
      return {
        story: state, history, layout: layoutMode, wound: crank.wound, progress: crank.progress, shownProgress,
        tension: +tension.toFixed(4), tensionShown: +tensionShown.toFixed(4),
        tremor: melody.uniforms.uTremor.value, taut: melody.uniforms.uTaut.value, tremorHz: +strain.hz.toFixed(2), tremorHi: +strain.hi.toFixed(3), snapping: snapAt < Infinity,
        crankAngle: musicBox.crankAngle, forwardSign: crank.forwardSign, crankEnabled: crank.enabled, dragEnabled: drag.enabled,
        notes: audio.stepIndex, notesAudible: audio.notesPlayed, audioState: audio.ctx?.state ?? 'not-started',
        musicStopped: !!audio.musicStopped, shatterPlayed: audio.shatterPlayed || 0,
        prompt: overlay.currentPrompt, pending: crank.pending, lastInput: crank.lastInput, wheelEvents: crank.wheelEvents, hintMode: overlay.hintMode,
        pieces: fragments.pieces.length, connected: fragments.pieces.filter((p) => p.connected).length, nextIndex: fragments.nextIndex,
        sprinkles: fragments.sprinkles.length, melodyVisible: melody.group.visible, clock,
        changedBeat: +changed.beat.toFixed(3), changedCount: changed.count, changedPass: changed.pass, changedPlayed: [...changed.played], changedNotes: audio.changedNotes || 0,
        answerFx: answerFx.info(), againShown: !!tl.againShown, repairTones: [...(audio.repairTones || [])], jointFlashes: fragments.jointFlashes || 0, hintPhase: overlay.hint.dataset.phase || '',
        spot: +melody.uniforms.uSpot.value.toFixed(3), spotK: +melody.uniforms.uSpotK.value.toFixed(3), glow: +melody.uniforms.uGlow.value.toFixed(3),
        ending: overlay.endingState(), resets, timeline: tl,
        sceneMeshes: stage.scene.children.length, mirrorChildren: floor.mirrorRoot.children.length,
      };
    },
    melody,
    fragments,
    changed,
    score,
  };
  return api;
}
