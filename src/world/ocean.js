// 海面: カメラ追従の極座標グリッド + ゲルストナー波（GPU）
// CPU 側でも同じ波を評価して、船の浮力・傾き・水しぶきの位置合わせに使う。
import * as THREE from 'three';

const G = 9.81;
// [波長(m), 振幅(m), 向きx, 向きz, 尖り具合]
const WAVE_SET = [
  [196, 1.05, 1.00, 0.22, 0.32],
  [121, 0.72, 0.80, 0.62, 0.34],
  [74, 0.44, 0.30, 1.00, 0.40],
  [43, 0.25, -0.40, 0.92, 0.42],
  [27, 0.15, 0.96, -0.28, 0.45],
  [16, 0.08, -0.72, -0.58, 0.48],
  [9.5, 0.045, 0.18, -0.98, 0.5],
  [5.8, 0.025, -0.95, 0.25, 0.5],
];

export class WaveField {
  constructor(scale = 1) {
    this.setScale(scale);
  }
  setScale(scale) {
    this.scale = scale;
    const n = WAVE_SET.length;
    this.waves = WAVE_SET.map(([L, A, dx, dz, steep], i) => {
      const len = Math.hypot(dx, dz);
      const k = (2 * Math.PI) / L;
      const amp = A * scale;
      return {
        dx: dx / len, dz: dz / len, k, A: amp,
        w: Math.sqrt(G * k), Q: amp > 0 ? steep / (k * amp * n) : 0,
        phase: i * 1.731, L,
      };
    });
  }
  // 水平方向のずれを2回の反復で補正した高さ
  heightAt(x, z, t) {
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      let ox = 0, oz = 0;
      for (const w of this.waves) {
        const f = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.phase;
        const c = Math.cos(f) * w.Q * w.A;
        ox += w.dx * c; oz += w.dz * c;
      }
      px = x - ox; pz = z - oz;
    }
    let y = 0;
    for (const w of this.waves) {
      y += w.A * Math.sin(w.k * (w.dx * px + w.dz * pz) - w.w * t + w.phase);
    }
    return y;
  }
  normalAt(x, z, t, out = new THREE.Vector3()) {
    let nx = 0, ny = 1, nz = 0;
    for (const w of this.waves) {
      const f = w.k * (w.dx * x + w.dz * z) - w.w * t + w.phase;
      const WA = w.k * w.A, s = Math.sin(f), c = Math.cos(f);
      nx -= w.dx * WA * c; nz -= w.dz * WA * c; ny -= w.Q * WA * s;
    }
    return out.set(nx, ny, nz).normalize();
  }
}

function makePolarGrid(rings, segs, r0, growth) {
  const radii = [];
  let r = 0, dr = r0;
  for (let i = 0; i < rings; i++) { r += dr; dr *= growth; radii.push(r); }
  const pos = new Float32Array((1 + rings * segs) * 3);
  let p = 3;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos[p++] = Math.cos(a) * radii[i]; pos[p++] = 0; pos[p++] = Math.sin(a) * radii[i];
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs, b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j);
      idx.push(a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const MAXW = 8;

const oceanVert = /* glsl */`
uniform float uTime;
uniform vec4 uWaveA[${MAXW}];
uniform vec4 uWaveB[${MAXW}];
uniform vec3 uCamPos;
uniform vec2 uCenter;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vJac;
varying float vHeight;
void main(){
  vec3 p0 = vec3(position.x + uCenter.x, 0.0, position.z + uCenter.y);
  float dist = length(p0.xz - uCamPos.xz);
  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jac = 1.0;
  for (int i = 0; i < ${MAXW}; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float fade = 1.0 - smoothstep(b.w * 6.0, b.w * 22.0, dist);
    float A = a.w * fade;
    float f = a.z * dot(a.xy, p0.xz) - b.x * uTime + b.z;
    float s = sin(f), c = cos(f);
    float QA = b.y * A;
    disp.x += QA * a.x * c;
    disp.z += QA * a.y * c;
    disp.y += A * s;
    float WA = a.z * A;
    n.x -= a.x * WA * c;
    n.z -= a.y * WA * c;
    n.y -= b.y * WA * s;
    jac -= b.y * WA * s * 1.6;
  }
  vec3 wp = p0 + disp;
  vWorldPos = wp;
  vNormalW = n;
  vJac = jac;
  vHeight = disp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const oceanFrag = /* glsl */`
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform samplerCube uEnv;
uniform float uEnvIntensity;
uniform sampler2D uNormalA;
uniform sampler2D uNormalB;
uniform sampler2D uNoise;
uniform sampler2D uFoamMap;
uniform vec4 uFoamRect;
uniform float uFoamEnabled;
uniform sampler2D uWarnMap;
uniform vec4 uWarnRect;
uniform float uWarnEnabled;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAmbient;
uniform float uDetail;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vJac;
varying float vHeight;

void main(){
  vec3 toCam = uCamPos - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // 細かい波（2層をスクロール）
  vec2 uv1 = vWorldPos.xz / 31.0 + vec2(uTime * 0.021, uTime * 0.009);
  vec2 uv2 = vWorldPos.xz / 83.0 + vec2(-uTime * 0.008, uTime * 0.016);
  vec2 uv3 = vWorldPos.xz / 9.0 + vec2(uTime * 0.04, -uTime * 0.03);
  vec2 s1 = texture2D(uNormalA, uv1).xy * 2.0 - 1.0;
  vec2 s2 = texture2D(uNormalB, uv2).xy * 2.0 - 1.0;
  vec2 s3 = texture2D(uNormalA, uv3).xy * 2.0 - 1.0;
  float fadeNear = exp(-dist / 900.0);
  float fade3 = exp(-dist / 160.0);
  vec2 slope = (s1 * 0.55 + s2 * 0.45) * (0.38 * fadeNear + 0.08) * uDetail + s3 * 0.25 * fade3 * uDetail;
  vec3 N = normalize(vec3(vNormalW.x - slope.x, vNormalW.y, vNormalW.z - slope.y));
  if (dot(N, V) < 0.0) N = normalize(N + V * (-dot(N, V) + 0.02));

  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  fres = mix(fres, 0.7, smoothstep(2500.0, 18000.0, dist) * 0.6);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.01;
  float lod = clamp(dist / 2500.0, 0.0, 1.0) * 5.0 + 0.5;
  vec3 refl = textureLod(uEnv, normalize(R), lod).rgb * uEnvIntensity;

  // 太陽の鏡面反射（遠いほど粗く）
  vec3 H = normalize(uSunDir + V);
  float rough = mix(0.012, 0.09, clamp(dist / 4000.0, 0.0, 1.0));
  float a2 = rough * rough;
  float NdH = max(dot(N, H), 0.0);
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  vec3 spec = uSunColor * uSunIntensity * D * fres * 0.25 * step(0.0, uSunDir.y) * smoothstep(-0.02, 0.06, uSunDir.y);

  // 水そのものの色（深い青＋波頭の透過散乱）
  float crest = clamp(vHeight * 0.45 + 0.45, 0.0, 1.0);
  float sunUp = clamp(uSunDir.y * 2.5, 0.0, 1.0);
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 4.0) * crest * crest;
  float diffuse = max(dot(N, uSunDir), 0.0) * 0.5 + 0.5;
  vec3 body = uDeep * (0.55 + 0.45 * diffuse) * uAmbient + uScatter * (0.18 + 0.45 * crest + 1.6 * sss) * sunUp;

  vec3 col = mix(body, refl, fres) + spec;

  // 泡（波頭の白波＋航跡・しぶきの動的マップ）
  float noiseA = texture2D(uNoise, vWorldPos.xz / 23.0 + vec2(uTime * 0.01, 0.0)).r;
  float noiseB = texture2D(uNoise, vWorldPos.xz / 7.3 - vec2(0.0, uTime * 0.013)).a;
  float whitecap = (1.0 - smoothstep(0.18, 0.42, vJac)) * smoothstep(0.35, 0.75, noiseA);
  float dyn = 0.0;
  if (uFoamEnabled > 0.5) {
    vec2 fuv = (vWorldPos.xz - uFoamRect.xy) / uFoamRect.zw;
    if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
      vec4 fm = texture2D(uFoamMap, fuv);
      dyn = fm.r;
    }
  }
  float pattern = noiseB * 0.6 + noiseA * 0.6;
  float dynC = 1.0 - exp(-dyn * 1.3);
  float dynFoam = dynC * smoothstep(0.25, 0.75, pattern + dynC * 0.45) * (0.75 + 0.25 * noiseA);
  float foam = clamp(whitecap * 0.55 * smoothstep(0.15, 0.85, pattern) + dynFoam, 0.0, 0.92);
  foam *= clamp(1.0 - dist / 9000.0, 0.0, 1.0);
  vec3 skyAmb = textureLod(uEnv, vec3(0.0, 1.0, 0.0), 6.0).rgb;
  vec3 foamCol = vec3(0.92, 0.96, 1.0) * (uSunColor * uSunIntensity * max(uSunDir.y, 0.0) * 0.32 * diffuse + skyAmb * 0.9);
  col = mix(col, foamCol, foam);

  // 大気遠近（フォグ）
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  // 攻撃予告（海面に光る警告）
  if (uWarnEnabled > 0.5) {
    vec2 wuv = (vWorldPos.xz - uWarnRect.xy) / uWarnRect.zw;
    if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) {
      vec3 w = texture2D(uWarnMap, wuv).rgb;
      col += w * (1.0 - fogF * 0.6);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Ocean {
  constructor({ envCube, sunDir, sunColor, sunIntensity, normalA, normalB, noise, preset, quality = 'high' }) {
    this.field = new WaveField(1);
    const segs = quality === 'low' ? 160 : quality === 'medium' ? 224 : 288;
    const rings = quality === 'low' ? 120 : quality === 'medium' ? 140 : 160;
    const growth = quality === 'low' ? 1.058 : quality === 'medium' ? 1.05 : 1.044;
    const r0 = quality === 'low' ? 2.2 : 1.6;
    this.geometry = makePolarGrid(rings, segs, r0, growth);
    const waveA = [], waveB = [];
    for (let i = 0; i < MAXW; i++) { waveA.push(new THREE.Vector4()); waveB.push(new THREE.Vector4()); }
    this.uniforms = {
      uTime: { value: 0 },
      uWaveA: { value: waveA },
      uWaveB: { value: waveB },
      uCamPos: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector2() },
      uSunDir: { value: sunDir },
      uSunColor: { value: sunColor },
      uSunIntensity: { value: sunIntensity },
      uEnv: { value: envCube },
      uEnvIntensity: { value: 1.0 },
      uNormalA: { value: normalA },
      uNormalB: { value: normalB },
      uNoise: { value: noise },
      uFoamMap: { value: null },
      uFoamRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFoamEnabled: { value: 0 },
      uWarnMap: { value: null },
      uWarnRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWarnEnabled: { value: 0 },
      uDeep: { value: new THREE.Color() },
      uScatter: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.0001 },
      uAmbient: { value: 1 },
      uDetail: { value: 1 },
    };
    this.applyPreset(preset);
    this.syncWaves();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: oceanVert, fragmentShader: oceanFrag,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.time = 0;
  }

  applyPreset(p) {
    this.uniforms.uDeep.value.setRGB(...p.deepWater);
    this.uniforms.uScatter.value.setRGB(...p.scatterWater);
    this.uniforms.uFogColor.value.setRGB(...p.horizon);
    this.uniforms.uFogDensity.value = p.fogDensity;
    this.uniforms.uAmbient.value = p.ambient;
  }

  syncWaves() {
    const ws = this.field.waves;
    for (let i = 0; i < MAXW; i++) {
      const w = ws[i];
      if (!w) { this.uniforms.uWaveA.value[i].set(1, 0, 1, 0); this.uniforms.uWaveB.value[i].set(0, 0, 0, 1e6); continue; }
      this.uniforms.uWaveA.value[i].set(w.dx, w.dz, w.k, w.A);
      this.uniforms.uWaveB.value[i].set(w.w, w.Q, w.phase, w.L);
    }
  }

  setFoam(texture, rect) {
    this.uniforms.uFoamMap.value = texture;
    this.uniforms.uFoamRect.value = rect;
    this.uniforms.uFoamEnabled.value = texture ? 1 : 0;
  }

  setWarn(texture, rect) {
    this.uniforms.uWarnMap.value = texture;
    this.uniforms.uWarnRect.value = rect;
    this.uniforms.uWarnEnabled.value = texture ? 1 : 0;
  }

  update(dt, camera) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCamPos.value.copy(camera.position);
    // 中心をカメラ直下（前方寄り）に置く。スナップして揺らぎを減らす。
    const snap = 4;
    this.uniforms.uCenter.value.set(Math.round(camera.position.x / snap) * snap, Math.round(camera.position.z / snap) * snap);
  }

  heightAt(x, z) { return this.field.heightAt(x, z, this.time); }
  normalAt(x, z, out) { return this.field.normalAt(x, z, this.time, out); }
}
