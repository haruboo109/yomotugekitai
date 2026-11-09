// 戦闘の進行（出撃 → 戦闘 → 決着）と、各種イベントの配線
import * as THREE from 'three';
import { DIFFICULTY, MODES, WORLD, CPU, KAIJU, CARRIER, ATTACKS } from '../config.js';
import { assets } from '../core/assets.js';
import { Kaiju, MELEE_ALT } from './kaiju.js';
import { HEAD_INFO, HEAD_KEYS } from './kaijuModel.js';
import { Destroyer, Fighter, Carrier } from './vehicles.js';
import { Projectiles } from './weapons.js';
import { HumanController } from './input.js';
import { ShipAI, FighterAI } from './ai.js';
import { CameraRig } from './camera.js';
import { Broadcast } from './broadcast.js';
import { vehicleName } from '../net/net.js';
import { rand, clamp, DEG } from '../core/util.js';

const CAUSE_TEXT = {
  beam: 'ビームの直撃', bolt: '蒼の連射ビーム', column: '水柱', tail: 'しっぽの薙ぎ払い', claw: '爪の薙ぎ払い',
  converge: '収束ビーム', ram: '怪獣に衝突', crash: '怪獣に激突', sea: '海面に墜落', mega: '極太ビーム', gone: '通信が切れた',
};
export { CAUSE_TEXT };

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * 出撃の配置（空母・CPU・プレイヤー）。マルチプレイではホストが作って全員に配り、同じ配置で始める。
 * players: [{ id, name, vehicle }]
 */
export function makeSpawnPlan(settings, players) {
  const diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
  const plan = { carrier: { id: 'carrier', pos: [900, 0, CARRIER.standOff + 150], heading: Math.PI }, players: [], cpu: [] };
  let si = 0, fi = 0;
  for (const p of players) {
    if (p.vehicle === 'destroyer') plan.players.push({ ...p, pos: [-220 + si * 230, 0, 1500 + si * 90], heading: Math.PI, hullNo: String(185 + si * 2) }), si++;
    else plan.players.push({ ...p, pos: [240 + fi * 150, 380 + fi * 25, 1950 + fi * 60], heading: Math.PI }), fi++;
  }
  const n = settings.cpuCount || 0;
  const humanFighters = players.filter((p) => p.vehicle !== 'destroyer').length;
  let nf, ns;
  if (settings.cpuMix && settings.cpuMix.manual) { nf = clamp(settings.cpuMix.fighters, 0, n); ns = n - nf; }
  else { nf = Math.round(n * (humanFighters >= players.length / 2 ? 0.5 : 0.65)); ns = n - nf; }
  const skill = diff.cpuSkill;
  for (let i = 0; i < ns; i++) {
    const slot = ns === 1 ? 0.6 : -1.15 + (2.3 * i) / Math.max(1, ns - 1);
    const r = rand(1300, 1800);
    const pos = [r1(Math.sin(slot) * r), 0, r1(Math.cos(slot) * r)];
    const nm = CPU.shipNames[i % CPU.shipNames.length];
    plan.cpu.push({ id: `c${i}`, kind: 'ship', name: `護衛艦 ${nm}`, callsign: nm, hullNo: String(171 + i * 3), pos, heading: Math.atan2(-pos[0], -pos[2]), skill: skill * rand(0.85, 1.1), slot: slot + rand(-0.12, 0.12) });
  }
  const zeroMix = players.some((p) => p.vehicle === 'zero');
  for (let i = 0; i < nf; i++) {
    const a = (i / Math.max(1, nf)) * Math.PI * 2;
    const nm = CPU.callsignsFighter[i % CPU.callsignsFighter.length];
    plan.cpu.push({ id: `c${ns + i}`, kind: 'fighter', type: zeroMix && i % 2 === 0 ? 'zero' : 'f15', name: nm, callsign: nm, pos: [r1(900 + Math.cos(a) * 450), r1(rand(320, 560)), r1(2500 + Math.sin(a) * 450)], heading: Math.PI + rand(-0.3, 0.3), skill: skill * rand(0.85, 1.1), slot: i });
  }
  return plan;
}

export class Battle {
  constructor(app, settings) {
    this.app = app;
    this.world = app.world;
    this.camera = this.world.camera;
    this.devices = app.devices;
    this.hud = app.hud;
    this.audio = app.audio;
    this.settings = settings;
    this.net = settings.net || null; // マルチプレイの通信（ひとり用は null）
    this.diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    this.mode = MODES[settings.mode] || MODES.real;
    this.allyCount = settings.cpuCount || 0;
    this.humanCount = this.net ? Math.max(1, this.net.players.length) : 1;
    this.playerAggro = this.net ? 1.0 : 1.15;
    this.time = 0;
    this.state = 'intro';
    this.vehicles = [];
    this.hazards = [];
    this.stats = { damage: 0, playerDamage: 0, flinches: 0, playerFlinches: 0, headsKilled: 0, alliesLost: 0, playerDeaths: 0, shots: 0, hits: 0, startTime: 0, endTime: 0 };
    this.projectiles = new Projectiles(this);
    this.kaiju = new Kaiju(this, assets.gltf.kaiju, assets.tex.kaijuGlow);
    this.rig = new CameraRig(this);
    this.human = new HumanController(this.devices, this);
    this.rescueTarget = null;
    this.plan = settings.plan || makeSpawnPlan(settings, [{ id: 'host', name: '', vehicle: settings.vehicle, solo: true }]);
    this.spawn(this.plan);
    this.net?.attach(this);
    this.hud?.attach(this);
    this.audio?.startBattle(this);
    this.world.shadowFocus.copy(this.kaiju.pos);
    this.world.shadowExtent = 330 * KAIJU.scale;
    // テレビの報道ヘリからの生中継で始まる
    this.broadcast = new Broadcast(this);
    this.broadcast.startIntro();
  }

  get isFighter() { return this.player ? this.player.kind === 'fighter' : this.settings.vehicle !== 'destroyer'; }
  get myId() { return this.net ? this.net.myId : 'host'; }
  get isHostOrSolo() { return !this.net || this.net.isHost; }

  /** 配置どおりに機体を置く。自分の端末で動かす機体（自分・ホストなら CPU と空母）とそれ以外（通信で届いた位置に置くだけ）を分ける */
  spawn(plan) {
    const hostSide = this.isHostOrSolo;
    const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const c = plan.carrier;
    this.carrier = new Carrier(this, { id: c.id, name: '空母 あまつかぜ', position: V3(c.pos), heading: c.heading, offset: 900, local: hostSide });
    this.vehicles.push(this.carrier);
    for (const p of plan.players) this.vehicles.push(this.createPlayerVehicle(p, V3(p.pos), p.heading));
    this.player = this.vehicleById(this.myId);
    for (const e of plan.cpu) {
      const pos = V3(e.pos);
      if (e.kind === 'ship') {
        const ai = hostSide ? new ShipAI(this, e.skill, e.slot) : null;
        this.vehicles.push(new Destroyer(this, { id: e.id, name: e.name, callsign: e.callsign, hullNo: e.hullNo, position: pos, heading: e.heading, controller: ai, speed: 9, local: hostSide }));
      } else {
        const ai = hostSide ? new FighterAI(this, e.skill, e.slot) : null;
        this.vehicles.push(new Fighter(this, { id: e.id, name: e.name, callsign: e.callsign, type: e.type, position: pos, heading: e.heading, controller: ai, local: hostSide }));
      }
    }
  }

  /** プレイヤーの機体（マルチプレイでは入力した名前が機体の名前になる） */
  createPlayerVehicle(p, pos, heading, atCarrier = false) {
    const mine = p.id === this.myId;
    const solo = !this.net;
    const opts = { id: p.id, position: pos, heading, controller: mine ? this.human : null, isPlayer: mine, human: true, local: mine };
    if (p.vehicle === 'destroyer') {
      const nm = solo ? 'やまなみ' : vehicleName(p.name, 'destroyer');
      return new Destroyer(this, { ...opts, name: solo ? '護衛艦 やまなみ' : nm, callsign: nm, hullNo: p.hullNo || '185', speed: 10 });
    }
    const nm = solo ? 'イーグル1' : vehicleName(p.name, p.vehicle);
    return new Fighter(this, { ...opts, name: nm, callsign: nm, type: p.vehicle === 'zero' ? 'zero' : 'f15', pitch: atCarrier ? 0.12 : 0 });
  }

  /** 練習モードの再出撃（空母のそば） */
  makePlayer(atCarrier = false) {
    const p = this.plan.players.find((x) => x.id === this.myId) || this.plan.players[0];
    let pos = new THREE.Vector3(...p.pos), heading = p.heading;
    if (atCarrier && this.carrier.alive) {
      if (p.vehicle === 'destroyer') pos = this.carrier.position.clone().add(new THREE.Vector3(-260, 0, -120));
      else { const sp = this.carrier.deckSpawn(); pos = sp.position; heading = sp.heading; }
    }
    const v = this.createPlayerVehicle(p, pos, heading, atCarrier);
    this.vehicles.push(v);
    return v;
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    this.time += dt;
    this.kaiju.update(dt);
    for (const v of this.vehicles) v.update(dt);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.removed) {
        // 再出撃などで消える機体の戦果は、結果画面のために持ち越す
        if (v.human && v.stats) { const base = String(v.id).replace(/-old$/, ''); (this.netDamageCarry ||= {})[base] = (this.netDamageCarry[base] || 0) + v.stats.damage; v.stats.damage = 0; }
        v.dispose();
        this.vehicles.splice(i, 1);
      }
    }
    this.updateResupply(dt);
    this.projectiles.update(dt);
    this.hazards = this.hazards.filter((h) => h.until > this.time);
    this.updatePlayerState(dt);
    this.updateArena(dt);
    this.broadcast.update(dt);
    this.rig.update(dt);
    const post = this.world.pipe.post;
    if (post.uFlash.value > 0) post.uFlash.value = Math.max(0, post.uFlash.value - dt * 1.6);
    this.world.warnCenter.copy(this.kaiju.pos);
    this.world.shadowFocus.copy(this.kaiju.pos);
    this.hud?.update(dt);
    this.audio?.update(dt, this);
    this.net?.update(dt);
  }

  updateResupply(dt) {
    const c = this.carrier;
    if (!c || !c.alive) return;
    for (const v of this.vehicles) {
      if (!v.alive || v === c || !v.resupply) continue;
      if (v.position.distanceTo(c.position) < CARRIER.resupplyRadius + (v.kind === 'fighter' ? 150 : 0)) {
        if (v.resupply(dt) && v.isPlayer) this.hud?.toast('補給中…', 'ok');
      }
    }
  }

  arenaCheck(p) {
    const k = this.kaiju;
    const d = Math.hypot(p.x - k.pos.x, p.z - k.pos.z);
    let over = Math.max(0, d - WORLD.arenaRadius) / 500;
    if (p.z > WORLD.cityDistance - 120) over = Math.max(over, (p.z - (WORLD.cityDistance - 120)) / 200);
    return over;
  }

  updateArena(dt) {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'battle') return;
    const o = this.arenaCheck(p.position);
    if (o > 0) {
      this.hud?.warnArena(true);
      const k = this.kaiju;
      if (p.kind === 'ship') {
        const want = Math.atan2(k.pos.x - p.position.x, k.pos.z - p.position.z);
        p.heading += Math.sign(((want - p.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 4 * DEG * dt * Math.min(1, o);
      } else {
        p.yaw += 0.4 * dt * Math.min(1, o) * Math.sign(Math.sin(Math.atan2(k.pos.x - p.position.x, k.pos.z - p.position.z) - p.yaw));
      }
    } else this.hud?.warnArena(false);
  }

  updatePlayerState(dt) {
    const p = this.player;
    if (!p || p.alive) return;
    this.deadT = (this.deadT || 0) + dt;
    if (this.state !== 'battle') return;
    if (this.mode.respawn) {
      // 練習モード: 味方が近づくと復活。誰もいなければ一定時間で空母から再出撃
      this.rescueTarget = p;
      let rescued = this.deadT > (this.allyCount > 0 ? 16 : 7);
      for (const v of this.vehicles) {
        if (v === p || !v.alive || v.kind === 'carrier') continue;
        const d = v.position.distanceTo(p.position);
        if (d < (v.kind === 'fighter' ? 420 : 380)) { rescued = true; this.hud?.radio(v.callsign, '救助完了、再出撃せよ！'); break; }
      }
      this.hud?.setRespawn(Math.max(0, (this.allyCount > 0 ? 16 : 7) - this.deadT));
      if (rescued && this.deadT > 2.5) this.respawnPlayer();
    } else if (this.net) {
      // マルチプレイのリアルモード: やられたら仲間を観戦（全員やられたらホストが負けを決める）
      if (this.deadT > 3.5 && (!this.rig.spectate || !this.rig.spectate.alive)) {
        const next = this.vehicles.find((v) => v.alive && v.human && v !== p) || this.vehicles.find((v) => v.alive && v.kind !== 'carrier');
        this.rig.spectate = next || null;
        if (next) this.hud?.toast(`観戦中: ${next.name}`, '');
      }
    } else if (this.deadT > 4.5) {
      this.endBattle('defeat', 'player');
    }
  }

  respawnPlayer() {
    const old = this.player;
    old.removed = true;
    this.rescueTarget = null;
    this.deadT = 0;
    this.player = this.makePlayer(true);
    this.rig.spectate = null;
    this.hud?.setRespawn(null);
    this.hud?.toast('再出撃！', 'ok');
    this.audio?.ui('respawn');
    const p = this.player;
    this.net?.vehicleEvent({ e: 'respawn', id: p.id, pos: [r1(p.position.x), r1(p.position.y), r1(p.position.z)], heading: p.heading });
  }

  // ---------------------------------------------------------------- マルチプレイ（受信）
  /** 他の端末の機体の状態 */
  onNetStates(list) {
    const now = performance.now() / 1000;
    for (const st of list) {
      const v = this.vehicleById(st.id);
      if (v && !v.local && v.alive) v.pushNet(st, now);
    }
  }

  /** 他の端末で起きた機体の出来事 */
  onNetVehicleEvent(ev) {
    const v = this.vehicleById(ev.id);
    switch (ev.e) {
      case 'vdead':
        if (v && !v.local) this.onVehicleKilled(v, ev.cause, ev.by);
        break;
      case 'chit':
        if (v && !v.local && v.kind === 'carrier' && v.alive) {
          v.hitsLeft = ev.left;
          v.onHit(ev.cause);
          this.audio?.explosion(v.position, 1.6);
          this.hud?.radio('空母 あまつかぜ', v.hitsLeft === 2 ? '被弾！ 火災発生、まだ持ちこたえる！' : '大破！ 次は耐えられない！', 'bad');
        }
        break;
      case 'fire':
        if (v && !v.local) this.spawnRemoteShot(v, ev);
        break;
      case 'respawn': {
        if (v && v.local) break;
        if (v) { v.removed = true; v.id = `${v.id}-old`; }
        const p = this.plan.players.find((x) => x.id === ev.id);
        if (!p) break;
        const nv = this.createPlayerVehicle(p, new THREE.Vector3(ev.pos[0], ev.pos[1], ev.pos[2]), ev.heading);
        this.vehicles.push(nv);
        this.hud?.buildAllies();
        break;
      }
      case 'gone':
        if (v && v.alive) { v.alive = false; v.removed = true; this.hud?.radio('司令部', `${v.name}、通信が途絶えた`, 'bad'); }
        break;
      default: break;
    }
  }

  /** 他の端末の弾（見た目だけ。ダメージはその端末が判定してホストへ送る） */
  spawnRemoteShot(v, ev) {
    const P = this.projectiles;
    const V3 = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
    const o = V3(ev.o), d = V3(ev.d);
    if (ev.k === 'shell') { P.shell(o, d, v, { damage: 0, flinch: 0 }, true); this.world.effects.muzzleFlash(o, d.clone().normalize(), 1.5); this.audio?.fire('gun', o, false); }
    else if (ev.k === 'torp') P.torpedo(o, d, v, { speed: ev.s, range: ev.r, damage: 0, flinch: 0 }, V3(ev.out), V3(ev.sv), true);
    else if (ev.k === 'msl') P.missile(o, d, ev.s, v, { speed: ev.ms, turn: ev.tu, damage: 0, flinch: 0 }, ev.tk || null, true);
    else if (ev.k === 'rkt') P.rocket(o, d, ev.s, v, { speed: ev.ms, damage: 0, flinch: 0 }, true);
    else if (ev.k === 'bomb') P.bomb(o, d, v, { damage: 0, flinch: 0, blast: 0 }, true);
  }

  /** 自分の端末の機体が撃った弾を他の端末へ知らせる */
  netFire(v, k, data) {
    if (!this.net || !v.local) return;
    const a = (p) => (p ? [r1(p.x), r1(p.y), r1(p.z)] : null);
    const ev = { e: 'fire', id: v.id, k };
    for (const [key, val] of Object.entries(data)) ev[key] = val && val.isVector3 ? a(val) : val;
    this.net.vehicleEvent(ev);
  }

  /** ホスト: 参加者の弾が怪獣に当たった */
  onNetDamage(m) {
    const k = this.kaiju;
    if (!k || k.dead) return;
    // 届いた値はそのまま信用しない（ありえない大きさのダメージや不正な頭の名前は丸める）
    const amount = clamp(Number(m.a) || 0, 0, 1500);
    const head = ['R', 'C', 'L'].includes(m.h) ? m.h : null;
    k.damage(amount, { head, flinch: clamp(Number(m.f) || 1, 0, 5), kind: String(m.k || '').slice(0, 10), part: String(m.p || '').slice(0, 10), owner: this.vehicleById(m.by) });
  }

  /** 参加者: ホストが決着を知らせてきた */
  onNetEnd(m) {
    this.netScoreList = m.scores;
    this.endBattle(m.result, m.reason);
  }

  /** ホスト: 誰かがルームから抜けた */
  onNetPlayerLeft(id) {
    const v = this.vehicleById(id);
    if (v && v.alive) {
      v.alive = false;
      v.removed = true;
      this.hud?.radio('司令部', `${v.name}、通信が途絶えた`, 'bad');
      this.net?.vehicleEvent({ e: 'gone', id });
    }
    this.checkAllHumansDown();
  }

  /** 結果画面のプレイヤー一覧（与えたダメージ順） */
  netScores() {
    const list = [];
    for (const p of this.plan.players) {
      const vs = this.vehicles.filter((v) => v.id === p.id || v.id.startsWith(`${p.id}-`));
      const dmg = vs.reduce((s, v) => s + (v.stats ? v.stats.damage : 0), 0) + (this.netDamageCarry?.[p.id] || 0);
      list.push({ name: vehicleName(p.name, p.vehicle), damage: Math.round(dmg), vehicle: p.vehicle });
    }
    return list.sort((a, b) => b.damage - a.damage);
  }

  /** ホスト（リアルモード）: 人が操作する機体が全部やられたら負け */
  checkAllHumansDown() {
    if (!this.net || !this.net.isHost || this.mode.respawn || this.state !== 'battle') return;
    const anyHuman = this.vehicles.some((v) => v.human && v.alive);
    if (!anyHuman) setTimeout(() => this.endBattle('defeat', 'player'), 3500);
  }

  vehicleById(id) {
    if (id === null || id === undefined) return null;
    for (const v of this.vehicles) if (v.id === id) return v;
    return null;
  }

  /** 怪獣へのダメージはここを通す（マルチプレイの参加者はホストへ送る） */
  kaijuDamage(amount, opts) {
    const k = this.kaiju;
    if (!k || k.dead) return 0;
    if (this.net && !this.net.isHost) {
      if (k.phase === 'intro') return 0;
      this.net.sendDamage(amount, opts);
      k.model.flash(Math.min(0.5, 0.1 + amount / 500));
      const est = amount * (k.mega && k.mega.state === 'charge' ? ATTACKS.mega.vuln : 1);
      if (k.mega && k.mega.state === 'charge') k.mega.got += est; // ゲージは先に動かしておく（正しい値はホストから届く）
      this.onKaijuDamaged(est, opts);
      return est;
    }
    return k.damage(amount, opts);
  }

  killVehicle(v, cause, by, opts = null) {
    if (!v.alive || this.state === 'intro') return;
    if (v.isPlayer && this.debugGod) return;
    if (!v.local) return; // 他の端末の機体は、その端末が判定する
    if (v.kind === 'carrier' && v.hitsLeft > 1 && !(opts && opts.force)) {
      if (this.time < (v.invulnUntil || 0)) return;
      v.hitsLeft--;
      v.invulnUntil = this.time + 3;
      v.onHit(cause);
      this.audio?.explosion(v.position, 1.6);
      this.shakeAt(v.position, 0.8);
      this.hud?.radio('空母 あまつかぜ', v.hitsLeft === 2 ? '被弾！ 火災発生、まだ持ちこたえる！' : '大破！ 次は耐えられない！', 'bad');
      this.net?.vehicleEvent({ e: 'chit', id: v.id, left: v.hitsLeft, cause });
      return;
    }
    this.net?.vehicleEvent({ e: 'vdead', id: v.id, cause, by });
    this.onVehicleKilled(v, cause, by);
  }

  /** 機体がやられた（自分の端末で判定した時も、他の端末から届いた時もここ） */
  onVehicleKilled(v, cause, by) {
    if (!v.alive) return;
    v.kill(cause);
    const text = CAUSE_TEXT[cause] || '撃破';
    this.audio?.explosion(v.position, v.kind === 'fighter' ? 0.6 : 1.4);
    this.shakeAt(v.position, v.kind === 'fighter' ? 0.4 : 1.0);
    if (v.isPlayer) {
      this.stats.playerDeaths++;
      this.hud?.playerDown(text, this.mode.respawn);
      this.deadT = 0;
    } else if (v.kind === 'carrier') {
      this.hud?.killBanner(v, `${text}　補給と再出撃ができなくなった`);
      this.hud?.radio('司令部', '空母あまつかぜ、轟沈…！', 'bad');
      this.audio?.allyLost(true);
    } else {
      this.stats.alliesLost++;
      const msg = v.kind === 'fighter' ? `${v.callsign}、撃墜された！` : `${v.callsign}、轟沈！`;
      this.hud?.radio('司令部', msg, 'bad');
      this.hud?.allyLost(v);
      this.hud?.killBanner(v, text, { mine: !!v.human });
      this.audio?.allyLost(false);
    }
    if (v.human) this.checkAllHumansDown();
  }

  /** 船の端をかすめた（轟沈はしない） */
  onNearMiss(v, point, key) {
    const fx = this.world.effects;
    // 艦の中心線上で一番近い点に爆発を出す
    const f = v.forward;
    const rel = new THREE.Vector3(point.x - v.position.x, 0, point.z - v.position.z);
    const along = THREE.MathUtils.clamp(rel.dot(f), -v.length * 0.45, v.length * 0.45);
    const hp = v.position.clone().addScaledVector(f, along);
    hp.y = Math.max(v.position.y, 0) + 8;
    fx.explosion(hp, 1.6);
    fx.sparks(hp, new THREE.Vector3(0, 1, 0), 14);
    this.audio?.explosion(hp, 1.0);
    this.shakeAt(hp, 0.9);
    if (v.isPlayer) {
      this.hud?.toast(along > 0 ? '艦首をかすめた！ 危なかった…' : '艦尾をかすめた！ 危なかった…', 'good');
      this.world.pipe.post.uFlash.value = 0.25;
      setTimeout(() => { this.world.pipe.post.uFlash.value = 0; }, 90);
    }
  }

  shakeAt(pos, strength) {
    const d = pos.distanceTo(this.camera.position);
    const k = strength * clamp(1 - d / 3200, 0, 1);
    if (k > 0.02) this.rig.shake(k);
  }

  endBattle(result, reason) {
    if (this.state === 'victory' || this.state === 'defeat') return;
    this.state = result;
    this.stats.endTime = this.time;
    this.result = { result, reason };
    this.audio?.music(result);
    this.net?.endBattle(result, reason);
    const wait = result === 'victory' ? 2500 : reason === 'city' ? 8500 : 3500;
    setTimeout(() => this.app.showResult(this), wait);
  }

  // ---------------------------------------------------------------- イベント
  addHazard(h) { this.hazards.push(h); }

  onTelegraph(atk, kind) {
    const now = this.time;
    if (kind === 'bolts') {
      this.addHazard({ type: 'target', target: atk.target, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration });
    } else if (kind === 'sweep') {
      this.addHazard({ type: 'line', a: atk.A, b: atk.B, width: atk.radius * 2, air: atk.air, y: atk.A.y, altMax: atk.air ? 9999 : 60, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration });
    } else if (kind === 'trace') {
      this.addHazard({ type: 'line', a: atk.S, b: atk.E, width: atk.radius * 2 + 30, air: false, altMax: 160, strike: now + atk.telegraph, until: now + atk.telegraph + atk.duration + 1.0 });
    } else if (kind === 'tail' || kind === 'claw') {
      this.addHazard({ type: 'sector', c: this.kaiju.pos.clone(), dir: atk.dirAngle, arc: (atk.arc * Math.PI) / 180, inner: atk.inner, outer: atk.outer, altMax: MELEE_ALT, strike: now + atk.telegraph, until: now + atk.telegraph + 0.4 });
    } else if (kind === 'converge') {
      this.addHazard({ type: 'circle', c: atk.center, r: atk.radius, altMax: 260, strike: now + atk.telegraph, until: now + atk.telegraph + 1.0 });
    }
    const targetIsPlayer = atk.target === this.player;
    const origin = kind === 'tail' || kind === 'claw' ? this.kaiju.pos : (atk.head ? this.kaiju.headSpheres[atk.head.key].c : this.kaiju.pos);
    this.hud?.telegraph(kind, atk, targetIsPlayer, origin);
    this.audio?.telegraph(kind, targetIsPlayer, origin, atk.head ? atk.head.key : null);
    if (this.player && this.player.alive && (targetIsPlayer || kind === 'converge' || kind === 'tail' || kind === 'claw')) this.world.pipe.post.uDanger.value = 0.6;
  }

  onBeamFire(atk, kind) {
    const key = atk.head ? atk.head.key : 'all';
    this.audio?.beam(kind, key, this.kaiju.pos);
    this.shakeAt(this.kaiju.pos, 0.5);
  }

  onFlinch(key, owner) {
    this.stats.flinches++;
    if (owner && owner.isPlayer) { this.stats.playerFlinches++; this.hud?.toast(`${HEAD_INFO[key].name}が怯んだ！ ナイス阻止！`, 'good'); }
    else this.hud?.toast(`${HEAD_INFO[key].name}が怯んだ！`, 'good');
    if (owner && !owner.isPlayer) this.hud?.radio(owner.callsign, `${HEAD_INFO[key].short}の首の溜めを止めた！`);
    this.audio?.kaijuPain(this.kaiju.pos);
  }

  onHeadKilled(key, owner) {
    this.stats.headsKilled++;
    const rest = this.kaiju.aliveHeads.length;
    this.hud?.bigMessage(`${HEAD_INFO[key].name} 撃破！`, rest ? `残り ${rest} 本。残った首が激しくなる` : 'すべての首を倒した', HEAD_INFO[key].css);
    this.hud?.radio('司令部', `${HEAD_INFO[key].name}の沈黙を確認！`, 'good');
    this.audio?.headKilled(this.kaiju.pos);
    this.shakeAt(this.kaiju.pos, 1.2);
  }

  onRage() {
    this.hud?.bigMessage('怒りフェーズ', '怪獣が赤く発光し、動きが速くなった', '#ff4a3a');
    this.hud?.radio('司令部', '目標の発光パターンが変化！ 警戒せよ！', 'bad');
    this.audio?.roar(this.kaiju.pos, 1.2);
    this.shakeAt(this.kaiju.pos, 1.5);
  }

  onKaijuDamaged(dealt, opts) {
    this.stats.damage += dealt;
    const o = opts.owner;
    if (o) {
      o.stats.damage += dealt;
      if (o.isPlayer) { this.stats.playerDamage += dealt; if (dealt > 0) this.hud?.hitMarker(opts.head, opts.kind, dealt); }
    }
  }

  onProjectileHit(o, hit, dealt, kind) { if (kind !== 'gun' && o.owner && o.owner.isPlayer) this.stats.hits++; }
  onFire(v, weapon, pos) {
    if (v.isPlayer) this.stats.shots++;
    this.audio?.fire(weapon, pos, v.isPlayer);
    if (v.isPlayer && weapon === 'torpedo') this.hud?.toast(`魚雷発射！ 残り ${v.torps} 本`, 'ok');
  }
  /** 機関砲を撃っている（毎フレーム） */
  onMG(v, pos) {
    if (v.isPlayer) this.audio?.gun(true, v.kind);
    else this.audio?.distantMG(pos);
  }
  onTorpedoEmpty(v) {
    if (!v.isPlayer || this.time - (this._torpEmptyT || -9) < 1.5) return;
    this._torpEmptyT = this.time;
    this.hud?.toast(this.carrier && this.carrier.alive ? '魚雷がない！ 空母の近くで補給できる' : '魚雷を撃ち尽くした', 'bad');
  }
  onTorpedoHit(o, p) {
    this.onBigExplosion(p, 0.8);
    if (o.owner && o.owner.isPlayer) this.hud?.toast('魚雷命中！', 'good');
  }
  onSplash(p) { this.audio?.splash(p, 0.4); }
  onExplosion(p, s) { this.audio?.explosion(p, s); this.shakeAt(p, s * 0.6); }
  onBigExplosion(p, s) { this.audio?.explosion(p, 2.5); this.shakeAt(p, 2.0 * (s ?? 1)); }
  onFootstep(p) { this.audio?.footstep(p); this.shakeAt(p, 0.45); }
  onRoar(intensity = 1.0) { this.audio?.roar(this.kaiju.pos, intensity); this.rig.shake(0.6 * intensity); }
  onKaijuPain(p, s = 1) { this.audio?.kaijuPain(this.kaiju.pos, s); this.shakeAt(p, 0.5); }
  onSnap(p, key) { this.audio?.snap(p); }
  onStompRaise() { this.audio?.roar(this.kaiju.pos, 0.45, 0.9); }
  onStomp(p) {
    this.audio?.stomp(p);
    this.shakeAt(p, 2.2);
    if (this.player && this.player.alive && p.distanceTo(this.player.position) < 1800) this.hud?.toast('怪獣が海面を踏み鳴らした！', '');
  }
  onKaijuLastRoar() { this.audio?.roar(this.kaiju.pos, 1.4, 0.78); this.rig.shake(1.0); }

  // ---- 極太ビーム（HP2割以下）
  onMegaStart(m) {
    const now = this.time;
    this.addHazard({ type: 'sector', c: this.kaiju.pos.clone(), dir: m.center, arc: (m.M.arc * Math.PI) / 180, inner: 150, outer: m.range, altMax: m.M.altMax, strike: now + m.telegraph, until: now + m.telegraph + m.duration, mega: true });
    this.hud?.bigMessage('極太ビーム', '10秒以内に撃ちまくって止めろ！ 紫の範囲の低空にいると巻き込まれる', '#e07cff');
    this.hud?.radio('司令部', '目標が膨大なエネルギーを集めている！ 全艦全機、総攻撃で阻止せよ！', 'bad');
    this.audio?.megaCharge(true);
    this.audio?.roar(this.kaiju.pos, 1.1, 0.7);
    this.world.pipe.post.uDanger.value = 1;
  }

  onMegaCharge(m, p) {
    this.hud?.setMega({ phase: 'charge', left: m.telegraph - m.t, progress: m.progress });
    this.audio?.megaChargeLevel(p);
    const post = this.world.pipe.post;
    post.uDanger.value = Math.max(post.uDanger.value, 0.35 + 0.4 * p);
  }

  onMegaFire(m) {
    this.hud?.setMega({ phase: 'fire', left: 0, progress: m.progress });
    this.audio?.megaCharge(false);
    this.audio?.megaFire(this.kaiju.pos);
    this.world.pipe.post.uFlash.value = 0.85;
    this.rig.shake(2.2);
    this.hud?.radio('司令部', '発射された…！ 被害を報告せよ！', 'bad');
  }

  onMegaEnd(m, stopped, cancelled = false) {
    this.audio?.megaCharge(false);
    this.hazards = this.hazards.filter((h) => !h.mega);
    if (cancelled) { this.hud?.setMega(null); return; }
    if (stopped) {
      this.hud?.setMega({ phase: 'stopped', left: 0, progress: 1 });
      this.hud?.bigMessage('阻止成功！', '怪獣が大きくよろめいた。今が攻撃のチャンス', '#7fe08a');
      this.hud?.radio('司令部', '発射を阻止した！ 目標は動けない、畳みかけろ！', 'good');
      this.audio?.kaijuPain(this.kaiju.pos, 0.9);
      this.stats.megaStopped = (this.stats.megaStopped || 0) + 1;
    } else this.hud?.chance('C');
    setTimeout(() => this.hud?.setMega(null), stopped ? 2200 : 1200);
  }

  onMegaCity(p) {
    this.cityDamaged = true;
    const fx = this.world.effects;
    for (let i = 0; i < 9; i++) {
      const q = new THREE.Vector3(p.x + rand(-700, 700), rand(10, 60), p.z + rand(0, 400));
      setTimeout(() => fx.explosion(q, rand(5, 8)), i * 120);
    }
    this.hud?.radio('司令部', '沿岸部に被害！ 街が燃えている…！', 'bad');
  }
  onBolt(p) { this.audio?.bolt(p); }
  onWaterColumn(p) { this.audio?.splash(p, 1.2); this.shakeAt(p, 0.25); }
  onMeleeStrike(m) { this.audio?.swipe(this.kaiju.pos); this.shakeAt(this.kaiju.pos, 1.0); }
  onHeadRecover(key) { this.hud?.chance(key); }

  onKaijuReady() {
    this.state = 'battle';
    this.stats.startTime = this.time;
    this.rig.setMode('play');
    this.hud?.show(true);
    this.hud?.bigMessage('迎撃開始', '3つの頭を狙え。溜め中の頭を撃てば怯む', '#e8edf2');
    this.hud?.radio('司令部', '全艦、全機、攻撃開始！ 街に近づけるな！');
    this.audio?.music('battle');
  }

  onKaijuDying() {
    this.hud?.bigMessage('撃破', '怪獣ヨモツ、海へ沈む', '#ffe08a');
    this.hud?.radio('司令部', '目標、崩れ落ちる…！ 全艦、警戒を維持せよ', 'good');
    this.audio?.roar(this.kaiju.pos, 0.8);
    this.audio?.music(null);
    this.endBattleSoon = true;
    this.broadcast.startEnding();
  }

  onKaijuDead() { this.endBattle('victory', 'kaiju'); }

  onCityReached() {
    this.hud?.bigMessage('街が…', '怪獣が上陸した', '#ff4a3a');
    this.broadcast.startDefeat();
    this.endBattle('defeat', 'city');
  }

  skipIntro(fromNet = false) {
    if (this.state !== 'intro') return;
    if (this.net && !this.net.isHost && !fromNet) { this.hud?.toast('登場シーンはホストが飛ばせます'); return; }
    this.kaiju.skipIntro();
    this.broadcast.skip();
    this.rig.pos.copy(this.camera.position);
    if (this.net && this.net.isHost) this.net.sendSkip();
  }

  dispose() {
    if (this.net && this.net.battle === this) this.net.detach();
    this.broadcast?.dispose();
    this.projectiles.dispose();
    for (const v of this.vehicles) v.dispose();
    this.vehicles = [];
    this.kaiju.dispose();
    this.world.telegraph.clear();
    this.hud?.detach();
    this.audio?.stopBattle();
  }
}
