// モデル確認用ビューア（?view=kaiju）: 海の上で怪獣のアニメーションを確認する
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderPipeline } from './core/renderer.js';
import { Sky } from './world/sky.js';
import { Ocean } from './world/ocean.js';
import { makeWaterNormalTexture, makeNoiseTexture } from './world/proceduralTextures.js';
import { loadAll, assets } from './core/assets.js';
import { KaijuModel, HEAD_KEYS } from './game/kaijuModel.js';

export async function runViewer() {
  const canvas = document.getElementById('game');
  const pipe = new RenderPipeline(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 40000);
  camera.position.set(140, 70, -260);
  pipe.init(scene, camera, 'high');
  const params = new URLSearchParams(location.search);
  const noise = makeNoiseTexture(256, 11);
  const sky = new Sky(pipe.renderer, noise, params.get('sky') || 'day');
  scene.background = sky.background;
  scene.environment = sky.environment;
  scene.fog = new THREE.FogExp2(sky.horizonColor.clone(), sky.preset.fogDensity);
  const sun = new THREE.DirectionalLight(new THREE.Color(...sky.preset.sunColor), sky.preset.sunIntensity);
  sun.position.copy(sky.sunDir).multiplyScalar(400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 1200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const ocean = new Ocean({
    envCube: sky.background, sunDir: sky.sunDir, sunColor: new THREE.Color(...sky.preset.sunColor),
    sunIntensity: sky.preset.sunIntensity, normalA: makeWaterNormalTexture(256, 7, [1, 0.3]),
    normalB: makeWaterNormalTexture(256, 21, [0.4, 1]), noise, preset: sky.preset,
  });
  scene.add(ocean.mesh);

  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:12px;top:12px;color:#dfe6ee;font:13px/1.6 monospace;background:rgba(0,0,0,.45);padding:10px 14px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(info);
  info.textContent = '読み込み中…';
  await loadAll((p) => { info.textContent = `読み込み中… ${(p * 100) | 0}%`; }, ['kaiju']);
  const kaiju = new KaijuModel(assets.gltf.kaiju, assets.tex.kaijuGlow);
  kaiju.root.position.set(0, params.has('dry') ? 0 : -15, 0);
  scene.add(kaiju.root);
  window.__k = kaiju;

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 45, 0);
  if (params.get('cam')) {
    const [x, y, z] = params.get('cam').split(',').map(Number);
    camera.position.set(x, y, z);
  }
  controls.update();
  window.__v = { camera, controls, pipe, sun, scene, sky, ocean };
  let walking = false, rage = 0, aimOn = false;
  const aimPt = new THREE.Vector3(0, 0, 300);
  info.textContent = [
    '怪獣ビューア',
    'Space: 歩く/止まる   1:咆哮 2:しっぽ 3:左爪 4:右爪 5:よろめき',
    'Q/W/E: 溜め(蒼/紫/紅)  A/S/D: 発射  Z/X/C: 怯み  V: 硬直',
    'T: 照準を回す  R: 怒り  H: 頭を倒す(順に)  K: 死亡  F: 被弾',
  ].join('\n');
  const keyHead = { q: 'R', w: 'C', e: 'L', a: 'R', s: 'C', d: 'L', z: 'R', x: 'C', c: 'L' };
  let killIdx = 0;
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { walking = !walking; kaiju.setWalking(walking ? 6 : 0); }
    if (k === '1') kaiju.playBody('Roar');
    if (k === '2') kaiju.playBody('TailSwipe');
    if (k === '3') kaiju.playBody('ClawL');
    if (k === '4') kaiju.playBody('ClawR');
    if (k === '5') kaiju.playBody('Stagger');
    if ('qwe'.includes(k)) { kaiju.playHead(keyHead[k], 'Charge'); kaiju.setHeadGlow(keyHead[k], 1); kaiju.setMouthGlow(keyHead[k], 0.6); }
    if ('asd'.includes(k)) { kaiju.playHead(keyHead[k], 'Fire'); kaiju.setHeadGlow(keyHead[k], 1.4); kaiju.setMouthGlow(keyHead[k], 1); }
    if ('zxc'.includes(k)) { kaiju.playHead(keyHead[k], 'Flinch'); kaiju.setHeadGlow(keyHead[k], 0); kaiju.setMouthGlow(keyHead[k], 0); kaiju.flash(1); }
    if (k === 'v') for (const h of HEAD_KEYS) { kaiju.playHead(h, 'Recover'); kaiju.setHeadGlow(h, 0); kaiju.setMouthGlow(h, 0); }
    if (k === 'r') { rage = rage ? 0 : 1; kaiju.setRage(rage); }
    if (k === 't') aimOn = !aimOn;
    if (k === 'h' && killIdx < 3) kaiju.killHead(HEAD_KEYS[killIdx++]);
    if (k === 'k') kaiju.die();
    if (k === 'f') kaiju.flash(1);
  });

  addEventListener('resize', () => pipe.resize());
  const clock = new THREE.Clock();
  let fpsT = 0, frames = 0, fps = 0;
  (function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    ocean.update(dt, camera);
    if (aimOn) {
      const t = kaiju.time * 0.5;
      aimPt.set(Math.sin(t) * 400, 30 + Math.sin(t * 1.7) * 60, 250 + Math.cos(t) * 150);
      for (const h of HEAD_KEYS) kaiju.aimHead(h, aimPt, 1);
    } else for (const h of HEAD_KEYS) kaiju.aimHead(h, null);
    kaiju.update(dt);
    controls.update();
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(sky.sunDir, 400);
    pipe.render(dt);
    frames++; fpsT += dt;
    if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; document.title = `FPS ${fps.toFixed(0)} | tris ${pipe.renderer.info.render.triangles}`; }
    requestAnimationFrame(frame);
  })();
}
