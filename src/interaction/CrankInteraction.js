import * as THREE from 'three';
import { CONFIG } from '../config.js';

const TAU = Math.PI * 2;

/**
 * Crank winding input.
 *  - PC: mouse wheel over the 3D area. Wheel DOWN winds. The amount of wheel movement
 *    is turned into crank rotation and fed through a short smoothing queue, so fast
 *    wheeling turns the handle fast but without jumps, and the handle comes to rest
 *    shortly after the wheel stops.
 *  - Touch: swipe UP anywhere on the 3D area. Finger travel -> crank rotation; lifting
 *    the finger stops the crank.
 *  - Mouse press-and-drag is intentionally NOT used any more.
 *  - Ratchet: progress only grows when the handle passes the furthest point reached so
 *    far. Reverse input lets the handle give back by a small play (backlashDeg) and it
 *    springs back, so reverse wheel / swipe-down can never add progress.
 *  - The page never scrolls or zooms on wheel (handled on window, passive:false).
 *    Wheel over the sound controls does not wind.
 *  Rotation is applied only to the GLB's Crank_RotationPivot, local X (via MusicBox).
 */
export class CrankInteraction {
  constructor({ canvas, camera, musicBox, bus }) {
    this.canvas = canvas;
    this.camera = camera;
    this.box = musicBox;
    this.bus = bus;
    const w = CONFIG.winding;
    this.backlash = THREE.MathUtils.degToRad(w.backlashDeg);
    this.maxPending = TAU * w.maxQueuedTurns;

    this.angle = 0;          // visual crank angle (rad, rotation.x)
    this.forwardSign = -1;   // set from the projection: forward = clockwise as seen on screen
    this.wound = 0;          // ratchet high-water mark, forward radians (>= 0)
    this.pending = 0;        // queued input (forward radians) still to be turned
    this.debt = 0;           // reverse input beyond the ratchet play, repaid before forward counts
    this.hold = 0;           // visual: idle-nudge pose kept at the first input, so the handle never jumps back
    this.touchId = null;
    this.lastTouchY = 0;
    this.started = false;
    this.lastInteraction = -1e9;
    this.lastInput = null;   // 'wheel' | 'touch' | 'key'
    this.angularSpeed = 0;   // forward rad/s, smoothed
    this._fwdThisFrame = 0;
    this.nudgeT = 0;
    this.enabled = true;
    this.wheelEvents = 0;    // exposed for tests

    this._v = new THREE.Vector3();

    window.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  get progress() { return Math.min(1, this.wound / (TAU * CONFIG.winding.turnsToFull)); }

  // ---------- screen-space helpers (direction of "forward" on screen, tests) ----------
  toScreen(world) {
    const v = this._v.copy(world).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2((v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top);
  }

  screenBasis() {
    const { P, U, V } = this.box.crankBasisWorld();
    const C = this.toScreen(P);
    const u = this.toScreen(P.clone().add(U)).sub(C);
    const v = this.toScreen(P.clone().add(V)).sub(C);
    return { C, u, v };
  }

  /** re-derive which rotation sign looks clockwise from the current camera */
  updateForwardSign() {
    const { u, v } = this.screenBasis();
    const det = u.x * v.y - u.y * v.x;
    if (Math.abs(det) > 1e-6) this.forwardSign = det > 0 ? 1 : -1;
  }

  gripScreen() { return this.toScreen(this.box.gripWorld()); }

  // ---------- input ----------
  /** queue forward(+)/backward(-) rotation; it is turned smoothly in update() */
  queue(fwd) {
    this.pending = THREE.MathUtils.clamp(this.pending + fwd, -this.maxPending, this.maxPending);
  }

  onWheel = (e) => {
    // never let the page scroll or the browser zoom (ctrl/pinch-wheel) while on this scene
    e.preventDefault();
    if (!this.enabled || e.target !== this.canvas) return;   // e.g. over the sound controls
    if (e.ctrlKey) return;                           // ctrl+wheel / trackpad pinch: zoom gesture, not winding
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;                 // lines -> px
    else if (e.deltaMode === 2) dy *= window.innerHeight; // pages -> px
    if (!dy) return;
    this.wheelEvents++;
    this.lastInput = 'wheel';
    this.queue(dy * CONFIG.winding.wheelRadPerPx);    // wheel down (dy > 0) = wind
    this.markInteraction();
    this.bus.emit('input:wheel');
  };

  onDown = (e) => {
    this.bus.emit('input:press');                   // a real user gesture: audio may start here
    if (!this.enabled || e.pointerType === 'mouse' || this.touchId !== null) return;
    e.preventDefault();
    this.touchId = e.pointerId;
    this.lastTouchY = e.clientY;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.lastInput = 'touch';
    this.markInteraction();
    this.bus.emit('input:touch');
  };

  onMove = (e) => {
    if (e.pointerId !== this.touchId) return;
    e.preventDefault();
    if (!this.enabled) return;                       // e.g. the melody broke while the finger was still down
    const dy = this.lastTouchY - e.clientY;          // finger moving UP = positive = wind
    this.lastTouchY = e.clientY;
    if (dy) { this.queue(dy * CONFIG.winding.touchRadPerPx); this.markInteraction(); }
  };

  onUp = (e) => {
    if (e.type === 'pointerup') this.bus.emit('input:release');
    if (e.pointerId !== this.touchId) return;
    this.touchId = null;
    // finger lifted: let the last few px of motion finish, then stop
    this.pending = THREE.MathUtils.clamp(this.pending, -0.12, 0.12);
  };

  // keyboard: → / D winds (accessibility, kiosks)
  onKey = (e) => {
    this.bus.emit('input:press');
    if (!this.enabled) return;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.lastInput = 'key';
      this.turn(THREE.MathUtils.degToRad(12));
      this.markInteraction();
    }
  };

  markInteraction() {
    this.lastInteraction = performance.now();
    if (!this.started) {
      this.started = true;
      // if the first input lands during the idle nudge, keep that pose until real rotation passes it
      this.hold = Math.max(0, this.box.crankAngle * this.forwardSign);
      this.setForwardPos(this.forwardPos());
      this.bus.emit('crank:first-touch');
    }
  }

  /**
   * apply a forward(+)/backward(-) turn in forward-space radians.
   * The handle shows max(position, wound - backlash); winding only grows beyond `wound`.
   * Reverse input past the play is remembered as `debt` (capped) and must be repaid by
   * forward input first, so "one notch back, one notch forward" never adds progress.
   */
  turn(fwd) {
    if (fwd > 0 && this.debt > 0) { const pay = Math.min(this.debt, fwd); this.debt -= pay; fwd -= pay; if (!fwd) return; }
    const floor = this.wound - this.backlash;
    const raw = this.forwardPos() + fwd;
    if (raw < floor) this.debt = Math.min(this.debt + (floor - raw), THREE.MathUtils.degToRad(CONFIG.winding.reverseMemoryDeg));
    const next = Math.max(raw, floor);
    const gained = Math.max(0, next - this.wound);
    if (gained > 0) {
      const before = this.wound;
      this.wound = next;
      this._fwdThisFrame += gained;
      if (before === 0) this.bus.emit('wind:start');
      this.bus.emit('wind:step', { deltaForward: gained, wound: this.wound, progress: this.progress });
      if (this.progress >= 1 && before / (TAU * CONFIG.winding.turnsToFull) < 1) this.bus.emit('progress:full');
    }
    this.setForwardPos(next);
  }

  forwardPos() { return this.angle * this.forwardSign; }
  setForwardPos(f) {
    this.angle = f * this.forwardSign;
    if (this.hold && f >= this.hold) this.hold = 0;          // real rotation caught up with the nudge pose
    this.box.setCrankAngle(Math.max(f, this.hold) * this.forwardSign);
  }

  update(dt) {
    if (!this.enabled) this.pending = 0;             // disabled: queued input is dropped, nothing turns
    // turn the queued input smoothly (fast input -> fast but continuous rotation)
    if (this.pending) {
      const k = 1 - Math.exp(-dt * CONFIG.winding.inputSmoothing);
      let step = this.pending * k;
      if (Math.abs(this.pending) < 0.002) step = this.pending;
      this.pending -= step;
      this.turn(step);
    }

    const inst = dt > 0 ? this._fwdThisFrame / dt : 0;
    this._fwdThisFrame = 0;
    this.angularSpeed += (inst - this.angularSpeed) * (1 - Math.exp(-dt * 6));

    // handle pulled back by reverse input -> springs back onto the ratchet once input stops
    if (this.pending >= 0 && this.touchId === null) {
      const f = this.forwardPos();
      if (f < this.wound) this.setForwardPos(f + (this.wound - f) * (1 - Math.exp(-dt * 10)));
    }

    // no input for a moment and the nudge pose is still held: ease it back down
    if (this.hold && !this.pending) {
      this.hold = Math.max(this.forwardPos(), this.hold * Math.exp(-dt * 5));
      if (this.hold - this.forwardPos() < 1e-3) this.hold = 0;
      this.setForwardPos(this.forwardPos());
    }

    // gentle "turn me" nudge before the very first interaction (visual only, counts nothing)
    if (!this.started && this.enabled) {
      const period = CONFIG.winding.idleNudgeEverySec;
      this.nudgeT = (this.nudgeT + dt) % period;
      const k = this.nudgeT < 1.3 ? Math.sin((this.nudgeT / 1.3) * Math.PI) : 0;
      this.box.setCrankAngle(this.forwardSign * THREE.MathUtils.degToRad(16) * k * k);
    }
  }

  /** "다시 감기": handle back at rest, nothing wound, idle nudge again */
  reset() {
    this.angle = 0; this.wound = 0; this.pending = 0; this.debt = 0; this.hold = 0;
    this.touchId = null; this.started = false; this.lastInput = null; this.nudgeT = 0;
    this.angularSpeed = 0; this._fwdThisFrame = 0; this.enabled = true;
    this.box.setCrankAngle(0);
  }

  dispose() {
    const c = this.canvas;
    window.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('lostpointercapture', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }
}
