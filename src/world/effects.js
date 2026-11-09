// パーティクル演出（インスタンス描画のビルボード）
// alpha: 煙・しぶき（奥から手前へソート） / add: 炎・火花・光（加算）
import * as THREE from 'three';
import { rand, clamp } from '../core/util.js';

const vert = /* glsl */`
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iData;   // x: size, y: rotation, z: frame, w: stretch
attribute vec3 iVel;
uniform float uCols, uRows;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 corner = position.xy;
  float s = iData.x;
  vec2 q;
  if (iData.w > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    float l = length(vv.xy);
    vec2 dir = l > 1e-4 ? vv.xy / l : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = s * (1.0 + iData.w * l * 0.03);
    q = dir * corner.y * len + perp * corner.x * s * 0.6;
  } else {
    float c = cos(iData.y), sn = sin(iData.y);
    q = vec2(c * corner.x - sn * corner.y, sn * corner.x + c * corner.y) * s;
  }
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  float f = iData.z;
  float col = mod(f, uCols);
  float row = floor(f / uCols);
  vUv = (vec2(col, uRows - 1.0 - row) + (corner + 0.5)) / vec2(uCols, uRows);
  vColor = iColor;
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}`;

const frag = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  vec3 c = vColor.rgb * t.rgb;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(c * a * (1.0 - vFog), 1.0);
  } else {
    gl_FragColor = vec4(mix(c, uFogColor, vFog), a);
  }
}`;

export class ParticleSystem {
  constructor(max, atlas, additive, fogColor, fogDensity) {
    this.max = max;
    this.additive = additive;
    this.count = 0;
    const N = max;
    this.p = new Float32Array(N * 3);
    this.v = new Float32Array(N * 3);
    this.age = new Float32Array(N);
    this.life = new Float32Array(N);
    this.s0 = new Float32Array(N);
    this.s1 = new Float32Array(N);
    this.c0 = new Float32Array(N * 4);
    this.c1 = new Float32Array(N * 4);
    this.rot = new Float32Array(N);
    this.rotV = new Float32Array(N);
    this.frame = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.stretch = new Float32Array(N);
    this.water = new Uint8Array(N);
    this.fadeIn = new Float32Array(N);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aDat = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iData', this.aDat);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: atlas }, uCols: { value: 4 }, uRows: { value: 2 },
        uFogColor: { value: fogColor }, uFogDensity: { value: fogDensity }, uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this._order = new Uint32Array(N);
    this._depth = new Float32Array(N);
    this.budget = 1;
  }

  spawn(o) {
    if (this.count >= this.max * this.budget) return -1;
    const i = this.count++;
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = o.x; this.p[i3 + 1] = o.y; this.p[i3 + 2] = o.z;
    this.v[i3] = o.vx || 0; this.v[i3 + 1] = o.vy || 0; this.v[i3 + 2] = o.vz || 0;
    this.age[i] = 0;
    this.life[i] = o.life || 1;
    this.s0[i] = o.size || 1;
    this.s1[i] = o.size1 !== undefined ? o.size1 : this.s0[i];
    const c = o.color || [1, 1, 1, 1], c1 = o.color1 || c;
    this.c0[i4] = c[0]; this.c0[i4 + 1] = c[1]; this.c0[i4 + 2] = c[2]; this.c0[i4 + 3] = c[3] ?? 1;
    this.c1[i4] = c1[0]; this.c1[i4 + 1] = c1[1]; this.c1[i4 + 2] = c1[2]; this.c1[i4 + 3] = c1[3] ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.28;
    this.rotV[i] = o.rotV ?? (Math.random() - 0.5) * 0.6;
    this.frame[i] = o.frame || 0;
    this.grav[i] = o.grav || 0;
    this.drag[i] = o.drag || 0;
    this.stretch[i] = o.stretch || 0;
    this.water[i] = o.water ? 1 : 0;
    this.fadeIn[i] = o.fadeIn ?? 0.08;
    return i;
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
    for (let k = 0; k < 3; k++) { this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = this.c0[j4 + k]; this.c1[i4 + k] = this.c1[j4 + k]; }
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j]; this.frame[i] = this.frame[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.stretch[i] = this.stretch[j];
    this.water[i] = this.water[j]; this.fadeIn[i] = this.fadeIn[j];
  }

  update(dt, camera, oceanHeight) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= dr; this.v[i3 + 1] = this.v[i3 + 1] * dr - this.grav[i] * dt; this.v[i3 + 2] *= dr;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      if (this.water[i] && this.v[i3 + 1] < 0 && this.p[i3 + 1] < -0.5) { this.kill(i); continue; }
      i++;
    }
    const n = this.count;
    // ソート（不透明系のみ）
    const order = this._order;
    if (!this.additive && n > 1) {
      const e = camera.matrixWorldInverse.elements;
      const depth = this._depth;
      for (let k = 0; k < n; k++) {
        const k3 = k * 3;
        depth[k] = e[2] * this.p[k3] + e[6] * this.p[k3 + 1] + e[10] * this.p[k3 + 2] + e[14];
        order[k] = k;
      }
      const sub = order.subarray(0, n);
      sub.sort((a, b) => depth[a] - depth[b]);
    } else {
      for (let k = 0; k < n; k++) order[k] = k;
    }
    const P = this.aPos.array, Cc = this.aCol.array, D = this.aDat.array, Vv = this.aVel.array;
    for (let k = 0; k < n; k++) {
      const idx = order[k];
      const t = this.age[idx] / this.life[idx];
      const i3 = idx * 3, i4 = idx * 4, k3 = k * 3, k4 = k * 4;
      P[k3] = this.p[i3]; P[k3 + 1] = this.p[i3 + 1]; P[k3 + 2] = this.p[i3 + 2];
      Vv[k3] = this.v[i3]; Vv[k3 + 1] = this.v[i3 + 1]; Vv[k3 + 2] = this.v[i3 + 2];
      const fi = this.fadeIn[idx] > 0 ? clamp(t / this.fadeIn[idx], 0, 1) : 1;
      const env = fi;
      Cc[k4] = this.c0[i4] + (this.c1[i4] - this.c0[i4]) * t;
      Cc[k4 + 1] = this.c0[i4 + 1] + (this.c1[i4 + 1] - this.c0[i4 + 1]) * t;
      Cc[k4 + 2] = this.c0[i4 + 2] + (this.c1[i4 + 2] - this.c0[i4 + 2]) * t;
      Cc[k4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * t) * env;
      const st = 1 - (1 - t) * (1 - t);
      D[k4] = this.s0[idx] + (this.s1[idx] - this.s0[idx]) * st;
      D[k4 + 1] = this.rot[idx];
      D[k4 + 2] = this.frame[idx];
      D[k4 + 3] = this.stretch[idx];
    }
    this.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aDat.needsUpdate = this.aVel.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 3);
    this.aVel.clearUpdateRanges(); this.aVel.addUpdateRange(0, n * 3);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, n * 4);
    this.aDat.clearUpdateRanges(); this.aDat.addUpdateRange(0, n * 4);
  }
}

const F = { SMOKE: 0, SPRAY: 1, FLAME: 2, SPARK: 3, RING: 4, FOAM: 5, GLOW: 6, DEBRIS: 7 };

/** 演出のまとめ役 */
export class Effects {
  constructor(scene, atlas, fogColor, fogDensity, quality = 1) {
    this.alpha = new ParticleSystem(5000, atlas, false, fogColor, fogDensity);
    this.add = new ParticleSystem(4000, atlas, true, fogColor, fogDensity);
    scene.add(this.alpha.mesh, this.add.mesh);
    this.setQuality(quality);
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 900, 1.6);
      l.userData.t = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.sunColor = new THREE.Color(1, 1, 1);
    this.ambient = 1;
    this.foam = null;
    this.emitters = [];
  }
  setQuality(q) { this.q = q; this.alpha.budget = Math.max(0.25, q); this.add.budget = Math.max(0.25, q); }
  setLighting(sunColor, ambient) { this.sunColor.copy(sunColor); this.ambient = ambient; }
  n(base) { return Math.max(1, Math.round(base * this.q)); }

  flashLight(pos, color, intensity, decay = 6) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.intensity < best.intensity) best = l;
    best.position.copy(pos);
    best.color.set(color);
    best.intensity = intensity;
    best.userData.decay = decay;
  }

  smokeColor(k = 0.5) {
    const a = this.ambient;
    return [k * (0.55 * a + 0.35 * this.sunColor.r), k * (0.55 * a + 0.35 * this.sunColor.g), k * (0.58 * a + 0.35 * this.sunColor.b)];
  }

  explosion(pos, scale = 1, opts = {}) {
    const s = scale;
    for (let i = 0; i < this.n(14 * Math.min(2, s)); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 16) * s);
      this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, life: rand(0.35, 0.8), size: rand(6, 12) * s, size1: rand(16, 28) * s,
        color: [9, 4.2, 1.4, 1], color1: [2.0, 0.4, 0.1, 0], frame: F.FLAME, drag: 2.5 });
    }
    for (let i = 0; i < this.n(26 * Math.min(2, s)); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(30, 90) * Math.sqrt(s));
      this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, life: rand(0.5, 1.4), size: rand(0.8, 1.6) * Math.sqrt(s),
        color: [12, 7, 3, 1], color1: [3, 0.6, 0.1, 0], frame: F.SPARK, grav: 18, drag: 0.6, stretch: 2.5, fadeIn: 0 });
    }
    const sc = this.smokeColor(opts.dark ? 0.18 : 0.42);
    for (let i = 0; i < this.n(12 * Math.min(2, s)); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(rand(2, 8) * s);
      this.alpha.spawn({ x: pos.x + d.x * 0.5, y: pos.y + d.y * 0.5, z: pos.z + d.z * 0.5, vx: d.x, vy: d.y + 4 * s, vz: d.z,
        life: rand(2.5, 5) * Math.sqrt(s), size: rand(8, 14) * s, size1: rand(30, 55) * s,
        color: [sc[0], sc[1], sc[2], 0.75], color1: [sc[0] * 1.2, sc[1] * 1.2, sc[2] * 1.2, 0], frame: F.SMOKE, drag: 1.2, fadeIn: 0.05 });
    }
    if (opts.debris !== false) {
      for (let i = 0; i < this.n(10 * Math.min(2, s)); i++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(25, 60) * Math.sqrt(s));
        this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, life: rand(1.5, 3), size: rand(0.8, 2.2) * s,
          color: [0.03, 0.03, 0.03, 1], color1: [0.03, 0.03, 0.03, 1], frame: F.DEBRIS, grav: 22, rotV: rand(-8, 8), water: true, fadeIn: 0 });
      }
    }
    this.flashLight(pos, 0xffa060, 14000 * Math.min(s, 3), 7);
  }

  /** 着弾した水柱（小〜大） */
  splash(pos, scale = 1, opts = {}) {
    const h = opts.height || 18 * scale;
    const v0 = Math.sqrt(2 * 9.81 * h * 1.3);
    const n = this.n(24 * Math.min(3, scale));
    const col = opts.tint || [0.80, 0.84, 0.88];
    const amb = 0.45 + 0.4 * this.ambient;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3 * scale;
      const up = v0 * rand(0.55, 1.05);
      const out = rand(0.5, 3.5) * scale;
      this.alpha.spawn({ x: pos.x + Math.cos(a) * r, y: pos.y, z: pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out, life: rand(1.6, 2.8) * Math.sqrt(scale) * 0.9 + 0.5,
        size: rand(3, 7) * scale, size1: rand(10, 18) * scale,
        color: [col[0] * amb, col[1] * amb, col[2] * amb, 0.85], color1: [col[0] * amb, col[1] * amb, col[2] * amb, 0], frame: F.SPRAY, grav: 9.81, drag: 0.35, water: false, fadeIn: 0.02 });
    }
    for (let i = 0; i < this.n(8 * Math.min(3, scale)); i++) {
      const a = Math.random() * Math.PI * 2;
      this.alpha.spawn({ x: pos.x, y: pos.y + rand(0, h * 0.6), z: pos.z, vx: Math.cos(a) * rand(2, 6) * scale, vy: rand(1, 4), vz: Math.sin(a) * rand(2, 6) * scale,
        life: rand(3, 6), size: rand(8, 14) * scale, size1: rand(25, 45) * scale,
        color: [amb * 0.9, amb * 0.93, amb, 0.35], color1: [amb, amb, amb, 0], frame: F.SMOKE, drag: 0.8 });
    }
    if (this.foam) this.foam.addDecal(pos.x, pos.z, 14 * scale + h * 0.3, 1.0, 9 + scale * 3);
  }

  /** 巨大な水柱（魚雷・赤いビーム・しっぽ） */
  waterColumn(pos, height = 90, width = 14) {
    const v0 = Math.sqrt(2 * 9.81 * height);
    const amb = (0.45 + 0.4 * this.ambient) * 0.9;
    for (let i = 0; i < this.n(70); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * width * 0.5;
      const k = rand(0.4, 1.0);
      this.alpha.spawn({ x: pos.x + Math.cos(a) * r, y: pos.y, z: pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(0.5, 5), vy: v0 * k, vz: Math.sin(a) * rand(0.5, 5),
        life: (2 * v0 * k) / 9.81 * 0.9 + rand(0.2, 0.8), size: rand(6, 12) * width / 14, size1: rand(18, 30) * width / 14,
        color: [amb, amb, amb, 0.9], color1: [amb, amb, amb, 0], frame: F.SPRAY, grav: 9.81, drag: 0.2, fadeIn: 0.02 });
    }
    for (let i = 0; i < this.n(16); i++) {
      this.alpha.spawn({ x: pos.x + rand(-width, width), y: pos.y + rand(0, height * 0.8), z: pos.z + rand(-width, width),
        vx: rand(-4, 4), vy: rand(0, 6), vz: rand(-4, 4), life: rand(4, 8), size: rand(15, 25), size1: rand(45, 80),
        color: [amb * 0.95, amb * 0.97, amb, 0.3], color1: [amb, amb, amb, 0], frame: F.SMOKE, drag: 0.5 });
    }
    if (this.foam) this.foam.addDecal(pos.x, pos.z, width * 4, 1.2, 14);
  }

  /** 機関砲弾の小さな着水しぶき（大量に出るので軽く） */
  bulletSplash(pos) {
    const amb = 0.45 + 0.4 * this.ambient;
    for (let i = 0; i < 3; i++) {
      this.alpha.spawn({ x: pos.x + rand(-1, 1), y: 0.3, z: pos.z + rand(-1, 1), vx: rand(-1.5, 1.5), vy: rand(6, 13), vz: rand(-1.5, 1.5),
        life: rand(0.8, 1.3), size: rand(1.2, 2.2), size1: rand(3.5, 6), color: [amb * 0.85, amb * 0.88, amb * 0.92, 0.8], color1: [amb, amb, amb, 0], frame: F.SPRAY, grav: 9.81, drag: 0.3, fadeIn: 0.02 });
    }
  }

  /** 体から流れ落ちる海水（怪獣が海から立ち上がる時など）。vel は体の動き */
  pour(pos, scale = 1, vel = null) {
    const amb = (0.45 + 0.4 * this.ambient) * 0.95;
    for (let i = 0; i < this.n(3); i++) {
      this.alpha.spawn({ x: pos.x + rand(-3, 3) * scale, y: pos.y, z: pos.z + rand(-3, 3) * scale,
        vx: (vel ? vel.x : 0) + rand(-2.5, 2.5), vy: (vel ? vel.y * 0.5 : 0) + rand(-2, 1), vz: (vel ? vel.z : 0) + rand(-2.5, 2.5),
        life: rand(1.4, 2.6), size: rand(2, 4) * scale, size1: rand(7, 13) * scale,
        color: [amb, amb, amb, 0.7], color1: [amb, amb, amb, 0], frame: F.SPRAY, grav: 9.81, drag: 0.1, water: true, fadeIn: 0.05 });
    }
  }

  /** 海中から上がってくる泡（沈んでいく怪獣など） */
  bubbles(pos, radius = 10, scale = 1) {
    const amb = (0.55 + 0.4 * this.ambient);
    for (let i = 0; i < this.n(4); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      this.alpha.spawn({ x: pos.x + Math.cos(a) * r, y: 0.5, z: pos.z + Math.sin(a) * r,
        vx: rand(-1, 1), vy: rand(2, 6) * scale, vz: rand(-1, 1), life: rand(0.6, 1.4), size: rand(2, 4) * scale, size1: rand(6, 11) * scale,
        color: [amb, amb, amb, 0.65], color1: [amb, amb, amb, 0], frame: F.SPRAY, grav: 6, drag: 0.5, fadeIn: 0.02 });
    }
    if (this.foam && Math.random() < 0.5) this.foam.addDecal(pos.x + rand(-radius, radius) * 0.6, pos.z + rand(-radius, radius) * 0.6, 10 + radius * 0.5, 0.7, 5, 1.0);
  }

  steam(pos, scale = 1) {
    const amb = 0.6 + 0.4 * this.ambient;
    for (let i = 0; i < this.n(6); i++) {
      this.alpha.spawn({ x: pos.x + rand(-4, 4) * scale, y: pos.y + rand(0, 3), z: pos.z + rand(-4, 4) * scale,
        vx: rand(-3, 3), vy: rand(8, 22), vz: rand(-3, 3), life: rand(1.5, 3.5), size: rand(6, 10) * scale, size1: rand(22, 40) * scale,
        color: [amb, amb, amb, 0.5], color1: [amb, amb, amb, 0], frame: F.SMOKE, drag: 0.9 });
    }
  }

  muzzleFlash(pos, dir, scale = 1) {
    for (let i = 0; i < 5; i++) {
      const k = i / 5;
      this.add.spawn({ x: pos.x + dir.x * k * 6 * scale, y: pos.y + dir.y * k * 6 * scale, z: pos.z + dir.z * k * 6 * scale,
        vx: dir.x * 30, vy: dir.y * 30, vz: dir.z * 30, life: 0.12, size: (5 - i * 0.6) * scale, size1: (7 - i) * scale,
        color: [12, 7, 3, 1], color1: [4, 1, 0.2, 0], frame: F.GLOW, fadeIn: 0 });
    }
    const sc = this.smokeColor(0.55);
    for (let i = 0; i < this.n(6); i++) {
      this.alpha.spawn({ x: pos.x + dir.x * 4, y: pos.y + dir.y * 4, z: pos.z + dir.z * 4,
        vx: dir.x * rand(10, 25) + rand(-2, 2), vy: dir.y * rand(10, 25) + rand(0, 3), vz: dir.z * rand(10, 25) + rand(-2, 2),
        life: rand(1.5, 3), size: rand(2, 4) * scale, size1: rand(9, 16) * scale,
        color: [sc[0], sc[1], sc[2], 0.55], color1: [sc[0], sc[1], sc[2], 0], frame: F.SMOKE, drag: 1.6 });
    }
    this.flashLight(pos, 0xffb070, 6000 * scale, 18);
  }

  sparks(pos, normal, count = 6, color = [10, 6, 2]) {
    for (let i = 0; i < this.n(count); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().add(normal).normalize().multiplyScalar(rand(20, 60));
      this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, life: rand(0.2, 0.5), size: rand(0.5, 1.0),
        color: [...color, 1], color1: [color[0] * 0.3, color[1] * 0.2, color[2] * 0.1, 0], frame: F.SPARK, grav: 15, stretch: 3, fadeIn: 0 });
    }
  }

  hitPuff(pos, scale = 1) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.18, size: 6 * scale, size1: 10 * scale, color: [10, 6, 2.5, 1], color1: [3, 1, 0.2, 0], frame: F.GLOW, fadeIn: 0 });
    const sc = this.smokeColor(0.3);
    this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(2, 6), vz: rand(-2, 2), life: rand(1.2, 2.2), size: 4 * scale, size1: 14 * scale,
      color: [sc[0], sc[1], sc[2], 0.6], color1: [sc[0], sc[1], sc[2], 0], frame: F.SMOKE, drag: 1.5 });
  }

  smokeTrail(pos, scale = 1, dark = false) {
    const sc = this.smokeColor(dark ? 0.12 : 0.6);
    this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-1, 1), vy: rand(0, 2), vz: rand(-1, 1), life: rand(1.5, 3) * scale, size: 2.5 * scale, size1: 10 * scale,
      color: [sc[0], sc[1], sc[2], 0.5], color1: [sc[0], sc[1], sc[2], 0], frame: F.SMOKE, drag: 0.8 });
  }

  fire(pos, scale = 1) {
    this.add.spawn({ x: pos.x + rand(-2, 2) * scale, y: pos.y, z: pos.z + rand(-2, 2) * scale, vx: rand(-1, 1), vy: rand(4, 10) * scale, vz: rand(-1, 1),
      life: rand(0.5, 1.0), size: rand(3, 6) * scale, size1: rand(1, 2) * scale, color: [7, 2.6, 0.7, 1], color1: [2, 0.3, 0.05, 0], frame: F.FLAME, fadeIn: 0.1 });
    if (Math.random() < 0.5) {
      const sc = this.smokeColor(0.07);
      this.alpha.spawn({ x: pos.x, y: pos.y + 4 * scale, z: pos.z, vx: rand(-2, 2), vy: rand(6, 12), vz: rand(-2, 2), life: rand(4, 8), size: 6 * scale, size1: 30 * scale,
        color: [sc[0], sc[1], sc[2], 0.7], color1: [sc[0] * 2, sc[1] * 2, sc[2] * 2, 0], frame: F.SMOKE, drag: 0.3 });
    }
  }

  glow(pos, color, size, life = 0.2) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life, size, size1: size * 1.2, color: [...color, 1], color1: [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, 0], frame: F.GLOW, fadeIn: 0 });
  }

  ring(pos, color, size0, size1, life = 0.6) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life, size: size0, size1, rot: 0, rotV: 0, color: [...color, 1], color1: [...color, 0], frame: F.RING, fadeIn: 0 });
  }

  /** 毎フレーム呼ぶ継続エミッター（燃える船など） */
  addEmitter(fn, duration = Infinity) { const e = { fn, t: 0, duration }; this.emitters.push(e); return e; }
  removeEmitter(e) { const i = this.emitters.indexOf(e); if (i >= 0) this.emitters.splice(i, 1); }

  update(dt, camera) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (e.t > e.duration || e.fn(dt, e.t) === false) this.emitters.splice(i, 1);
    }
    this.alpha.update(dt, camera);
    this.add.update(dt, camera);
    for (const l of this.lights) {
      if (l.intensity > 0) {
        l.intensity *= Math.exp(-(l.userData.decay || 6) * dt);
        if (l.intensity < 5) l.intensity = 0;
      }
    }
  }
}
export { F as FRAME };
