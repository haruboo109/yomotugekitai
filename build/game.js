/* ヨモツ — ファイルから直接開く版のゲーム本体（tools/build_standalone.py が自動生成。編集しないでください。元は src/） */
(function () {
'use strict';
window.__YOMOTSU_BUILD = "2026-11-09 19:27";
const __DEPS = window.__YOMOTSU_DEPS;
const __mod = {};
// ==== src/core/renderer.js
__mod["src/core/renderer.js"] = (function () {
// 描画パイプライン: HDRレンダリング → ブルーム → トーンマップ・色調補正・ビネット・グレイン
const THREE = __DEPS["three"];
const { EffectComposer } = __DEPS["three/addons/postprocessing/EffectComposer.js"];
const { RenderPass } = __DEPS["three/addons/postprocessing/RenderPass.js"];
const { UnrealBloomPass } = __DEPS["three/addons/postprocessing/UnrealBloomPass.js"];
const { ShaderPass } = __DEPS["three/addons/postprocessing/ShaderPass.js"];

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 0.92 },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uAberration: { value: 0.0 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.07 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uDanger: { value: 0 },
    uDangerColor: { value: new THREE.Color(1, 0.1, 0.05) },
    uFade: { value: 0 },
    uTV: { value: 0 },        // テレビ中継の映像らしさ（走査線・にじみ・色）
    uGlitch: { value: 0 },    // 電波の乱れ
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure, uTime, uVignette, uGrain, uAberration, uSaturation, uContrast, uFlash, uDanger, uFade, uTV, uGlitch;
    uniform vec3 uTint, uFlashColor, uDangerColor;
    uniform vec2 uTexel;
    varying vec2 vUv;

    // ACES (Stephen Hill のフィット)
    vec3 RRTAndODTFit(vec3 v){
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color){
      const mat3 ACESInputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(
        vec3(1.60475, -0.10208, -0.00327),
        vec3(-0.53108, 1.10813, -0.07276),
        vec3(-0.07367, -0.00605, 1.07602));
      color = ACESInputMat * color;
      color = RRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      // 電波の乱れ: 横の帯ごとにずれる
      if (uGlitch > 0.001) {
        float fr = floor(uTime * 24.0);
        float band = floor(uv.y * 34.0);
        float h = hash(vec2(band, fr));
        uv.x += (h - 0.5) * 0.09 * uGlitch * step(0.55, h);
        uv.y += (hash(vec2(fr, 3.1)) - 0.5) * 0.01 * uGlitch;
      }
      vec2 d = uv - 0.5;
      float ca = uAberration * 0.006 + 0.0004 + uTV * 0.0022 + uGlitch * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - d * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + d * ca).b;
      if (uTV > 0.001) {
        // テレビカメラの映像の柔らかさ
        vec3 bl = texture2D(tDiffuse, uv + uTexel).rgb + texture2D(tDiffuse, uv - uTexel).rgb
                + texture2D(tDiffuse, uv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tDiffuse, uv - vec2(uTexel.x, -uTexel.y)).rgb;
        col = mix(col, bl * 0.25, 0.4 * uTV);
      }
      col *= uExposure * 0.8 * uTint;
      col = aces(col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col = clamp(col, 0.0, 1.0);
      float r = length(d * vec2(1.0, 0.85));
      float vig = 1.0 - smoothstep(0.28, 0.85, r);
      col *= mix(1.0 - uVignette, 1.0, vig);
      // 危険時の赤い縁取り
      col = mix(col, uDangerColor, uDanger * smoothstep(0.35, 0.8, r) * 0.55);
      col = mix(col, uFlashColor, uFlash);
      if (uTV > 0.001) {
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lum), 0.16 * uTV);             // 彩度を少し落とす
        col *= mix(vec3(1.0), vec3(0.97, 1.0, 1.04), uTV);  // わずかに青み
        col = (col - 0.5) * (1.0 + 0.1 * uTV) + 0.5;
        float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159);
        col *= 1.0 - uTV * 0.075 * scan;                    // 走査線
        col = clamp(col, 0.0, 1.0);
      }
      col = toSRGB(col);
      col += (hash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.13)) - 0.5) * (uGrain + uTV * 0.03 + uGlitch * 0.12);
      if (uGlitch > 0.001) {
        float blk = step(0.82, hash(vec2(floor(vUv.y * 60.0), floor(uTime * 30.0))));
        col = mix(col, vec3(hash(vUv * vec2(400.0, 300.0) + uTime)), uGlitch * 0.35 * blk);
      }
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ブルームの前に HDR 値を安全な範囲へ。NaN/Inf が1画素でもあると、ブルームのぼかしで画面全体が真っ黒になるため
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 400.0), 1.0);
    }`,
};

const QUALITY_LEVELS = {
  ultra: { pixelRatio: 1.0, maxDpr: 2.0, msaa: 4, shadows: 4096, bloom: true, bloomScale: 0.5, particles: 1.0, ocean: 'high', foam: 1024 },
  high: { pixelRatio: 1.0, maxDpr: 1.5, msaa: 4, shadows: 2048, bloom: true, bloomScale: 0.5, particles: 1.0, ocean: 'high', foam: 1024 },
  medium: { pixelRatio: 0.85, maxDpr: 1.25, msaa: 2, shadows: 1024, bloom: true, bloomScale: 0.4, particles: 0.65, ocean: 'medium', foam: 512 },
  low: { pixelRatio: 0.7, maxDpr: 1.0, msaa: 0, shadows: 0, bloom: true, bloomScale: 0.3, particles: 0.4, ocean: 'low', foam: 512 },
};

class RenderPipeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.qualityName = 'high';
    this.quality = QUALITY_LEVELS.high;
    this.scene = null;
    this.camera = null;
    this.composer = null;
  }

  init(scene, camera, qualityName = 'high') {
    this.scene = scene;
    this.camera = camera;
    this.setQuality(qualityName, true);
  }

  setQuality(name, force = false) {
    if (!force && name === this.qualityName && this.composer) return;
    this.qualityName = name;
    this.quality = QUALITY_LEVELS[name] || QUALITY_LEVELS.high;
    const q = this.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.pixelRatio;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const gl2 = this.renderer.capabilities.isWebGL2;
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: gl2 ? this.quality.msaa : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    const bs = this.quality.bloomScale;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), 0.62, 0.55, 0.92);
    this.bloom.enabled = this.quality.bloom;
    this.composer.addPass(this.bloom);
    const prevUniforms = this.finalPass ? this.finalPass.uniforms : null;
    this.finalPass = new ShaderPass(FinalShader);
    if (prevUniforms) {
      for (const k of Object.keys(prevUniforms)) {
        if (k === 'tDiffuse') continue;
        const v = prevUniforms[k].value;
        this.finalPass.uniforms[k].value = v && v.clone ? v.clone() : v;
      }
    }
    this.composer.addPass(this.finalPass);
  }

  get post() { return this.finalPass.uniforms; }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      const bs = this.quality.bloomScale;
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      if (this.bloom) this.bloom.resolution.set(size.x * bs, size.y * bs);
      this.post.uTexel.value.set(1.2 / Math.max(1, size.x), 1.2 / Math.max(1, size.y));
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt) {
    this.renderer.info.reset();
    this.post.uTime.value += dt;
    this.composer.render(dt);
  }
}
return { QUALITY_LEVELS, RenderPipeline };
})();

// ==== src/world/sky.js
__mod["src/world/sky.js"] = (function () {
// 空（大気のグラデーション＋太陽＋雲）をキューブマップに焼き、背景と環境光（IBL）に使う
const THREE = __DEPS["three"];

const SKY_PRESETS = {
  day: {
    label: '昼',
    sunElev: 30, sunAzim: 62,
    zenith: [0.085, 0.215, 0.50], horizon: [0.60, 0.70, 0.80], ground: [0.10, 0.13, 0.16],
    sunColor: [1.0, 0.94, 0.85], sunIntensity: 3.4, sunDisk: 30,
    cloudLit: [1.05, 1.03, 1.0], cloudShadow: [0.42, 0.48, 0.56], cloudCover: 0.50, cloudDensity: 0.92,
    haze: 0.85, fogDensity: 0.000105, exposure: 1.0,
    deepWater: [0.006, 0.030, 0.052], scatterWater: [0.020, 0.150, 0.175],
    ambient: 1.0,
  },
  dusk: {
    label: '夕暮れ',
    sunElev: 7.5, sunAzim: 118,
    zenith: [0.06, 0.10, 0.24], horizon: [0.95, 0.56, 0.34], ground: [0.08, 0.06, 0.07],
    sunColor: [1.0, 0.56, 0.28], sunIntensity: 2.6, sunDisk: 22,
    cloudLit: [1.25, 0.66, 0.42], cloudShadow: [0.22, 0.17, 0.26], cloudCover: 0.55, cloudDensity: 0.95,
    haze: 1.0, fogDensity: 0.000125, exposure: 1.1,
    deepWater: [0.006, 0.016, 0.034], scatterWater: [0.060, 0.070, 0.090],
    ambient: 0.8,
  },
  night: {
    label: '夜',
    sunElev: 26, sunAzim: 40, // 月
    zenith: [0.008, 0.016, 0.040], horizon: [0.060, 0.080, 0.125], ground: [0.012, 0.015, 0.025],
    sunColor: [0.60, 0.70, 1.0], sunIntensity: 1.1, sunDisk: 9,
    cloudLit: [0.16, 0.19, 0.26], cloudShadow: [0.02, 0.026, 0.042], cloudCover: 0.45, cloudDensity: 0.9,
    haze: 0.6, fogDensity: 0.00010, exposure: 1.9,
    deepWater: [0.004, 0.010, 0.018], scatterWater: [0.012, 0.028, 0.040],
    ambient: 0.5, stars: true,
  },
};

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudShadow;
uniform float uSunIntensity, uSunDisk, uCloudCover, uCloudDensity, uHaze, uStars;
uniform sampler2D uNoise;
varying vec3 vDir;

float fbm(vec2 p){
  float f = 0.0, a = 0.5;
  for(int i=0;i<6;i++){
    f += a * texture2D(uNoise, p).g;
    p = p * 2.07 + vec2(0.137, 0.291);
    a *= 0.5;
  }
  return f / 0.984;
}
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }

vec3 atmosphere(vec3 dir){
  float y = dir.y;
  float h = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  col = mix(col, uHorizon * 1.06, exp(-max(y, 0.0) * 14.0) * uHaze);
  float c = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(c, 5.0) * 0.22 + pow(c, 64.0) * 0.8) * uSunIntensity * 0.3;
  if (y < 0.0) col = mix(uHorizon * 0.92, uGround, clamp(-y * 5.0, 0.0, 1.0));
  return col;
}

void main(){
  vec3 dir = normalize(vDir);
  vec3 col = atmosphere(dir);
  float cosT = dot(dir, uSunDir);
  // 太陽（月）ディスク
  float disk = smoothstep(0.99975, 0.99988, cosT);
  col += uSunColor * disk * uSunIntensity * uSunDisk;

  if (uStars > 0.5 && dir.y > 0.0) {
    vec3 sp = floor(dir * 420.0);
    float s = hash(sp);
    col += vec3(0.9, 0.95, 1.0) * step(0.9975, s) * (0.6 + 2.0 * fract(s * 91.7)) * smoothstep(0.02, 0.25, dir.y) * 0.25;
  }

  if (dir.y > 0.0) {
    // 雲層（高度一定の平面に投影）
    float t = 1.0 / max(dir.y + 0.035, 0.035);
    vec2 uv = dir.xz * t * 0.055;
    float n = fbm(uv);
    float edge0 = 1.0 - uCloudCover;
    float cov = smoothstep(edge0, edge0 + 0.22, n);
    float n2 = fbm(uv + uSunDir.xz * 0.045);
    float shade = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
    float thick = smoothstep(edge0, edge0 + 0.5, n);
    vec3 cloud = mix(uCloudLit, uCloudShadow, thick * 0.85);
    cloud = mix(cloud * 0.8, cloud * 1.15, shade);
    cloud += uSunColor * pow(max(cosT, 0.0), 10.0) * (1.0 - thick) * 1.2 * uSunIntensity * 0.25;
    float fade = smoothstep(0.0, 0.10, dir.y);
    // 地平線付近の雲の帯（遠くの積雲）
    float az = atan(dir.z, dir.x);
    float band = fbm(vec2(az * 1.6, dir.y * 9.0) * 0.35);
    float bandMask = smoothstep(0.55, 0.75, band) * (1.0 - smoothstep(0.0, 0.09 * band + 0.02, dir.y)) * smoothstep(-0.01, 0.006, dir.y);
    vec3 bandCol = mix(uCloudShadow, uCloudLit, 0.35 + 0.65 * clamp(band * 1.2 - 0.3 + pow(max(cosT,0.0), 3.0), 0.0, 1.0));
    col = mix(col, bandCol, bandMask * 0.85 * uCloudDensity);
    col = mix(col, cloud, cov * fade * uCloudDensity);
    // 霞
    col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.05, dir.y)) * 0.35 * uHaze);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

class Sky {
  constructor(renderer, noiseTex, presetName = 'day', size = 1024) {
    this.renderer = renderer;
    this.preset = SKY_PRESETS[presetName] || SKY_PRESETS.day;
    this.sunDir = new THREE.Vector3();
    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudShadow: { value: new THREE.Color() },
      uSunIntensity: { value: 1 },
      uSunDisk: { value: 30 },
      uCloudCover: { value: 0.5 },
      uCloudDensity: { value: 1 },
      uHaze: { value: 1 },
      uStars: { value: 0 },
      uNoise: { value: noiseTex },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.skyScene = new THREE.Scene();
    this.skyScene.add(this.mesh);

    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.skyScene.add(this.cubeCam);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.apply(presetName);
  }

  apply(presetName) {
    const p = SKY_PRESETS[presetName] || SKY_PRESETS.day;
    this.preset = p;
    const el = THREE.MathUtils.degToRad(p.sunElev), az = THREE.MathUtils.degToRad(p.sunAzim);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const u = this.uniforms;
    u.uZenith.value.setRGB(...p.zenith);
    u.uHorizon.value.setRGB(...p.horizon);
    u.uGround.value.setRGB(...p.ground);
    u.uSunColor.value.setRGB(...p.sunColor);
    u.uCloudLit.value.setRGB(...p.cloudLit);
    u.uCloudShadow.value.setRGB(...p.cloudShadow);
    u.uSunIntensity.value = p.sunIntensity;
    u.uSunDisk.value = p.sunDisk;
    u.uCloudCover.value = p.cloudCover;
    u.uCloudDensity.value = p.cloudDensity;
    u.uHaze.value = p.haze;
    u.uStars.value = p.stars ? 1 : 0;
    this.render();
  }

  render() {
    this.cubeCam.update(this.renderer, this.skyScene);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
  }

  get background() { return this.cubeRT.texture; }
  get environment() { return this.envRT.texture; }
  get horizonColor() { return this.uniforms.uHorizon.value; }
}
return { SKY_PRESETS, Sky };
})();

// ==== src/world/ocean.js
__mod["src/world/ocean.js"] = (function () {
// 海面: カメラ追従の極座標グリッド + ゲルストナー波（GPU）
// CPU 側でも同じ波を評価して、船の浮力・傾き・水しぶきの位置合わせに使う。
const THREE = __DEPS["three"];

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

class WaveField {
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

class Ocean {
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
return { WaveField, Ocean };
})();

// ==== src/world/proceduralTextures.js
__mod["src/world/proceduralTextures.js"] = (function () {
// 実行時に生成するタイル可能なテクスチャ（外部画像ファイル不要）
// - 海面の細かい波の法線マップ（スペクトル＋逆FFT）
// - 泡用ノイズ
// - パーティクル用スプライト（煙・しぶき・炎・火花・リング）
const THREE = __DEPS["three"];

function fftLine(re, im, n, inv) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inv ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function fft2d(re, im, n, inv) {
  const lr = new Float64Array(n), li = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    const o = y * n;
    for (let x = 0; x < n; x++) { lr[x] = re[o + x]; li[x] = im[o + x]; }
    fftLine(lr, li, n, inv);
    for (let x = 0; x < n; x++) { re[o + x] = lr[x]; im[o + x] = li[x]; }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { lr[y] = re[y * n + x]; li[y] = im[y * n + x]; }
    fftLine(lr, li, n, inv);
    for (let y = 0; y < n; y++) { re[y * n + x] = lr[y]; im[y * n + x] = li[y]; }
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// スペクトルからタイル可能な高さ場を作る
function spectralField(n, seed, { power = 2.0, kMin = 1, kMax = n / 2, dir = null, dirStrength = 0 }) {
  const rand = mulberry32(seed);
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const ky = y <= n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const kx = x <= n / 2 ? x : x - n;
      const k = Math.hypot(kx, ky);
      if (k < kMin || k > kMax) continue;
      let amp = Math.pow(k, -power);
      if (dir && dirStrength > 0) {
        const c = (kx * dir[0] + ky * dir[1]) / k;
        amp *= (1 - dirStrength) + dirStrength * c * c;
      }
      amp *= Math.exp(-(k * k) / (kMax * kMax * 0.6));
      re[y * n + x] = gaussian(rand) * amp;
      im[y * n + x] = gaussian(rand) * amp;
    }
  }
  fft2d(re, im, n, true);
  return re; // 実部のみ使う
}

function normalizeField(f) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
  const s = 1 / (mx - mn || 1);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) * s;
  return f;
}

/** 海面ディテール法線: R,G = 傾き(x,z)、B = 高さ */
function makeWaterNormalTexture(n = 256, seed = 7, dir = [1, 0.35]) {
  const h = normalizeField(spectralField(n, seed, { power: 1.9, kMin: 1, kMax: n / 2.2, dir, dirStrength: 0.55 }));
  const data = new Uint8Array(n * n * 4);
  let maxS = 0;
  const sx = new Float32Array(n * n), sz = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const xl = h[y * n + ((x - 1 + n) % n)], xr = h[y * n + ((x + 1) % n)];
      const yu = h[((y - 1 + n) % n) * n + x], yd = h[((y + 1) % n) * n + x];
      const a = (xr - xl), b = (yd - yu);
      sx[y * n + x] = a; sz[y * n + x] = b;
      maxS = Math.max(maxS, Math.abs(a), Math.abs(b));
    }
  }
  const k = 0.98 / (maxS || 1);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = Math.round((sx[i] * k * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((sz[i] * k * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(h[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** 泡・汎用ノイズ（R: 細かい, G: 中, B: 粗い, A: セル状） */
function makeNoiseTexture(n = 256, seed = 11) {
  const a = normalizeField(spectralField(n, seed, { power: 1.1, kMin: 2, kMax: n / 2 }));
  const b = normalizeField(spectralField(n, seed + 1, { power: 1.6, kMin: 1, kMax: n / 4 }));
  const c = normalizeField(spectralField(n, seed + 2, { power: 2.2, kMin: 1, kMax: n / 8 }));
  // セル状（ボロノイ）
  const rand = mulberry32(seed + 3);
  const cells = 12, pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([(i % cells + rand()) / cells, (Math.floor(i / cells) + rand()) / cells]);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const cx = Math.floor(u * cells), cy = Math.floor(v * cells);
      let d1 = 9, d2 = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = (cx + ox + cells) % cells, gy = (cy + oy + cells) % cells;
        const p = pts[gy * cells + gx];
        let dx = p[0] + (cx + ox - ((cx + ox + cells) % cells)) / cells - u;
        let dy = p[1] + (cy + oy - ((cy + oy + cells) % cells)) / cells - v;
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const i = (y * n + x) * 4;
      data[i] = a[y * n + x] * 255;
      data[i + 1] = b[y * n + x] * 255;
      data[i + 2] = c[y * n + x] * 255;
      data[i + 3] = Math.min(255, (d2 - d1) * cells * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** パーティクル用スプライトアトラス(4x2): 0 煙, 1 しぶき, 2 炎, 3 火花, 4 リング, 5 泡, 6 光球, 7 破片 */
function makeParticleAtlas(size = 1024) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size / 2;
  const g = cv.getContext('2d');
  const cell = size / 4;
  const rand = mulberry32(99);
  const cellCenter = (i) => [(i % 4) * cell + cell / 2, Math.floor(i / 4) * cell + cell / 2];

  // 0: 煙（もこもこした塊）
  {
    const [cx, cy] = cellCenter(0);
    for (let i = 0; i < 46; i++) {
      const r = cell * (0.08 + rand() * 0.16);
      const ang = rand() * Math.PI * 2, dist = rand() * cell * 0.22;
      const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.20)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  // 1: しぶき（細かい水滴の集まり）
  {
    const [cx, cy] = cellCenter(1);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.45);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    for (let i = 0; i < 260; i++) {
      const ang = rand() * Math.PI * 2, dist = Math.pow(rand(), 0.7) * cell * 0.44;
      const r = 0.6 + rand() * 2.2;
      g.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`;
      g.beginPath(); g.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2); g.fill();
    }
  }
  // 2: 炎
  {
    const [cx, cy] = cellCenter(2);
    for (let i = 0; i < 30; i++) {
      const r = cell * (0.06 + rand() * 0.14);
      const x = cx + (rand() - 0.5) * cell * 0.3, y = cy + (rand() - 0.5) * cell * 0.3;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  // 3: 火花（細長い光）
  {
    const [cx, cy] = cellCenter(3);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.15)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(cx, cy); g.scale(1, 0.18); g.translate(-cx, -cy);
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, cell * 0.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // 4: リング（衝撃波）
  {
    const [cx, cy] = cellCenter(4);
    const gr = g.createRadialGradient(cx, cy, cell * 0.30, cx, cy, cell * 0.48);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, cell * 0.5, 0, Math.PI * 2); g.fill();
  }
  // 5: 泡（白波の塊、中が抜けたまだら）
  {
    const [cx, cy] = cellCenter(5);
    for (let i = 0; i < 400; i++) {
      const ang = rand() * Math.PI * 2, dist = Math.sqrt(rand()) * cell * 0.45;
      const r = 1 + rand() * 5;
      g.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.35})`;
      g.beginPath(); g.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2); g.fill();
    }
  }
  // 6: 光球
  {
    const [cx, cy] = cellCenter(6);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
  }
  // 7: 破片（不規則な多角形）
  {
    const [cx, cy] = cellCenter(7);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    const k = 7;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2, r = cell * (0.18 + rand() * 0.22);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
return { mulberry32, makeWaterNormalTexture, makeNoiseTexture, makeParticleAtlas };
})();

// ==== src/world/foam.js
__mod["src/world/foam.js"] = (function () {
// 海面の泡マップ: 航跡・しぶき跡・怪獣の足元の泡を、真上から見た RT に描いて海シェーダーで使う
const THREE = __DEPS["three"];
const { mulberry32 } = __mod["src/world/proceduralTextures.js"];

function makeFoamSprite(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rand = mulberry32(5);
  const c = size / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = rand() * c * 0.8;
    g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.35})`;
    g.beginPath();
    g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 2 + rand() * 9, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeRingSprite(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  const gr = g.createRadialGradient(c, c, c * 0.45, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const trailVert = /* glsl */`
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;
void main(){ vAlpha = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const trailFrag = /* glsl */`
varying float vAlpha;
varying vec2 vUv;
void main(){
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = vAlpha * smoothstep(0.0, 0.45, edge);
  gl_FragColor = vec4(a, a, a, 1.0);
}`;

/** 航跡（中央の白い帯＋左右に広がるケルビン波） */
class Trail {
  constructor(foam, opts = {}) {
    this.foam = foam;
    this.life = opts.life || 50;
    this.w0 = opts.w0 || 10;
    this.spread = opts.spread || 0.9;
    this.strength = opts.strength || 0.9;
    this.kelvin = opts.kelvin !== false;
    this.minStep = opts.step || 5;
    this.max = Math.ceil(this.life / 0.25) + 4;
    this.pts = [];
    const maxVerts = this.max * 2 * 3;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxVerts * 3);
    this.alpha = new Float32Array(maxVerts);
    this.uv = new Float32Array(maxVerts * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < 3; r++) {
      const base = r * this.max * 2;
      for (let i = 0; i < this.max - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, foam.trailMat);
    this.mesh.frustumCulled = false;
    foam.scene.add(this.mesh);
    this.active = true;
    this.intensity = 1;
  }

  push(x, z, time, intensity = 1) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(x - last.x, z - last.z) < this.minStep) {
      last.cx = x; last.cz = z;
      return;
    }
    this.pts.push({ x, z, t: time, k: intensity });
    if (this.pts.length > this.max) this.pts.shift();
  }

  update(time) {
    while (this.pts.length && time - this.pts[0].t > this.life) this.pts.shift();
    const n = this.pts.length;
    this.alpha.fill(0);
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    const writeRibbon = (r, offsetFn, widthFn, alphaFn) => {
      const base = r * this.max * 2;
      for (let i = 0; i < n; i++) {
        const p = this.pts[i];
        const q = this.pts[Math.min(n - 1, i + 1)], o = this.pts[Math.max(0, i - 1)];
        let dx = q.x - o.x, dz = q.z - o.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const nx = -dz, nz = dx;
        const age = time - p.t;
        const off = offsetFn(age);
        const w = widthFn(age);
        const cx = p.x + nx * off, cz = p.z + nz * off;
        const v = (base + i * 2) * 3;
        this.pos[v] = cx - nx * w; this.pos[v + 1] = 0; this.pos[v + 2] = cz - nz * w;
        this.pos[v + 3] = cx + nx * w; this.pos[v + 4] = 0; this.pos[v + 5] = cz + nz * w;
        const a = alphaFn(age) * p.k * this.intensity * (i === n - 1 ? 0 : 1);
        this.alpha[base + i * 2] = a; this.alpha[base + i * 2 + 1] = a;
        this.uv[(base + i * 2) * 2] = 0; this.uv[(base + i * 2 + 1) * 2] = 1;
      }
    };
    const life = this.life;
    writeRibbon(0, () => 0, (age) => this.w0 * 0.5 + age * this.spread, (age) => this.strength * Math.pow(1 - age / life, 1.6));
    if (this.kelvin) {
      const arm = (age) => this.w0 * 0.5 + age * 2.4;
      writeRibbon(1, arm, (age) => 1.5 + age * 0.12, (age) => 0.45 * Math.pow(1 - age / life, 2));
      writeRibbon(2, (age) => -arm(age), (age) => 1.5 + age * 0.12, (age) => 0.45 * Math.pow(1 - age / life, 2));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, this.geo.index.count);
  }

  dispose() {
    this.foam.scene.remove(this.mesh);
    this.geo.dispose();
    this.active = false;
  }
}

class FoamSystem {
  constructor(renderer, size = 1024, extent = 2600) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-extent / 2, extent / 2, extent / 2, -extent / 2, 1, 200);
    this.cam.up.set(0, 0, 1);
    this.rect = new THREE.Vector4(0, 0, extent, extent);
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: trailVert, fragmentShader: trailFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.trails = [];
    // 泡のデカール（インスタンス）
    this.maxDecals = 512;
    this.decals = [];
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.foamSprite = makeFoamSprite();
    this.ringSprite = makeRingSprite();
    const mkMat = (map) => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv; void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);} `,
      fragmentShader: `uniform sampler2D uMap; varying float vA; varying vec2 vUv; void main(){ float a = texture2D(uMap, vUv).a * vA; gl_FragColor = vec4(a, a, a, 1.0);} `,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.decalMesh = new THREE.InstancedMesh(g, mkMat(this.foamSprite), this.maxDecals);
    this.decalAlpha = new THREE.InstancedBufferAttribute(new Float32Array(this.maxDecals), 1);
    this.decalMesh.geometry = g.clone();
    this.decalMesh.geometry.setAttribute('aAlpha', this.decalAlpha);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.count = 0;
    this.scene.add(this.decalMesh);
    this.ringMesh = new THREE.InstancedMesh(g.clone(), mkMat(this.ringSprite), 128);
    this.ringAlpha = new THREE.InstancedBufferAttribute(new Float32Array(128), 1);
    this.ringMesh.geometry.setAttribute('aAlpha', this.ringAlpha);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.scene.add(this.ringMesh);
    this.rings = [];
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  get texture() { return this.rt.texture; }

  createTrail(opts) {
    const t = new Trail(this, opts);
    this.trails.push(t);
    return t;
  }

  removeTrail(t) {
    // 残った航跡は自然に消えるまで残す
    t.ended = true;
  }

  addDecal(x, z, size, strength = 1, life = 10, grow = 1.8) {
    if (this.decals.length >= this.maxDecals) this.decals.shift();
    this.decals.push({ x, z, size, strength, life, t: 0, rot: Math.random() * 6.28, grow });
  }

  addRing(x, z, r0, r1, strength = 0.8, life = 2.5) {
    if (this.rings.length >= 128) this.rings.shift();
    this.rings.push({ x, z, r0, r1, strength, life, t: 0 });
  }

  update(dt, centerX, centerZ) {
    this.time += dt;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.update(this.time);
      if (tr.ended && tr.pts.length < 2) { tr.dispose(); this.trails.splice(i, 1); }
    }
    let n = 0;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      if (d.t > d.life) { this.decals.splice(i, 1); continue; }
    }
    for (const d of this.decals) {
      const k = d.t / d.life;
      const s = d.size * (1 + k * d.grow);
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.rot);
      this._m.compose(this._p.set(d.x, 0, d.z), this._q, this._s.set(s, 1, s));
      this.decalMesh.setMatrixAt(n, this._m);
      this.decalAlpha.array[n] = d.strength * Math.pow(1 - k, 1.3) * Math.min(1, d.t * 6);
      n++;
    }
    this.decalMesh.count = n;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalAlpha.needsUpdate = true;
    let m = 0;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t > r.life) this.rings.splice(i, 1);
    }
    for (const r of this.rings) {
      const k = r.t / r.life;
      const s = (r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k))) * 2;
      this._q.identity();
      this._m.compose(this._p.set(r.x, 0, r.z), this._q, this._s.set(s, 1, s));
      this.ringMesh.setMatrixAt(m, this._m);
      this.ringAlpha.array[m] = r.strength * (1 - k);
      m++;
    }
    this.ringMesh.count = m;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    this.ringAlpha.needsUpdate = true;

    const texel = this.extent / this.size;
    const cx = Math.round(centerX / texel) * texel, cz = Math.round(centerZ / texel) * texel;
    this.cam.position.set(cx, -50, cz);
    this.cam.lookAt(cx, 0, cz);
    this.cam.updateMatrixWorld();
    this.rect.set(cx - this.extent / 2, cz - this.extent / 2, this.extent, this.extent);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
}
return { Trail, FoamSystem };
})();

// ==== src/core/util.js
__mod["src/core/util.js"] = (function () {
const THREE = __DEPS["three"];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randSign = () => (Math.random() < 0.5 ? -1 : 1);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** 角度差を -π..π に */
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** 指数減衰で目標値へ近づける（フレームレート非依存） */
function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
function dampVec(v, target, lambda, dt) {
  return v.lerp(target, 1 - Math.exp(-lambda * dt));
}

/** 点 p と線分 ab の距離 */
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();
function distPointSegment(p, a, b, outClosest) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 0 ? clamp(_ap.dot(_ab) / len2, 0, 1) : 0;
  _c.copy(a).addScaledVector(_ab, t);
  if (outClosest) outClosest.copy(_c);
  return p.distanceTo(_c);
}

/** 線分 p0-p1 と 線分 q0-q1 の最短距離 */
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function distSegmentSegment(p0, p1, q0, q1) {
  _d1.subVectors(p1, p0); _d2.subVectors(q1, q0); _r.subVectors(p0, q0);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-8 && e <= 1e-8) return p0.distanceTo(q0);
  if (a <= 1e-8) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p0).addScaledVector(_d1, s);
  _c2.copy(q0).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}

/** 線分と球の交差（最初の t, 交差しなければ -1） */
function segmentSphere(p0, p1, center, radius) {
  _d1.subVectors(p1, p0);
  _r.subVectors(p0, center);
  const a = _d1.dot(_d1);
  const b = 2 * _r.dot(_d1);
  const c = _r.dot(_r) - radius * radius;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** 線分とカプセル（線分 a-b, 半径 r）の交差判定 */
function segmentCapsule(p0, p1, a, b, r) {
  return distSegmentSegment(p0, p1, a, b) <= r;
}

/** 簡易オブジェクトプール */
class Pool {
  constructor(factory) { this.factory = factory; this.free = []; }
  get() { return this.free.pop() || this.factory(); }
  put(o) { this.free.push(o); }
}

/** 一定間隔で何かをするためのタイマー */
class Every {
  constructor(interval) { this.interval = interval; this.t = Math.random() * interval; }
  tick(dt) { this.t += dt; if (this.t >= this.interval) { this.t -= this.interval; return true; } return false; }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 予測射撃: 速度 v の目標に弾速 s で当てる迎撃時間 */
function interceptTime(relPos, targetVel, speed) {
  const a = targetVel.dot(targetVel) - speed * speed;
  const b = 2 * relPos.dot(targetVel);
  const c = relPos.dot(relPos);
  if (Math.abs(a) < 1e-6) return c > 0 ? -c / b : 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return relPos.length() / speed;
  const t1 = (-b - Math.sqrt(disc)) / (2 * a), t2 = (-b + Math.sqrt(disc)) / (2 * a);
  const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : relPos.length() / speed;
}

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
return { clamp, lerp, smoothstep, rand, randSign, pick, TAU, DEG, angleDiff, damp, dampVec, distPointSegment, distSegmentSegment, segmentSphere, segmentCapsule, Pool, Every, formatTime, interceptTime, V3 };
})();

// ==== src/world/effects.js
__mod["src/world/effects.js"] = (function () {
// パーティクル演出（インスタンス描画のビルボード）
// alpha: 煙・しぶき（奥から手前へソート） / add: 炎・火花・光（加算）
const THREE = __DEPS["three"];
const { rand, clamp } = __mod["src/core/util.js"];

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

class ParticleSystem {
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
class Effects {
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
return { ParticleSystem, Effects, FRAME: F };
})();

// ==== src/world/city.js
__mod["src/world/city.js"] = (function () {
// 守るべき街（海岸線の向こうのスカイライン）
const THREE = __DEPS["three"];
const { mulberry32 } = __mod["src/world/proceduralTextures.js"];

class City {
  constructor(scene, coastZ, preset) {
    this.group = new THREE.Group();
    this.group.name = 'City';
    this.coastZ = coastZ;
    const rand = mulberry32(2026);
    const night = preset.label !== '昼' ? (preset.label === '夜' ? 1 : 0.55) : 0;
    // 陸地
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(16000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.95 }),
    );
    land.position.set(0, 2.2, coastZ + 3000);
    land.receiveShadow = false;
    this.group.add(land);
    // 護岸
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16000, 8, 12), new THREE.MeshStandardMaterial({ color: 0x6d6f6c, roughness: 0.9 }));
    wall.position.set(0, -1.5, coastZ + 4);
    this.group.add(wall);

    // ビル群（インスタンス）
    const count = 900;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.75, metalness: 0.1 });
    this.nightU = { value: night };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.nightU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vObjN; attribute float aSeed;\nvarying float vSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normal; vSeed = aSeed;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vObjN; varying float vSeed; uniform float uNight;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float side = 1.0 - abs(vObjN.y);
          vec2 wp = vec2(abs(vObjN.x) > 0.5 ? vWPos.z : vWPos.x, vWPos.y);
          vec2 cell = floor(wp / vec2(3.2, 3.6));
          vec2 f = fract(wp / vec2(3.2, 3.6));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8) * side;
          diffuseColor.rgb *= mix(1.0, 0.45 + 0.25 * vSeed, win);
          diffuseColor.rgb *= 0.75 + 0.5 * vSeed;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float lit = step(0.62 - uNight * 0.25, h21(cell + vSeed * 13.0));
          totalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * win * lit * uNight * 2.2;`);
    };
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const seeds = new Float32Array(count);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * 7000;
      const depth = 120 + Math.pow(rand(), 0.8) * 2200;
      const z = coastZ + depth;
      const center = Math.exp(-(x * x) / (2 * 1500 * 1500));
      let h = 15 + rand() * 50 + center * rand() * 140;
      if (rand() < 0.05 * center) h = 180 + rand() * 140;
      const w = 18 + rand() * 40, d = 18 + rand() * 40;
      m4.compose(new THREE.Vector3(x, 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.3), new THREE.Vector3(w, h, d));
      inst.setMatrixAt(k, m4);
      seeds[k] = rand();
      k++;
    }
    inst.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    inst.castShadow = false;
    inst.receiveShadow = false;
    this.group.add(inst);

    // 電波塔（街のランドマーク）
    const tower = new THREE.Group();
    const tm = new THREE.MeshStandardMaterial({ color: 0xd8dcdf, roughness: 0.5, metalness: 0.3, emissive: 0xff2010, emissiveIntensity: 0 });
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(3, 26, 240, 4, 1, true), tm);
    legs.position.y = 120;
    tower.add(legs);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 90, 6), tm);
    top.position.y = 285;
    tower.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.5, 0.3) }));
    beacon.position.y = 332;
    tower.add(beacon);
    this.beacon = beacon;
    tower.position.set(-420, 2, coastZ + 900);
    this.group.add(tower);

    // 港のクレーン
    const cm = new THREE.MeshStandardMaterial({ color: 0xb03a26, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 60, 3), cm);
      leg.position.set(0, 30, 0);
      const leg2 = leg.clone(); leg2.position.set(0, 30, 24);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 90), cm);
      boom.position.set(0, 62, -20);
      c.add(leg, leg2, boom);
      c.position.set(900 + i * 70, 2, coastZ + 30);
      this.group.add(c);
    }
    // 灯台
    const lh = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 34, 10), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
    lh.position.set(-1800, 18, coastZ - 20);
    this.group.add(lh);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3) }));
    lamp.position.set(-1800, 37, coastZ - 20);
    this.group.add(lamp);
    this.lamp = lamp;
    scene.add(this.group);
    this.t = 0;
  }

  setNight(v) { this.nightU.value = v; }

  update(dt) {
    this.t += dt;
    this.beacon.visible = Math.sin(this.t * 3) > 0;
    this.lamp.visible = Math.sin(this.t * 1.3) > -0.3;
  }
}
return { City };
})();

// ==== src/game/telegraph.js
__mod["src/game/telegraph.js"] = (function () {
// 即死攻撃の予告表示
// 海面: 真上から見た警告マップ(RT)に図形を描き、海シェーダーが発光として重ねる（波に追従・Zファイトなし）
// 空中: 航空機が狙われた時は、半透明の「壁」と照準線を 3D で出す
const THREE = __DEPS["three"];

const shapeVert = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// kind: 0 帯(ライン), 1 扇形/円環, 2 円, 3 味方のガイド線（点滅しない点線）
const shapeFrag = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
uniform float uProgress;  // 0→1: 攻撃までの残り（1で発動）
uniform float uTime;
uniform float uKind;
uniform float uFlow;      // 帯の流れる向き(+1/-1)
uniform float uInner;     // 扇形の内径比
uniform float uDash;      // ガイド線の点線の数
varying vec2 vUv;
void main(){
  float a = 0.0;
  if (uKind < 0.5) {
    float across = abs(vUv.x * 2.0 - 1.0);
    float edge = smoothstep(0.62, 0.92, across) * (1.0 - smoothstep(0.92, 1.0, across));
    float body = (1.0 - smoothstep(0.85, 1.0, across)) * 0.28;
    float stripes = smoothstep(0.35, 0.5, fract(vUv.y * 18.0 - uTime * 1.6 * uFlow)) * 0.22 * (1.0 - across);
    float fill = step(uFlow > 0.0 ? vUv.y : 1.0 - vUv.y, uProgress) * 0.45 * (1.0 - smoothstep(0.85, 1.0, across));
    a = edge * 1.2 + body + stripes + fill;
  } else if (uKind < 1.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.x, p.y);
    float rr = (r - uInner) / (1.0 - uInner);
    float inside = step(0.0, rr) * step(r, 1.0);
    float rim = (smoothstep(0.86, 0.98, r) + (1.0 - smoothstep(0.0, 0.08, rr))) * inside;
    float fill = step(rr, uProgress) * 0.4 * inside;
    float hatch = smoothstep(0.4, 0.5, fract((p.x + p.y) * 6.0 - uTime * 0.8)) * 0.15 * inside;
    a = rim * 1.1 + 0.22 * inside + fill + hatch;
  } else if (uKind < 2.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float inside = 1.0 - smoothstep(0.97, 1.0, r);
    float rim = smoothstep(0.86, 0.96, r) * inside;
    float fill = step(r, uProgress) * 0.45 * inside;
    float pulse = smoothstep(0.0, 0.04, abs(fract(r * 3.0 - uTime * 1.5) - 0.5) - 0.42) * 0.25 * inside;
    a = rim * 1.3 + 0.2 * inside + fill + pulse;
  } else {
    float across = abs(vUv.x * 2.0 - 1.0);
    float f = fract(vUv.y * uDash - uTime * 1.4);
    float dash = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.5, 0.56, f));
    float core = 1.0 - smoothstep(0.5, 0.95, across);
    float tail = 1.0 - smoothstep(0.82, 1.0, vUv.y);
    a = core * dash * tail * 0.9;
  }
  float blink = uKind > 2.5 ? 1.0 : 0.75 + 0.25 * sin(uTime * 14.0);
  gl_FragColor = vec4(uColor * a * uIntensity * blink, 1.0);
}`;

function sectorGeometry(arcRad, segs = 48) {
  // 扇形を正方形の UV（中心 0.5,0.5）で張る。+Z が中心方向
  const pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = -arcRad / 2 + (arcRad * i) / segs;
    const x = Math.sin(a), z = Math.cos(a);
    pos.push(x, 0, z);
    uv.push(0.5 + x * 0.5, 0.5 + z * 0.5);
  }
  for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

class TelegraphSystem {
  constructor(renderer, mainScene, size = 1024, extent = 7000) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-extent / 2, extent / 2, extent / 2, -extent / 2, 1, 200);
    this.cam.up.set(0, 0, 1);
    this.rect = new THREE.Vector4(0, 0, extent, extent);
    this.mainScene = mainScene;
    this.shapes = [];
    this.time = 0;
    this.lineGeo = new THREE.PlaneGeometry(1, 1);
    this.lineGeo.rotateX(-Math.PI / 2); // XZ 平面、+Z 方向に長さ
    this.discGeo = new THREE.CircleGeometry(1, 64);
    this.discGeo.rotateX(-Math.PI / 2);
    // 空中用の素材
    this.airMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 1 }, uTime: { value: 0 }, uProgress: { value: 0 } },
      vertexShader: shapeVert,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform float uProgress; varying vec2 vUv;
        void main(){
          float edge = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
          float lines = smoothstep(0.45, 0.5, fract(vUv.y * 10.0 + uTime * 2.0)) * 0.5 + 0.5;
          float sides = 1.0 - smoothstep(0.0, 0.5, min(vUv.x, 1.0 - vUv.x) * 4.0) * 0.6;
          gl_FragColor = vec4(uColor * uIntensity * (0.06 + 0.1 * lines) * edge * sides * (0.7 + 0.3 * sin(uTime * 14.0)), 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  get texture() { return this.rt.texture; }

  _mat(kind, color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 }, uProgress: { value: 0 },
        uTime: { value: 0 }, uKind: { value: kind }, uFlow: { value: 1 }, uInner: { value: 0 }, uDash: { value: 18 },
      },
      vertexShader: shapeVert, fragmentShader: shapeFrag,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  /** 海面の帯: a→b、幅 w。flow=+1 なら a→b の向きに進行 */
  line(a, b, width, color, opts = {}) {
    const m = new THREE.Mesh(this.lineGeo, this._mat(0, color));
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    m.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(dx, dz) + Math.PI; // uv.y=0 が a 側
    m.scale.set(width, 1, len);
    m.material.uniforms.uFlow.value = opts.flow ?? 1;
    return this._add(m, opts);
  }

  sector(center, dirAngle, arcDeg, inner, outer, color, opts = {}) {
    const g = sectorGeometry((arcDeg * Math.PI) / 180);
    const m = new THREE.Mesh(g, this._mat(1, color));
    m.position.set(center.x, 0, center.z);
    m.rotation.y = dirAngle;
    m.scale.set(outer, 1, outer);
    m.material.uniforms.uInner.value = inner / outer;
    m.userData.ownGeo = g;
    return this._add(m, opts);
  }

  circle(center, radius, color, opts = {}) {
    const m = new THREE.Mesh(this.discGeo, this._mat(2, color));
    m.position.set(center.x, 0, center.z);
    m.scale.set(radius, 1, radius);
    return this._add(m, opts);
  }

  /** 味方用のガイド線（魚雷の進路など）。setGuide で毎フレーム動かす */
  guide(color) {
    const m = new THREE.Mesh(this.lineGeo, this._mat(3, color));
    const s = this._add(m, { duration: Infinity, fadeOut: 0.2 });
    s.intensity = 0;
    return s;
  }

  setGuide(s, a, b, width, intensity) {
    if (!s || s.removed) return;
    const m = s.mesh;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    m.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(dx, dz) + Math.PI;
    m.scale.set(width, 1, len);
    m.material.uniforms.uDash.value = len / 55;
    s.intensity = intensity;
  }

  /** 空中の危険範囲（縦の幕）: 海面の a→b から高さ h まで */
  curtain(a, b, height, color, opts = {}) {
    const g = new THREE.PlaneGeometry(1, 1);
    const mat = this.airMat.clone();
    mat.uniforms.uColor.value = new THREE.Color(color);
    const m = new THREE.Mesh(g, mat);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    m.position.set((a.x + b.x) / 2, height / 2, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    m.scale.set(len, height, 1);
    m.userData.ownGeo = g;
    m.userData.air = true;
    m.renderOrder = 30;
    this.mainScene.add(m);
    const s = { mesh: m, t: 0, duration: opts.duration ?? 2, fadeOut: 0.25, progress: 0, air: true };
    this.shapes.push(s);
    return s;
  }

  _add(mesh, opts) {
    this.scene.add(mesh);
    const s = { mesh, t: 0, duration: opts.duration ?? 2, fadeOut: opts.fadeOut ?? 0.25, progress: 0 };
    this.shapes.push(s);
    return s;
  }

  remove(s) {
    if (!s || s.removed) return;
    s.removed = true;
    if (!isFinite(s.duration)) s.duration = s.t;
    s.t = Math.max(s.t, s.duration);
  }

  clear() { for (const s of this.shapes) this.remove(s); }

  update(dt, centerX, centerZ) {
    this.time += dt;
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      s.t += dt;
      const u = s.mesh.material.uniforms;
      u.uTime.value = this.time;
      const p = Math.min(1, s.t / s.duration);
      if (u.uProgress) u.uProgress.value = s.progressOverride ?? p;
      const over = s.t - s.duration;
      const fade = over > 0 ? Math.max(0, 1 - over / s.fadeOut) : Math.min(1, s.t / 0.12);
      u.uIntensity.value = fade * (s.intensity ?? 1);
      if (over > s.fadeOut) {
        (s.air ? this.mainScene : this.scene).remove(s.mesh);
        s.mesh.material.dispose();
        if (s.mesh.userData.ownGeo) s.mesh.userData.ownGeo.dispose();
        this.shapes.splice(i, 1);
      }
    }
    const texel = this.extent / this.size;
    const cx = Math.round(centerX / texel) * texel, cz = Math.round(centerZ / texel) * texel;
    this.cam.position.set(cx, -50, cz);
    this.cam.lookAt(cx, 0, cz);
    this.cam.updateMatrixWorld();
    this.rect.set(cx - this.extent / 2, cz - this.extent / 2, this.extent, this.extent);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (this.shapes.some((s) => !s.air)) r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }
}
return { TelegraphSystem };
})();

// ==== src/config.js
__mod["src/config.js"] = (function () {
// 調整用の数値はすべてここに集める（試作しながら調整する）

const WORLD = {
  cityDistance: 6200,       // 怪獣の出現地点から街（海岸線）までの距離 (m)。歩いて約10分
  kaijuWaterDepth: 30,      // 怪獣の足元の水深 (m)。すねまで海に沈む
  arenaRadius: 7000,        // 行動可能範囲（怪獣中心）
  gravity: 9.81,
};

const DIFFICULTY = {
  easy: { label: 'かんたん', hp: 0.6, telegraph: 1.35, cpuSkill: 0.85, cpuReaction: 0.30, attackRate: 0.8 },
  normal: { label: 'ふつう', hp: 1.0, telegraph: 1.0, cpuSkill: 0.65, cpuReaction: 0.45, attackRate: 1.0 },
  hard: { label: 'むずかしい', hp: 1.5, telegraph: 0.78, cpuSkill: 0.5, cpuReaction: 0.62, attackRate: 1.2 },
};

const MODES = {
  real: { label: 'リアル', respawn: false },
  practice: { label: '練習', respawn: true },
};

const KAIJU = {
  scale: 2.0,               // モデルの大きさ（全高 約190m）
  baseHp: 7200,             // ひとり・ふつうの時の合計HP
  hpPerAlly: 0.6,           // CPU 1機ごとに増えるHPの割合
  hpPerHuman: 0.9,          // マルチプレイ: 人が1人増えるごとに増えるHPの割合
  headShare: { R: 0.3, C: 0.4, L: 0.3 },
  walkSpeed: 9.6,           // m/s（歩行アニメ 5秒で48m）
  rageWalkSpeed: 11.5,
  flinchPoints: 150,        // 溜め中にこの「怯み値」がたまると怯む（主砲2発・ミサイル1発・魚雷1本・機関砲の連射）
  stunTime: 2.4,
  recoverTime: { R: 1.6, C: 2.2, L: 1.8 },
  vulnerableMul: 1.5,       // 怯み・硬直中の被ダメージ倍率
  bodyDamageMul: 0.85,      // 胴体・脚に当たったときの倍率（生きている頭に分配）
  meleeRange: 560,          // ひれ・しっぽの射程
  beamRange: 3600,
};

// 各攻撃の基本タイミング（秒）。難易度の telegraph 倍率が予告時間に掛かる（最短1秒）
// radius は当たり判定（見た目のビーム・水柱はもっと太い）。船の速さは変わらないので、怪獣が大きくなっても判定は据え置き
const ATTACKS = {
  bolts: { telegraph: 1.25, count: 7, interval: 0.2, speed: 900, radius: 5, cooldown: [6.0, 9.0] },
  sweep: { telegraph: 1.6, duration: 1.4, radius: 13, length: 1300, cooldown: [10.0, 14.0] },
  trace: { telegraph: 1.5, duration: 1.3, radius: 14, columnRadius: 20, columnHeight: 220, cooldown: [8.0, 11.0] },
  tail: { telegraph: 1.05, duration: 0.55, inner: 80, outer: 580, arc: 230, cooldown: 7.0 },
  claw: { telegraph: 1.0, duration: 0.4, inner: 50, outer: 380, arc: 130, cooldown: 6.0 },
  converge: { telegraph: 2.6, duration: 1.0, radius: 115, cooldown: 24.0 },
  // HPが2割を切ると撃つ「極太ビーム」: 10秒溜めて前方の扇形を薙ぎ払う。溜め中に stopRatio×最大HP のダメージを与えると止まる
  mega: { hpRatio: 0.2, telegraph: 10, duration: 2.6, arc: 100, range: 3500, radius: 60, altMax: 320, stopRatio: 0.05, stopMin: 320, cooldown: 45, exhaust: 6, stun: 7, vuln: 1.2 },
};

// 機関砲（乱射できる武器）: 押している間撃ち続ける。撃ち続けると熱がたまり、過熱すると少し撃てない
const MG_SHIP = { rate: 16, speed: 1000, damage: 1.5, flinch: 3.2, range: 2600, spread: 0.010, heatPerShot: 0.012, coolRate: 0.35, overheatTime: 2.5 };

const SHIP = {
  maxSpeed: 20,             // m/s（ゲーム用に実艦より機敏）
  speeds: [-0.35, 0, 0.5, 0.75, 1.0],
  speedNames: ['後進', '停止', '半速', '強速', '全速'],
  accel: 3.0,
  turnRate: 7.0,            // 度/秒（全速・舵いっぱい）
  rudderShift: 1.1,         // 舵がいっぱいになるまでの秒数
  length: 160, beam: 20,
  hitRadius: 9,
  gun: { speed: 640, reload: 1.8, damage: 70, flinch: 1.4, maxRange: 7000, spread: 0.0045 },
  mg: MG_SHIP,
  // 魚雷は1隻3本まで（空母の近くで補給しても3本まで）。1本ずつ発射。当たれば強力
  torpedo: { speed: 55, range: 3400, damage: 520, flinch: 3.0, count: 3, salvo: 1, reload: 4 },
};

const FIGHTER = {
  minSpeed: 85, cruise: 150, maxSpeed: 235,
  accel: 45,
  pitchRate: 62, rollRate: 170, yawRate: 14,  // 度/秒
  hitRadius: 6.5,
  minAlt: 6, maxAlt: 2600,
  gun: { rate: 24, speed: 1100, damage: 3.0, flinch: 2.4, range: 1700, spread: 0.008, heatPerShot: 0.008, coolRate: 0.45, overheatTime: 2.0 },
  missile: { count: 8, speed: 420, turn: 70, damage: 150, flinch: 4.0, lockCone: 26, lockRange: 5600, reload: 1.2 },
  bomb: { gauge: 26, damage: 760, flinch: 3.0, blast: 34 },
};

const PROP_FIGHTER = {
  minSpeed: 60, cruise: 110, maxSpeed: 165,
  accel: 30,
  pitchRate: 75, rollRate: 200, yawRate: 18,
  hitRadius: 5.5,
  minAlt: 6, maxAlt: 2200,
  gun: { rate: 20, speed: 900, damage: 3.2, flinch: 2.4, range: 1300, spread: 0.011, heatPerShot: 0.0085, coolRate: 0.45, overheatTime: 2.0 },
  rocket: { count: 10, speed: 360, damage: 95, flinch: 3.0, reload: 0.6 },
  bomb: { gauge: 22, damage: 620, flinch: 2.5, blast: 30 },
};

const CARRIER = {
  speed: 15,                // 怒った怪獣（12.5m/s）より速く下がれるように
  standOff: 3400,           // 怪獣からの距離を保つ（ビームの射程ぎりぎり外）
  resupplyRadius: 480,
  hitRadius: 14,
  hits: 3,                  // 空母だけは3発まで耐える（炎上→轟沈）
};

const CPU = {
  max: 12,
  damageMul: 0.6,           // CPUの与えるダメージ倍率（主役はプレイヤー）
  callsignsFighter: ['イーグル2', 'イーグル3', 'イーグル4', 'イーグル5', 'ファルコン1', 'ファルコン2', 'ファルコン3', 'ファルコン4', 'ホーク1', 'ホーク2', 'ホーク3', 'ホーク4'],
  shipNames: ['はやせ', 'みなづき', 'あまぎり', 'ゆうなみ', 'しおかぜ', 'あさぎり', 'くもかぜ', 'たちかぜ', 'うみぎり', 'はるかぜ', 'みねぐも', 'ゆきなみ'],
};
return { WORLD, DIFFICULTY, MODES, KAIJU, ATTACKS, SHIP, FIGHTER, PROP_FIGHTER, CARRIER, CPU };
})();

// ==== src/world/world.js
__mod["src/world/world.js"] = (function () {
// 世界（描画パイプライン・空・海・太陽・泡・予告・演出・街）をまとめる
const THREE = __DEPS["three"];
const { RenderPipeline, QUALITY_LEVELS } = __mod["src/core/renderer.js"];
const { Sky } = __mod["src/world/sky.js"];
const { Ocean } = __mod["src/world/ocean.js"];
const { FoamSystem } = __mod["src/world/foam.js"];
const { Effects } = __mod["src/world/effects.js"];
const { City } = __mod["src/world/city.js"];
const { TelegraphSystem } = __mod["src/game/telegraph.js"];
const { makeWaterNormalTexture, makeNoiseTexture, makeParticleAtlas } = __mod["src/world/proceduralTextures.js"];
const { WORLD } = __mod["src/config.js"];

class World {
  constructor(canvas, { sky = 'day', quality = 'high' } = {}) {
    this.pipe = new RenderPipeline(canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 40000);
    this.pipe.init(this.scene, this.camera, quality);
    this.renderer = this.pipe.renderer;
    this.noise = makeNoiseTexture(256, 11);
    this.atlas = makeParticleAtlas(1024);
    this.normalA = makeWaterNormalTexture(256, 7, [1, 0.3]);
    this.normalB = makeWaterNormalTexture(256, 21, [0.4, 1]);
    this.sky = new Sky(this.renderer, this.noise, sky);
    this.preset = this.sky.preset;
    this.scene.background = this.sky.background;
    this.scene.environment = this.sky.environment;
    this.fogColor = this.sky.horizonColor.clone();
    this.scene.fog = new THREE.FogExp2(this.fogColor, this.preset.fogDensity);
    this.sunColor = new THREE.Color(...this.preset.sunColor);
    this.sun = new THREE.DirectionalLight(this.sunColor, this.preset.sunIntensity);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 5200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun, this.sun.target);
    this.shadowFocus = new THREE.Vector3();
    this.shadowExtent = 420;

    const q = QUALITY_LEVELS[quality] || QUALITY_LEVELS.high;
    this.ocean = new Ocean({
      envCube: this.sky.background, sunDir: this.sky.sunDir, sunColor: this.sunColor, sunIntensity: this.preset.sunIntensity,
      normalA: this.normalA, normalB: this.normalB, noise: this.noise, preset: this.preset, quality: q.ocean,
    });
    this.scene.add(this.ocean.mesh);
    this.foam = new FoamSystem(this.renderer, q.foam, 2600);
    this.ocean.setFoam(this.foam.texture, this.foam.rect);
    this.telegraph = new TelegraphSystem(this.renderer, this.scene, 1024, 7200);
    this.ocean.setWarn(this.telegraph.texture, this.telegraph.rect);
    this.effects = new Effects(this.scene, this.atlas, this.fogColor, this.preset.fogDensity, q.particles);
    this.effects.foam = this.foam;
    this.effects.setLighting(this.sunColor, this.preset.ambient);
    this.city = new City(this.scene, WORLD.cityDistance, this.preset);
    this.warnCenter = new THREE.Vector3();
    this.applyShadowQuality(q);
    this.time = 0;
    // 夜は少し明るい月光で海を見やすく
    if (this.preset.stars) this.ocean.uniforms.uEnvIntensity.value = 2.2;
    this.pipe.post.uExposure.value = 0.92 * (this.preset.exposure || 1);
  }

  applyShadowQuality(q) {
    const size = q.shadows;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  setSky(name) {
    this.sky.apply(name);
    const p = this.sky.preset;
    this.preset = p;
    this.scene.environment = this.sky.environment;
    this.fogColor.copy(this.sky.horizonColor);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = p.fogDensity;
    this.sunColor.setRGB(...p.sunColor);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.ocean.applyPreset(p);
    this.ocean.uniforms.uSunIntensity.value = p.sunIntensity;
    this.ocean.uniforms.uEnvIntensity.value = p.stars ? 2.2 : 1.0;
    this.effects.setLighting(this.sunColor, p.ambient);
    this.effects.alpha.material.uniforms.uFogDensity.value = p.fogDensity;
    this.effects.add.material.uniforms.uFogDensity.value = p.fogDensity;
    this.city.setNight(p.label === '昼' ? 0 : p.label === '夜' ? 1 : 0.55);
    this.pipe.post.uExposure.value = 0.92 * (p.exposure || 1);
  }

  setQuality(name) {
    this.pipe.setQuality(name);
    const q = this.pipe.quality;
    this.effects.setQuality(q.particles);
    this.applyShadowQuality(q);
  }

  update(dt) {
    this.time += dt;
    const cam = this.camera;
    this.ocean.update(dt, cam);
    this.foam.update(dt, cam.position.x, cam.position.z);
    this.telegraph.update(dt, this.warnCenter.x, this.warnCenter.z);
    this.effects.update(dt, cam);
    this.city.update(dt);
    // 影の範囲を注目点（怪獣）に追従させる
    const e = this.shadowExtent;
    const sc = this.sun.shadow.camera;
    if (sc.right !== e) { sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.updateProjectionMatrix(); }
    const texel = (2 * e) / (this.sun.shadow.mapSize.x || 1024);
    const f = this.shadowFocus;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sky.sunDir, 2400);
  }

  render(dt) { this.pipe.render(dt); }
  resize() { this.pipe.resize(); }
}
return { World };
})();

// ==== src/game/input.js
__mod["src/game/input.js"] = (function () {
// 入力: キーボード・マウス・タッチ → InputState
// 機体の「入力元」は人・CPU・ネットワークのどれにも差し替えられるよう、すべて同じ InputState を返す。
const THREE = __DEPS["three"];

function makeInputState() {
  return {
    steer: 0,          // 船: 舵 / 戦闘機: 左右旋回（-1 左 … +1 右）
    pitch: 0,          // 戦闘機: +1 で機首上げ
    throttle: 0,       // 船: 速力の段階変更要求（-1/0/+1, 1フレームだけ）
    boost: false, brake: false,
    fire: false,       // 船: 主砲（aimPoint へ）
    mg: false,         // 機関砲（押している間乱射）。船: aimPoint へ / 戦闘機: 機首の向きへ
    aimPoint: null,    // THREE.Vector3（ワールド）
    torpedo: false, missile: false, bomb: false,
  };
}

/** 生のデバイス状態（ゲーム全体で1つ） */
class Devices {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // このフレームに押されたキー
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, left: false, right: false, leftPressed: false, wheel: 0, dragDX: 0, dragDY: 0, inside: false, dragging: false };
    this.touch = { stick: { active: false, x: 0, y: 0 }, steerDrag: 0, tapAim: null, buttons: {}, pressedButtons: new Set(), lookDX: 0, lookDY: 0, looking: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lastInput = this.isTouch ? 'touch' : 'mouse';
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      this.lastInput = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.lastInput = 'mouse';
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2 || e.button === 1) { this.mouse.right = true; e.preventDefault(); }
      canvas.setPointerCapture?.(e.pointerId);
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2 || e.button === 1) this.mouse.right = false;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const m = this.mouse;
      // 右ドラッグ（または中ボタン）で視点を回す
      if (m.right) { m.dragDX += e.movementX || 0; m.dragDY += e.movementY || 0; }
      m.x = e.clientX; m.y = e.clientY;
      m.nx = (e.clientX / innerWidth) * 2 - 1;
      m.ny = -(e.clientY / innerHeight) * 2 + 1;
      m.inside = true;
    });
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
    this.mouse.dragDX = 0;
    this.mouse.dragDY = 0;
    this.touch.tapAim = null;
    this.touch.pressedButtons.clear();
    this.touch.lookDX = 0;
    this.touch.lookDY = 0;
  }
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();

/** プレイヤー操作 */
class HumanController {
  constructor(devices, battle) {
    this.dev = devices;
    this.battle = battle;
    this.state = makeInputState();
    this.aim = new THREE.Vector3();
    this.aimValid = false;
    this.isHuman = true;
  }

  /** 画面座標から照準点（怪獣に当たればその点、なければ海面）を求める */
  pickAim(nx, ny, camera) {
    _ray.setFromCamera({ x: nx, y: ny }, camera);
    const hit = this.battle.kaiju ? this.battle.kaiju.raycast(_ray.ray) : null;
    if (hit) { this.aim.copy(hit); return true; }
    const r = _ray.ray;
    if (r.direction.y < -0.0005) {
      const t = -r.origin.y / r.direction.y;
      this.aim.copy(r.origin).addScaledVector(r.direction, Math.min(t, 9000));
      this.aim.y = 0;
      return true;
    }
    this.aim.copy(r.origin).addScaledVector(r.direction, 6000);
    this.aim.y = 0;
    return true;
  }

  update(vehicle, dt) {
    const d = this.dev, s = this.state, cam = this.battle.camera;
    const t = d.touch;
    s.throttle = 0;
    s.fire = s.torpedo = s.missile = s.bomb = s.mg = false;
    if (vehicle.kind === 'ship') {
      // 船: 左クリック=主砲 / Space長押し=機関砲 / F・E=魚雷（1隻3本まで）
      let steer = (d.down('KeyD', 'ArrowRight') ? 1 : 0) - (d.down('KeyA', 'ArrowLeft') ? 1 : 0);
      if (t.steerDrag) steer = t.steerDrag;
      s.steer = steer;
      if (d.hit('KeyW', 'ArrowUp') || t.pressedButtons.has('speedUp')) s.throttle = 1;
      if (d.hit('KeyS', 'ArrowDown') || t.pressedButtons.has('speedDown')) s.throttle = -1;
      if (t.tapAim) {
        this.aimValid = this.pickAim(t.tapAim.nx, t.tapAim.ny, cam);
        this.touchAim = { nx: t.tapAim.nx, ny: t.tapAim.ny };
        s.fire = true;
      } else if (d.lastInput === 'touch' && this.touchAim) {
        this.aimValid = this.pickAim(this.touchAim.nx, this.touchAim.ny, cam);
      } else if (d.mouse.inside) {
        this.aimValid = this.pickAim(d.mouse.nx, d.mouse.ny, cam);
        s.fire = d.mouse.left;
      }
      if (t.buttons.fire) { s.fire = true; }
      s.aimPoint = this.aimValid ? this.aim : null;
      s.mg = d.down('Space') || !!t.buttons.mg;
      s.torpedo = d.hit('KeyF', 'KeyE') || t.pressedButtons.has('torpedo');
    } else {
      // 戦闘機: 左クリック/Space長押し=機関砲 / E=ミサイル / F=爆弾
      let steer = (d.down('KeyD', 'ArrowRight') ? 1 : 0) - (d.down('KeyA', 'ArrowLeft') ? 1 : 0);
      let pitch = (d.down('KeyW', 'ArrowUp') ? 1 : 0) - (d.down('KeyS', 'ArrowDown') ? 1 : 0);
      if (this.battle.settings.invertPitch) pitch = -pitch;
      if (t.stick.active) { steer = t.stick.x; pitch = -t.stick.y * (this.battle.settings.invertPitch ? -1 : 1); }
      s.steer = steer;
      s.pitch = pitch;
      s.boost = d.down('ShiftLeft', 'ShiftRight') || !!t.buttons.boost;
      s.brake = d.down('ControlLeft', 'KeyQ') || !!t.buttons.brake;
      s.mg = d.down('Space') || d.mouse.left || !!t.buttons.gun;
      s.missile = d.hit('KeyE') || t.pressedButtons.has('missile');
      s.bomb = d.hit('KeyF') || t.pressedButtons.has('bomb');
    }
    return s;
  }
}
return { makeInputState, Devices, HumanController };
})();

// ==== src/core/audio.js
__mod["src/core/audio.js"] = (function () {
// 音: Web Audio API による合成（外部の音声素材なし・ライセンスの心配なし）
const THREE = __DEPS["three"];

const HEAD_PITCH = { R: 1.6, C: 0.7, L: 1.0, all: 0.8 };

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVolume = 0.45;
    this.listener = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
    this.loops = {};
    this.lastPlay = {};
  }

  /** ユーザー操作の後に呼ぶ（ブラウザの自動再生制限のため） */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    // テレビ中継の時は「テレビのスピーカーの音」にする（低音と高音を削る）
    this.tvHP = ctx.createBiquadFilter(); this.tvHP.type = 'highpass'; this.tvHP.frequency.value = 10;
    this.tvLP = ctx.createBiquadFilter(); this.tvLP.type = 'lowpass'; this.tvLP.frequency.value = 20000;
    this.master.connect(this.tvHP).connect(this.tvLP).connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVolume; this.musicBus.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    // 残響
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.55;
    this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(3, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.startAmbience();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }

  makeNoise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  makeImpulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  noise(buf = this.noiseBuf, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (!loop) s.playbackRate.value = 0.85 + Math.random() * 0.3;
    return s;
  }

  /** 位置つきの出力先（距離減衰・左右・遅延） */
  spatial(pos, ref = 200, maxDelay = 2.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let gain = 1, delay = 0, pan = 0;
    if (pos) {
      const d = pos.distanceTo(this.listener);
      gain = ref / (ref + d);
      delay = Math.min(maxDelay, d / 340) * 0.6;
      const dir = pos.clone().sub(this.listener).normalize();
      pan = THREE.MathUtils.clamp(dir.dot(this.right), -1, 1) * 0.8;
      // 遠い音は高音が抜ける
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = THREE.MathUtils.clamp(18000 * Math.pow(ref / (ref + d), 0.6), 400, 18000);
      g.connect(lp);
      if (p) { p.pan.value = pan; lp.connect(p); p.connect(this.sfx); } else lp.connect(this.sfx);
      if (gain > 0.02) {
        const send = ctx.createGain(); send.gain.value = Math.min(0.8, 0.25 + d / 4000);
        lp.connect(send).connect(this.revSend);
      }
    } else {
      g.connect(this.sfx);
    }
    return { node: g, gain, t: ctx.currentTime + delay };
  }

  throttle(name, interval) {
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < interval * 1000) return false;
    this.lastPlay[name] = now;
    return true;
  }

  env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    param.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + a + d);
  }

  // ------------------------------------------------------------------ 効果音
  explosion(pos, size = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 260 * Math.sqrt(size));
    const t = out.t;
    const amp = Math.min(1.4, 0.55 * size) * out.gain * 2.2;
    if (amp < 0.004) return;
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.4 * Math.sqrt(size));
    const g = ctx.createGain();
    this.env(g.gain, t, 0.01, amp, 1.6 * Math.sqrt(size));
    n.connect(lp).connect(g).connect(out.node);
    n.start(t); n.stop(t + 3.5);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g2 = ctx.createGain(); this.env(g2.gain, t, 0.01, amp * 1.1, 1.0);
    o.connect(g2).connect(out.node);
    o.start(t); o.stop(t + 1.3);
  }

  fire(weapon, pos, isPlayer) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (weapon === 'gun') {
      const out = this.spatial(isPlayer ? null : pos, 200);
      const t = out.t, a = (isPlayer ? 0.7 : 0.9) * (isPlayer ? 1 : out.gain * 2);
      if (a < 0.01) return;
      const n = this.noise();
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 900; hp.Q.value = 0.6;
      const g = ctx.createGain(); this.env(g.gain, t, 0.002, a, 0.35);
      n.connect(hp).connect(g).connect(out.node); n.start(t); n.stop(t + 0.6);
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      const g2 = ctx.createGain(); this.env(g2.gain, t, 0.002, a * 0.9, 0.3);
      o.connect(g2).connect(out.node); o.start(t); o.stop(t + 0.4);
    } else if (weapon === 'missile') {
      const out = this.spatial(isPlayer ? null : pos, 150);
      const t = out.t, a = isPlayer ? 0.35 : out.gain * 0.6;
      if (a < 0.01) return;
      const n = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5); bp.frequency.exponentialRampToValueAtTime(900, t + 1.6);
      const g = ctx.createGain(); this.env(g.gain, t, 0.04, a, 1.6);
      n.connect(bp).connect(g).connect(out.node); n.start(t); n.stop(t + 2);
    } else if (weapon === 'torpedo') {
      this.splash(pos, 0.5);
      const out = this.spatial(isPlayer ? null : pos, 150);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, out.t); o.frequency.exponentialRampToValueAtTime(45, out.t + 0.3);
      const g = ctx.createGain(); this.env(g.gain, out.t, 0.005, isPlayer ? 0.5 : out.gain * 0.6, 0.35);
      o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 0.5);
    } else if (weapon === 'bomb') {
      const out = this.spatial(isPlayer ? null : pos, 150);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1400, out.t); o.frequency.exponentialRampToValueAtTime(380, out.t + 2.4);
      const g = ctx.createGain(); this.env(g.gain, out.t, 0.2, isPlayer ? 0.12 : out.gain * 0.15, 2.3);
      o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 2.8);
    }
  }

  /** 自機の機関砲（鳴らしている間ループ音）。kind: ship=CIWS（低く速い連射）/ fighter */
  gun(on, kind = 'fighter') { this.gunOn = on; this.gunKind = kind; this.gunT = performance.now(); }

  /** 遠くの味方の機関砲（パラパラという音） */
  distantMG(pos) {
    if (!this.ctx || !this.throttle('dmg', 0.09)) return;
    const ctx = this.ctx, out = this.spatial(pos, 180);
    const a = out.gain * 0.9;
    if (a < 0.01) return;
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.002, a, 0.06);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 0.12);
  }

  /** 首が噛みつく音（顎が鳴る） */
  snap(pos) {
    if (!this.ctx || !this.throttle('snap', 0.4)) return;
    const ctx = this.ctx, out = this.spatial(pos, 700);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.4;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.004, Math.min(1, out.gain * 2.2), 0.18);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 0.3);
    this.roar(pos, 0.22, 1.7);
  }

  /** 極太ビームの溜め音（だんだん高く強くなるうなり）。on=false で止める */
  megaCharge(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.megaLoop) {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 82;
      const n = this.noise(this.noiseBuf, true);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 2;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(lp); o2.connect(lp); n.connect(bp).connect(lp);
      lp.connect(g).connect(this.sfx);
      o1.start(); o2.start(); n.start();
      g.gain.setTargetAtTime(0.16, t, 0.5);
      this.megaLoop = { o1, o2, n, lp, bp, g, nextBeat: 0 };
    } else if (!on && this.megaLoop) {
      const L = this.megaLoop;
      this.megaLoop = null;
      L.g.gain.setTargetAtTime(0.0001, t, 0.12);
      setTimeout(() => { try { L.o1.stop(); L.o2.stop(); L.n.stop(); } catch (e) { /* 停止済み */ } }, 900);
    }
  }

  megaChargeLevel(p) {
    const L = this.megaLoop;
    if (!L || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 55 + p * 170;
    L.o1.frequency.setTargetAtTime(f, t, 0.1);
    L.o2.frequency.setTargetAtTime(f * 1.498, t, 0.1);
    L.lp.frequency.setTargetAtTime(400 + p * 3400, t, 0.1);
    L.bp.frequency.setTargetAtTime(300 + p * 2600, t, 0.1);
    L.g.gain.setTargetAtTime(0.12 + p * 0.24, t, 0.2);
    const now = performance.now() / 1000;
    if (now >= L.nextBeat) { L.nextBeat = now + (0.95 - p * 0.6); this.heartbeat(0.45 + p * 0.55); }
  }

  /** 鼓動（ドクン） */
  heartbeat(a = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [d, k] of [[0, 1], [0.17, 0.7]]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(62, t + d); o.frequency.exponentialRampToValueAtTime(34, t + d + 0.18);
      const g = ctx.createGain(); this.env(g.gain, t + d, 0.005, 0.5 * a * k, 0.22);
      o.connect(g).connect(this.sfx); o.start(t + d); o.stop(t + d + 0.3);
    }
  }

  /** 極太ビームの発射音 */
  megaFire(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 4000);
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, out.t); lp.frequency.exponentialRampToValueAtTime(300, out.t + 3.0);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.02, Math.min(1.4, out.gain * 3), 3.0);
    n.connect(lp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 3.4);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, out.t); o.frequency.exponentialRampToValueAtTime(40, out.t + 2.8);
    const og = ctx.createGain(); this.env(og.gain, out.t, 0.02, 0.35, 2.8);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 900;
    o.connect(olp).connect(og).connect(out.node); o.start(out.t); o.stop(out.t + 3.0);
    this.explosion(pos, 4);
    this.roar(pos, 1.3, 0.85);
  }

  /** 味方がやられた時の警報（低い2音） */
  allyLost(big = false) {
    if (!this.ctx || !this.throttle('lost', 0.8)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = big ? [392, 311, 261] : [440, 349];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = ctx.createGain(); this.env(g.gain, t + i * 0.22, 0.01, 0.16, 0.32);
      o.connect(lp).connect(g).connect(this.sfx); o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.4);
    });
  }

  /** 足を海面に叩きつける轟音 */
  stomp(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1600);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(40, out.t); o.frequency.exponentialRampToValueAtTime(18, out.t + 1.4);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.01, Math.min(1.2, out.gain * 3.0), 1.8);
    o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 2.0);
    this.explosion(pos, 3.2);
    for (let i = 0; i < 4; i++) setTimeout(() => this.splash(pos, 2.8), 120 + i * 140);
  }

  splash(pos, size = 1) {
    if (!this.ctx || !this.throttle('splash' + Math.round(size * 3), 0.05)) return;
    const ctx = this.ctx, out = this.spatial(pos, 120 * size);
    const a = Math.min(0.8, 0.5 * size) * out.gain * 2;
    if (a < 0.006) return;
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + Math.random() * 500; bp.Q.value = 0.5;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.01, a, 0.6 + size * 0.5);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 2);
  }

  footstep(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 900);
    const a = out.gain * 1.6;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(48, out.t); o.frequency.exponentialRampToValueAtTime(22, out.t + 0.8);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.02, a, 1.0);
    o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 1.2);
    this.splash(pos, 1.6);
  }

  roar(pos, intensity = 1, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1600);
    const t = out.t, dur = 3.2 * intensity;
    const a = Math.min(1, out.gain * 1.4) * intensity;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    const mix = ctx.createGain();
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(a, t + 0.35);
    env.gain.setValueAtTime(a, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const base = 105 * pitch;
    for (const det of [0, 7, -11, 15]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.25, t + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);
      o.detune.value = det * 6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7 + Math.random() * 4;
      const lg = ctx.createGain(); lg.gain.value = 9;
      lfo.connect(lg).connect(o.frequency);
      o.connect(mix); o.start(t); o.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const n = this.noise();
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 900; nb.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    n.connect(nb).connect(ng).connect(mix); n.start(t); n.stop(t + dur + 0.1);
    mix.connect(shaper);
    const formants = [[620, 5], [1150, 6], [2500, 8]];
    const sum = ctx.createGain(); sum.gain.value = 0.55;
    for (const [f, q] of formants) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * pitch; bp.Q.value = q;
      shaper.connect(bp).connect(sum);
    }
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 380;
    shaper.connect(low).connect(sum);
    sum.connect(env).connect(out.node);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(45, t); sub.frequency.linearRampToValueAtTime(38, t + dur);
    const sg = ctx.createGain(); this.env(sg.gain, t, 0.3, a * 0.8, dur);
    sub.connect(sg).connect(out.node); sub.start(t); sub.stop(t + dur + 0.2);
  }

  kaijuPain(pos, s = 0.38) { if (this.throttle('pain', 0.6)) this.roar(pos, Math.min(0.9, s), 1.45); }
  headKilled(pos) { this.explosion(pos, 3); this.roar(pos, 0.6, 1.25); }

  telegraph(kind, isPlayer, pos, key) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // 溜めの音（頭ごとに音程が違う）
    const out = this.spatial(pos, 900);
    const t = out.t;
    const p = HEAD_PITCH[key || 'all'];
    const dur = kind === 'converge' ? 2.4 : kind === 'sweep' ? 1.5 : 1.2;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120 * p, t); o.frequency.exponentialRampToValueAtTime(900 * p, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300 * p, t); bp.frequency.exponentialRampToValueAtTime(2200 * p, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, out.gain * 0.6), t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(bp).connect(g).connect(out.node); o.start(t); o.stop(t + dur + 0.2);
    if (kind === 'tail' || kind === 'claw') this.roar(pos, 0.35, 1.1);
    // 警告音（自分が狙われている時・大技）
    if (isPlayer || kind === 'converge' || kind === 'tail' || kind === 'claw') {
      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const b = ctx.createOscillator(); b.type = 'square';
        b.frequency.value = i % 2 ? 660 : 990;
        const bg = ctx.createGain();
        this.env(bg.gain, now + i * 0.16, 0.005, 0.09, 0.12);
        b.connect(bg).connect(this.sfx); b.start(now + i * 0.16); b.stop(now + i * 0.16 + 0.16);
      }
    }
  }

  beam(kind, key, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1200);
    const t = out.t, p = HEAD_PITCH[key] || 1;
    const dur = kind === 'converge' ? 1.2 : 1.5;
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 * p; lp.Q.value = 4;
    const g = ctx.createGain(); this.env(g.gain, t, 0.03, Math.min(1, out.gain * 1.8), dur);
    n.connect(lp).connect(g).connect(out.node); n.start(t); n.stop(t + dur + 0.3);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70 * p, t); o.frequency.linearRampToValueAtTime(55 * p, t + dur);
    const g2 = ctx.createGain(); this.env(g2.gain, t, 0.02, Math.min(0.8, out.gain * 1.2), dur);
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600;
    o.connect(lp2).connect(g2).connect(out.node); o.start(t); o.stop(t + dur + 0.2);
  }

  bolt(pos) {
    if (!this.ctx || !this.throttle('bolt', 0.06)) return;
    const ctx = this.ctx, out = this.spatial(pos, 700);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(2400, out.t); o.frequency.exponentialRampToValueAtTime(220, out.t + 0.25);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.003, out.gain * 0.5, 0.25);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    o.connect(lp).connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 0.3);
  }

  swipe(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1000);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(200, out.t); bp.frequency.exponentialRampToValueAtTime(1200, out.t + 0.3); bp.frequency.exponentialRampToValueAtTime(300, out.t + 0.8);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.05, out.gain * 1.6, 0.9);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 1.2);
    for (let i = 0; i < 3; i++) setTimeout(() => this.splash(pos, 2.5), 250 + i * 120);
  }

  ui(name) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const freqs = name === 'start' ? [523, 659, 784] : name === 'respawn' ? [659, 880] : name === 'back' ? [440, 330] : [880];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this.env(g.gain, t + i * 0.07, 0.005, 0.12, 0.18);
      o.connect(g).connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25);
    });
  }

  // ------------------------------------------------------------------ 環境音・エンジン
  startAmbience() {
    const ctx = this.ctx;
    const n = this.noise(this.brownBuf, true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.18;
    lfo.connect(lg).connect(g.gain);
    n.connect(lp).connect(g).connect(this.amb);
    n.start(); lfo.start();
    // 風（飛行中に大きくなる）
    const w = this.noise(this.noiseBuf, true);
    const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 700; wb.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0;
    w.connect(wb).connect(wg).connect(this.amb); w.start();
    this.loops.wind = { g: wg, f: wb };
    // エンジン（船: 低いうなり / ジェット: 高音 / レシプロ: 断続）
    const eo = ctx.createOscillator(); eo.type = 'sawtooth'; eo.frequency.value = 55;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300;
    const eg = ctx.createGain(); eg.gain.value = 0;
    eo.connect(ef).connect(eg).connect(this.sfx); eo.start();
    const jn = this.noise(this.noiseBuf, true);
    const jf = ctx.createBiquadFilter(); jf.type = 'bandpass'; jf.frequency.value = 1800; jf.Q.value = 1.2;
    const jg = ctx.createGain(); jg.gain.value = 0;
    jn.connect(jf).connect(jg).connect(this.sfx); jn.start();
    this.loops.engine = { o: eo, f: ef, g: eg, jf, jg };
    // 機銃
    const mo = ctx.createOscillator(); mo.type = 'square'; mo.frequency.value = 26;
    const mn = this.noise(this.noiseBuf, true);
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 1300; mf.Q.value = 0.7;
    const mg = ctx.createGain(); mg.gain.value = 0;
    const am = ctx.createGain(); am.gain.value = 0;
    const amScale = ctx.createGain(); amScale.gain.value = 0.5;
    mo.connect(amScale).connect(am.gain);
    mn.connect(mf).connect(am).connect(mg).connect(this.sfx);
    mo.start(); mn.start();
    this.loops.mg = { g: mg, o: mo };
    // 報道ヘリのローター音（バタバタという羽音＋タービンの高音）
    const hn = this.noise(this.brownBuf, true);
    const hbp = ctx.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 110; hbp.Q.value = 0.9;
    const ham = ctx.createGain(); ham.gain.value = 0.55;
    const hlfo = ctx.createOscillator(); hlfo.type = 'square'; hlfo.frequency.value = 19.5;
    const hlg = ctx.createGain(); hlg.gain.value = 0.45;
    hlfo.connect(hlg).connect(ham.gain);
    const hw = ctx.createOscillator(); hw.type = 'triangle'; hw.frequency.value = 1680;
    const hwg = ctx.createGain(); hwg.gain.value = 0.035;
    const hg = ctx.createGain(); hg.gain.value = 0;
    hn.connect(hbp).connect(ham).connect(hg);
    hw.connect(hwg).connect(hg);
    hg.connect(this.amb);
    hn.start(); hlfo.start(); hw.start();
    this.loops.heli = { g: hg };
  }

  /** 報道ヘリの音の大きさ（0で無音） */
  setHeli(level) {
    if (!this.ctx || !this.loops.heli) return;
    this.loops.heli.g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.25);
  }

  /** テレビ中継の音（スピーカー越しのこもった音・音楽を下げる） */
  setTV(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tvLP.frequency.setTargetAtTime(on ? 5200 : 20000, t, 0.08);
    this.tvHP.frequency.setTargetAtTime(on ? 170 : 10, t, 0.08);
    this.musicBus.gain.setTargetAtTime(on ? this.musicVolume * 0.25 : this.musicVolume, t, 0.3);
  }

  /** ニュースの速報チャイム */
  tvJingle(urgent = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = urgent ? [1318.5, 1661.2, 1975.5, 1661.2, 1975.5] : [1046.5, 1318.5, 1568];
    notes.forEach((f, i) => {
      for (const [type, mul, a] of [['sine', 1, 0.16], ['triangle', 2, 0.04]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
        const g = ctx.createGain(); this.env(g.gain, t + i * 0.13, 0.005, a, 0.7);
        o.connect(g).connect(this.sfx); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.9);
      }
    });
  }

  /** 画面が切り替わる時の電波の雑音 */
  tvStatic(dur = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.setValueAtTime(0.18, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp).connect(g).connect(this.sfx); n.start(t); n.stop(t + dur + 0.05);
  }

  startBattle(b) { this.battle = b; }
  stopBattle() {
    this.battle = null;
    if (!this.ctx) return;
    this.setHeli(0);
    this.setTV(false);
    this.megaCharge(false);
    const e = this.loops.engine, t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0, t, 0.2); e.jg.gain.setTargetAtTime(0, t, 0.2);
    this.loops.mg.g.gain.setTargetAtTime(0, t, 0.05);
    this.loops.wind.g.gain.setTargetAtTime(0, t, 0.5);
    this.music(null);
  }

  update(dt, b) {
    if (!this.ctx) return;
    const cam = b.camera;
    this.listener.copy(cam.position);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    const p = b.player;
    const e = this.loops.engine;
    if (p && p.alive) {
      if (p.kind === 'ship') {
        const k = Math.abs(p.speed) / 20;
        e.o.frequency.setTargetAtTime(42 + k * 30, t, 0.3);
        e.g.gain.setTargetAtTime(0.05 + k * 0.08, t, 0.3);
        e.jg.gain.setTargetAtTime(0.0, t, 0.3);
        this.loops.wind.g.gain.setTargetAtTime(0.08, t, 0.5);
      } else {
        const th = p.throttle || 0.5;
        if (p.type === 'zero') {
          e.o.frequency.setTargetAtTime(70 + th * 50, t, 0.2);
          e.g.gain.setTargetAtTime(0.12 + th * 0.08, t, 0.2);
          e.f.frequency.setTargetAtTime(900, t, 0.2);
          e.jg.gain.setTargetAtTime(0.02, t, 0.2);
        } else {
          e.o.frequency.setTargetAtTime(90 + th * 60, t, 0.2);
          e.g.gain.setTargetAtTime(0.04, t, 0.2);
          e.jf.frequency.setTargetAtTime(1200 + th * 1600, t, 0.2);
          e.jg.gain.setTargetAtTime(0.05 + th * 0.12, t, 0.2);
        }
        this.loops.wind.g.gain.setTargetAtTime(0.06 + (p.speed / 240) * 0.18, t, 0.3);
        this.loops.wind.f.frequency.setTargetAtTime(500 + p.speed * 4, t, 0.3);
      }
    } else {
      e.g.gain.setTargetAtTime(0, t, 0.3);
      e.jg.gain.setTargetAtTime(0, t, 0.3);
    }
    const gunOn = this.gunOn && performance.now() - this.gunT < 120;
    const ship = this.gunKind === 'ship';
    this.loops.mg.o.frequency.setTargetAtTime(ship ? 16 : (p && p.type === 'zero' ? 14 : 26), t, 0.02);
    this.loops.mg.g.gain.setTargetAtTime(gunOn ? (ship ? 0.3 : 0.22) : 0, t, 0.02);
    this.updateMusic(dt, b);
  }

  // ------------------------------------------------------------------ 音楽（手続き生成の緊張感あるループ）
  music(state) {
    this.musicState = state;
    if (!this.ctx) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    if (state === 'victory') this.chord([146.8, 220, 293.7, 370, 440], 5, 0.16);
    if (state === 'defeat') this.chord([73.4, 87.3, 110, 130.8], 6, 0.16);
  }

  chord(freqs, dur, amp) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2200, t + dur * 0.4);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp / freqs.length, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(this.musicBus); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  updateMusic(dt, b) {
    if (this.musicState !== 'battle') return;
    const ctx = this.ctx;
    const rage = b.kaiju && b.kaiju.rage;
    const bpm = rage ? 104 : 86;
    const spb = 60 / bpm / 2;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat, i = this.beat % 16;
      const pattern = rage ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
      if (pattern[i]) this.taiko(t, i === 0 || i === 8 ? 1 : 0.6);
      if (i % 2 === 1 && rage) this.tick(t);
      if (this.beat % 32 === 0) this.drone(t, spb * 32, rage);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  taiko(t, a) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const g = ctx.createGain(); this.env(g.gain, t, 0.003, 0.5 * a, 0.45);
    o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 0.5);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 1;
    const ng = ctx.createGain(); this.env(ng.gain, t, 0.002, 0.25 * a, 0.15);
    n.connect(bp).connect(ng).connect(this.musicBus); n.start(t); n.stop(t + 0.2);
  }

  tick(t) {
    const ctx = this.ctx;
    const n = this.noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); this.env(g.gain, t, 0.001, 0.05, 0.05);
    n.connect(hp).connect(g).connect(this.musicBus); n.start(t); n.stop(t + 0.08);
  }

  drone(t, dur, rage) {
    const ctx = this.ctx;
    const root = rage ? 77.8 : 73.4;
    for (const [f, a] of [[root, 0.08], [root * 1.5, 0.05], [root * 2, 0.035], [root * (rage ? 1.06 : 1.19), 0.03]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rage ? 520 : 360;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.musicBus); o.start(t); o.stop(t + dur + 0.1);
    }
  }
}
return { AudioEngine };
})();

// ==== src/game/kaijuModel.js
__mod["src/game/kaijuModel.js"] = (function () {
// 怪獣ヨモツの見た目（モデル・マテリアル・アニメーションの重ね合わせ・首の照準）
const THREE = __DEPS["three"];
const { damp, clamp, DEG } = __mod["src/core/util.js"];

const HEAD_KEYS = ['R', 'C', 'L']; // 画面左(水色) / 中央(紫) / 画面右(赤)
const HEAD_INFO = {
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

class KaijuModel {
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
return { HEAD_KEYS, HEAD_INFO, KaijuModel };
})();

// ==== src/ui/hud.js
__mod["src/ui/hud.js"] = (function () {
// 戦闘中の HUD（最小限: 街までの距離・残弾・爆撃ゲージ・警告 ＋ 首のHP・無線・レーダー）
const THREE = __DEPS["three"];
const { HEAD_KEYS, HEAD_INFO } = __mod["src/game/kaijuModel.js"];
const { WORLD, SHIP, FIGHTER } = __mod["src/config.js"];
const { clamp, formatTime } = __mod["src/core/util.js"];

const ATTACK_TEXT = {
  bolts: { head: 'R', name: '連射ビーム', tip: '横へ動いて弾の間をすり抜けろ', tipShip: '舵を切って弾道から外れろ' },
  sweep: { head: 'C', name: '薙ぎ払い', tip: '高度を変えて光る帯から離れろ！ 溜め中の頭を撃てば止まる', tipShip: '全速で光る帯を前へ抜けろ！ 溜め中の頭を撃てば止まる' },
  trace: { head: 'L', name: '海面ビーム', tip: '赤い線から横へ離れろ（低空は水柱に注意）', tipShip: '赤い線から横へ！ 怪獣の周りを回るように動くと避けやすい' },
  tail: { head: null, name: 'しっぽの薙ぎ払い', tip: '赤い範囲から離れろ' },
  claw: { head: null, name: '爪の薙ぎ払い', tip: '赤い範囲から離れろ' },
  converge: { head: null, name: '収束ビーム', tip: '赤い円から逃げろ！ どれか1本の首を怯ませれば止まる' },
};

const _p = new THREE.Vector3();
/** 画面に出す文字（プレイヤー名など）を HTML として解釈させない */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class HUD {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="city">
          <div class="city-label"><span>街まで</span><b class="city-km">--</b><span class="city-time"></span></div>
          <div class="city-track"><div class="city-fill"></div><div class="city-kaiju">▲</div><div class="city-icon">🏙</div></div>
        </div>
        <div class="heads">
          ${HEAD_KEYS.map((k) => `<div class="head head-${k}" style="--c:${HEAD_INFO[k].css}"><div class="head-name">${HEAD_INFO[k].name}</div><div class="head-bar"><i></i></div><div class="head-tag"></div></div>`).join('')}
        </div>
        <div class="rage-tag">怒り</div>
      </div>
      <div class="warn"><div class="warn-title"></div><div class="warn-tip"></div></div>
      <div class="edge-markers"></div>
      <div class="toast-area"></div>
      <div class="big"><div class="big-title"></div><div class="big-sub"></div></div>
      <div class="radio"></div>
      <div class="allies"></div>
      <canvas class="radar" width="220" height="220"></canvas>
      <div class="weapons"></div>
      <div class="reticle"><div class="ret-ring"></div><div class="ret-text"></div></div>
      <div class="gunsight"><div class="gs-cross"></div><div class="gs-gun">GUN</div><div class="gs-heat"><i></i></div></div>
      <div class="torp-lead"><span>魚雷の狙い目</span></div>
      <div class="torp-marks"></div>
      <div class="look-hint"></div>
      <div class="lockbox"></div>
      <div class="bombmark"></div>
      <div class="chance-marks"></div>
      <div class="down"><div class="down-title">撃破された</div><div class="down-sub"></div><div class="down-timer"></div></div>
      <div class="arena-warn">戦闘区域外 ― 怪獣の方へ戻れ</div>
      <div class="hitmarks"></div>
      <div class="kill-banner"><div class="kb-band"><div class="kb-kind"></div><div class="kb-text"><div class="kb-name"></div><div class="kb-cause"></div></div></div></div>
      <div class="mega">
        <div class="mega-title">極太ビーム 発射まで</div>
        <div class="mega-count">10</div>
        <div class="mega-gauge"><i></i><span>阻止ゲージ ― 撃ちまくって止めろ！</span></div>
      </div>
      <div class="name-tags"></div>
    `;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.q = q;
    this.cityKm = q('.city-km'); this.cityTime = q('.city-time'); this.cityFill = q('.city-fill'); this.cityKaiju = q('.city-kaiju');
    this.heads = {};
    for (const k of HEAD_KEYS) this.heads[k] = { el: q(`.head-${k}`), bar: q(`.head-${k} .head-bar i`), tag: q(`.head-${k} .head-tag`) };
    this.rageTag = q('.rage-tag');
    this.warn = q('.warn'); this.warnTitle = q('.warn-title'); this.warnTip = q('.warn-tip');
    this.edge = q('.edge-markers');
    this.toastArea = q('.toast-area');
    this.big = q('.big'); this.bigTitle = q('.big-title'); this.bigSub = q('.big-sub');
    this.radioEl = q('.radio');
    this.alliesEl = q('.allies');
    this.radar = q('.radar');
    this.rctx = this.radar.getContext('2d');
    this.weapons = q('.weapons');
    this.reticle = q('.reticle'); this.retRing = q('.ret-ring'); this.retText = q('.ret-text');
    this.gunsight = q('.gunsight'); this.gsGun = q('.gs-gun'); this.gsHeat = q('.gs-heat i');
    this.torpLead = q('.torp-lead');
    this.torpMarks = q('.torp-marks');
    this.lookHint = q('.look-hint');
    this.lockbox = q('.lockbox');
    this.bombmark = q('.bombmark');
    this.chanceEl = q('.chance-marks');
    this.down = q('.down'); this.downSub = q('.down-sub'); this.downTimer = q('.down-timer');
    this.arenaWarnEl = q('.arena-warn');
    this.hitmarks = q('.hitmarks');
    this.kb = q('.kill-banner'); this.kbKind = q('.kb-kind'); this.kbName = q('.kb-name'); this.kbCause = q('.kb-cause');
    this.kbQueue = [];
    this.kbUntil = 0;
    this.megaEl = q('.mega'); this.megaCount = q('.mega-count'); this.megaFill = q('.mega-gauge i'); this.megaTitle = q('.mega-title');
    this.nameTags = q('.name-tags');
    this.warnUntil = 0;
    this.bigUntil = 0;
    this.threats = [];
    this.battle = null;
    this.t = 0;
    this.chances = [];
  }

  attach(b) {
    this.battle = b;
    this.radioEl.innerHTML = '';
    this.toastArea.innerHTML = '';
    this.threats = [];
    this.down.classList.remove('on');
    this.kbQueue = [];
    this.kb.classList.remove('on');
    this.setMega(null);
    this.nameTags.innerHTML = ''; this._ntHtml = '';
    this.buildWeapons();
    this.buildAllies();
  }
  detach() { this.battle = null; this.show(false); }
  show(on) { this.el.classList.toggle('hidden', !on); }

  buildWeapons() {
    const p = this.battle.player;
    const touch = this.battle.devices && this.battle.devices.isTouch;
    const key = (k) => (touch ? '' : `<kbd>${k}</kbd>`);
    if (p.kind === 'ship') {
      this.weapons.innerHTML = `
        <div class="w-row"><span class="w-label">主砲 127mm</span><div class="w-gauge gun"><i></i></div>${key('左クリック')}</div>
        <div class="w-row"><span class="w-label">機関砲</span><div class="w-gauge heat"><i></i></div>${key('Space 長押し')}</div>
        <div class="w-row w-torp-row"><span class="w-label">魚雷</span><span class="w-torps">${'<i></i>'.repeat(SHIP.torpedo.count)}</span><b class="w-torp"></b>${key('F')}</div>
        <div class="w-row"><span class="w-label">速力</span><div class="w-speed">${SHIP.speedNames.map((n, i) => `<span data-i="${i}">${n}</span>`).join('')}</div></div>
        <div class="w-row"><span class="w-label">舵</span><div class="w-rudder"><i></i></div><b class="w-kn"></b></div>`;
    } else {
      this.weapons.innerHTML = `
        <div class="w-row"><span class="w-label">速度</span><b class="w-spd"></b><span class="w-label">高度</span><b class="w-alt"></b></div>
        <div class="w-row"><span class="w-label">機関砲</span><div class="w-gauge heat"><i></i></div>${key('左クリック/Space')}</div>
        <div class="w-row"><span class="w-label">${p.cfg.missile ? 'ミサイル' : 'ロケット弾'}</span><b class="w-msl"></b><span class="w-lock"></span>${key('E')}</div>
        <div class="w-row"><span class="w-label">爆撃</span><div class="w-gauge bomb"><i></i></div><b class="w-bombtxt"></b>${key('F')}</div>`;
    }
    this.weaponsKind = p.kind;
    this.gunsight.style.display = p.kind === 'fighter' ? 'block' : 'none';
    this.reticle.style.display = p.kind === 'ship' ? 'block' : 'none';
    this.lookHint.textContent = touch ? '画面をドラッグで見回す' : (p.kind === 'ship' ? '右ドラッグ: 見回す ／ C: 怪獣の方へ戻す' : '右ドラッグ: 見回す ／ C: 怪獣を追うカメラ');
    this.lookHint.classList.add('on');
    clearTimeout(this.lookHintTimer);
    this.lookHintTimer = setTimeout(() => this.lookHint.classList.remove('on'), 14000);
  }

  buildAllies() {
    const b = this.battle;
    const list = b.vehicles.filter((v) => !v.isPlayer);
    this.alliesEl.innerHTML = list.map((v, i) => `<div class="ally" data-i="${i}"><i class="ally-ico ${v.kind}"></i>${esc(v.callsign)}</div>`).join('');
    this.allyList = list;
  }

  allyLost(v) {
    const i = this.allyList ? this.allyList.indexOf(v) : -1;
    if (i >= 0) this.alliesEl.children[i].classList.add('lost');
  }

  /** 味方がやられた時に画面いっぱいに出す帯（続けてやられたら順番に出す） */
  killBanner(v, causeText, opts = {}) {
    const kind = v.kind === 'fighter' ? '撃墜' : v.kind === 'carrier' ? '轟沈' : '撃沈';
    this.kbQueue.push({ kind, name: v.name || v.callsign, cause: causeText, mine: !!opts.mine, color: opts.color });
    if (this.kbQueue.length > 4) this.kbQueue.splice(1, this.kbQueue.length - 4);
    if (this.t >= this.kbUntil) this.nextKillBanner();
  }

  nextKillBanner() {
    const k = this.kbQueue.shift();
    if (!k) { this.kb.classList.remove('on'); return; }
    this.kbKind.textContent = k.kind;
    this.kbName.textContent = k.name;
    this.kbCause.textContent = k.cause ? `― ${k.cause}` : '';
    this.kb.classList.toggle('mine', k.mine);
    this.kb.classList.toggle('carrier', k.kind === '轟沈');
    this.kb.classList.remove('on');
    void this.kb.offsetWidth;
    this.kb.classList.add('on');
    this.kbUntil = this.t + (this.kbQueue.length ? 1.6 : 2.6);
    const post = this.battle && this.battle.world.pipe.post;
    if (post) post.uDanger.value = Math.max(post.uDanger.value, 0.9);
  }

  /** 極太ビームの溜め: 残り秒数と阻止ゲージ（null で隠す） */
  setMega(state) {
    if (!state) { this.megaEl.classList.remove('on', 'fire', 'stopped'); return; }
    this.megaEl.classList.add('on');
    this.megaEl.classList.toggle('fire', state.phase === 'fire');
    this.megaEl.classList.toggle('stopped', state.phase === 'stopped');
    this.megaTitle.textContent = state.phase === 'fire' ? '極太ビーム 発射！' : state.phase === 'stopped' ? '阻止成功！' : '極太ビーム 発射まで';
    const n = state.phase === 'charge' ? String(Math.max(0, Math.ceil(state.left))) : state.phase === 'fire' ? '!!' : '◎';
    if (this.megaCount.textContent !== n) {
      this.megaCount.textContent = n;
      this.megaCount.classList.remove('tick');
      void this.megaCount.offsetWidth;
      this.megaCount.classList.add('tick');
    }
    this.megaFill.style.width = `${clamp(state.progress, 0, 1) * 100}%`;
  }

  /** マルチプレイ: 他のプレイヤーの機体の上に名前を出す */
  updateNameTags() {
    const b = this.battle;
    let html = '';
    for (const v of b.vehicles) {
      if (!v.human || v.isPlayer || !v.alive) continue;
      const p = v.position.clone();
      p.y += v.kind === 'fighter' ? 14 : 45;
      const s = this.project(p);
      if (s.behind || s.x < -50 || s.y < -50 || s.x > innerWidth + 50 || s.y > innerHeight + 50) continue;
      const d = v.position.distanceTo(b.camera.position);
      html += `<div class="ntag ${v.kind}" style="transform:translate(${s.x}px,${s.y}px)"><b>${esc(v.name)}</b><span>${(d / 1000).toFixed(1)}km</span></div>`;
    }
    if (html !== this._ntHtml) { this.nameTags.innerHTML = html; this._ntHtml = html; }
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.toastArea.appendChild(d);
    while (this.toastArea.children.length > 3) this.toastArea.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2800);
  }

  bigMessage(title, sub, color = '#fff') {
    this.bigTitle.textContent = title;
    this.bigSub.textContent = sub || '';
    this.big.style.setProperty('--c', color);
    this.big.classList.remove('on');
    void this.big.offsetWidth;
    this.big.classList.add('on');
    this.bigUntil = this.t + 3.2;
  }

  radio(who, text, kind = '') {
    const d = document.createElement('div');
    d.className = `rmsg ${kind}`;
    d.innerHTML = `<b>${esc(who)}</b>${esc(text)}`;
    this.radioEl.appendChild(d);
    while (this.radioEl.children.length > 5) this.radioEl.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  telegraph(kind, atk, targetIsPlayer, origin) {
    const info = ATTACK_TEXT[kind];
    const color = info.head ? HEAD_INFO[info.head].css : '#ff4a3a';
    const who = info.head ? HEAD_INFO[info.head].name + ' ' : '';
    const meleeNear = (kind === 'tail' || kind === 'claw');
    const relevant = targetIsPlayer || kind === 'converge' || meleeNear;
    if (relevant) {
      this.warnTitle.textContent = `⚠ ${who}${info.name}${targetIsPlayer ? ' ― 狙われている！' : ''}`;
      const isShip = this.battle && this.battle.player && this.battle.player.kind === 'ship';
      this.warnTip.textContent = (isShip && info.tipShip) || info.tip;
      this.warn.style.setProperty('--c', color);
      this.warn.classList.add('on');
      this.warnUntil = this.t + Math.max(1.4, (atk.telegraph || 1.2) + 0.4);
    }
    this.threats.push({ pos: origin.clone(), color, until: this.t + (atk.telegraph || 1.2) + 0.5, big: relevant });
  }

  chance(key) {
    if (!this.battle) return;
    this.chances.push({ key, until: this.t + 1.8 });
  }

  hitMarker(head, kind, dmg) {
    if (kind === 'gun') {
      // 機銃は少しずつ当たるので、まとめて表示する
      this.gunAcc = (this.gunAcc || 0) + dmg;
      this.gunHead = head || this.gunHead;
      if (this.t - (this.gunShown || 0) < 0.6 || this.gunAcc < 4) return;
      dmg = this.gunAcc; head = this.gunHead;
      this.gunAcc = 0; this.gunHead = null; this.gunShown = this.t;
    }
    const d = document.createElement('div');
    d.className = 'hm' + (head ? ' head' : '') + (kind === 'gun' ? ' small' : '');
    d.textContent = Math.round(dmg);
    d.style.left = `${50 + (Math.random() - 0.5) * 6}%`;
    d.style.top = `${46 + (Math.random() - 0.5) * 4}%`;
    this.hitmarks.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  warnArena(on) { this.arenaWarnEl.classList.toggle('on', on); }

  playerDown(cause, practice) {
    this.down.classList.add('on');
    this.downSub.textContent = cause;
    this.downTimer.textContent = practice ? '味方が近づくと復活できる' : '';
  }

  setRespawn(sec) {
    if (sec === null) { this.down.classList.remove('on'); return; }
    this.downTimer.textContent = `味方が近づくと復活（自動復活まで ${Math.ceil(sec)} 秒）`;
  }

  project(p) {
    _p.copy(p).project(this.battle.camera);
    return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight, behind: _p.z > 1 };
  }

  update(dt) {
    const b = this.battle;
    if (!b) return;
    this.t += dt;
    const k = b.kaiju;
    // 街までの距離
    const dist = k.distanceToCity;
    const total = WORLD.cityDistance - 40;
    const prog = clamp(1 - dist / total, 0, 1);
    this.cityKm.textContent = `${(dist / 1000).toFixed(2)} km`;
    const eta = k.speed > 0.5 ? dist / k.speed : Infinity;
    this.cityTime.textContent = isFinite(eta) ? `到達まで ${formatTime(eta)}` : '';
    this.cityFill.style.width = `${prog * 100}%`;
    this.cityKaiju.style.left = `${prog * 100}%`;
    this.el.classList.toggle('danger-city', dist < 900);
    // 首
    for (const key of HEAD_KEYS) {
      const h = k.heads[key], ui = this.heads[key];
      ui.bar.style.width = `${clamp(h.hp / h.maxHp, 0, 1) * 100}%`;
      const tag = !h.alive ? '撃破' : h.state === 'charge' ? '溜め' : h.state === 'fire' ? '発射' : h.state === 'recover' ? '硬直' : h.state === 'stunned' ? '怯み' : '';
      if (ui.tag.textContent !== tag) ui.tag.textContent = tag;
      ui.el.dataset.state = h.alive ? h.state : 'dead';
    }
    this.rageTag.classList.toggle('on', k.rage && !k.dead);
    if (this.t > this.warnUntil) this.warn.classList.remove('on');
    if (this.t > this.bigUntil) this.big.classList.remove('on');
    if (this.kb.classList.contains('on') && this.t >= this.kbUntil) this.nextKillBanner();
    this.updateNameTags();
    const post = b.world.pipe.post;
    post.uDanger.value = Math.max(0, post.uDanger.value - dt * 0.5);
    this.updatePlayer(dt);
    this.updateMarkers();
    this.drawRadar();
  }

  /** 機関砲の熱ゲージ */
  setHeat(el, g) {
    if (!el) return;
    el.style.width = `${clamp(g.heat, 0, 1) * 100}%`;
    el.parentElement.classList.toggle('over', g.over > 0);
    el.parentElement.classList.toggle('hot', g.heat > 0.7 && g.over <= 0);
  }

  updatePlayer(dt) {
    const b = this.battle, p = b.player, k = b.kaiju;
    if (!p) return;
    if (this.weaponsKind !== p.kind) this.buildWeapons();
    const q = this.q;
    this.updateTorpedoMarks(p);
    if (p.kind === 'ship') {
      const g = q('.w-gauge.gun i');
      if (g) g.style.width = `${(1 - p.gunReload / SHIP.gun.reload) * 100}%`;
      this.setHeat(q('.w-gauge.heat i'), p.mg);
      // 魚雷: 残りの本数を●で。次の1本は装填の進み具合
      const icons = q('.w-torps');
      if (icons) {
        const prog = p.torps > 0 ? 1 - p.torpReload / SHIP.torpedo.reload : 0;
        icons.querySelectorAll('i').forEach((el, i) => {
          el.className = i < p.torps ? (i === p.torps - 1 && prog < 1 ? 'loading' : 'ready') : 'empty';
          el.style.setProperty('--p', i === p.torps - 1 ? prog : 1);
        });
      }
      const t = q('.w-torp'); if (t) t.textContent = p.torps > 0 ? (p.torpReload > 0 ? '装填中' : '発射可') : '残りなし';
      // 魚雷の狙い目（怪獣の進む先）
      const ta = p.torpAim;
      if (p.alive && ta && ta.leadValid && p.torps > 0 && !k.dead) {
        const s = this.project(ta.lead);
        if (!s.behind) {
          this.torpLead.style.display = 'block';
          this.torpLead.style.transform = `translate(${s.x}px, ${s.y}px)`;
          this.torpLead.classList.toggle('ready', p.torpReload <= 0);
        } else this.torpLead.style.display = 'none';
      } else this.torpLead.style.display = 'none';
      q('.w-speed')?.querySelectorAll('span').forEach((s) => s.classList.toggle('on', +s.dataset.i === p.speedIdx));
      const r = q('.w-rudder i'); if (r) r.style.left = `${50 + p.rudder * 46}%`;
      const kn = q('.w-kn'); if (kn) kn.textContent = `${Math.round(Math.abs(p.speed) * 1.944)} ノット`;
      // 照準
      const sol = p.gunSolution;
      const m = b.devices.mouse;
      const show = p.alive && b.devices.lastInput !== 'touch' && m.inside;
      this.reticle.style.display = show ? 'block' : 'none';
      if (show) {
        this.reticle.style.transform = `translate(${m.x}px, ${m.y}px)`;
        this.reticle.classList.toggle('ready', sol.ready);
        this.reticle.classList.toggle('far', !sol.inRange);
        const hitK = p.input && p.input.aimPoint && k.intersectSegment(b.camera.position, p.input.aimPoint.clone().lerp(b.camera.position, -0.01));
        this.reticle.classList.toggle('onk', !!hitK);
        this.retText.textContent = sol.valid ? (sol.inRange ? `${(p.position.distanceTo(sol.point) / 1000).toFixed(1)}km ${sol.time.toFixed(1)}s` : '射程外') : '';
      }
    } else {
      this.torpLead.style.display = 'none';
      q('.w-spd').textContent = `${Math.round(p.speed * 3.6)} km/h`;
      q('.w-alt').textContent = `${Math.round(p.position.y)} m`;
      this.setHeat(q('.w-gauge.heat i'), p.gun);
      this.setHeat(this.gsHeat, p.gun);
      // 照準（機首の向き 600m 先）を画面に投影
      if (p.alive) {
        const s = this.project(p.position.clone().addScaledVector(p.dir, 600));
        if (!s.behind) { this.gunsight.style.display = 'block'; this.gunsight.style.left = `${s.x}px`; this.gunsight.style.top = `${s.y}px`; }
        else this.gunsight.style.display = 'none';
        const onK = k && !k.dead && k.intersectSegment(p.position, p.position.clone().addScaledVector(p.dir, p.cfg.gun.range), 4);
        this.gunsight.classList.toggle('onk', !!onK);
      } else this.gunsight.style.display = 'none';
      const max = p.cfg.missile ? p.cfg.missile.count : p.cfg.rocket.count;
      q('.w-msl').textContent = `${p.missiles}/${max}`;
      const lk = q('.w-lock');
      const locked = p.lock.key && p.lock.t > 0.45;
      lk.textContent = p.cfg.missile ? (locked ? `ロック ${HEAD_INFO[p.lock.key].short}` : p.lock.key ? 'ロック中…' : '') : '';
      lk.style.color = locked ? HEAD_INFO[p.lock.key].css : '';
      const bg = q('.w-gauge.bomb i');
      bg.style.width = `${p.bombGauge * 100}%`;
      bg.parentElement.classList.toggle('full', p.bombGauge >= 1);
      q('.w-bombtxt').textContent = p.bombGauge >= 1 ? '投下可能 [F]' : '';
      this.gsGun.classList.toggle('on', p.gunActive);
      // ロックオン枠
      if (p.alive && p.lock.key && k.heads[p.lock.key].alive) {
        const s = this.project(k.headSpheres[p.lock.key].c);
        if (!s.behind) {
          this.lockbox.style.display = 'block';
          this.lockbox.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${locked ? 45 : 0}deg)`;
          this.lockbox.style.borderColor = locked ? HEAD_INFO[p.lock.key].css : '#ffffffaa';
        } else this.lockbox.style.display = 'none';
      } else this.lockbox.style.display = 'none';
      // 爆弾の着弾予想
      if (p.alive && p.bombGauge >= 1) {
        const tFall = Math.sqrt(Math.max(0, (2 * p.position.y) / 9.81));
        const pt = p.position.clone().addScaledVector(p.velocity, tFall * 0.95);
        pt.y = 0;
        const s = this.project(pt);
        if (!s.behind) { this.bombmark.style.display = 'block'; this.bombmark.style.transform = `translate(${s.x}px, ${s.y}px)`; } else this.bombmark.style.display = 'none';
      } else this.bombmark.style.display = 'none';
    }
  }

  /** 自分が撃って走っている魚雷の位置（海中で見えにくいので印を出す） */
  updateTorpedoMarks(p) {
    const list = p.kind === 'ship' ? this.battle.projectiles.torpedoesOf(p) : [];
    let html = '';
    for (const o of list) {
      if (o.phase !== 'run') continue;
      const s = this.project(o.p);
      if (s.behind || s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
      html += `<div class="tm" style="transform:translate(${s.x}px,${s.y}px)"></div>`;
    }
    if (html !== this._tmHtml) { this.torpMarks.innerHTML = html; this._tmHtml = html; }
  }

  updateMarkers() {
    const b = this.battle;
    // 画面外の脅威の方向
    this.threats = this.threats.filter((t) => t.until > this.t);
    let html = '';
    const k = b.kaiju;
    const items = [...this.threats.map((t) => ({ pos: t.pos, color: t.color, cls: t.big ? 'threat big' : 'threat' })), { pos: k.focus.clone(), color: '#b77cff', cls: 'kaiju', label: '怪獣' }];
    for (const it of items) {
      const s = this.project(it.pos);
      const m = 46;
      let { x, y } = s;
      const off = s.behind || x < 0 || y < 0 || x > innerWidth || y > innerHeight;
      if (!off && it.cls === 'kaiju') continue;
      if (s.behind) { x = innerWidth - x; y = innerHeight - y; }
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let dx = x - cx, dy = y - cy;
      if (!off) { html += `<div class="em ${it.cls} in" style="--c:${it.color};transform:translate(${x}px,${y}px)"></div>`; continue; }
      const sc = Math.min((cx - m) / Math.abs(dx || 1), (cy - m) / Math.abs(dy || 1));
      x = cx + dx * sc; y = cy + dy * sc;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      html += `<div class="em ${it.cls}" style="--c:${it.color};transform:translate(${x}px,${y}px) rotate(${ang}deg)"></div>`;
    }
    this.edge.innerHTML = html;
    // 硬直チャンス表示
    this.chances = this.chances.filter((c) => c.until > this.t && k.heads[c.key].alive);
    let ch = '';
    for (const c of this.chances) {
      const s = this.project(k.headSpheres[c.key].c);
      if (s.behind) continue;
      ch += `<div class="chance" style="--c:${HEAD_INFO[c.key].css};transform:translate(${s.x}px,${s.y - 40}px)">チャンス！</div>`;
    }
    this.chanceEl.innerHTML = ch;
  }

  drawRadar() {
    const b = this.battle, ctx = this.rctx, W = 220, R = 104;
    const p = b.player && (b.player.alive || b.player.dying) ? b.player : null;
    const center = p ? p.position : b.kaiju.pos;
    const scale = R / 4200;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,12,18,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(150,190,220,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    // 回転: プレイヤーの向きを上に
    const head = p ? (p.kind === 'fighter' ? p.yaw : p.heading) : Math.PI;
    ctx.rotate(head + Math.PI);
    const tx = (x, z) => [-(x - center.x) * scale, -(z - center.z) * scale];
    ctx.strokeStyle = 'rgba(150,190,220,0.12)';
    for (const r of [1000, 2000, 3000, 4000]) { ctx.beginPath(); ctx.arc(0, 0, r * scale, 0, Math.PI * 2); ctx.stroke(); }
    // 街の海岸線
    const [cx1, cz1] = tx(-8000, WORLD.cityDistance), [cx2, cz2] = tx(8000, WORLD.cityDistance);
    ctx.strokeStyle = 'rgba(255,220,140,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx1, cz1); ctx.lineTo(cx2, cz2); ctx.stroke();
    // 危険範囲
    for (const h of b.hazards) {
      ctx.fillStyle = 'rgba(255,70,50,0.35)'; ctx.strokeStyle = 'rgba(255,90,60,0.8)'; ctx.lineWidth = 1.5;
      if (h.type === 'line') {
        const [ax, az] = tx(h.a.x, h.a.z), [bx, bz] = tx(h.b.x, h.b.z);
        ctx.lineWidth = Math.max(2, h.width * scale); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
      } else if (h.type === 'circle') {
        const [x, z] = tx(h.c.x, h.c.z); ctx.beginPath(); ctx.arc(x, z, h.r * scale, 0, Math.PI * 2); ctx.fill();
      } else if (h.type === 'sector') {
        const [x, z] = tx(h.c.x, h.c.z);
        ctx.beginPath(); ctx.moveTo(x, z);
        const a0 = -h.dir - h.arc / 2 - Math.PI / 2 + Math.PI, a1 = -h.dir + h.arc / 2 - Math.PI / 2 + Math.PI;
        ctx.arc(x, z, h.outer * scale, a0, a1); ctx.closePath(); ctx.fill();
      }
    }
    // 怪獣
    const k = b.kaiju;
    const [kx, kz] = tx(k.pos.x, k.pos.z);
    ctx.fillStyle = k.rage ? '#ff4a3a' : '#b77cff';
    ctx.beginPath(); ctx.arc(kx, kz, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(kx, kz); ctx.lineTo(kx, kz - 16); ctx.stroke();
    // 自分の魚雷
    if (p && p.kind === 'ship') {
      ctx.fillStyle = '#bff3ff';
      for (const o of b.projectiles.torpedoesOf(p)) {
        const [x, z] = tx(o.p.x, o.p.z);
        ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
      }
    }
    // 味方
    for (const v of b.vehicles) {
      if (!v.alive || v.isPlayer) continue;
      const [x, z] = tx(v.position.x, v.position.z);
      ctx.fillStyle = v.kind === 'carrier' ? '#7fd0ff' : v.kind === 'ship' ? '#7fb8ff' : '#a8e6ff';
      if (v.kind === 'carrier') ctx.fillRect(x - 5, z - 5, 10, 10);
      else if (v.kind === 'ship') ctx.fillRect(x - 3, z - 3, 6, 6);
      else { ctx.beginPath(); ctx.arc(x, z, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    // 自機（中央・上向き）
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
return { HUD };
})();

// ==== src/ui/touch.js
__mod["src/ui/touch.js"] = (function () {
// iPad 向けタッチ操作
// 戦闘機: 左側どこでもドラッグで操縦（仮想スティック）＋右側のボタン。右側の空いた所をドラッグで見回す
// 船: 画面下の帯を左右ドラッグで舵、画面をタップで主砲（ドラッグなら見回す）、ボタンで機関砲・魚雷・速力
class TouchControls {
  constructor(root, devices) {
    this.dev = devices;
    this.el = document.createElement('div');
    this.el.className = 'touch hidden';
    this.el.innerHTML = `
      <div class="t-stick-zone"></div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-rudder"><div class="t-rudder-knob"></div><span>舵</span></div>
      <div class="t-buttons"></div>
      <button class="t-pause interactive" aria-label="一時停止">Ⅱ</button>`;
    root.appendChild(this.el);
    this.zone = this.el.querySelector('.t-stick-zone');
    this.stick = this.el.querySelector('.t-stick');
    this.knob = this.el.querySelector('.t-knob');
    this.rudder = this.el.querySelector('.t-rudder');
    this.rudderKnob = this.el.querySelector('.t-rudder-knob');
    this.buttons = this.el.querySelector('.t-buttons');
    this.pauseBtn = this.el.querySelector('.t-pause');
    this.mode = null;
    this.stickId = null;
    this.rudderId = null;
    this.lookId = null;
    this.onPause = null;
    this.pauseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onPause && this.onPause(); });
    this.bind();
  }

  setMode(mode) {
    this.mode = mode;
    this.el.classList.toggle('hidden', !mode);
    this.el.dataset.mode = mode || '';
    const t = this.dev.touch;
    t.stick.active = false; t.steerDrag = 0; t.buttons = {};
    if (mode === 'fighter') {
      this.buttons.innerHTML = `
        <button data-b="gun" class="tb big hold">機関砲</button>
        <button data-b="missile" class="tb big">ミサイル</button>
        <button data-b="bomb" class="tb">爆撃</button>
        <button data-b="look" class="tb">怪獣カメラ</button>
        <button data-b="boost" class="tb hold">加速</button>
        <button data-b="brake" class="tb hold">減速</button>`;
    } else if (mode === 'ship') {
      this.buttons.innerHTML = `
        <button data-b="mg" class="tb big hold">機関砲</button>
        <button data-b="torpedo" class="tb big">魚雷</button>
        <button data-b="speedUp" class="tb">速力 ▲</button>
        <button data-b="speedDown" class="tb">速力 ▼</button>`;
    } else this.buttons.innerHTML = '';
    this.buttons.querySelectorAll('.tb').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.dev.touch.buttons[name] = true;
        this.dev.touch.pressedButtons.add(name);
        this.dev.lastInput = 'touch';
        b.classList.add('on');
      });
      const up = (e) => { e.stopPropagation(); this.dev.touch.buttons[name] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  bind() {
    const t = this.dev.touch;
    const canvas = this.dev.canvas;
    const onDown = (e) => {
      if (e.pointerType !== 'touch' || !this.mode) return;
      this.dev.lastInput = 'touch';
      const x = e.clientX, y = e.clientY;
      if (this.mode === 'fighter') {
        if (x < innerWidth * 0.55 && this.stickId === null) {
          this.stickId = e.pointerId;
          this.sx = x; this.sy = y;
          this.stick.style.transform = `translate(${x}px, ${y}px)`;
          this.stick.classList.add('on');
          t.stick.active = true; t.stick.x = 0; t.stick.y = 0;
        } else if (this.lookId === null) {
          this.startLook(e, false);
        }
      } else if (this.mode === 'ship') {
        if (y > innerHeight - 130 && x > innerWidth * 0.2 && x < innerWidth * 0.8 && this.rudderId === null) {
          this.rudderId = e.pointerId;
          this.updateRudder(x);
        } else if (this.lookId === null) {
          // 指を離した時に動いていなければ「タップ＝主砲」、動かしたら見回し
          this.startLook(e, true);
        }
      }
    };
    const onMove = (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.stickId) {
        const r = 70;
        let dx = (e.clientX - this.sx) / r, dy = (e.clientY - this.sy) / r;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        t.stick.x = dx; t.stick.y = dy;
        this.knob.style.transform = `translate(${dx * r}px, ${dy * r}px)`;
      } else if (e.pointerId === this.rudderId) this.updateRudder(e.clientX);
      else if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
        this.lx = e.clientX; this.ly = e.clientY;
        if (!this.lookMoved && Math.hypot(e.clientX - this.lx0, e.clientY - this.ly0) > 14) { this.lookMoved = true; t.looking = true; }
        if (this.lookMoved) { t.lookDX += dx; t.lookDY += dy; }
      }
    };
    const onUp = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null; t.stick.active = false; t.stick.x = t.stick.y = 0;
        this.stick.classList.remove('on'); this.knob.style.transform = '';
      }
      if (e.pointerId === this.rudderId) { this.rudderId = null; t.steerDrag = 0; this.rudderKnob.style.left = '50%'; }
      if (e.pointerId === this.lookId) {
        if (!this.lookMoved && this.lookTap && performance.now() - this.lookT0 < 450) {
          t.tapAim = { nx: (this.lx0 / innerWidth) * 2 - 1, ny: -(this.ly0 / innerHeight) * 2 + 1 };
        }
        this.lookId = null; t.looking = false;
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
  }

  startLook(e, tapFires) {
    this.lookId = e.pointerId;
    this.lx = this.lx0 = e.clientX;
    this.ly = this.ly0 = e.clientY;
    this.lookMoved = false;
    this.lookTap = tapFires;
    this.lookT0 = performance.now();
  }

  updateRudder(x) {
    const r = this.rudder.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
    this.dev.touch.steerDrag = Math.abs(v) < 0.08 ? 0 : v;
    this.rudderKnob.style.left = `${(v * 0.5 + 0.5) * 100}%`;
  }
}
return { TouchControls };
})();

// ==== src/ui/menu.js
__mod["src/ui/menu.js"] = (function () {
// タイトル・設定（出撃前）・一時停止・結果画面
const { DIFFICULTY, MODES, CPU } = __mod["src/config.js"];
const { formatTime } = __mod["src/core/util.js"];

const VEHICLES = [
  { id: 'f15', name: '戦闘機 F-15J', sub: 'イーグル', role: '機動力で頭を狙う遊撃', good: '速い・小回り・当たり判定が小さい', bad: '強い武器ほど怪獣に近づく必要がある', weapons: '機関砲（押して乱射）／ミサイル8発（ロックオン）／爆撃（ゲージ）' },
  { id: 'destroyer', name: '護衛艦 やまなみ', sub: 'イージス駆逐艦', role: '遠距離から撃つ火力艦・おとり', good: '主砲で遠くから安定して撃てる・魚雷が強力', bad: '遅く、予告に気づくのが遅れると逃げ切れない', weapons: '127mm主砲（照準してクリック）／機関砲（押して乱射）／魚雷3本' },
  { id: 'zero', name: '零式艦上戦闘機', sub: 'レシプロ機', role: '旋回性能に優れた格闘機', good: '最も小回りがきく・機銃が強い', bad: '遅い・ミサイルの代わりに無誘導ロケット', weapons: '機関砲（押して乱射）／ロケット弾10発／爆撃（ゲージ）' },
];

const STORE_KEY = 'yomotsu-settings-v1';

function loadSettings() {
  const def = { vehicle: 'destroyer', mode: 'real', difficulty: 'normal', cpuCount: 4, cpuMix: { manual: false, fighters: 2 }, sky: 'day', quality: 'auto', volume: 0.8, music: 0.45, invertPitch: false };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s) return { ...def, ...s, cpuMix: { ...def.cpuMix, ...(s.cpuMix || {}) } };
  } catch (e) { /* 読めなくても既定値で動く */ }
  return def;
}

function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できない環境 */ }
}

function seg(name, options, value) {
  return `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

class Menu {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'menu interactive';
    root.appendChild(this.el);
    this.settings = loadSettings();
    this.recommended = null;
    this.render();
  }

  render() {
    const s = this.settings;
    this.el.innerHTML = `
      <div class="title-block">
        <div class="title-kicker">海上防衛戦</div>
        <h1 class="title">ヨモツ</h1>
        <div class="title-sub">三つ首の怪獣を、海で止めろ。</div>
      </div>
      <div class="panel">
        <div class="section">
          <div class="label">機体</div>
          <div class="vehicles">
            ${VEHICLES.map((v) => `
              <button class="vcard ${v.id === s.vehicle ? 'on' : ''}" data-v="${v.id}">
                <div class="vname">${v.name}<small>${v.sub}</small></div>
                <div class="vrole">${v.role}</div>
                <div class="vline good">＋ ${v.good}</div>
                <div class="vline bad">－ ${v.bad}</div>
                <div class="vweap">${v.weapons}</div>
              </button>`).join('')}
          </div>
        </div>
        <div class="grid">
          <div class="section"><div class="label">モード</div>${seg('mode', Object.entries(MODES).map(([k, m]) => [k, m.label]), s.mode)}
            <div class="hint">${s.mode === 'real' ? 'やられた機体は復活しない。自分がやられたらゲームオーバー' : '味方が近づくと復活できる。予告や操作に慣れる用'}</div></div>
          <div class="section"><div class="label">難易度</div>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), s.difficulty)}
            <div class="hint">怪獣のHP・予告の長さ・CPUの腕前がまとめて変わる</div></div>
          <div class="section"><div class="label">時間帯</div>${seg('sky', [['day', '昼'], ['dusk', '夕暮れ'], ['night', '夜']], s.sky)}</div>
          <div class="section"><div class="label">画質</div>${seg('quality', [['auto', '自動'], ['high', '高'], ['medium', '中'], ['low', '低']], s.quality)}</div>
        </div>
        <div class="section cpu">
          <div class="label">CPUの仲間 <b class="cpu-n">${s.cpuCount}</b> 機 <span class="reco">${this.recommended !== null ? `（この端末のおすすめ: ${this.recommended} 機）` : '（性能を測定中…）'}</span></div>
          <input type="range" min="0" max="${CPU.max}" value="${s.cpuCount}" class="cpu-range">
          <div class="cpu-mix">
            ${seg('mix', [['auto', '編成おまかせ'], ['manual', '手動']], s.cpuMix.manual ? 'manual' : 'auto')}
            <div class="mix-manual ${s.cpuMix.manual ? '' : 'hidden'}">戦闘機 <b class="mix-f">${Math.min(s.cpuMix.fighters, s.cpuCount)}</b> ／ 護衛艦 <b class="mix-s">${s.cpuCount - Math.min(s.cpuMix.fighters, s.cpuCount)}</b>
              <input type="range" min="0" max="${s.cpuCount}" value="${Math.min(s.cpuMix.fighters, s.cpuCount)}" class="mix-range"></div>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost help-btn">操作説明</button>
          <button class="btn ghost opt-btn">音量</button>
          <button class="btn ghost mp-btn">マルチプレイ</button>
          <button class="btn primary go">出撃</button>
        </div>
        <div class="opts hidden">
          <label>効果音 <input type="range" min="0" max="1" step="0.05" value="${s.volume}" class="vol"></label>
          <label>音楽 <input type="range" min="0" max="1" step="0.05" value="${s.music}" class="mus"></label>
          <label class="chk"><input type="checkbox" class="inv" ${s.invertPitch ? 'checked' : ''}> 戦闘機の上下を反転</label>
          <label class="chk"><input type="checkbox" class="voice" ${s.voice !== false ? 'checked' : ''}> 中継のアナウンサーの声</label>
        </div>
      </div>
      <div class="help hidden">
        <div class="help-inner">
          <h2>操作説明</h2>
          <div class="help-cols">
            <div><h3>戦闘機（PC）</h3><ul>
              <li><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> 機首の上げ下げ</li>
              <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> 旋回</li>
              <li><kbd>Shift</kbd> 加速　<kbd>Q</kbd> 減速</li>
              <li>左クリック / <kbd>Space</kbd> 長押し 機関砲（撃ち続けると過熱）</li>
              <li><kbd>E</kbd> ミサイル（頭に向けてロックオン）</li>
              <li><kbd>F</kbd> 爆撃（ゲージ満タンで1発）</li>
              <li>右ドラッグ 見回す（離すと戻る）</li>
              <li><kbd>C</kbd> 怪獣を追うカメラに切り替え</li></ul></div>
            <div><h3>護衛艦（PC）</h3><ul>
              <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> 舵（進路を変える）</li>
              <li><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> 速力を変える</li>
              <li>マウスで照準、左クリックで主砲（緑の輪で発射可能）</li>
              <li><kbd>Space</kbd> 長押し 機関砲（照準へ乱射・過熱に注意）</li>
              <li><kbd>F</kbd> / <kbd>E</kbd> 魚雷（1隻3本まで。海面の点線の方向へ1本ずつ）</li>
              <li>右ドラッグ 視点を自由に回す　<kbd>C</kbd> 怪獣の方へ戻す　ホイール ズーム</li></ul></div>
            <div><h3>iPad</h3><ul>
              <li>戦闘機: 画面左をドラッグして操縦、右のボタンで発射、右側の空いた所をドラッグで見回す</li>
              <li>護衛艦: 画面下の帯を左右にドラッグで舵、タップで主砲、ドラッグで見回す</li></ul>
              <h3>コツ</h3><ul>
              <li>怪獣の攻撃は当たれば一撃でやられるが、必ず光る予告がある</li>
              <li>頭が光って溜めている間に撃ち込むと怯んで止まる</li>
              <li>撃った直後の頭は硬直して大ダメージのチャンス</li>
              <li>HPが2割を切ると「極太ビーム」を10秒溜める。阻止ゲージが満タンになるまで撃ちまくれば止まる（紫の範囲の低空にいると巻き込まれる。戦闘機は高く上がれば助かる）</li>
              <li>空母の近くで補給（ミサイル・魚雷）</li>
              <li>登場シーン（テレビ中継）はクリックか <kbd>Enter</kbd> で飛ばせる</li>
              <li><kbd>Esc</kbd> / <kbd>P</kbd> 一時停止</li></ul>
              <h3>マルチプレイ</h3><ul>
              <li>メニューの「マルチプレイ」から。ホストはルーム名とパスワードを決めて「ルームを作る」、仲間は同じルーム名とパスワードを入れて「ルームに入る」（最大6人・インターネット接続が必要）</li>
              <li>入力した名前があなたの機体の名前になる（船は「○○丸」、戦闘機は「○○号」）</li></ul></div>
          </div>
          <button class="btn primary help-close">閉じる</button>
        </div>
      </div>
      <div class="credit">Blender 5.2 で作ったモデルと three.js で動く ブラウザゲーム ／ ver.1.2</div>`;
    this.bind();
  }

  bind() {
    const s = this.settings;
    const el = this.el;
    const click = () => this.app.audio.ui('click');
    el.querySelectorAll('.vcard').forEach((b) => b.addEventListener('click', () => { s.vehicle = b.dataset.v; click(); this.save(); this.render(); }));
    el.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const name = g.dataset.name, v = b.dataset.v;
        if (name === 'mix') s.cpuMix.manual = v === 'manual';
        else s[name] = v;
        click();
        this.save();
        if (name === 'sky') this.app.setSky(v);
        this.render();
      }));
    });
    const r = el.querySelector('.cpu-range');
    r.addEventListener('input', () => {
      s.cpuCount = +r.value;
      el.querySelector('.cpu-n').textContent = s.cpuCount;
      this.save();
    });
    r.addEventListener('change', () => this.render());
    const mr = el.querySelector('.mix-range');
    if (mr) mr.addEventListener('input', () => {
      s.cpuMix.fighters = +mr.value;
      el.querySelector('.mix-f').textContent = s.cpuMix.fighters;
      el.querySelector('.mix-s').textContent = s.cpuCount - s.cpuMix.fighters;
      this.save();
    });
    el.querySelector('.go').addEventListener('click', () => { this.app.audio.unlock(); this.app.audio.ui('start'); this.app.startBattle({ ...s, cpuMix: { ...s.cpuMix } }); });
    el.querySelector('.mp-btn').addEventListener('click', () => { this.app.audio.unlock(); click(); this.app.openLobby(); });
    el.querySelector('.help-btn').addEventListener('click', () => { click(); el.querySelector('.help').classList.remove('hidden'); });
    el.querySelector('.help-close').addEventListener('click', () => { click(); el.querySelector('.help').classList.add('hidden'); });
    el.querySelector('.opt-btn').addEventListener('click', () => { click(); el.querySelector('.opts').classList.toggle('hidden'); });
    const vol = el.querySelector('.vol'), mus = el.querySelector('.mus'), inv = el.querySelector('.inv');
    vol.addEventListener('input', () => { s.volume = +vol.value; this.app.audio.setVolume(s.volume); this.save(); });
    mus.addEventListener('input', () => { s.music = +mus.value; this.app.audio.setMusicVolume(s.music); this.save(); });
    inv.addEventListener('change', () => { s.invertPitch = inv.checked; this.save(); });
    const voice = el.querySelector('.voice');
    voice.addEventListener('change', () => { s.voice = voice.checked; this.save(); });
    el.addEventListener('pointerdown', () => this.app.audio.unlock(), { once: true });
  }

  setRecommended(n) {
    this.recommended = n;
    const r = this.el.querySelector('.reco');
    if (r) r.textContent = `（この端末のおすすめ: ${n} 機）`;
  }

  save() { saveSettings(this.settings); }
  show(on) { this.el.classList.toggle('hidden', !on); }
}

class Loading {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.innerHTML = `<div class="ld-title">ヨモツ</div><div class="ld-bar"><i></i></div><div class="ld-text">読み込み中…</div>`;
    root.appendChild(this.el);
  }
  set(p, text) {
    this.el.querySelector('i').style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.querySelector('.ld-text').textContent = text;
  }
  hide() { this.el.classList.add('out'); setTimeout(() => this.el.remove(), 900); }
}

class PauseMenu {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'pause hidden interactive';
    this.el.innerHTML = `<div class="pause-box"><h2>一時停止</h2>
      <button class="btn primary resume">再開</button>
      <button class="btn ghost restart">最初からやり直す</button>
      <button class="btn ghost quit">メニューへ戻る</button>
      <div class="pause-hint">Esc / P で再開</div></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.resume').addEventListener('click', () => { if (this.mp) this.show(false); else app.setPaused(false); });
    this.el.querySelector('.restart').addEventListener('click', () => app.restart());
    this.el.querySelector('.quit').addEventListener('click', () => app.backToMenu());
  }
  get visible() { return !this.el.classList.contains('hidden'); }
  /** mp=true: マルチプレイ（ゲームは止まらない） */
  show(on, mp = false) {
    this.mp = mp && on;
    this.el.querySelector('h2').textContent = this.mp ? 'メニュー（マルチプレイ中は止まりません）' : '一時停止';
    this.el.querySelector('.resume').textContent = this.mp ? '戦闘に戻る' : '再開';
    this.el.querySelector('.restart').style.display = this.mp ? 'none' : '';
    this.el.querySelector('.quit').textContent = this.mp ? 'ルームから抜けてメニューへ' : 'メニューへ戻る';
    this.el.querySelector('.pause-hint').textContent = this.mp ? 'Esc で閉じる' : 'Esc / P で再開';
    this.el.classList.toggle('hidden', !on);
  }
}

class ResultScreen {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'result hidden interactive';
    root.appendChild(this.el);
  }
  show(battle) {
    const st = battle.stats, r = battle.result;
    const win = r.result === 'victory';
    const time = (st.endTime || battle.time) - (st.startTime || 0);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const k = battle.kaiju;
    const distLeft = k.distanceToCity;
    let score = 0;
    if (win) score += 50 + Math.max(0, 30 - time / 20) + Math.min(20, distLeft / 100);
    score += Math.min(30, st.playerDamage / (k.maxHp / 30)) + st.playerFlinches * 3 - st.playerDeaths * 8 - st.alliesLost * 2;
    const rank = win ? (score >= 95 ? 'S' : score >= 78 ? 'A' : score >= 60 ? 'B' : 'C') : 'D';
    const reason = r.reason === 'city' ? '怪獣が街に上陸した' : r.reason === 'player' ? (battle.net ? '全員が撃破された' : '撃破された') : '';
    const mp = !!battle.net;
    const scores = mp ? (battle.net.isHost ? battle.netScores() : battle.netScoreList || []) : null;
    const scoreTable = scores && scores.length ? `<div class="res-mp"><div class="res-mp-title">プレイヤーごとのダメージ</div>${scores.map((s, i) => `<div class="res-mp-row"><span>${i + 1}</span><b>${s.name.replace(/[<>&]/g, '')}</b><i>${s.damage.toLocaleString()}</i></div>`).join('')}</div>` : '';
    const cityNote = battle.cityDamaged ? '（極太ビームで沿岸部に被害が出た）' : '';
    this.el.innerHTML = `<div class="result-box ${win ? 'win' : 'lose'}">
      <div class="res-title">${win ? '迎撃成功' : '迎撃失敗'}</div>
      <div class="res-sub">${win ? `街まで ${(distLeft / 1000).toFixed(2)} km の地点で怪獣を沈めた${cityNote}` : reason}</div>
      <div class="res-rank">評価 <b>${rank}</b></div>
      <div class="res-grid">
        <div><span>戦闘時間</span><b>${formatTime(time)}</b></div>
        <div><span>与えたダメージ</span><b>${Math.round(st.playerDamage).toLocaleString()}</b></div>
        <div><span>溜めを止めた回数</span><b>${st.playerFlinches}</b></div>
        <div><span>倒した首</span><b>${st.headsKilled} / 3</b></div>
        <div><span>命中率</span><b>${acc}%</b></div>
        <div><span>失った味方</span><b>${st.alliesLost}</b></div>
        <div><span>撃破された回数</span><b>${st.playerDeaths}</b></div>
        <div><span>難易度</span><b>${battle.diff.label}・${battle.mode.label}</b></div>
      </div>
      ${scoreTable}
      <div class="res-actions">${mp ? '<button class="btn primary again">ロビーへ戻る</button><button class="btn ghost menu">ルームを出る</button>' : '<button class="btn primary again">もう一度</button><button class="btn ghost menu">メニューへ</button>'}</div></div>`;
    this.el.querySelector('.again').addEventListener('click', () => this.app.restart());
    this.el.querySelector('.menu').addEventListener('click', () => this.app.backToMenu());
    this.el.classList.remove('hidden');
  }
  hide() { this.el.classList.add('hidden'); }
}
return { loadSettings, saveSettings, Menu, Loading, PauseMenu, ResultScreen };
})();

// ==== src/net/net.js
__mod["src/net/net.js"] = (function () {
// マルチプレイの通信
//  ・ルーム = ホストの PeerJS の ID（ルーム名から作る）。参加者はルーム名でホストにつなぐ
//  ・パスワードはホストが確かめる
//  ・ホストが怪獣と CPU の味方を動かし、その出来事を参加者へ送る。各プレイヤーは自分の機体を自分で動かして状態を送る
// PeerJS の公開サーバー（0.peerjs.com）で相手を見つけ、あとは端末どうしが直接（WebRTC）つながる。インターネット接続が必要。
// 開発用: URL に ?net=local を付けると、同じブラウザのタブどうしで通信する（BroadcastChannel）。

const NET_VERSION = 1;
const MAX_PLAYERS = 6;
const TICK = 1 / 12; // 状態を送る間隔（秒）

/** 文字列から短いハッシュ（ルーム名 → ID。日本語のルーム名でも使えるように） */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
const roomPeerId = (room) => `yomotsu${NET_VERSION}-${hash(room.trim())}`;

/** プレイヤー名 → 機体の名前（船は「○○丸」、戦闘機は「○○号」） */
function vehicleName(name, vehicle) {
  const n = (name || '').trim() || 'ななし';
  if (vehicle === 'destroyer') return /[丸艦]$/.test(n) ? n : `${n}丸`;
  return /[号機]$/.test(n) ? n : `${n}号`;
}

const ERR_TEXT = {
  'unavailable-id': 'そのルーム名はすでに使われています。別の名前にしてください',
  'peer-unavailable': 'ルームが見つかりません。ルーム名を確かめてください（ホストがルームを作っている必要があります）',
  network: 'マッチングサーバーにつながりません。インターネット接続を確かめてください',
  'server-error': 'マッチングサーバーでエラーが起きました。少し待ってからやり直してください',
  'socket-error': 'マッチングサーバーとの通信が切れました',
  'browser-incompatible': 'このブラウザは通信機能（WebRTC）に対応していません',
  timeout: '応答がありません。ルーム名・通信状態を確かめてください',
  password: 'パスワードが違います',
  full: 'ルームが満員です',
  started: 'このルームはすでに出撃しています',
  version: 'ゲームの版が違います。両方とも最新にしてください',
};
const netErrorText = (code) => ERR_TEXT[code] || `通信エラー（${code}）`;

// ==================================================================== 通信路
/** PeerJS（インターネット越し） */
class PeerTransport {
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map(); // id → DataConnection
    this.peer = null;
  }

  async load() {
    if (!PeerTransport.lib) {
      try { PeerTransport.lib = await import('peerjs'); } catch (e) { throw Object.assign(new Error('peerjs'), { code: 'network' }); }
    }
    return PeerTransport.lib.Peer || PeerTransport.lib.default;
  }

  /** ホスト: ルームの ID で待ち受ける */
  async host(roomId) {
    const Peer = await this.load();
    return new Promise((resolve, reject) => {
      const peer = new Peer(roomId, { debug: 1 });
      this.peer = peer;
      const to = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), 15000);
      peer.on('open', (id) => { clearTimeout(to); this.myId = id; resolve(id); });
      peer.on('error', (err) => { clearTimeout(to); if (!this.myId) reject(Object.assign(err, { code: err.type })); else this.h.onError(err.type); });
      peer.on('connection', (conn) => this.wire(conn));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* 再接続できない */ } });
    });
  }

  /** 参加者: ルームの ID へつなぐ */
  async join(roomId) {
    const Peer = await this.load();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      const to = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), 15000);
      peer.on('error', (err) => { clearTimeout(to); if (!this.hostConn || !this.hostConn.open) reject(Object.assign(err, { code: err.type })); else this.h.onError(err.type); });
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(roomId, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => { clearTimeout(to); this.wire(conn, true); resolve(id); });
      });
    });
  }

  wire(conn, already = false) {
    const ready = () => {
      this.conns.set(conn.peer, conn);
      this.h.onOpen(conn.peer);
    };
    conn.on('data', (d) => this.h.onMessage(conn.peer, d));
    conn.on('close', () => { this.conns.delete(conn.peer); this.h.onClose(conn.peer); });
    conn.on('error', () => { this.conns.delete(conn.peer); this.h.onClose(conn.peer); });
    if (already || conn.open) ready(); else conn.on('open', ready);
  }

  send(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  drop(id) { const c = this.conns.get(id); if (c) setTimeout(() => c.close(), 300); this.conns.delete(id); }
  close() { for (const c of this.conns.values()) try { c.close(); } catch (e) { /* */ } this.conns.clear(); if (this.peer) try { this.peer.destroy(); } catch (e) { /* */ } this.peer = null; }
}

/** 同じブラウザのタブどうし（開発・確認用） */
class LocalTransport {
  constructor(handlers) {
    this.h = handlers;
    this.myId = `L${Math.random().toString(36).slice(2, 9)}`;
    this.ch = new BroadcastChannel('yomotsu-local-net');
    this.conns = new Set();
    this.ch.onmessage = (e) => this.recv(e.data);
  }
  post(to, msg) { this.ch.postMessage({ to, from: this.myId, room: this.room, msg }); }
  recv(p) {
    if (p.room !== this.room || (p.to !== this.myId && p.to !== '*')) return;
    if (p.msg && p.msg.__net === 'hello') {
      if (this.isHost) { this.conns.add(p.from); this.post(p.from, { __net: 'ok' }); this.h.onOpen(p.from); }
      return;
    }
    if (p.msg && p.msg.__net === 'ok') { this.conns.add(p.from); this.hostId = p.from; this.okResolve && this.okResolve(); return; }
    if (p.msg && p.msg.__net === 'bye') { this.conns.delete(p.from); this.h.onClose(p.from); return; }
    if (p.msg && p.msg.__net === 'taken') { if (this.isHost && this.pendingReject) this.pendingReject(Object.assign(new Error('taken'), { code: 'unavailable-id' })); return; }
    if (p.msg && p.msg.__net === 'who' && this.isHost) { this.post(p.from, { __net: 'taken' }); return; }
    if (this.conns.has(p.from)) this.h.onMessage(p.from, p.msg);
  }
  async host(roomId) {
    this.room = roomId; this.isHost = true;
    return new Promise((resolve, reject) => {
      this.pendingReject = reject;
      this.post('*', { __net: 'who' });
      setTimeout(() => { this.pendingReject = null; resolve(this.myId); }, 400);
    });
  }
  async join(roomId) {
    this.room = roomId;
    return new Promise((resolve, reject) => {
      this.okResolve = () => { this.h.onOpen(this.hostId); resolve(this.myId); };
      this.post('*', { __net: 'hello' });
      setTimeout(() => { if (!this.hostId) reject(Object.assign(new Error('nf'), { code: 'peer-unavailable' })); }, 1500);
    });
  }
  send(id, msg) { this.post(id, msg); }
  drop(id) { this.post(id, { __net: 'bye' }); this.conns.delete(id); }
  close() { for (const id of this.conns) this.post(id, { __net: 'bye' }); this.conns.clear(); this.ch.close(); }
}

// ==================================================================== ルームとゲームの通信
class NetSession {
  constructor(app) {
    this.app = app;
    this.isHost = false;
    this.players = [];    // { id, name, vehicle, host }
    this.settings = null; // ホストが決めた設定
    this.myId = null;
    this.listeners = {};
    this.battle = null;
    this.sendT = 0;
    this.closed = false;
    const local = new URLSearchParams(location.search).get('net') === 'local';
    const handlers = {
      onOpen: (id) => this.onOpen(id),
      onMessage: (id, msg) => this.onMessage(id, msg),
      onClose: (id) => this.onPeerClose(id),
      onError: (code) => this.emit('error', netErrorText(code)),
    };
    this.tr = local ? new LocalTransport(handlers) : new PeerTransport(handlers);
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ...a) { for (const fn of this.listeners[type] || []) fn(...a); }

  get me() { return this.players.find((p) => p.id === this.myId); }
  playerById(id) { return this.players.find((p) => p.id === id); }

  // ---------------------------------------------------------------- ルーム
  async host(room, pass, me, settings) {
    this.isHost = true;
    this.room = room.trim();
    this.pass = pass;
    this.settings = settings;
    await this.tr.host(roomPeerId(this.room));
    this.myId = 'host';
    this.players = [{ id: 'host', name: me.name, vehicle: me.vehicle, host: true }];
    this.emit('lobby');
  }

  async join(room, pass, me) {
    this.isHost = false;
    this.room = room.trim();
    await this.tr.join(roomPeerId(this.room));
    return new Promise((resolve, reject) => {
      this.joinWait = { resolve, reject };
      this.toHost({ t: 'hello', ver: NET_VERSION, name: me.name, vehicle: me.vehicle, pass });
      setTimeout(() => { if (this.joinWait) { this.joinWait = null; reject(Object.assign(new Error('timeout'), { code: 'timeout' })); } }, 10000);
    });
  }

  toHost(msg) { this.tr.send(this.hostPeer, msg); }
  toAll(msg, except = null) { for (const p of this.players) if (p.peer && p.id !== except) this.tr.send(p.peer, msg); }

  onOpen(peer) { if (!this.isHost) this.hostPeer = peer; }

  onPeerClose(peer) {
    if (this.isHost) {
      const p = this.players.find((x) => x.peer === peer);
      if (!p) return;
      this.players = this.players.filter((x) => x !== p);
      this.emit('left', p);
      this.broadcastLobby();
      if (this.battle) this.battle.onNetPlayerLeft(p.id);
    } else if (peer === this.hostPeer && !this.closed) {
      this.emit('hostLost');
    }
  }

  broadcastLobby() {
    if (!this.isHost) return;
    const msg = { t: 'lobby', players: this.players.map(({ id, name, vehicle, host }) => ({ id, name, vehicle, host })), settings: this.settings, room: this.room };
    this.toAll(msg);
    this.emit('lobby');
  }

  setSettings(s) { this.settings = { ...s }; this.broadcastLobby(); }

  pick(vehicle) {
    if (this.isHost) { this.me.vehicle = vehicle; this.broadcastLobby(); }
    else this.toHost({ t: 'pick', vehicle });
  }

  /** ホストが出撃: 配置（どの機体をどこに置くか）を決めて全員に送る */
  start(plan) {
    this.inGame = true;
    this.toAll({ t: 'start', settings: this.settings, players: this.players.map(({ id, name, vehicle }) => ({ id, name, vehicle })), plan });
    this.emit('start', this.settings, plan);
  }

  leave() {
    this.closed = true;
    this.tr.close();
    this.battle = null;
  }

  // ---------------------------------------------------------------- 受信
  onMessage(peer, m) {
    if (!m || typeof m !== 'object') return;
    if (this.isHost) return this.onHostMessage(peer, m);
    return this.onClientMessage(m);
  }

  onHostMessage(peer, m) {
    let p = this.players.find((x) => x.peer === peer);
    if (m.t === 'hello') {
      const reject = (code) => { this.tr.send(peer, { t: 'reject', code }); this.tr.drop(peer); };
      if (m.ver !== NET_VERSION) return reject('version');
      if ((m.pass || '') !== (this.pass || '')) return reject('password');
      if (this.players.length >= MAX_PLAYERS) return reject('full');
      if (this.inGame) return reject('started');
      // 名前は記号（HTML になりうる文字・制御文字）を取り除いてから使う
      const clean = String(m.name || '').replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 10) || 'ななし';
      let name = clean;
      let n = 2;
      while (this.players.some((x) => x.name === name)) name = `${clean.slice(0, 8)}${n++}`;
      const id = `p${Math.random().toString(36).slice(2, 8)}`;
      p = { id, peer, name, vehicle: ['f15', 'zero', 'destroyer'].includes(m.vehicle) ? m.vehicle : 'f15', host: false };
      this.players.push(p);
      this.tr.send(peer, { t: 'welcome', id, name });
      this.emit('joined', p);
      this.broadcastLobby();
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'pick': if (['f15', 'zero', 'destroyer'].includes(m.vehicle)) { p.vehicle = m.vehicle; this.broadcastLobby(); } break;
      case 'vs': if (this.battle) { this.battle.onNetStates(m.vs); this.relay.push(...m.vs); } break;
      case 've': if (this.battle) { this.battle.onNetVehicleEvent(m.ev); this.toAll({ t: 've', ev: m.ev }, p.id); } break;
      case 'dmg': if (this.battle) this.battle.onNetDamage(m); break;
      default: break;
    }
  }

  onClientMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        if (this.joinWait) { this.joinWait.resolve(); this.joinWait = null; }
        break;
      case 'reject':
        if (this.joinWait) { this.joinWait.reject(Object.assign(new Error(m.code), { code: m.code })); this.joinWait = null; }
        break;
      case 'lobby':
        this.players = m.players;
        this.settings = m.settings;
        this.emit('lobby');
        break;
      case 'start':
        this.players = m.players;
        this.settings = m.settings;
        this.inGame = true;
        this.emit('start', m.settings, m.plan);
        break;
      case 'tick':
        if (!this.battle) break;
        if (m.k) this.battle.kaiju.applySnapshot(m.k);
        if (m.vs) this.battle.onNetStates(m.vs);
        break;
      case 'ev': if (this.battle) this.battle.kaiju.applyEvent(m); break;
      case 've': if (this.battle) this.battle.onNetVehicleEvent(m.ev); break;
      case 'skip': if (this.battle) this.battle.skipIntro(true); break;
      case 'end': if (this.battle) this.battle.onNetEnd(m); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- ゲーム中
  attach(battle) {
    this.battle = battle;
    this.relay = [];
    this.sendT = 0;
  }

  detach() { this.battle = null; this.inGame = false; }

  /** ホスト: 怪獣の出来事を全員へ */
  kaijuEvent(ev) { this.toAll({ t: 'ev', ...ev }); }

  /** 機体の出来事（やられた・発射・復活）。ホストは全員へ、参加者はホストへ（ホストが他の人へ回す） */
  vehicleEvent(ev) {
    if (this.isHost) this.toAll({ t: 've', ev });
    else this.toHost({ t: 've', ev });
  }

  sendDamage(amount, o) {
    this.toHost({ t: 'dmg', a: Math.round(amount * 10) / 10, h: o.head || null, f: o.flinch || 1, k: o.kind || '', p: o.part || '', by: o.owner ? o.owner.id : null });
  }

  sendSkip() { this.toAll({ t: 'skip' }); }

  endBattle(result, reason) {
    if (!this.isHost || !this.battle) return;
    this.toAll({ t: 'end', result, reason, scores: this.battle.netScores() });
  }

  update(dt) {
    const b = this.battle;
    if (!b) return;
    this.sendT += dt;
    if (this.sendT < TICK) return;
    this.sendT = 0;
    const mine = b.vehicles.filter((v) => v.local && (v.alive || v.dying) && !v.removed).map((v) => v.netState());
    if (this.isHost) {
      const vs = mine.concat(this.relay);
      this.relay = [];
      this.toAll({ t: 'tick', k: b.kaiju.snapshot(), vs });
    } else if (mine.length) {
      this.toHost({ t: 'vs', vs: mine });
    }
  }
}
return { NET_VERSION, MAX_PLAYERS, roomPeerId, vehicleName, netErrorText, NetSession };
})();

// ==== src/core/assets.js
__mod["src/core/assets.js"] = (function () {
// アセット読み込み（進捗つき）
const THREE = __DEPS["three"];
const { GLTFLoader } = __DEPS["three/addons/loaders/GLTFLoader.js"];

const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);

const assets = { gltf: {}, tex: {} };

const MODELS = {
  kaiju: 'assets/models/kaiju.glb',
  destroyer: 'assets/models/destroyer.glb',
  carrier: 'assets/models/carrier.glb',
  f15: 'assets/models/f15.glb',
  zero: 'assets/models/zero.glb',
  newsheli: 'assets/models/newsheli.glb',
};
const TEXTURES = {
  kaijuGlow: 'assets/textures/kaiju_glow.webp',
};

// index.html をダブルクリックで開いた時（file://）は、build/assets.js に埋め込んだデータから読む
const EMBED = (typeof window !== 'undefined' && window.__YOMOTSU_ASSETS) || null;

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

function loadModel(url) {
  if (EMBED && EMBED[url]) return new Promise((ok, ng) => gltfLoader.parse(base64ToBuffer(EMBED[url]), '', ok, ng));
  return gltfLoader.loadAsync(url);
}

function loadTexture(url) {
  if (EMBED && EMBED[url]) {
    const ext = url.split('.').pop().toLowerCase();
    const mime = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
    return texLoader.loadAsync(`data:${mime};base64,${EMBED[url]}`);
  }
  return texLoader.loadAsync(url);
}

async function loadAll(onProgress, only = null) {
  const jobs = [];
  let done = 0;
  const entries = Object.entries(MODELS).filter(([k]) => !only || only.includes(k));
  const tex = Object.entries(TEXTURES).filter(([k]) => !only || only.includes(k) || only.includes('kaiju'));
  const total = entries.length + tex.length;
  const tick = () => { done++; onProgress && onProgress(done / total); };
  for (const [key, url] of entries) {
    jobs.push(loadModel(url).then((g) => { assets.gltf[key] = g; tick(); })
      .catch((e) => { console.warn('モデルの読み込みに失敗:', url, e); assets.gltf[key] = null; tick(); }));
  }
  for (const [key, url] of tex) {
    jobs.push(loadTexture(url).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      assets.tex[key] = t;
      tick();
    }).catch((e) => { console.warn('テクスチャの読み込みに失敗:', url, e); assets.tex[key] = null; tick(); }));
  }
  await Promise.all(jobs);
  return assets;
}
return { assets, loadAll };
})();

// ==== src/game/beams.js
__mod["src/game/beams.js"] = (function () {
// 怪獣のビームの見た目（カメラを向く帯＋外側の光＋先端の閃光）
const THREE = __DEPS["three"];

const vert = /* glsl */`
attribute float aSide;    // -1 / +1
attribute float aAlong;   // 0 (口) → 1 (先端)
uniform vec3 uA, uB;
uniform float uWidthA, uWidthB;
uniform vec3 uCam;
varying float vSide;
varying float vAlong;
void main(){
  vec3 p = mix(uA, uB, aAlong);
  vec3 dir = normalize(uB - uA);
  vec3 toCam = normalize(uCam - p);
  vec3 side = normalize(cross(dir, toCam));
  float w = mix(uWidthA, uWidthB, aAlong);
  p += side * aSide * w;
  vSide = aSide;
  vAlong = aAlong;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uLength;
uniform float uCore;
varying float vSide;
varying float vAlong;
float hash(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float x = clamp(abs(vSide), 0.0, 1.0);
  // 注意: smoothstep の edge0 > edge1 は未定義（ANGLE/D3D では 0 になる）ので 1-smoothstep で書く
  float core = uCore > 0.0 ? 1.0 - smoothstep(0.0, uCore, x) : 0.0;
  float glow = pow(max(1.0 - x, 0.0), 2.2);
  float s = vAlong * uLength;
  float ripple = 0.75 + 0.25 * sin(s * 0.08 - uTime * 60.0) + 0.15 * sin(s * 0.023 + uTime * 23.0);
  float flick = 0.85 + 0.15 * hash(floor(uTime * 40.0));
  vec3 c = uColor * glow * 2.6 * ripple + mix(uColor, vec3(1.0, 0.97, 0.95), 0.6) * core * 3.2;
  float endFade = smoothstep(0.0, 0.02, vAlong) * (1.0 - smoothstep(0.985, 1.0, vAlong));
  gl_FragColor = vec4(c * uIntensity * flick * endFade, 1.0);
}`;

class Beam {
  constructor(scene, color, width = 10) {
    const segs = 32;
    const pos = [], side = [], along = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      for (const s of [-1, 1]) { pos.push(0, 0, 0); side.push(s); along.push(i / segs); }
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setIndex(idx);
    this.uniforms = {
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
      uWidthA: { value: width * 0.7 }, uWidthB: { value: width },
      uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 }, uTime: { value: 0 }, uLength: { value: 1 }, uCore: { value: 0.22 },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.visible = false;
    // 外側の大きな光（太さ×3、弱い）
    this.outer = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uWidthA: { value: width * 2.2 }, uWidthB: { value: width * 3.2 }, uIntensity: { value: 0 }, uCore: { value: 0.0 } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.outer.frustumCulled = false;
    this.outer.renderOrder = 24;
    this.outer.visible = false;
    scene.add(this.mesh, this.outer);
    this.scene = scene;
    this.width = width;
  }

  set(a, b, camPos, intensity, time) {
    const u = this.uniforms;
    u.uA.value.copy(a);
    u.uB.value.copy(b);
    u.uCam.value.copy(camPos);
    u.uIntensity.value = intensity;
    u.uTime.value = time;
    u.uLength.value = a.distanceTo(b);
    const ou = this.outer.material.uniforms;
    ou.uIntensity.value = intensity * 0.22;
    this.mesh.visible = this.outer.visible = intensity > 0.001;
  }

  hide() { this.mesh.visible = this.outer.visible = false; }

  dispose() {
    this.scene.remove(this.mesh, this.outer);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.outer.material.dispose();
  }
}

/** 照準線（細い光の線）。蒼の首の予告などに使う */
class AimLine {
  constructor(scene, color) {
    this.beam = new Beam(scene, color, 1.2);
    this.beam.uniforms.uCore.value = 0.5;
  }
  set(a, b, camPos, intensity, time) { this.beam.set(a, b, camPos, intensity, time); }
  hide() { this.beam.hide(); }
  dispose() { this.beam.dispose(); }
}
return { Beam, AimLine };
})();

// ==== src/game/kaiju.js
__mod["src/game/kaiju.js"] = (function () {
// 怪獣ヨモツ（ゲームロジック）: 頭ごとのHP・溜め/発射/硬直/怯み・怒り・攻撃と当たり判定・怪獣らしい仕草
const THREE = __DEPS["three"];
const { KaijuModel, HEAD_KEYS, HEAD_INFO } = __mod["src/game/kaijuModel.js"];
const { KAIJU, ATTACKS, WORLD } = __mod["src/config.js"];
const { Beam, AimLine } = __mod["src/game/beams.js"];
const { clamp, rand, pick, damp, distSegmentSegment, segmentSphere, smoothstep, interceptTime, angleDiff, DEG } = __mod["src/core/util.js"];

const S = KAIJU.scale;
// 登場シーンの時間割（テレビ中継と合わせる）: emergeAt 秒まで海中、end 秒で戦闘開始
const KAIJU_INTRO = { emergeAt: 8.0, end: 19.0 };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const HEAD_R = { C: 10.5 * S, L: 9.5 * S, R: 9.5 * S };
const MELEE_ALT = 70 * S; // しっぽ・爪が届く高さ（これより高く飛んでいれば当たらない）

/** 船の当たり判定は艦の中央部（艦橋〜煙突）に絞る。端をかすめた場合は演出のみ（nearMiss）。
 *  （outA/outB に呼び出し側の一時ベクトルが渡されても壊れないよう、向きは専用の作業領域で持つ） */
const _vsDir = new THREE.Vector3();
function vehicleSegment(v, outA, outB, halfOverride) {
  if (v.kind === 'fighter') { outA.copy(v.position); outB.copy(v.position); return v.hitRadius; }
  const half = halfOverride ?? v.killHalfLength;
  _vsDir.set(Math.sin(v.heading), 0, Math.cos(v.heading));
  outA.copy(v.position).addScaledVector(_vsDir, -half);
  outB.copy(v.position).addScaledVector(_vsDir, half);
  outA.y = outB.y = Math.max(0, v.position.y) + 4;
  return v.hitRadius;
}

function dist2DPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// 2D（水平面）での線分同士の距離。呼び出し側の一時ベクトルを壊さないよう専用の作業領域を使う
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3(), _sd = new THREE.Vector3();
function dist2DSegSeg(a0, a1, b0, b1) {
  _sa.set(a0.x, 0, a0.z); _sb.set(a1.x, 0, a1.z);
  _sc.set(b0.x, 0, b0.z); _sd.set(b1.x, 0, b1.z);
  return distSegmentSegment(_sa, _sb, _sc, _sd);
}

// ------------------------------------------------------------------ 攻撃
class Attack {
  constructor(k, head, target) {
    this.k = k; this.head = head; this.target = target;
    this.world = k.world; this.battle = k.battle;
    this.shapes = [];
    this.done = false;
  }
  get key() { return this.head.key; }
  /** 攻撃位置の予測。船は「今いる場所」（動き続ければ避けられる）、戦闘機は半分だけ先読み */
  predict(t, out = new THREE.Vector3()) {
    const tg = this.target;
    const lead = tg.kind === 'fighter' ? 0.5 : 0.0;
    out.copy(tg.position).addScaledVector(tg.velocity, t * lead);
    if (tg.kind !== 'fighter') { out.x += rand(-15, 15); out.z += rand(-15, 15); }
    return out;
  }
  removeShapes() { for (const s of this.shapes) this.world.telegraph.remove(s); this.shapes = []; }
  cancel() { this.removeShapes(); this.end(); }
  end() { this.done = true; }
  kill(v, cause) { this.battle.killVehicle(v, cause, this.key); }
  /** 船の端をかすめたか（艦全長で判定）。かすめたら演出だけ出す */
  graze(v, testFn) {
    if (v.kind === 'fighter') return;
    this.grazed = this.grazed || new Set();
    if (this.grazed.has(v)) return;
    const r = vehicleSegment(v, _ga, _gb, v.length * 0.47);
    const p = testFn(_ga, _gb, r);
    if (p) { this.grazed.add(v); this.battle.onNearMiss(v, p, this.key); }
  }
}
const _ga = new THREE.Vector3(), _gb = new THREE.Vector3();

const arr = (v) => (v ? [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10, Math.round(v.z * 10) / 10] : null);
const vec = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);

/** 蒼の首: 細いビームの短い連射 */
class BoltAttack extends Attack {
  constructor(k, head, target, p = null) {
    super(k, head, target);
    const A = ATTACKS.bolts;
    this.telegraph = p ? p.tg : k.tele(A.telegraph);
    this.count = p ? p.n : A.count + (k.rage ? 2 : 0);
    this.interval = p ? p.iv : A.interval * (k.rage ? 0.85 : 1);
    this.duration = this.count * this.interval + 0.3;
    this.fired = 0;
    this.t = 0;
    this.aim = new AimLine(k.world.scene, HEAD_INFO.R.color.clone().multiplyScalar(3));
    this.spreadDir = p ? p.sd : rand() < 0.5 ? -1 : 1;
    // 船が狙われた時は「溜め始めた時の位置」に撃ち込む（動き続けていれば外れる）
    this.lockPoint = p ? vec(p.lp) : target.kind !== 'fighter' ? target.position.clone().setY(8) : null;
  }
  get params() { return { tg: this.telegraph, n: this.count, iv: this.interval, sd: this.spreadDir, lp: arr(this.lockPoint) }; }
  beginTelegraph() { this.battle.onTelegraph(this, 'bolts'); }
  updateTelegraph(dt, p) {
    const mouth = this.k.model.socketWorld('Mouth_R', _v);
    const tp = this.lockPoint || this.target.position;
    const blink = (Math.sin(this.k.time * 30) > 0 ? 1 : 0.35) * (0.4 + 0.6 * p);
    this.aim.set(mouth, tp, this.battle.camera.position, blink * 1.2, this.k.time);
  }
  beginFire() { this.t = 0; this.aim.hide(); }
  updateFire(dt) {
    this.t += dt;
    if (!this.k.auth) return; // マルチプレイ: 弾はホストが撃ち、その位置と速さが届く
    while (this.fired < this.count && this.t >= this.fired * this.interval) {
      const mouth = this.k.model.socketWorld('Mouth_R', new THREE.Vector3());
      const tg = this.target;
      let aimPt;
      if (this.lockPoint) aimPt = this.lockPoint.clone();
      else {
        const rel = _v.copy(tg.position).sub(mouth);
        const tt = interceptTime(rel, tg.velocity, ATTACKS.bolts.speed);
        aimPt = tg.position.clone().addScaledVector(tg.velocity, tt * this.k.leadSkill);
      }
      // 連射の弾は横に並んで着弾する（間をすり抜けられる）
      const side = new THREE.Vector3().subVectors(aimPt, mouth).cross(THREE.Object3D.DEFAULT_UP).normalize();
      const off = (this.fired / Math.max(1, this.count - 1) - 0.5) * 2 * this.spreadDir;
      aimPt.addScaledVector(side, off * 70 + rand(-6, 6));
      aimPt.y += rand(-4, 4);
      const range = aimPt.distanceTo(mouth);
      const vel = aimPt.sub(mouth).normalize().multiplyScalar(ATTACKS.bolts.speed);
      this.k.spawnBolt(mouth, vel, (range + 300) / ATTACKS.bolts.speed);
      this.fired++;
    }
  }
  end() { this.aim.dispose(); super.end(); }
}

/** 紫の首: 太いビームの薙ぎ払い */
class SweepAttack extends Attack {
  constructor(k, head, target, p = null) {
    super(k, head, target);
    const A = ATTACKS.sweep;
    this.telegraph = p ? p.tg : k.tele(A.telegraph);
    this.duration = p ? p.du : A.duration * (k.rage ? 0.85 : 1);
    this.radius = A.radius;
    this.beam = k.beams.C;
    this.fxT = 0;
    if (p) {
      this.air = p.air;
      this.A = vec(p.A); this.B = vec(p.B);
      this.P = this.A.clone(); this.prevP = this.A.clone();
      return;
    }
    const strikeT = this.telegraph + this.duration * 0.5;
    const c = this.predict(strikeT * 0.85, new THREE.Vector3());
    const kp = k.pos;
    const dir = _v.set(c.x - kp.x, 0, c.z - kp.z).normalize();
    // 戦闘機: 怪獣から見て横方向に薙ぐ / 船: 進路を横切るように薙ぐ（全速で前に抜ければ避けられる）
    let lat = new THREE.Vector3(-dir.z, 0, dir.x);
    if (target.kind !== 'fighter') {
      lat = new THREE.Vector3(Math.cos(target.heading), 0, -Math.sin(target.heading));
      c.x -= Math.sin(target.heading) * 10; // 少し後ろ寄り（前へ走り続ければ抜けられる）
      c.z -= Math.cos(target.heading) * 10;
    }
    const s = rand() < 0.5 ? -1 : 1;
    const half = A.length / 2;
    this.air = target.kind === 'fighter' && target.position.y > 60;
    const y = this.air ? target.position.y : 0;
    this.A = new THREE.Vector3(c.x - lat.x * half * s, y, c.z - lat.z * half * s);
    this.B = new THREE.Vector3(c.x + lat.x * half * s, y, c.z + lat.z * half * s);
    this.P = this.A.clone();
    this.prevP = this.A.clone();
  }
  get params() { return { tg: this.telegraph, du: this.duration, air: this.air, A: arr(this.A), B: arr(this.B) }; }
  beginTelegraph() {
    const tg = this.world.telegraph;
    this.shapes.push(tg.line(this.A, this.B, this.radius * 2 + 12, HEAD_INFO.C.color.clone().multiplyScalar(1.6), { duration: this.telegraph + this.duration }));
    this.shapes[0].progressOverride = 0;
    if (this.air) this.shapes.push(tg.curtain(new THREE.Vector3(this.A.x, 0, this.A.z), new THREE.Vector3(this.B.x, 0, this.B.z), this.A.y + 70, HEAD_INFO.C.color, { duration: this.telegraph + this.duration }));
    this.battle.onTelegraph(this, 'sweep');
  }
  updateTelegraph(dt, p) { if (this.shapes[0]) this.shapes[0].progressOverride = 0; }
  beginFire() { this.t = 0; this.battle.onBeamFire(this, 'sweep'); }
  updateFire(dt) {
    this.t += dt;
    const u = clamp(this.t / this.duration, 0, 1);
    const e = u * u * (3 - 2 * u);
    this.prevP.copy(this.P);
    this.P.lerpVectors(this.A, this.B, e);
    if (!this.air) this.P.y = this.world.ocean.heightAt(this.P.x, this.P.z);
    if (this.shapes[0]) this.shapes[0].progressOverride = e;
    const mouth = this.k.model.socketWorld('Mouth_C', _v2);
    this.k.model.aimHead('C', this.P, 1);
    const fade = Math.min(1, this.t / 0.08) * Math.min(1, (this.duration - this.t) / 0.15 + 0.2);
    this.beam.set(mouth, this.P, this.battle.camera.position, 1.6 * fade, this.k.time);
    this.fxT += dt;
    const fx = this.world.effects;
    if (this.fxT > 0.035) {
      this.fxT = 0;
      if (!this.air) {
        fx.steam(this.P, 2.0);
        if (Math.random() < 0.5) fx.splash(this.P, 1.6, { height: 45 });
        this.world.foam.addDecal(this.P.x, this.P.z, 40, 1.0, 12);
      }
      fx.glow(this.P, [4.0, 2.2, 6.0], 55, 0.15);
    }
    fx.flashLight(this.P, 0xb070ff, 25000, 20);
    // 判定（その機体を動かしている端末で行う）
    for (const v of this.battle.vehicles) {
      if (!v.alive || !v.local) continue;
      const r = vehicleSegment(v, _v, _v3);
      if (v.kind === 'fighter') {
        if (distSegmentSegment(mouth, this.P, v.position, v.position) < this.radius + r) this.kill(v, 'beam');
      } else if (!this.air) {
        const d = dist2DSegSeg(this.prevP, this.P, _v, _v3);
        if (d < this.radius + r) this.kill(v, 'beam');
        else this.graze(v, (a, b, rr) => (dist2DSegSeg(this.prevP, this.P, a, b) < this.radius + rr ? this.P.clone() : null));
      }
    }
  }
  end() { this.beam.hide(); this.removeShapes(); super.end(); }
}

/** 紅の首: 海面をなぞるビームと水柱 */
class TraceAttack extends Attack {
  constructor(k, head, target, p = null) {
    super(k, head, target);
    const A = ATTACKS.trace;
    this.telegraph = p ? p.tg : k.tele(A.telegraph);
    this.duration = p ? p.du : A.duration * (k.rage ? 0.85 : 1);
    this.radius = A.radius;
    if (p) {
      this.S = vec(p.S); this.E = vec(p.E);
      this.len = this.S.distanceTo(this.E);
      this.dir = this.E.clone().sub(this.S).normalize();
    } else {
      const c = this.predict(this.telegraph + this.duration * 0.4, new THREE.Vector3());
      const kp = k.pos;
      const dir = new THREE.Vector3(c.x - kp.x, 0, c.z - kp.z).normalize();
      this.S = new THREE.Vector3(kp.x, 0, kp.z).addScaledVector(dir, 210);
      const len = Math.max(1000, Math.min(2900, Math.hypot(c.x - kp.x, c.z - kp.z) + 420));
      this.E = this.S.clone().addScaledVector(dir, len);
      this.dir = dir;
      this.len = len;
    }
    this.P = this.S.clone();
    this.prevP = this.S.clone();
    this.nextCol = 0;
    this.columns = [];
    this.beam = k.beams.L;
  }
  get params() { return { tg: this.telegraph, du: this.duration, S: arr(this.S), E: arr(this.E) }; }
  beginTelegraph() {
    const tg = this.world.telegraph;
    const col = new THREE.Color(2.2, 0.22, 0.1);
    const s = tg.line(this.S, this.E, this.radius * 2 + 10, col, { duration: this.telegraph + this.duration + 1.2 });
    s.progressOverride = 0;
    this.shapes.push(s);
    for (let d = 240; d < this.len; d += 300) {
      const p = this.S.clone().addScaledVector(this.dir, d);
      this.shapes.push(tg.circle(p, 28, col, { duration: this.telegraph }));
    }
    this.battle.onTelegraph(this, 'trace');
  }
  updateTelegraph() {}
  beginFire() { this.t = 0; this.battle.onBeamFire(this, 'trace'); }
  updateFire(dt) {
    this.t += dt;
    const u = clamp(this.t / this.duration, 0, 1);
    this.prevP.copy(this.P);
    this.P.lerpVectors(this.S, this.E, u);
    this.P.y = this.world.ocean.heightAt(this.P.x, this.P.z);
    if (this.shapes[0]) this.shapes[0].progressOverride = u;
    const mouth = this.k.model.socketWorld('Mouth_L', _v2);
    this.k.model.aimHead('L', this.P, 1);
    const fade = Math.min(1, this.t / 0.06) * Math.min(1, (this.duration - this.t) / 0.12 + 0.15);
    this.beam.set(mouth, this.P, this.battle.camera.position, 1.5 * fade, this.k.time);
    const fx = this.world.effects;
    const traveled = u * this.len;
    while (this.nextCol <= traveled) {
      const p = this.S.clone().addScaledVector(this.dir, this.nextCol);
      fx.waterColumn(p, ATTACKS.trace.columnHeight * rand(0.8, 1.05), 22);
      this.columns.push({ p, t: 0 });
      this.battle.onWaterColumn(p);
      this.nextCol += 55;
    }
    fx.glow(this.P, [6, 1.6, 1.0], 40, 0.12);
    fx.flashLight(this.P, 0xff6040, 20000, 20);
    this.checkKills(mouth, true);
  }
  updateAfter(dt) {
    for (const c of this.columns) c.t += dt;
    this.columns = this.columns.filter((c) => c.t < 1.2);
    this.checkKills(null, false);
    return this.columns.length > 0;
  }
  checkKills(mouth, beamActive) {
    const CR = ATTACKS.trace.columnRadius, CH = ATTACKS.trace.columnHeight;
    for (const v of this.battle.vehicles) {
      if (!v.alive || !v.local) continue;
      const r = vehicleSegment(v, _v, _v3);
      if (beamActive) {
        if (v.kind === 'fighter') {
          if (distSegmentSegment(mouth, this.P, v.position, v.position) < this.radius + r) { this.kill(v, 'beam'); continue; }
        } else if (dist2DSegSeg(this.prevP, this.P, _v, _v3) < this.radius + r) { this.kill(v, 'beam'); continue; }
        else this.graze(v, (a, b, rr) => (dist2DSegSeg(this.prevP, this.P, a, b) < this.radius + rr ? this.P.clone() : null));
      }
      for (const c of this.columns) {
        const h = CH * Math.min(1, c.t / 0.45) * (c.t > 0.9 ? 1 - (c.t - 0.9) / 0.3 : 1);
        if (v.kind === 'fighter') {
          if (v.position.y < h && Math.hypot(v.position.x - c.p.x, v.position.z - c.p.z) < CR + r) { this.kill(v, 'column'); break; }
        } else if (c.t < 0.7 && dist2DPointSeg(c.p.x, c.p.z, _v.x, _v.z, _v3.x, _v3.z) < CR * 0.6 + r) { this.kill(v, 'column'); break; }
      }
    }
  }
  end() { this.beam.hide(); this.removeShapes(); this.k.lingering.push(this); super.end(); }
}

/** 怒りフェーズ: 3つの頭のビームが一点に集まる大技 */
class ConvergeAttack {
  constructor(k, target, p = null) {
    this.k = k; this.battle = k.battle; this.world = k.world; this.target = target;
    const A = ATTACKS.converge;
    this.telegraph = p ? p.tg : Math.max(1.6, A.telegraph * k.battle.diff.telegraph);
    this.duration = A.duration;
    this.radius = A.radius;
    this.center = p ? vec(p.c) : target.position.clone().addScaledVector(target.velocity, this.telegraph * 0.6);
    this.center.y = 0;
    this.shapes = [];
    this.state = 'charge';
    this.t = 0;
    this.exploded = false;
  }
  get params() { return { tg: this.telegraph, c: arr(this.center) }; }
  begin() {
    const tg = this.world.telegraph;
    const col = new THREE.Color(1.0, 0.25, 0.35).multiplyScalar(1.8);
    const c = tg.circle(this.center, this.radius, col, { duration: this.telegraph + 0.6 });
    this.shapes.push(c);
    const kp = this.k.pos;
    for (const key of HEAD_KEYS) {
      const from = this.k.model.socketWorld(`HeadHit_${key}`, new THREE.Vector3());
      from.y = 0;
      from.lerp(new THREE.Vector3(kp.x, 0, kp.z), 0.3);
      this.shapes.push(tg.line(from, this.center, 28, HEAD_INFO[key].color.clone().multiplyScalar(1.4), { duration: this.telegraph + 0.6 }));
    }
    for (const key of HEAD_KEYS) {
      const h = this.k.heads[key];
      h.state = 'charge';
      h.timer = this.telegraph;
      h.flinch = 0;
      h.attack = this;
      this.k.model.playHead(key, 'Charge');
    }
    this.battle.onTelegraph(this, 'converge');
  }
  update(dt) {
    this.t += dt;
    const k = this.k;
    if (this.state === 'charge') {
      const p = clamp(this.t / this.telegraph, 0, 1);
      for (const key of HEAD_KEYS) {
        k.model.setHeadGlow(key, 0.6 + p * 1.2);
        k.model.setMouthGlow(key, p);
        k.model.aimHead(key, this.center, 1);
      }
      if (this.t >= this.telegraph) {
        this.state = 'fire';
        this.t = 0;
        for (const key of HEAD_KEYS) { k.heads[key].state = 'fire'; k.model.playHead(key, 'Fire'); }
        this.battle.onBeamFire(this, 'converge');
      }
      return true;
    }
    if (this.state === 'fire') {
      const fx = this.world.effects;
      for (const key of HEAD_KEYS) {
        const mouth = k.model.socketWorld(`Mouth_${key}`, _v);
        k.beams[key].set(mouth, this.center, this.battle.camera.position, 1.4, k.time);
      }
      fx.glow(this.center, [8, 3, 6], 100, 0.12);
      if (!this.exploded && this.t > 0.45) {
        this.exploded = true;
        fx.explosion(new THREE.Vector3(this.center.x, 4, this.center.z), 9, { debris: false });
        fx.waterColumn(this.center, 300, 80);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          fx.waterColumn(new THREE.Vector3(this.center.x + Math.cos(a) * 120, 0, this.center.z + Math.sin(a) * 120), 170, 36);
        }
        fx.ring(new THREE.Vector3(this.center.x, 10, this.center.z), [6, 3, 4], 50, 640, 0.9);
        this.world.foam.addRing(this.center.x, this.center.z, 40, 540, 1.2, 4);
        this.battle.onBigExplosion(this.center, 1.0);
        for (const v of this.battle.vehicles) {
          if (!v.alive || !v.local) continue;
          const r = vehicleSegment(v, _v, _v3);
          if (v.kind === 'fighter') {
            if (v.position.distanceTo(_v2.set(this.center.x, 0, this.center.z)) < this.radius * 1.25 + r) this.battle.killVehicle(v, 'converge', 'all');
          } else if (dist2DPointSeg(this.center.x, this.center.z, _v.x, _v.z, _v3.x, _v3.z) < this.radius + r) this.battle.killVehicle(v, 'converge', 'all');
        }
      }
      if (this.t >= this.duration) {
        for (const key of HEAD_KEYS) k.beams[key].hide();
        this.finish();
        return false;
      }
      return true;
    }
    return false;
  }
  cancel() {
    for (const key of HEAD_KEYS) this.k.beams[key].hide();
    this.finish(true);
  }
  finish(cancelled = false) {
    for (const s of this.shapes) this.world.telegraph.remove(s);
    this.shapes = [];
    const k = this.k;
    for (const key of HEAD_KEYS) {
      const h = k.heads[key];
      if (!h.alive) continue;
      if (h.state !== 'stunned') {
        h.state = 'recover';
        h.timer = KAIJU.recoverTime[key] * 1.4;
        k.model.playHead(key, 'Recover');
      }
      h.attack = null;
      k.model.setHeadGlow(key, 0);
      k.model.setMouthGlow(key, 0);
    }
    k.converge = null;
    k.convergeCooldown = ATTACKS.converge.cooldown;
    this.done = true;
  }
}

/** HPが2割を切った時の大技「極太ビーム」: 10秒溜めて、前方の広い扇形を薙ぎ払う。溜め中に十分なダメージを与えれば止まる */
class MegaAttack {
  constructor(k, params = null) {
    this.k = k; this.battle = k.battle; this.world = k.world;
    const M = ATTACKS.mega;
    this.M = M;
    this.telegraph = M.telegraph;
    this.duration = M.duration;
    this.range = M.range;
    this.halfArc = (M.arc * Math.PI) / 360;
    this.center = params ? params.center : this.pickDirection();
    this.sign = params ? params.sign : (Math.random() < 0.5 ? -1 : 1);
    this.need = params ? params.need : Math.max(M.stopMin, k.maxHp * M.stopRatio);
    this.got = 0;
    this.state = 'charge';
    this.t = 0;
    this.shapes = [];
    this.fxT = 0;
    this.beam = new Beam(this.world.scene, new THREE.Color(1.6, 0.9, 2.4), 70);
    this.seaBeam = new Beam(this.world.scene, new THREE.Color(1.8, 0.7, 2.0), 55);
    this.curAng = null;
    this.cityHit = false;
  }

  get params() { return { center: this.center, sign: this.sign, need: this.need }; }
  get progress() { return this.need > 0 ? this.got / this.need : 0; }

  /** 一番多くの機体を巻き込める向き（怪獣の正面から左右40度まで） */
  pickDirection() {
    const k = this.k, yaw = k.root.rotation.y;
    let best = yaw, bestScore = -Infinity;
    for (let d = -40; d <= 40; d += 5) {
      const a = yaw + d * DEG;
      let score = -Math.abs(d) * 0.002;
      for (const v of this.battle.vehicles) {
        if (!v.alive || v.position.y > this.M.altMax) continue;
        const dx = v.position.x - k.pos.x, dz = v.position.z - k.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > this.range || dist < 150) continue;
        if (Math.abs(angleDiff(a, Math.atan2(dx, dz))) < this.halfArc) score += v.human ? 1.5 : 1;
      }
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  begin() {
    const k = this.k, tg = this.world.telegraph;
    const c = new THREE.Vector3(k.pos.x, 0, k.pos.z);
    const sh = tg.sector(c, this.center, this.M.arc, 60, this.range, new THREE.Color(1.3, 0.2, 1.5), { duration: this.telegraph + this.duration });
    sh.intensity = 0.42; // 広い範囲なので控えめに（海が見えなくならないよう）
    this.shapes.push(sh);
    for (const key of k.aliveHeads) {
      const h = k.heads[key];
      if (h.attack && h.attack !== this) h.attack.cancel();
      k.beams[key].hide();
      h.state = 'charge'; h.timer = this.telegraph; h.flinch = 0; h.attack = this;
      k.model.playHead(key, null);
      k.model.aimHead(key, null);
    }
    k.model.playBody('MegaCharge', 10 / this.telegraph, 0.4);
    this.battle.onMegaStart(this);
  }

  update(dt) {
    const k = this.k;
    this.t += dt;
    if (this.state === 'charge') {
      const p = clamp(this.t / this.telegraph, 0, 1);
      for (const key of k.aliveHeads) { k.model.setHeadGlow(key, 0.6 + p * 1.6); k.model.setMouthGlow(key, 0.3 + p * 1.3); k.model.aimHead(key, null); }
      k.model.spineGlowTarget = 1 + p * 2.6;
      this.chargeFx(dt, p);
      this.battle.onMegaCharge(this, p);
      if (this.t >= this.telegraph) { this.state = 'fire'; this.t = 0; this.fire(); }
      return true;
    }
    if (this.state === 'fire') {
      this.updateFire(dt);
      if (this.t >= this.duration) { this.finish(false); return false; }
      return true;
    }
    return false;
  }

  /** 溜め: 口に光が吸い込まれ、足元の海が沸き立つ */
  chargeFx(dt, p) {
    const k = this.k, fx = this.world.effects;
    for (const key of k.aliveHeads) {
      const m = k.model.socketWorld(`Mouth_${key}`, new THREE.Vector3());
      const n = Math.ceil(1 + p * 4);
      for (let i = 0; i < n; i++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(50, 130));
        const life = rand(0.35, 0.6);
        fx.add.spawn({ x: m.x + d.x, y: m.y + d.y, z: m.z + d.z, vx: -d.x / life, vy: -d.y / life, vz: -d.z / life, life, size: rand(5, 9), size1: 1.5,
          color: [3.2, 1.4, 4.5, 1], color1: [6, 4, 8, 1], frame: 6, fadeIn: 0.2 });
      }
      fx.glow(m, [3 + p * 4, 1.5 + p * 2, 5 + p * 5], 18 + p * 50, 0.08);
    }
    if (Math.random() < dt * (4 + p * 10)) {
      const a = Math.random() * Math.PI * 2, r = rand(40, 160);
      fx.steam(new THREE.Vector3(k.pos.x + Math.cos(a) * r, 0, k.pos.z + Math.sin(a) * r), 2.5 + p * 2);
    }
    if (Math.random() < dt * 1.2) this.world.foam.addRing(k.pos.x, k.pos.z, 40, 300 + p * 400, 0.5, 3);
    if (Math.random() < dt * (1 + p * 3)) this.battle.shakeAt(k.pos, 0.12 + p * 0.35);
    fx.flashLight(k.focus, 0xb070ff, 8000 + p * 40000, 10);
  }

  fire() {
    const k = this.k;
    k.model.playBody('MegaFire', 1, 0.15);
    for (const key of k.aliveHeads) { k.heads[key].state = 'fire'; k.model.setHeadGlow(key, 2.2); k.model.setMouthGlow(key, 2.0); }
    this.battle.onMegaFire(this);
  }

  updateFire(dt) {
    const k = this.k;
    const u = clamp(this.t / this.duration, 0, 1);
    const e = u * u * (3 - 2 * u);
    const ang = this.center + this.sign * this.halfArc * (2 * e - 1);
    const prevAng = this.curAng ?? ang;
    this.curAng = ang;
    const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
    const mouth = new THREE.Vector3();
    let n = 0;
    for (const key of k.aliveHeads) { mouth.add(k.model.socketWorld(`Mouth_${key}`, _v2)); n++; }
    if (n) mouth.multiplyScalar(1 / n); else mouth.copy(k.focus);
    const hit = new THREE.Vector3(k.pos.x, 0, k.pos.z).addScaledVector(dir, 420);
    hit.y = this.world.ocean.heightAt(hit.x, hit.z);
    const far = new THREE.Vector3(k.pos.x, 6, k.pos.z).addScaledVector(dir, this.range);
    const fade = Math.min(1, this.t / 0.1) * Math.min(1, (this.duration - this.t) / 0.3 + 0.1);
    const cam = this.battle.camera.position;
    this.beam.set(mouth, hit, cam, 2.4 * fade, k.time);
    this.seaBeam.set(hit, far, cam, 1.7 * fade, k.time);
    const fx = this.world.effects;
    this.fxT += dt;
    if (this.fxT > 0.035) {
      this.fxT = 0;
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Vector3(k.pos.x, 0, k.pos.z).addScaledVector(dir, rand(430, this.range));
        fx.waterColumn(p, rand(130, 260), rand(40, 70));
        if (Math.random() < 0.5) fx.steam(p, 3);
        this.world.foam.addDecal(p.x, p.z, 90, 1.0, 14);
      }
      fx.explosion(hit, 4, { debris: false });
      fx.glow(hit, [6, 3, 8], 170, 0.12);
    }
    fx.flashLight(hit, 0xd080ff, 60000, 8);
    // 判定: 光の帯が今のフレームで通り過ぎた方向にいる、低空の機体（それぞれの機体を動かしている端末で判定）
    for (const v of this.battle.vehicles) {
      if (!v.alive || !v.local || v.position.y > this.M.altMax) continue;
      const dx = v.position.x - k.pos.x, dz = v.position.z - k.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.range + 40 || d < 150) continue;
      const va = Math.atan2(dx, dz);
      const tol = (this.M.radius + v.hitRadius + (v.length ? v.length * 0.3 : 0)) / Math.max(d, 1);
      const r0 = angleDiff(prevAng, va), r1 = angleDiff(ang, va);
      const crossed = Math.sign(r0) !== Math.sign(r1) && Math.abs(r0) < 0.5 && Math.abs(r1) < 0.5;
      if (crossed || Math.min(Math.abs(r0), Math.abs(r1)) < tol) this.battle.killVehicle(v, 'mega', 'all', { force: true });
    }
    // 街まで届くなら、正面を薙いだ時に海岸線が燃える
    const coast = k.distanceToCity + 40 * S;
    if (!this.cityHit && coast < this.range && Math.abs(angleDiff(ang, 0)) < 0.12) {
      this.cityHit = true;
      this.battle.onMegaCity(new THREE.Vector3(k.pos.x, 0, WORLD.cityDistance));
    }
  }

  stop() {
    if (this.state !== 'charge') return;
    this.k.emit('megaStop');
    this.k.model.playBody('HitBig', 0.8, 0.1);
    this.finish(true);
  }

  finish(stopped) {
    for (const s of this.shapes) this.world.telegraph.remove(s);
    this.shapes = [];
    this.beam.dispose(); this.seaBeam.dispose();
    const k = this.k;
    for (const key of k.aliveHeads) {
      const h = k.heads[key];
      h.attack = null;
      h.state = stopped ? 'stunned' : 'recover';
      h.timer = stopped ? this.M.stun : this.M.exhaust;
      k.model.playHead(key, stopped ? 'Flinch' : 'Recover');
      k.model.setHeadGlow(key, 0);
      k.model.setMouthGlow(key, 0);
    }
    k.model.spineGlowTarget = 1;
    k.mega = null;
    k.megaCooldown = this.M.cooldown;
    this.state = stopped ? 'stopped' : 'done';
    this.battle.onMegaEnd(this, stopped);
  }

  /** 倒された時など: 何も起こさず片付ける */
  cancel() {
    for (const s of this.shapes) this.world.telegraph.remove(s);
    this.shapes = [];
    this.beam.dispose(); this.seaBeam.dispose();
    this.state = 'done';
    this.k.mega = null;
    this.battle.onMegaEnd(this, false, true);
  }
}

const HEAD_ATTACK = { R: BoltAttack, C: SweepAttack, L: TraceAttack };
const ATTACK_NAME = { R: 'bolts', C: 'sweep', L: 'trace' };
const COOLDOWN = { R: ATTACKS.bolts.cooldown, C: ATTACKS.sweep.cooldown, L: ATTACKS.trace.cooldown };
const RANGE = { R: [250, 2900], C: [450, 2900], L: [400, 2800] };
const WEIGHT = {
  R: { fighter: 3.0, ship: 0.25, carrier: 0.3 },
  C: { fighter: 1.0, ship: 2.0, carrier: 2.6 },
  L: { fighter: 0.5, ship: 2.4, carrier: 2.8 },
};
// 体から海水が流れ落ちる位置（海から上がる時・沈む時）
const POUR_BONES = ['chest', 'spine2', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R', 'neck_C2', 'neck_L2', 'neck_R2', 'head_C', 'head_L', 'head_R', 'tail_02', 'tail_04', 'thigh_L', 'thigh_R'];

// ------------------------------------------------------------------ 本体
class Kaiju {
  constructor(battle, gltf, glowTex) {
    this.battle = battle;
    this.world = battle.world;
    this.scale = S;
    this.model = new KaijuModel(gltf, glowTex, S);
    this.root = this.model.root;
    this.world.scene.add(this.root);
    this.pos = this.root.position;
    this.pos.set(0, -WORLD.kaijuWaterDepth - 80 * S, 0);
    this.velocity = new THREE.Vector3();
    this.focus = new THREE.Vector3(0, 60, 0); // 胸の位置（カメラ・照準の目安）
    this.time = 0;
    const diff = battle.diff;
    const total = KAIJU.baseHp * diff.hp * (1 + KAIJU.hpPerAlly * battle.allyCount + KAIJU.hpPerHuman * ((battle.humanCount || 1) - 1));
    this.maxHp = total;
    this.flinchThreshold = KAIJU.flinchPoints * (diff.hp > 1.2 ? 1.3 : diff.hp < 0.8 ? 0.8 : 1);
    this.heads = {};
    for (const k of HEAD_KEYS) {
      const hp = total * KAIJU.headShare[k];
      // 最初の十数秒は様子見（プレイヤーが状況をつかむ時間）
      this.heads[k] = { key: k, hp, maxHp: hp, alive: true, state: 'idle', timer: 0, cooldown: { R: rand(8, 11), C: rand(13, 16), L: rand(10, 13) }[k], flinch: 0, attack: null, snapCd: rand(2, 5) };
    }
    this.rage = false;
    this.rageLevel = 0;
    this.dead = false;
    this.deathT = 0;
    this.phase = 'intro';
    this.introT = 0;
    this.speed = 0;
    this.meleeCooldown = 9;
    this.convergeCooldown = 8;
    this.converge = null;
    this.mega = null;           // 極太ビーム（HP2割以下）
    this.megaCooldown = 0;
    this.megaWait = 0;
    this.auth = !battle.net || battle.net.isHost; // マルチプレイでは攻撃の判断はホストだけが行う
    this.melee = null;
    this.lingering = [];
    this.bolts = [];
    this.leadSkill = 0.5 + (diff.attackRate - 1) * 0.6; // 先読みは控えめ（動き続ける戦闘機には当たりにくい）
    this.beams = {
      R: new Beam(this.world.scene, HEAD_INFO.R.color.clone().multiplyScalar(2.2), 6),
      C: new Beam(this.world.scene, HEAD_INFO.C.color.clone().multiplyScalar(2.2), 21),
      L: new Beam(this.world.scene, HEAD_INFO.L.color.clone().multiplyScalar(2.2), 15),
    };
    this.boltGeo = new THREE.CylinderGeometry(2.0, 2.0, 64, 6, 1, true).rotateX(Math.PI / 2);
    this.boltMat = new THREE.MeshBasicMaterial({ color: HEAD_INFO.R.color.clone().multiplyScalar(5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.headSpheres = {};
    for (const k of HEAD_KEYS) this.headSpheres[k] = { c: new THREE.Vector3(), r: HEAD_R[k] };
    this.capsules = [];
    this.buildCapsules();
    this.bound = { c: new THREE.Vector3(), r: 100 * S };
    this.stepPhasePrev = 0;
    this.wake = this.world.foam.createTrail({ life: 45, w0: 50 * S, spread: 1.4, strength: 0.55, kelvin: false, step: 8 * S });
    this.foamT = 0;
    this.stats = { flinches: 0 };
    // 怪獣らしい仕草のタイマー
    this.act = { look: rand(14, 20), roar: rand(32, 45), stomp: rand(26, 38), hitCd: 0, pendingStomp: 0, slamT: -1, pourT: 0 };
  }

  get hp() { let s = 0; for (const k of HEAD_KEYS) s += Math.max(0, this.heads[k].hp); return s; }
  get aliveHeads() { return HEAD_KEYS.filter((k) => this.heads[k].alive); }
  get forward() { return _v.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)); }
  get distanceToCity() { return Math.max(0, WORLD.cityDistance - this.pos.z - 40 * S); }

  tele(base) {
    const lost = 3 - this.aliveHeads.length;
    return Math.max(1.0, base * this.battle.diff.telegraph * (this.rage ? 0.88 : 1) * Math.pow(0.93, lost));
  }

  buildCapsules() {
    const B = (n) => this.model.bones[n];
    const caps = [];
    const add = (a, b, r, part, head = null) => { if (B(a) && B(b)) caps.push({ a, b, r: r * S, part, head, A: new THREE.Vector3(), Bp: new THREE.Vector3() }); };
    add('pelvis', 'chest', 17, 'body');
    add('chest', 'neck_C1', 14, 'body');
    for (const k of HEAD_KEYS) add(`neck_${k}1`, `head_${k}`, k === 'C' ? 8.5 : 7.5, 'neck', k);
    for (const s of ['L', 'R']) {
      add(`thigh_${s}`, `shin_${s}`, 11, 'leg');
      add(`shin_${s}`, `foot_${s}`, 7.5, 'leg');
      add(`upperarm_${s}`, `forearm_${s}`, 6, 'arm');
      add(`forearm_${s}`, `hand_${s}`, 5, 'arm');
    }
    const TR = [12.5, 11, 9.5, 8, 6.6, 5.4, 4.3, 3.3, 2.5, 1.8];
    for (let i = 1; i < 10; i++) add(`tail_${String(i).padStart(2, '0')}`, `tail_${String(i + 1).padStart(2, '0')}`, TR[i - 1], 'tail');
    this.capsules = caps;
  }

  updateShapes() {
    for (const k of HEAD_KEYS) this.model.socketWorld(`HeadHit_${k}`, this.headSpheres[k].c);
    for (const c of this.capsules) {
      this.model.boneWorld(c.a, c.A);
      this.model.boneWorld(c.b, c.Bp);
    }
    this.model.boneWorld('chest', this.focus);
    // 全体を包む球（弾の当たり判定の早期除外）
    this.bound.c.copy(this.pos).addScaledVector(this.forward, -25 * S);
    this.bound.c.y += 55 * S;
  }

  /** 線分と怪獣の交差（弾の当たり判定）。最初に当たった部位を返す */
  intersectSegment(p0, p1, pad = 0) {
    if (segmentSphere(p0, p1, this.bound.c, this.bound.r + pad) < 0) return null;
    let best = null;
    for (const k of HEAD_KEYS) {
      const s = this.headSpheres[k];
      const t = segmentSphere(p0, p1, s.c, s.r + pad);
      if (t >= 0 && (!best || t < best.t)) best = { t, head: this.heads[k].alive ? k : null, part: 'head', key: k };
    }
    for (const c of this.capsules) {
      const d = distSegmentSegment(p0, p1, c.A, c.Bp);
      if (d <= c.r + pad) {
        // おおよその入射位置: 線分上でカプセル軸に最も近い点
        const t = this._closestT(p0, p1, c.A, c.Bp);
        if (!best || t < best.t) best = { t, head: null, part: c.part, neckOf: c.head };
      }
    }
    if (best) best.point = new THREE.Vector3().lerpVectors(p0, p1, best.t);
    return best;
  }

  _closestT(p0, p1, a, b) {
    let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      _v.lerpVectors(p0, p1, t);
      const ab = _v2.subVectors(b, a);
      const s = clamp(_v3.subVectors(_v, a).dot(ab) / ab.lengthSq(), 0, 1);
      const d = _v.distanceTo(_v3.copy(a).addScaledVector(ab, s));
      if (d < bestD) { bestD = d; bestT = t; }
    }
    return bestT;
  }

  /** 画面からのレイ（照準用） */
  raycast(ray) {
    const far = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, 12000);
    const hit = this.intersectSegment(ray.origin, far);
    return hit ? hit.point : null;
  }

  /** 指定した点が怪獣の体内か（戦闘機の衝突） */
  pointInside(p, pad = 0) {
    if (p.distanceTo(this.bound.c) > this.bound.r + pad) return false;
    for (const k of HEAD_KEYS) if (p.distanceTo(this.headSpheres[k].c) < this.headSpheres[k].r + pad) return true;
    for (const c of this.capsules) if (distSegmentSegment(p, p, c.A, c.Bp) < c.r + pad) return true;
    return false;
  }

  /** ダメージ。opts: { head, flinch, point, owner, kind, part } */
  damage(amount, opts = {}) {
    if (this.dead || this.phase === 'intro') return 0;
    let dealt = 0;
    const key = opts.head;
    const megaCharging = this.mega && this.mega.state === 'charge';
    const vuln = (h) => (megaCharging ? ATTACKS.mega.vuln : h.state === 'recover' || h.state === 'stunned' ? KAIJU.vulnerableMul : 1);
    if (key && this.heads[key].alive) {
      const h = this.heads[key];
      const d = amount * vuln(h);
      h.hp -= d;
      dealt = d;
      if (h.state === 'charge' && !(h.attack instanceof MegaAttack)) {
        h.flinch += amount * (opts.flinch || 1);
        if (h.flinch >= this.flinchThreshold) this.flinchHead(h, opts.owner);
      }
      if (h.hp <= 0) this.killHead(h, opts.owner);
      else if (amount >= 90 && opts.kind !== 'gun') this.model.playHeadOnce(key, 'Shake');
      this.model.flash(Math.min(0.6, 0.15 + amount / 400));
    } else {
      const alive = this.aliveHeads;
      if (!alive.length) return 0;
      const per = (amount * KAIJU.bodyDamageMul) / alive.length;
      for (const k of alive) {
        const h = this.heads[k];
        const d = per * vuln(h);
        h.hp -= d;
        dealt += d;
        if (h.hp <= 0) this.killHead(h, opts.owner);
      }
      // 大きな胴体ダメージ（魚雷・爆撃）は溜め中の頭も揺さぶる
      if ((opts.flinch || 0) >= 2) {
        for (const k of alive) {
          const h = this.heads[k];
          if (h.state === 'charge' && !(h.attack instanceof MegaAttack)) {
            h.flinch += amount * 0.25 * opts.flinch;
            if (h.flinch >= this.flinchThreshold) this.flinchHead(h, opts.owner);
          }
        }
      }
      this.model.flash(Math.min(0.5, amount / 600));
    }
    // 極太ビームの溜め中: 与えたダメージが阻止ゲージになる
    if (megaCharging && this.mega) {
      this.mega.got += dealt;
      if (this.auth && this.mega.got >= this.mega.need && !this.dead) this.mega.stop();
    } else if (amount >= 380 && opts.kind !== 'gun' && !this.dead) this.bigHitReaction(opts);
    this.battle.onKaijuDamaged(dealt, opts);
    if (!this.rage && this.hp <= this.maxHp * 0.5 && !this.dead) this.enterRage();
    if (!this.dead && this.aliveHeads.length === 0) this.die();
    return dealt;
  }

  /** 魚雷・爆撃の大きな被弾: のけぞる / 尾に当たれば尾を打ちつける */
  bigHitReaction(opts) {
    if (this.act.hitCd > 0 || this.melee || this.phase !== 'alive' || this.act.slamT >= 0 || this.mega) return;
    this.react(opts.part === 'tail' ? 'TailThrash' : 'HitBig');
  }

  react(clip) {
    this.act.hitCd = 5.5;
    this.model.playBody(clip, 1, 0.1);
    for (const k of this.aliveHeads) this.model.playHeadOnce(k, 'Shake');
    this.battle.onKaijuPain(this.focus, 0.8);
    this.emit('react', { clip });
  }

  // ---------------------------------------------------------------- マルチプレイ
  /** ホストが決めたことを他のプレイヤーへ送る（ひとり用・参加者側では何もしない） */
  emit(e, data = {}) {
    if (this.auth && this.battle.net) this.battle.net.kaijuEvent({ e, ...data });
  }

  /** 参加者側: ホストから届いた怪獣の出来事を再生する */
  applyEvent(ev) {
    const b = this.battle;
    const target = (id, p) => b.vehicleById(id) || { id: null, kind: 'ship', position: vec(p) || this.focus.clone(), velocity: new THREE.Vector3(), heading: 0, alive: true };
    switch (ev.e) {
      case 'atk': {
        const h = this.heads[ev.key];
        if (!h || !h.alive) return;
        if (h.attack && !(h.attack instanceof MegaAttack)) { h.attack.cancel(); h.attack = null; }
        this.startHeadAttack(h, target(ev.tid, ev.tp), ev.p);
        break;
      }
      case 'bolt': this.spawnBolt(vec(ev.o), vec(ev.v), ev.l); break;
      case 'melee': if (!this.melee) this.startMelee(ev.m); break;
      case 'conv': if (!this.converge) { this.converge = new ConvergeAttack(this, target(ev.tid), ev.p); this.converge.begin(); } break;
      case 'mega': if (!this.mega) this.startMega(ev.p); break;
      case 'megaStop': if (this.mega) this.mega.stop(); break;
      case 'flinch': { const h = this.heads[ev.key]; if (h && h.alive) this.flinchHead(h, b.vehicleById(ev.by)); break; }
      case 'hkill': { const h = this.heads[ev.key]; if (h && h.alive) this.killHead(h, b.vehicleById(ev.by)); break; }
      case 'rage': if (!this.rage) this.enterRage(); break;
      case 'die':
        if (!this.dead) {
          for (const k of HEAD_KEYS) { const h = this.heads[k]; if (h.alive) { h.alive = false; h.hp = 0; h.state = 'dead'; h.attack = null; this.model.killHead(k); } }
          this.die();
        }
        break;
      case 'react': this.react(ev.clip); break;
      case 'stomp': this.stomp(); break;
      case 'anim': this.model.playBody(ev.clip); break;
      case 'roar': this.roarNow(); break;
      case 'snap': this.snapAt(ev.key, b.vehicleById(ev.tid)); break;
      default: break;
    }
  }

  /** ホスト → 参加者へ送る怪獣の状態（位置・速さ・首のHP・阻止ゲージ） */
  snapshot() {
    return { z: Math.round(this.pos.z * 10) / 10, sp: Math.round(this.speed * 100) / 100, hp: HEAD_KEYS.map((k) => Math.round(this.heads[k].hp)), mg: this.mega ? Math.round(this.mega.got) : 0 };
  }

  applySnapshot(s) {
    this.netZ = s.z;
    this.netSpeed = s.sp;
    HEAD_KEYS.forEach((k, i) => { const h = this.heads[k]; if (h.alive) h.hp = Math.max(1, s.hp[i]); });
    if (this.mega && this.mega.state === 'charge') this.mega.got = Math.max(this.mega.got, s.mg);
  }

  flinchHead(h, owner) {
    this.emit('flinch', { key: h.key, by: owner && owner.id });
    if (h.attack instanceof ConvergeAttack) {
      const c = h.attack;
      h.state = 'stunned';
      h.timer = KAIJU.stunTime;
      c.cancel();
    } else if (h.attack) {
      h.attack.cancel();
      h.attack = null;
    }
    h.state = 'stunned';
    h.timer = KAIJU.stunTime;
    h.flinch = 0;
    this.model.playHead(h.key, 'Flinch');
    this.model.setHeadGlow(h.key, 0);
    this.model.setMouthGlow(h.key, 0);
    this.stats.flinches++;
    this.battle.onFlinch(h.key, owner);
  }

  killHead(h, owner) {
    if (!h.alive) return;
    this.emit('hkill', { key: h.key, by: owner && owner.id });
    h.alive = false;
    h.hp = 0;
    if (h.attack) {
      // 極太ビームは残りの首で続ける（首を全部倒した時だけ消える）
      if (!(h.attack instanceof MegaAttack)) h.attack.cancel();
      h.attack = null;
    }
    h.state = 'dead';
    if (this.mega && this.aliveHeads.length === 0) this.mega.cancel();
    this.model.killHead(h.key);
    this.beams[h.key].hide();
    const p = this.headSpheres[h.key].c.clone();
    const fx = this.world.effects;
    fx.explosion(p, 4.2);
    fx.explosion(p.clone().add(new THREE.Vector3(rand(-12, 12), rand(-8, 8), rand(-12, 12))), 3.0);
    this.headSmoke(h.key);
    if (this.aliveHeads.length > 0) {
      this.model.playBody('Stagger');
      this.act.pendingStomp = 2.6; // 首を失った怒りで足を踏み鳴らす
    }
    this.battle.onHeadKilled(h.key, owner);
  }

  headSmoke(key) {
    const fx = this.world.effects;
    const sock = `Throat_${key}`;
    fx.addEmitter((dt) => {
      if (this.pos.y < -WORLD.kaijuWaterDepth - 60 * S) return false;
      const p = this.model.socketWorld(sock, _v2);
      if (p.y < 0) return true;
      if (Math.random() < 0.6) fx.smokeTrail(p, 4, true);
      if (Math.random() < 0.3) fx.fire(p, 2.2);
      return true;
    });
  }

  enterRage() {
    this.rage = true;
    this.emit('rage');
    if (!this.mega) this.model.playBody(this.model.hasClip('RageRoar') ? 'RageRoar' : 'Roar', 1, 0.15);
    for (const k of this.aliveHeads) if (this.heads[k].state === 'idle') this.model.playHeadOnce(k, 'Roar');
    this.act.look = Math.max(this.act.look, 8);
    this.battle.onRage();
  }

  die() {
    this.emit('die');
    this.dead = true;
    this.phase = 'dying';
    this.deathT = 0;
    for (const k of HEAD_KEYS) { this.beams[k].hide(); }
    if (this.mega) this.mega.cancel();
    if (this.converge) this.converge.cancel();
    if (this.melee) { for (const s of this.melee.shapes) this.world.telegraph.remove(s); this.melee = null; }
    this.world.telegraph.clear();
    this.deathDuration = this.model.die();
    this.battle.onKaijuDying();
  }

  spawnBolt(origin, vel, life = 4) {
    const m = new THREE.Mesh(this.boltGeo, this.boltMat);
    m.position.copy(origin);
    m.lookAt(_v.copy(origin).add(vel));
    m.renderOrder = 26;
    this.world.scene.add(m);
    this.bolts.push({ mesh: m, p: origin.clone(), v: vel.clone(), t: 0, life });
    this.world.effects.glow(origin, [3, 8, 10], 24, 0.15);
    this.battle.onBolt(origin);
    this.emit('bolt', { o: arr(origin), v: arr(vel), l: Math.round(life * 100) / 100 });
  }

  updateBolts(dt) {
    const fx = this.world.effects;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const p0 = _v2.copy(b.p);
      b.p.addScaledVector(b.v, dt);
      b.t += dt;
      b.mesh.position.copy(b.p);
      let dead = b.t > b.life;
      if (dead) fx.glow(b.p, [1.5, 4, 5], 16, 0.25);
      for (const v of this.battle.vehicles) {
        if (!v.alive || !v.local) continue;
        const r = vehicleSegment(v, _v, _v3) + ATTACKS.bolts.radius;
        if (distSegmentSegment(p0, b.p, _v, _v3) < r) { this.battle.killVehicle(v, 'bolt', 'R'); dead = true; break; }
      }
      if (!dead && b.p.y < this.world.ocean.heightAt(b.p.x, b.p.z)) {
        fx.splash(b.p, 1.1, { height: 32 });
        fx.steam(b.p, 1.0);
        fx.glow(b.p, [2, 6, 8], 26, 0.2);
        dead = true;
      }
      if (dead) {
        this.world.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      } else if (Math.random() < 0.5) {
        fx.add.spawn({ x: b.p.x, y: b.p.y, z: b.p.z, life: 0.25, size: 9, size1: 2.5, color: [2, 6, 8, 1], color1: [0.2, 0.6, 1, 0], frame: 6, fadeIn: 0 });
      }
    }
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    this.time += dt;
    if (this.phase === 'intro') this.updateIntro(dt);
    else if (this.phase === 'dying') this.updateDeath(dt);
    else this.updateAlive(dt);
    this.model.setWalking(this.speed);
    this.model.update(dt);
    this.updateShapes();
    this.updateBolts(dt);
    for (let i = this.lingering.length - 1; i >= 0; i--) if (!this.lingering[i].updateAfter(dt)) this.lingering.splice(i, 1);
    this.updateWater(dt);
    this.velocity.set(0, 0, this.speed);
    this.rageLevel += ((this.rage ? 1 : 0) - this.rageLevel) * Math.min(1, dt * 0.8);
    this.model.setRage(this.dead ? this.rageLevel * Math.max(0, 1 - this.deathT / 6) : this.rageLevel);
  }

  /** 海から立ち上がる登場シーン（テレビ中継の時間割に合わせる: しばらく海面が盛り上がってから現れる） */
  updateIntro(dt) {
    this.introT += dt;
    const T = this.introT, E = KAIJU_INTRO.emergeAt;
    const y0 = -WORLD.kaijuWaterDepth - 90 * S, y1 = -WORLD.kaijuWaterDepth;
    if (T < E) {
      this.pos.y = y0;
      const k = T / E;
      const fx = this.world.effects;
      if (Math.random() < dt * (0.6 + k * 5)) {
        const a = Math.random() * Math.PI * 2, r = rand(20, 150);
        fx.splash(new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r), rand(0.8, 1.6) + k, { height: rand(10, 30) + k * 40 });
      }
      if (Math.random() < dt * (0.25 + k)) this.world.foam.addRing(this.pos.x, this.pos.z, 30, 220 + k * 300, 0.35 + k * 0.4, 4);
      if (Math.random() < dt * (2 + k * 6)) fx.bubbles(new THREE.Vector3(this.pos.x + rand(-110, 110), 0, this.pos.z + rand(-110, 110)), 30, 1 + k);
      if (k > 0.55 && Math.random() < dt * 2) this.battle.shakeAt(this.pos, 0.15);
      return;
    }
    if (!this.emerging) {
      this.emerging = true;
      this.model.playOverride('Emerge', 0.05);
      this.model.setWet(1);
    }
    const t = T - E;
    const e = smoothstep(0, 5.6, t);
    const prevY = this.pos.y;
    this.pos.y = y0 + (y1 - y0) * e;
    const riseV = (this.pos.y - prevY) / Math.max(dt, 1e-3);
    const fx = this.world.effects;
    if (t < 7.5) {
      // 海面が盛り上がって割れる
      if (Math.random() < dt * 7) {
        const a = Math.random() * Math.PI * 2, r = rand(30, 140);
        fx.splash(new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r), rand(1.4, 2.6), { height: rand(30, 90) });
      }
      if (Math.random() < dt * 0.9) this.world.foam.addRing(this.pos.x, this.pos.z, 40, 460, 0.5, 4);
      if (Math.random() < dt * 4) this.world.foam.addDecal(this.pos.x + rand(-90, 90), this.pos.z + rand(-90, 90), 70, 0.4, 7, 1.6);
      if (t > 0.8 && !this.introBurst) {
        this.introBurst = true;
        fx.waterColumn(new THREE.Vector3(this.pos.x, 0, this.pos.z - 20), 240, 90);
        fx.waterColumn(new THREE.Vector3(this.pos.x + 50, 0, this.pos.z + 30), 160, 50);
        fx.waterColumn(new THREE.Vector3(this.pos.x - 50, 0, this.pos.z + 30), 160, 50);
        this.world.foam.addRing(this.pos.x, this.pos.z, 30, 700, 1.0, 5);
        this.battle.onBigExplosion(this.pos, 0.6);
      }
    }
    // 体から海水が流れ落ちる
    this.pourWater(dt, t < 9 ? 1 : 0, riseV);
    if (t > 6.4 && !this.introRoar) {
      this.introRoar = true;
      this.model.playBody('Roar');
      for (const k of HEAD_KEYS) this.model.playHeadOnce(k, 'Roar');
      this.battle.onRoar();
    }
    if (T > KAIJU_INTRO.end) { this.phase = 'alive'; this.battle.onKaijuReady(); }
  }

  /** 登場シーンを飛ばす */
  skipIntro() {
    if (this.phase !== 'intro') return;
    this.introT = Math.max(this.introT, KAIJU_INTRO.end - 0.05);
    this.emerging = true;
    this.introRoar = true;
    this.introBurst = true;
    this.pos.y = -WORLD.kaijuWaterDepth;
    this.model.endOverride(0.3);
  }

  /** 濡れた体から海水が流れ落ちる（strength 0..1） */
  pourWater(dt, strength, riseV = 0) {
    if (strength <= 0) return;
    this.act.pourT += dt * 26 * strength;
    const fx = this.world.effects;
    const vel = _v3.set(0, Math.max(0, riseV), this.speed * 0.6);
    while (this.act.pourT > 1) {
      this.act.pourT -= 1;
      const p = this.model.boneWorld(pick(POUR_BONES), new THREE.Vector3());
      if (p.y < 3) continue;
      p.x += rand(-10, 10) * S; p.z += rand(-10, 10) * S; p.y += rand(-4, 6) * S;
      fx.pour(p, 1.4 * S, vel);
    }
  }

  /** 倒された: よろめき・膝が崩れ・最後の咆哮・ゆっくり海へ沈む */
  updateDeath(dt) {
    this.deathT += dt;
    const t = this.deathT;
    this.speed = Math.max(0, this.speed - dt * 5);
    this.pos.z += this.speed * dt;
    const fx = this.world.effects;
    const kp = this.pos;
    // 最後の首が落ちた衝撃で、体のあちこちが爆ぜる
    if (t < 2.4 && Math.random() < dt * 4.5) {
      const b = pick(['chest', 'spine2', 'neck_C1', 'neck_L1', 'neck_R1', 'upperarm_L', 'upperarm_R']);
      const p = this.model.boneWorld(b, new THREE.Vector3()).add(new THREE.Vector3(rand(-8, 8), rand(-6, 6), rand(-8, 8)).multiplyScalar(S));
      fx.explosion(p, rand(2.2, 3.4));
      this.battle.onExplosion(p, 0.6);
    }
    // 膝が崩れ、海面を叩く
    if (t > 2.7 && !this.kneeSplash) {
      this.kneeSplash = true;
      for (const s of ['L', 'R']) {
        const p = this.model.boneWorld(`shin_${s}`, new THREE.Vector3());
        p.y = 0;
        for (let i = 0; i < 4; i++) fx.waterColumn(new THREE.Vector3(p.x + rand(-40, 40), 0, p.z + rand(-50, 30)), rand(120, 200), 46);
        this.world.foam.addRing(p.x, p.z, 30, 380, 1.2, 5);
      }
      this.world.foam.addRing(kp.x, kp.z, 60, 900, 1.0, 7);
      this.battle.onBigExplosion(kp, 1.0);
    }
    if (t > 3.6 && !this.lastRoar) { this.lastRoar = true; this.battle.onKaijuLastRoar(); }
    // ゆっくり沈む（少し前のめりに）
    if (t > 5.0) {
      const sinkV = Math.min(14, (t - 5.0) * 3.0);
      kp.y -= sinkV * dt;
      this.root.rotation.x = damp(this.root.rotation.x, 0.17, 0.35, dt);
      this.root.rotation.z = damp(this.root.rotation.z, 0.04, 0.3, dt);
      // 海面との境目から泡と湯気（光る背びれが海に入る）
      const ringR = 45 * S;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = ringR * rand(0.5, 1.15);
        const p = new THREE.Vector3(kp.x + Math.sin(a) * r, 0, kp.z + Math.cos(a) * r - 20 * S);
        if (Math.random() < 0.7) fx.bubbles(p, 14 * S, 1.6);
        if (Math.random() < 0.5) fx.steam(p, 2.6);
      }
      if (Math.random() < dt * 1.6) {
        const a = Math.random() * Math.PI * 2;
        fx.waterColumn(new THREE.Vector3(kp.x + Math.sin(a) * ringR * 0.8, 0, kp.z + Math.cos(a) * ringR * 0.8), rand(60, 120), 30);
      }
      if (Math.random() < dt * 1.2) this.world.foam.addRing(kp.x, kp.z - 20 * S, 40, 420, 0.7, 4);
      // 海から出ている部分から海水が流れ落ちる
      this.pourWater(dt, 0.7, -sinkV);
    }
    if (t > 8) this.model.spineGlowTarget = 0.15;
    const sunk = kp.y < -WORLD.kaijuWaterDepth - 125 * S;
    if (!this.finished && (sunk || t > 16)) {
      this.finished = true;
      // 沈んだ跡: 大きな渦と泡
      this.world.foam.addRing(kp.x, kp.z - 20 * S, 50, 1100, 1.1, 9);
      fx.waterColumn(new THREE.Vector3(kp.x, 0, kp.z - 20 * S), 180, 70);
      const cx = kp.x, cz = kp.z - 20 * S;
      fx.addEmitter((dtt, et) => {
        if (et > 12) return false;
        if (Math.random() < 0.8) fx.bubbles(new THREE.Vector3(cx + rand(-60, 60), 0, cz + rand(-60, 60)), 30, 1.4 * (1 - et / 12) + 0.4);
        if (Math.random() < 0.3 * (1 - et / 12)) fx.steam(new THREE.Vector3(cx + rand(-50, 50), 0, cz + rand(-50, 50)), 3);
        return true;
      });
      this.battle.onKaijuDead();
    }
    if (kp.y < -WORLD.kaijuWaterDepth - 210 * S) this.root.visible = false;
  }

  updateAlive(dt) {
    const meleeBusy = !!this.melee;
    const target = this.mega ? 0 : this.rage ? KAIJU.rageWalkSpeed : KAIJU.walkSpeed;
    const slowed = meleeBusy || this.act.slamT >= 0;
    this.speed += ((slowed ? target * 0.35 : target) - this.speed) * Math.min(1, dt * (this.mega ? 1.5 : 0.6));
    if (!this.auth && this.netSpeed !== undefined && !this.mega) this.speed += (this.netSpeed - this.speed) * Math.min(1, dt * 2);
    this.pos.z += this.speed * dt;
    // 参加者側: ホストの位置へ少しずつ合わせる
    if (!this.auth && this.netZ !== undefined) this.pos.z += (this.netZ - this.pos.z) * Math.min(1, dt * 1.5);
    this.pos.y = -WORLD.kaijuWaterDepth;
    // 足音（歩行サイクルの接地）
    const walk = this.model.base.Walk;
    if (walk && walk.getEffectiveWeight() > 0.4) {
      const ph = (walk.time / walk.getClip().duration) % 1;
      for (const [p, side] of [[0.02, 'L'], [0.52, 'R']]) {
        if (this.stepPhasePrev < p && ph >= p) this.footstep(side);
      }
      if (ph < this.stepPhasePrev) { if (this.stepPhasePrev < 0.02) this.footstep('L'); }
      this.stepPhasePrev = ph;
    }
    this.updateHeads(dt);
    this.updateMelee(dt);
    this.updateConverge(dt);
    this.updateMega(dt);
    this.updateBehaviors(dt);
    this.pourWater(dt, this.model.uniforms.uWet.value * 0.35);
    if (this.auth && this.distanceToCity <= 40 && !this.reachedCity) { this.reachedCity = true; this.battle.onCityReached(); }
  }

  /** HPが2割を切ると、他の攻撃が終わるのを待って（最大4秒）極太ビームの溜めに入る */
  get megaPending() { return !this.mega && this.megaCooldown <= 0 && this.hp <= this.maxHp * ATTACKS.mega.hpRatio; }

  updateMega(dt) {
    if (this.mega) { this.mega.update(dt); return; }
    this.megaCooldown -= dt;
    if (!this.auth || !this.megaPending) { this.megaWait = 0; return; }
    if (this.melee || this.converge || this.act.slamT >= 0) return;
    this.megaWait += dt;
    if (this.attacksActive() > 0 && this.megaWait < 4) return;
    this.megaWait = 0;
    this.startMega();
  }

  startMega(p = null) {
    this.mega = new MegaAttack(this, p);
    this.emit('mega', { p: this.mega.params });
    this.mega.begin();
  }

  /** 攻撃以外の怪獣らしい仕草（見回す・吠える・足を踏み鳴らす・近くの戦闘機に噛みつく） */
  updateBehaviors(dt) {
    const a = this.act;
    a.hitCd = Math.max(0, a.hitCd - dt);
    const m = this.model;
    const calm = !this.melee && !this.converge && !this.mega && m.bodyRemaining() < 0.2;
    if (a.slamT >= 0) {
      a.slamT -= dt;
      if (a.slamT < 0) this.stompSlam();
      return;
    }
    if (!this.auth) return; // ここから下の「いつ何をするか」はホストが決める
    // 踏み鳴らし（予約されたもの → 怒り中は時々）
    if (a.pendingStomp > 0) {
      a.pendingStomp -= dt;
      if (a.pendingStomp <= 0) { if (calm) this.stomp(); else a.pendingStomp = 0.8; }
    } else if (this.rage) {
      a.stomp -= dt;
      if (a.stomp <= 0 && calm && this.attacksActive() === 0) { this.stomp(); a.stomp = rand(30, 44); }
    }
    // 見回す
    a.look -= dt;
    if (a.look <= 0) {
      if (calm && this.attacksActive() === 0) { m.playBody('LookAround'); this.emit('anim', { clip: 'LookAround' }); a.look = rand(18, 30); } else a.look = 2;
    }
    // 吠える
    a.roar -= dt;
    if (a.roar <= 0) {
      if (calm && this.attacksActive() === 0) { this.roarNow(); a.roar = rand(36, 56); } else a.roar = 3;
    }
    // 近くを飛ぶ戦闘機に噛みつこうとする（見た目だけ。体当たりは別判定）
    for (const key of this.aliveHeads) {
      const h = this.heads[key];
      h.snapCd -= dt;
      if (h.state !== 'idle' || h.snapCd > 0 || m.headBusy(key)) continue;
      const hp = this.headSpheres[key].c;
      for (const v of this.battle.vehicles) {
        if (!v.alive || v.kind !== 'fighter') continue;
        if (v.position.distanceTo(hp) < 135 * S) { this.snapAt(key, v); h.snapCd = rand(3.5, 6); break; }
      }
    }
  }

  roarNow() {
    this.model.playBody('Roar');
    for (const k of this.aliveHeads) this.model.playHeadOnce(k, 'Roar');
    this.battle.onRoar(0.75);
    this.emit('roar');
  }

  snapAt(key, v) {
    if (!this.heads[key] || !this.heads[key].alive) return;
    this.model.playHeadOnce(key, 'Snap');
    if (v) this.model.aimHead(key, v.position, 1);
    this.battle.onSnap(this.headSpheres[key].c, key);
    this.emit('snap', { key, tid: v && v.id });
  }

  stomp() {
    this.model.playBody('Stomp', 1, 0.15);
    this.act.slamT = 1.35;
    this.act.pendingStomp = 0;
    this.battle.onStompRaise();
    this.emit('stomp');
  }

  /** 足を海面に叩きつけた瞬間（見た目と揺れだけ。攻撃判定はない） */
  stompSlam() {
    const p = this.model.boneWorld('foot_R', new THREE.Vector3());
    p.y = 0;
    const fx = this.world.effects;
    fx.splash(p, 4.0, { height: 110 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2), r = rand(50, 120);
      fx.waterColumn(new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r), rand(70, 140), 30);
    }
    this.world.foam.addRing(p.x, p.z, 30, 650, 1.2, 4);
    this.world.foam.addRing(p.x, p.z, 20, 1300, 0.6, 7);
    fx.ring(new THREE.Vector3(p.x, 6, p.z), [1.2, 1.3, 1.4], 60, 900, 1.2);
    this.battle.onStomp(p);
  }

  footstep(side) {
    const p = this.model.boneWorld(`foot_${side}`, new THREE.Vector3());
    p.y = 0;
    const fx = this.world.effects;
    fx.splash(p, 3.0, { height: 46 });
    this.world.foam.addRing(p.x, p.z, 20, 150, 0.9, 3);
    this.battle.onFootstep(p);
  }

  updateWater(dt) {
    if (this.phase === 'dying' && this.deathT > 5) return;
    if (this.phase === 'intro' && this.introT < 2) return;
    this.foamT += dt;
    if (this.foamT > 0.25) {
      this.foamT = 0;
      for (const s of ['L', 'R']) {
        const p = this.model.boneWorld(`shin_${s}`, _v);
        this.world.foam.addDecal(p.x + rand(-8, 8), p.z + rand(-8, 8), 46, 0.55, 3.5, 1.2);
      }
      for (const tb of ['tail_05', 'tail_07']) {
        const t = this.model.boneWorld(tb, _v);
        if (t.y < 14) this.world.foam.addDecal(t.x, t.z, 34, 0.5, 3, 1.0);
      }
      if (Math.random() < 0.45) {
        const s = Math.random() < 0.5 ? 'L' : 'R';
        const p = this.model.boneWorld(`shin_${s}`, _v);
        this.world.effects.splash(new THREE.Vector3(p.x + rand(-14, 14), 0, p.z + rand(-14, 14)), 1.2, { height: 14 });
      }
    }
    if (this.wake) this.wake.push(this.pos.x, this.pos.z - 20, this.world.time, 1);
  }

  attacksActive() {
    let n = 0;
    for (const k of HEAD_KEYS) { const s = this.heads[k].state; if (s === 'charge' || s === 'fire') n++; }
    return n;
  }

  pickTarget(key, range, weightTable) {
    let best = null, bestScore = 0;
    const f = this.forward.clone();
    const targeted = new Set(HEAD_KEYS.map((k) => this.heads[k].attack && this.heads[k].attack.target).filter(Boolean));
    for (const v of this.battle.vehicles) {
      if (!v.alive || !v.targetable) continue;
      const dx = v.position.x - this.pos.x, dz = v.position.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < range[0] || d > range[1]) continue;
      const cos = (dx * f.x + dz * f.z) / (d || 1);
      if (cos < -0.42) continue; // 真後ろは首が届かない
      if (key === 'L' && v.kind === 'fighter' && v.position.y > 420) continue;
      let w = weightTable[v.kind] || 1;
      w *= Math.pow(1 / (d + 500), 0.7) * rand(0.75, 1.25);
      if (v.isPlayer) w *= this.battle.playerAggro;
      if (targeted.has(v)) w *= 0.55;
      if (w > bestScore) { bestScore = w; best = v; }
    }
    return best;
  }

  updateHeads(dt) {
    const alive = this.aliveHeads.length;
    const rate = this.battle.diff.attackRate * (this.rage ? 1.3 : 1) * (alive === 3 ? 1 : alive === 2 ? 1.22 : 1.55);
    const maxTokens = this.rage ? 3 : 2;
    for (const key of HEAD_KEYS) {
      const h = this.heads[key];
      if (!h.alive) continue;
      if (h.attack instanceof ConvergeAttack || h.attack instanceof MegaAttack) continue;
      switch (h.state) {
        case 'idle': {
          h.cooldown -= dt * rate;
          if (this.auth && h.cooldown <= 0 && this.attacksActive() < maxTokens && !this.converge && !this.mega && !this.megaPending) {
            const target = this.pickTarget(key, RANGE[key], WEIGHT[key]);
            if (target) this.startHeadAttack(h, target);
            else h.cooldown = 0.8;
          }
          if (h.state === 'idle' && !this.model.headBusy(key) && this.model.heads[key].layerName !== 'Snap') {
            // 何もしていない頭は一番近い敵を目で追う
            const near = this.nearestVehicle();
            this.model.aimHead(key, near ? near.position : null, near ? 0.55 : 0);
          }
          break;
        }
        case 'charge': {
          h.timer -= dt;
          const a = h.attack;
          const p = clamp(1 - h.timer / a.telegraph, 0, 1);
          this.model.setHeadGlow(key, 0.25 + p * 1.15);
          this.model.setMouthGlow(key, p);
          if (a.target) this.model.aimHead(key, a.target.position, 1);
          a.updateTelegraph(dt, p);
          if (h.timer <= 0) {
            h.state = 'fire';
            h.timer = a.duration;
            this.model.playHead(key, 'Fire');
            this.model.setHeadGlow(key, 1.6);
            this.model.setMouthGlow(key, 1.2);
            a.beginFire();
          }
          break;
        }
        case 'fire': {
          h.timer -= dt;
          h.attack.updateFire(dt);
          if (h.timer <= 0) {
            h.attack.end();
            h.attack = null;
            h.state = 'recover';
            h.timer = KAIJU.recoverTime[key];
            this.model.playHead(key, 'Recover');
            this.model.setHeadGlow(key, 0);
            this.model.setMouthGlow(key, 0);
            this.battle.onHeadRecover(key);
          }
          break;
        }
        case 'recover':
        case 'stunned': {
          h.timer -= dt;
          this.model.aimHead(key, null);
          if (h.timer <= 0) {
            h.state = 'idle';
            const cd = COOLDOWN[key];
            h.cooldown = rand(cd[0], cd[1]);
            this.model.playHead(key, null);
          }
          break;
        }
      }
    }
  }

  startHeadAttack(h, target, p = null) {
    const Cls = HEAD_ATTACK[h.key];
    const a = new Cls(this, h, target, p);
    h.attack = a;
    h.state = 'charge';
    h.timer = a.telegraph;
    h.flinch = 0;
    this.model.playHead(h.key, 'Charge');
    this.emit('atk', { key: h.key, tid: target.id, tp: arr(target.position), p: a.params });
    a.beginTelegraph();
  }

  nearestVehicle() {
    let best = null, bd = Infinity;
    for (const v of this.battle.vehicles) {
      if (!v.alive) continue;
      const d = v.position.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---- ひれ・しっぽの薙ぎ払い
  updateMelee(dt) {
    if (this.melee) {
      const m = this.melee;
      m.t += dt;
      if (!m.struck && m.t >= m.telegraph) {
        m.struck = true;
        this.meleeStrike(m);
      }
      if (m.t >= m.telegraph + 1.4) this.melee = null;
      return;
    }
    this.meleeCooldown -= dt;
    if (!this.auth) return;
    if (this.meleeCooldown > 0 || this.converge || this.mega || this.megaPending || this.act.slamT >= 0) return;
    if (this.attacksActive() > 1) return;
    const R = KAIJU.meleeRange;
    const f = this.forward.clone();
    let front = 0, back = 0, frontSide = 0;
    for (const v of this.battle.vehicles) {
      if (!v.alive || v.position.y > MELEE_ALT) continue;
      const dx = v.position.x - this.pos.x, dz = v.position.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const cos = (dx * f.x + dz * f.z) / (d || 1);
      const side = Math.sign(dx * f.z - dz * f.x); // +: 怪獣の左(+X)
      if (cos > 0.42) { front++; frontSide += side; } else back++;
    }
    if (!front && !back) return;
    const kind = back >= front ? 'tail' : 'claw';
    const A = kind === 'tail' ? ATTACKS.tail : ATTACKS.claw;
    const telegraph = Math.max(1.0, A.telegraph * this.battle.diff.telegraph * (this.rage ? 0.9 : 1));
    const yaw = this.root.rotation.y;
    let dirAngle, clip;
    if (kind === 'tail') { dirAngle = yaw + Math.PI; clip = 'TailSwipe'; }
    else {
      const leftSide = frontSide >= 0;
      clip = leftSide ? 'ClawL' : 'ClawR';
      dirAngle = yaw + (leftSide ? 0.45 : -0.45);
    }
    this.meleeCooldown = A.cooldown / this.battle.diff.attackRate;
    this.startMelee({ kind, telegraph, dirAngle, arc: A.arc, inner: A.inner, outer: A.outer, clip });
  }

  /** 薙ぎ払いの開始（ホストが決めた内容。参加者側は届いた内容で同じことをする） */
  startMelee(p) {
    const m = { ...p, t: 0, struck: false, shapes: [] };
    const center = new THREE.Vector3(this.pos.x, 0, this.pos.z);
    m.shapes.push(this.world.telegraph.sector(center, m.dirAngle, m.arc, m.inner, m.outer, new THREE.Color(1.0, 0.12, 0.08).multiplyScalar(1.8), { duration: m.telegraph + 0.3 }));
    const strikeAt = m.kind === 'tail' ? 1.3 : 1.18; // アニメの中で振り抜く瞬間
    this.model.playBody(m.clip, strikeAt / m.telegraph, 0.15);
    this.melee = m;
    this.emit('melee', { m: p });
    this.battle.onTelegraph(m, m.kind);
  }

  meleeStrike(m) {
    const fx = this.world.effects;
    const half = (m.arc * Math.PI) / 360;
    for (let i = 0; i < 9; i++) {
      const a = m.dirAngle - half + (2 * half * i) / 8;
      const r = rand(m.inner + 60, m.outer - 30);
      const p = new THREE.Vector3(this.pos.x + Math.sin(a) * r, 0, this.pos.z + Math.cos(a) * r);
      fx.waterColumn(p, rand(80, 140), 34);
    }
    this.world.foam.addRing(this.pos.x, this.pos.z, m.inner, m.outer + 80, 1.0, 3);
    this.battle.onMeleeStrike(m);
    for (const v of this.battle.vehicles) {
      if (!v.alive || !v.local || v.position.y > MELEE_ALT) continue;
      const r = vehicleSegment(v, _v, _v3);
      for (const q of [_v, _v3, v.position]) {
        const dx = q.x - this.pos.x, dz = q.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < m.inner - r || d > m.outer + r) continue;
        let ang = Math.atan2(dx, dz) - m.dirAngle;
        while (ang > Math.PI) ang -= Math.PI * 2;
        while (ang < -Math.PI) ang += Math.PI * 2;
        if (Math.abs(ang) <= half + r / Math.max(d, 1)) { this.battle.killVehicle(v, m.kind === 'tail' ? 'tail' : 'claw', 'body'); break; }
      }
    }
    for (const s of m.shapes) this.world.telegraph.remove(s);
  }

  // ---- 収束ビーム
  updateConverge(dt) {
    if (this.converge) {
      if (!this.converge.update(dt)) this.converge = null;
      return;
    }
    this.convergeCooldown -= dt;
    if (!this.auth) return;
    if (!this.rage || this.convergeCooldown > 0 || this.melee || this.mega || this.megaPending || this.act.slamT >= 0) return;
    if (this.aliveHeads.length < 3) return;
    if (HEAD_KEYS.some((k) => this.heads[k].state !== 'idle')) return;
    const target = this.pickTarget('C', [600, 2200], { fighter: 1.2, ship: 2.0, carrier: 0 });
    if (!target) { this.convergeCooldown = 2; return; }
    this.converge = new ConvergeAttack(this, target);
    this.emit('conv', { tid: target.id, p: this.converge.params });
    this.converge.begin();
  }

  dispose() {
    this.world.scene.remove(this.root);
    for (const k of HEAD_KEYS) this.beams[k].dispose();
    for (const b of this.bolts) this.world.scene.remove(b.mesh);
    if (this.wake) this.world.foam.removeTrail(this.wake);
    if (this.mega) this.mega.cancel();
  }
}

return { KAIJU_INTRO, MELEE_ALT, vehicleSegment, Kaiju, HEAD_KEYS, HEAD_INFO, ATTACK_NAME };
})();

// ==== src/game/weapons.js
__mod["src/game/weapons.js"] = (function () {
// 味方の弾: 砲弾・機関砲弾・ミサイル・魚雷・爆弾・ロケット
const THREE = __DEPS["three"];
const { WORLD, CPU } = __mod["src/config.js"];
const { rand, clamp } = __mod["src/core/util.js"];

/** CPU の弾は少し弱め（主役はプレイヤー） */
const dmgMul = (owner) => (owner && !owner.isPlayer ? CPU.damageMul : 1);

const G = WORLD.gravity;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

function missileMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.6, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.4 }));
  g.add(body);
  const fins = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0xbbbbbb }));
  fins.position.z = -1.5;
  const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 2;
  g.add(fins, fins2);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.2, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.z = -2.9;
  g.add(flame);
  return g;
}

function bombMesh() {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 2.4, 4, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.6 }));
  return m;
}

/** 魚雷（見やすいよう実物より少し大きめ） */
function torpedoMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.45, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 7.0, 4, 10).rotateX(Math.PI / 2), mat);
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.6, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8a03c, roughness: 0.5 }));
  band.position.z = 2.6;
  g.add(band);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.7), mat);
  fin.position.z = -3.9;
  const fin2 = fin.clone(); fin2.rotation.z = Math.PI / 2;
  g.add(fin, fin2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** 機関砲の弾（曳光弾）: 1回の描画で数百発をまとめて描く */
class Bullets {
  constructor(world, max = 900) {
    this.world = world;
    this.max = max;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 6.2, 2.2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 24;
    this.mesh.count = 0;
    world.scene.add(this.mesh);
    this.list = [];
  }

  add(origin, dir, speed, owner, w, range, inherit, visual = false) {
    if (this.list.length >= this.max) return;
    const v = dir.clone().multiplyScalar(speed);
    if (inherit) v.add(inherit);
    // 曳光弾は数発に1発（自分の弾は多めに見せる）
    const tracer = Math.random() < (owner && owner.isPlayer ? 0.55 : 0.3);
    this.list.push({ p: origin.clone(), v, t: 0, life: range / speed, owner, w, tracer, visual });
  }

  update(dt, proj) {
    const k = proj.kaiju;
    const fx = this.world.effects;
    const cam = proj.battle.camera.position;
    const alive = k && !k.dead && k.phase !== 'intro';
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const p0 = _v.copy(b.p);
      b.p.addScaledVector(b.v, dt);
      b.t += dt;
      let dead = b.t > b.life;
      if (!dead && alive) {
        const hit = k.intersectSegment(p0, b.p, 0.6);
        if (hit) {
          const dealt = proj.hitKaiju(b, hit, b.w.damage, b.w.flinch, 'gun');
          if (!b.visual && b.owner && b.owner.kind === 'fighter') b.owner.bombGauge = Math.min(1, b.owner.bombGauge + 0.0016);
          if (Math.random() < 0.45) fx.sparks(hit.point, _v2.copy(b.v).normalize().negate(), 3);
          if (Math.random() < 0.18) fx.hitPuff(hit.point, 0.9);
          void dealt;
          dead = true;
        }
      }
      if (!dead && b.p.y < 0) {
        if (Math.random() < 0.35) fx.bulletSplash(b.p);
        dead = true;
      }
      if (dead) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
      if (!b.tracer || n >= this.max) continue;
      // 遠くの弾も見えるよう、距離に応じて太く長く
      const d = b.p.distanceTo(cam);
      const wdt = Math.max(0.25, d * 0.0007);
      const len = 8 + d * 0.008;
      _v2.copy(b.v).normalize();
      _q.setFromUnitVectors(_Z, _v2);
      _s.set(wdt, wdt, len);
      _m.compose(_v.copy(b.p).addScaledVector(_v2, -len * 0.5), _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }
  dispose() { this.world.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

class Projectiles {
  constructor(battle) {
    this.battle = battle;
    this.world = battle.world;
    this.list = [];
    this.missileProto = missileMesh();
    this.bombProto = bombMesh();
    this.torpedoProto = torpedoMesh();
    this.tracerGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 5, 1, true).rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bullets = new Bullets(this.world);
  }

  get kaiju() { return this.battle.kaiju; }

  /** 自分が撃って、まだ走っている魚雷 */
  torpedoesOf(owner) { return this.list.filter((o) => o.type === 'torpedo' && o.owner === owner); }

  // visual=true: 他の端末の弾（見た目だけ。ダメージは撃った端末がホストへ送る）
  shell(origin, vel, owner, w, visual = false) {
    const tracer = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    tracer.scale.set(2.2, 2.2, 28);
    this.world.scene.add(tracer);
    this.list.push({ type: 'shell', p: origin.clone(), v: vel.clone(), t: 0, owner, w, mesh: tracer, visual });
  }

  bullet(origin, dir, speed, owner, w, range, inherit = null, visual = false) { this.bullets.add(origin, dir, speed, owner, w, range, inherit, visual); }

  missile(origin, dir, speed0, owner, w, targetKey, visual = false) {
    const m = this.missileProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'missile', p: origin.clone(), v: dir.clone().multiplyScalar(speed0), t: 0, owner, w, mesh: m, target: targetKey, visual });
  }

  rocket(origin, dir, speed0, owner, w, visual = false) {
    const m = this.missileProto.clone();
    m.scale.setScalar(0.7);
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'rocket', p: origin.clone(), v: dir.clone().multiplyScalar(speed0 + w.speed), t: 0, owner, w, mesh: m, visual });
  }

  /** 魚雷: 発射管から舷側の外へ打ち出され（out 方向）、海に飛び込んでから dir へ走る */
  torpedo(origin, dir, owner, w, out = null, shipVel = null, visual = false) {
    const m = this.torpedoProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    const v = new THREE.Vector3();
    if (shipVel) v.copy(shipVel);
    if (out) v.addScaledVector(out, 11);
    v.y = 2.5;
    const run = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.list.push({ type: 'torpedo', phase: 'air', p: origin.clone(), v, run, t: 0, owner, w, mesh: m, trail: null, traveled: 0, visual });
    this.world.effects.muzzleFlash(origin, out || run, 0.5);
  }

  bomb(origin, vel, owner, w, visual = false) {
    const m = this.bombProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'bomb', p: origin.clone(), v: vel.clone(), t: 0, owner, w, mesh: m, visual });
  }

  remove(i) {
    const o = this.list[i];
    if (o.mesh) this.world.scene.remove(o.mesh);
    if (o.trail) this.world.foam.removeTrail(o.trail);
    this.list.splice(i, 1);
  }

  hitKaiju(o, hit, dmg, flinch, kind) {
    const k = this.kaiju;
    const head = hit.head || (hit.part === 'neck' && hit.neckOf && k.heads[hit.neckOf].alive && Math.random() < 0.5 ? hit.neckOf : null);
    if (o.visual) return 0; // 他の端末の弾（見た目だけ）
    const dealt = this.battle.kaijuDamage(dmg * dmgMul(o.owner), { head, flinch, point: hit.point, owner: o.owner, kind, part: hit.part });
    this.battle.onProjectileHit(o, hit, dealt, kind);
    return dealt;
  }

  update(dt) {
    const fx = this.world.effects;
    const ocean = this.world.ocean;
    const k = this.kaiju;
    this.bullets.update(dt, this);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      const p0 = _v.copy(o.p);
      if (o.type === 'shell') {
        o.v.y -= G * dt;
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 1.5) : null;
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, 'shell');
          fx.explosion(hit.point, 0.9, { debris: false });
          this.remove(i); continue;
        }
        if (o.p.y < ocean.heightAt(o.p.x, o.p.z)) {
          fx.splash(o.p, 1.1, { height: 34 });
          this.battle.onSplash(o.p, 'shell');
          this.remove(i); continue;
        }
        if (o.t > 14) { this.remove(i); continue; }
      } else if (o.type === 'missile' || o.type === 'rocket') {
        if (o.type === 'missile') {
          const spd = Math.min(o.w.speed, o.v.length() + 260 * dt);
          let dir = _v2.copy(o.v).normalize();
          if (o.target && k && k.heads[o.target] && k.heads[o.target].alive && o.t > 0.15) {
            const tp = k.headSpheres[o.target].c;
            const want = tp.clone().sub(o.p).normalize();
            const maxTurn = (o.w.turn * Math.PI / 180) * dt;
            const ang = dir.angleTo(want);
            if (ang > 1e-4) dir.lerp(want, Math.min(1, maxTurn / ang)).normalize();
          }
          o.v.copy(dir).multiplyScalar(spd);
        } else {
          o.v.y -= G * 0.25 * dt;
        }
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        if (Math.random() < 0.85) fx.smokeTrail(o.p, 0.9);
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 2.0) : null;
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, o.type);
          fx.explosion(hit.point, o.type === 'missile' ? 1.6 : 1.2);
          this.battle.onExplosion(hit.point, 0.3);
          this.remove(i); continue;
        }
        if (o.p.y < ocean.heightAt(o.p.x, o.p.z) || o.t > 10) {
          if (o.p.y < 5) fx.splash(o.p, 1.4, { height: 30 });
          else fx.explosion(o.p, 1.0, { debris: false });
          this.remove(i); continue;
        }
      } else if (o.type === 'torpedo') {
        if (o.phase === 'air') {
          // 発射管から飛び出して海へ落ちる
          o.v.y -= G * dt;
          o.p.addScaledVector(o.v, dt);
          o.mesh.position.copy(o.p);
          o.mesh.lookAt(_v2.copy(o.p).add(o.run).add(new THREE.Vector3(0, o.v.y * 0.04, 0)));
          if (o.p.y <= ocean.heightAt(o.p.x, o.p.z)) {
            o.phase = 'run';
            o.p.y = -1.6;
            o.v.copy(o.run).multiplyScalar(o.w.speed * 0.45);
            fx.splash(new THREE.Vector3(o.p.x, 0, o.p.z), 0.9, { height: 12 });
            o.trail = this.world.foam.createTrail({ life: 30, w0: 9, spread: 0.6, strength: 1.0, kelvin: false, step: 5 });
          }
          continue;
        }
        // 水中を走る（加速して巡航）
        const spd = Math.min(o.w.speed, o.v.length() + o.w.speed * 0.6 * dt);
        o.v.copy(o.run).multiplyScalar(spd);
        const step = spd * dt;
        o.p.addScaledVector(o.v, dt);
        o.traveled += step;
        const wy = ocean.heightAt(o.p.x, o.p.z);
        o.p.y = Math.min(-1.2, wy - 1.4);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.run));
        o.trail.push(o.p.x, o.p.z, this.world.time, 1);
        // 白い泡の筋（遠くからも魚雷の進路が分かる）
        if (Math.random() < 0.7) fx.alpha.spawn({ x: o.p.x - o.run.x * 4, y: 0.3, z: o.p.z - o.run.z * 4, vx: rand(-0.6, 0.6), vy: rand(0.8, 2.2), vz: rand(-0.6, 0.6), life: rand(1.0, 1.8), size: 2.2, size1: 5.5, color: [0.9, 0.94, 0.98, 0.65], color1: [0.9, 0.92, 0.96, 0], frame: 1 });
        // 怪獣の脚・尾（喫水付近）に当たったか
        let hit = null;
        if (k && !k.dead) {
          const a = _v2.set(p0.x, 2, p0.z), b = new THREE.Vector3(o.p.x, 2, o.p.z);
          const h = k.intersectSegment(a, b, 5.0);
          if (h && h.part !== 'head') hit = h;
          else if (h) hit = { ...h, head: null, part: 'body' };
        }
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, 'torpedo');
          const wp = new THREE.Vector3(o.p.x, 0, o.p.z);
          fx.waterColumn(wp, 170, 34);
          fx.waterColumn(new THREE.Vector3(wp.x + rand(-12, 12), 0, wp.z + rand(-12, 12)), 110, 24);
          fx.explosion(new THREE.Vector3(o.p.x, 8, o.p.z), 2.2, { debris: false });
          this.world.foam.addRing(wp.x, wp.z, 10, 160, 1.0, 3);
          this.battle.onTorpedoHit(o, wp);
          this.remove(i); continue;
        }
        if (o.traveled > o.w.range) { this.remove(i); continue; }
      } else if (o.type === 'bomb') {
        o.v.y -= G * dt;
        o.v.multiplyScalar(1 - 0.02 * dt);
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 3.0) : null;
        const water = o.p.y < ocean.heightAt(o.p.x, o.p.z);
        if (hit || water) {
          const at = hit ? hit.point : o.p.clone();
          fx.explosion(at, 3.0);
          if (water) fx.waterColumn(new THREE.Vector3(at.x, 0, at.z), 110, 30);
          this.battle.onExplosion(at, 0.8);
          if (k && !k.dead && !o.visual) {
            // 爆風: 近い部位にダメージ（直撃は満額）
            let dmg = 0, head = null;
            if (hit) { dmg = o.w.damage; head = hit.head; }
            else {
              for (const key of k.aliveHeads) {
                const d = at.distanceTo(k.headSpheres[key].c) - k.headSpheres[key].r;
                if (d < o.w.blast) { dmg = Math.max(dmg, o.w.damage * (1 - d / o.w.blast) * 0.7); head = key; }
              }
              if (!dmg && k.pointInside(at, o.w.blast)) dmg = o.w.damage * 0.45;
            }
            if (dmg > 0) {
              const dealt = this.battle.kaijuDamage(dmg * dmgMul(o.owner), { head, flinch: o.w.flinch, point: at, owner: o.owner, kind: 'bomb', part: hit ? hit.part : 'body' });
              this.battle.onProjectileHit(o, hit || { point: at, head }, dealt, 'bomb');
            }
          }
          this.remove(i); continue;
        }
        if (o.t > 30) { this.remove(i); continue; }
      }
    }
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(i);
    this.bullets.clear();
  }
  dispose() { this.clear(); this.bullets.dispose(); }
}

/** 砲弾の弾道解（低い弾道）。届かなければ 45° を返す */
function ballisticPitch(dx, dy, v, g = G) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return { pitch: Math.PI / 4, ok: false };
  return { pitch: Math.atan2(v2 - Math.sqrt(disc), g * dx), ok: true };
}
return { Projectiles, ballisticPitch };
})();

// ==== src/game/vehicles.js
__mod["src/game/vehicles.js"] = (function () {
// 機体: 護衛艦（駆逐艦）・戦闘機・空母
const THREE = __DEPS["three"];
const { SHIP, FIGHTER, PROP_FIGHTER, CARRIER, WORLD, KAIJU } = __mod["src/config.js"];
const { clamp, damp, rand, DEG, angleDiff, interceptTime } = __mod["src/core/util.js"];
const { assets } = __mod["src/core/assets.js"];
const { ballisticPitch } = __mod["src/game/weapons.js"];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function cloneModel(key) {
  const g = assets.gltf[key];
  if (!g) return null;
  const m = g.scene.clone(true);
  m.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        o.material.envMapIntensity = 1.7;
        if (o.material.metalnessMap) { o.material.metalnessMap = null; o.material.metalness = 0; }
      }
    }
  });
  return m;
}

function findNode(root, name) {
  let r = null;
  root.traverse((o) => { if (!r && o.name === name) r = o; });
  return r;
}

function numberDecal(text, w = 9, h = 4.2) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 240;
  const g = cv.getContext('2d');
  g.font = 'bold 190px "Chakra Petch", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,22,26,0.9)';
  g.fillText(text, 262, 128);
  g.fillStyle = '#f2f2ee';
  g.fillText(text, 252, 120);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  return m;
}

class Vehicle {
  constructor(battle, kind, opts) {
    this.battle = battle;
    this.world = battle.world;
    this.kind = kind;
    this.id = opts.id ?? `${kind}-${Vehicle.nextId++}`;
    this.name = opts.name || '';
    this.callsign = opts.callsign || this.name;
    this.isPlayer = !!opts.isPlayer;          // この端末の人が操作している機体
    this.human = !!(opts.human ?? opts.isPlayer); // 人が操作している機体（マルチプレイの仲間を含む）
    this.local = opts.local ?? true;          // この端末で動かしている機体（他の端末の機体は通信で届いた位置に置くだけ）
    this.controller = opts.controller || null;
    this.team = 'ally';
    this.alive = true;
    this.dying = false;
    this.deathT = 0;
    this.targetable = true;
    this.object = new THREE.Group();
    this.position = this.object.position;
    this.velocity = new THREE.Vector3();
    this.heading = opts.heading || 0;
    this.stats = { damage: 0, shots: 0, hits: 0 };
    this.input = null;
    this.world.scene.add(this.object);
  }
  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  update(dt) {
    if (this.alive) {
      if (!this.local) { this.updatePuppet(dt); return; }
      this.input = this.controller ? this.controller.update(this, dt) : null;
      if (this.input) this.simulate(dt, this.input);
    } else if (this.dying) {
      this.deathT += dt;
      this.updateDeath(dt);
    }
  }
  simulate() {}
  updateDeath() {}

  // ---------------------------------------------------------------- マルチプレイ
  /** この機体の状態（他の端末へ送る） */
  netState() {
    const p = this.position, q = this.object.quaternion;
    const r = (v, k = 10) => Math.round(v * k) / k;
    return { id: this.id, p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000)], s: r(this.speed || 0), h: r(this.heading, 1000), x: this.netExtra ? this.netExtra() : null };
  }

  /** 届いた状態を貯める（少し遅れて補間しながら表示する） */
  pushNet(st, t) {
    (this.netBuf ||= []).push({ t, p: new THREE.Vector3(st.p[0], st.p[1], st.p[2]), q: new THREE.Quaternion(st.q[0], st.q[1], st.q[2], st.q[3]), s: st.s, h: st.h, x: st.x });
    if (this.netBuf.length > 12) this.netBuf.shift();
    if (!this.netPlaced) { this.netPlaced = true; this.position.copy(this.netBuf[0].p); this.object.quaternion.copy(this.netBuf[0].q); }
  }

  /** 他の端末の機体: 約0.12秒前の状態を補間して置く */
  updatePuppet(dt) {
    const buf = this.netBuf;
    if (!buf || !buf.length) return;
    const now = performance.now() / 1000 - 0.12;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) if (buf[i].t <= now && buf[i + 1].t >= now) { a = buf[i]; b = buf[i + 1]; break; }
    const span = b.t - a.t;
    const u = span > 1e-4 ? clamp((now - a.t) / span, 0, 1.3) : 1;
    const prev = this.position.clone();
    this.position.lerpVectors(a.p, b.p, u);
    this.object.quaternion.slerpQuaternions(a.q, b.q, Math.min(1, u));
    this.speed = b.s;
    this.heading = a.h + angleDiff(a.h, b.h) * Math.min(1, u);
    if (dt > 0) this.velocity.subVectors(this.position, prev).divideScalar(dt);
    this.applyNetExtra && this.applyNetExtra(b.x, dt);
  }
  kill(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.deathT = 0;
    this.deathCause = cause;
    this.onKilled(cause);
  }
  onKilled() {}
  dispose() {
    this.world.scene.remove(this.object);
    if (this.trail) this.world.foam.removeTrail(this.trail);
    if (this.emitters) for (const e of this.emitters) this.world.effects.removeEmitter(e);
  }
}

Vehicle.nextId = 1;

// ================================================================== 護衛艦
class Destroyer extends Vehicle {
  constructor(battle, opts) {
    super(battle, 'ship', opts);
    this.hullNo = opts.hullNo || '185';
    const model = cloneModel('destroyer') || placeholderShip(160, 20, 0x8a9096);
    this.object.add(model);
    this.model = model;
    this.fore = findNode(model, 'Fore') || model;
    this.aft = findNode(model, 'Aft') || model;
    this.turret = findNode(model, 'Turret');
    this.barrel = findNode(model, 'Barrel');
    this.muzzle = findNode(model, 'Muzzle');
    this.radar = findNode(model, 'RadarSpin');
    this.tubeL = findNode(model, 'Torp_L');
    this.tubeR = findNode(model, 'Torp_R');
    this.bowNode = findNode(model, 'Bow');
    this.sternNode = findNode(model, 'Stern');
    this.smokeNodes = [findNode(model, 'Smoke1'), findNode(model, 'Smoke2')].filter(Boolean);
    for (const [nm, s] of [['Num_L', 1], ['Num_R', -1]]) {
      const n = findNode(model, nm);
      if (!n) continue;
      const d = numberDecal(this.hullNo);
      d.position.copy(n.position);
      d.position.x += s * 0.35;
      d.rotation.y = (s * Math.PI) / 2;
      d.rotation.z = 0;
      n.parent.add(d);
    }
    this.hitRadius = SHIP.hitRadius;
    this.killHalfLength = 12; // 致命部（艦橋〜煙突）。それ以外をかすめても轟沈はしない
    this.length = SHIP.length;
    this.speedIdx = opts.speedIdx ?? 4;
    this.speed = opts.speed ?? 10;
    this.rudder = 0;
    this.gunReload = rand(0, 1);
    this.turretYaw = 0;
    this.barrelPitch = 0;
    this.torps = SHIP.torpedo.count;
    this.torpReload = 0;
    this.torpAim = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), side: 1, lead: new THREE.Vector3(), leadValid: false };
    this.torpGuide = this.isPlayer ? this.world.telegraph.guide(new THREE.Color(0.55, 0.95, 1.2)) : null;
    // 機関砲（CIWS）: 艦橋前と後部の2基。押している間、照準へ乱射する
    this.mg = { heat: 0, over: 0, t: 0, idx: 0, firing: false };
    this.mgMounts = [new THREE.Vector3(0, 15.6, 38.8), new THREE.Vector3(0, 17.6, -49.5)];
    this.gunSolution = { point: new THREE.Vector3(), time: 0, valid: false, ready: false, inRange: false };
    this.trail = this.world.foam.createTrail({ life: 60, w0: 16, spread: 1.05, strength: 0.95, step: 6 });
    this.fxT = 0;
    this.recoil = 0;
    this.heel = 0;
    this.object.position.set(opts.position.x, 0, opts.position.z);
    this.heading = opts.heading || 0;
    this.emitters = [];
  }

  simulate(dt, inp) {
    const S = SHIP;
    if (inp.throttle) this.speedIdx = clamp(this.speedIdx + inp.throttle, 0, S.speeds.length - 1);
    const target = S.speeds[this.speedIdx] * S.maxSpeed;
    const acc = S.accel * (Math.sign(target - this.speed) !== Math.sign(this.speed) ? 1.3 : 1);
    this.speed += clamp(target - this.speed, -acc * dt, acc * dt);
    this.rudder += clamp(inp.steer - this.rudder, -dt / S.rudderShift, dt / S.rudderShift);
    const eff = clamp(Math.abs(this.speed) / S.maxSpeed, 0.12, 1) * Math.sign(this.speed || 1);
    this.heading -= this.rudder * S.turnRate * DEG * eff * dt;
    const f = this.forward;
    this.position.x += f.x * this.speed * dt;
    this.position.z += f.z * this.speed * dt;
    this.velocity.set(f.x * this.speed, 0, f.z * this.speed);
    this.float(dt);
    // 航跡・しぶき・煙
    const sx = this.position.x - f.x * 76, sz = this.position.z - f.z * 76;
    this.trail.intensity = clamp(Math.abs(this.speed) / 8, 0, 1);
    this.trail.push(sx, sz, this.world.time, 1);
    this.fxT += dt;
    const fx = this.world.effects;
    if (this.fxT > 0.12 && Math.abs(this.speed) > 6) {
      this.fxT = 0;
      const bx = this.position.x + f.x * 78, bz = this.position.z + f.z * 78;
      const k = Math.abs(this.speed) / S.maxSpeed;
      if (Math.random() < 0.7 * k) {
        const side = Math.random() < 0.5 ? -1 : 1;
        fx.alpha.spawn({ x: bx - f.z * side * 3, y: 1, z: bz + f.x * side * 3,
          vx: f.x * this.speed * 0.6 - f.z * side * rand(3, 8), vy: rand(4, 9) * k, vz: f.z * this.speed * 0.6 + f.x * side * rand(3, 8),
          life: rand(0.8, 1.4), size: 3, size1: 9, color: [0.9, 0.93, 0.97, 0.7], color1: [0.9, 0.93, 0.97, 0], frame: 1, grav: 9.8 });
      }
      if (Math.random() < 0.15) for (const n of this.smokeNodes) {
        n.getWorldPosition(_v2);
        fx.alpha.spawn({ x: _v2.x, y: _v2.y + 1, z: _v2.z, vx: rand(-1, 1) - f.x * this.speed * 0.3, vy: rand(3, 6), vz: rand(-1, 1) - f.z * this.speed * 0.3,
          life: rand(3, 5), size: 3, size1: 14, color: [0.35, 0.36, 0.38, 0.18], color1: [0.4, 0.4, 0.42, 0], frame: 0, drag: 0.4 });
      }
    }
    if (this.radar) this.radar.rotation.y += dt * 2.4;
    this.updateGun(dt, inp);
    this.updateMG(dt, inp);
    this.updateTorpedoes(dt, inp);
    this.collide();
  }

  float(dt) {
    const oc = this.world.ocean;
    const f = this.forward;
    const r = _v2.set(f.z, 0, -f.x);
    const p = this.position;
    const hb = oc.heightAt(p.x + f.x * 60, p.z + f.z * 60);
    const hs = oc.heightAt(p.x - f.x * 60, p.z - f.z * 60);
    const hp = oc.heightAt(p.x - r.x * 9, p.z - r.z * 9);
    const hst = oc.heightAt(p.x + r.x * 9, p.z + r.z * 9);
    const avg = (hb + hs + hp + hst) / 4;
    p.y = damp(p.y, avg - 0.2, 4, dt);
    const pitch = Math.atan2(hs - hb, 120);
    this.heel = damp(this.heel, this.rudder * (this.speed / SHIP.maxSpeed) * 3.5 * DEG, 1.5, dt);
    const roll = Math.atan2(hp - hst, 18) * 0.6 + this.heel;
    _e.set(pitch, this.heading, roll, 'YXZ');
    this.object.quaternion.setFromEuler(_e);
  }

  updateGun(dt, inp) {
    this.gunReload = Math.max(0, this.gunReload - dt);
    this.recoil = Math.max(0, this.recoil - dt * 3);
    const sol = this.gunSolution;
    sol.valid = false;
    if (!this.turret || !inp.aimPoint) { sol.ready = false; return; }
    this.turret.getWorldPosition(_v2);
    const aim = inp.aimPoint;
    const inv = _q.copy(this.object.quaternion).invert();
    const local = _v.copy(aim).sub(_v2).applyQuaternion(inv);
    let want = Math.atan2(local.x, local.z);
    const limit = 150 * DEG;
    const blocked = Math.abs(want) > limit;
    want = clamp(want, -limit, limit);
    const diff = angleDiff(this.turretYaw, want);
    this.turretYaw += clamp(diff, -40 * DEG * dt, 40 * DEG * dt);
    this.turret.rotation.y = this.turretYaw;
    const dx = Math.hypot(aim.x - _v2.x, aim.z - _v2.z);
    const dy = aim.y - _v2.y - 2;
    const bal = ballisticPitch(dx, dy, SHIP.gun.speed);
    sol.inRange = bal.ok && dx < SHIP.gun.maxRange;
    this.barrelPitch = damp(this.barrelPitch, bal.pitch, 6, dt);
    if (this.barrel) {
      this.barrel.rotation.x = -this.barrelPitch;
      this.barrel.position.z = this.barrelBaseZ ?? (this.barrelBaseZ = this.barrel.position.z);
      this.barrel.position.z = this.barrelBaseZ - this.recoil * 1.2;
    }
    sol.point.copy(aim);
    sol.time = dx / (SHIP.gun.speed * Math.cos(bal.pitch));
    sol.valid = true;
    sol.ready = this.gunReload <= 0 && Math.abs(diff) < 3 * DEG && !blocked && sol.inRange;
    if (inp.fire && sol.ready) this.fireGun(aim, bal.pitch);
  }

  fireGun(aim, pitch) {
    const W = SHIP.gun;
    this.gunReload = W.reload;
    this.recoil = 1;
    const mz = (this.muzzle || this.turret).getWorldPosition(new THREE.Vector3());
    const yaw = Math.atan2(aim.x - mz.x, aim.z - mz.z) + rand(-1, 1) * W.spread;
    const p = pitch + rand(-1, 1) * W.spread * 0.6;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
    const vel = dir.clone().multiplyScalar(W.speed);
    this.battle.projectiles.shell(mz, vel, this, W);
    this.battle.netFire(this, 'shell', { o: mz, d: vel });
    this.world.effects.muzzleFlash(mz, dir, 1.5);
    this.stats.shots++;
    this.battle.onFire(this, 'gun', mz);
  }

  /** 機関砲: 押している間、照準点へ毎秒十数発。撃ち続けると過熱して少し撃てなくなる */
  updateMG(dt, inp) {
    const W = SHIP.mg, g = this.mg;
    g.firing = false;
    if (g.over > 0) {
      g.over -= dt;
      g.heat = Math.max(0, g.heat - dt * W.coolRate * 1.3);
      return;
    }
    const aim = inp.aimPoint;
    if (!inp.mg || !aim) {
      g.heat = Math.max(0, g.heat - dt * W.coolRate);
      g.t = Math.min(g.t, 0);
      return;
    }
    g.t += dt;
    const inv = _q.copy(this.object.quaternion).invert();
    const local = _v.copy(aim).sub(this.position).applyQuaternion(inv);
    const ang = Math.abs(Math.atan2(local.x, local.z)); // 0 = 艦首方向
    const can = [ang < 155 * DEG, ang > 25 * DEG];       // 前部は真後ろ、後部は真正面を撃てない
    const fx = this.world.effects;
    let origin = null;
    while (g.t >= 0) {
      g.t -= 1 / W.rate;
      let mi = g.idx ^ 1;
      if (!can[mi]) mi ^= 1;
      g.idx = mi;
      origin = this.mgMounts[mi].clone().applyQuaternion(this.object.quaternion).add(this.position);
      const dir = _v2.copy(aim).sub(origin);
      const dist = dir.length();
      dir.normalize();
      dir.x += rand(-1, 1) * W.spread; dir.y += rand(-1, 1) * W.spread * 0.7; dir.z += rand(-1, 1) * W.spread;
      dir.normalize();
      this.battle.projectiles.bullet(origin, dir, W.speed, this, W, Math.min(W.range, dist + 120));
      fx.add.spawn({ x: origin.x + dir.x * 2, y: origin.y + dir.y * 2, z: origin.z + dir.z * 2, life: 0.06, size: 3.2, size1: 4.5, color: [12, 7, 3, 1], color1: [4, 1.2, 0.2, 0], frame: 6, fadeIn: 0 });
      this.stats.shots++;
      g.heat += W.heatPerShot;
      if (g.heat >= 1) { g.heat = 1; g.over = W.overheatTime; break; }
    }
    g.firing = true;
    if (origin) this.battle.onMG(this, origin);
  }

  /** 魚雷の発射方向（照準点の方へ。照準点のある側の発射管から） */
  updateTorpAim(aim) {
    const ta = this.torpAim;
    const f = this.forward;
    if (aim) ta.dir.set(aim.x - this.position.x, 0, aim.z - this.position.z).normalize();
    else ta.dir.copy(f);
    ta.side = (ta.dir.x * f.z - ta.dir.z * f.x) > 0 ? 1 : -1; // +1: 左舷(+X)側
    const tube = ta.side > 0 ? this.tubeL : this.tubeR;
    if (tube) tube.getWorldPosition(ta.origin); else ta.origin.copy(this.position);
    // 怪獣に当てるための狙い目（進む怪獣と魚雷の出会う点）
    const k = this.battle.kaiju;
    ta.leadValid = false;
    if (k && !k.dead && k.phase !== 'intro') {
      const rel = _v.set(k.pos.x - ta.origin.x, 0, k.pos.z - ta.origin.z);
      const t = interceptTime(rel, k.velocity, SHIP.torpedo.speed);
      if (t > 0 && t * SHIP.torpedo.speed < SHIP.torpedo.range) {
        ta.lead.set(k.pos.x, 0, k.pos.z).addScaledVector(k.velocity, t);
        ta.leadValid = true;
      }
    }
    return ta;
  }

  updateTorpedoes(dt, inp) {
    this.torpReload = Math.max(0, this.torpReload - dt);
    const ta = this.updateTorpAim(inp.aimPoint);
    if (this.torpGuide) {
      const ready = this.torps > 0 && this.battle.state === 'battle' && !(this.battle.broadcast && this.battle.broadcast.active);
      const end = _v2.copy(ta.origin).addScaledVector(ta.dir, SHIP.torpedo.range);
      this.world.telegraph.setGuide(this.torpGuide, ta.origin, end, 30, ready ? (this.torpReload > 0 ? 0.3 : 0.8) : 0);
    }
    if (!inp.torpedo) return;
    if (this.torps <= 0) { this.battle.onTorpedoEmpty(this); return; }
    if (this.torpReload > 0) return;
    const n = Math.min(SHIP.torpedo.salvo, this.torps);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ta.dir.x, ta.dir.z) + (i - (n - 1) / 2) * 2.2 * DEG;
      // 発射管から舷側の外へ打ち出され、海に飛び込んでから走る
      const out = new THREE.Vector3(this.forward.z * ta.side, 0, -this.forward.x * ta.side);
      const run = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.battle.projectiles.torpedo(ta.origin, run, this, SHIP.torpedo, out, this.velocity);
      this.battle.netFire(this, 'torp', { o: ta.origin, d: run, out, sv: this.velocity, s: SHIP.torpedo.speed, r: SHIP.torpedo.range });
    }
    this.torps -= n;
    this.torpReload = SHIP.torpedo.reload;
    this.battle.onFire(this, 'torpedo', ta.origin);
  }

  collide() {
    const k = this.battle.kaiju;
    if (k && !k.dead && k.phase !== 'intro') {
      const d = Math.hypot(this.position.x - k.pos.x, this.position.z - k.pos.z);
      if (d < 42 * KAIJU.scale) this.battle.killVehicle(this, 'ram', 'body');
    }
    // 艦同士は軽く押し合う
    for (const o of this.battle.vehicles) {
      if (o === this || !o.alive || o.kind === 'fighter') continue;
      const dx = this.position.x - o.position.x, dz = this.position.z - o.position.z;
      const d = Math.hypot(dx, dz);
      const min = o.kind === 'carrier' ? 70 : 45;
      if (d < min && d > 0.1) {
        const push = (min - d) * 0.5;
        this.position.x += (dx / d) * push * 0.05;
        this.position.z += (dz / d) * push * 0.05;
      }
    }
  }

  resupply(dt) {
    this.resupplyT = (this.resupplyT || 0) + dt;
    if (this.resupplyT > 2.5 && this.torps < SHIP.torpedo.count) { this.resupplyT = 0; this.torps++; return true; }
    return false;
  }

  dispose() {
    if (this.torpGuide) { this.world.telegraph.remove(this.torpGuide); this.torpGuide = null; }
    super.dispose();
  }

  // ---- マルチプレイ: 他の端末へ送る見た目の情報と、届いた情報の反映
  netExtra() {
    const aim = this.input && this.input.aimPoint;
    const r = (v, k = 1000) => Math.round(v * k) / k;
    return { ty: r(this.turretYaw), bp: r(this.barrelPitch), mg: this.mg.firing ? 1 : 0, ma: this.mg.firing && aim ? [r(aim.x, 1), r(aim.y, 1), r(aim.z, 1)] : null };
  }

  applyNetExtra(x, dt) {
    if (this.radar) this.radar.rotation.y += dt * 2.4;
    const f = this.forward;
    if (this.trail) {
      this.trail.intensity = clamp(Math.abs(this.speed) / 8, 0, 1);
      this.trail.push(this.position.x - f.x * 76, this.position.z - f.z * 76, this.world.time, 1);
    }
    if (!x) return;
    if (this.turret) this.turret.rotation.y = x.ty;
    if (this.barrel) this.barrel.rotation.x = -x.bp;
    // 機関砲（見た目だけの弾）
    if (x.mg && x.ma) {
      const W = SHIP.mg;
      this.mgVisT = (this.mgVisT || 0) + dt;
      const aim = new THREE.Vector3(x.ma[0], x.ma[1], x.ma[2]);
      while (this.mgVisT > 1 / W.rate) {
        this.mgVisT -= 1 / W.rate;
        this.mg.idx ^= 1;
        const origin = this.mgMounts[this.mg.idx].clone().applyQuaternion(this.object.quaternion).add(this.position);
        const dir = aim.clone().sub(origin);
        const dist = dir.length();
        dir.normalize();
        dir.x += rand(-1, 1) * W.spread; dir.y += rand(-1, 1) * W.spread * 0.7; dir.z += rand(-1, 1) * W.spread;
        this.battle.projectiles.bullet(origin, dir.normalize(), W.speed, this, W, Math.min(W.range, dist + 120), null, true);
      }
      this.battle.audio?.distantMG(this.position);
    } else this.mgVisT = 0;
  }

  onKilled(cause) {
    const fx = this.world.effects;
    if (this.torpGuide) { this.world.telegraph.remove(this.torpGuide); this.torpGuide = null; }
    this.mg.firing = false;
    this.split = ['beam', 'tail', 'claw', 'converge', 'column', 'ram'].includes(cause);
    this.sinkSide = Math.random() < 0.5 ? -1 : 1;
    const p = this.position.clone();
    fx.explosion(p.clone().add(new THREE.Vector3(0, 12, 0)), 3.5);
    fx.explosion(p.clone().addScaledVector(this.forward, 30).add(new THREE.Vector3(0, 8, 0)), 2.5);
    fx.explosion(p.clone().addScaledVector(this.forward, -35).add(new THREE.Vector3(0, 8, 0)), 2.5);
    this.speed *= 0.4;
    if (this.trail) { this.world.foam.removeTrail(this.trail); this.trail = null; }
    const firePts = [new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 8, 30), new THREE.Vector3(0, 8, -30)];
    for (const fp of firePts) {
      const e = fx.addEmitter((dt) => {
        if (this.deathT > 26) return false;
        const wp = fp.clone().applyQuaternion(this.object.quaternion).add(this.position);
        if (wp.y > -2) fx.fire(wp, 2.2);
        return true;
      });
      this.emitters.push(e);
    }
    this.world.foam.addDecal(p.x, p.z, 120, 1.0, 30, 0.6);
  }

  updateDeath(dt) {
    const t = this.deathT;
    const fx = this.world.effects;
    this.speed *= Math.exp(-0.5 * dt);
    const f = this.forward;
    this.position.x += f.x * this.speed * dt;
    this.position.z += f.z * this.speed * dt;
    if (this.split) {
      const a = Math.min(1, t / 9);
      const ang = a * 38 * DEG;
      this.fore.rotation.x = -ang;
      this.aft.rotation.x = ang * 0.8;
      this.fore.position.z = (this.foreZ ??= this.fore.position.z) + a * 14;
      this.aft.position.z = (this.aftZ ??= this.aft.position.z) - a * 10;
      this.position.y -= dt * (1.2 + t * 0.25);
    } else {
      const list = Math.min(1, t / 6) * 24 * DEG * this.sinkSide;
      _e.set(Math.min(1, t / 10) * -6 * DEG, this.heading, list, 'YXZ');
      this.object.quaternion.setFromEuler(_e);
      this.position.y -= dt * (0.5 + t * 0.12);
    }
    if (t < 8 && Math.random() < dt * 2.5) {
      const off = new THREE.Vector3(rand(-6, 6), rand(4, 14), rand(-60, 60)).applyQuaternion(this.object.quaternion);
      fx.explosion(this.position.clone().add(off), rand(1.2, 2.2));
    }
    if (Math.random() < 0.3) fx.steam(new THREE.Vector3(this.position.x + rand(-30, 30), 0, this.position.z + rand(-30, 30)), 1.2);
    if (t > 30) this.removed = true;
  }
}

// ================================================================== 戦闘機
class Fighter extends Vehicle {
  constructor(battle, opts) {
    super(battle, 'fighter', opts);
    this.type = opts.type || 'f15';
    this.cfg = this.type === 'zero' ? PROP_FIGHTER : FIGHTER;
    const model = cloneModel(this.type === 'zero' ? 'zero' : 'f15') || placeholderJet(this.type);
    this.object.add(model);
    this.model = model;
    this.prop = findNode(model, 'Propeller');
    this.nozzles = [findNode(model, 'Nozzle_L'), findNode(model, 'Nozzle_R')].filter(Boolean);
    this.pylons = ['Pylon_L1', 'Pylon_R1', 'Pylon_L2', 'Pylon_R2', 'Pylon_L3', 'Pylon_R3', 'Pylon_L4', 'Pylon_R4'].map((n) => findNode(model, n)).filter(Boolean);
    this.gunNode = findNode(model, 'Gun');
    this.hitRadius = this.cfg.hitRadius;
    this.killHalfLength = 0;
    this.yaw = opts.heading || 0;
    this.pitch = opts.pitch || 0;
    this.roll = 0;
    this.speed = opts.speed ?? this.cfg.cruise;
    this.heading = this.yaw;
    this.object.position.copy(opts.position);
    this.missiles = this.cfg.missile ? this.cfg.missile.count : this.cfg.rocket.count;
    this.missileCd = 0;
    this.bombGauge = opts.bombGauge ?? 0.35;
    this.lock = { key: null, t: 0 };
    this.gunActive = false;
    this.gun = { heat: 0, over: 0, t: 0, firing: false, side: 1 };
    this.pylonIdx = 0;
    this.throttle = 0.5;
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.4, 1.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const n of this.nozzles) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.55, 4.5, 10, 1, true).rotateX(-Math.PI / 2), flameMat.clone());
      c.position.z = -2.3;
      n.add(c);
      this.flames.push(c);
    }
    if (!this.nozzles.length && this.type !== 'zero') {
      for (const x of [-0.9, 0.9]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.55, 4.5, 10, 1, true).rotateX(-Math.PI / 2), flameMat.clone());
        c.position.set(x, 0, -10.5);
        model.add(c);
        this.flames.push(c);
      }
    }
    this.vortexT = 0;
    this.prevYaw = this.yaw;
  }

  get dir() { return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)); }

  simulate(dt, inp) {
    const c = this.cfg;
    const targetRoll = inp.steer * 74 * DEG;
    this.roll = damp(this.roll, targetRoll, 3.6, dt);
    const turn = (c.pitchRate * 1.05) * DEG * Math.sin(this.roll) / Math.sin(74 * DEG);
    const spdK = clamp(c.cruise / Math.max(this.speed, 1), 0.7, 1.35);
    this.yaw -= turn * spdK * dt;
    const pitchIn = inp.pitch * c.pitchRate * DEG * spdK;
    this.pitch = clamp(this.pitch + pitchIn * dt, -72 * DEG, 72 * DEG);
    if (!inp.pitch) this.pitch = damp(this.pitch, this.pitch * 0.92, 0.6, dt);
    const tgt = inp.boost ? c.maxSpeed : inp.brake ? c.minSpeed : c.cruise;
    this.throttle = damp(this.throttle, inp.boost ? 1 : inp.brake ? 0 : 0.55, 3, dt);
    this.speed += clamp(tgt - this.speed, -c.accel * dt, c.accel * dt);
    this.speed -= Math.sin(this.pitch) * 9.81 * 0.55 * dt;
    this.speed = clamp(this.speed, c.minSpeed * 0.85, c.maxSpeed * 1.08);
    const d = this.dir;
    this.position.addScaledVector(d, this.speed * dt);
    this.velocity.copy(d).multiplyScalar(this.speed);
    this.heading = this.yaw;
    if (this.position.y > c.maxAlt) { this.position.y = c.maxAlt; this.pitch = Math.min(this.pitch, 0); }
    _e.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.object.quaternion.setFromEuler(_e);
    if (this.prop) this.prop.rotation.z += dt * 60;
    for (const f of this.flames) {
      const k = 0.35 + this.throttle * 0.9;
      f.scale.set(0.7 + this.throttle * 0.5, 0.7 + this.throttle * 0.5, k * (0.9 + Math.random() * 0.2));
      f.material.opacity = 0.5 + this.throttle * 0.5;
    }
    // 翼端の雲（急旋回時）
    const g = Math.abs(turn) + Math.abs(pitchIn);
    this.vortexT += dt;
    if (g > 1.0 && this.vortexT > 0.025) {
      this.vortexT = 0;
      const fx = this.world.effects;
      const k = Math.min(1, (g - 1.0) * 1.5);
      for (const s of [-1, 1]) {
        const off = new THREE.Vector3(s * 6.4, 0, -3).applyQuaternion(this.object.quaternion).add(this.position);
        fx.alpha.spawn({ x: off.x, y: off.y, z: off.z, life: 0.45, size: 0.35, size1: 1.1, color: [1, 1, 1, 0.22 * k], color1: [1, 1, 1, 0], frame: 0, fadeIn: 0 });
      }
    }
    if (this.position.y < 2.5) { this.battle.killVehicle(this, 'sea', null); return; }
    const k = this.battle.kaiju;
    if (k && !k.dead && k.phase !== 'intro' && k.pointInside(this.position, 2)) { this.battle.killVehicle(this, 'crash', 'body'); return; }
    this.updateWeapons(dt, inp);
  }

  updateWeapons(dt, inp) {
    const c = this.cfg;
    const k = this.battle.kaiju;
    const d = this.dir.clone();
    const nose = this.position.clone().addScaledVector(d, 8);
    // 機関砲（手動）: 押している間、機首の向きへ乱射。撃ち続けると過熱する
    const G = c.gun, g = this.gun;
    g.firing = false;
    if (g.over > 0) {
      g.over -= dt;
      g.heat = Math.max(0, g.heat - dt * G.coolRate * 1.3);
    } else if (inp.mg) {
      g.t += dt;
      const fx = this.world.effects;
      const right = _v2.set(1, 0, 0).applyQuaternion(this.object.quaternion);
      while (g.t >= 0) {
        g.t -= 1 / G.rate;
        g.side = -g.side;
        const o = nose.clone().addScaledVector(right, g.side * (this.type === 'zero' ? 3.2 : 1.4));
        const dir = d.clone();
        dir.x += rand(-1, 1) * G.spread; dir.y += rand(-1, 1) * G.spread; dir.z += rand(-1, 1) * G.spread;
        dir.normalize();
        this.battle.projectiles.bullet(o, dir, G.speed, this, G, G.range, this.velocity);
        fx.add.spawn({ x: o.x + d.x * 1.5, y: o.y + d.y * 1.5, z: o.z + d.z * 1.5, vx: this.velocity.x, vy: this.velocity.y, vz: this.velocity.z,
          life: 0.05, size: 1.8, size1: 2.6, color: [12, 7, 3, 1], color1: [4, 1.2, 0.2, 0], frame: 6, fadeIn: 0 });
        this.stats.shots++;
        g.heat += G.heatPerShot;
        if (g.heat >= 1) { g.heat = 1; g.over = G.overheatTime; break; }
      }
      g.firing = true;
      this.battle.onMG(this, nose);
    } else {
      g.heat = Math.max(0, g.heat - dt * G.coolRate);
      g.t = Math.min(g.t, 0);
    }
    this.gunActive = g.firing;
    this.bombGauge = Math.min(1, this.bombGauge + dt / c.bomb.gauge);
    // ミサイルのロックオン
    this.missileCd = Math.max(0, this.missileCd - dt);
    let best = null, bestAng = (c.missile ? c.missile.lockCone : 0) * DEG;
    if (c.missile && k && !k.dead && k.phase !== 'intro') {
      for (const key of k.aliveHeads) {
        const hp = k.headSpheres[key].c;
        const to = _v2.copy(hp).sub(this.position);
        const dist = to.length();
        if (dist > c.missile.lockRange) continue;
        const ang = to.normalize().angleTo(d);
        if (ang < bestAng) { bestAng = ang; best = key; }
      }
    }
    if (best && best === this.lock.key) this.lock.t += dt; else { this.lock.key = best; this.lock.t = best ? 0 : 0; }
    if (inp.missile && this.missiles > 0 && this.missileCd <= 0) this.fireMissile(d);
    if (inp.bomb && this.bombGauge >= 1) this.dropBomb();
  }

  /** 翼下のミサイル（模型）の表示を残弾に合わせる */
  syncPylons() {
    const max = this.cfg.missile ? this.cfg.missile.count : this.cfg.rocket.count;
    const n = this.pylons.length;
    if (!n) return;
    const visible = Math.ceil((this.missiles / max) * n);
    this.pylons.forEach((p, i) => { for (const c of p.children) c.visible = i < visible; });
  }

  fireMissile(d) {
    const c = this.cfg;
    const max = c.missile ? c.missile.count : c.rocket.count;
    const n = this.pylons.length;
    const idx = n ? Math.max(0, Math.ceil((this.missiles / max) * n) - 1) : 0;
    const pyl = n ? this.pylons[idx] : null;
    const origin = pyl ? pyl.getWorldPosition(new THREE.Vector3()) : this.position.clone().add(new THREE.Vector3(0, -1.5, 0));
    if (c.missile) {
      const locked = this.lock.key && this.lock.t > 0.45 ? this.lock.key : null;
      this.battle.projectiles.missile(origin, d, this.speed + 40, this, c.missile, locked);
      this.battle.netFire(this, 'msl', { o: origin, d, s: this.speed + 40, ms: c.missile.speed, tu: c.missile.turn, tk: locked });
      this.missileCd = c.missile.reload;
    } else {
      for (const s of [-1, 1]) {
        const o = origin.clone().add(new THREE.Vector3(s * 3, 0, 0).applyQuaternion(this.object.quaternion));
        this.battle.projectiles.rocket(o, d, this.speed, this, c.rocket);
        this.battle.netFire(this, 'rkt', { o, d, s: this.speed, ms: c.rocket.speed });
      }
      this.missiles--;
      this.missileCd = c.rocket.reload;
    }
    if (c.missile) this.missiles--;
    this.syncPylons();
    this.battle.onFire(this, 'missile', origin);
  }

  dropBomb() {
    this.bombGauge = 0;
    const o = this.position.clone().add(new THREE.Vector3(0, -2.5, 0));
    const vel = this.velocity.clone().multiplyScalar(0.96).add(new THREE.Vector3(0, -6, 0));
    this.battle.projectiles.bomb(o, vel, this, this.cfg.bomb);
    this.battle.netFire(this, 'bomb', { o, d: vel });
    this.battle.onFire(this, 'bomb', o);
  }

  // ---- マルチプレイ
  netExtra() { return { th: Math.round(this.throttle * 100) / 100, mg: this.gun.firing ? 1 : 0, ms: this.missiles }; }

  applyNetExtra(x, dt) {
    if (this.prop) this.prop.rotation.z += dt * 60;
    this.yaw = this.heading;
    if (!x) return;
    this.throttle = x.th;
    for (const f of this.flames) {
      const k = 0.35 + this.throttle * 0.9;
      f.scale.set(0.7 + this.throttle * 0.5, 0.7 + this.throttle * 0.5, k * (0.9 + Math.random() * 0.2));
      f.material.opacity = 0.5 + this.throttle * 0.5;
    }
    if (this.missiles !== x.ms) { this.missiles = x.ms; this.syncPylons(); }
    if (x.mg) {
      const G = this.cfg.gun;
      this.gunVisT = (this.gunVisT || 0) + dt;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion);
      const nose = this.position.clone().addScaledVector(fwd, 8);
      while (this.gunVisT > 1 / G.rate) {
        this.gunVisT -= 1 / G.rate;
        const dir = fwd.clone();
        dir.x += rand(-1, 1) * G.spread; dir.y += rand(-1, 1) * G.spread; dir.z += rand(-1, 1) * G.spread;
        this.battle.projectiles.bullet(nose, dir.normalize(), G.speed, this, G, G.range, this.velocity, true);
      }
      this.battle.audio?.distantMG(this.position);
    } else this.gunVisT = 0;
  }

  resupply(dt) {
    this.resupplyT = (this.resupplyT || 0) + dt;
    const max = this.cfg.missile ? this.cfg.missile.count : this.cfg.rocket.count;
    if (this.resupplyT > 1.2 && this.missiles < max) { this.resupplyT = 0; this.missiles++; this.syncPylons(); return true; }
    return false;
  }

  onKilled(cause) {
    const fx = this.world.effects;
    fx.explosion(this.position.clone(), 1.8);
    this.fallVel = this.velocity.clone().multiplyScalar(0.6);
    this.spin = rand(2, 4) * (Math.random() < 0.5 ? -1 : 1);
    if (cause === 'sea') { fx.splash(this.position, 2, { height: 30 }); this.removedSoon = true; }
  }

  updateDeath(dt) {
    const fx = this.world.effects;
    if (this.removedSoon) { this.object.visible = false; if (this.deathT > 3) this.removed = true; return; }
    this.fallVel.y -= 9.81 * dt;
    this.position.addScaledVector(this.fallVel, dt);
    this.object.rotateZ(this.spin * dt);
    this.object.rotateX(0.3 * dt);
    if (Math.random() < 0.9) fx.smokeTrail(this.position, 1.4, true);
    if (Math.random() < 0.5) fx.fire(this.position, 0.5);
    if (this.position.y < 0) {
      fx.splash(this.position, 2, { height: 35 });
      this.object.visible = false;
      this.removedSoon = true;
      this.deathT = 0;
    }
  }
}

// ================================================================== 空母
class Carrier extends Vehicle {
  constructor(battle, opts) {
    super(battle, 'carrier', opts);
    const model = cloneModel('carrier') || placeholderShip(260, 34, 0x7d848a, true);
    this.object.add(model);
    this.model = model;
    this.hitRadius = CARRIER.hitRadius;
    this.killHalfLength = 70;
    this.speed = 0;
    this.object.position.set(opts.position.x, 0, opts.position.z);
    this.heading = opts.heading ?? Math.PI;
    this.trail = this.world.foam.createTrail({ life: 60, w0: 26, spread: 1.0, strength: 0.85, step: 8 });
    this.offset = opts.offset ?? 700;
    this.emitters = [];
    this.parked = [];
    this.hitsLeft = CARRIER.hits;
  }

  /** 被弾（轟沈には至らない）: 爆発と火災 */
  onHit() {
    const fx = this.world.effects;
    const z = (Math.random() - 0.5) * 140;
    fx.explosion(new THREE.Vector3(0, 16, z).applyQuaternion(this.object.quaternion).add(this.position), 3);
    const e = fx.addEmitter(() => {
      if (!this.alive && this.deathT > 40) return false;
      const wp = new THREE.Vector3(0, 18, z).applyQuaternion(this.object.quaternion).add(this.position);
      if (wp.y > -3) fx.fire(wp, 2.6);
      return true;
    });
    this.emitters.push(e);
  }

  deckSpawn() {
    const f = this.forward;
    const p = this.position.clone().addScaledVector(f, 60);
    p.y = 30;
    return { position: p, heading: this.heading };
  }

  simulate(dt) {
    const k = this.battle.kaiju;
    if (!k) return;
    // 怪獣の前方（街側）に距離を保ちつつ、横にずれた位置を目指す
    const goal = _v2.set(k.pos.x + this.offset, 0, k.pos.z + CARRIER.standOff);
    goal.z = Math.min(goal.z, WORLD.cityDistance - 250);
    const dx = goal.x - this.position.x, dz = goal.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const desiredSpeed = clamp(dist / 60, 0, CARRIER.speed) * (dist > 30 ? 1 : 0);
    let wantHeading = dist > 120 ? want : 0;
    this.heading += clamp(angleDiff(this.heading, wantHeading), -2.2 * DEG * dt, 2.2 * DEG * dt);
    this.speed = damp(this.speed, desiredSpeed, 0.4, dt);
    const f = this.forward;
    this.position.x += f.x * this.speed * dt;
    this.position.z += f.z * this.speed * dt;
    this.velocity.set(f.x * this.speed, 0, f.z * this.speed);
    const oc = this.world.ocean;
    this.position.y = damp(this.position.y, oc.heightAt(this.position.x, this.position.z) * 0.5, 2, dt);
    _e.set(0, this.heading, Math.sin(this.world.time * 0.4) * 0.6 * DEG, 'YXZ');
    this.object.quaternion.setFromEuler(_e);
    this.trail.intensity = clamp(this.speed / 5, 0, 1);
    this.trail.push(this.position.x - f.x * 125, this.position.z - f.z * 125, this.world.time, 1);
  }

  update(dt) {
    if (this.alive) { if (this.local) this.simulate(dt); else this.updatePuppet(dt); }
    else if (this.dying) { this.deathT += dt; this.updateDeath(dt); }
  }

  applyNetExtra(x, dt) {
    if (!this.trail) return;
    const f = this.forward;
    this.trail.intensity = clamp(this.speed / 5, 0, 1);
    this.trail.push(this.position.x - f.x * 125, this.position.z - f.z * 125, this.world.time, 1);
  }

  onKilled() {
    const fx = this.world.effects;
    for (let i = 0; i < 5; i++) fx.explosion(this.position.clone().add(new THREE.Vector3(rand(-15, 15), 15, rand(-100, 100))), 3);
    if (this.trail) { this.world.foam.removeTrail(this.trail); this.trail = null; }
    for (const z of [-70, 0, 70]) {
      const e = fx.addEmitter(() => {
        if (this.deathT > 40) return false;
        const wp = new THREE.Vector3(0, 20, z).applyQuaternion(this.object.quaternion).add(this.position);
        if (wp.y > -3) fx.fire(wp, 3.5);
        return true;
      });
      this.emitters.push(e);
    }
  }

  updateDeath(dt) {
    const t = this.deathT;
    _e.set(Math.min(1, t / 20) * 4 * DEG, this.heading, Math.min(1, t / 15) * 18 * DEG, 'YXZ');
    this.object.quaternion.setFromEuler(_e);
    this.position.y -= dt * (0.3 + t * 0.06);
    if (t > 45) this.removed = true;
  }
}

// ------------------------------------------------------------------ 仮モデル（GLB が無い時）
function placeholderShip(length, beam, color, carrier = false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(beam, 12, length), mat);
  hull.position.y = 1;
  g.add(hull);
  const sup = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.5, 14, length * 0.2), mat);
  sup.position.set(carrier ? -beam * 0.35 : 0, 12, carrier ? 10 : -length * 0.1);
  g.add(sup);
  if (carrier) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(beam * 1.4, 1.5, length * 1.02), new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.9 }));
    deck.position.y = 8;
    g.add(deck);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

function placeholderJet(type) {
  const g = new THREE.Group();
  const col = type === 'zero' ? 0x4c5a3a : 0xa3a9ae;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 19, 10).rotateX(Math.PI / 2), mat);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.5, 10).rotateX(Math.PI / 2), mat);
  nose.position.z = 11;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 5), mat);
  wing.position.z = -1.5;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 2.5), mat);
  tail.position.z = -8;
  g.add(tail);
  for (const x of [-1.6, 1.6]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 2.6), mat);
    fin.position.set(x, 1.8, -7.6);
    fin.rotation.z = x * 0.08;
    g.add(fin);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}
return { Vehicle, Destroyer, Fighter, Carrier };
})();

// ==== src/game/ai.js
__mod["src/game/ai.js"] = (function () {
// CPU（仲間AI）: 単純なルールの組み合わせ。反応の遅れと照準のブレで「腕前」を調整する。
const THREE = __DEPS["three"];
const { makeInputState } = __mod["src/game/input.js"];
const { clamp, rand, angleDiff, DEG, interceptTime } = __mod["src/core/util.js"];
const { SHIP, FIGHTER } = __mod["src/config.js"];
const { HEAD_KEYS } = __mod["src/game/kaijuModel.js"];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function dist2DPointSeg(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)), t };
}

/** 危険（予告中の攻撃）に自分が入っているか。入っていれば逃げる方向を返す */
function findThreat(battle, v, lookahead = 2.5) {
  let best = null;
  const p = _v.copy(v.position).addScaledVector(v.velocity, Math.min(lookahead, 1.2));
  for (const h of battle.hazards) {
    if (h.until < battle.time) continue;
    if (h.air === false && v.kind === 'fighter' && v.position.y > (h.altMax || 120)) continue;
    // 極太ビーム: 船は逃げ切れないので攻撃を続ける。戦闘機は高く上がれば助かる
    if (h.mega && (v.kind !== 'fighter' || v.position.y > h.altMax + 60)) continue;
    let inside = false, away = null;
    const pad = (v.kind === 'fighter' ? 30 : 60);
    if (h.type === 'line') {
      if (h.air && v.kind !== 'fighter') continue;
      if (h.air && Math.abs(v.position.y - h.y) > 70) continue;
      const r = dist2DPointSeg(p.x, p.z, h.a, h.b);
      if (r.d < h.width / 2 + pad) {
        inside = true;
        const ax = h.b.x - h.a.x, az = h.b.z - h.a.z;
        const n = new THREE.Vector3(-az, 0, ax).normalize();
        const cx = h.a.x + ax * r.t, cz = h.a.z + az * r.t;
        if ((p.x - cx) * n.x + (p.z - cz) * n.z < 0) n.negate();
        away = n;
      }
    } else if (h.type === 'circle') {
      const d = Math.hypot(p.x - h.c.x, p.z - h.c.z);
      if (d < h.r + pad) { inside = true; away = new THREE.Vector3(p.x - h.c.x, 0, p.z - h.c.z).normalize(); }
    } else if (h.type === 'sector') {
      const dx = p.x - h.c.x, dz = p.z - h.c.z;
      const d = Math.hypot(dx, dz);
      if (d < h.outer + pad && d > h.inner - pad) {
        const ang = Math.abs(angleDiff(h.dir, Math.atan2(dx, dz)));
        if (ang < h.arc / 2 + 0.15) { inside = true; away = new THREE.Vector3(dx, 0, dz).normalize(); }
      }
    } else if (h.type === 'target' && h.target === v) {
      inside = true;
      away = new THREE.Vector3(-v.velocity.z, 0, v.velocity.x).normalize();
    }
    if (inside && h.mega) away = new THREE.Vector3(0, 0, 0);
    if (inside && (!best || h.strike < best.strike)) best = { h, away, strike: h.strike };
  }
  return best;
}

class ShipAI {
  constructor(battle, skill, slot) {
    this.battle = battle;
    this.skill = skill;
    this.state = makeInputState();
    this.aim = new THREE.Vector3();
    this.ringDist = rand(1300, 2200);
    this.mgT = 0;          // 機関砲の連射の残り時間
    this.mgCd = rand(2, 5);
    this.bearing = slot;           // 怪獣正面からの方位（ラジアン）
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    this.reactDelay = battle.diff.cpuReaction * rand(0.7, 1.3);
    this.threatSeen = null;
    this.threatT = 0;
    this.torpT = rand(8, 20);
    this.retarget = 0;
    this.targetKey = 'C';
    this.speedIdx = 4;
  }

  update(ship, dt) {
    const b = this.battle, k = b.kaiju, s = this.state;
    s.fire = s.torpedo = s.mg = false;
    s.throttle = 0;
    if (!k) return s;
    // 目標地点: 怪獣の周りの担当位置
    const kf = new THREE.Vector3(Math.sin(k.root.rotation.y), 0, Math.cos(k.root.rotation.y));
    const ang = Math.atan2(kf.x, kf.z) + this.bearing;
    const goal = new THREE.Vector3(k.pos.x + Math.sin(ang) * this.ringDist, 0, k.pos.z + Math.cos(ang) * this.ringDist);
    const toGoal = goal.clone().sub(ship.position);
    const dGoal = toGoal.length();
    // 怪獣に対して接線方向に動く（赤いビームが避けやすい）
    const rad = new THREE.Vector3(ship.position.x - k.pos.x, 0, ship.position.z - k.pos.z);
    const dK = rad.length();
    rad.normalize();
    const tang = new THREE.Vector3(-rad.z, 0, rad.x).multiplyScalar(this.circleDir);
    // 基本は怪獣の周りを回る（接線方向）。担当位置へは斜めに寄せるだけ
    let desired = tang.clone().multiplyScalar(1.6).addScaledVector(toGoal.normalize(), clamp(dGoal / 1100, 0.15, 0.8));
    if (dK < 900) desired.addScaledVector(rad, 2.0);
    if (dK > 2700) desired.addScaledVector(rad, -1.2);
    // 救助（練習モード）
    const rescue = b.rescueTarget;
    if (rescue && rescue.position.distanceTo(ship.position) < 1500) {
      desired = rescue.position.clone().sub(ship.position).setY(0).normalize();
    }
    // 予告への反応（少し遅れる）
    const th = findThreat(b, ship, 3);
    if (th) {
      if (this.threatSeen !== th.h) { this.threatSeen = th.h; this.threatT = 0; }
      this.threatT += dt;
      if (this.threatT > this.reactDelay) {
        // 今の勢いを活かせる側へ逃げる（どちらの側へ抜けても良い）
        const f = ship.forward;
        const n = th.away.clone();
        if (th.h.type === 'line' && f.dot(n) < -0.2) n.negate();
        desired = n.multiplyScalar(3).add(f.multiplyScalar(0.8));
        this.speedIdx = 4;
      }
    } else this.threatSeen = null;
    const want = Math.atan2(desired.x, desired.z);
    const diff = angleDiff(ship.heading, want);
    s.steer = clamp(-diff * 2.2, -1, 1);
    if (ship.speedIdx < this.speedIdx) s.throttle = 1;
    else if (ship.speedIdx > this.speedIdx) s.throttle = -1;
    // 砲撃: 溜め中の頭 > 硬直・怯み中の頭 > ランダム（極太ビームの溜め中は総攻撃）
    const megaNow = !!(k.mega && k.mega.state === 'charge');
    this.retarget -= dt;
    if (megaNow && !k.heads[this.targetKey]?.alive) this.retarget = 0;
    if (this.retarget <= 0) {
      this.retarget = rand(1.5, 4);
      const alive = k.aliveHeads;
      const charging = alive.filter((x) => k.heads[x].state === 'charge');
      const weak = alive.filter((x) => ['recover', 'stunned'].includes(k.heads[x].state));
      this.targetKey = charging.length ? charging[0] : weak.length ? weak[0] : alive[Math.floor(Math.random() * alive.length)] || 'C';
    }
    if (k.heads[this.targetKey] && k.heads[this.targetKey].alive && k.phase === 'alive') {
      const hp = k.headSpheres[this.targetKey].c;
      const dist = hp.distanceTo(ship.position);
      const err = (1 - this.skill) * (10 + dist * 0.02);
      const lead = (dist / SHIP.gun.speed) * k.speed;
      this.aim.copy(hp).add(new THREE.Vector3(rand(-err, err), rand(-err, err) * 0.6, rand(-err, err) + lead));
      s.aimPoint = this.aim;
      s.fire = dist < SHIP.gun.maxRange * 0.9 && Math.random() < 0.6 + this.skill * 0.4;
      // 機関砲: 溜め中の頭を止めたい時は長めに、普段は短い連射。過熱しないよう休む
      const charging = k.heads[this.targetKey].state === 'charge';
      this.mgCd -= dt;
      if (megaNow && dist < SHIP.mg.range * 0.95 && ship.mg.over <= 0) { this.mgT = Math.max(this.mgT, 0.5); this.mgCd = 0; }
      if (this.mgT > 0) {
        this.mgT -= dt;
        s.mg = ship.mg.heat < 0.92;
      } else if (dist < SHIP.mg.range * 0.92 && ship.mg.over <= 0 && (charging || this.mgCd <= 0)) {
        this.mgT = charging ? rand(1.4, 2.4) : rand(0.8, 1.6);
        this.mgCd = rand(2.5, 5) / (0.6 + this.skill);
      }
      // 魚雷（3本だけ）: 怪獣が硬直中か、間隔が空いたら。狙い目は怪獣の進路の先
      this.torpT -= dt;
      const dBody = Math.hypot(k.pos.x - ship.position.x, k.pos.z - ship.position.z);
      const opportunity = (alive) => alive.some((x) => ['recover', 'stunned'].includes(k.heads[x].state));
      if (ship.torps > 0 && dBody < 2600 && (this.torpT <= 0 || megaNow || (opportunity(k.aliveHeads) && this.torpT < 8))) {
        const ta = ship.torpAim;
        if (ta.leadValid) {
          this.aim.copy(ta.lead).add(new THREE.Vector3(rand(-20, 20) * (1.5 - this.skill), 0, rand(-30, 30) * (1.5 - this.skill)));
          s.aimPoint = this.aim;
          s.torpedo = true;
          s.mg = false;
          this.torpT = rand(22, 38);
        }
      }
    } else s.aimPoint = null;
    return s;
  }
}

class FighterAI {
  constructor(battle, skill, slot) {
    this.battle = battle;
    this.skill = skill;
    this.state = makeInputState();
    this.mode = 'orbit';
    this.modeT = 0;
    this.slot = slot;
    this.orbitR = rand(900, 1400);
    this.orbitAlt = rand(320, 600);
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.reactDelay = battle.diff.cpuReaction * rand(0.6, 1.2);
    this.threatSeen = null;
    this.threatT = 0;
    this.targetKey = 'C';
    this.attackCd = rand(2, 6);
  }

  steerTo(v, dir, dt) {
    const s = this.state;
    const wantYaw = Math.atan2(dir.x, dir.z);
    const dyaw = angleDiff(v.yaw, wantYaw);
    s.steer = clamp(-dyaw * 2.0, -1, 1);
    const wantPitch = Math.asin(clamp(dir.y / (dir.length() || 1), -0.95, 0.95));
    s.pitch = clamp((wantPitch - v.pitch) * 3.0, -1, 1);
  }

  update(v, dt) {
    const b = this.battle, k = b.kaiju, s = this.state;
    s.missile = s.bomb = s.mg = false;
    s.boost = s.brake = false;
    if (!k) return s;
    this.modeT += dt;
    const kc = new THREE.Vector3(k.pos.x, Math.max(60, k.focus.y - 20), k.pos.z);
    const toK = kc.clone().sub(v.position);
    const dK = toK.length();
    let dir;
    const th = findThreat(b, v, 2);
    if (th) {
      if (this.threatSeen !== th.h) { this.threatSeen = th.h; this.threatT = 0; }
      this.threatT += dt;
    } else this.threatSeen = null;
    if (th && this.threatT > this.reactDelay) {
      dir = th.away.clone();
      dir.y = th.h.mega ? 1.4 : th.h.type === 'line' && th.h.air ? (v.position.y > th.h.y ? 0.8 : -0.3) : 0.6;
      s.boost = true;
      if (this.mode !== 'resupply') this.mode = 'orbit';
      this.bombPhase = null;
    } else if (this.mode === 'orbit') {
      const rad = new THREE.Vector3(v.position.x - k.pos.x, 0, v.position.z - k.pos.z).normalize();
      const tang = new THREE.Vector3(-rad.z, 0, rad.x).multiplyScalar(this.orbitDir);
      const goal = new THREE.Vector3(k.pos.x, this.orbitAlt, k.pos.z).addScaledVector(rad, this.orbitR).addScaledVector(tang, 300);
      dir = goal.sub(v.position).normalize();
      this.attackCd -= dt;
      const charging = k.aliveHeads.filter((x) => k.heads[x].state === 'charge');
      const needAmmo = v.missiles === 0 && b.carrier && b.carrier.alive && v.bombGauge < 1;
      const megaNow = !!(k.mega && k.mega.state === 'charge');
      if (k.phase === 'alive' && !needAmmo && (charging.length || this.attackCd <= 0 || megaNow)) {
        this.targetKey = charging.length ? charging[Math.floor(Math.random() * charging.length)] : k.aliveHeads[Math.floor(Math.random() * k.aliveHeads.length)];
        this.mode = v.bombGauge >= 1 && Math.random() < 0.35 ? 'bomb' : 'attack';
        this.modeT = 0;
        this.bombPhase = null;
      }
      // ミサイルを撃ち尽くしたら空母へ補給に戻る
      if (needAmmo && this.mode === 'orbit') { this.mode = 'resupply'; this.modeT = 0; }
      if (b.rescueTarget && b.rescueTarget.position.distanceTo(v.position) < 2500) {
        dir = b.rescueTarget.position.clone().add(new THREE.Vector3(0, 120, 0)).sub(v.position).normalize();
      }
    } else if (this.mode === 'resupply') {
      const c = b.carrier;
      const max = v.cfg.missile ? v.cfg.missile.count : v.cfg.rocket.count;
      if (!c || !c.alive || v.missiles >= max - 1 || this.modeT > 60) { this.mode = 'orbit'; this.modeT = 0; dir = toK.clone().normalize(); }
      else {
        const goal = c.position.clone().add(new THREE.Vector3(0, 160, 0));
        dir = goal.sub(v.position).normalize();
        if (v.position.distanceTo(c.position) < 500) s.brake = true;
      }
    } else if (this.mode === 'attack') {
      const key = this.targetKey;
      if (!k.heads[key] || !k.heads[key].alive) { this.mode = 'orbit'; return s; }
      const hp = k.headSpheres[key].c;
      const err = (1 - this.skill) * 18;
      const aimP = hp.clone().add(new THREE.Vector3(rand(-err, err), rand(-err, err), rand(-err, err)));
      dir = aimP.sub(v.position).normalize();
      const dist = hp.distanceTo(v.position);
      if (v.lock.key === key && v.lock.t > 0.5 && v.missiles > 0 && Math.random() < dt * (0.6 + this.skill)) s.missile = true;
      // 機関砲: 機首が頭に向いていて射程内なら撃つ（過熱しそうなら休む）
      const ang = v.dir.angleTo(hp.clone().sub(v.position).normalize());
      if (dist < v.cfg.gun.range * 0.95 && ang < 0.07 + (1 - this.skill) * 0.03 && v.gun.over <= 0 && (v.gun.heat < 0.85 || v.gun.firing)) s.mg = v.gun.heat < 0.97;
      if (dist < 620 || this.modeT > 10) { this.mode = 'break'; this.modeT = 0; this.breakDir = new THREE.Vector3(-toK.z, 0, toK.x).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1); }
    } else if (this.mode === 'break') {
      dir = this.breakDir.clone().add(new THREE.Vector3(0, 0.55, 0)).addScaledVector(toK.clone().normalize(), -0.8).normalize();
      s.boost = true;
      if (this.modeT > 3.5) { this.mode = 'orbit'; this.attackCd = rand(3, 8) / (0.6 + this.skill); }
    } else if (this.mode === 'bomb') {
      // 背中の上空を通過しながら、落とした爆弾が背中に落ちる瞬間に投下する
      const fwdK = new THREE.Vector3(Math.sin(k.root.rotation.y), 0, Math.cos(k.root.rotation.y));
      const backPt = new THREE.Vector3(k.pos.x, 0, k.pos.z).addScaledVector(fwdK, -30);
      const runAlt = 330;
      const flat = new THREE.Vector3(backPt.x - v.position.x, 0, backPt.z - v.position.z);
      const dFlat = flat.length();
      const h = Math.max(30, v.position.y - 115);
      const tF = Math.sqrt((2 * h) / 9.81);
      const dropDist = v.speed * 0.96 * tF;
      if (!this.bombPhase) this.bombPhase = dFlat > dropDist + 350 ? 'run' : 'setup';
      if (this.bombPhase === 'setup') {
        // 近すぎると狙いを合わせられないので、いったん離れてから進入し直す
        dir = flat.clone().normalize().negate();
        if (dFlat > dropDist + 500) this.bombPhase = 'run';
      } else {
        dir = flat.clone().normalize();
        const ix = v.position.x + v.velocity.x * 0.96 * tF, iz = v.position.z + v.velocity.z * 0.96 * tF;
        const tx = backPt.x + k.velocity.x * tF, tz = backPt.z + k.velocity.z * tF;
        if (v.position.y > 145 && v.bombGauge >= 1 && Math.hypot(ix - tx, iz - tz) < 60 + (1 - this.skill) * 50) s.bomb = true;
        if (dFlat < 120) this.bombPhase = 'setup'; // 通り過ぎた
      }
      dir.y = clamp((runAlt - v.position.y) / 260, -0.5, 0.5);
      if (v.bombGauge < 1 || this.modeT > 17) { this.mode = 'break'; this.modeT = 0; this.bombPhase = null; this.breakDir = new THREE.Vector3(-toK.z, 0, toK.x).normalize(); }
    }
    // 地面（海面）と怪獣を避ける
    if (v.position.y < 70) dir.y = Math.max(dir.y, 0.5);
    if (dK < 260 && this.mode !== 'bomb') dir.add(v.position.clone().sub(kc).normalize().multiplyScalar(2)).normalize();
    // 怪獣の体にぶつからないよう、体の近くでは上へ逃げる
    if (k.pointInside(v.position.clone().addScaledVector(v.dir, v.speed * 1.2), 25)) { dir.y = Math.max(dir.y, 0.8); s.boost = true; }
    const range = b.arenaCheck(v.position);
    if (range > 0) dir.add(new THREE.Vector3(k.pos.x - v.position.x, 0, k.pos.z - v.position.z).normalize().multiplyScalar(range * 3)).normalize();
    this.steerTo(v, dir, dt);
    return s;
  }
}

class CarrierAI { update() { return null; } }
return { findThreat, ShipAI, FighterAI, CarrierAI };
})();

// ==== src/game/camera.js
__mod["src/game/camera.js"] = (function () {
// カメラ: 船は「機体の後方上空から奥の怪獣を見る」、戦闘機は追尾。
// どちらも右ドラッグ（タッチは画面のドラッグ）で自由に見回せる。
//  船: 回した向きのまま固定（C で怪獣の方へ戻す） / 戦闘機: 離すと後ろに戻る（C で怪獣を追い続けるカメラに切替）
const THREE = __DEPS["three"];
const { clamp, damp, dampVec, rand, angleDiff } = __mod["src/core/util.js"];

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

class CameraRig {
  constructor(battle) {
    this.battle = battle;
    this.cam = battle.camera;
    this.pos = this.cam.position.clone();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this.mode = 'intro';
    this.t = 0;
    this.fov = 55;
    this.spectate = null;
    this.kaijuCam = false;     // 戦闘機: 怪獣を画面に入れ続ける
    this.resetting = false;
    this.releaseT = 0;
    this._off = new THREE.Vector3();
  }

  shake(a) { this.shakeAmt = Math.min(2.5, this.shakeAmt + a); }

  setMode(m) { this.mode = m; this.t = 0; }

  get freeLooking() { return Math.abs(this.orbitYaw) > 0.05 || Math.abs(this.orbitPitch) > 0.05; }

  /** 視点操作（右ドラッグ・タッチのドラッグ・ホイール・C） */
  handleInput(dt, v) {
    const dev = this.battle.devices;
    if (!dev) return;
    const m = dev.mouse, t = dev.touch;
    const dx = m.dragDX + t.lookDX * 1.3, dy = m.dragDY + t.lookDY * 1.3;
    const held = m.right || t.looking;
    const isFighter = v && v.kind === 'fighter';
    if (dx || dy) {
      this.resetting = false;
      this.orbitYaw -= dx * 0.0055;
      if (isFighter) this.orbitYaw = clamp(this.orbitYaw, -Math.PI, Math.PI);
      else this.orbitYaw = angleDiff(0, this.orbitYaw);
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, isFighter ? -1.1 : -0.3, isFighter ? 1.1 : 1.0);
    }
    if (m.wheel) this.zoom = clamp(this.zoom * (1 + m.wheel * 0.1), 0.45, 2.4);
    const cHit = dev.hit('KeyC') || t.pressedButtons.has('look');
    if (isFighter) {
      if (cHit) { this.kaijuCam = !this.kaijuCam; this.battle.hud?.toast(this.kaijuCam ? 'カメラ: 怪獣を追う（C で戻す）' : 'カメラ: 機体の後ろ', ''); }
      // 離して少したつと後ろへ戻る
      if (held) this.releaseT = 0; else this.releaseT += dt;
      if (!held && this.releaseT > 0.5) {
        this.orbitYaw = damp(this.orbitYaw, 0, 3.2, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 3.2, dt);
      }
    } else {
      if (cHit) this.resetting = true;
      if (this.resetting) {
        this.orbitYaw = damp(this.orbitYaw, 0, 5, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 5, dt);
        if (Math.abs(this.orbitYaw) < 0.003 && Math.abs(this.orbitPitch) < 0.003) { this.orbitYaw = this.orbitPitch = 0; this.resetting = false; }
      }
    }
  }

  update(dt) {
    const b = this.battle, k = b.kaiju;
    this.t += dt;
    if (this.debugView) {
      // 開発用: 固定視点（関数なら毎フレーム計算）
      const dv = typeof this.debugView === 'function' ? this.debugView() : this.debugView;
      this.cam.position.copy(dv.pos);
      this.cam.lookAt(dv.look);
      if (dv.fov && this.cam.fov !== dv.fov) { this.cam.fov = dv.fov; this.cam.updateProjectionMatrix(); }
      return;
    }
    // テレビ中継の間は、報道ヘリのカメラの映像にする
    const bc = b.broadcast;
    if (bc && bc.controlsCamera) {
      const c = bc.cam;
      this.pos.copy(c.pos);
      this.look.copy(c.look);
      this.cam.position.copy(c.pos);
      this.cam.lookAt(c.look);
      this.fov = c.fov;
      if (Math.abs(this.cam.fov - c.fov) > 0.01) { this.cam.fov = c.fov; this.cam.updateProjectionMatrix(); }
      return;
    }
    const v = this.spectate || b.player;
    if (this.mode !== 'intro') this.handleInput(dt, v);
    const kf = k ? _a.set(k.pos.x, Math.max(30, k.focus.y), k.pos.z) : _a.set(0, 0, 0);
    let wantPos = this.pos.clone(), wantLook = this.look.clone(), lag = 3.2, lookLag = 5, fov = 55;
    if (this.mode === 'intro' && k) {
      // 海から立ち上がる怪獣の周りをゆっくり回る
      const t = this.t;
      const a = -0.55 + t * 0.06;
      const r = 820 - t * 28;
      wantPos.set(k.pos.x + Math.sin(a) * r, 22 + t * 8, k.pos.z + Math.cos(a) * r);
      wantLook.set(k.pos.x, Math.max(25, k.focus.y - 20 + t * 3), k.pos.z);
      lag = 1.5; lookLag = 2; fov = 46;
    } else if (k && k.phase === 'dying' && k.deathT < 15) {
      // 怪獣が海に沈んでいく様子を映す
      const from = v ? _b.set(v.position.x - k.pos.x, 0, v.position.z - k.pos.z) : _b.set(0, 0, 1);
      if (from.lengthSq() < 1) from.set(0, 0, 1);
      from.normalize().applyAxisAngle(UP, 0.35 + k.deathT * 0.03);
      wantPos.set(k.pos.x, 0, k.pos.z).addScaledVector(from, 680 - k.deathT * 8);
      wantPos.y = 38 + k.deathT * 2.5;
      wantLook.set(k.pos.x, Math.max(12, Math.min(kf.y, 120)), k.pos.z);
      lag = 1.0; lookLag = 1.6; fov = 44;
    } else if (v && (v.kind === 'ship' || v.kind === 'carrier')) {
      const dir = k ? new THREE.Vector3(v.position.x - k.pos.x, 0, v.position.z - k.pos.z) : v.forward.clone().negate();
      const dist = dir.length();
      dir.normalize();
      const near = clamp(1 - dist / 1800, 0, 1);
      const back = (330 + near * 170) * this.zoom;
      const up = (60 + near * 70) * this.zoom + this.orbitPitch * 260;
      // 既定の注視点（自艦と怪獣の間）を、回した分だけ艦の周りで回す
      const rel = new THREE.Vector3(0, 22, 0).add(v.position).lerp(kf, 0.6 - near * 0.25).sub(v.position);
      rel.applyAxisAngle(UP, this.orbitYaw);
      dir.applyAxisAngle(UP, this.orbitYaw);
      wantPos.copy(v.position).addScaledVector(dir, back).add(new THREE.Vector3(0, Math.max(14, up), 0));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      wantPos.addScaledVector(side, 40 * this.zoom);
      wantLook.copy(v.position).add(rel);
      lag = this.freeLooking ? 5 : 3.0; lookLag = this.freeLooking ? 7 : 4.5;
      fov = 40 - near * 4;
    } else if (v && v.kind === 'fighter') {
      const d = v.dir ? v.dir.clone() : v.forward.clone();
      if (this.kaijuCam && k && v.alive) {
        // 怪獣を追うカメラ（ドラッグで回り込める）
        const away = v.position.clone().sub(kf).normalize();
        away.applyAxisAngle(UP, this.orbitYaw);
        wantPos.copy(v.position).addScaledVector(away, 62 * this.zoom).add(new THREE.Vector3(0, 16 + this.orbitPitch * 40, 0));
        wantLook.copy(kf).lerp(v.position, 0.25);
        lag = 6; lookLag = 6;
      } else {
        const flat = new THREE.Vector3(d.x, d.y * 0.6, d.z).normalize();
        const off = flat.clone().multiplyScalar(-40 * this.zoom).add(new THREE.Vector3(0, 9.5 * this.zoom, 0));
        const lookV = d.clone().multiplyScalar(45).add(new THREE.Vector3(0, 3, 0));
        if (this.freeLooking) {
          off.applyAxisAngle(UP, this.orbitYaw);
          lookV.applyAxisAngle(UP, this.orbitYaw);
          const right = new THREE.Vector3(off.z, 0, -off.x).normalize();
          off.applyAxisAngle(right, -this.orbitPitch);
          lookV.applyAxisAngle(right, -this.orbitPitch);
        }
        wantPos.copy(v.position).add(off);
        wantLook.copy(v.position).add(lookV);
        lag = 9; lookLag = 12;
      }
      fov = 56 + (v.throttle || 0.5) * 10 - 5;
    } else if (this.mode === 'overview' && k) {
      const a = this.t * 0.08;
      wantPos.set(k.pos.x + Math.sin(a) * 1300, 380, k.pos.z + Math.cos(a) * 1300);
      wantLook.copy(kf);
      lag = 1.2; lookLag = 1.5;
    }
    if (v && !v.alive && v.dying && this.mode !== 'intro' && !(k && k.phase === 'dying' && k.deathT < 15)) {
      const a = this.t * 0.25;
      const r = v.kind === 'fighter' ? 90 : 260;
      wantPos.set(v.position.x + Math.sin(a) * r, Math.max(30, v.position.y + r * 0.45), v.position.z + Math.cos(a) * r);
      wantLook.copy(v.position);
      lag = 2; lookLag = 3;
    }
    dampVec(this.pos, wantPos, lag, dt);
    dampVec(this.look, wantLook, lookLag, dt);
    // 海面より下に潜らない
    const oc = this.battle.world.ocean;
    const minY = oc.heightAt(this.pos.x, this.pos.z) + 4;
    if (this.pos.y < minY) this.pos.y = minY;
    this.cam.position.copy(this.pos);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
    const s = this.shakeAmt * this.shakeAmt;
    if (s > 0.001) {
      this.cam.position.add(this._off.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(s * 2.2));
    }
    this.cam.lookAt(this.look);
    if (s > 0.001) this.cam.rotateZ(rand(-1, 1) * s * 0.01);
    this.fov = damp(this.fov, fov, 2, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}
return { CameraRig };
})();

// ==== src/game/broadcast.js
__mod["src/game/broadcast.js"] = (function () {
// テレビ局（架空の「わだつみテレビ」）の報道ヘリからの生中継
//  ・怪獣が海から現れる登場シーン
//  ・怪獣を倒した時（海に沈んでいく）／上陸された時
// 映像は報道ヘリの機首のカメラから撮っている設定。画面にはテレビのテロップ、アナウンサーの声（ブラウザの音声合成）を重ねる。
const THREE = __DEPS["three"];
const { clamp, damp, rand, smoothstep, angleDiff } = __mod["src/core/util.js"];
const { assets } = __mod["src/core/assets.js"];
const { KAIJU_INTRO } = __mod["src/game/kaiju.js"];
const { KAIJU } = __mod["src/config.js"];

const S = KAIJU.scale;
const STATION = { name: 'わだつみテレビ', heli: 'わだつみ1号機' };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function findNode(root, name) {
  let r = null;
  root.traverse((o) => { if (!r && o.name === name) r = o; });
  return r;
}

/** ローターの残像（中心が透けた円盤） */
function rotorDiscTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(20,20,22,0.0)');
  gr.addColorStop(0.15, 'rgba(20,20,22,0.25)');
  gr.addColorStop(0.85, 'rgba(25,25,28,0.32)');
  gr.addColorStop(0.95, 'rgba(200,200,200,0.35)');
  gr.addColorStop(1, 'rgba(20,20,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ==================================================================== 報道ヘリ（3Dモデル）
class NewsHeli {
  constructor(world) {
    this.world = world;
    this.object = new THREE.Group();
    this.object.name = 'NewsHeli';
    const g = assets.gltf.newsheli;
    if (g) {
      const m = g.scene.clone(true);
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          if (o.material) { o.material.envMapIntensity = 1.6; if (o.material.metalnessMap) { o.material.metalnessMap = null; o.material.metalness = 0; } }
        }
      });
      this.object.add(m);
      this.model = m;
      this.mainRotor = findNode(m, 'MainRotor');
      this.tailRotor = findNode(m, 'TailRotor');
      this.camMount = findNode(m, 'CamMount');
      this.beacon = findNode(m, 'Beacon');
    }
    const tex = rotorDiscTexture();
    const discMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    if (this.mainRotor) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(5.35, 40).rotateX(-Math.PI / 2), discMat);
      d.position.copy(this.mainRotor.position).add(new THREE.Vector3(0, 0.05, 0));
      this.mainRotor.parent.add(d);
    }
    if (this.tailRotor) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24).rotateY(Math.PI / 2), discMat);
      d.position.copy(this.tailRotor.position).add(new THREE.Vector3(0.05, 0, 0));
      this.tailRotor.parent.add(d);
    }
    // 赤い衝突防止灯（点滅）
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.3) }));
    if (this.beacon) { this.light.position.copy(this.beacon.position); this.beacon.parent.add(this.light); } else this.object.add(this.light);
    this.object.scale.setScalar(1.6); // 遠くからでも分かるよう少し大きめ
    world.scene.add(this.object);
    this.pos = this.object.position;
    this.yaw = 0; this.pitch = 0; this.bank = 0;
    this.t = 0;
    this.visible = true;
  }

  /** 位置と向きをまとめて決める（向き: 進行方向の yaw。bank は旋回の傾き） */
  place(p, yaw, pitch = -0.06, bank = 0) {
    this.pos.copy(p);
    this.yaw = yaw; this.pitch = pitch; this.bank = bank;
    this.object.rotation.set(0, 0, 0);
    // モデルは +Z が機首（glTF）。yaw は進行方向（sin, cos）
    this.object.quaternion.setFromEuler(new THREE.Euler(-pitch, yaw, -bank, 'YXZ'));
  }

  /** 中継カメラの位置（機首の下のカメラ球） */
  cameraPoint(out = new THREE.Vector3()) {
    this.object.updateMatrixWorld(true);
    if (this.camMount) return this.camMount.getWorldPosition(out);
    return out.copy(this.pos).add(new THREE.Vector3(0, -1, 0));
  }

  update(dt) {
    this.t += dt;
    if (this.mainRotor) this.mainRotor.rotation.y += dt * 33;
    if (this.tailRotor) this.tailRotor.rotation.x += dt * 70;
    this.light.visible = (this.t % 1.2) < 0.12;
  }

  setVisible(v) { this.object.visible = v; this.visible = v; }
  dispose() { this.world.scene.remove(this.object); }
}

// ==================================================================== アナウンサーの声
class Announcer {
  constructor(enabled, volume) {
    this.enabled = enabled && typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.volume = volume;
    this.voice = null;
    if (!this.enabled) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices().filter((v) => /ja/i.test(v.lang));
      const pref = ['Nanami', 'Keita', 'Google 日本語', 'Haruka', 'Ayumi', 'Sayaka', 'Ichiro', 'Kyoko', 'Otoya'];
      this.voice = pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs[0] || null;
    };
    pick();
    if (!this.voice) speechSynthesis.addEventListener?.('voiceschanged', pick, { once: true });
  }
  say(text, rate = 1.12) {
    if (!this.enabled) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[「」『』]/g, ''));
      u.lang = 'ja-JP';
      if (this.voice) u.voice = this.voice;
      u.rate = rate;
      u.pitch = 1.05;
      u.volume = clamp(this.volume, 0, 1);
      speechSynthesis.speak(u);
    } catch (e) { /* 音声合成が使えない環境 */ }
  }
  stop() { if (this.enabled) try { speechSynthesis.cancel(); } catch (e) { /* */ } }
}

// ==================================================================== 中継の画面（テロップ）
const TICKER = [
  '【避難情報】沿岸部の全域に避難指示が出ています。高い場所へ避難してください',
  '【交通】湾岸道路は全線で通行止め　鉄道は沿岸の路線で運転を見合わせ',
  '【政府】防衛出動を命令　海上自衛隊・航空自衛隊が現場海域へ',
  '【気象】現場付近の波の高さ3メートル　うねりを伴い次第に高くなる見込み',
];

class Overlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'tv hidden';
    this.el.innerHTML = `
      <div class="tv-static"></div>
      <div class="tv-frame">
        <div class="tv-tl"><span class="tv-live"><i></i>LIVE</span><span class="tv-chu">中継</span><div class="tv-src">${STATION.heli}から</div></div>
        <div class="tv-tr"><div class="tv-logo"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 15c5-7 9-7 13 0s8 7 12 0 8-7 11-2" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M2 21c5-5 9-5 13 0s8 5 12 0 8-5 11-1" fill="none" stroke="#7fd4ff" stroke-width="2.4" stroke-linecap="round"/></svg><b>${STATION.name}</b></div><div class="tv-clock"></div></div>
        <div class="tv-telop"></div>
        <div class="tv-lower"><span class="tv-tag">緊急</span><span class="tv-title"></span></div>
        <div class="tv-ticker"><div class="tv-ticker-in">${TICKER.join('　　◆　　')}　　◆　　${TICKER.join('　　◆　　')}</div></div>
      </div>
      <div class="tv-cap"></div>`;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    // 切り替え時の砂嵐の模様
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    q('.tv-static').style.backgroundImage = `url(${cv.toDataURL()})`;
    this.frame = q('.tv-frame');
    this.title = q('.tv-title');
    this.tag = q('.tv-tag');
    this.telop = q('.tv-telop');
    this.clock = q('.tv-clock');
    this.staticEl = q('.tv-static');
    this.cap = q('.tv-cap');
    this.staticUntil = 0;
    this.clockBase = new Date();
  }
  show(on) { this.el.classList.toggle('hidden', !on); }
  frameOn(on) { this.frame.classList.toggle('on', on); }
  setTitle(tag, text) {
    if (this.tag.textContent !== tag) this.tag.textContent = tag;
    this.tag.classList.toggle('sokuho', tag === '速報');
    if (this.title.textContent !== text) {
      this.title.textContent = text;
      this.title.classList.remove('in'); void this.title.offsetWidth; this.title.classList.add('in');
    }
  }
  setTelop(text) {
    if (this.telop.textContent === text) return;
    this.telop.textContent = text;
    this.telop.classList.remove('in'); void this.telop.offsetWidth;
    if (text) this.telop.classList.add('in');
  }
  setCaption(text) { this.cap.textContent = text || ''; this.cap.classList.toggle('on', !!text); }
  flashStatic(dur, now) { this.staticEl.classList.add('on'); this.staticUntil = now + dur; }
  update(t) {
    if (this.staticEl.classList.contains('on')) {
      this.staticEl.style.backgroundPosition = `${Math.random() * 256}px ${Math.random() * 256}px`;
      if (t > this.staticUntil) this.staticEl.classList.remove('on');
    }
    const d = new Date(this.clockBase.getTime() + t * 1000);
    const s = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (this.clock.textContent !== s) this.clock.textContent = s;
  }
  remove() { this.el.remove(); }
}

// ==================================================================== 中継の進行
/**
 * 台本: 時刻ごとにテロップ・アナウンサーの言葉・カメラの撮り方を切り替える。
 * shot: { from, kind: 'ext'|'cam', fov: [始め, 終わり], target: 関数 }
 */
class Broadcast {
  constructor(battle) {
    this.battle = battle;
    this.world = battle.world;
    this.audio = battle.audio;
    const s = battle.settings || {};
    this.heli = new NewsHeli(this.world);
    this.overlay = new Overlay(battle.app.ui);
    this.voice = new Announcer(s.voice !== false, (s.volume ?? 0.8) * 1.1);
    this.active = null;
    this.t = 0;
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30 };
    this.smoothLook = new THREE.Vector3();
    this.events = [];
    this.orbitA = 0;
    this.wob = new THREE.Vector3();
  }

  get controlsCamera() { return !!this.active && this.shot !== null; }

  /** 新しい中継を始める前の片付け */
  reset(kind) {
    if (this.active) this.finish(true);
    this.active = kind;
    this.t = 0;
    this.shot = null;
    this.ei = 0;
    this.glitchUntil = 0;
    this.telopUntil = 0;
    this.pendingCut = null;
  }

  // ---------------------------------------------------------------- 登場シーン
  startIntro() {
    this.reset('intro');
    // ヘリは怪獣の正面側（街の側）を回る: 首がこちらを向いて現れるように
    this.orbitA = 0.1;
    this.introR = 1700;
    const E = KAIJU_INTRO.emergeAt;
    this.events = [
      { t: 0.0, fn: () => { this.setShot('ext'); this.overlay.show(true); this.overlay.frameOn(false); this.overlay.setCaption(`${STATION.name} 報道ヘリ「${STATION.heli}」`); this.audio?.setHeli(0.5); } },
      { t: 3.4, fn: () => this.cut('cam', () => { this.overlay.setCaption(''); this.overlay.frameOn(true); this.overlay.setTitle('緊急', '沖合で異変 海面が大きく盛り上がる'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.18); }) },
      { t: 3.9, fn: () => this.say('こちら、沖合上空の、わだつみ1号機からお伝えしています。') },
      { t: 6.6, fn: () => this.say('ご覧ください！ 海面が、大きく盛り上がっています！') },
      { t: E + 1.2, fn: () => { this.say('あっ！ 何かが、何かが出てきます！'); this.overlay.setTitle('緊急', '沖合に巨大生物が出現'); } },
      { t: E + 3.6, fn: () => this.say('巨大な生き物です！ 首が、首が三つあります！') },
      { t: E + 6.4, fn: () => this.glitch(0.7) },
      { t: E + 7.6, fn: () => { this.say('自衛隊の艦隊と戦闘機が、現場に到着しました！ 沿岸部の皆さんは、直ちに避難してください！'); this.overlay.setTitle('緊急', '自衛隊が現場に到着　沿岸部に避難指示'); } },
      { t: KAIJU_INTRO.end - 0.25, fn: () => this.cut(null, () => this.finish()) },
    ];
    this.ei = 0;
  }

  // ---------------------------------------------------------------- 倒した時（海に沈む）
  startEnding() {
    this.reset('ending');
    const k = this.battle.kaiju, p = this.battle.player;
    const from = p ? Math.atan2(p.position.x - k.pos.x, p.position.z - k.pos.z) : 0;
    this.orbitA = from + 0.9;
    this.events = [
      { t: 0.7, fn: () => this.cut('cam', () => { this.overlay.show(true); this.overlay.frameOn(true); this.overlay.setTitle('速報', '怪獣の動きが止まる'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.16); this.battle.hud?.show(false); }) },
      { t: 1.1, fn: () => this.say('速報です！ 怪獣の首が、すべて沈黙した模様です！') },
      { t: 4.2, fn: () => this.say('あっ、崩れ落ちていきます！') },
      { t: 7.0, fn: () => { this.say('沈んでいきます！ 怪獣が、海の底へ沈んでいきます！'); this.overlay.setTitle('速報', '怪獣 海へ沈む'); } },
      { t: 11.8, fn: () => { this.say('やりました！ 街は、街は守られました！'); this.overlay.setTitle('速報', '自衛隊が怪獣を撃退　街は守られた'); } },
    ];
    this.ei = 0;
  }

  // ---------------------------------------------------------------- 上陸された時
  startDefeat() {
    this.reset('defeat');
    this.orbitA = Math.PI * 0.75;
    this.events = [
      { t: 0.2, fn: () => this.cut('cam', () => { this.overlay.show(true); this.overlay.frameOn(true); this.overlay.setTitle('速報', '怪獣が上陸　沿岸部に甚大な被害'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.16); this.battle.hud?.show(false); }) },
      { t: 0.7, fn: () => this.say('怪獣が、ついに上陸しました…！ 繰り返します、怪獣が上陸しました！') },
      { t: 5.0, fn: () => this.say('沿岸部の皆さんは、一刻も早く避難してください！') },
    ];
    this.ei = 0;
  }

  say(text) {
    this.overlay.setTelop(`「${text}」`);
    this.voice.say(text);
    this.telopUntil = this.t + Math.max(3.2, text.length * 0.16);
  }

  setShot(kind) { this.shot = kind; this.shotT = 0; this.zoomT = 0; }

  /** 画面の切り替え（雑音を挟む）。切り替えは中継の時計で 0.14 秒後 */
  cut(kind, then) {
    this.overlay.flashStatic(0.28, this.t);
    this.audio?.tvStatic(0.28);
    this.battle.world.pipe.post.uGlitch.value = 1;
    this.pendingCut = { at: this.t + 0.14, kind, then };
  }

  glitch(dur) { this.glitchUntil = this.t + dur; this.audio?.tvStatic(dur * 0.6); }

  skip() {
    if (this.active !== 'intro') return;
    this.voice.stop();
    this.cut(null, () => this.finish());
  }

  /** 中継を終えてゲームの画面に戻る */
  finish(silent = false) {
    this.voice.stop();
    this.active = null;
    this.shot = null;
    this.pendingCut = null;
    this.overlay.staticEl.classList.remove('on');
    this.overlay.staticUntil = 0;
    this.overlay.show(false);
    this.overlay.frameOn(false);
    this.overlay.setTelop('');
    this.overlay.setCaption('');
    const post = this.battle.world.pipe.post;
    post.uTV.value = 0;
    post.uGlitch.value = 0;
    if (!silent) { this.audio?.setTV(false); this.audio?.setHeli(0.03); }
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    this.heli.update(dt);
    const b = this.battle, k = b.kaiju, post = b.world.pipe.post;
    if (!this.active) {
      this.flyAmbient(dt);
      return;
    }
    this.t += dt;
    while (this.ei < this.events.length && this.t >= this.events[this.ei].t) this.events[this.ei++].fn();
    if (this.pendingCut && this.t >= this.pendingCut.at) {
      const c = this.pendingCut;
      this.pendingCut = null;
      if (c.kind) this.setShot(c.kind);
      c.then && c.then();
      if (!this.active) return;
    }
    if (this.telopUntil && this.t > this.telopUntil) { this.overlay.setTelop(''); this.telopUntil = 0; }
    this.overlay.update(this.t);
    // 映像の質感
    const onCam = this.shot === 'cam';
    post.uTV.value = damp(post.uTV.value, onCam ? 1 : 0.25, 8, dt);
    const g = this.glitchUntil && this.t < this.glitchUntil ? 0.6 + Math.random() * 0.4 : 0;
    post.uGlitch.value = Math.max(g, post.uGlitch.value - dt * 5);
    this.shotT = (this.shotT || 0) + dt;
    if (this.active === 'intro') this.updateIntro(dt, k);
    else this.updateOrbitShot(dt, k);
  }

  /** 登場シーンの撮り方 */
  updateIntro(dt, k) {
    const t = this.t, E = KAIJU_INTRO.emergeAt;
    // ヘリは怪獣の周りを、遠くから近づきながら回る
    this.introR = damp(this.introR, t < E ? 1300 : 950, 0.25, dt);
    this.orbitA += dt * (t < E ? 0.03 : 0.045);
    const a = this.orbitA, R = this.introR;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, 230 - Math.min(1, t / 12) * 40, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.12); // 円の接線方向へ飛ぶ（カメラ球は怪獣の方へ向く）
    const c = this.cam;
    if (this.shot === 'ext') {
      // ヘリの横（少し前・下）から撮る外の映像
      const fw = new THREE.Vector3(Math.sin(this.heli.yaw), 0, Math.cos(this.heli.yaw));
      const right = new THREE.Vector3(fw.z, 0, -fw.x);
      const base = this.heli.pos.clone();
      c.pos.copy(base).addScaledVector(fw, 34 - t * 4).addScaledVector(right, -26).add(new THREE.Vector3(0, -7 + t * 1.5, 0));
      c.look.copy(base).addScaledVector(fw, 4);
      c.fov = 40;
      this.applyCam(c.pos, c.look, c.fov, dt, 0.25);
      return;
    }
    // 機首のカメラ（望遠）
    this.heli.cameraPoint(c.pos);
    let target, fov;
    if (t < E + 0.8) { target = _v2.set(k.pos.x, 4, k.pos.z); fov = 16 + Math.sin(t * 0.4) * 1.2; }
    else if (t < E + 3.4) { target = _v2.set(k.pos.x, Math.max(20, k.focus.y - 30), k.pos.z); fov = 22 + (t - E - 0.8) * 3.2; }
    else if (t < E + 7.2) { target = _v2.copy(k.headSpheres.C.c); fov = 30 - Math.min(1, (t - E - 3.4) / 2.5) * 16; }
    else {
      // 最後は到着した艦隊（自分の機体）を映す
      const p = this.battle.player;
      const u = smoothstep(E + 7.2, E + 9.0, t);
      target = _v2.copy(k.focus).lerp(p ? p.position : k.focus, u * 0.85);
      fov = 14 + u * 14;
    }
    this.applyCam(c.pos, target, fov, dt, 1);
  }

  /** 倒した時・上陸された時: ヘリが怪獣の周りを回りながら望遠で追う */
  updateOrbitShot(dt, k) {
    const ending = this.active === 'ending';
    this.orbitA += dt * 0.035;
    const R = ending ? 820 : 1100, H = ending ? 170 : 240;
    const a = this.orbitA;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, H, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.1);
    if (!this.shot) return;
    const c = this.cam;
    this.heli.cameraPoint(c.pos);
    const target = _v2.set(k.pos.x, clamp(k.focus.y - 10, 8, 140), k.pos.z);
    const fov = ending ? 24 - smoothstep(0, 12, this.t) * 8 : 26;
    this.applyCam(c.pos, target, fov, dt, 1);
  }

  /** カメラに反映（ヘリの揺れ・カメラマンの手ぶれ風の遅れ） */
  applyCam(pos, target, fov, dt, wob) {
    this.smoothLook.lerp(target, 1 - Math.exp(-dt * 2.6));
    if (this.smoothLook.lengthSq() < 1) this.smoothLook.copy(target);
    const t = this.t;
    // ヘリの振動（ローターの細かい揺れ）と、ゆっくりした漂い
    this.wob.set(Math.sin(t * 1.3) * 2.2 + Math.sin(t * 3.1) * 0.6, Math.sin(t * 0.9 + 1) * 1.6 + Math.sin(t * 19) * 0.15, Math.cos(t * 1.1) * 2.0);
    // カメラ球から撮影方向へ少し出した位置にする（自分のヘリのそりや胴体が映り込まないように）
    this.cam.pos.copy(pos).addScaledVector(_v.subVectors(this.smoothLook, pos).normalize(), 14);
    this.cam.look.copy(this.smoothLook).addScaledVector(this.wob, wob * Math.max(0.5, fov / 20));
    this.cam.fov = fov;
  }

  /** 中継以外の時: ヘリは遠くで旋回しながら様子を撮っている */
  flyAmbient(dt) {
    const k = this.battle.kaiju;
    if (!k) return;
    this.orbitA += dt * 0.02;
    const a = this.orbitA, R = 2300;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, 380, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.12);
  }

  dispose() {
    this.voice.stop();
    this.heli.dispose();
    this.overlay.remove();
    const post = this.world.pipe.post;
    post.uTV.value = 0;
    post.uGlitch.value = 0;
  }
}
return { STATION, NewsHeli, Broadcast };
})();

// ==== src/game/battle.js
__mod["src/game/battle.js"] = (function () {
// 戦闘の進行（出撃 → 戦闘 → 決着）と、各種イベントの配線
const THREE = __DEPS["three"];
const { DIFFICULTY, MODES, WORLD, CPU, KAIJU, CARRIER, ATTACKS } = __mod["src/config.js"];
const { assets } = __mod["src/core/assets.js"];
const { Kaiju, MELEE_ALT } = __mod["src/game/kaiju.js"];
const { HEAD_INFO, HEAD_KEYS } = __mod["src/game/kaijuModel.js"];
const { Destroyer, Fighter, Carrier } = __mod["src/game/vehicles.js"];
const { Projectiles } = __mod["src/game/weapons.js"];
const { HumanController } = __mod["src/game/input.js"];
const { ShipAI, FighterAI } = __mod["src/game/ai.js"];
const { CameraRig } = __mod["src/game/camera.js"];
const { Broadcast } = __mod["src/game/broadcast.js"];
const { vehicleName } = __mod["src/net/net.js"];
const { rand, clamp, DEG } = __mod["src/core/util.js"];

const CAUSE_TEXT = {
  beam: 'ビームの直撃', bolt: '蒼の連射ビーム', column: '水柱', tail: 'しっぽの薙ぎ払い', claw: '爪の薙ぎ払い',
  converge: '収束ビーム', ram: '怪獣に衝突', crash: '怪獣に激突', sea: '海面に墜落', mega: '極太ビーム', gone: '通信が切れた',
};

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * 出撃の配置（空母・CPU・プレイヤー）。マルチプレイではホストが作って全員に配り、同じ配置で始める。
 * players: [{ id, name, vehicle }]
 */
function makeSpawnPlan(settings, players) {
  const diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
  const plan = { carrier: { id: 'carrier', pos: [900, 0, CARRIER.standOff + 150], heading: Math.PI }, players: [], cpu: [] };
  let si = 0, fi = 0;
  for (const p of players) {
    if (p.vehicle === 'destroyer') plan.players.push({ ...p, pos: [-220 + si * 230, 0, 1500 + si * 90], heading: Math.PI, hullNo: String(185 + si * 2) }), si++;
    else plan.players.push({ ...p, pos: [240 + fi * 150, 380 + fi * 25, 1950 + fi * 60], heading: Math.PI }), fi++;
  }
  const n = settings.cpuCount || 0;
  const humanFighters = players.filter((p) => p.vehicle !== 'destroyer').length;
  let nf, ns;
  if (settings.cpuMix && settings.cpuMix.manual) { nf = clamp(settings.cpuMix.fighters, 0, n); ns = n - nf; }
  else { nf = Math.round(n * (humanFighters >= players.length / 2 ? 0.5 : 0.65)); ns = n - nf; }
  const skill = diff.cpuSkill;
  for (let i = 0; i < ns; i++) {
    const slot = ns === 1 ? 0.6 : -1.15 + (2.3 * i) / Math.max(1, ns - 1);
    const r = rand(1300, 1800);
    const pos = [r1(Math.sin(slot) * r), 0, r1(Math.cos(slot) * r)];
    const nm = CPU.shipNames[i % CPU.shipNames.length];
    plan.cpu.push({ id: `c${i}`, kind: 'ship', name: `護衛艦 ${nm}`, callsign: nm, hullNo: String(171 + i * 3), pos, heading: Math.atan2(-pos[0], -pos[2]), skill: skill * rand(0.85, 1.1), slot: slot + rand(-0.12, 0.12) });
  }
  const zeroMix = players.some((p) => p.vehicle === 'zero');
  for (let i = 0; i < nf; i++) {
    const a = (i / Math.max(1, nf)) * Math.PI * 2;
    const nm = CPU.callsignsFighter[i % CPU.callsignsFighter.length];
    plan.cpu.push({ id: `c${ns + i}`, kind: 'fighter', type: zeroMix && i % 2 === 0 ? 'zero' : 'f15', name: nm, callsign: nm, pos: [r1(900 + Math.cos(a) * 450), r1(rand(320, 560)), r1(2500 + Math.sin(a) * 450)], heading: Math.PI + rand(-0.3, 0.3), skill: skill * rand(0.85, 1.1), slot: i });
  }
  return plan;
}

class Battle {
  constructor(app, settings) {
    this.app = app;
    this.world = app.world;
    this.camera = this.world.camera;
    this.devices = app.devices;
    this.hud = app.hud;
    this.audio = app.audio;
    this.settings = settings;
    this.net = settings.net || null; // マルチプレイの通信（ひとり用は null）
    this.diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    this.mode = MODES[settings.mode] || MODES.real;
    this.allyCount = settings.cpuCount || 0;
    this.humanCount = this.net ? Math.max(1, this.net.players.length) : 1;
    this.playerAggro = this.net ? 1.0 : 1.15;
    this.time = 0;
    this.state = 'intro';
    this.vehicles = [];
    this.hazards = [];
    this.stats = { damage: 0, playerDamage: 0, flinches: 0, playerFlinches: 0, headsKilled: 0, alliesLost: 0, playerDeaths: 0, shots: 0, hits: 0, startTime: 0, endTime: 0 };
    this.projectiles = new Projectiles(this);
    this.kaiju = new Kaiju(this, assets.gltf.kaiju, assets.tex.kaijuGlow);
    this.rig = new CameraRig(this);
    this.human = new HumanController(this.devices, this);
    this.rescueTarget = null;
    this.plan = settings.plan || makeSpawnPlan(settings, [{ id: 'host', name: '', vehicle: settings.vehicle, solo: true }]);
    this.spawn(this.plan);
    this.net?.attach(this);
    this.hud?.attach(this);
    this.audio?.startBattle(this);
    this.world.shadowFocus.copy(this.kaiju.pos);
    this.world.shadowExtent = 330 * KAIJU.scale;
    // テレビの報道ヘリからの生中継で始まる
    this.broadcast = new Broadcast(this);
    this.broadcast.startIntro();
  }

  get isFighter() { return this.player ? this.player.kind === 'fighter' : this.settings.vehicle !== 'destroyer'; }
  get myId() { return this.net ? this.net.myId : 'host'; }
  get isHostOrSolo() { return !this.net || this.net.isHost; }

  /** 配置どおりに機体を置く。自分の端末で動かす機体（自分・ホストなら CPU と空母）とそれ以外（通信で届いた位置に置くだけ）を分ける */
  spawn(plan) {
    const hostSide = this.isHostOrSolo;
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const c = plan.carrier;
    this.carrier = new Carrier(this, { id: c.id, name: '空母 あまつかぜ', position: V3(c.pos), heading: c.heading, offset: 900, local: hostSide });
    this.vehicles.push(this.carrier);
    for (const p of plan.players) this.vehicles.push(this.createPlayerVehicle(p, V3(p.pos), p.heading));
    this.player = this.vehicleById(this.myId);
    for (const e of plan.cpu) {
      const pos = V3(e.pos);
      if (e.kind === 'ship') {
        const ai = hostSide ? new ShipAI(this, e.skill, e.slot) : null;
        this.vehicles.push(new Destroyer(this, { id: e.id, name: e.name, callsign: e.callsign, hullNo: e.hullNo, position: pos, heading: e.heading, controller: ai, speed: 9, local: hostSide }));
      } else {
        const ai = hostSide ? new FighterAI(this, e.skill, e.slot) : null;
        this.vehicles.push(new Fighter(this, { id: e.id, name: e.name, callsign: e.callsign, type: e.type, position: pos, heading: e.heading, controller: ai, local: hostSide }));
      }
    }
  }

  /** プレイヤーの機体（マルチプレイでは入力した名前が機体の名前になる） */
  createPlayerVehicle(p, pos, heading, atCarrier = false) {
    const mine = p.id === this.myId;
    const solo = !this.net;
    const opts = { id: p.id, position: pos, heading, controller: mine ? this.human : null, isPlayer: mine, human: true, local: mine };
    if (p.vehicle === 'destroyer') {
      const nm = solo ? 'やまなみ' : vehicleName(p.name, 'destroyer');
      return new Destroyer(this, { ...opts, name: solo ? '護衛艦 やまなみ' : nm, callsign: nm, hullNo: p.hullNo || '185', speed: 10 });
    }
    const nm = solo ? 'イーグル1' : vehicleName(p.name, p.vehicle);
    return new Fighter(this, { ...opts, name: nm, callsign: nm, type: p.vehicle === 'zero' ? 'zero' : 'f15', pitch: atCarrier ? 0.12 : 0 });
  }

  /** 練習モードの再出撃（空母のそば） */
  makePlayer(atCarrier = false) {
    const p = this.plan.players.find((x) => x.id === this.myId) || this.plan.players[0];
    let pos = new THREE.Vector3(...p.pos), heading = p.heading;
    if (atCarrier && this.carrier.alive) {
      if (p.vehicle === 'destroyer') pos = this.carrier.position.clone().add(new THREE.Vector3(-260, 0, -120));
      else { const sp = this.carrier.deckSpawn(); pos = sp.position; heading = sp.heading; }
    }
    const v = this.createPlayerVehicle(p, pos, heading, atCarrier);
    this.vehicles.push(v);
    return v;
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    this.time += dt;
    this.kaiju.update(dt);
    for (const v of this.vehicles) v.update(dt);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.removed) {
        // 再出撃などで消える機体の戦果は、結果画面のために持ち越す
        if (v.human && v.stats) { const base = String(v.id).replace(/-old$/, ''); (this.netDamageCarry ||= {})[base] = (this.netDamageCarry[base] || 0) + v.stats.damage; v.stats.damage = 0; }
        v.dispose();
        this.vehicles.splice(i, 1);
      }
    }
    this.updateResupply(dt);
    this.projectiles.update(dt);
    this.hazards = this.hazards.filter((h) => h.until > this.time);
    this.updatePlayerState(dt);
    this.updateArena(dt);
    this.broadcast.update(dt);
    this.rig.update(dt);
    const post = this.world.pipe.post;
    if (post.uFlash.value > 0) post.uFlash.value = Math.max(0, post.uFlash.value - dt * 1.6);
    this.world.warnCenter.copy(this.kaiju.pos);
    this.world.shadowFocus.copy(this.kaiju.pos);
    this.hud?.update(dt);
    this.audio?.update(dt, this);
    this.net?.update(dt);
  }

  updateResupply(dt) {
    const c = this.carrier;
    if (!c || !c.alive) return;
    for (const v of this.vehicles) {
      if (!v.alive || v === c || !v.resupply) continue;
      if (v.position.distanceTo(c.position) < CARRIER.resupplyRadius + (v.kind === 'fighter' ? 150 : 0)) {
        if (v.resupply(dt) && v.isPlayer) this.hud?.toast('補給中…', 'ok');
      }
    }
  }

  arenaCheck(p) {
    const k = this.kaiju;
    const d = Math.hypot(p.x - k.pos.x, p.z - k.pos.z);
    let over = Math.max(0, d - WORLD.arenaRadius) / 500;
    if (p.z > WORLD.cityDistance - 120) over = Math.max(over, (p.z - (WORLD.cityDistance - 120)) / 200);
    return over;
  }

  updateArena(dt) {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'battle') return;
    const o = this.arenaCheck(p.position);
    if (o > 0) {
      this.hud?.warnArena(true);
      const k = this.kaiju;
      if (p.kind === 'ship') {
        const want = Math.atan2(k.pos.x - p.position.x, k.pos.z - p.position.z);
        p.heading += Math.sign(((want - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 4 * DEG * dt * Math.min(1, o);
      } else {
        p.yaw += 0.4 * dt * Math.min(1, o) * Math.sign(Math.sin(Math.atan2(k.pos.x - p.position.x, k.pos.z - p.position.z) - p.yaw));
      }
    } else this.hud?.warnArena(false);
  }

  updatePlayerState(dt) {
    const p = this.player;
    if (!p || p.alive) return;
    this.deadT = (this.deadT || 0) + dt;
    if (this.state !== 'battle') return;
    if (this.mode.respawn) {
      // 練習モード: 味方が近づくと復活。誰もいなければ一定時間で空母から再出撃
      this.rescueTarget = p;
      let rescued = this.deadT > (this.allyCount > 0 ? 16 : 7);
      for (const v of this.vehicles) {
        if (v === p || !v.alive || v.kind === 'carrier') continue;
        const d = v.position.distanceTo(p.position);
        if (d < (v.kind === 'fighter' ? 420 : 380)) { rescued = true; this.hud?.radio(v.callsign, '救助完了、再出撃せよ！'); break; }
      }
      this.hud?.setRespawn(Math.max(0, (this.allyCount > 0 ? 16 : 7) - this.deadT));
      if (rescued && this.deadT > 2.5) this.respawnPlayer();
    } else if (this.net) {
      // マルチプレイのリアルモード: やられたら仲間を観戦（全員やられたらホストが負けを決める）
      if (this.deadT > 3.5 && (!this.rig.spectate || !this.rig.spectate.alive)) {
        const next = this.vehicles.find((v) => v.alive && v.human && v !== p) || this.vehicles.find((v) => v.alive && v.kind !== 'carrier');
        this.rig.spectate = next || null;
        if (next) this.hud?.toast(`観戦中: ${next.name}`, '');
      }
    } else if (this.deadT > 4.5) {
      this.endBattle('defeat', 'player');
    }
  }

  respawnPlayer() {
    const old = this.player;
    old.removed = true;
    this.rescueTarget = null;
    this.deadT = 0;
    this.player = this.makePlayer(true);
    this.rig.spectate = null;
    this.hud?.setRespawn(null);
    this.hud?.toast('再出撃！', 'ok');
    this.audio?.ui('respawn');
    const p = this.player;
    this.net?.vehicleEvent({ e: 'respawn', id: p.id, pos: [r1(p.position.x), r1(p.position.y), r1(p.position.z)], heading: p.heading });
  }

  // ---------------------------------------------------------------- マルチプレイ（受信）
  /** 他の端末の機体の状態 */
  onNetStates(list) {
    const now = performance.now() / 1000;
    for (const st of list) {
      const v = this.vehicleById(st.id);
      if (v && !v.local && v.alive) v.pushNet(st, now);
    }
  }

  /** 他の端末で起きた機体の出来事 */
  onNetVehicleEvent(ev) {
    const v = this.vehicleById(ev.id);
    switch (ev.e) {
      case 'vdead':
        if (v && !v.local) this.onVehicleKilled(v, ev.cause, ev.by);
        break;
      case 'chit':
        if (v && !v.local && v.kind === 'carrier' && v.alive) {
          v.hitsLeft = ev.left;
          v.onHit(ev.cause);
          this.audio?.explosion(v.position, 1.6);
          this.hud?.radio('空母 あまつかぜ', v.hitsLeft === 2 ? '被弾！ 火災発生、まだ持ちこたえる！' : '大破！ 次は耐えられない！', 'bad');
        }
        break;
      case 'fire':
        if (v && !v.local) this.spawnRemoteShot(v, ev);
        break;
      case 'respawn': {
        if (v && v.local) break;
        if (v) { v.removed = true; v.id = `${v.id}-old`; }
        const p = this.plan.players.find((x) => x.id === ev.id);
        if (!p) break;
        const nv = this.createPlayerVehicle(p, new THREE.Vector3(ev.pos[0], ev.pos[1], ev.pos[2]), ev.heading);
        this.vehicles.push(nv);
        this.hud?.buildAllies();
        break;
      }
      case 'gone':
        if (v && v.alive) { v.alive = false; v.removed = true; this.hud?.radio('司令部', `${v.name}、通信が途絶えた`, 'bad'); }
        break;
      default: break;
    }
  }

  /** 他の端末の弾（見た目だけ。ダメージはその端末が判定してホストへ送る） */
  spawnRemoteShot(v, ev) {
    const P = this.projectiles;
    const V3 = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
    const o = V3(ev.o), d = V3(ev.d);
    if (ev.k === 'shell') { P.shell(o, d, v, { damage: 0, flinch: 0 }, true); this.world.effects.muzzleFlash(o, d.clone().normalize(), 1.5); this.audio?.fire('gun', o, false); }
    else if (ev.k === 'torp') P.torpedo(o, d, v, { speed: ev.s, range: ev.r, damage: 0, flinch: 0 }, V3(ev.out), V3(ev.sv), true);
    else if (ev.k === 'msl') P.missile(o, d, ev.s, v, { speed: ev.ms, turn: ev.tu, damage: 0, flinch: 0 }, ev.tk || null, true);
    else if (ev.k === 'rkt') P.rocket(o, d, ev.s, v, { speed: ev.ms, damage: 0, flinch: 0 }, true);
    else if (ev.k === 'bomb') P.bomb(o, d, v, { damage: 0, flinch: 0, blast: 0 }, true);
  }

  /** 自分の端末の機体が撃った弾を他の端末へ知らせる */
  netFire(v, k, data) {
    if (!this.net || !v.local) return;
    const a = (p) => (p ? [r1(p.x), r1(p.y), r1(p.z)] : null);
    const ev = { e: 'fire', id: v.id, k };
    for (const [key, val] of Object.entries(data)) ev[key] = val && val.isVector3 ? a(val) : val;
    this.net.vehicleEvent(ev);
  }

  /** ホスト: 参加者の弾が怪獣に当たった */
  onNetDamage(m) {
    const k = this.kaiju;
    if (!k || k.dead) return;
    // 届いた値はそのまま信用しない（ありえない大きさのダメージや不正な頭の名前は丸める）
    const amount = clamp(Number(m.a) || 0, 0, 1500);
    const head = ['R', 'C', 'L'].includes(m.h) ? m.h : null;
    k.damage(amount, { head, flinch: clamp(Number(m.f) || 1, 0, 5), kind: String(m.k || '').slice(0, 10), part: String(m.p || '').slice(0, 10), owner: this.vehicleById(m.by) });
  }

  /** 参加者: ホストが決着を知らせてきた */
  onNetEnd(m) {
    this.netScoreList = m.scores;
    this.endBattle(m.result, m.reason);
  }

  /** ホスト: 誰かがルームから抜けた */
  onNetPlayerLeft(id) {
    const v = this.vehicleById(id);
    if (v && v.alive) {
      v.alive = false;
      v.removed = true;
      this.hud?.radio('司令部', `${v.name}、通信が途絶えた`, 'bad');
      this.net?.vehicleEvent({ e: 'gone', id });
    }
    this.checkAllHumansDown();
  }

  /** 結果画面のプレイヤー一覧（与えたダメージ順） */
  netScores() {
    const list = [];
    for (const p of this.plan.players) {
      const vs = this.vehicles.filter((v) => v.id === p.id || v.id.startsWith(`${p.id}-`));
      const dmg = vs.reduce((s, v) => s + (v.stats ? v.stats.damage : 0), 0) + (this.netDamageCarry?.[p.id] || 0);
      list.push({ name: vehicleName(p.name, p.vehicle), damage: Math.round(dmg), vehicle: p.vehicle });
    }
    return list.sort((a, b) => b.damage - a.damage);
  }

  /** ホスト（リアルモード）: 人が操作する機体が全部やられたら負け */
  checkAllHumansDown() {
    if (!this.net || !this.net.isHost || this.mode.respawn || this.state !== 'battle') return;
    const anyHuman = this.vehicles.some((v) => v.human && v.alive);
    if (!anyHuman) setTimeout(() => this.endBattle('defeat', 'player'), 3500);
  }

  vehicleById(id) {
    if (id === null || id === undefined) return null;
    for (const v of this.vehicles) if (v.id === id) return v;
    return null;
  }

  /** 怪獣へのダメージはここを通す（マルチプレイの参加者はホストへ送る） */
  kaijuDamage(amount, opts) {
    const k = this.kaiju;
    if (!k || k.dead) return 0;
    if (this.net && !this.net.isHost) {
      if (k.phase === 'intro') return 0;
      this.net.sendDamage(amount, opts);
      k.model.flash(Math.min(0.5, 0.1 + amount / 500));
      const est = amount * (k.mega && k.mega.state === 'charge' ? ATTACKS.mega.vuln : 1);
      if (k.mega && k.mega.state === 'charge') k.mega.got += est; // ゲージは先に動かしておく（正しい値はホストから届く）
      this.onKaijuDamaged(est, opts);
      return est;
    }
    return k.damage(amount, opts);
  }

  killVehicle(v, cause, by, opts = null) {
    if (!v.alive || this.state === 'intro') return;
    if (v.isPlayer && this.debugGod) return;
    if (!v.local) return; // 他の端末の機体は、その端末が判定する
    if (v.kind === 'carrier' && v.hitsLeft > 1 && !(opts && opts.force)) {
      if (this.time < (v.invulnUntil || 0)) return;
      v.hitsLeft--;
      v.invulnUntil = this.time + 3;
      v.onHit(cause);
      this.audio?.explosion(v.position, 1.6);
      this.shakeAt(v.position, 0.8);
      this.hud?.radio('空母 あまつかぜ', v.hitsLeft === 2 ? '被弾！ 火災発生、まだ持ちこたえる！' : '大破！ 次は耐えられない！', 'bad');
      this.net?.vehicleEvent({ e: 'chit', id: v.id, left: v.hitsLeft, cause });
      return;
    }
    this.net?.vehicleEvent({ e: 'vdead', id: v.id, cause, by });
    this.onVehicleKilled(v, cause, by);
  }

  /** 機体がやられた（自分の端末で判定した時も、他の端末から届いた時もここ） */
  onVehicleKilled(v, cause, by) {
    if (!v.alive) return;
    v.kill(cause);
    const text = CAUSE_TEXT[cause] || '撃破';
    this.audio?.explosion(v.position, v.kind === 'fighter' ? 0.6 : 1.4);
    this.shakeAt(v.position, v.kind === 'fighter' ? 0.4 : 1.0);
    if (v.isPlayer) {
      this.stats.playerDeaths++;
      this.hud?.playerDown(text, this.mode.respawn);
      this.deadT = 0;
    } else if (v.kind === 'carrier') {
      this.hud?.killBanner(v, `${text}　補給と再出撃ができなくなった`);
      this.hud?.radio('司令部', '空母あまつかぜ、轟沈…！', 'bad');
      this.audio?.allyLost(true);
    } else {
      this.stats.alliesLost++;
      const msg = v.kind === 'fighter' ? `${v.callsign}、撃墜された！` : `${v.callsign}、轟沈！`;
      this.hud?.radio('司令部', msg, 'bad');
      this.hud?.allyLost(v);
      this.hud?.killBanner(v, text, { mine: !!v.human });
      this.audio?.allyLost(false);
    }
    if (v.human) this.checkAllHumansDown();
  }

  /** 船の端をかすめた（轟沈はしない） */
  onNearMiss(v, point, key) {
    const fx = this.world.effects;
    // 艦の中心線上で一番近い点に爆発を出す
    const f = v.forward;
    const rel = new THREE.Vector3(point.x - v.position.x, 0, point.z - v.position.z);
    const along = THREE.MathUtils.clamp(rel.dot(f), -v.length * 0.45, v.length * 0.45);
    const hp = v.position.clone().addScaledVector(f, along);
    hp.y = Math.max(v.position.y, 0) + 8;
    fx.explosion(hp, 1.6);
    fx.sparks(hp, new THREE.Vector3(0, 1, 0), 14);
    this.audio?.explosion(hp, 1.0);
    this.shakeAt(hp, 0.9);
    if (v.isPlayer) {
      this.hud?.toast(along > 0 ? '艦首をかすめた！ 危なかった…' : '艦尾をかすめた！ 危なかった…', 'good');
      this.world.pipe.post.uFlash.value = 0.25;
      setTimeout(() => { this.world.pipe.post.uFlash.value = 0; }, 90);
    }
  }

  shakeAt(pos, strength) {
    const d = pos.distanceTo(this.camera.position);
    const k = strength * clamp(1 - d / 3200, 0, 1);
    if (k > 0.02) this.rig.shake(k);
  }

  endBattle(result, reason) {
    if (this.state === 'victory' || this.state === 'defeat') return;
    this.state = result;
    this.stats.endTime = this.time;
    this.result = { result, reason };
    this.audio?.music(result);
    this.net?.endBattle(result, reason);
    const wait = result === 'victory' ? 2500 : reason === 'city' ? 8500 : 3500;
    setTimeout(() => this.app.showResult(this), wait);
  }

  // ---------------------------------------------------------------- イベント
  addHazard(h) { this.hazards.push(h); }

  onTelegraph(atk, kind) {
    const now = this.time;
    if (kind === 'bolts') {
      this.addHazard({ type: 'target', target: atk.target, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration });
    } else if (kind === 'sweep') {
      this.addHazard({ type: 'line', a: atk.A, b: atk.B, width: atk.radius * 2, air: atk.air, y: atk.A.y, altMax: atk.air ? 9999 : 60, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration });
    } else if (kind === 'trace') {
      this.addHazard({ type: 'line', a: atk.S, b: atk.E, width: atk.radius * 2 + 30, air: false, altMax: 160, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration + 1.0 });
    } else if (kind === 'tail' || kind === 'claw') {
      this.addHazard({ type: 'sector', c: this.kaiju.pos.clone(), dir: atk.dirAngle, arc: (atk.arc * Math.PI) / 180, inner: atk.inner, outer: atk.outer, altMax: MELEE_ALT, strike: now + atk.telegraph, until: now + atk.telegraph + 0.4 });
    } else if (kind === 'converge') {
      this.addHazard({ type: 'circle', c: atk.center, r: atk.radius, altMax: 260, strike: now + atk.telegraph, until: now + atk.telegraph + 1.0 });
    }
    const targetIsPlayer = atk.target === this.player;
    const origin = kind === 'tail' || kind === 'claw' ? this.kaiju.pos : (atk.head ? this.kaiju.headSpheres[atk.head.key].c : this.kaiju.pos);
    this.hud?.telegraph(kind, atk, targetIsPlayer, origin);
    this.audio?.telegraph(kind, targetIsPlayer, origin, atk.head ? atk.head.key : null);
    if (this.player && this.player.alive && (targetIsPlayer || kind === 'converge' || kind === 'tail' || kind === 'claw')) this.world.pipe.post.uDanger.value = 0.6;
  }

  onBeamFire(atk, kind) {
    const key = atk.head ? atk.head.key : 'all';
    this.audio?.beam(kind, key, this.kaiju.pos);
    this.shakeAt(this.kaiju.pos, 0.5);
  }

  onFlinch(key, owner) {
    this.stats.flinches++;
    if (owner && owner.isPlayer) { this.stats.playerFlinches++; this.hud?.toast(`${HEAD_INFO[key].name}が怯んだ！ ナイス阻止！`, 'good'); }
    else this.hud?.toast(`${HEAD_INFO[key].name}が怯んだ！`, 'good');
    if (owner && !owner.isPlayer) this.hud?.radio(owner.callsign, `${HEAD_INFO[key].short}の首の溜めを止めた！`);
    this.audio?.kaijuPain(this.kaiju.pos);
  }

  onHeadKilled(key, owner) {
    this.stats.headsKilled++;
    const rest = this.kaiju.aliveHeads.length;
    this.hud?.bigMessage(`${HEAD_INFO[key].name} 撃破！`, rest ? `残り ${rest} 本。残った首が激しくなる` : 'すべての首を倒した', HEAD_INFO[key].css);
    this.hud?.radio('司令部', `${HEAD_INFO[key].name}の沈黙を確認！`, 'good');
    this.audio?.headKilled(this.kaiju.pos);
    this.shakeAt(this.kaiju.pos, 1.2);
  }

  onRage() {
    this.hud?.bigMessage('怒りフェーズ', '怪獣が赤く発光し、動きが速くなった', '#ff4a3a');
    this.hud?.radio('司令部', '目標の発光パターンが変化！ 警戒せよ！', 'bad');
    this.audio?.roar(this.kaiju.pos, 1.2);
    this.shakeAt(this.kaiju.pos, 1.5);
  }

  onKaijuDamaged(dealt, opts) {
    this.stats.damage += dealt;
    const o = opts.owner;
    if (o) {
      o.stats.damage += dealt;
      if (o.isPlayer) { this.stats.playerDamage += dealt; if (dealt > 0) this.hud?.hitMarker(opts.head, opts.kind, dealt); }
    }
  }

  onProjectileHit(o, hit, dealt, kind) { if (kind !== 'gun' && o.owner && o.owner.isPlayer) this.stats.hits++; }
  onFire(v, weapon, pos) {
    if (v.isPlayer) this.stats.shots++;
    this.audio?.fire(weapon, pos, v.isPlayer);
    if (v.isPlayer && weapon === 'torpedo') this.hud?.toast(`魚雷発射！ 残り ${v.torps} 本`, 'ok');
  }
  /** 機関砲を撃っている（毎フレーム） */
  onMG(v, pos) {
    if (v.isPlayer) this.audio?.gun(true, v.kind);
    else this.audio?.distantMG(pos);
  }
  onTorpedoEmpty(v) {
    if (!v.isPlayer || this.time - (this._torpEmptyT || -9) < 1.5) return;
    this._torpEmptyT = this.time;
    this.hud?.toast(this.carrier && this.carrier.alive ? '魚雷がない！ 空母の近くで補給できる' : '魚雷を撃ち尽くした', 'bad');
  }
  onTorpedoHit(o, p) {
    this.onBigExplosion(p, 0.8);
    if (o.owner && o.owner.isPlayer) this.hud?.toast('魚雷命中！', 'good');
  }
  onSplash(p) { this.audio?.splash(p, 0.4); }
  onExplosion(p, s) { this.audio?.explosion(p, s); this.shakeAt(p, s * 0.6); }
  onBigExplosion(p, s) { this.audio?.explosion(p, 2.5); this.shakeAt(p, 2.0 * (s ?? 1)); }
  onFootstep(p) { this.audio?.footstep(p); this.shakeAt(p, 0.45); }
  onRoar(intensity = 1.0) { this.audio?.roar(this.kaiju.pos, intensity); this.rig.shake(0.6 * intensity); }
  onKaijuPain(p, s = 1) { this.audio?.kaijuPain(this.kaiju.pos, s); this.shakeAt(p, 0.5); }
  onSnap(p, key) { this.audio?.snap(p); }
  onStompRaise() { this.audio?.roar(this.kaiju.pos, 0.45, 0.9); }
  onStomp(p) {
    this.audio?.stomp(p);
    this.shakeAt(p, 2.2);
    if (this.player && this.player.alive && p.distanceTo(this.player.position) < 1800) this.hud?.toast('怪獣が海面を踏み鳴らした！', '');
  }
  onKaijuLastRoar() { this.audio?.roar(this.kaiju.pos, 1.4, 0.78); this.rig.shake(1.0); }

  // ---- 極太ビーム（HP2割以下）
  onMegaStart(m) {
    const now = this.time;
    this.addHazard({ type: 'sector', c: this.kaiju.pos.clone(), dir: m.center, arc: (m.M.arc * Math.PI) / 180, inner: 150, outer: m.range, altMax: m.M.altMax, strike: now + m.telegraph, until: now + m.telegraph + m.duration, mega: true });
    this.hud?.bigMessage('極太ビーム', '10秒以内に撃ちまくって止めろ！ 紫の範囲の低空にいると巻き込まれる', '#e07cff');
    this.hud?.radio('司令部', '目標が膨大なエネルギーを集めている！ 全艦全機、総攻撃で阻止せよ！', 'bad');
    this.audio?.megaCharge(true);
    this.audio?.roar(this.kaiju.pos, 1.1, 0.7);
    this.world.pipe.post.uDanger.value = 1;
  }

  onMegaCharge(m, p) {
    this.hud?.setMega({ phase: 'charge', left: m.telegraph - m.t, progress: m.progress });
    this.audio?.megaChargeLevel(p);
    const post = this.world.pipe.post;
    post.uDanger.value = Math.max(post.uDanger.value, 0.35 + 0.4 * p);
  }

  onMegaFire(m) {
    this.hud?.setMega({ phase: 'fire', left: 0, progress: m.progress });
    this.audio?.megaCharge(false);
    this.audio?.megaFire(this.kaiju.pos);
    this.world.pipe.post.uFlash.value = 0.85;
    this.rig.shake(2.2);
    this.hud?.radio('司令部', '発射された…！ 被害を報告せよ！', 'bad');
  }

  onMegaEnd(m, stopped, cancelled = false) {
    this.audio?.megaCharge(false);
    this.hazards = this.hazards.filter((h) => !h.mega);
    if (cancelled) { this.hud?.setMega(null); return; }
    if (stopped) {
      this.hud?.setMega({ phase: 'stopped', left: 0, progress: 1 });
      this.hud?.bigMessage('阻止成功！', '怪獣が大きくよろめいた。今が攻撃のチャンス', '#7fe08a');
      this.hud?.radio('司令部', '発射を阻止した！ 目標は動けない、畳みかけろ！', 'good');
      this.audio?.kaijuPain(this.kaiju.pos, 0.9);
      this.stats.megaStopped = (this.stats.megaStopped || 0) + 1;
    } else this.hud?.chance('C');
    setTimeout(() => this.hud?.setMega(null), stopped ? 2200 : 1200);
  }

  onMegaCity(p) {
    this.cityDamaged = true;
    const fx = this.world.effects;
    for (let i = 0; i < 9; i++) {
      const q = new THREE.Vector3(p.x + rand(-700, 700), rand(10, 60), p.z + rand(0, 400));
      setTimeout(() => fx.explosion(q, rand(5, 8)), i * 120);
    }
    this.hud?.radio('司令部', '沿岸部に被害！ 街が燃えている…！', 'bad');
  }
  onBolt(p) { this.audio?.bolt(p); }
  onWaterColumn(p) { this.audio?.splash(p, 1.2); this.shakeAt(p, 0.25); }
  onMeleeStrike(m) { this.audio?.swipe(this.kaiju.pos); this.shakeAt(this.kaiju.pos, 1.0); }
  onHeadRecover(key) { this.hud?.chance(key); }

  onKaijuReady() {
    this.state = 'battle';
    this.stats.startTime = this.time;
    this.rig.setMode('play');
    this.hud?.show(true);
    this.hud?.bigMessage('迎撃開始', '3つの頭を狙え。溜め中の頭を撃てば怯む', '#e8edf2');
    this.hud?.radio('司令部', '全艦、全機、攻撃開始！ 街に近づけるな！');
    this.audio?.music('battle');
  }

  onKaijuDying() {
    this.hud?.bigMessage('撃破', '怪獣ヨモツ、海へ沈む', '#ffe08a');
    this.hud?.radio('司令部', '目標、崩れ落ちる…！ 全艦、警戒を維持せよ', 'good');
    this.audio?.roar(this.kaiju.pos, 0.8);
    this.audio?.music(null);
    this.endBattleSoon = true;
    this.broadcast.startEnding();
  }

  onKaijuDead() { this.endBattle('victory', 'kaiju'); }

  onCityReached() {
    this.hud?.bigMessage('街が…', '怪獣が上陸した', '#ff4a3a');
    this.broadcast.startDefeat();
    this.endBattle('defeat', 'city');
  }

  skipIntro(fromNet = false) {
    if (this.state !== 'intro') return;
    if (this.net && !this.net.isHost && !fromNet) { this.hud?.toast('登場シーンはホストが飛ばせます'); return; }
    this.kaiju.skipIntro();
    this.broadcast.skip();
    this.rig.pos.copy(this.camera.position);
    if (this.net && this.net.isHost) this.net.sendSkip();
  }

  dispose() {
    if (this.net && this.net.battle === this) this.net.detach();
    this.broadcast?.dispose();
    this.projectiles.dispose();
    for (const v of this.vehicles) v.dispose();
    this.vehicles = [];
    this.kaiju.dispose();
    this.world.telegraph.clear();
    this.hud?.detach();
    this.audio?.stopBattle();
  }
}
return { CAUSE_TEXT, makeSpawnPlan, Battle };
})();

// ==== src/ui/lobby.js
__mod["src/ui/lobby.js"] = (function () {
// マルチプレイのロビー: 名前と機体を決めて、ルームを作る（ホスト）か、ルーム名とパスワードを入れて入る
const { NetSession, netErrorText, vehicleName, MAX_PLAYERS } = __mod["src/net/net.js"];
const { makeSpawnPlan } = __mod["src/game/battle.js"];
const { DIFFICULTY, MODES, CPU } = __mod["src/config.js"];
const { loadSettings, saveSettings } = __mod["src/ui/menu.js"];

const VEH = [['f15', '戦闘機 F-15J'], ['destroyer', '護衛艦'], ['zero', '零式艦上戦闘機']];
const VEH_LABEL = Object.fromEntries(VEH);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function seg(name, options, value, disabled = false) {
  return `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}" ${disabled ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
}

class Lobby {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'lobby hidden interactive';
    root.appendChild(this.el);
    this.view = 'entry';
    this.tab = 'create';
    this.busy = false;
    this.status = '';
    this.session = null;
    const s = loadSettings();
    this.form = { name: s.playerName || '', vehicle: s.vehicle || 'f15', room: s.lastRoom || '', pass: '' };
  }

  open() {
    this.view = this.session ? 'room' : 'entry';
    this.status = '';
    this.render();
    this.el.classList.remove('hidden');
  }
  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }

  saveForm() {
    const s = loadSettings();
    s.playerName = this.form.name;
    s.vehicle = this.form.vehicle;
    s.lastRoom = this.form.room;
    saveSettings(s);
  }

  render() {
    if (this.view === 'room' && this.session) this.renderRoom();
    else this.renderEntry();
  }

  // ---------------------------------------------------------------- 入口
  renderEntry() {
    const f = this.form;
    const nm = f.name.trim() || '○○';
    this.el.innerHTML = `
      <div class="lobby-box">
        <h2>マルチプレイ</h2>
        <div class="lb-row"><label>あなたの名前</label>
          <input class="lb-name" maxlength="8" placeholder="例: たろう" value="${esc(f.name)}">
          <div class="lb-preview">この名前があなたの機体の名前になります: 船なら「<b class="pv-ship">${esc(vehicleName(nm, 'destroyer'))}</b>」／戦闘機なら「<b class="pv-plane">${esc(vehicleName(nm, 'f15'))}</b>」</div></div>
        <div class="lb-row"><label>機体</label>${seg('veh', VEH, f.vehicle)}</div>
        <div class="lb-tabs">${[['create', 'ルームを作る（ホスト）'], ['join', 'ルームに入る']].map(([k, l]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="lb-row"><label>ルーム名</label><input class="lb-room" maxlength="20" placeholder="${this.tab === 'create' ? '好きな名前（例: やまびこ部隊）' : 'ホストが決めたルーム名'}" value="${esc(f.room)}"></div>
        <div class="lb-row"><label>パスワード</label><input class="lb-pass" type="password" maxlength="20" placeholder="${this.tab === 'create' ? '参加する人に教える合言葉' : 'ホストから聞いた合言葉'}" value="${esc(f.pass)}"></div>
        <div class="lb-status ${this.statusKind || ''}">${esc(this.status)}</div>
        <div class="lb-actions">
          <button class="btn ghost lb-back">戻る</button>
          <button class="btn primary lb-go" ${this.busy ? 'disabled' : ''}>${this.busy ? '接続中…' : this.tab === 'create' ? 'ルームを作る' : 'ルームに入る'}</button>
        </div>
        <div class="lb-note">インターネット経由で、同じルーム名とパスワードを入れた人どうしがつながります（最大${MAX_PLAYERS}人）。ホストの端末で怪獣とCPUの仲間が動くので、いちばん性能の良い端末がホストになるのがおすすめです。</div>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    const name = q('.lb-name'), room = q('.lb-room'), pass = q('.lb-pass');
    name.addEventListener('input', () => {
      this.form.name = name.value;
      const n = name.value.trim() || '○○';
      q('.pv-ship').textContent = vehicleName(n, 'destroyer');
      q('.pv-plane').textContent = vehicleName(n, 'f15');
    });
    room.addEventListener('input', () => { this.form.room = room.value; });
    pass.addEventListener('input', () => { this.form.pass = pass.value; });
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.go(); });
    this.el.querySelectorAll('.seg[data-name="veh"] button').forEach((b) => b.addEventListener('click', () => { this.form.vehicle = b.dataset.v; this.click(); this.render(); }));
    this.el.querySelectorAll('.lb-tabs button').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.status = ''; this.click(); this.render(); }));
    q('.lb-back').addEventListener('click', () => { this.click(); this.hide(); this.app.menu?.show(true); });
    q('.lb-go').addEventListener('click', () => this.go());
  }

  click() { this.app.audio.ui('click'); }

  setStatus(text, kind = '') {
    this.status = text;
    this.statusKind = kind;
    const el = this.el.querySelector('.lb-status');
    if (el) { el.textContent = text; el.className = `lb-status ${kind}`; }
  }

  async go() {
    if (this.busy) return;
    const f = this.form;
    if (!f.name.trim()) return this.setStatus('名前を入れてください', 'bad');
    if (!f.room.trim()) return this.setStatus('ルーム名を入れてください', 'bad');
    this.app.audio.unlock();
    this.saveForm();
    this.busy = true;
    this.setStatus(this.tab === 'create' ? 'ルームを作っています…' : 'ルームを探しています…');
    this.render();
    const session = new NetSession(this.app);
    const me = { name: f.name.trim(), vehicle: f.vehicle };
    try {
      if (this.tab === 'create') {
        const s = loadSettings();
        await session.host(f.room, f.pass, me, { mode: s.mode, difficulty: s.difficulty, cpuCount: Math.min(s.cpuCount, 8), sky: s.sky });
      } else {
        await session.join(f.room, f.pass, me);
      }
    } catch (e) {
      session.leave();
      this.busy = false;
      this.setStatus(netErrorText(e.code || e.type || 'network'), 'bad');
      this.render();
      return;
    }
    this.busy = false;
    this.attachSession(session);
    this.view = 'room';
    this.status = '';
    this.render();
    this.app.audio.ui('start');
  }

  attachSession(session) {
    this.session = session;
    this.app.net = session;
    session.on('lobby', () => { if (this.view === 'room' && this.visible) this.render(); });
    session.on('joined', (p) => this.app.hud.toast(`${p.name} さんが入りました`, 'ok'));
    session.on('left', (p) => this.app.hud.toast(`${p.name} さんが抜けました`, 'bad'));
    session.on('start', (settings, plan) => this.app.startMultiBattle(session, settings, plan));
    session.on('hostLost', () => this.app.onHostLost());
    session.on('error', (text) => this.setStatus(text, 'bad'));
  }

  leave() {
    if (this.session) this.session.leave();
    this.session = null;
    this.app.net = null;
    this.view = 'entry';
    this.render();
  }

  // ---------------------------------------------------------------- ルームの中
  renderRoom() {
    const ss = this.session;
    const host = ss.isHost;
    const st = ss.settings || {};
    const me = ss.me;
    const rows = ss.players.map((p) => `
      <div class="lb-p ${p.id === ss.myId ? 'me' : ''}">
        ${p.host ? '<span class="lb-host">ホスト</span>' : '<span class="lb-guest">参加</span>'}
        <b>${esc(vehicleName(p.name, p.vehicle))}</b>
        <span class="lb-pv">${esc(p.name)} ／ ${VEH_LABEL[p.vehicle] || ''}</span>
      </div>`).join('');
    this.el.innerHTML = `
      <div class="lobby-box">
        <h2>ルーム「${esc(ss.room)}」</h2>
        <div class="lb-sub">${ss.players.length} / ${MAX_PLAYERS} 人　${host ? '仲間にルーム名とパスワードを伝えてください' : 'ホストの出撃を待っています…'}</div>
        <div class="lb-players">${rows}</div>
        <div class="lb-row"><label>自分の機体</label>${seg('veh', VEH, me ? me.vehicle : this.form.vehicle)}</div>
        <div class="lb-grid">
          <div><label>モード</label>${seg('mode', Object.entries(MODES).map(([k, m]) => [k, m.label]), st.mode, !host)}</div>
          <div><label>難易度</label>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), st.difficulty, !host)}</div>
          <div><label>時間帯</label>${seg('sky', [['day', '昼'], ['dusk', '夕暮れ'], ['night', '夜']], st.sky, !host)}</div>
          <div><label>CPUの仲間 <b class="lb-cpu-n">${st.cpuCount ?? 0}</b> 機</label><input type="range" class="lb-cpu" min="0" max="${Math.min(CPU.max, 8)}" value="${st.cpuCount ?? 0}" ${host ? '' : 'disabled'}></div>
        </div>
        <div class="lb-status ${this.statusKind || ''}">${esc(this.status)}</div>
        <div class="lb-actions">
          <button class="btn ghost lb-leave">ルームを出る</button>
          ${host ? '<button class="btn primary lb-start">出撃</button>' : '<button class="btn primary" disabled>ホストの出撃を待っています</button>'}
        </div>
        <div class="lb-note">マルチプレイ中は一時停止できません。リアルモードでは、やられたら仲間の戦いを観戦します（全員やられたら負け）。</div>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    this.el.querySelectorAll('.seg[data-name="veh"] button').forEach((b) => b.addEventListener('click', () => {
      this.form.vehicle = b.dataset.v; this.saveForm(); ss.pick(b.dataset.v); this.click();
      if (!host) { const m = ss.me; if (m) m.vehicle = b.dataset.v; this.render(); }
    }));
    if (host) {
      this.el.querySelectorAll('.lb-grid .seg').forEach((g) => g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        ss.setSettings({ ...ss.settings, [g.dataset.name]: b.dataset.v }); this.click();
      })));
      const r = q('.lb-cpu');
      r.addEventListener('input', () => { q('.lb-cpu-n').textContent = r.value; });
      r.addEventListener('change', () => ss.setSettings({ ...ss.settings, cpuCount: +r.value }));
      q('.lb-start').addEventListener('click', () => {
        this.app.audio.unlock();
        this.app.audio.ui('start');
        const plan = makeSpawnPlan(ss.settings, ss.players.map(({ id, name, vehicle }) => ({ id, name, vehicle })));
        ss.start(plan);
      });
    }
    q('.lb-leave').addEventListener('click', () => { this.click(); this.leave(); });
  }
}
return { Lobby };
})();

// ==== src/viewer.js
__mod["src/viewer.js"] = (function () {
// モデル確認用ビューア（?view=kaiju）: 海の上で怪獣のアニメーションを確認する
const THREE = __DEPS["three"];
const { OrbitControls } = __DEPS["three/addons/controls/OrbitControls.js"];
const { RenderPipeline } = __mod["src/core/renderer.js"];
const { Sky } = __mod["src/world/sky.js"];
const { Ocean } = __mod["src/world/ocean.js"];
const { makeWaterNormalTexture, makeNoiseTexture } = __mod["src/world/proceduralTextures.js"];
const { loadAll, assets } = __mod["src/core/assets.js"];
const { KaijuModel, HEAD_KEYS } = __mod["src/game/kaijuModel.js"];

async function runViewer() {
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
return { runViewer };
})();

// ==== src/main.js
__mod["src/main.js"] = (function () {
// ヨモツ — 海上防衛戦  エントリーポイント
const THREE = __DEPS["three"];
const { World } = __mod["src/world/world.js"];
const { Devices } = __mod["src/game/input.js"];
const { AudioEngine } = __mod["src/core/audio.js"];
const { HUD } = __mod["src/ui/hud.js"];
const { TouchControls } = __mod["src/ui/touch.js"];
const { Menu, Loading, PauseMenu, ResultScreen, loadSettings, saveSettings } = __mod["src/ui/menu.js"];
const { Lobby } = __mod["src/ui/lobby.js"];
const { loadAll, assets } = __mod["src/core/assets.js"];
const { Battle } = __mod["src/game/battle.js"];
const { KaijuModel, HEAD_KEYS } = __mod["src/game/kaijuModel.js"];
const { damp } = __mod["src/core/util.js"];
const { KAIJU, WORLD } = __mod["src/config.js"];

const params = new URLSearchParams(location.search);
const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ui = document.getElementById('ui');
    this.settings = loadSettings();
    this.loading = new Loading(this.ui);
    this.devices = new Devices(this.canvas);
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.audio.musicVolume = this.settings.music;
    const isMobile = this.devices.isTouch || /iPad|iPhone|Android/.test(navigator.userAgent);
    this.autoQuality = isMobile ? 'medium' : 'high';
    const q = this.settings.quality === 'auto' ? this.autoQuality : this.settings.quality;
    this.world = new World(this.canvas, { sky: this.settings.sky, quality: q });
    this.hud = new HUD(this.ui);
    this.touch = new TouchControls(this.ui, this.devices);
    this.touch.onPause = () => this.togglePause();
    this.pauseMenu = new PauseMenu(this.ui, this);
    this.result = new ResultScreen(this.ui, this);
    this.menu = null;
    this.battle = null;
    this.paused = false;
    this.clock = new THREE.Clock();
    this.fps = 60;
    this.fpsLow = 0;
    this.fpsHigh = 0;
    addEventListener('resize', () => this.world.resize());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.battle && this.battle.state !== 'victory' && this.battle.state !== 'defeat') this.togglePause(); }
      if (e.code === 'Enter' && this.battle && this.battle.state === 'intro') this.battle.skipIntro();
    });
    this.canvas.addEventListener('pointerdown', () => {
      this.audio.unlock();
      if (this.battle && this.battle.state === 'intro' && this.battle.kaiju.introT > 1.5) this.battle.skipIntro();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.battle && !this.battle.net && !this.paused && this.battle.state === 'battle') this.setPaused(true); });
    window.__app = this;
    // 開発用: ゲーム時間を一気に進める（バックグラウンドで rAF が遅い時の確認用）
    window.__advance = (sec, dt = 1 / 30) => {
      for (let t = 0; t < sec; t += dt) {
        if (this.battle) this.battle.update(dt); else this.updateMenuScene(dt);
        this.world.update(dt);
        this.devices.endFrame();
      }
      this.world.render(dt);
    };
    this.load();
  }

  async load() {
    await loadAll((p) => this.loading.set(p * 0.92, `読み込み中… ${Math.round(p * 100)}%`));
    if (!assets.gltf.kaiju) {
      this.loading.set(1, '怪獣モデルの読み込みに失敗しました（assets/models/kaiju.glb）');
      return;
    }
    this.setupMenuScene();
    this.loading.set(1, '準備完了');
    this.menu = new Menu(this.ui, this);
    this.lobby = new Lobby(this.ui, this);
    this.loading.hide();
    this.loop();
    setTimeout(() => this.benchmark(), 1800);
    if (params.get('quick')) {
      const s = { ...this.settings, vehicle: params.get('quick'), cpuCount: +(params.get('cpu') ?? this.settings.cpuCount), mode: params.get('mode') || this.settings.mode };
      setTimeout(() => this.startBattle(s), 300);
    }
  }

  // ---------------------------------------------------------------- タイトル画面の背景
  setupMenuScene() {
    const w = this.world;
    const k = new KaijuModel(assets.gltf.kaiju, assets.tex.kaijuGlow, KAIJU.scale);
    k.root.position.set(0, -WORLD.kaijuWaterDepth, 0);
    k.root.rotation.y = 0.35;
    w.scene.add(k.root);
    w.shadowExtent = 330 * KAIJU.scale;
    this.menuKaiju = k;
    this.menuShips = [];
    const g = assets.gltf.destroyer;
    if (g) {
      for (const [x, z, h] of [[420, 860, -1.9], [-640, 1180, -1.2]]) {
        const s = g.scene.clone(true);
        s.position.set(x, 0, z);
        s.rotation.y = h;
        s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && o.material.metalnessMap) { o.material.metalnessMap = null; o.material.metalness = 0; } } });
        w.scene.add(s);
        const trail = w.foam.createTrail({ life: 50, w0: 16, spread: 1.0, strength: 0.9, step: 6 });
        this.menuShips.push({ obj: s, h, trail, speed: 9 });
      }
    }
    this.menuT = 0;
    this.menuRoarT = 6;
    w.shadowFocus.set(0, 0, 0);
    w.warnCenter.set(0, 0, 0);
  }

  clearMenuScene() {
    const w = this.world;
    if (this.menuKaiju) { w.scene.remove(this.menuKaiju.root); this.menuKaiju = null; }
    for (const s of this.menuShips || []) { w.scene.remove(s.obj); w.foam.removeTrail(s.trail); }
    this.menuShips = [];
  }

  updateMenuScene(dt) {
    const k = this.menuKaiju;
    if (!k) return;
    this.menuT += dt;
    this.menuRoarT -= dt;
    if (this.menuRoarT <= 0) {
      this.menuRoarT = 14 + Math.random() * 6;
      k.playBody('Roar');
      this.audio.roar(k.root.position, 0.8);
    }
    const t = this.menuT;
    const focus = new THREE.Vector3(Math.sin(t * 0.21) * 600, 60, 600 + Math.cos(t * 0.17) * 240);
    for (const key of HEAD_KEYS) k.aimHead(key, focus, 0.5);
    k.update(dt);
    // 足元の泡
    if (Math.random() < dt * 4) {
      const p = k.boneWorld(Math.random() < 0.5 ? 'shin_L' : 'shin_R', new THREE.Vector3());
      this.world.foam.addDecal(p.x, p.z, 46, 0.5, 3.5, 1.2);
    }
    for (const s of this.menuShips) {
      const f = new THREE.Vector3(Math.sin(s.h), 0, Math.cos(s.h));
      s.obj.position.addScaledVector(f, s.speed * dt);
      s.h += dt * 0.02;
      s.obj.rotation.y = s.h;
      s.obj.position.y = this.world.ocean.heightAt(s.obj.position.x, s.obj.position.z) - 0.2;
      s.trail.push(s.obj.position.x - f.x * 76, s.obj.position.z - f.z * 76, this.world.time, 1);
    }
    const cam = this.world.camera;
    const a = 0.75 + Math.sin(t * 0.05) * 0.5;
    const r = 640 + Math.sin(t * 0.08) * 70;
    cam.position.set(Math.sin(a) * r, 60 + Math.sin(t * 0.11) * 16, Math.cos(a) * r);
    cam.lookAt(-110 + Math.sin(a) * 50, 92, 0);
  }

  // ---------------------------------------------------------------- 画面遷移
  startBattle(settings) {
    this.lastSettings = settings;
    this.settings = settings;
    const { net, plan, ...persist } = settings;
    if (!net) saveSettings(persist);
    this.clearMenuScene();
    if (this.menu) this.menu.show(false);
    if (this.lobby) this.lobby.hide();
    this.result.hide();
    this.setPaused(false);
    if (this.world.preset !== undefined && this.world.sky.preset.label !== { day: '昼', dusk: '夕暮れ', night: '夜' }[settings.sky]) this.world.setSky(settings.sky);
    const q = settings.quality === 'auto' ? this.autoQuality : settings.quality;
    this.world.setQuality(q);
    this.audio.setVolume(settings.volume);
    this.audio.setMusicVolume(settings.music);
    this.battle = new Battle(this, settings);
    this.touch.setMode(this.devices.isTouch ? (settings.vehicle === 'destroyer' ? 'ship' : 'fighter') : null);
    this.fpsLow = this.fpsHigh = 0;
  }

  endBattleCleanup() {
    if (this.battle) { this.battle.dispose(); this.battle = null; }
    this.touch.setMode(null);
    this.hud.show(false);
    this.world.pipe.post.uDanger.value = 0;
  }

  restart() {
    if (this.battle && this.battle.net) { this.backToLobby(); return; }
    this.endBattleCleanup();
    this.result.hide();
    this.startBattle(this.lastSettings || this.settings);
  }

  backToMenu() {
    if (this.net) this.lobby.leave();
    this.endBattleCleanup();
    this.result.hide();
    this.setPaused(false);
    this.setupMenuScene();
    if (this.menu) { this.menu.settings = loadSettings(); this.menu.render(); this.menu.show(true); }
    this.audio.ui('back');
  }

  // ---------------------------------------------------------------- マルチプレイ
  openLobby() {
    if (this.menu) this.menu.show(false);
    this.lobby.open();
  }

  /** ホストが出撃した: 全員がこれを呼ぶ（設定はホストのもの、画質や音量は自分のもの） */
  startMultiBattle(session, hostSettings, plan) {
    if (this.battle) this.endBattleCleanup();
    this.result.hide();
    const local = loadSettings();
    const me = session.me;
    const s = { ...local, mode: hostSettings.mode, difficulty: hostSettings.difficulty, cpuCount: hostSettings.cpuCount, sky: hostSettings.sky, cpuMix: { manual: false, fighters: 0 }, vehicle: me ? me.vehicle : local.vehicle, net: session, plan };
    this.startBattle(s);
    this.hud.toast(`マルチプレイ ― ${session.players.length}人で出撃`, 'ok');
  }

  /** マルチプレイの戦闘が終わってロビーへ戻る（ルームにはいたまま） */
  backToLobby() {
    this.net?.detach();
    this.endBattleCleanup();
    this.result.hide();
    this.setPaused(false);
    this.setupMenuScene();
    this.lobby.open();
  }

  onHostLost() {
    const inBattle = !!this.battle;
    this.lobby.leave();
    if (inBattle) { this.endBattleCleanup(); this.result.hide(); this.setPaused(false); this.setupMenuScene(); }
    this.lobby.open();
    this.lobby.setStatus('ホストとの接続が切れました', 'bad');
  }

  showResult(battle) {
    if (battle !== this.battle) return;
    battle.broadcast?.finish();
    this.hud.show(false);
    this.touch.setMode(null);
    this.result.show(battle);
  }

  togglePause() {
    // マルチプレイは止められない（メニューだけ開く）
    if (this.battle && this.battle.net) { this.pauseMenu.show(!this.pauseMenu.visible, true); return; }
    this.setPaused(!this.paused);
  }
  setPaused(p) {
    if (p && !this.battle) return;
    if (p && this.battle && this.battle.net) return;
    this.paused = p;
    this.pauseMenu.show(p);
    if (this.audio.ctx) { if (p) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
  }

  setSky(name) { this.world.setSky(name); }

  // ---------------------------------------------------------------- 性能
  benchmark() {
    if (document.visibilityState !== 'visible') { setTimeout(() => this.benchmark(), 2000); return; }
    const samples = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
      if (samples.length < 120) requestAnimationFrame(tick);
      else {
        samples.sort((a, b) => a - b);
        const ms = samples[Math.floor(samples.length * 0.6)];
        const fps = 1000 / ms;
        const n = fps >= 58 ? 12 : fps >= 52 ? 8 : fps >= 45 ? 6 : fps >= 38 ? 4 : fps >= 30 ? 2 : 0;
        this.recommended = n;
        if (this.menu) this.menu.setRecommended(n);
        if (fps < 40 && this.settings.quality === 'auto') { this.autoQuality = fps < 30 ? 'low' : 'medium'; this.world.setQuality(this.autoQuality); }
      }
    };
    requestAnimationFrame(tick);
  }

  autoAdjustQuality(dt) {
    if (!this.battle || this.settings.quality !== 'auto' || this.paused || document.visibilityState !== 'visible') return;
    const cur = this.world.pipe.qualityName;
    const i = QUALITY_ORDER.indexOf(cur);
    if (this.fps < 42) { this.fpsLow += dt; this.fpsHigh = 0; } else if (this.fps > 58) { this.fpsHigh += dt; this.fpsLow = 0; } else { this.fpsLow = Math.max(0, this.fpsLow - dt); this.fpsHigh = 0; }
    if (this.fpsLow > 3 && i > 0) { this.world.setQuality(QUALITY_ORDER[i - 1]); this.fpsLow = 0; this.hud.toast(`画質を自動で下げました（${QUALITY_ORDER[i - 1]}）`); }
    if (this.fpsHigh > 15 && i < QUALITY_ORDER.indexOf(this.autoQuality)) { this.world.setQuality(QUALITY_ORDER[i + 1]); this.fpsHigh = 0; }
  }

  loop() {
    const frame = () => {
      requestAnimationFrame(frame);
      const raw = this.clock.getDelta();
      const dt = Math.min(raw, 1 / 20);
      if (raw > 0) this.fps = damp(this.fps, 1 / raw, 2, raw);
      if (!this.paused) {
        if (this.battle) this.battle.update(dt);
        else this.updateMenuScene(dt);
        this.world.update(dt);
      }
      this.world.render(this.paused ? 0 : dt);
      this.devices.endFrame();
      this.autoAdjustQuality(dt);
    };
    frame();
  }
}

if (params.get('view') === 'kaiju') Promise.resolve(__mod["src/viewer.js"]).then((m) => m.runViewer());
else new App();
return {  };
})();
})();
