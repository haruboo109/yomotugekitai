// テレビ局（架空の「わだつみテレビ」）の報道ヘリからの生中継
//  ・怪獣が海から現れる登場シーン
//  ・怪獣を倒した時（海に沈んでいく）／上陸された時
// 映像は報道ヘリの機首のカメラから撮っている設定。画面にはテレビのテロップ、アナウンサーの声（ブラウザの音声合成）を重ねる。
import * as THREE from 'three';
import { clamp, damp, rand, smoothstep, angleDiff } from '../core/util.js';
import { assets } from '../core/assets.js';
import { KAIJU_INTRO } from './kaiju.js';
import { KAIJU } from '../config.js';

const S = KAIJU.scale;
export const STATION = { name: 'わだつみテレビ', heli: 'わだつみ1号機' };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function findNode(root, name) {
  let r = null;
  root.traverse((o) => { if (!r && o.name === name) r = o; });
  return r;
}

/** ローターの残像（中心が透けた円盤） */
function rotorDiscTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(20,20,22,0.0)');
  gr.addColorStop(0.15, 'rgba(20,20,22,0.25)');
  gr.addColorStop(0.85, 'rgba(25,25,28,0.32)');
  gr.addColorStop(0.95, 'rgba(200,200,200,0.35)');
  gr.addColorStop(1, 'rgba(20,20,22,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ==================================================================== 報道ヘリ（3Dモデル）
export class NewsHeli {
  constructor(world) {
    this.world = world;
    this.object = new THREE.Group();
    this.object.name = 'NewsHeli';
    const g = assets.gltf.newsheli;
    if (g) {
      const m = g.scene.clone(true);
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          if (o.material) { o.material.envMapIntensity = 1.6; if (o.material.metalnessMap) { o.material.metalnessMap = null; o.material.metalness = 0; } }
        }
      });
      this.object.add(m);
      this.model = m;
      this.mainRotor = findNode(m, 'MainRotor');
      this.tailRotor = findNode(m, 'TailRotor');
      this.camMount = findNode(m, 'CamMount');
      this.beacon = findNode(m, 'Beacon');
    }
    const tex = rotorDiscTexture();
    const discMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    if (this.mainRotor) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(5.35, 40).rotateX(-Math.PI / 2), discMat);
      d.position.copy(this.mainRotor.position).add(new THREE.Vector3(0, 0.05, 0));
      this.mainRotor.parent.add(d);
    }
    if (this.tailRotor) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24).rotateY(Math.PI / 2), discMat);
      d.position.copy(this.tailRotor.position).add(new THREE.Vector3(0.05, 0, 0));
      this.tailRotor.parent.add(d);
    }
    // 赤い衝突防止灯（点滅）
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.3) }));
    if (this.beacon) { this.light.position.copy(this.beacon.position); this.beacon.parent.add(this.light); } else this.object.add(this.light);
    this.object.scale.setScalar(1.6); // 遠くからでも分かるよう少し大きめ
    world.scene.add(this.object);
    this.pos = this.object.position;
    this.yaw = 0; this.pitch = 0; this.bank = 0;
    this.t = 0;
    this.visible = true;
  }

  /** 位置と向きをまとめて決める（向き: 進行方向の yaw。bank は旋回の傾き） */
  place(p, yaw, pitch = -0.06, bank = 0) {
    this.pos.copy(p);
    this.yaw = yaw; this.pitch = pitch; this.bank = bank;
    this.object.rotation.set(0, 0, 0);
    // モデルは +Z が機首（glTF）。yaw は進行方向（sin, cos）
    this.object.quaternion.setFromEuler(new THREE.Euler(-pitch, yaw, -bank, 'YXZ'));
  }

  /** 中継カメラの位置（機首の下のカメラ球） */
  cameraPoint(out = new THREE.Vector3()) {
    this.object.updateMatrixWorld(true);
    if (this.camMount) return this.camMount.getWorldPosition(out);
    return out.copy(this.pos).add(new THREE.Vector3(0, -1, 0));
  }

  update(dt) {
    this.t += dt;
    if (this.mainRotor) this.mainRotor.rotation.y += dt * 33;
    if (this.tailRotor) this.tailRotor.rotation.x += dt * 70;
    this.light.visible = (this.t % 1.2) < 0.12;
  }

  setVisible(v) { this.object.visible = v; this.visible = v; }
  dispose() { this.world.scene.remove(this.object); }
}

// ==================================================================== アナウンサーの声
class Announcer {
  constructor(enabled, volume) {
    this.enabled = enabled && typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.volume = volume;
    this.voice = null;
    if (!this.enabled) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices().filter((v) => /ja/i.test(v.lang));
      const pref = ['Nanami', 'Keita', 'Google 日本語', 'Haruka', 'Ayumi', 'Sayaka', 'Ichiro', 'Kyoko', 'Otoya'];
      this.voice = pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs[0] || null;
    };
    pick();
    if (!this.voice) speechSynthesis.addEventListener?.('voiceschanged', pick, { once: true });
  }
  say(text, rate = 1.12) {
    if (!this.enabled) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[「」『』]/g, ''));
      u.lang = 'ja-JP';
      if (this.voice) u.voice = this.voice;
      u.rate = rate;
      u.pitch = 1.05;
      u.volume = clamp(this.volume, 0, 1);
      speechSynthesis.speak(u);
    } catch (e) { /* 音声合成が使えない環境 */ }
  }
  stop() { if (this.enabled) try { speechSynthesis.cancel(); } catch (e) { /* */ } }
}

// ==================================================================== 中継の画面（テロップ）
const TICKER = [
  '【避難情報】沿岸部の全域に避難指示が出ています。高い場所へ避難してください',
  '【交通】湾岸道路は全線で通行止め　鉄道は沿岸の路線で運転を見合わせ',
  '【政府】防衛出動を命令　海上自衛隊・航空自衛隊が現場海域へ',
  '【気象】現場付近の波の高さ3メートル　うねりを伴い次第に高くなる見込み',
];

class Overlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'tv hidden';
    this.el.innerHTML = `
      <div class="tv-static"></div>
      <div class="tv-frame">
        <div class="tv-tl"><span class="tv-live"><i></i>LIVE</span><span class="tv-chu">中継</span><div class="tv-src">${STATION.heli}から</div></div>
        <div class="tv-tr"><div class="tv-logo"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 15c5-7 9-7 13 0s8 7 12 0 8-7 11-2" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M2 21c5-5 9-5 13 0s8 5 12 0 8-5 11-1" fill="none" stroke="#7fd4ff" stroke-width="2.4" stroke-linecap="round"/></svg><b>${STATION.name}</b></div><div class="tv-clock"></div></div>
        <div class="tv-telop"></div>
        <div class="tv-lower"><span class="tv-tag">緊急</span><span class="tv-title"></span></div>
        <div class="tv-ticker"><div class="tv-ticker-in">${TICKER.join('　　◆　　')}　　◆　　${TICKER.join('　　◆　　')}</div></div>
      </div>
      <div class="tv-cap"></div>`;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    // 切り替え時の砂嵐の模様
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    q('.tv-static').style.backgroundImage = `url(${cv.toDataURL()})`;
    this.frame = q('.tv-frame');
    this.title = q('.tv-title');
    this.tag = q('.tv-tag');
    this.telop = q('.tv-telop');
    this.clock = q('.tv-clock');
    this.staticEl = q('.tv-static');
    this.cap = q('.tv-cap');
    this.staticUntil = 0;
    this.clockBase = new Date();
  }
  show(on) { this.el.classList.toggle('hidden', !on); }
  frameOn(on) { this.frame.classList.toggle('on', on); }
  setTitle(tag, text) {
    if (this.tag.textContent !== tag) this.tag.textContent = tag;
    this.tag.classList.toggle('sokuho', tag === '速報');
    if (this.title.textContent !== text) {
      this.title.textContent = text;
      this.title.classList.remove('in'); void this.title.offsetWidth; this.title.classList.add('in');
    }
  }
  setTelop(text) {
    if (this.telop.textContent === text) return;
    this.telop.textContent = text;
    this.telop.classList.remove('in'); void this.telop.offsetWidth;
    if (text) this.telop.classList.add('in');
  }
  setCaption(text) { this.cap.textContent = text || ''; this.cap.classList.toggle('on', !!text); }
  flashStatic(dur, now) { this.staticEl.classList.add('on'); this.staticUntil = now + dur; }
  update(t) {
    if (this.staticEl.classList.contains('on')) {
      this.staticEl.style.backgroundPosition = `${Math.random() * 256}px ${Math.random() * 256}px`;
      if (t > this.staticUntil) this.staticEl.classList.remove('on');
    }
    const d = new Date(this.clockBase.getTime() + t * 1000);
    const s = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (this.clock.textContent !== s) this.clock.textContent = s;
  }
  remove() { this.el.remove(); }
}

// ==================================================================== 中継の進行
/**
 * 台本: 時刻ごとにテロップ・アナウンサーの言葉・カメラの撮り方を切り替える。
 * shot: { from, kind: 'ext'|'cam', fov: [始め, 終わり], target: 関数 }
 */
export class Broadcast {
  constructor(battle) {
    this.battle = battle;
    this.world = battle.world;
    this.audio = battle.audio;
    const s = battle.settings || {};
    this.heli = new NewsHeli(this.world);
    this.overlay = new Overlay(battle.app.ui);
    this.voice = new Announcer(s.voice !== false, (s.volume ?? 0.8) * 1.1);
    this.active = null;
    this.t = 0;
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30 };
    this.smoothLook = new THREE.Vector3();
    this.events = [];
    this.orbitA = 0;
    this.wob = new THREE.Vector3();
  }

  get controlsCamera() { return !!this.active && this.shot !== null; }

  /** 新しい中継を始める前の片付け */
  reset(kind) {
    if (this.active) this.finish(true);
    this.active = kind;
    this.t = 0;
    this.shot = null;
    this.ei = 0;
    this.glitchUntil = 0;
    this.telopUntil = 0;
    this.pendingCut = null;
  }

  // ---------------------------------------------------------------- 登場シーン
  startIntro() {
    this.reset('intro');
    // ヘリは怪獣の正面側（街の側）を回る: 首がこちらを向いて現れるように
    this.orbitA = 0.1;
    this.introR = 1700;
    const E = KAIJU_INTRO.emergeAt;
    this.events = [
      { t: 0.0, fn: () => { this.setShot('ext'); this.overlay.show(true); this.overlay.frameOn(false); this.overlay.setCaption(`${STATION.name} 報道ヘリ「${STATION.heli}」`); this.audio?.setHeli(0.5); } },
      { t: 3.4, fn: () => this.cut('cam', () => { this.overlay.setCaption(''); this.overlay.frameOn(true); this.overlay.setTitle('緊急', '沖合で異変 海面が大きく盛り上がる'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.18); }) },
      { t: 3.9, fn: () => this.say('こちら、沖合上空の、わだつみ1号機からお伝えしています。') },
      { t: 6.6, fn: () => this.say('ご覧ください！ 海面が、大きく盛り上がっています！') },
      { t: E + 1.2, fn: () => { this.say('あっ！ 何かが、何かが出てきます！'); this.overlay.setTitle('緊急', '沖合に巨大生物が出現'); } },
      { t: E + 3.6, fn: () => this.say('巨大な生き物です！ 首が、首が三つあります！') },
      { t: E + 6.4, fn: () => this.glitch(0.7) },
      { t: E + 7.6, fn: () => { this.say('自衛隊の艦隊と戦闘機が、現場に到着しました！ 沿岸部の皆さんは、直ちに避難してください！'); this.overlay.setTitle('緊急', '自衛隊が現場に到着　沿岸部に避難指示'); } },
      { t: KAIJU_INTRO.end - 0.25, fn: () => this.cut(null, () => this.finish()) },
    ];
    this.ei = 0;
  }

  // ---------------------------------------------------------------- 倒した時（海に沈む）
  startEnding() {
    this.reset('ending');
    const k = this.battle.kaiju, p = this.battle.player;
    const from = p ? Math.atan2(p.position.x - k.pos.x, p.position.z - k.pos.z) : 0;
    this.orbitA = from + 0.9;
    this.events = [
      { t: 0.7, fn: () => this.cut('cam', () => { this.overlay.show(true); this.overlay.frameOn(true); this.overlay.setTitle('速報', '怪獣の動きが止まる'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.16); this.battle.hud?.show(false); }) },
      { t: 1.1, fn: () => this.say('速報です！ 怪獣の首が、すべて沈黙した模様です！') },
      { t: 4.2, fn: () => this.say('あっ、崩れ落ちていきます！') },
      { t: 7.0, fn: () => { this.say('沈んでいきます！ 怪獣が、海の底へ沈んでいきます！'); this.overlay.setTitle('速報', '怪獣 海へ沈む'); } },
      { t: 11.8, fn: () => { this.say('やりました！ 街は、街は守られました！'); this.overlay.setTitle('速報', '自衛隊が怪獣を撃退　街は守られた'); } },
    ];
    this.ei = 0;
  }

  // ---------------------------------------------------------------- 上陸された時
  startDefeat() {
    this.reset('defeat');
    this.orbitA = Math.PI * 0.75;
    this.events = [
      { t: 0.2, fn: () => this.cut('cam', () => { this.overlay.show(true); this.overlay.frameOn(true); this.overlay.setTitle('速報', '怪獣が上陸　沿岸部に甚大な被害'); this.audio?.tvJingle(true); this.audio?.setTV(true); this.audio?.setHeli(0.16); this.battle.hud?.show(false); }) },
      { t: 0.7, fn: () => this.say('怪獣が、ついに上陸しました…！ 繰り返します、怪獣が上陸しました！') },
      { t: 5.0, fn: () => this.say('沿岸部の皆さんは、一刻も早く避難してください！') },
    ];
    this.ei = 0;
  }

  say(text) {
    this.overlay.setTelop(`「${text}」`);
    this.voice.say(text);
    this.telopUntil = this.t + Math.max(3.2, text.length * 0.16);
  }

  setShot(kind) { this.shot = kind; this.shotT = 0; this.zoomT = 0; }

  /** 画面の切り替え（雑音を挟む）。切り替えは中継の時計で 0.14 秒後 */
  cut(kind, then) {
    this.overlay.flashStatic(0.28, this.t);
    this.audio?.tvStatic(0.28);
    this.battle.world.pipe.post.uGlitch.value = 1;
    this.pendingCut = { at: this.t + 0.14, kind, then };
  }

  glitch(dur) { this.glitchUntil = this.t + dur; this.audio?.tvStatic(dur * 0.6); }

  skip() {
    if (this.active !== 'intro') return;
    this.voice.stop();
    this.cut(null, () => this.finish());
  }

  /** 中継を終えてゲームの画面に戻る */
  finish(silent = false) {
    this.voice.stop();
    this.active = null;
    this.shot = null;
    this.pendingCut = null;
    this.overlay.staticEl.classList.remove('on');
    this.overlay.staticUntil = 0;
    this.overlay.show(false);
    this.overlay.frameOn(false);
    this.overlay.setTelop('');
    this.overlay.setCaption('');
    const post = this.battle.world.pipe.post;
    post.uTV.value = 0;
    post.uGlitch.value = 0;
    if (!silent) { this.audio?.setTV(false); this.audio?.setHeli(0.03); }
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt) {
    this.heli.update(dt);
    const b = this.battle, k = b.kaiju, post = b.world.pipe.post;
    if (!this.active) {
      this.flyAmbient(dt);
      return;
    }
    this.t += dt;
    while (this.ei < this.events.length && this.t >= this.events[this.ei].t) this.events[this.ei++].fn();
    if (this.pendingCut && this.t >= this.pendingCut.at) {
      const c = this.pendingCut;
      this.pendingCut = null;
      if (c.kind) this.setShot(c.kind);
      c.then && c.then();
      if (!this.active) return;
    }
    if (this.telopUntil && this.t > this.telopUntil) { this.overlay.setTelop(''); this.telopUntil = 0; }
    this.overlay.update(this.t);
    // 映像の質感
    const onCam = this.shot === 'cam';
    post.uTV.value = damp(post.uTV.value, onCam ? 1 : 0.25, 8, dt);
    const g = this.glitchUntil && this.t < this.glitchUntil ? 0.6 + Math.random() * 0.4 : 0;
    post.uGlitch.value = Math.max(g, post.uGlitch.value - dt * 5);
    this.shotT = (this.shotT || 0) + dt;
    if (this.active === 'intro') this.updateIntro(dt, k);
    else this.updateOrbitShot(dt, k);
  }

  /** 登場シーンの撮り方 */
  updateIntro(dt, k) {
    const t = this.t, E = KAIJU_INTRO.emergeAt;
    // ヘリは怪獣の周りを、遠くから近づきながら回る
    this.introR = damp(this.introR, t < E ? 1300 : 950, 0.25, dt);
    this.orbitA += dt * (t < E ? 0.03 : 0.045);
    const a = this.orbitA, R = this.introR;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, 230 - Math.min(1, t / 12) * 40, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.12); // 円の接線方向へ飛ぶ（カメラ球は怪獣の方へ向く）
    const c = this.cam;
    if (this.shot === 'ext') {
      // ヘリの横（少し前・下）から撮る外の映像
      const fw = new THREE.Vector3(Math.sin(this.heli.yaw), 0, Math.cos(this.heli.yaw));
      const right = new THREE.Vector3(fw.z, 0, -fw.x);
      const base = this.heli.pos.clone();
      c.pos.copy(base).addScaledVector(fw, 34 - t * 4).addScaledVector(right, -26).add(new THREE.Vector3(0, -7 + t * 1.5, 0));
      c.look.copy(base).addScaledVector(fw, 4);
      c.fov = 40;
      this.applyCam(c.pos, c.look, c.fov, dt, 0.25);
      return;
    }
    // 機首のカメラ（望遠）
    this.heli.cameraPoint(c.pos);
    let target, fov;
    if (t < E + 0.8) { target = _v2.set(k.pos.x, 4, k.pos.z); fov = 16 + Math.sin(t * 0.4) * 1.2; }
    else if (t < E + 3.4) { target = _v2.set(k.pos.x, Math.max(20, k.focus.y - 30), k.pos.z); fov = 22 + (t - E - 0.8) * 3.2; }
    else if (t < E + 7.2) { target = _v2.copy(k.headSpheres.C.c); fov = 30 - Math.min(1, (t - E - 3.4) / 2.5) * 16; }
    else {
      // 最後は到着した艦隊（自分の機体）を映す
      const p = this.battle.player;
      const u = smoothstep(E + 7.2, E + 9.0, t);
      target = _v2.copy(k.focus).lerp(p ? p.position : k.focus, u * 0.85);
      fov = 14 + u * 14;
    }
    this.applyCam(c.pos, target, fov, dt, 1);
  }

  /** 倒した時・上陸された時: ヘリが怪獣の周りを回りながら望遠で追う */
  updateOrbitShot(dt, k) {
    const ending = this.active === 'ending';
    this.orbitA += dt * 0.035;
    const R = ending ? 820 : 1100, H = ending ? 170 : 240;
    const a = this.orbitA;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, H, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.1);
    if (!this.shot) return;
    const c = this.cam;
    this.heli.cameraPoint(c.pos);
    const target = _v2.set(k.pos.x, clamp(k.focus.y - 10, 8, 140), k.pos.z);
    const fov = ending ? 24 - smoothstep(0, 12, this.t) * 8 : 26;
    this.applyCam(c.pos, target, fov, dt, 1);
  }

  /** カメラに反映（ヘリの揺れ・カメラマンの手ぶれ風の遅れ） */
  applyCam(pos, target, fov, dt, wob) {
    this.smoothLook.lerp(target, 1 - Math.exp(-dt * 2.6));
    if (this.smoothLook.lengthSq() < 1) this.smoothLook.copy(target);
    const t = this.t;
    // ヘリの振動（ローターの細かい揺れ）と、ゆっくりした漂い
    this.wob.set(Math.sin(t * 1.3) * 2.2 + Math.sin(t * 3.1) * 0.6, Math.sin(t * 0.9 + 1) * 1.6 + Math.sin(t * 19) * 0.15, Math.cos(t * 1.1) * 2.0);
    // カメラ球から撮影方向へ少し出した位置にする（自分のヘリのそりや胴体が映り込まないように）
    this.cam.pos.copy(pos).addScaledVector(_v.subVectors(this.smoothLook, pos).normalize(), 14);
    this.cam.look.copy(this.smoothLook).addScaledVector(this.wob, wob * Math.max(0.5, fov / 20));
    this.cam.fov = fov;
  }

  /** 中継以外の時: ヘリは遠くで旋回しながら様子を撮っている */
  flyAmbient(dt) {
    const k = this.battle.kaiju;
    if (!k) return;
    this.orbitA += dt * 0.02;
    const a = this.orbitA, R = 2300;
    const hp = _v.set(k.pos.x + Math.sin(a) * R, 380, k.pos.z + Math.cos(a) * R);
    this.heli.place(hp, a + Math.PI / 2, -0.05, 0.12);
  }

  dispose() {
    this.voice.stop();
    this.heli.dispose();
    this.overlay.remove();
    const post = this.world.pipe.post;
    post.uTV.value = 0;
    post.uGlitch.value = 0;
  }
}
