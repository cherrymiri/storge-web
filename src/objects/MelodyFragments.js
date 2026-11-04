import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { CORE_SHADE } from './MelodyLine.js';

const Z = new THREE.Vector3(0, 0, 1);
const easeOut = (t) => 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function rng(seed) {            // small deterministic PRNG (same break every time)
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** same glowing look as the melody (yellow-amber core, orange rim), plus a per-piece brightness */
function makePieceMaterial(shared, dim, range) {
  const m = CONFIG.melody;
  const mat = new THREE.MeshStandardMaterial({
    color: m.color, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, roughness: m.roughness, metalness: 0, toneMapped: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBloomMode = shared.uBloomMode;
    sh.uniforms.uBloomColor = shared.uBloomColor;
    sh.uniforms.uDim = dim;
    sh.uniforms.uG0 = range.g0; sh.uniforms.uG1 = range.g1;
    for (const k of ['uSpot', 'uSpotK', 'uSpotW', 'uGlow']) sh.uniforms[k] = shared[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float pieceU;\nvarying float vPieceU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPieceU = pieceU;');
    // light only: brightness changes, the shape never does
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBloomMode;\nuniform vec3 uBloomColor;\nuniform float uDim;\nuniform float uG0;\nuniform float uG1;\nuniform float uSpot;\nuniform float uSpotK;\nuniform float uSpotW;\nuniform float uGlow;\nvarying float vPieceU;\nfloat spotAt() { float g = mix(uG0, uG1, vPieceU); float d = (g - uSpot) / uSpotW; return uSpotK * exp(-d * d); }')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + CORE_SHADE + '\ntotalEmissiveRadiance *= uDim * uGlow * (1.0 + spotAt());')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uBloomMode > 0.5) gl_FragColor = vec4(uBloomColor * uDim * uDim * uGlow * (1.0 + 1.4 * spotAt()), 1.0);');
  };
  mat.customProgramCacheKey = () => 'storge-piece';
  return mat;
}

/** one of the 5 pieces: a solid round tube with closed (rounded) ends */
class Piece {
  constructor(index, worldPts, shared, capGeos, range) {
    const st = CONFIG.story;
    this.index = index;
    this.origin = worldPts[0].clone();                       // piece-local origin = its start point
    const local = worldPts.map((p) => p.clone().sub(this.origin));
    this.smooth = new THREE.CatmullRomCurve3(local, false, 'centripetal');
    this.length = this.smooth.getLength();
    this.localEnd = this.smooth.getPointAt(1);
    this.dim = { value: 1 };
    this.targetDim = 1;
    this.range = { g0: { value: range[0] }, g1: { value: range[1] } };   // where this piece sits along the whole line
    this.material = makePieceMaterial(shared, this.dim, this.range);
    this.group = new THREE.Group();
    this.group.name = `Melody_Piece_${index + 1}`;
    this.group.position.copy(this.origin);
    this.segments = Math.max(28, Math.round((this.length / 0.38) * 640));
    this.mesh = new THREE.Mesh(this.tube(this.smooth), this.material);
    this.mesh.frustumCulled = false;
    this.startCap = new THREE.Mesh(capGeos[0], this.material);
    this.endCap = new THREE.Mesh(capGeos[1], this.material);
    this.endCap.position.copy(this.localEnd);
    this.group.add(this.mesh, this.startCap, this.endCap);

    this.fixed = index === 0;
    this.connected = index === 0;
    this.grabbed = false;
    this.tween = null;
    this.morph = 0;            // 0 = original smooth curve, 1 = repaired angular shape
    this.morphing = false;
    this.poly = this.makeAngular(st.jitter);
  }

  tube(curve) {
    const m = CONFIG.melody;
    const g = new THREE.TubeGeometry(curve, this.segments, m.radius, m.radialSegments, false);
    const uv = g.attributes.uv, pu = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) pu[i] = uv.getX(i);
    g.setAttribute('pieceU', new THREE.BufferAttribute(pu, 1));
    return g;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  /** the repaired shape: straight runs with corners, same end points as the original piece */
  makeAngular(jitter) {
    const S = this.smooth;
    const inner = this.length > 0.088 ? [0.36, 0.71] : [0.5];   // one corner, two on the longest piece
    const signs = this.index % 2 ? [1, -0.8] : [-1, 0.85];
    const pts = [S.getPointAt(0)];
    inner.forEach((u, i) => {
      const t = S.getTangentAt(u);
      const perp = new THREE.Vector3(-t.y, t.x, 0).normalize();
      pts.push(S.getPointAt(u).addScaledVector(perp, jitter * signs[i]));
    });
    pts.push(S.getPointAt(1));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, total: cum[cum.length - 1] };
  }

  polyAt(u) {
    const { pts, cum, total } = this.poly;
    const d = u * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return pts[i - 1].clone().lerp(pts[i], THREE.MathUtils.clamp(t, 0, 1));
  }

  /** blend smooth -> angular; the part next to the joint (u = 0) changes first */
  setMorph(m) {
    this.morph = m;
    const n = 72, pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const w = smooth01((m - 0.6 * u) / 0.4);
      pts.push(this.smooth.getPointAt(u).lerp(this.polyAt(u), w));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const old = this.mesh.geometry;
    this.mesh.geometry = this.tube(curve);
    old.dispose();
    this.currentCurve = curve;
  }

  /** current shape's local points (for picking / tests) */
  localPoints(n = 24) { return (this.currentCurve || this.smooth).getSpacedPoints(n); }
  worldPoints(n = 24) { this.group.updateMatrixWorld(true); return this.localPoints(n).map((p) => p.applyMatrix4(this.group.matrixWorld)); }
  worldStart() { this.group.updateMatrixWorld(true); return new THREE.Vector3().applyMatrix4(this.group.matrixWorld); }
  worldEnd() { this.group.updateMatrixWorld(true); return this.localEnd.clone().applyMatrix4(this.group.matrixWorld); }
  centroid() { const pts = this.smooth.getSpacedPoints(16); return pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length); }
}

/**
 * 03 break + 04 repair of the melody.
 * The pieces are cut from the curve exactly as it looked at the break, so each keeps its
 * own bends. Piece 1 stays at the box; 2–5 drift a little apart, then the visitor drags them
 * back in order. Each reconnected piece snaps to the open end at a small angle (a kink)
 * and then slowly turns angular, starting from the joint.
 */
export class MelodyFragments {
  constructor({ scene, mirrorRoot, fade, shared }) {
    this.scene = scene;
    this.mirrorRoot = mirrorRoot;
    this.fade = fade;
    this.shared = shared;
    this.pieces = [];
    this.sprinkles = [];
    this.flashes = [];
    this.mirrors = [];
    this.active = false;
    this.repairing = false;
    this.capGeo = new THREE.SphereGeometry(CONFIG.melody.radius, CONFIG.melody.radialSegments, Math.ceil(CONFIG.melody.radialSegments / 2));
    // caps carry their position along the piece too (start = 0, end = 1) for the travelling light
    this.capGeos = [0, 1].map((u) => {
      const g = this.capGeo.clone();
      g.setAttribute('pieceU', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(u), 1));
      return g;
    });

    // two small soft dots: the open end of the chain, and the matching end of the next piece
    const dotMat = () => new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const dotGeo = new THREE.SphereGeometry(0.0034, 16, 10);
    this.anchorDot = new THREE.Mesh(dotGeo, dotMat());
    this.nextDot = new THREE.Mesh(dotGeo, dotMat());
    this.anchorDot.name = 'Repair_Hint_OpenEnd';
    this.nextDot.name = 'Repair_Hint_NextPiece';
    this.anchorDot.visible = this.nextDot.visible = false;
    scene.add(this.anchorDot, this.nextDot);
  }

  get nextIndex() { const i = this.pieces.findIndex((p) => !p.connected); return i < 0 ? this.pieces.length : i; }
  get allConnected() { return this.pieces.length > 0 && this.pieces.every((p) => p.connected); }
  get settled() { return this.pieces.every((p) => !p.tween && !p.morphing); }

  /** cut the baked curve into 5 pieces at their exact original positions */
  build(curve, mode) {
    const cuts = CONFIG.story.cuts;
    this.mode = mode;
    this.curve = curve;
    for (let k = 0; k < cuts.length - 1; k++) {
      const u0 = cuts[k], u1 = cuts[k + 1], n = 64, pts = [];
      for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(u0 + (u1 - u0) * (i / n)));
      const piece = new Piece(k, pts, this.shared, this.capGeos, [u0, u1]);
      this.scene.add(piece.group);
      this.pieces.push(piece);
      // faint floor reflection of each piece (same fade as the melody's)
      const mg = new THREE.Group();
      const mm = new THREE.Mesh(piece.mesh.geometry, this.fade(piece.material));
      const ms = new THREE.Mesh(this.capGeos[0], mm.material), me = new THREE.Mesh(this.capGeos[1], mm.material);
      me.position.copy(piece.localEnd);
      mg.add(mm, ms, me);
      this.mirrorRoot.add(mg);
      this.mirrors.push({ group: mg, mesh: mm });
    }
    this.cutPoints = cuts.slice(1, -1).map((u) => curve.getPointAt(u));
    this.active = true;
    this.syncMirrors();
  }

  /** flash at each break point + a few tiny crumbs ("sprinkles") */
  burst(time) {
    const r = rng(20261103);
    const flashGeo = new THREE.SphereGeometry(0.0034, 14, 10);
    const crumbGeo = new THREE.CylinderGeometry(0.00042, 0.00042, 0.0034, 6);
    const colors = [0xffb35a, 0xffe2b0, 0xff9a3c];
    for (const p of this.cutPoints) {
      const f = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.62), transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
      f.position.copy(p);
      this.scene.add(f);
      this.flashes.push({ mesh: f, t0: time });
      for (let i = 0; i < CONFIG.story.sprinklesPerCut; i++) {
        const m = new THREE.Mesh(crumbGeo, new THREE.MeshBasicMaterial({ color: colors[i % 3], transparent: true, opacity: 1, toneMapped: false }));
        m.position.copy(p);
        m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
        const a = r() * Math.PI * 2, sp = 0.045 + r() * 0.06;
        const v = new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 0.02, (r() - 0.5) * 0.05);
        const spin = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(14);
        this.scene.add(m);
        this.sprinkles.push({ mesh: m, v, spin, t0: time, life: 1.5 + r() * 0.6 });
      }
    }
  }

  /** pieces 2–5 drift a little apart and turn slightly — kept inside the frame */
  scatter(time) {
    const H = {
      offsets: [null, [0.004, 0.017, 0.006], [0.013, -0.019, -0.004], [0.004, 0.021, 0.005], [-0.012, -0.017, -0.006]],
      rot: [0, 10, -12, 9, -11],
    };
    const V = {
      offsets: [null, [0.021, 0.008, 0.004], [-0.024, 0.006, -0.004], [0.02, 0.008, 0.005], [-0.022, -0.004, -0.006]],
      rot: [0, -10, 12, -9, 11],
    };
    const cfg = this.mode === 'vertical' ? V : H;
    for (const p of this.pieces) {
      if (p.fixed) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(Z, THREE.MathUtils.degToRad(cfg.rot[p.index]));
      const c = p.centroid();                                   // turn about the piece's middle
      const pos = p.origin.clone().add(new THREE.Vector3(...cfg.offsets[p.index])).add(c).sub(c.clone().applyQuaternion(q));
      this.tweenTo(p, pos, q, CONFIG.story.scatterSec, time);
    }
  }

  tweenTo(p, pos, quat, dur, time) {
    p.tween = { p0: p.group.position.clone(), q0: p.group.quaternion.clone(), p1: pos, q1: quat, t0: time, dur };
  }

  setRepairing(on) {
    this.repairing = on;
    for (const p of this.pieces) p.targetDim = p.connected ? 1 : CONFIG.story.looseDim;
  }

  /** world point where the next piece has to be attached */
  chainEnd() {
    const last = this.pieces[this.nextIndex - 1];
    if (!last) return null;
    const t = last.tween;
    const pos = t ? t.p1 : last.group.position, q = t ? t.q1 : last.group.quaternion;
    return last.localEnd.clone().applyQuaternion(q).add(pos);
  }

  /** visitor drags a piece: follow the pointer (cancels any drift) */
  movePiece(p, pos) { p.tween = null; p.group.position.copy(pos); }

  /** snap piece k onto the open end with its kink angle, then let it turn angular */
  connect(p, time) {
    const end = this.chainEnd();
    const q = new THREE.Quaternion().setFromAxisAngle(Z, THREE.MathUtils.degToRad(CONFIG.story.kinkDeg[p.index]));
    p.connected = true;
    p.grabbed = false;
    p.targetDim = 1;
    this.tweenTo(p, end, q, CONFIG.story.snapSec, time);
    p.morphStart = time + CONFIG.story.snapSec * 0.6;
    p.morphing = true;
    // the last piece settles a little sooner so the story can move on without a wait
    const last = this.pieces.every((q) => q.connected);
    p.morphSec = last ? CONFIG.ending.lastMorphSec : CONFIG.story.morphSec;
    if (last) {
      // a piece joined just before may still be turning angular: let it finish together with the last one,
      // speeding up only what is left of its change (no jump in shape)
      const end = p.morphStart + p.morphSec;
      for (const q of this.pieces) {
        if (q === p || !q.morphing) continue;
        const sec = q.morphSec || CONFIG.story.morphSec;
        if (q.morphStart + sec <= end) continue;
        const m0 = Math.max(0, Math.min(1, (time - q.morphStart) / sec));
        const sec2 = Math.max(0.05, (end - Math.max(time, q.morphStart)) / (1 - m0));
        q.morphStart = Math.max(time, q.morphStart) - m0 * sec2;
        q.morphSec = sec2;
      }
    }
    // the joint lights up briefly when the piece lands (visible feedback even without sound)
    this.jointFlash(end, time + CONFIG.story.snapSec * 0.8);
  }

  jointFlash(pos, t0) {
    this._jointGeo ||= new THREE.SphereGeometry(0.0026, 14, 10);
    const f = new THREE.Mesh(this._jointGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    f.position.copy(pos);
    f.visible = false;
    this.scene.add(f);
    this.flashes.push({ mesh: f, t0, dur: 0.5, joint: true });
    this.jointFlashes = (this.jointFlashes || 0) + 1;
  }

  successPulse(time) { this.pulseT0 = time; }

  /** "다시 감기": remove every piece, crumb, flash and reflection — nothing is left behind or doubled */
  clear() {
    for (const p of this.pieces) { this.scene.remove(p.group); p.dispose(); }
    for (const m of this.mirrors) { this.mirrorRoot.remove(m.group); m.mesh.material.dispose(); }
    for (const s of this.sprinkles) { this.scene.remove(s.mesh); s.mesh.material.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.mesh); f.mesh.material.dispose(); }
    this.pieces = []; this.mirrors = []; this.sprinkles = []; this.flashes = []; this.jointFlashes = 0;
    this.active = false; this.repairing = false; this.pulseT0 = undefined; this.curve = null;
    this.anchorDot.visible = this.nextDot.visible = false;
  }

  bloomTargets() {
    const out = [];
    for (const p of this.pieces) out.push(p.mesh, p.startCap, p.endCap);
    for (const s of this.sprinkles) out.push(s.mesh);
    for (const f of this.flashes) out.push(f.mesh);
    return out;
  }

  syncMirrors() {
    this.pieces.forEach((p, i) => {
      const m = this.mirrors[i];
      m.group.position.copy(p.group.position);
      m.group.quaternion.copy(p.group.quaternion);
      if (m.mesh.geometry !== p.mesh.geometry) m.mesh.geometry = p.mesh.geometry;
    });
  }

  update(dt, time) {
    const st = CONFIG.story;
    for (const p of this.pieces) {
      const t = p.tween;
      if (t) {
        const k = easeOut((time - t.t0) / t.dur);
        p.group.position.lerpVectors(t.p0, t.p1, k);
        p.group.quaternion.slerpQuaternions(t.q0, t.q1, k);
        if (k >= 1) p.tween = null;
      }
      if (p.morphing && time >= p.morphStart) {
        const m = Math.min(1, (time - p.morphStart) / (p.morphSec || st.morphSec));
        p.setMorph(smooth01(m));
        if (m >= 1) p.morphing = false;
      }
      let target = p.grabbed ? st.grabDim : p.targetDim;
      if (this.pulseT0 !== undefined) {            // quiet success: a soft glow passes along the new melody once
        const x = (time - this.pulseT0 - p.index * 0.17) / 0.55;
        if (x > 0 && x < 1) target *= 1 + 0.38 * Math.sin(Math.PI * x);
      }
      p.dim.value += (target - p.dim.value) * (1 - Math.exp(-dt * 7));
    }

    // crumbs: fly out, slow down, fall a little, fade
    this.sprinkles = this.sprinkles.filter((s) => {
      const age = time - s.t0;
      if (age > s.life) { this.scene.remove(s.mesh); s.mesh.material.dispose(); return false; }
      s.v.multiplyScalar(Math.exp(-dt * 2.2));
      s.v.y -= 0.16 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      if (s.mesh.position.y < 0.002) { s.mesh.position.y = 0.002; s.v.set(0, 0, 0); }
      s.mesh.rotation.x += s.spin.x * dt; s.mesh.rotation.y += s.spin.y * dt; s.mesh.rotation.z += s.spin.z * dt;
      s.mesh.material.opacity = 1 - smooth01((age - (s.life - 0.7)) / 0.7);
      return true;
    });
    // flashes: short bright pop at the break points
    this.flashes = this.flashes.filter((f) => {
      const a = (time - f.t0) / (f.dur || 0.32);
      if (a >= 1) { this.scene.remove(f.mesh); f.mesh.material.dispose(); return false; }
      f.mesh.visible = a >= 0;
      if (a < 0) return true;
      f.mesh.scale.setScalar(1 + a * (f.joint ? 2.2 : 1.4));
      f.mesh.material.opacity = f.joint ? Math.sin(Math.PI * Math.min(1, a * 1.6 + 0.08)) * (1 - a) + (1 - a) * 0.3 : 1 - a;
      return true;
    });

    // hint dots
    const show = this.repairing && !this.allConnected;
    this.anchorDot.visible = this.nextDot.visible = show;
    if (show) {
      const next = this.pieces[this.nextIndex];
      const pulse = 0.32 + 0.3 * (0.5 + 0.5 * Math.sin(time * 3.2));
      this.anchorDot.position.copy(this.chainEnd());
      this.nextDot.position.copy(next.worldStart());
      this.anchorDot.material.opacity = pulse;
      this.nextDot.material.opacity = next.grabbed ? 0.75 : pulse;
    }
    this.syncMirrors();
  }

  // ---- for tests / debugging ----
  info(camera, toScreen) {
    return this.pieces.map((p) => ({
      index: p.index, connected: p.connected, fixed: p.fixed, morph: +p.morph.toFixed(3), dim: +p.dim.value.toFixed(3),
      start: toScreen(p.worldStart()), end: toScreen(p.worldEnd()),
      screenPts: p.worldPoints(16).map(toScreen),
    }));
  }
}
