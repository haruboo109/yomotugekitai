// 味方の弾: 砲弾・機関砲弾・ミサイル・魚雷・爆弾・ロケット
import * as THREE from 'three';
import { WORLD, CPU } from '../config.js';
import { rand, clamp } from '../core/util.js';

/** CPU の弾は少し弱め（主役はプレイヤー） */
const dmgMul = (owner) => (owner && !owner.isPlayer ? CPU.damageMul : 1);

const G = WORLD.gravity;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

function missileMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.6, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.4 }));
  g.add(body);
  const fins = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0xbbbbbb }));
  fins.position.z = -1.5;
  const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 2;
  g.add(fins, fins2);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.2, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.z = -2.9;
  g.add(flame);
  return g;
}

function bombMesh() {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 2.4, 4, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.6 }));
  return m;
}

/** 魚雷（見やすいよう実物より少し大きめ） */
function torpedoMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.45, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 7.0, 4, 10).rotateX(Math.PI / 2), mat);
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.6, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8a03c, roughness: 0.5 }));
  band.position.z = 2.6;
  g.add(band);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.7), mat);
  fin.position.z = -3.9;
  const fin2 = fin.clone(); fin2.rotation.z = Math.PI / 2;
  g.add(fin, fin2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** 機関砲の弾（曳光弾）: 1回の描画で数百発をまとめて描く */
class Bullets {
  constructor(world, max = 900) {
    this.world = world;
    this.max = max;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 6.2, 2.2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 24;
    this.mesh.count = 0;
    world.scene.add(this.mesh);
    this.list = [];
  }

  add(origin, dir, speed, owner, w, range, inherit, visual = false) {
    if (this.list.length >= this.max) return;
    const v = dir.clone().multiplyScalar(speed);
    if (inherit) v.add(inherit);
    // 曳光弾は数発に1発（自分の弾は多めに見せる）
    const tracer = Math.random() < (owner && owner.isPlayer ? 0.55 : 0.3);
    this.list.push({ p: origin.clone(), v, t: 0, life: range / speed, owner, w, tracer, visual });
  }

  update(dt, proj) {
    const k = proj.kaiju;
    const fx = this.world.effects;
    const cam = proj.battle.camera.position;
    const alive = k && !k.dead && k.phase !== 'intro';
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const p0 = _v.copy(b.p);
      b.p.addScaledVector(b.v, dt);
      b.t += dt;
      let dead = b.t > b.life;
      if (!dead && alive) {
        const hit = k.intersectSegment(p0, b.p, 0.6);
        if (hit) {
          const dealt = proj.hitKaiju(b, hit, b.w.damage, b.w.flinch, 'gun');
          if (!b.visual && b.owner && b.owner.kind === 'fighter') b.owner.bombGauge = Math.min(1, b.owner.bombGauge + 0.0016);
          if (Math.random() < 0.45) fx.sparks(hit.point, _v2.copy(b.v).normalize().negate(), 3);
          if (Math.random() < 0.18) fx.hitPuff(hit.point, 0.9);
          void dealt;
          dead = true;
        }
      }
      if (!dead && b.p.y < 0) {
        if (Math.random() < 0.35) fx.bulletSplash(b.p);
        dead = true;
      }
      if (dead) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
      if (!b.tracer || n >= this.max) continue;
      // 遠くの弾も見えるよう、距離に応じて太く長く
      const d = b.p.distanceTo(cam);
      const wdt = Math.max(0.25, d * 0.0007);
      const len = 8 + d * 0.008;
      _v2.copy(b.v).normalize();
      _q.setFromUnitVectors(_Z, _v2);
      _s.set(wdt, wdt, len);
      _m.compose(_v.copy(b.p).addScaledVector(_v2, -len * 0.5), _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }
  dispose() { this.world.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class Projectiles {
  constructor(battle) {
    this.battle = battle;
    this.world = battle.world;
    this.list = [];
    this.missileProto = missileMesh();
    this.bombProto = bombMesh();
    this.torpedoProto = torpedoMesh();
    this.tracerGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 5, 1, true).rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bullets = new Bullets(this.world);
  }

  get kaiju() { return this.battle.kaiju; }

  /** 自分が撃って、まだ走っている魚雷 */
  torpedoesOf(owner) { return this.list.filter((o) => o.type === 'torpedo' && o.owner === owner); }

  // visual=true: 他の端末の弾（見た目だけ。ダメージは撃った端末がホストへ送る）
  shell(origin, vel, owner, w, visual = false) {
    const tracer = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    tracer.scale.set(2.2, 2.2, 28);
    this.world.scene.add(tracer);
    this.list.push({ type: 'shell', p: origin.clone(), v: vel.clone(), t: 0, owner, w, mesh: tracer, visual });
  }

  bullet(origin, dir, speed, owner, w, range, inherit = null, visual = false) { this.bullets.add(origin, dir, speed, owner, w, range, inherit, visual); }

  missile(origin, dir, speed0, owner, w, targetKey, visual = false) {
    const m = this.missileProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'missile', p: origin.clone(), v: dir.clone().multiplyScalar(speed0), t: 0, owner, w, mesh: m, target: targetKey, visual });
  }

  rocket(origin, dir, speed0, owner, w, visual = false) {
    const m = this.missileProto.clone();
    m.scale.setScalar(0.7);
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'rocket', p: origin.clone(), v: dir.clone().multiplyScalar(speed0 + w.speed), t: 0, owner, w, mesh: m, visual });
  }

  /** 魚雷: 発射管から舷側の外へ打ち出され（out 方向）、海に飛び込んでから dir へ走る */
  torpedo(origin, dir, owner, w, out = null, shipVel = null, visual = false) {
    const m = this.torpedoProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    const v = new THREE.Vector3();
    if (shipVel) v.copy(shipVel);
    if (out) v.addScaledVector(out, 11);
    v.y = 2.5;
    const run = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.list.push({ type: 'torpedo', phase: 'air', p: origin.clone(), v, run, t: 0, owner, w, mesh: m, trail: null, traveled: 0, visual });
    this.world.effects.muzzleFlash(origin, out || run, 0.5);
  }

  bomb(origin, vel, owner, w, visual = false) {
    const m = this.bombProto.clone();
    m.position.copy(origin);
    this.world.scene.add(m);
    this.list.push({ type: 'bomb', p: origin.clone(), v: vel.clone(), t: 0, owner, w, mesh: m, visual });
  }

  remove(i) {
    const o = this.list[i];
    if (o.mesh) this.world.scene.remove(o.mesh);
    if (o.trail) this.world.foam.removeTrail(o.trail);
    this.list.splice(i, 1);
  }

  hitKaiju(o, hit, dmg, flinch, kind) {
    const k = this.kaiju;
    const head = hit.head || (hit.part === 'neck' && hit.neckOf && k.heads[hit.neckOf].alive && Math.random() < 0.5 ? hit.neckOf : null);
    if (o.visual) return 0; // 他の端末の弾（見た目だけ）
    const dealt = this.battle.kaijuDamage(dmg * dmgMul(o.owner), { head, flinch, point: hit.point, owner: o.owner, kind, part: hit.part });
    this.battle.onProjectileHit(o, hit, dealt, kind);
    return dealt;
  }

  update(dt) {
    const fx = this.world.effects;
    const ocean = this.world.ocean;
    const k = this.kaiju;
    this.bullets.update(dt, this);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      const p0 = _v.copy(o.p);
      if (o.type === 'shell') {
        o.v.y -= G * dt;
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 1.5) : null;
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, 'shell');
          fx.explosion(hit.point, 0.9, { debris: false });
          this.remove(i); continue;
        }
        if (o.p.y < ocean.heightAt(o.p.x, o.p.z)) {
          fx.splash(o.p, 1.1, { height: 34 });
          this.battle.onSplash(o.p, 'shell');
          this.remove(i); continue;
        }
        if (o.t > 14) { this.remove(i); continue; }
      } else if (o.type === 'missile' || o.type === 'rocket') {
        if (o.type === 'missile') {
          const spd = Math.min(o.w.speed, o.v.length() + 260 * dt);
          let dir = _v2.copy(o.v).normalize();
          if (o.target && k && k.heads[o.target] && k.heads[o.target].alive && o.t > 0.15) {
            const tp = k.headSpheres[o.target].c;
            const want = tp.clone().sub(o.p).normalize();
            const maxTurn = (o.w.turn * Math.PI / 180) * dt;
            const ang = dir.angleTo(want);
            if (ang > 1e-4) dir.lerp(want, Math.min(1, maxTurn / ang)).normalize();
          }
          o.v.copy(dir).multiplyScalar(spd);
        } else {
          o.v.y -= G * 0.25 * dt;
        }
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        if (Math.random() < 0.85) fx.smokeTrail(o.p, 0.9);
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 2.0) : null;
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, o.type);
          fx.explosion(hit.point, o.type === 'missile' ? 1.6 : 1.2);
          this.battle.onExplosion(hit.point, 0.3);
          this.remove(i); continue;
        }
        if (o.p.y < ocean.heightAt(o.p.x, o.p.z) || o.t > 10) {
          if (o.p.y < 5) fx.splash(o.p, 1.4, { height: 30 });
          else fx.explosion(o.p, 1.0, { debris: false });
          this.remove(i); continue;
        }
      } else if (o.type === 'torpedo') {
        if (o.phase === 'air') {
          // 発射管から飛び出して海へ落ちる
          o.v.y -= G * dt;
          o.p.addScaledVector(o.v, dt);
          o.mesh.position.copy(o.p);
          o.mesh.lookAt(_v2.copy(o.p).add(o.run).add(new THREE.Vector3(0, o.v.y * 0.04, 0)));
          if (o.p.y <= ocean.heightAt(o.p.x, o.p.z)) {
            o.phase = 'run';
            o.p.y = -1.6;
            o.v.copy(o.run).multiplyScalar(o.w.speed * 0.45);
            fx.splash(new THREE.Vector3(o.p.x, 0, o.p.z), 0.9, { height: 12 });
            o.trail = this.world.foam.createTrail({ life: 30, w0: 9, spread: 0.6, strength: 1.0, kelvin: false, step: 5 });
          }
          continue;
        }
        // 水中を走る（加速して巡航）
        const spd = Math.min(o.w.speed, o.v.length() + o.w.speed * 0.6 * dt);
        o.v.copy(o.run).multiplyScalar(spd);
        const step = spd * dt;
        o.p.addScaledVector(o.v, dt);
        o.traveled += step;
        const wy = ocean.heightAt(o.p.x, o.p.z);
        o.p.y = Math.min(-1.2, wy - 1.4);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.run));
        o.trail.push(o.p.x, o.p.z, this.world.time, 1);
        // 白い泡の筋（遠くからも魚雷の進路が分かる）
        if (Math.random() < 0.7) fx.alpha.spawn({ x: o.p.x - o.run.x * 4, y: 0.3, z: o.p.z - o.run.z * 4, vx: rand(-0.6, 0.6), vy: rand(0.8, 2.2), vz: rand(-0.6, 0.6), life: rand(1.0, 1.8), size: 2.2, size1: 5.5, color: [0.9, 0.94, 0.98, 0.65], color1: [0.9, 0.92, 0.96, 0], frame: 1 });
        // 怪獣の脚・尾（喫水付近）に当たったか
        let hit = null;
        if (k && !k.dead) {
          const a = _v2.set(p0.x, 2, p0.z), b = new THREE.Vector3(o.p.x, 2, o.p.z);
          const h = k.intersectSegment(a, b, 5.0);
          if (h && h.part !== 'head') hit = h;
          else if (h) hit = { ...h, head: null, part: 'body' };
        }
        if (hit) {
          this.hitKaiju(o, hit, o.w.damage, o.w.flinch, 'torpedo');
          const wp = new THREE.Vector3(o.p.x, 0, o.p.z);
          fx.waterColumn(wp, 170, 34);
          fx.waterColumn(new THREE.Vector3(wp.x + rand(-12, 12), 0, wp.z + rand(-12, 12)), 110, 24);
          fx.explosion(new THREE.Vector3(o.p.x, 8, o.p.z), 2.2, { debris: false });
          this.world.foam.addRing(wp.x, wp.z, 10, 160, 1.0, 3);
          this.battle.onTorpedoHit(o, wp);
          this.remove(i); continue;
        }
        if (o.traveled > o.w.range) { this.remove(i); continue; }
      } else if (o.type === 'bomb') {
        o.v.y -= G * dt;
        o.v.multiplyScalar(1 - 0.02 * dt);
        o.p.addScaledVector(o.v, dt);
        o.mesh.position.copy(o.p);
        o.mesh.lookAt(_v2.copy(o.p).add(o.v));
        const hit = k && !k.dead ? k.intersectSegment(p0, o.p, 3.0) : null;
        const water = o.p.y < ocean.heightAt(o.p.x, o.p.z);
        if (hit || water) {
          const at = hit ? hit.point : o.p.clone();
          fx.explosion(at, 3.0);
          if (water) fx.waterColumn(new THREE.Vector3(at.x, 0, at.z), 110, 30);
          this.battle.onExplosion(at, 0.8);
          if (k && !k.dead && !o.visual) {
            // 爆風: 近い部位にダメージ（直撃は満額）
            let dmg = 0, head = null;
            if (hit) { dmg = o.w.damage; head = hit.head; }
            else {
              for (const key of k.aliveHeads) {
                const d = at.distanceTo(k.headSpheres[key].c) - k.headSpheres[key].r;
                if (d < o.w.blast) { dmg = Math.max(dmg, o.w.damage * (1 - d / o.w.blast) * 0.7); head = key; }
              }
              if (!dmg && k.pointInside(at, o.w.blast)) dmg = o.w.damage * 0.45;
            }
            if (dmg > 0) {
              const dealt = this.battle.kaijuDamage(dmg * dmgMul(o.owner), { head, flinch: o.w.flinch, point: at, owner: o.owner, kind: 'bomb', part: hit ? hit.part : 'body' });
              this.battle.onProjectileHit(o, hit || { point: at, head }, dealt, 'bomb');
            }
          }
          this.remove(i); continue;
        }
        if (o.t > 30) { this.remove(i); continue; }
      }
    }
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(i);
    this.bullets.clear();
  }
  dispose() { this.clear(); this.bullets.dispose(); }
}

/** 砲弾の弾道解（低い弾道）。届かなければ 45° を返す */
export function ballisticPitch(dx, dy, v, g = G) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return { pitch: Math.PI / 4, ok: false };
  return { pitch: Math.atan2(v2 - Math.sqrt(disc), g * dx), ok: true };
}
