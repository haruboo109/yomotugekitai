// ヨモツ — 海上防衛戦  エントリーポイント
import * as THREE from 'three';
import { World } from './world/world.js';
import { Devices } from './game/input.js';
import { AudioEngine } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { Menu, Loading, PauseMenu, ResultScreen, loadSettings, saveSettings } from './ui/menu.js';
import { Lobby } from './ui/lobby.js';
import { loadAll, assets } from './core/assets.js';
import { Battle } from './game/battle.js';
import { KaijuModel, HEAD_KEYS } from './game/kaijuModel.js';
import { damp } from './core/util.js';
import { KAIJU, WORLD } from './config.js';

const params = new URLSearchParams(location.search);
const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ui = document.getElementById('ui');
    this.settings = loadSettings();
    this.loading = new Loading(this.ui);
    this.devices = new Devices(this.canvas);
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.audio.musicVolume = this.settings.music;
    const isMobile = this.devices.isTouch || /iPad|iPhone|Android/.test(navigator.userAgent);
    this.autoQuality = isMobile ? 'medium' : 'high';
    const q = this.settings.quality === 'auto' ? this.autoQuality : this.settings.quality;
    this.world = new World(this.canvas, { sky: this.settings.sky, quality: q });
    this.hud = new HUD(this.ui);
    this.touch = new TouchControls(this.ui, this.devices);
    this.touch.onPause = () => this.togglePause();
    this.pauseMenu = new PauseMenu(this.ui, this);
    this.result = new ResultScreen(this.ui, this);
    this.menu = null;
    this.battle = null;
    this.paused = false;
    this.clock = new THREE.Clock();
    this.fps = 60;
    this.fpsLow = 0;
    this.fpsHigh = 0;
    addEventListener('resize', () => this.world.resize());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.battle && this.battle.state !== 'victory' && this.battle.state !== 'defeat') this.togglePause(); }
      if (e.code === 'Enter' && this.battle && this.battle.state === 'intro') this.battle.skipIntro();
    });
    this.canvas.addEventListener('pointerdown', () => {
      this.audio.unlock();
      if (this.battle && this.battle.state === 'intro' && this.battle.kaiju.introT > 1.5) this.battle.skipIntro();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.battle && !this.battle.net && !this.paused && this.battle.state === 'battle') this.setPaused(true); });
    window.__app = this;
    // 開発用: ゲーム時間を一気に進める（バックグラウンドで rAF が遅い時の確認用）
    window.__advance = (sec, dt = 1 / 30) => {
      for (let t = 0; t < sec; t += dt) {
        if (this.battle) this.battle.update(dt); else this.updateMenuScene(dt);
        this.world.update(dt);
        this.devices.endFrame();
      }
      this.world.render(dt);
    };
    this.load();
  }

  async load() {
    await loadAll((p) => this.loading.set(p * 0.92, `読み込み中… ${Math.round(p * 100)}%`));
    if (!assets.gltf.kaiju) {
      this.loading.set(1, '怪獣モデルの読み込みに失敗しました（assets/models/kaiju.glb）');
      return;
    }
    this.setupMenuScene();
    this.loading.set(1, '準備完了');
    this.menu = new Menu(this.ui, this);
    this.lobby = new Lobby(this.ui, this);
    this.loading.hide();
    this.loop();
    setTimeout(() => this.benchmark(), 1800);
    if (params.get('quick')) {
      const s = { ...this.settings, vehicle: params.get('quick'), cpuCount: +(params.get('cpu') ?? this.settings.cpuCount), mode: params.get('mode') || this.settings.mode };
      setTimeout(() => this.startBattle(s), 300);
    }
  }

  // ---------------------------------------------------------------- タイトル画面の背景
  setupMenuScene() {
    const w = this.world;
    const k = new KaijuModel(assets.gltf.kaiju, assets.tex.kaijuGlow, KAIJU.scale);
    k.root.position.set(0, -WORLD.kaijuWaterDepth, 0);
    k.root.rotation.y = 0.35;
    w.scene.add(k.root);
    w.shadowExtent = 330 * KAIJU.scale;
    this.menuKaiju = k;
    this.menuShips = [];
    const g = assets.gltf.destroyer;
    if (g) {
      for (const [x, z, h] of [[420, 860, -1.9], [-640, 1180, -1.2]]) {
        const s = g.scene.clone(true);
        s.position.set(x, 0, z);
        s.rotation.y = h;
        s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && o.material.metalnessMap) { o.material.metalnessMap = null; o.material.metalness = 0; } } });
        w.scene.add(s);
        const trail = w.foam.createTrail({ life: 50, w0: 16, spread: 1.0, strength: 0.9, step: 6 });
        this.menuShips.push({ obj: s, h, trail, speed: 9 });
      }
    }
    this.menuT = 0;
    this.menuRoarT = 6;
    w.shadowFocus.set(0, 0, 0);
    w.warnCenter.set(0, 0, 0);
  }

  clearMenuScene() {
    const w = this.world;
    if (this.menuKaiju) { w.scene.remove(this.menuKaiju.root); this.menuKaiju = null; }
    for (const s of this.menuShips || []) { w.scene.remove(s.obj); w.foam.removeTrail(s.trail); }
    this.menuShips = [];
  }

  updateMenuScene(dt) {
    const k = this.menuKaiju;
    if (!k) return;
    this.menuT += dt;
    this.menuRoarT -= dt;
    if (this.menuRoarT <= 0) {
      this.menuRoarT = 14 + Math.random() * 6;
      k.playBody('Roar');
      this.audio.roar(k.root.position, 0.8);
    }
    const t = this.menuT;
    const focus = new THREE.Vector3(Math.sin(t * 0.21) * 600, 60, 600 + Math.cos(t * 0.17) * 240);
    for (const key of HEAD_KEYS) k.aimHead(key, focus, 0.5);
    k.update(dt);
    // 足元の泡
    if (Math.random() < dt * 4) {
      const p = k.boneWorld(Math.random() < 0.5 ? 'shin_L' : 'shin_R', new THREE.Vector3());
      this.world.foam.addDecal(p.x, p.z, 46, 0.5, 3.5, 1.2);
    }
    for (const s of this.menuShips) {
      const f = new THREE.Vector3(Math.sin(s.h), 0, Math.cos(s.h));
      s.obj.position.addScaledVector(f, s.speed * dt);
      s.h += dt * 0.02;
      s.obj.rotation.y = s.h;
      s.obj.position.y = this.world.ocean.heightAt(s.obj.position.x, s.obj.position.z) - 0.2;
      s.trail.push(s.obj.position.x - f.x * 76, s.obj.position.z - f.z * 76, this.world.time, 1);
    }
    const cam = this.world.camera;
    const a = 0.75 + Math.sin(t * 0.05) * 0.5;
    const r = 640 + Math.sin(t * 0.08) * 70;
    cam.position.set(Math.sin(a) * r, 60 + Math.sin(t * 0.11) * 16, Math.cos(a) * r);
    cam.lookAt(-110 + Math.sin(a) * 50, 92, 0);
  }

  // ---------------------------------------------------------------- 画面遷移
  startBattle(settings) {
    this.lastSettings = settings;
    this.settings = settings;
    const { net, plan, ...persist } = settings;
    if (!net) saveSettings(persist);
    this.clearMenuScene();
    if (this.menu) this.menu.show(false);
    if (this.lobby) this.lobby.hide();
    this.result.hide();
    this.setPaused(false);
    if (this.world.preset !== undefined && this.world.sky.preset.label !== { day: '昼', dusk: '夕暮れ', night: '夜' }[settings.sky]) this.world.setSky(settings.sky);
    const q = settings.quality === 'auto' ? this.autoQuality : settings.quality;
    this.world.setQuality(q);
    this.audio.setVolume(settings.volume);
    this.audio.setMusicVolume(settings.music);
    this.battle = new Battle(this, settings);
    this.touch.setMode(this.devices.isTouch ? (settings.vehicle === 'destroyer' ? 'ship' : 'fighter') : null);
    this.fpsLow = this.fpsHigh = 0;
  }

  endBattleCleanup() {
    if (this.battle) { this.battle.dispose(); this.battle = null; }
    this.touch.setMode(null);
    this.hud.show(false);
    this.world.pipe.post.uDanger.value = 0;
  }

  restart() {
    if (this.battle && this.battle.net) { this.backToLobby(); return; }
    this.endBattleCleanup();
    this.result.hide();
    this.startBattle(this.lastSettings || this.settings);
  }

  backToMenu() {
    if (this.net) this.lobby.leave();
    this.endBattleCleanup();
    this.result.hide();
    this.setPaused(false);
    this.setupMenuScene();
    if (this.menu) { this.menu.settings = loadSettings(); this.menu.render(); this.menu.show(true); }
    this.audio.ui('back');
  }

  // ---------------------------------------------------------------- マルチプレイ
  openLobby() {
    if (this.menu) this.menu.show(false);
    this.lobby.open();
  }

  /** ホストが出撃した: 全員がこれを呼ぶ（設定はホストのもの、画質や音量は自分のもの） */
  startMultiBattle(session, hostSettings, plan) {
    if (this.battle) this.endBattleCleanup();
    this.result.hide();
    const local = loadSettings();
    const me = session.me;
    const s = { ...local, mode: hostSettings.mode, difficulty: hostSettings.difficulty, cpuCount: hostSettings.cpuCount, sky: hostSettings.sky, cpuMix: { manual: false, fighters: 0 }, vehicle: me ? me.vehicle : local.vehicle, net: session, plan };
    this.startBattle(s);
    this.hud.toast(`マルチプレイ ― ${session.players.length}人で出撃`, 'ok');
  }

  /** マルチプレイの戦闘が終わってロビーへ戻る（ルームにはいたまま） */
  backToLobby() {
    this.net?.detach();
    this.endBattleCleanup();
    this.result.hide();
    this.setPaused(false);
    this.setupMenuScene();
    this.lobby.open();
  }

  onHostLost() {
    const inBattle = !!this.battle;
    this.lobby.leave();
    if (inBattle) { this.endBattleCleanup(); this.result.hide(); this.setPaused(false); this.setupMenuScene(); }
    this.lobby.open();
    this.lobby.setStatus('ホストとの接続が切れました', 'bad');
  }

  showResult(battle) {
    if (battle !== this.battle) return;
    battle.broadcast?.finish();
    this.hud.show(false);
    this.touch.setMode(null);
    this.result.show(battle);
  }

  togglePause() {
    // マルチプレイは止められない（メニューだけ開く）
    if (this.battle && this.battle.net) { this.pauseMenu.show(!this.pauseMenu.visible, true); return; }
    this.setPaused(!this.paused);
  }
  setPaused(p) {
    if (p && !this.battle) return;
    if (p && this.battle && this.battle.net) return;
    this.paused = p;
    this.pauseMenu.show(p);
    if (this.audio.ctx) { if (p) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
  }

  setSky(name) { this.world.setSky(name); }

  // ---------------------------------------------------------------- 性能
  benchmark() {
    if (document.visibilityState !== 'visible') { setTimeout(() => this.benchmark(), 2000); return; }
    const samples = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
      if (samples.length < 120) requestAnimationFrame(tick);
      else {
        samples.sort((a, b) => a - b);
        const ms = samples[Math.floor(samples.length * 0.6)];
        const fps = 1000 / ms;
        const n = fps >= 58 ? 12 : fps >= 52 ? 8 : fps >= 45 ? 6 : fps >= 38 ? 4 : fps >= 30 ? 2 : 0;
        this.recommended = n;
        if (this.menu) this.menu.setRecommended(n);
        if (fps < 40 && this.settings.quality === 'auto') { this.autoQuality = fps < 30 ? 'low' : 'medium'; this.world.setQuality(this.autoQuality); }
      }
    };
    requestAnimationFrame(tick);
  }

  autoAdjustQuality(dt) {
    if (!this.battle || this.settings.quality !== 'auto' || this.paused || document.visibilityState !== 'visible') return;
    const cur = this.world.pipe.qualityName;
    const i = QUALITY_ORDER.indexOf(cur);
    if (this.fps < 42) { this.fpsLow += dt; this.fpsHigh = 0; } else if (this.fps > 58) { this.fpsHigh += dt; this.fpsLow = 0; } else { this.fpsLow = Math.max(0, this.fpsLow - dt); this.fpsHigh = 0; }
    if (this.fpsLow > 3 && i > 0) { this.world.setQuality(QUALITY_ORDER[i - 1]); this.fpsLow = 0; this.hud.toast(`画質を自動で下げました（${QUALITY_ORDER[i - 1]}）`); }
    if (this.fpsHigh > 15 && i < QUALITY_ORDER.indexOf(this.autoQuality)) { this.world.setQuality(QUALITY_ORDER[i + 1]); this.fpsHigh = 0; }
  }

  loop() {
    const frame = () => {
      requestAnimationFrame(frame);
      const raw = this.clock.getDelta();
      const dt = Math.min(raw, 1 / 20);
      if (raw > 0) this.fps = damp(this.fps, 1 / raw, 2, raw);
      if (!this.paused) {
        if (this.battle) this.battle.update(dt);
        else this.updateMenuScene(dt);
        this.world.update(dt);
      }
      this.world.render(this.paused ? 0 : dt);
      this.devices.endFrame();
      this.autoAdjustQuality(dt);
    };
    frame();
  }
}

if (params.get('view') === 'kaiju') import('./viewer.js').then((m) => m.runViewer());
else new App();
