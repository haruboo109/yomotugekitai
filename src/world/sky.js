// 空（大気のグラデーション＋太陽＋雲）をキューブマップに焼き、背景と環境光（IBL）に使う
import * as THREE from 'three';

export const SKY_PRESETS = {
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

export class Sky {
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
