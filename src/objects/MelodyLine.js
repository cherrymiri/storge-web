import * as THREE from 'three';
import { CONFIG } from '../config.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Curve presets. Each returns an arc-length parameterised THREE.Curve.
 * Kept deliberately calm: one or two long, low swells, no tight S-bends.
 */
export const MelodyPaths = {
  // desktop / landscape: leaves the right face of the box and drifts to the right edge
  // in one gentle dip and one gentle rise (about 1.2 long waves over the whole length)
  horizontal(start, A = CONFIG.melody.curveAmplitude) {
    const L = 0.38, pts = [];                               // same overall length as stage 1 -> same framing
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const ramp = smooth(0, 0.35, t);                      // starts straight out of the box
      pts.push(new THREE.Vector3(
        start.x + L * t,
        start.y + 0.012 * t + 0.0105 * A * ramp * Math.sin(Math.PI * 2 * 1.2 * t - 0.35),
        start.z + 0.005 * A * ramp * Math.sin(Math.PI * 2 * 0.6 * t),   // very slight depth, for volume
      ));
    }
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  },
  // portrait phones: leaves the box to the right, turns upward and rises in a single
  // soft arc that leans slightly back toward the centre (one bend, small sideways travel)
  vertical(start, A = CONFIG.melody.curveAmplitude) {
    const s = start;
    const ctrl = [
      [0, 0, 0], [0.014, 0.002, 0.001], [0.026, 0.009, 0.002], [0.035, 0.024, 0.002],
      [0.040, 0.048, 0.003], [0.039, 0.095, 0.003], [0.031, 0.165, 0.002], [0.018, 0.235, 0.000],
      [0.006, 0.300, -0.002], [-0.001, 0.365, -0.003], [-0.003, 0.405, -0.003],
    ].map(([x, y, z]) => new THREE.Vector3(s.x + x, s.y + y, s.z + z));
    // amplitude: scale the sideways bow (distance from the straight rise) after the turn out of the box
    const a = ctrl[4], b = ctrl[ctrl.length - 1];
    for (let i = 5; i < ctrl.length - 1; i++) {
      const q = ctrl[i], t = (q.y - a.y) / (b.y - a.y);
      const lineX = a.x + (b.x - a.x) * t, lineZ = a.z + (b.z - a.z) * t;
      q.x = lineX + (q.x - lineX) * A;
      q.z = lineZ + (q.z - lineZ) * A;
    }
    const base = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    return new THREE.CatmullRomCurve3(base.getSpacedPoints(240), false, 'centripetal');
  },
};

// Glow colour across the rod: bright yellow-amber at the centre, warm orange at the rim.
// (linear values; the melody is not tone mapped, so these reach the screen as-is)
export const CORE_SHADE = `{
  float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  vec3 rimC  = vec3(0.86, 0.36, 0.07);
  vec3 coreC = vec3(1.00, 0.80, 0.42);
  float k = totalEmissiveRadiance.r / max(emissive.r, 1e-4);   // carries intensity + note pulse
  totalEmissiveRadiance = mix(rimC, coreC, pow(nv, 1.35)) * k;
}`;

// During the bloom pass the rod is drawn as flat orange: that is what spreads into the halo,
// so the glow around the thread is orange while the thread itself stays yellow-amber.
export const BLOOM_OUT = `
if (uBloomMode > 0.5) gl_FragColor = vec4(uBloomColor, 1.0);`;

// Whole cross-section rings are moved together, so the thread never gets thicker or thinner.
const TENSION_VERTEX = `
transformed -= waveOffset * uTaut;
transformed += uTremorDir * (uTremor * tremorShape(along, uTime, uHi));`;
// standing waves of a string fixed at both ends. phase = accumulated (rad), so speeding up never jumps.
// hi = 0: long, slow modes (3rd/5th) · hi = 1: short, fast modes (7th/9th) of a string under high tension
const TREMOR_GLSL = `
float tremorShape(float u, float ph, float hi) {
  float pi = 3.14159265;
  float lo = 0.62 * sin(pi * 3.0 * u) * sin(ph) + 0.38 * sin(pi * 5.0 * u + 1.1) * sin(ph * 1.48 + 0.7);
  float hf = 0.6 * sin(pi * 7.0 * u + 0.4) * sin(ph * 1.9) + 0.4 * sin(pi * 9.0 * u) * sin(ph * 2.3 + 1.2);
  return mix(lo, hf, hi) * sin(pi * u);
}`;
/** same shape in JS, for the end caps */
export function tremorShape(u, ph, hi = 0) {
  const lo = 0.62 * Math.sin(Math.PI * 3 * u) * Math.sin(ph) + 0.38 * Math.sin(Math.PI * 5 * u + 1.1) * Math.sin(ph * 1.48 + 0.7);
  const hf = 0.6 * Math.sin(Math.PI * 7 * u + 0.4) * Math.sin(ph * 1.9) + 0.4 * Math.sin(Math.PI * 9 * u) * Math.sin(ph * 2.3 + 1.2);
  return (lo + (hf - lo) * hi) * Math.sin(Math.PI * u);
}

/**
 * The melody: one continuous, round, solid tube that grows along a curve.
 * Growth is done in the shader (fragments beyond `progress` are discarded) and the
 * moving end is closed by a sphere of the same radius, so it never looks hollow.
 */
export class MelodyLine {
  constructor() {
    const m = CONFIG.melody;
    this.group = new THREE.Group();
    this.group.name = 'Melody';
    this.uniforms = {
      uProgress: { value: 0 }, uPulse: { value: 0 },
      uBloomMode: { value: 0 }, uBloomColor: { value: new THREE.Color(...m.bloomColor) },
      // 02 tension: thread pulled taut (waves flatten) and a fine standing-wave tremor
      uTime: { value: 0 }, uTremor: { value: 0 }, uTaut: { value: 0 }, uHi: { value: 0 }, uTremorDir: { value: new THREE.Vector3(0, 1, 0) },
      // 05–06 (used by the repaired pieces): a small light that travels with the music, and a gentle overall glow
      uSpot: { value: -1 }, uSpotK: { value: 0 }, uSpotW: { value: 0.05 }, uGlow: { value: 1 },
    };

    // toneMapped:false keeps the amber saturated (AgX would push it towards beige); the box keeps AgX
    const params = { color: m.color, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, roughness: m.roughness, metalness: 0, toneMapped: false };
    // (bloom is added by Stage as a separate pass; the geometry radius never changes)
    this.material = new THREE.MeshStandardMaterial(params);
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uProgress = this.uniforms.uProgress;
      sh.uniforms.uPulse = this.uniforms.uPulse;
      sh.uniforms.uBloomMode = this.uniforms.uBloomMode;
      sh.uniforms.uBloomColor = this.uniforms.uBloomColor;
      for (const k of ['uTime', 'uTremor', 'uTaut', 'uHi', 'uTremorDir']) sh.uniforms[k] = this.uniforms[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float along;\nattribute vec3 waveOffset;\nvarying float vAlong;\nuniform float uTime;\nuniform float uTremor;\nuniform float uTaut;\nuniform float uHi;\nuniform vec3 uTremorDir;\n' + TREMOR_GLSL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along;\n' + TENSION_VERTEX);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uProgress;\nuniform float uPulse;\nuniform float uBloomMode;\nuniform vec3 uBloomColor;\nvarying float vAlong;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>' + BLOOM_OUT)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vAlong > uProgress) discard;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 + uPulse * 0.55 * smoothstep(uProgress - 0.06, uProgress, vAlong);\n' + CORE_SHADE);
    };
    this.capMaterial = new THREE.MeshStandardMaterial(params);
    this.capMaterial.onBeforeCompile = (sh) => {
      sh.uniforms.uBloomMode = this.uniforms.uBloomMode;
      sh.uniforms.uBloomColor = this.uniforms.uBloomColor;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBloomMode;\nuniform vec3 uBloomColor;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + CORE_SHADE)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>' + BLOOM_OUT);
    };

    const capGeo = new THREE.SphereGeometry(m.radius, m.radialSegments, Math.ceil(m.radialSegments / 2));
    this.startCap = new THREE.Mesh(capGeo, this.capMaterial);
    this.tipCap = new THREE.Mesh(capGeo, this.capMaterial);
    this.startCap.name = 'Melody_StartCap';
    this.tipCap.name = 'Melody_TipCap';
    this.tube = null;
    this.progress = 0;
    this.pulse = 0;
  }

  /** (re)build the tube along a new curve — keeps the current progress */
  setCurve(curve, straight = null) {
    const m = CONFIG.melody;
    this.curve = curve;
    this.straight = straight;
    if (this.tube) { this.group.remove(this.tube); this.tube.geometry.dispose(); }
    const geo = new THREE.TubeGeometry(curve, m.tubularSegments, m.radius, m.radialSegments, false);
    const uv = geo.attributes.uv;
    const along = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) along[i] = uv.getX(i);
    geo.setAttribute('along', new THREE.BufferAttribute(along, 1));
    // offset of each ring from the flat (amplitude 0) version of the path: pulling it taut moves rings back
    const wave = new Float32Array(uv.count * 3);
    if (straight) {
      const cache = new Map();
      for (let i = 0; i < uv.count; i++) {
        const u = along[i];
        let o = cache.get(u);
        if (!o) { o = curve.getPointAt(u).sub(straight.getPointAt(u)); cache.set(u, o); }
        wave[i * 3] = o.x; wave[i * 3 + 1] = o.y; wave[i * 3 + 2] = o.z;
      }
    }
    geo.setAttribute('waveOffset', new THREE.BufferAttribute(wave, 3));
    this.tube = new THREE.Mesh(geo, this.material);
    this.tube.name = 'Melody_Tube';
    this.tube.frustumCulled = false;
    this.group.add(this.tube, this.startCap, this.tipCap);
    this.startCap.position.copy(curve.getPointAt(0));
    this.setProgress(this.progress);
  }

  setProgress(p) {
    this.progress = THREE.MathUtils.clamp(p, 0, 1);
    this.uniforms.uProgress.value = this.progress;
    const visible = this.progress > 0.0005;
    this.group.visible = visible;
    if (visible && this.curve) this.tipCap.position.copy(this.pointAt(this.progress));
  }

  /** displayed centre-line point (taut + tremor applied), as the shader draws it */
  pointAt(u, withTremor = true) {
    const p = this.curve.getPointAt(u);
    const un = this.uniforms;
    if (this.straight && un.uTaut.value) p.sub(this.curve.getPointAt(u).sub(this.straight.getPointAt(u)).multiplyScalar(un.uTaut.value));
    if (withTremor && un.uTremor.value) p.addScaledVector(un.uTremorDir.value, un.uTremor.value * tremorShape(u, un.uTime.value, un.uHi.value));
    return p;
  }

  /** 02: how taut the thread is drawn (all values computed by the scene from the winding) */
  setStrain({ taut, tremor, hi, phase, dir }) {
    const un = this.uniforms;
    un.uTime.value = phase;
    un.uTaut.value = taut;
    un.uTremor.value = tremor;
    un.uHi.value = hi;
    if (dir) un.uTremorDir.value.copy(dir);
    if (this.group.visible && this.curve) this.tipCap.position.copy(this.pointAt(this.progress));
  }

  /** "다시 감기": back to an empty, relaxed thread */
  reset() {
    this.setStrain({ taut: 0, tremor: 0, hi: 0, phase: 0 });
    this.pulse = 0;
    this.uniforms.uPulse.value = 0;
    this.uniforms.uSpot.value = -1; this.uniforms.uSpotK.value = 0; this.uniforms.uGlow.value = 1;
    this.setProgress(0);
    this.syncMirror();
  }

  /** the curve exactly as shown at this instant (taut + current tremor) — used to cut the pieces */
  bakedCurve(n = 240) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(this.pointAt(i / n, true));
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }

  /** brief brightening of the growing end on each note (visual "sound" for muted viewers) */
  notePulse() { this.pulse = 1; }

  update(dt) {
    this.pulse = Math.max(0, this.pulse - dt * 2.2);
    this.uniforms.uPulse.value = this.pulse;
    this.capMaterial.emissiveIntensity = CONFIG.melody.emissiveIntensity * (1 + this.pulse * 0.55);
  }

  /** mirror copy for the floor reflection (shares geometry/material/uniforms) */
  makeMirror() {
    const g = new THREE.Group();
    g.name = 'Melody_Reflection';
    const sync = () => {
      g.clear();
      const tube = this.tube.clone();
      tube.material = this.mirrorTubeMaterial ??= this.makeMirrorTubeMaterial();
      const s = this.startCap.clone(), t = this.tipCap.clone();
      s.material = t.material = this.mirrorCapMaterial ??= this.fade(this.capMaterial);
      g.add(tube, s, t);
    };
    this._mirror = g; this._syncMirror = sync;
    return g;
  }

  /** set by the floor: function that converts a material into a fading reflection material */
  setMirrorFade(fn) { this.fade = fn; }
  makeMirrorTubeMaterial() {
    const m = this.fade(this.material);
    const fadeHook = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { fadeHook(sh, r); };
    return m;
  }

  syncMirror() {
    if (!this._mirror || !this.tube) return;
    const [tube, s, t] = this._mirror.children.length ? this._mirror.children : [];
    if (!tube || tube.geometry !== this.tube.geometry) return this._syncMirror();
    this._mirror.visible = this.group.visible;
    t.position.copy(this.tipCap.position);
    s.position.copy(this.startCap.position);
  }

  /** meshes that glow (main rod only — never the floor reflection) */
  bloomTargets() { return this.tube ? [this.tube, this.startCap, this.tipCap] : []; }
  setBloomMode(on) { this.uniforms.uBloomMode.value = on ? 1 : 0; }

  samplePoints(n = 60) { return this.curve ? this.curve.getSpacedPoints(n) : []; }
}
