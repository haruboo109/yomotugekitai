// 実行時に生成するタイル可能なテクスチャ（外部画像ファイル不要）
// - 海面の細かい波の法線マップ（スペクトル＋逆FFT）
// - 泡用ノイズ
// - パーティクル用スプライト（煙・しぶき・炎・火花・リング）
import * as THREE from 'three';

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

export function mulberry32(seed) {
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
export function makeWaterNormalTexture(n = 256, seed = 7, dir = [1, 0.35]) {
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
export function makeNoiseTexture(n = 256, seed = 11) {
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
export function makeParticleAtlas(size = 1024) {
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
