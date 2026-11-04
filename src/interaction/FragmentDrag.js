import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * 04: drag the broken pieces back (mouse or finger).
 *  - Press on / near a loose piece (generous radius, larger for touch) and drag: it follows
 *    the pointer on a plane facing the camera.
 *  - The held piece is slightly brighter.
 *  - Released close to the open end of the chain, the NEXT piece in order snaps on.
 *    Other pieces simply stay where they were dropped.
 */
export class FragmentDrag {
  constructor({ canvas, camera, fragments, bus, clock }) {
    this.canvas = canvas;
    this.camera = camera;
    this.frags = fragments;
    this.bus = bus;
    this.clock = clock;              // () => seconds, same clock as the scene
    this.enabled = false;
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.connects = 0;               // for tests
    this.snapsRejected = 0;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
  }

  toScreen = (v) => {
    const p = v.clone().project(this.camera), r = this.canvas.getBoundingClientRect();
    return { x: (p.x + 1) / 2 * r.width + r.left, y: (1 - p.y) / 2 * r.height + r.top };
  };

  radius(e, kind) { return CONFIG.story[kind][e.pointerType === 'mouse' ? 'mouse' : 'touch']; }

  /** nearest loose piece to the pointer (screen distance to its centre line);
   *  when pieces lie close together, the one whose turn it is wins */
  pick(x, y, maxPx) {
    let best = null, bestD = maxPx;
    const next = this.frags.nextIndex;
    for (const p of this.frags.pieces) {
      if (p.fixed || p.connected) continue;
      const bias = p.index === next ? 14 : 0;
      const pts = p.worldPoints(24);
      const sp = pts.map(this.toScreen);
      for (let i = 1; i < sp.length; i++) {
        const a = sp[i - 1], b = sp[i];
        const abx = b.x - a.x, aby = b.y - a.y;
        const t = THREE.MathUtils.clamp(((x - a.x) * abx + (y - a.y) * aby) / Math.max(1e-6, abx * abx + aby * aby), 0, 1);
        const raw = Math.hypot(a.x + abx * t - x, a.y + aby * t - y);
        if (raw > maxPx) continue;
        const d = raw - bias;
        if (d < bestD) { bestD = d; best = { piece: p, world: pts[i - 1].clone().lerp(pts[i], t) }; }
      }
    }
    return best;
  }

  rayPoint(x, y, plane) {
    const r = this.canvas.getBoundingClientRect();
    const cx = THREE.MathUtils.clamp(x, r.left + 6, r.right - 6), cy = THREE.MathUtils.clamp(y, r.top + 6, r.bottom - 6);
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  onDown = (e) => {
    if (!this.enabled || this.drag) return;
    const hit = this.pick(e.clientX, e.clientY, this.radius(e, 'hitPx'));
    if (!hit) return;
    e.preventDefault();
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.world);
    const p = hit.piece;
    this.drag = { piece: p, id: e.pointerId, plane, offset: p.group.position.clone().sub(hit.world), type: e.pointerType,
      from: p.group.position.clone(), fromQ: p.group.quaternion.clone() };
    p.grabbed = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.canvas.classList.add('is-grabbing');
    this.bus.emit('piece:grab', { index: p.index });
  };

  onMove = (e) => {
    if (!this.drag) {
      if (this.enabled && e.pointerType === 'mouse') this.canvas.classList.toggle('can-grab', !!this.pick(e.clientX, e.clientY, this.radius(e, 'hitPx')));
      return;
    }
    if (e.pointerId !== this.drag.id) return;
    e.preventDefault();
    const w = this.rayPoint(e.clientX, e.clientY, this.drag.plane);
    if (w) this.frags.movePiece(this.drag.piece, w.add(this.drag.offset));
  };

  onUp = (e) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.piece.grabbed = false;
    this.canvas.classList.remove('is-grabbing');
    const end = this.frags.chainEnd();
    if (!end) return;
    const a = this.toScreen(d.piece.worldStart()), b = this.toScreen(end);
    const px = Math.hypot(a.x - b.x, a.y - b.y);
    const snapPx = CONFIG.story.snapPx[d.type === 'mouse' ? 'mouse' : 'touch'];
    if (d.piece.index === this.frags.nextIndex && (px <= snapPx || d.piece.worldStart().distanceTo(end) < 0.012)) {
      this.frags.connect(d.piece, this.clock());
      this.connects++;
      this.bus.emit('piece:connect', { index: d.piece.index });
    } else {
      if (px <= snapPx) {                          // right place, but not this piece's turn:
        this.snapsRejected++;                      // it glides back to where it was picked up
        this.frags.tweenTo(d.piece, d.from, d.fromQ, 0.55, this.clock());
      }
      this.bus.emit('piece:drop', { index: d.piece.index });
    }
  };

  reset() {
    this.drag = null; this.enabled = false; this.connects = 0; this.snapsRejected = 0;
    this.canvas.classList.remove('is-grabbing', 'can-grab');
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
  }
}
