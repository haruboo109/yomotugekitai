// 即死攻撃の予告表示
// 海面: 真上から見た警告マップ(RT)に図形を描き、海シェーダーが発光として重ねる（波に追従・Zファイトなし）
// 空中: 航空機が狙われた時は、半透明の「壁」と照準線を 3D で出す
import * as THREE from 'three';

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

export class TelegraphSystem {
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
