// 海面の泡マップ: 航跡・しぶき跡・怪獣の足元の泡を、真上から見た RT に描いて海シェーダーで使う
import * as THREE from 'three';
import { mulberry32 } from './proceduralTextures.js';

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
export class Trail {
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

export class FoamSystem {
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
