// 怪獣ヨモツの見た目（モデル・マテリアル・アニメーションの重ね合わせ・首の照準）
import * as THREE from 'three';
import { damp, clamp, DEG } from '../core/util.js';

export const HEAD_KEYS = ['R', 'C', 'L']; // 画面左(水色) / 中央(紫) / 画面右(赤)
export const HEAD_INFO = {
  R: { name: '蒼の首', short: '蒼', color: new THREE.Color(0.37, 0.89, 1.0), css: '#5fe3ff', restYaw: -15 * DEG },
  C: { name: '紫の首', short: '紫', color: new THREE.Color(0.72, 0.42, 1.0), css: '#b77cff', restYaw: 0 },
  L: { name: '紅の首', short: '紅', color: new THREE.Color(1.0, 0.30, 0.22), css: '#ff5a4e', restYaw: 15 * DEG },
};
const EYE_COLOR = { C: new THREE.Color(1.0, 0.12, 0.08), L: new THREE.Color(0.25, 1.0, 0.35), R: new THREE.Color(0.25, 1.0, 0.35) };
// 全身に重ねる動き（Blender で作った加算アニメーション）
const BODY_ADDITIVE = ['Roar', 'RageRoar', 'TailSwipe', 'ClawL', 'ClawR', 'Stagger', 'HitBig', 'TailThrash', 'LookAround', 'Stomp', 'MegaCharge', 'MegaFire'];
// 首ごとに重ねる動き
const HEAD_CLIPS = ['Charge', 'Fire', 'Recover', 'Flinch', 'Roar', 'Death', 'Snap', 'Shake'];
const HEAD_ONESHOT = new Set(['Snap', 'Shake', 'Roar']);
const WALK_METERS_PER_SEC = 4.8; // 歩行アニメ（1倍スケール）の歩く速さ

export class KaijuModel {
  constructor(gltf, glowTex, scale = 1) {
    this.root = new THREE.Group();
    this.root.name = 'Kaiju';
    this.scene = gltf.scene;
    this.root.add(this.scene);
    this.scale = scale;
    this.root.scale.setScalar(scale);
    this.time = 0;
    this.uniforms = {
      uGlowMap: { value: glowTex },
      uGlowCol0: { value: HEAD_INFO.R.color.clone().multiplyScalar(6.0) },
      uGlowCol1: { value: HEAD_INFO.C.color.clone().multiplyScalar(6.0) },
      uGlowCol2: { value: HEAD_INFO.L.color.clone().multiplyScalar(6.0) },
      uGlowLevel: { value: new THREE.Vector3() },
      uRage: { value: 0 },
      uRageCol: { value: new THREE.Color(1.0, 0.16, 0.06).multiplyScalar(4.0) },
      uHitFlash: { value: 0 },
      uTime: { value: 0 },
      uWet: { value: 0 },
    };
    this.spineUniforms = { uSpineGlow: { value: 1 }, uTime: this.uniforms.uTime, uRage: this.uniforms.uRage };
    this.eyeMats = {};
    this.mouthMats = {};
    this.setupMaterials();
    this.setupBones();
    this.setupAnimation(gltf.animations);
    this.heads = {};
    for (const k of HEAD_KEYS) {
      this.heads[k] = {
        glow: 0, glowTarget: 0, mouthGlow: 0, alive: true,
        aimYaw: 0, aimPitch: 0, aimTarget: null, aimWeight: 0,
        layer: null, layerName: '', oneShot: false,
      };
    }
    this.speed = 0;
    this.dead = false;
    this.override = null;      // Emerge / Death のように全身を置き換える動き
    this.overrideEnd = 0;
    this.spineGlowTarget = 1;
  }

  setupMaterials() {
    const u = this.uniforms;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const n = o.name;
      if (n.startsWith('Kaiju')) {
        const m = o.material;
        m.envMapIntensity = 1.0;
        m.metalness = 0;
        m.metalnessMap = null;
        m.color.setScalar(1.12);
        m.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, u);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform sampler2D uGlowMap; uniform vec3 uGlowCol0, uGlowCol1, uGlowCol2; uniform vec3 uGlowLevel;
              uniform float uRage; uniform vec3 uRageCol; uniform float uHitFlash; uniform float uTime; uniform float uWet;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, uWet);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              vec4 gmk = texture2D(uGlowMap, vMapUv);
              float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vMapUv.y * 60.0);
              totalEmissiveRadiance += (uGlowCol0 * gmk.r * uGlowLevel.x + uGlowCol1 * gmk.g * uGlowLevel.y + uGlowCol2 * gmk.b * uGlowLevel.z) * flick;
              float pulse = 0.65 + 0.35 * sin(uTime * 2.6 + vMapUv.x * 30.0);
              totalEmissiveRadiance += uRageCol * gmk.a * gmk.a * uRage * pulse;
              float rimF = pow(max(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 0.0), 2.0);
              totalEmissiveRadiance += vec3(1.0, 0.92, 0.85) * uHitFlash * (0.05 + rimF * 0.5);`);
        };
        m.needsUpdate = true;
      } else if (n.startsWith('Spines')) {
        const sm = new THREE.MeshStandardMaterial({
          color: new THREE.Color(0.035, 0.016, 0.06), roughness: 0.22, metalness: 0.05,
          emissive: new THREE.Color(0.66, 0.32, 1.0), emissiveIntensity: 3.2, vertexColors: true, flatShading: true,
        });
        const su = this.spineUniforms;
        sm.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, su);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform float uSpineGlow; uniform float uTime; uniform float uRage;`)
            .replace('#include <color_fragment>', '')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              float gm = vColor.r;
              float fres = pow(max(1.0 - abs(dot(normal, normalize(vViewPosition))), 0.0), 2.0);
              float breathe = 0.85 + 0.15 * sin(uTime * 1.7);
              vec3 rageTint = mix(vec3(1.0), vec3(1.5, 0.45, 0.35), uRage);
              totalEmissiveRadiance *= (0.06 + gm * gm * 1.45 + fres * gm * 0.9) * uSpineGlow * breathe;
              totalEmissiveRadiance *= rageTint;`);
        };
        o.material = sm;
      } else if (n.startsWith('Eyes_')) {
        const k = n.split('_')[1].charAt(0);
        const em = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, emissive: EYE_COLOR[k].clone(), emissiveIntensity: 7 });
        this.eyeMats[k] = em;
        o.material = em;
      } else if (n.startsWith('Mouth_')) {
        const k = n.split('_')[1].charAt(0);
        const mm = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.012, 0.03), roughness: 0.35, emissive: HEAD_INFO[k].color.clone(), emissiveIntensity: 0 });
        this.mouthMats[k] = mm;
        o.material = mm;
      } else if (o.material) {
        o.material.envMapIntensity = 0.8;
      }
    });
  }

  setupBones() {
    this.bones = {};
    this.sockets = {};
    this.scene.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.name.startsWith('Sock_')) this.sockets[o.name.slice(5)] = o;
    });
  }

  setupAnimation(animations) {
    this.mixer = new THREE.AnimationMixer(this.scene);
    const clips = {};
    for (const c of animations) clips[c.name] = c;
    this.clips = clips;
    const rest = clips.RestPose;
    this.base = {};
    for (const name of ['Idle', 'Walk']) {
      const a = this.mixer.clipAction(clips[name]);
      a.play();
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
      this.base[name] = a;
    }
    for (const name of ['Death', 'Emerge']) {
      if (!clips[name]) continue;
      const d = this.mixer.clipAction(clips[name]);
      d.setLoop(THREE.LoopOnce, 1);
      d.clampWhenFinished = true;
      this.base[name] = d;
    }
    this.additive = {};
    const makeAdd = (name, filter) => {
      const src = clips[name];
      if (!src || !rest) return null;
      const clip = src.clone();
      if (filter) clip.tracks = clip.tracks.filter((t) => filter.some((b) => t.name.startsWith(b + '.')));
      THREE.AnimationUtils.makeClipAdditive(clip, 0, rest, 30);
      const a = this.mixer.clipAction(clip, undefined, THREE.AdditiveAnimationBlendMode);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.enabled = true;
      return a;
    };
    for (const name of BODY_ADDITIVE) this.additive[name] = makeAdd(name, null);
    for (const k of HEAD_KEYS) {
      const bones = [`neck_${k}1`, `neck_${k}2`, `head_${k}`, `jaw_${k}`];
      for (const c of HEAD_CLIPS) {
        const a = makeAdd(`${k}_${c}`, bones);
        if (a && c === 'Fire') a.setLoop(THREE.LoopRepeat, Infinity);
        this.additive[`${k}_${c}`] = a;
      }
    }
    this.bodyLayer = null;
    this.bodyLayerName = '';
  }

  // ---------------------------------------------------------- 制御 API
  setWalking(speed) { this.speed = speed; }

  hasClip(name) { return !!this.additive[name]; }

  /** 全身に重ねる動き。戻り値は再生時間（秒） */
  playBody(name, timeScale = 1, fade = 0.2) {
    const a = this.additive[name];
    if (!a) return 0;
    if (this.bodyLayer && this.bodyLayer !== a) this.bodyLayer.fadeOut(fade);
    a.reset();
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    this.bodyLayer = a;
    this.bodyLayerName = name;
    return a.getClip().duration / timeScale;
  }

  /** いま重ねている全身の動きの残り時間 */
  bodyRemaining() {
    const a = this.bodyLayer;
    if (!a || !a.isRunning()) return 0;
    return Math.max(0, (a.getClip().duration - a.time) / Math.max(0.01, a.timeScale));
  }

  /** 全身を置き換える一回きりの動き（海から現れる・沈む） */
  playOverride(name, fade = 0.5) {
    const a = this.base[name];
    if (!a) return 0;
    a.reset();
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    this.override = a;
    this.overrideEnd = a.getClip().duration;
    return this.overrideEnd;
  }

  endOverride(fade = 0.4) {
    if (this.override && !this.dead) { this.override.fadeOut(fade); this.override = null; }
  }

  /** 頭のレイヤーを切り替える: name = Charge|Fire|Recover|Flinch|Roar|Death|Snap|Shake|null */
  playHead(key, name, timeScale = 1, fade = 0.18) {
    const h = this.heads[key];
    if (h.layerName === name && name !== 'Flinch') return;
    if (h.layer) h.layer.fadeOut(fade);
    h.layerName = name || '';
    h.oneShot = false;
    if (!name) { h.layer = null; return; }
    const a = this.additive[`${key}_${name}`];
    if (!a) { h.layer = null; return; }
    a.reset();
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    h.layer = a;
  }

  /** 何もしていない頭だけが行う一回きりの動き（噛みつき・首振り・咆哮）。終われば元に戻る */
  playHeadOnce(key, name, timeScale = 1) {
    const h = this.heads[key];
    if (!h.alive || (h.layerName && !h.oneShot)) return false;
    this.playHead(key, name, timeScale, 0.12);
    h.oneShot = HEAD_ONESHOT.has(name);
    return true;
  }

  headBusy(key) { const h = this.heads[key]; return !!h.layerName && !h.oneShot; }

  setHeadGlow(key, v) { this.heads[key].glowTarget = v; }
  setMouthGlow(key, v) { this.heads[key].mouthGlow = v; }

  aimHead(key, worldTarget, weight = 1) {
    const h = this.heads[key];
    h.aimTarget = worldTarget ? (h.aimTarget || new THREE.Vector3()).copy(worldTarget) : null;
    h.aimWeight = worldTarget ? weight : 0;
  }

  killHead(key) {
    const h = this.heads[key];
    h.alive = false;
    h.glowTarget = 0;
    this.eyeMats[key].emissiveIntensity = 0.0;
    this.mouthMats[key].emissiveIntensity = 0;
    this.playHead(key, 'Death', 1, 0.1);
  }

  die() {
    this.dead = true;
    for (const k of HEAD_KEYS) {
      const h = this.heads[k];
      h.glowTarget = 0;
      if (h.layer) h.layer.fadeOut(0.8);
      h.layer = null; h.layerName = '';
    }
    if (this.bodyLayer) this.bodyLayer.fadeOut(0.4);
    this.bodyLayer = null;
    if (this.base.Emerge) this.base.Emerge.fadeOut(0.3);
    const dur = this.playOverride('Death', 0.6);
    this.spineGlowTarget = 0.55;
    return dur || 8;
  }

  socketWorld(name, out = new THREE.Vector3()) {
    const s = this.sockets[name];
    return s ? s.getWorldPosition(out) : out.copy(this.root.position);
  }
  boneWorld(name, out = new THREE.Vector3()) {
    const b = this.bones[name];
    return b ? b.getWorldPosition(out) : out.copy(this.root.position);
  }

  // ---------------------------------------------------------- 毎フレーム
  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const w = this.base.Walk, i = this.base.Idle;
    const ov = this.override;
    if (ov) {
      // 置き換えの動きが終わりに近づいたら（沈む動きは最後まで）通常の歩きへ戻す
      const left = this.overrideEnd - ov.time;
      if (!this.dead && left < 0.9) {
        ov.fadeOut(0.9);
        this.override = null;
      }
    }
    const ovOn = !!this.override;
    const walkW = ovOn ? 0 : clamp(this.speed / (1.6 * this.scale), 0, 1);
    const fadeK = ovOn ? 6 : 3;
    w.setEffectiveWeight(damp(w.getEffectiveWeight(), walkW, fadeK, dt));
    i.setEffectiveWeight(damp(i.getEffectiveWeight(), ovOn ? 0 : 1 - walkW, fadeK, dt));
    w.timeScale = Math.max(0.3, this.speed / (WALK_METERS_PER_SEC * this.scale));
    this.mixer.update(dt);
    // 一回きりの頭の動きが終わったら元に戻す
    for (const k of HEAD_KEYS) {
      const h = this.heads[k];
      if (h.oneShot && h.layer && h.layer.time >= h.layer.getClip().duration - 0.05) this.playHead(k, null, 1, 0.25);
    }
    this.applyAim(dt);
    // 発光
    const gl = this.uniforms.uGlowLevel.value;
    const ks = { R: 'x', C: 'y', L: 'z' };
    for (const k of HEAD_KEYS) {
      const h = this.heads[k];
      h.glow = damp(h.glow, h.glowTarget, 10, dt);
      gl[ks[k]] = h.glow;
      if (h.alive) {
        const em = this.eyeMats[k];
        em.emissive.copy(EYE_COLOR[k]).lerp(HEAD_INFO[k].color, clamp(h.glow, 0, 1));
        em.emissiveIntensity = 7 + h.glow * 10;
        this.mouthMats[k].emissiveIntensity = damp(this.mouthMats[k].emissiveIntensity, h.mouthGlow * 9, 12, dt);
      }
    }
    const sg = this.spineUniforms.uSpineGlow;
    sg.value = damp(sg.value, this.spineGlowTarget, 0.8, dt);
    this.uniforms.uWet.value = Math.max(0, this.uniforms.uWet.value - dt * 0.05);
    this.uniforms.uHitFlash.value = Math.max(0, this.uniforms.uHitFlash.value - dt * 5);
  }

  flash(v = 1) { this.uniforms.uHitFlash.value = Math.min(1.5, this.uniforms.uHitFlash.value + v); }
  setRage(v) { this.uniforms.uRage.value = v; }
  setWet(v) { this.uniforms.uWet.value = Math.max(this.uniforms.uWet.value, v); }

  applyAim(dt) {
    if (this.dead) return;
    this.root.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
    const inv = this.root.quaternion.clone().invert();
    const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const k of HEAD_KEYS) {
      const h = this.heads[k];
      let ty = 0, tp = 0;
      if (h.alive && h.aimTarget && h.aimWeight > 0) {
        this.socketWorld(`HeadHit_${k}`, tmp);
        dir.subVectors(h.aimTarget, tmp).applyQuaternion(inv);
        const yaw = Math.atan2(dir.x, dir.z) - HEAD_INFO[k].restYaw;
        const pitch = Math.atan2(-dir.y, Math.hypot(dir.x, dir.z)) - 5 * DEG;
        const lim = k === 'C' ? [-75, 75] : k === 'L' ? [-35, 85] : [-85, 35];
        ty = clamp(yaw, lim[0] * DEG, lim[1] * DEG) * h.aimWeight;
        tp = clamp(pitch, -45 * DEG, 55 * DEG) * h.aimWeight;
      }
      h.aimYaw = damp(h.aimYaw, ty, 4.5, dt);
      h.aimPitch = damp(h.aimPitch, tp, 4.5, dt);
      if (Math.abs(h.aimYaw) < 1e-4 && Math.abs(h.aimPitch) < 1e-4) continue;
      const parts = [[`neck_${k}1`, 0.32], [`neck_${k}2`, 0.3], [`head_${k}`, 0.38]];
      const fwdYaw = HEAD_INFO[k].restYaw + h.aimYaw;
      const right = new THREE.Vector3(Math.cos(fwdYaw), 0, -Math.sin(fwdYaw)).applyQuaternion(this.root.quaternion);
      for (const [bn, f] of parts) {
        const b = this.bones[bn];
        if (!b) continue;
        const qw = new THREE.Quaternion().setFromAxisAngle(up, h.aimYaw * f)
          .premultiply(new THREE.Quaternion().setFromAxisAngle(right, h.aimPitch * f));
        const pq = new THREE.Quaternion();
        b.parent.getWorldQuaternion(pq);
        const local = pq.clone().invert().multiply(qw).multiply(pq);
        b.quaternion.premultiply(local);
        b.updateMatrixWorld(true);
      }
    }
  }
}
