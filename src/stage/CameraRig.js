import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Places the camera (fixed viewing direction) so that a set of world points fits
 * inside a pixel "safe rect" — the area between the title block and the bottom hint.
 * This keeps the box ~35% / melody ~65% composition on desktop and stops text from
 * ever covering the box or the melody, on any screen.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    const c = CONFIG.camera;
    const az = THREE.MathUtils.degToRad(c.azimuthDeg), el = THREE.MathUtils.degToRad(c.elevationDeg);
    this.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.target = new THREE.Vector3();
    this.distance = 0.8;
  }

  apply() {
    this.camera.position.copy(this.target).addScaledVector(this.dir, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }

  /**
   * @param {THREE.Vector3[]} points  content to frame
   * @param {{left:number,right:number,top:number,bottom:number,width:number,height:number}} safe  in CSS px
   */
  fit(points, safe) {
    const cam = this.camera;
    const box = new THREE.Box3().setFromPoints(points);
    this.target.copy(box.getCenter(new THREE.Vector3()));
    this.distance = box.getSize(new THREE.Vector3()).length() * 3;

    // safe rect in NDC
    const sx0 = (safe.left / safe.width) * 2 - 1, sx1 = (safe.right / safe.width) * 2 - 1;
    const sy0 = 1 - (safe.bottom / safe.height) * 2, sy1 = 1 - (safe.top / safe.height) * 2;
    const sw = sx1 - sx0, shh = sy1 - sy0, scx = (sx0 + sx1) / 2, scy = (sy0 + sy1) / 2;

    const v = new THREE.Vector3();
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    for (let it = 0; it < 40; it++) {
      this.apply();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) {
        v.copy(p).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const scale = Math.max((x1 - x0) / sw, (y1 - y0) / shh);
      const dx = scx - (x0 + x1) / 2, dy = scy - (y0 + y1) / 2;
      // shift target so the content centre lands on the safe-rect centre
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * this.distance;
      const halfW = halfH * cam.aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      this.target.addScaledVector(right, -dx * halfW).addScaledVector(up, -dy * halfH);
      this.distance *= 0.35 + 0.65 * scale;
      if (Math.abs(scale - 1) < 0.002 && Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) break;
    }
    this.apply();
  }
}
