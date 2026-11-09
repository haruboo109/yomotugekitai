// カメラ: 船は「機体の後方上空から奥の怪獣を見る」、戦闘機は追尾。
// どちらも右ドラッグ（タッチは画面のドラッグ）で自由に見回せる。
//  船: 回した向きのまま固定（C で怪獣の方へ戻す） / 戦闘機: 離すと後ろに戻る（C で怪獣を追い続けるカメラに切替）
import * as THREE from 'three';
import { clamp, damp, dampVec, rand, angleDiff } from '../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class CameraRig {
  constructor(battle) {
    this.battle = battle;
    this.cam = battle.camera;
    this.pos = this.cam.position.clone();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this.mode = 'intro';
    this.t = 0;
    this.fov = 55;
    this.spectate = null;
    this.kaijuCam = false;     // 戦闘機: 怪獣を画面に入れ続ける
    this.resetting = false;
    this.releaseT = 0;
    this._off = new THREE.Vector3();
  }

  shake(a) { this.shakeAmt = Math.min(2.5, this.shakeAmt + a); }

  setMode(m) { this.mode = m; this.t = 0; }

  get freeLooking() { return Math.abs(this.orbitYaw) > 0.05 || Math.abs(this.orbitPitch) > 0.05; }

  /** 視点操作（右ドラッグ・タッチのドラッグ・ホイール・C） */
  handleInput(dt, v) {
    const dev = this.battle.devices;
    if (!dev) return;
    const m = dev.mouse, t = dev.touch;
    const dx = m.dragDX + t.lookDX * 1.3, dy = m.dragDY + t.lookDY * 1.3;
    const held = m.right || t.looking;
    const isFighter = v && v.kind === 'fighter';
    if (dx || dy) {
      this.resetting = false;
      this.orbitYaw -= dx * 0.0055;
      if (isFighter) this.orbitYaw = clamp(this.orbitYaw, -Math.PI, Math.PI);
      else this.orbitYaw = angleDiff(0, this.orbitYaw);
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, isFighter ? -1.1 : -0.3, isFighter ? 1.1 : 1.0);
    }
    if (m.wheel) this.zoom = clamp(this.zoom * (1 + m.wheel * 0.1), 0.45, 2.4);
    const cHit = dev.hit('KeyC') || t.pressedButtons.has('look');
    if (isFighter) {
      if (cHit) { this.kaijuCam = !this.kaijuCam; this.battle.hud?.toast(this.kaijuCam ? 'カメラ: 怪獣を追う（C で戻す）' : 'カメラ: 機体の後ろ', ''); }
      // 離して少したつと後ろへ戻る
      if (held) this.releaseT = 0; else this.releaseT += dt;
      if (!held && this.releaseT > 0.5) {
        this.orbitYaw = damp(this.orbitYaw, 0, 3.2, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 3.2, dt);
      }
    } else {
      if (cHit) this.resetting = true;
      if (this.resetting) {
        this.orbitYaw = damp(this.orbitYaw, 0, 5, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 5, dt);
        if (Math.abs(this.orbitYaw) < 0.003 && Math.abs(this.orbitPitch) < 0.003) { this.orbitYaw = this.orbitPitch = 0; this.resetting = false; }
      }
    }
  }

  update(dt) {
    const b = this.battle, k = b.kaiju;
    this.t += dt;
    if (this.debugView) {
      // 開発用: 固定視点（関数なら毎フレーム計算）
      const dv = typeof this.debugView === 'function' ? this.debugView() : this.debugView;
      this.cam.position.copy(dv.pos);
      this.cam.lookAt(dv.look);
      if (dv.fov && this.cam.fov !== dv.fov) { this.cam.fov = dv.fov; this.cam.updateProjectionMatrix(); }
      return;
    }
    // テレビ中継の間は、報道ヘリのカメラの映像にする
    const bc = b.broadcast;
    if (bc && bc.controlsCamera) {
      const c = bc.cam;
      this.pos.copy(c.pos);
      this.look.copy(c.look);
      this.cam.position.copy(c.pos);
      this.cam.lookAt(c.look);
      this.fov = c.fov;
      if (Math.abs(this.cam.fov - c.fov) > 0.01) { this.cam.fov = c.fov; this.cam.updateProjectionMatrix(); }
      return;
    }
    const v = this.spectate || b.player;
    if (this.mode !== 'intro') this.handleInput(dt, v);
    const kf = k ? _a.set(k.pos.x, Math.max(30, k.focus.y), k.pos.z) : _a.set(0, 0, 0);
    let wantPos = this.pos.clone(), wantLook = this.look.clone(), lag = 3.2, lookLag = 5, fov = 55;
    if (this.mode === 'intro' && k) {
      // 海から立ち上がる怪獣の周りをゆっくり回る
      const t = this.t;
      const a = -0.55 + t * 0.06;
      const r = 820 - t * 28;
      wantPos.set(k.pos.x + Math.sin(a) * r, 22 + t * 8, k.pos.z + Math.cos(a) * r);
      wantLook.set(k.pos.x, Math.max(25, k.focus.y - 20 + t * 3), k.pos.z);
      lag = 1.5; lookLag = 2; fov = 46;
    } else if (k && k.phase === 'dying' && k.deathT < 15) {
      // 怪獣が海に沈んでいく様子を映す
      const from = v ? _b.set(v.position.x - k.pos.x, 0, v.position.z - k.pos.z) : _b.set(0, 0, 1);
      if (from.lengthSq() < 1) from.set(0, 0, 1);
      from.normalize().applyAxisAngle(UP, 0.35 + k.deathT * 0.03);
      wantPos.set(k.pos.x, 0, k.pos.z).addScaledVector(from, 680 - k.deathT * 8);
      wantPos.y = 38 + k.deathT * 2.5;
      wantLook.set(k.pos.x, Math.max(12, Math.min(kf.y, 120)), k.pos.z);
      lag = 1.0; lookLag = 1.6; fov = 44;
    } else if (v && (v.kind === 'ship' || v.kind === 'carrier')) {
      const dir = k ? new THREE.Vector3(v.position.x - k.pos.x, 0, v.position.z - k.pos.z) : v.forward.clone().negate();
      const dist = dir.length();
      dir.normalize();
      const near = clamp(1 - dist / 1800, 0, 1);
      const back = (330 + near * 170) * this.zoom;
      const up = (60 + near * 70) * this.zoom + this.orbitPitch * 260;
      // 既定の注視点（自艦と怪獣の間）を、回した分だけ艦の周りで回す
      const rel = new THREE.Vector3(0, 22, 0).add(v.position).lerp(kf, 0.6 - near * 0.25).sub(v.position);
      rel.applyAxisAngle(UP, this.orbitYaw);
      dir.applyAxisAngle(UP, this.orbitYaw);
      wantPos.copy(v.position).addScaledVector(dir, back).add(new THREE.Vector3(0, Math.max(14, up), 0));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      wantPos.addScaledVector(side, 40 * this.zoom);
      wantLook.copy(v.position).add(rel);
      lag = this.freeLooking ? 5 : 3.0; lookLag = this.freeLooking ? 7 : 4.5;
      fov = 40 - near * 4;
    } else if (v && v.kind === 'fighter') {
      const d = v.dir ? v.dir.clone() : v.forward.clone();
      if (this.kaijuCam && k && v.alive) {
        // 怪獣を追うカメラ（ドラッグで回り込める）
        const away = v.position.clone().sub(kf).normalize();
        away.applyAxisAngle(UP, this.orbitYaw);
        wantPos.copy(v.position).addScaledVector(away, 62 * this.zoom).add(new THREE.Vector3(0, 16 + this.orbitPitch * 40, 0));
        wantLook.copy(kf).lerp(v.position, 0.25);
        lag = 6; lookLag = 6;
      } else {
        const flat = new THREE.Vector3(d.x, d.y * 0.6, d.z).normalize();
        const off = flat.clone().multiplyScalar(-40 * this.zoom).add(new THREE.Vector3(0, 9.5 * this.zoom, 0));
        const lookV = d.clone().multiplyScalar(45).add(new THREE.Vector3(0, 3, 0));
        if (this.freeLooking) {
          off.applyAxisAngle(UP, this.orbitYaw);
          lookV.applyAxisAngle(UP, this.orbitYaw);
          const right = new THREE.Vector3(off.z, 0, -off.x).normalize();
          off.applyAxisAngle(right, -this.orbitPitch);
          lookV.applyAxisAngle(right, -this.orbitPitch);
        }
        wantPos.copy(v.position).add(off);
        wantLook.copy(v.position).add(lookV);
        lag = 9; lookLag = 12;
      }
      fov = 56 + (v.throttle || 0.5) * 10 - 5;
    } else if (this.mode === 'overview' && k) {
      const a = this.t * 0.08;
      wantPos.set(k.pos.x + Math.sin(a) * 1300, 380, k.pos.z + Math.cos(a) * 1300);
      wantLook.copy(kf);
      lag = 1.2; lookLag = 1.5;
    }
    if (v && !v.alive && v.dying && this.mode !== 'intro' && !(k && k.phase === 'dying' && k.deathT < 15)) {
      const a = this.t * 0.25;
      const r = v.kind === 'fighter' ? 90 : 260;
      wantPos.set(v.position.x + Math.sin(a) * r, Math.max(30, v.position.y + r * 0.45), v.position.z + Math.cos(a) * r);
      wantLook.copy(v.position);
      lag = 2; lookLag = 3;
    }
    dampVec(this.pos, wantPos, lag, dt);
    dampVec(this.look, wantLook, lookLag, dt);
    // 海面より下に潜らない
    const oc = this.battle.world.ocean;
    const minY = oc.heightAt(this.pos.x, this.pos.z) + 4;
    if (this.pos.y < minY) this.pos.y = minY;
    this.cam.position.copy(this.pos);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
    const s = this.shakeAmt * this.shakeAmt;
    if (s > 0.001) {
      this.cam.position.add(this._off.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(s * 2.2));
    }
    this.cam.lookAt(this.look);
    if (s > 0.001) this.cam.rotateZ(rand(-1, 1) * s * 0.01);
    this.fov = damp(this.fov, fov, 2, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}
