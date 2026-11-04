import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config.js';

/** Renderer + scene + environment + warm lights. Shared by every scene of the piece. */
export class Stage {
  constructor(canvas) {
    const r = CONFIG.render;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;          // same family as the Blender AgX renders
    this.renderer.toneMappingExposure = r.toneMappingExposure;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(r.background);

    // soft studio environment so wood clear-coat and rose-gold metal have something to reflect
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = r.environmentIntensity;

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.005, 20);
    this.addLights();
  }

  addLights() {
    const s = this.scene;
    // positions are in model space (m), Y up, front = +Z, crank side = -X
    const key = new THREE.DirectionalLight(0xffb070, 2.6);
    key.position.set(-0.2, 0.3, 0.32);
    const top = new THREE.DirectionalLight(0xffcf90, 1.6);
    top.position.set(0.02, 0.34, 0.06);
    const rim = new THREE.DirectionalLight(0xff8030, 2.0);
    rim.position.set(0.1, 0.16, -0.3);
    const hemi = new THREE.HemisphereLight(0xffd9b0, 0x1a0e06, 0.35);
    s.add(key, top, rim, hemi);

    // warm light that rises with the melody, lighting the box's right side a little
    this.melodyLight = new THREE.PointLight(0xff9a45, 0, 0.35, 2);
    this.melodyLight.position.set(0.09, 0.045, 0.03);
    s.add(this.melodyLight);
  }

  /**
   * Selective glow. The normal frame is rendered exactly as before; then the glowing
   * objects alone (everything else drawn black, so the box still hides what is behind it)
   * go through UnrealBloomPass, and ONLY the blurred halo is used (drawn behind the frame).
   * The thread's geometry and the box's look are untouched.
   * @param {{targets: () => THREE.Object3D[], setMode: (on:boolean) => void, active: () => boolean}} source
   */
  setGlowSource(source) {
    const g = CONFIG.glow;
    if (!g.enabled) return;
    this.glowSource = source;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.bloomComposer = new EffectComposer(this.renderer, rt);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), g.strength, 0, 0);
    // mid blur levels carry the halo: the narrowest is kept low so the thread does not look
    // thicker, the widest are kept low so the glow stays near the thread (no screen-wide haze)
    this.bloomPass.compositeMaterial.uniforms.bloomFactors.value = CONFIG.glow.levels;
    this.bloomComposer.addPass(this.bloomPass);

    this.blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.glowOverlay = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        // bloom-only buffer (UnrealBloomPass's composite, before it blends back onto the input)
        map: this.bloomPass.renderTargetsHorizontal[0].texture,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      }),
    );
    this.glowOverlay.frustumCulled = false;
    this.glowScene = new THREE.Scene();
    this.glowScene.add(this.glowOverlay);
    this.glowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._saved = new Map();
    if (this._size) this.setSize(...this._size);
  }

  setSize(w, h) {
    this._size = [w, h];
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.bloomComposer) {
      this.bloomComposer.setPixelRatio(this.renderer.getPixelRatio() * CONFIG.glow.resolutionScale);
      this.bloomComposer.setSize(w, h);
    }
  }

  renderGlow() {
    const src = this.glowSource;
    const keep = new Set(src.targets());
    const saved = this._saved;
    this.scene.traverseVisible((o) => {
      if (o.isMesh && !keep.has(o)) { saved.set(o, o.material); o.material = this.blackMaterial; }
    });
    const bg = this.scene.background;
    this.scene.background = null;
    src.setMode(true);
    this.bloomComposer.render();
    src.setMode(false);
    this.scene.background = bg;
    saved.forEach((m, o) => { o.material = m; });
    saved.clear();
  }

  /** objects drawn underneath the glow (the floor and the reflections in it) */
  setBackLayer(objects) { this.backLayer = new Set(objects); }

  /** draw only the scene's top-level children for which keep(child) is true (lights always stay) */
  renderPart(keep) {
    const hidden = [];
    for (const c of this.scene.children) {
      if (c.isLight || !c.visible || keep(c)) continue;
      c.visible = false; hidden.push(c);
    }
    this.renderer.render(this.scene, this.camera);
    hidden.forEach((c) => { c.visible = true; });
  }

  render() {
    const r = this.renderer;
    const glow = this.glowSource && this.glowSource.active();
    r.setRenderTarget(null);
    if (!glow) { r.render(this.scene, this.camera); return; }
    this.renderGlow();
    r.setRenderTarget(null);
    // Order: floor + reflections -> glow -> box and thread.
    // The glow lies over the dark floor (so it is never hidden by it), and the opaque box and
    // thread are drawn on top of the glow: the halo shows only AROUND the thread, the thread keeps
    // its own yellow-amber colour and width, and the music box is untouched.
    const back = this.backLayer || new Set();
    const ac = r.autoClear, bg = this.scene.background;
    r.setClearColor(bg, 1);
    r.clear();
    r.autoClear = false;
    this.scene.background = null;
    this.renderPart((c) => back.has(c));
    r.render(this.glowScene, this.glowCamera);
    this.renderPart((c) => !back.has(c));
    this.scene.background = bg;
    r.autoClear = ac;
  }
}
