// CPU（仲間AI）: 単純なルールの組み合わせ。反応の遅れと照準のブレで「腕前」を調整する。
import * as THREE from 'three';
import { makeInputState } from './input.js';
import { clamp, rand, angleDiff, DEG, interceptTime } from '../core/util.js';
import { SHIP, FIGHTER } from '../config.js';
import { HEAD_KEYS } from './kaijuModel.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function dist2DPointSeg(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t)), t };
}

/** 危険（予告中の攻撃）に自分が入っているか。入っていれば逃げる方向を返す */
export function findThreat(battle, v, lookahead = 2.5) {
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

export class ShipAI {
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

export class FighterAI {
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

export class CarrierAI { update() { return null; } }
