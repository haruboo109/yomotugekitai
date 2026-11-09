// 怪獣ヨモツ（ゲームロジック）: 頭ごとのHP・溜め/発射/硬直/怯み・怒り・攻撃と当たり判定・怪獣らしい仕草
import * as THREE from 'three';
import { KaijuModel, HEAD_KEYS, HEAD_INFO } from './kaijuModel.js';
import { KAIJU, ATTACKS, WORLD } from '../config.js';
import { Beam, AimLine } from './beams.js';
import { clamp, rand, pick, damp, distSegmentSegment, segmentSphere, smoothstep, interceptTime, angleDiff, DEG } from '../core/util.js';

const S = KAIJU.scale;
// 登場シーンの時間割（テレビ中継と合わせる）: emergeAt 秒まで海中、end 秒で戦闘開始
export const KAIJU_INTRO = { emergeAt: 8.0, end: 19.0 };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const HEAD_R = { C: 10.5 * S, L: 9.5 * S, R: 9.5 * S };
export const MELEE_ALT = 70 * S; // しっぽ・爪が届く高さ（これより高く飛んでいれば当たらない）

/** 船の当たり判定は艦の中央部（艦橋〜煙突）に絞る。端をかすめた場合は演出のみ（nearMiss）。
 *  （outA/outB に呼び出し側の一時ベクトルが渡されても壊れないよう、向きは専用の作業領域で持つ） */
const _vsDir = new THREE.Vector3();
export function vehicleSegment(v, outA, outB, halfOverride) {
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
export class Kaiju {
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

export { HEAD_KEYS, HEAD_INFO, ATTACK_NAME };
