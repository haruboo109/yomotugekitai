// 機体: 護衛艦（駆逐艦）・戦闘機・空母
import * as THREE from 'three';
import { SHIP, FIGHTER, PROP_FIGHTER, CARRIER, WORLD, KAIJU } from '../config.js';
import { clamp, damp, rand, DEG, angleDiff, interceptTime } from '../core/util.js';
import { assets } from '../core/assets.js';
import { ballisticPitch } from './weapons.js';

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

export class Vehicle {
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
export class Destroyer extends Vehicle {
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
export class Fighter extends Vehicle {
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
export class Carrier extends Vehicle {
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
