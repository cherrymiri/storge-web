import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * 04–06: the faint trace of the first melody — the smooth curve as it was completed in 01
 * (its own base curve, not the taut / trembling shape just before the break), in the same place.
 * A thin, still, warm grey-beige line without glow or bloom: a memory behind the angular line.
 */
export class MelodyGhost {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.t0 = 0;
  }

  /** draw the trace of `curve` (local to `space`, the melody's group) and fade it in from `time` */
  show(curve, space, time) {
    this.clear();
    const g = CONFIG.ghost;
    const geo = new THREE.TubeGeometry(curve, 360, CONFIG.melody.radius * g.radiusScale, 8, false);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(g.color), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'MelodyGhost';
    this.mesh.renderOrder = -1;                     // always behind the current line
    space.updateMatrixWorld(true);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(space.matrixWorld);
    this.scene.add(this.mesh);
    this.t0 = time;
  }

  update(time) {
    if (!this.mesh) return;
    const g = CONFIG.ghost, k = Math.min(1, Math.max(0, (time - this.t0) / g.fadeSec));
    this.mesh.material.opacity = g.opacity * k * k * (3 - 2 * k);
  }

  get opacity() { return this.mesh ? this.mesh.material.opacity : 0; }
  get visible() { return !!this.mesh; }

  clear() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.mesh = null;
  }
}
