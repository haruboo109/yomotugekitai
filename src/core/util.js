import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** 角度差を -π..π に */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** 指数減衰で目標値へ近づける（フレームレート非依存） */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export function dampVec(v, target, lambda, dt) {
  return v.lerp(target, 1 - Math.exp(-lambda * dt));
}

/** 点 p と線分 ab の距離 */
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();
export function distPointSegment(p, a, b, outClosest) {
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
export function distSegmentSegment(p0, p1, q0, q1) {
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
export function segmentSphere(p0, p1, center, radius) {
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
export function segmentCapsule(p0, p1, a, b, r) {
  return distSegmentSegment(p0, p1, a, b) <= r;
}

/** 簡易オブジェクトプール */
export class Pool {
  constructor(factory) { this.factory = factory; this.free = []; }
  get() { return this.free.pop() || this.factory(); }
  put(o) { this.free.push(o); }
}

/** 一定間隔で何かをするためのタイマー */
export class Every {
  constructor(interval) { this.interval = interval; this.t = Math.random() * interval; }
  tick(dt) { this.t += dt; if (this.t >= this.interval) { this.t -= this.interval; return true; } return false; }
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 予測射撃: 速度 v の目標に弾速 s で当てる迎撃時間 */
export function interceptTime(relPos, targetVel, speed) {
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

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
