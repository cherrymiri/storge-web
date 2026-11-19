import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config.js';

/**
 * Loads the verified GLB unchanged (geometry, materials, texture untouched) and
 * exposes the crank pivot. Only `crankPivot.rotation.x` is ever written.
 */
export class MusicBox {
  static async load(onProgress) {
    const loader = new GLTFLoader();
    const embedded = window.__STORGE_GLB_B64;
    if (!embedded) {
      const gltf = await loader.loadAsync(CONFIG.modelUrl, (e) => {
        if (e.total) onProgress?.(e.loaded / e.total);
      });
      return new MusicBox(gltf.scene);
    }
    // Single-file build (hosted pages with a strict CSP): no fetch() at all.
    // Decode the GLB in script, and make GLTFLoader use <img> (blob: images are allowed)
    // instead of ImageBitmapLoader, which would fetch() the texture blob.
    const bin = Uint8Array.from(atob(embedded), (c) => c.charCodeAt(0));
    const savedCIB = window.createImageBitmap;
    try {
      window.createImageBitmap = undefined;
      const gltf = await loader.parseAsync(bin.buffer, '');
      return new MusicBox(gltf.scene);
    } finally {
      window.createImageBitmap = savedCIB;
    }
  }

  constructor(root) {
    this.root = root;
    const n = CONFIG.nodes;
    this.crankPivot = root.getObjectByName(n.crankPivot);
    this.grip = root.getObjectByName(n.grip);
    this.body = root.getObjectByName(n.body);
    if (!this.crankPivot || !this.grip || !this.body) throw new Error('STORGE GLB: expected nodes not found');
    this.crankMeshes = n.crankParts.map((name) => root.getObjectByName(name));

    // 웹의 나무색을 갤러리 첫 화면(블렌더 렌더)의 진한 메이플 색에 맞춤: 나무 텍스처에 따뜻한 갈색을 곱함
    root.traverse((o) => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) if (m && m.name === 'M_Maple_Wood' && !m.userData.toned) { m.color.setRGB(...CONFIG.woodTint); m.userData.toned = true; }
    });

    root.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(root);               // incl. crank
    this.bodyBox = new THREE.Box3().setFromObject(this.body);

    this.mirror = null;
  }

  /** reflection copy (shares geometry + materials, so nothing is altered) */
  makeMirror() {
    this.mirror = this.root.clone(true);
    this.mirror.name = 'MusicBox_Reflection';
    this.mirrorPivot = this.mirror.getObjectByName(CONFIG.nodes.crankPivot);
    return this.mirror;
  }

  setCrankAngle(rad) {
    this.crankPivot.rotation.x = rad;
    if (this.mirrorPivot) this.mirrorPivot.rotation.x = rad;
  }

  get crankAngle() { return this.crankPivot.rotation.x; }

  /** world-space shaft axis origin */
  pivotWorld(target = new THREE.Vector3()) { return this.crankPivot.getWorldPosition(target); }

  /**
   * Points on the crank circle for screen-space math: the grip centre at angle a is
   * pivot + cos(a)*U + sin(a)*V  (U = -Y*r, V = -Z*r in the pivot's parent frame,
   * matching rotation.x about +X applied to the grip rest position (0,-r,0)).
   */
  crankBasisWorld() {
    const r = CONFIG.crankThrow;
    const parent = this.crankPivot.parent;
    parent.updateWorldMatrix(true, false);
    const p = this.crankPivot.position;
    const m = parent.matrixWorld;
    const P = p.clone().applyMatrix4(m);
    const U = new THREE.Vector3(p.x, p.y - r, p.z).applyMatrix4(m).sub(P);
    const V = new THREE.Vector3(p.x, p.y, p.z - r).applyMatrix4(m).sub(P);
    return { P, U, V };
  }

  gripWorld(target = new THREE.Vector3()) {
    const b = new THREE.Box3().setFromObject(this.grip);
    return b.getCenter(target);
  }
}
