import './ui/styles.css';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EventBus } from './core/EventBus.js';
import { Stage } from './stage/Stage.js';
import { Floor } from './stage/Floor.js';
import { CameraRig } from './stage/CameraRig.js';
import { MusicBox } from './objects/MusicBox.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { storgeTheme } from './audio/melodies/storgeTheme.js';
import { Overlay } from './ui/Overlay.js';
import { SceneManager } from './scenes/SceneManager.js';
import { createSceneStorge } from './scenes/SceneStorge.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// tests only: ?debug&speed=4 runs the story clock faster (never used in the exhibition)
let SPEED = DEBUG ? Math.min(8, Math.max(1, parseFloat(params.get('speed')) || 1)) : 1;

async function boot() {
  const canvas = document.getElementById('stage');
  const bus = new EventBus();
  const stage = new Stage(canvas);
  const floor = new Floor(stage.scene);
  stage.setBackLayer([floor.plane, floor.mirrorRoot]);
  const rig = new CameraRig(stage.camera);
  const audio = new AudioEngine(storgeTheme);
  const overlay = new Overlay({ audio });

  const musicBox = await MusicBox.load();
  stage.scene.add(musicBox.root);
  floor.addMirror(musicBox.makeMirror());

  const ctx = { stage, floor, rig, bus, audio, overlay, musicBox };
  const scenes = new SceneManager(ctx);
  scenes.register('storge-01-04', createSceneStorge);
  await scenes.go('storge-01-04');

  // ---------- layout ----------
  let controls = null;
  const layout = () => {
    const w = window.innerWidth, h = window.innerHeight;
    stage.setSize(w, h);
    if (!controls) scenes.layout({ width: w, height: h });
  };
  window.addEventListener('resize', layout);
  if (document.fonts?.ready) await document.fonts.ready;   // text block height decides the safe area
  layout();

  // ---------- loop ----------
  const timer = new THREE.Timer();
  timer.connect(document);
  stage.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05) * SPEED;
    const now = performance.now();
    scenes.update(dt, now);
    controls?.update();
    stage.render();
  });
  overlay.loaded();

  // ---------- debug / test hooks ----------
  if (DEBUG || import.meta.env.DEV) {
    window.__storge = {
      THREE, stage, musicBox, scenes, bus, audio, rig,
      setSpeed: (n) => { SPEED = Math.min(8, Math.max(1, n)); },
      score: () => scenes.current.score.info(),
      get state() { return scenes.current.state; },
      gripScreen: () => ctx.crank.gripScreen(),
      pieces: () => scenes.current.fragments.info(stage.camera, ctx.drag.toScreen),
      chainEndScreen: () => { const e = scenes.current.fragments.chainEnd(); return e ? ctx.drag.toScreen(e) : null; },
      dragStats: () => ({ connects: ctx.drag.connects, snapsRejected: ctx.drag.snapsRejected }),
      pivotScreen: () => ctx.crank.toScreen(musicBox.pivotWorld()),
      crankScreenBasis: () => ctx.crank.screenBasis(),
      bodyMatrix: () => musicBox.body.matrixWorld.toArray(),
      melodyMesh: () => {
        const m = scenes.current.melody.tube;
        return { type: m.type, geometry: m.geometry.type, vertices: m.geometry.attributes.position.count,
          triangles: m.geometry.index.count / 3, radius: CONFIG.melody.radius,
          tubularSegments: m.geometry.parameters.tubularSegments, closedTip: !!scenes.current.melody.tipCap.parent };
      },
      async orbit() {               // free camera to inspect the melody's volume
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        ctx.crank.enabled = false;
        controls = new OrbitControls(stage.camera, canvas);
        controls.target.copy(rig.target);
        controls.update();
        return controls;
      },
    };
    window.__storgeReady = true;
  }
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loader');
  if (l) l.innerHTML = `<p style="color:#f3e7d3;font:14px sans-serif;text-align:center;line-height:1.7">장면을 불러오지 못했어요. 새로고침해 주세요.<br><small style="opacity:.5">${String(err?.message || err).slice(0, 140)}</small></p>`;
});
