import * as THREE from 'three';

/**
 * Dark floor with a very soft reflection, like the reference: mirrored copies of the
 * box and melody sit under a semi-opaque black plane whose opacity fades to 100%
 * towards the edges and with distance from the objects. No render-to-texture,
 * so it is cheap on phones.
 */
export class Floor {
  constructor(scene) {
    this.mirrorRoot = new THREE.Group();
    this.mirrorRoot.name = 'Reflection';
    this.mirrorRoot.scale.y = -1;           // three.js flips face culling for negative determinants
    scene.add(this.mirrorRoot);

    const tex = Floor.makeAlphaTexture();
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, alphaMap: tex, depthWrite: true }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.00005;
    this.plane.renderOrder = 2;
    this.plane.name = 'Floor';
    scene.add(this.plane);
  }

  /** alpha map: mostly clear in the middle (the shader fade does the work), opaque at the edges */
  static makeAlphaTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0.0, 'rgb(40,40,40)');
    grd.addColorStop(0.2, 'rgb(70,70,70)');
    grd.addColorStop(0.45, 'rgb(225,225,225)');
    grd.addColorStop(1.0, 'rgb(255,255,255)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  /** centre the light pool between box and melody */
  setFocus(x, z) { this.plane.position.x = x; this.plane.position.z = z; }

  /**
   * Add a reflected copy. Its materials are CLONED (originals untouched) and get a
   * fade that darkens the reflection quickly with distance below the floor.
   */
  addMirror(object3d) {
    object3d.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Floor.fadeMaterial(o.material);
    });
    this.mirrorRoot.add(object3d);
  }

  static fadeMaterial(src, gain = 1) {
    if (src.userData.isMirrorFade) return src;
    const m = src.clone();
    m.userData.isMirrorFade = true;
    const prev = src.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(src, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vMirrorY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMirrorY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vMirrorY;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\ngl_FragColor.rgb *= ${(0.30 * gain).toFixed(4)} * exp(vMirrorY / 0.022);`);
    };
    m.customProgramCacheKey = () => (src.customProgramCacheKey?.() || '') + `|mirrorFade${gain}`;
    return m;
  }
}
