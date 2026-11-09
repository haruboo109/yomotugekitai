// 描画パイプライン: HDRレンダリング → ブルーム → トーンマップ・色調補正・ビネット・グレイン
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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

export const QUALITY_LEVELS = {
  ultra: { pixelRatio: 1.0, maxDpr: 2.0, msaa: 4, shadows: 4096, bloom: true, bloomScale: 0.5, particles: 1.0, ocean: 'high', foam: 1024 },
  high: { pixelRatio: 1.0, maxDpr: 1.5, msaa: 4, shadows: 2048, bloom: true, bloomScale: 0.5, particles: 1.0, ocean: 'high', foam: 1024 },
  medium: { pixelRatio: 0.85, maxDpr: 1.25, msaa: 2, shadows: 1024, bloom: true, bloomScale: 0.4, particles: 0.65, ocean: 'medium', foam: 512 },
  low: { pixelRatio: 0.7, maxDpr: 1.0, msaa: 0, shadows: 0, bloom: true, bloomScale: 0.3, particles: 0.4, ocean: 'low', foam: 512 },
};

export class RenderPipeline {
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
