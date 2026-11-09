// 戦闘中の HUD（最小限: 街までの距離・残弾・爆撃ゲージ・警告 ＋ 首のHP・無線・レーダー）
import * as THREE from 'three';
import { HEAD_KEYS, HEAD_INFO } from '../game/kaijuModel.js';
import { WORLD, SHIP, FIGHTER } from '../config.js';
import { clamp, formatTime } from '../core/util.js';

const ATTACK_TEXT = {
  bolts: { head: 'R', name: '連射ビーム', tip: '横へ動いて弾の間をすり抜けろ', tipShip: '舵を切って弾道から外れろ' },
  sweep: { head: 'C', name: '薙ぎ払い', tip: '高度を変えて光る帯から離れろ！ 溜め中の頭を撃てば止まる', tipShip: '全速で光る帯を前へ抜けろ！ 溜め中の頭を撃てば止まる' },
  trace: { head: 'L', name: '海面ビーム', tip: '赤い線から横へ離れろ（低空は水柱に注意）', tipShip: '赤い線から横へ！ 怪獣の周りを回るように動くと避けやすい' },
  tail: { head: null, name: 'しっぽの薙ぎ払い', tip: '赤い範囲から離れろ' },
  claw: { head: null, name: '爪の薙ぎ払い', tip: '赤い範囲から離れろ' },
  converge: { head: null, name: '収束ビーム', tip: '赤い円から逃げろ！ どれか1本の首を怯ませれば止まる' },
};

const _p = new THREE.Vector3();
/** 画面に出す文字（プレイヤー名など）を HTML として解釈させない */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="city">
          <div class="city-label"><span>街まで</span><b class="city-km">--</b><span class="city-time"></span></div>
          <div class="city-track"><div class="city-fill"></div><div class="city-kaiju">▲</div><div class="city-icon">🏙</div></div>
        </div>
        <div class="heads">
          ${HEAD_KEYS.map((k) => `<div class="head head-${k}" style="--c:${HEAD_INFO[k].css}"><div class="head-name">${HEAD_INFO[k].name}</div><div class="head-bar"><i></i></div><div class="head-tag"></div></div>`).join('')}
        </div>
        <div class="rage-tag">怒り</div>
      </div>
      <div class="warn"><div class="warn-title"></div><div class="warn-tip"></div></div>
      <div class="edge-markers"></div>
      <div class="toast-area"></div>
      <div class="big"><div class="big-title"></div><div class="big-sub"></div></div>
      <div class="radio"></div>
      <div class="allies"></div>
      <canvas class="radar" width="220" height="220"></canvas>
      <div class="weapons"></div>
      <div class="reticle"><div class="ret-ring"></div><div class="ret-text"></div></div>
      <div class="gunsight"><div class="gs-cross"></div><div class="gs-gun">GUN</div><div class="gs-heat"><i></i></div></div>
      <div class="torp-lead"><span>魚雷の狙い目</span></div>
      <div class="torp-marks"></div>
      <div class="look-hint"></div>
      <div class="lockbox"></div>
      <div class="bombmark"></div>
      <div class="chance-marks"></div>
      <div class="down"><div class="down-title">撃破された</div><div class="down-sub"></div><div class="down-timer"></div></div>
      <div class="arena-warn">戦闘区域外 ― 怪獣の方へ戻れ</div>
      <div class="hitmarks"></div>
      <div class="kill-banner"><div class="kb-band"><div class="kb-kind"></div><div class="kb-text"><div class="kb-name"></div><div class="kb-cause"></div></div></div></div>
      <div class="mega">
        <div class="mega-title">極太ビーム 発射まで</div>
        <div class="mega-count">10</div>
        <div class="mega-gauge"><i></i><span>阻止ゲージ ― 撃ちまくって止めろ！</span></div>
      </div>
      <div class="name-tags"></div>
    `;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.q = q;
    this.cityKm = q('.city-km'); this.cityTime = q('.city-time'); this.cityFill = q('.city-fill'); this.cityKaiju = q('.city-kaiju');
    this.heads = {};
    for (const k of HEAD_KEYS) this.heads[k] = { el: q(`.head-${k}`), bar: q(`.head-${k} .head-bar i`), tag: q(`.head-${k} .head-tag`) };
    this.rageTag = q('.rage-tag');
    this.warn = q('.warn'); this.warnTitle = q('.warn-title'); this.warnTip = q('.warn-tip');
    this.edge = q('.edge-markers');
    this.toastArea = q('.toast-area');
    this.big = q('.big'); this.bigTitle = q('.big-title'); this.bigSub = q('.big-sub');
    this.radioEl = q('.radio');
    this.alliesEl = q('.allies');
    this.radar = q('.radar');
    this.rctx = this.radar.getContext('2d');
    this.weapons = q('.weapons');
    this.reticle = q('.reticle'); this.retRing = q('.ret-ring'); this.retText = q('.ret-text');
    this.gunsight = q('.gunsight'); this.gsGun = q('.gs-gun'); this.gsHeat = q('.gs-heat i');
    this.torpLead = q('.torp-lead');
    this.torpMarks = q('.torp-marks');
    this.lookHint = q('.look-hint');
    this.lockbox = q('.lockbox');
    this.bombmark = q('.bombmark');
    this.chanceEl = q('.chance-marks');
    this.down = q('.down'); this.downSub = q('.down-sub'); this.downTimer = q('.down-timer');
    this.arenaWarnEl = q('.arena-warn');
    this.hitmarks = q('.hitmarks');
    this.kb = q('.kill-banner'); this.kbKind = q('.kb-kind'); this.kbName = q('.kb-name'); this.kbCause = q('.kb-cause');
    this.kbQueue = [];
    this.kbUntil = 0;
    this.megaEl = q('.mega'); this.megaCount = q('.mega-count'); this.megaFill = q('.mega-gauge i'); this.megaTitle = q('.mega-title');
    this.nameTags = q('.name-tags');
    this.warnUntil = 0;
    this.bigUntil = 0;
    this.threats = [];
    this.battle = null;
    this.t = 0;
    this.chances = [];
  }

  attach(b) {
    this.battle = b;
    this.radioEl.innerHTML = '';
    this.toastArea.innerHTML = '';
    this.threats = [];
    this.down.classList.remove('on');
    this.kbQueue = [];
    this.kb.classList.remove('on');
    this.setMega(null);
    this.nameTags.innerHTML = ''; this._ntHtml = '';
    this.buildWeapons();
    this.buildAllies();
  }
  detach() { this.battle = null; this.show(false); }
  show(on) { this.el.classList.toggle('hidden', !on); }

  buildWeapons() {
    const p = this.battle.player;
    const touch = this.battle.devices && this.battle.devices.isTouch;
    const key = (k) => (touch ? '' : `<kbd>${k}</kbd>`);
    if (p.kind === 'ship') {
      this.weapons.innerHTML = `
        <div class="w-row"><span class="w-label">主砲 127mm</span><div class="w-gauge gun"><i></i></div>${key('左クリック')}</div>
        <div class="w-row"><span class="w-label">機関砲</span><div class="w-gauge heat"><i></i></div>${key('Space 長押し')}</div>
        <div class="w-row w-torp-row"><span class="w-label">魚雷</span><span class="w-torps">${'<i></i>'.repeat(SHIP.torpedo.count)}</span><b class="w-torp"></b>${key('F')}</div>
        <div class="w-row"><span class="w-label">速力</span><div class="w-speed">${SHIP.speedNames.map((n, i) => `<span data-i="${i}">${n}</span>`).join('')}</div></div>
        <div class="w-row"><span class="w-label">舵</span><div class="w-rudder"><i></i></div><b class="w-kn"></b></div>`;
    } else {
      this.weapons.innerHTML = `
        <div class="w-row"><span class="w-label">速度</span><b class="w-spd"></b><span class="w-label">高度</span><b class="w-alt"></b></div>
        <div class="w-row"><span class="w-label">機関砲</span><div class="w-gauge heat"><i></i></div>${key('左クリック/Space')}</div>
        <div class="w-row"><span class="w-label">${p.cfg.missile ? 'ミサイル' : 'ロケット弾'}</span><b class="w-msl"></b><span class="w-lock"></span>${key('E')}</div>
        <div class="w-row"><span class="w-label">爆撃</span><div class="w-gauge bomb"><i></i></div><b class="w-bombtxt"></b>${key('F')}</div>`;
    }
    this.weaponsKind = p.kind;
    this.gunsight.style.display = p.kind === 'fighter' ? 'block' : 'none';
    this.reticle.style.display = p.kind === 'ship' ? 'block' : 'none';
    this.lookHint.textContent = touch ? '画面をドラッグで見回す' : (p.kind === 'ship' ? '右ドラッグ: 見回す ／ C: 怪獣の方へ戻す' : '右ドラッグ: 見回す ／ C: 怪獣を追うカメラ');
    this.lookHint.classList.add('on');
    clearTimeout(this.lookHintTimer);
    this.lookHintTimer = setTimeout(() => this.lookHint.classList.remove('on'), 14000);
  }

  buildAllies() {
    const b = this.battle;
    const list = b.vehicles.filter((v) => !v.isPlayer);
    this.alliesEl.innerHTML = list.map((v, i) => `<div class="ally" data-i="${i}"><i class="ally-ico ${v.kind}"></i>${esc(v.callsign)}</div>`).join('');
    this.allyList = list;
  }

  allyLost(v) {
    const i = this.allyList ? this.allyList.indexOf(v) : -1;
    if (i >= 0) this.alliesEl.children[i].classList.add('lost');
  }

  /** 味方がやられた時に画面いっぱいに出す帯（続けてやられたら順番に出す） */
  killBanner(v, causeText, opts = {}) {
    const kind = v.kind === 'fighter' ? '撃墜' : v.kind === 'carrier' ? '轟沈' : '撃沈';
    this.kbQueue.push({ kind, name: v.name || v.callsign, cause: causeText, mine: !!opts.mine, color: opts.color });
    if (this.kbQueue.length > 4) this.kbQueue.splice(1, this.kbQueue.length - 4);
    if (this.t >= this.kbUntil) this.nextKillBanner();
  }

  nextKillBanner() {
    const k = this.kbQueue.shift();
    if (!k) { this.kb.classList.remove('on'); return; }
    this.kbKind.textContent = k.kind;
    this.kbName.textContent = k.name;
    this.kbCause.textContent = k.cause ? `― ${k.cause}` : '';
    this.kb.classList.toggle('mine', k.mine);
    this.kb.classList.toggle('carrier', k.kind === '轟沈');
    this.kb.classList.remove('on');
    void this.kb.offsetWidth;
    this.kb.classList.add('on');
    this.kbUntil = this.t + (this.kbQueue.length ? 1.6 : 2.6);
    const post = this.battle && this.battle.world.pipe.post;
    if (post) post.uDanger.value = Math.max(post.uDanger.value, 0.9);
  }

  /** 極太ビームの溜め: 残り秒数と阻止ゲージ（null で隠す） */
  setMega(state) {
    if (!state) { this.megaEl.classList.remove('on', 'fire', 'stopped'); return; }
    this.megaEl.classList.add('on');
    this.megaEl.classList.toggle('fire', state.phase === 'fire');
    this.megaEl.classList.toggle('stopped', state.phase === 'stopped');
    this.megaTitle.textContent = state.phase === 'fire' ? '極太ビーム 発射！' : state.phase === 'stopped' ? '阻止成功！' : '極太ビーム 発射まで';
    const n = state.phase === 'charge' ? String(Math.max(0, Math.ceil(state.left))) : state.phase === 'fire' ? '!!' : '◎';
    if (this.megaCount.textContent !== n) {
      this.megaCount.textContent = n;
      this.megaCount.classList.remove('tick');
      void this.megaCount.offsetWidth;
      this.megaCount.classList.add('tick');
    }
    this.megaFill.style.width = `${clamp(state.progress, 0, 1) * 100}%`;
  }

  /** マルチプレイ: 他のプレイヤーの機体の上に名前を出す */
  updateNameTags() {
    const b = this.battle;
    let html = '';
    for (const v of b.vehicles) {
      if (!v.human || v.isPlayer || !v.alive) continue;
      const p = v.position.clone();
      p.y += v.kind === 'fighter' ? 14 : 45;
      const s = this.project(p);
      if (s.behind || s.x < -50 || s.y < -50 || s.x > innerWidth + 50 || s.y > innerHeight + 50) continue;
      const d = v.position.distanceTo(b.camera.position);
      html += `<div class="ntag ${v.kind}" style="transform:translate(${s.x}px,${s.y}px)"><b>${esc(v.name)}</b><span>${(d / 1000).toFixed(1)}km</span></div>`;
    }
    if (html !== this._ntHtml) { this.nameTags.innerHTML = html; this._ntHtml = html; }
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.toastArea.appendChild(d);
    while (this.toastArea.children.length > 3) this.toastArea.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2800);
  }

  bigMessage(title, sub, color = '#fff') {
    this.bigTitle.textContent = title;
    this.bigSub.textContent = sub || '';
    this.big.style.setProperty('--c', color);
    this.big.classList.remove('on');
    void this.big.offsetWidth;
    this.big.classList.add('on');
    this.bigUntil = this.t + 3.2;
  }

  radio(who, text, kind = '') {
    const d = document.createElement('div');
    d.className = `rmsg ${kind}`;
    d.innerHTML = `<b>${esc(who)}</b>${esc(text)}`;
    this.radioEl.appendChild(d);
    while (this.radioEl.children.length > 5) this.radioEl.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  telegraph(kind, atk, targetIsPlayer, origin) {
    const info = ATTACK_TEXT[kind];
    const color = info.head ? HEAD_INFO[info.head].css : '#ff4a3a';
    const who = info.head ? HEAD_INFO[info.head].name + ' ' : '';
    const meleeNear = (kind === 'tail' || kind === 'claw');
    const relevant = targetIsPlayer || kind === 'converge' || meleeNear;
    if (relevant) {
      this.warnTitle.textContent = `⚠ ${who}${info.name}${targetIsPlayer ? ' ― 狙われている！' : ''}`;
      const isShip = this.battle && this.battle.player && this.battle.player.kind === 'ship';
      this.warnTip.textContent = (isShip && info.tipShip) || info.tip;
      this.warn.style.setProperty('--c', color);
      this.warn.classList.add('on');
      this.warnUntil = this.t + Math.max(1.4, (atk.telegraph || 1.2) + 0.4);
    }
    this.threats.push({ pos: origin.clone(), color, until: this.t + (atk.telegraph || 1.2) + 0.5, big: relevant });
  }

  chance(key) {
    if (!this.battle) return;
    this.chances.push({ key, until: this.t + 1.8 });
  }

  hitMarker(head, kind, dmg) {
    if (kind === 'gun') {
      // 機銃は少しずつ当たるので、まとめて表示する
      this.gunAcc = (this.gunAcc || 0) + dmg;
      this.gunHead = head || this.gunHead;
      if (this.t - (this.gunShown || 0) < 0.6 || this.gunAcc < 4) return;
      dmg = this.gunAcc; head = this.gunHead;
      this.gunAcc = 0; this.gunHead = null; this.gunShown = this.t;
    }
    const d = document.createElement('div');
    d.className = 'hm' + (head ? ' head' : '') + (kind === 'gun' ? ' small' : '');
    d.textContent = Math.round(dmg);
    d.style.left = `${50 + (Math.random() - 0.5) * 6}%`;
    d.style.top = `${46 + (Math.random() - 0.5) * 4}%`;
    this.hitmarks.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  warnArena(on) { this.arenaWarnEl.classList.toggle('on', on); }

  playerDown(cause, practice) {
    this.down.classList.add('on');
    this.downSub.textContent = cause;
    this.downTimer.textContent = practice ? '味方が近づくと復活できる' : '';
  }

  setRespawn(sec) {
    if (sec === null) { this.down.classList.remove('on'); return; }
    this.downTimer.textContent = `味方が近づくと復活（自動復活まで ${Math.ceil(sec)} 秒）`;
  }

  project(p) {
    _p.copy(p).project(this.battle.camera);
    return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight, behind: _p.z > 1 };
  }

  update(dt) {
    const b = this.battle;
    if (!b) return;
    this.t += dt;
    const k = b.kaiju;
    // 街までの距離
    const dist = k.distanceToCity;
    const total = WORLD.cityDistance - 40;
    const prog = clamp(1 - dist / total, 0, 1);
    this.cityKm.textContent = `${(dist / 1000).toFixed(2)} km`;
    const eta = k.speed > 0.5 ? dist / k.speed : Infinity;
    this.cityTime.textContent = isFinite(eta) ? `到達まで ${formatTime(eta)}` : '';
    this.cityFill.style.width = `${prog * 100}%`;
    this.cityKaiju.style.left = `${prog * 100}%`;
    this.el.classList.toggle('danger-city', dist < 900);
    // 首
    for (const key of HEAD_KEYS) {
      const h = k.heads[key], ui = this.heads[key];
      ui.bar.style.width = `${clamp(h.hp / h.maxHp, 0, 1) * 100}%`;
      const tag = !h.alive ? '撃破' : h.state === 'charge' ? '溜め' : h.state === 'fire' ? '発射' : h.state === 'recover' ? '硬直' : h.state === 'stunned' ? '怯み' : '';
      if (ui.tag.textContent !== tag) ui.tag.textContent = tag;
      ui.el.dataset.state = h.alive ? h.state : 'dead';
    }
    this.rageTag.classList.toggle('on', k.rage && !k.dead);
    if (this.t > this.warnUntil) this.warn.classList.remove('on');
    if (this.t > this.bigUntil) this.big.classList.remove('on');
    if (this.kb.classList.contains('on') && this.t >= this.kbUntil) this.nextKillBanner();
    this.updateNameTags();
    const post = b.world.pipe.post;
    post.uDanger.value = Math.max(0, post.uDanger.value - dt * 0.5);
    this.updatePlayer(dt);
    this.updateMarkers();
    this.drawRadar();
  }

  /** 機関砲の熱ゲージ */
  setHeat(el, g) {
    if (!el) return;
    el.style.width = `${clamp(g.heat, 0, 1) * 100}%`;
    el.parentElement.classList.toggle('over', g.over > 0);
    el.parentElement.classList.toggle('hot', g.heat > 0.7 && g.over <= 0);
  }

  updatePlayer(dt) {
    const b = this.battle, p = b.player, k = b.kaiju;
    if (!p) return;
    if (this.weaponsKind !== p.kind) this.buildWeapons();
    const q = this.q;
    this.updateTorpedoMarks(p);
    if (p.kind === 'ship') {
      const g = q('.w-gauge.gun i');
      if (g) g.style.width = `${(1 - p.gunReload / SHIP.gun.reload) * 100}%`;
      this.setHeat(q('.w-gauge.heat i'), p.mg);
      // 魚雷: 残りの本数を●で。次の1本は装填の進み具合
      const icons = q('.w-torps');
      if (icons) {
        const prog = p.torps > 0 ? 1 - p.torpReload / SHIP.torpedo.reload : 0;
        icons.querySelectorAll('i').forEach((el, i) => {
          el.className = i < p.torps ? (i === p.torps - 1 && prog < 1 ? 'loading' : 'ready') : 'empty';
          el.style.setProperty('--p', i === p.torps - 1 ? prog : 1);
        });
      }
      const t = q('.w-torp'); if (t) t.textContent = p.torps > 0 ? (p.torpReload > 0 ? '装填中' : '発射可') : '残りなし';
      // 魚雷の狙い目（怪獣の進む先）
      const ta = p.torpAim;
      if (p.alive && ta && ta.leadValid && p.torps > 0 && !k.dead) {
        const s = this.project(ta.lead);
        if (!s.behind) {
          this.torpLead.style.display = 'block';
          this.torpLead.style.transform = `translate(${s.x}px, ${s.y}px)`;
          this.torpLead.classList.toggle('ready', p.torpReload <= 0);
        } else this.torpLead.style.display = 'none';
      } else this.torpLead.style.display = 'none';
      q('.w-speed')?.querySelectorAll('span').forEach((s) => s.classList.toggle('on', +s.dataset.i === p.speedIdx));
      const r = q('.w-rudder i'); if (r) r.style.left = `${50 + p.rudder * 46}%`;
      const kn = q('.w-kn'); if (kn) kn.textContent = `${Math.round(Math.abs(p.speed) * 1.944)} ノット`;
      // 照準
      const sol = p.gunSolution;
      const m = b.devices.mouse;
      const show = p.alive && b.devices.lastInput !== 'touch' && m.inside;
      this.reticle.style.display = show ? 'block' : 'none';
      if (show) {
        this.reticle.style.transform = `translate(${m.x}px, ${m.y}px)`;
        this.reticle.classList.toggle('ready', sol.ready);
        this.reticle.classList.toggle('far', !sol.inRange);
        const hitK = p.input && p.input.aimPoint && k.intersectSegment(b.camera.position, p.input.aimPoint.clone().lerp(b.camera.position, -0.01));
        this.reticle.classList.toggle('onk', !!hitK);
        this.retText.textContent = sol.valid ? (sol.inRange ? `${(p.position.distanceTo(sol.point) / 1000).toFixed(1)}km ${sol.time.toFixed(1)}s` : '射程外') : '';
      }
    } else {
      this.torpLead.style.display = 'none';
      q('.w-spd').textContent = `${Math.round(p.speed * 3.6)} km/h`;
      q('.w-alt').textContent = `${Math.round(p.position.y)} m`;
      this.setHeat(q('.w-gauge.heat i'), p.gun);
      this.setHeat(this.gsHeat, p.gun);
      // 照準（機首の向き 600m 先）を画面に投影
      if (p.alive) {
        const s = this.project(p.position.clone().addScaledVector(p.dir, 600));
        if (!s.behind) { this.gunsight.style.display = 'block'; this.gunsight.style.left = `${s.x}px`; this.gunsight.style.top = `${s.y}px`; }
        else this.gunsight.style.display = 'none';
        const onK = k && !k.dead && k.intersectSegment(p.position, p.position.clone().addScaledVector(p.dir, p.cfg.gun.range), 4);
        this.gunsight.classList.toggle('onk', !!onK);
      } else this.gunsight.style.display = 'none';
      const max = p.cfg.missile ? p.cfg.missile.count : p.cfg.rocket.count;
      q('.w-msl').textContent = `${p.missiles}/${max}`;
      const lk = q('.w-lock');
      const locked = p.lock.key && p.lock.t > 0.45;
      lk.textContent = p.cfg.missile ? (locked ? `ロック ${HEAD_INFO[p.lock.key].short}` : p.lock.key ? 'ロック中…' : '') : '';
      lk.style.color = locked ? HEAD_INFO[p.lock.key].css : '';
      const bg = q('.w-gauge.bomb i');
      bg.style.width = `${p.bombGauge * 100}%`;
      bg.parentElement.classList.toggle('full', p.bombGauge >= 1);
      q('.w-bombtxt').textContent = p.bombGauge >= 1 ? '投下可能 [F]' : '';
      this.gsGun.classList.toggle('on', p.gunActive);
      // ロックオン枠
      if (p.alive && p.lock.key && k.heads[p.lock.key].alive) {
        const s = this.project(k.headSpheres[p.lock.key].c);
        if (!s.behind) {
          this.lockbox.style.display = 'block';
          this.lockbox.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${locked ? 45 : 0}deg)`;
          this.lockbox.style.borderColor = locked ? HEAD_INFO[p.lock.key].css : '#ffffffaa';
        } else this.lockbox.style.display = 'none';
      } else this.lockbox.style.display = 'none';
      // 爆弾の着弾予想
      if (p.alive && p.bombGauge >= 1) {
        const tFall = Math.sqrt(Math.max(0, (2 * p.position.y) / 9.81));
        const pt = p.position.clone().addScaledVector(p.velocity, tFall * 0.95);
        pt.y = 0;
        const s = this.project(pt);
        if (!s.behind) { this.bombmark.style.display = 'block'; this.bombmark.style.transform = `translate(${s.x}px, ${s.y}px)`; } else this.bombmark.style.display = 'none';
      } else this.bombmark.style.display = 'none';
    }
  }

  /** 自分が撃って走っている魚雷の位置（海中で見えにくいので印を出す） */
  updateTorpedoMarks(p) {
    const list = p.kind === 'ship' ? this.battle.projectiles.torpedoesOf(p) : [];
    let html = '';
    for (const o of list) {
      if (o.phase !== 'run') continue;
      const s = this.project(o.p);
      if (s.behind || s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
      html += `<div class="tm" style="transform:translate(${s.x}px,${s.y}px)"></div>`;
    }
    if (html !== this._tmHtml) { this.torpMarks.innerHTML = html; this._tmHtml = html; }
  }

  updateMarkers() {
    const b = this.battle;
    // 画面外の脅威の方向
    this.threats = this.threats.filter((t) => t.until > this.t);
    let html = '';
    const k = b.kaiju;
    const items = [...this.threats.map((t) => ({ pos: t.pos, color: t.color, cls: t.big ? 'threat big' : 'threat' })), { pos: k.focus.clone(), color: '#b77cff', cls: 'kaiju', label: '怪獣' }];
    for (const it of items) {
      const s = this.project(it.pos);
      const m = 46;
      let { x, y } = s;
      const off = s.behind || x < 0 || y < 0 || x > innerWidth || y > innerHeight;
      if (!off && it.cls === 'kaiju') continue;
      if (s.behind) { x = innerWidth - x; y = innerHeight - y; }
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let dx = x - cx, dy = y - cy;
      if (!off) { html += `<div class="em ${it.cls} in" style="--c:${it.color};transform:translate(${x}px,${y}px)"></div>`; continue; }
      const sc = Math.min((cx - m) / Math.abs(dx || 1), (cy - m) / Math.abs(dy || 1));
      x = cx + dx * sc; y = cy + dy * sc;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      html += `<div class="em ${it.cls}" style="--c:${it.color};transform:translate(${x}px,${y}px) rotate(${ang}deg)"></div>`;
    }
    this.edge.innerHTML = html;
    // 硬直チャンス表示
    this.chances = this.chances.filter((c) => c.until > this.t && k.heads[c.key].alive);
    let ch = '';
    for (const c of this.chances) {
      const s = this.project(k.headSpheres[c.key].c);
      if (s.behind) continue;
      ch += `<div class="chance" style="--c:${HEAD_INFO[c.key].css};transform:translate(${s.x}px,${s.y - 40}px)">チャンス！</div>`;
    }
    this.chanceEl.innerHTML = ch;
  }

  drawRadar() {
    const b = this.battle, ctx = this.rctx, W = 220, R = 104;
    const p = b.player && (b.player.alive || b.player.dying) ? b.player : null;
    const center = p ? p.position : b.kaiju.pos;
    const scale = R / 4200;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,12,18,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(150,190,220,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    // 回転: プレイヤーの向きを上に
    const head = p ? (p.kind === 'fighter' ? p.yaw : p.heading) : Math.PI;
    ctx.rotate(head + Math.PI);
    const tx = (x, z) => [-(x - center.x) * scale, -(z - center.z) * scale];
    ctx.strokeStyle = 'rgba(150,190,220,0.12)';
    for (const r of [1000, 2000, 3000, 4000]) { ctx.beginPath(); ctx.arc(0, 0, r * scale, 0, Math.PI * 2); ctx.stroke(); }
    // 街の海岸線
    const [cx1, cz1] = tx(-8000, WORLD.cityDistance), [cx2, cz2] = tx(8000, WORLD.cityDistance);
    ctx.strokeStyle = 'rgba(255,220,140,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx1, cz1); ctx.lineTo(cx2, cz2); ctx.stroke();
    // 危険範囲
    for (const h of b.hazards) {
      ctx.fillStyle = 'rgba(255,70,50,0.35)'; ctx.strokeStyle = 'rgba(255,90,60,0.8)'; ctx.lineWidth = 1.5;
      if (h.type === 'line') {
        const [ax, az] = tx(h.a.x, h.a.z), [bx, bz] = tx(h.b.x, h.b.z);
        ctx.lineWidth = Math.max(2, h.width * scale); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
      } else if (h.type === 'circle') {
        const [x, z] = tx(h.c.x, h.c.z); ctx.beginPath(); ctx.arc(x, z, h.r * scale, 0, Math.PI * 2); ctx.fill();
      } else if (h.type === 'sector') {
        const [x, z] = tx(h.c.x, h.c.z);
        ctx.beginPath(); ctx.moveTo(x, z);
        const a0 = -h.dir - h.arc / 2 - Math.PI / 2 + Math.PI, a1 = -h.dir + h.arc / 2 - Math.PI / 2 + Math.PI;
        ctx.arc(x, z, h.outer * scale, a0, a1); ctx.closePath(); ctx.fill();
      }
    }
    // 怪獣
    const k = b.kaiju;
    const [kx, kz] = tx(k.pos.x, k.pos.z);
    ctx.fillStyle = k.rage ? '#ff4a3a' : '#b77cff';
    ctx.beginPath(); ctx.arc(kx, kz, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(kx, kz); ctx.lineTo(kx, kz - 16); ctx.stroke();
    // 自分の魚雷
    if (p && p.kind === 'ship') {
      ctx.fillStyle = '#bff3ff';
      for (const o of b.projectiles.torpedoesOf(p)) {
        const [x, z] = tx(o.p.x, o.p.z);
        ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
      }
    }
    // 味方
    for (const v of b.vehicles) {
      if (!v.alive || v.isPlayer) continue;
      const [x, z] = tx(v.position.x, v.position.z);
      ctx.fillStyle = v.kind === 'carrier' ? '#7fd0ff' : v.kind === 'ship' ? '#7fb8ff' : '#a8e6ff';
      if (v.kind === 'carrier') ctx.fillRect(x - 5, z - 5, 10, 10);
      else if (v.kind === 'ship') ctx.fillRect(x - 3, z - 3, 6, 6);
      else { ctx.beginPath(); ctx.arc(x, z, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    // 自機（中央・上向き）
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
