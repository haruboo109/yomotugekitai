// 入力: キーボード・マウス・タッチ → InputState
// 機体の「入力元」は人・CPU・ネットワークのどれにも差し替えられるよう、すべて同じ InputState を返す。
import * as THREE from 'three';

export function makeInputState() {
  return {
    steer: 0,          // 船: 舵 / 戦闘機: 左右旋回（-1 左 … +1 右）
    pitch: 0,          // 戦闘機: +1 で機首上げ
    throttle: 0,       // 船: 速力の段階変更要求（-1/0/+1, 1フレームだけ）
    boost: false, brake: false,
    fire: false,       // 船: 主砲（aimPoint へ）
    mg: false,         // 機関砲（押している間乱射）。船: aimPoint へ / 戦闘機: 機首の向きへ
    aimPoint: null,    // THREE.Vector3（ワールド）
    torpedo: false, missile: false, bomb: false,
  };
}

/** 生のデバイス状態（ゲーム全体で1つ） */
export class Devices {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // このフレームに押されたキー
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, left: false, right: false, leftPressed: false, wheel: 0, dragDX: 0, dragDY: 0, inside: false, dragging: false };
    this.touch = { stick: { active: false, x: 0, y: 0 }, steerDrag: 0, tapAim: null, buttons: {}, pressedButtons: new Set(), lookDX: 0, lookDY: 0, looking: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lastInput = this.isTouch ? 'touch' : 'mouse';
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      this.lastInput = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.lastInput = 'mouse';
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2 || e.button === 1) { this.mouse.right = true; e.preventDefault(); }
      canvas.setPointerCapture?.(e.pointerId);
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2 || e.button === 1) this.mouse.right = false;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const m = this.mouse;
      // 右ドラッグ（または中ボタン）で視点を回す
      if (m.right) { m.dragDX += e.movementX || 0; m.dragDY += e.movementY || 0; }
      m.x = e.clientX; m.y = e.clientY;
      m.nx = (e.clientX / innerWidth) * 2 - 1;
      m.ny = -(e.clientY / innerHeight) * 2 + 1;
      m.inside = true;
    });
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
    this.mouse.dragDX = 0;
    this.mouse.dragDY = 0;
    this.touch.tapAim = null;
    this.touch.pressedButtons.clear();
    this.touch.lookDX = 0;
    this.touch.lookDY = 0;
  }
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();

/** プレイヤー操作 */
export class HumanController {
  constructor(devices, battle) {
    this.dev = devices;
    this.battle = battle;
    this.state = makeInputState();
    this.aim = new THREE.Vector3();
    this.aimValid = false;
    this.isHuman = true;
  }

  /** 画面座標から照準点（怪獣に当たればその点、なければ海面）を求める */
  pickAim(nx, ny, camera) {
    _ray.setFromCamera({ x: nx, y: ny }, camera);
    const hit = this.battle.kaiju ? this.battle.kaiju.raycast(_ray.ray) : null;
    if (hit) { this.aim.copy(hit); return true; }
    const r = _ray.ray;
    if (r.direction.y < -0.0005) {
      const t = -r.origin.y / r.direction.y;
      this.aim.copy(r.origin).addScaledVector(r.direction, Math.min(t, 9000));
      this.aim.y = 0;
      return true;
    }
    this.aim.copy(r.origin).addScaledVector(r.direction, 6000);
    this.aim.y = 0;
    return true;
  }

  update(vehicle, dt) {
    const d = this.dev, s = this.state, cam = this.battle.camera;
    const t = d.touch;
    s.throttle = 0;
    s.fire = s.torpedo = s.missile = s.bomb = s.mg = false;
    if (vehicle.kind === 'ship') {
      // 船: 左クリック=主砲 / Space長押し=機関砲 / F・E=魚雷（1隻3本まで）
      let steer = (d.down('KeyD', 'ArrowRight') ? 1 : 0) - (d.down('KeyA', 'ArrowLeft') ? 1 : 0);
      if (t.steerDrag) steer = t.steerDrag;
      s.steer = steer;
      if (d.hit('KeyW', 'ArrowUp') || t.pressedButtons.has('speedUp')) s.throttle = 1;
      if (d.hit('KeyS', 'ArrowDown') || t.pressedButtons.has('speedDown')) s.throttle = -1;
      if (t.tapAim) {
        this.aimValid = this.pickAim(t.tapAim.nx, t.tapAim.ny, cam);
        this.touchAim = { nx: t.tapAim.nx, ny: t.tapAim.ny };
        s.fire = true;
      } else if (d.lastInput === 'touch' && this.touchAim) {
        this.aimValid = this.pickAim(this.touchAim.nx, this.touchAim.ny, cam);
      } else if (d.mouse.inside) {
        this.aimValid = this.pickAim(d.mouse.nx, d.mouse.ny, cam);
        s.fire = d.mouse.left;
      }
      if (t.buttons.fire) { s.fire = true; }
      s.aimPoint = this.aimValid ? this.aim : null;
      s.mg = d.down('Space') || !!t.buttons.mg;
      s.torpedo = d.hit('KeyF', 'KeyE') || t.pressedButtons.has('torpedo');
    } else {
      // 戦闘機: 左クリック/Space長押し=機関砲 / E=ミサイル / F=爆弾
      let steer = (d.down('KeyD', 'ArrowRight') ? 1 : 0) - (d.down('KeyA', 'ArrowLeft') ? 1 : 0);
      let pitch = (d.down('KeyW', 'ArrowUp') ? 1 : 0) - (d.down('KeyS', 'ArrowDown') ? 1 : 0);
      if (this.battle.settings.invertPitch) pitch = -pitch;
      if (t.stick.active) { steer = t.stick.x; pitch = -t.stick.y * (this.battle.settings.invertPitch ? -1 : 1); }
      s.steer = steer;
      s.pitch = pitch;
      s.boost = d.down('ShiftLeft', 'ShiftRight') || !!t.buttons.boost;
      s.brake = d.down('ControlLeft', 'KeyQ') || !!t.buttons.brake;
      s.mg = d.down('Space') || d.mouse.left || !!t.buttons.gun;
      s.missile = d.hit('KeyE') || t.pressedButtons.has('missile');
      s.bomb = d.hit('KeyF') || t.pressedButtons.has('bomb');
    }
    return s;
  }
}
