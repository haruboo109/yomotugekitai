// アセット読み込み（進捗つき）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);

export const assets = { gltf: {}, tex: {} };

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

export async function loadAll(onProgress, only = null) {
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
