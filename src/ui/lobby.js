// マルチプレイのロビー: 名前と機体を決めて、ルームを作る（ホスト）か、ルーム名とパスワードを入れて入る
import { NetSession, netErrorText, vehicleName, MAX_PLAYERS } from '../net/net.js';
import { makeSpawnPlan } from '../game/battle.js';
import { DIFFICULTY, MODES, CPU } from '../config.js';
import { loadSettings, saveSettings } from './menu.js';

const VEH = [['f15', '戦闘機 F-15J'], ['destroyer', '護衛艦'], ['zero', '零式艦上戦闘機']];
const VEH_LABEL = Object.fromEntries(VEH);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function seg(name, options, value, disabled = false) {
  return `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}" ${disabled ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
}

export class Lobby {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'lobby hidden interactive';
    root.appendChild(this.el);
    this.view = 'entry';
    this.tab = 'create';
    this.busy = false;
    this.status = '';
    this.session = null;
    const s = loadSettings();
    this.form = { name: s.playerName || '', vehicle: s.vehicle || 'f15', room: s.lastRoom || '', pass: '' };
  }

  open() {
    this.view = this.session ? 'room' : 'entry';
    this.status = '';
    this.render();
    this.el.classList.remove('hidden');
  }
  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }

  saveForm() {
    const s = loadSettings();
    s.playerName = this.form.name;
    s.vehicle = this.form.vehicle;
    s.lastRoom = this.form.room;
    saveSettings(s);
  }

  render() {
    if (this.view === 'room' && this.session) this.renderRoom();
    else this.renderEntry();
  }

  // ---------------------------------------------------------------- 入口
  renderEntry() {
    const f = this.form;
    const nm = f.name.trim() || '○○';
    this.el.innerHTML = `
      <div class="lobby-box">
        <h2>マルチプレイ</h2>
        <div class="lb-row"><label>あなたの名前</label>
          <input class="lb-name" maxlength="8" placeholder="例: たろう" value="${esc(f.name)}">
          <div class="lb-preview">この名前があなたの機体の名前になります: 船なら「<b class="pv-ship">${esc(vehicleName(nm, 'destroyer'))}</b>」／戦闘機なら「<b class="pv-plane">${esc(vehicleName(nm, 'f15'))}</b>」</div></div>
        <div class="lb-row"><label>機体</label>${seg('veh', VEH, f.vehicle)}</div>
        <div class="lb-tabs">${[['create', 'ルームを作る（ホスト）'], ['join', 'ルームに入る']].map(([k, l]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="lb-row"><label>ルーム名</label><input class="lb-room" maxlength="20" placeholder="${this.tab === 'create' ? '好きな名前（例: やまびこ部隊）' : 'ホストが決めたルーム名'}" value="${esc(f.room)}"></div>
        <div class="lb-row"><label>パスワード</label><input class="lb-pass" type="password" maxlength="20" placeholder="${this.tab === 'create' ? '参加する人に教える合言葉' : 'ホストから聞いた合言葉'}" value="${esc(f.pass)}"></div>
        <div class="lb-status ${this.statusKind || ''}">${esc(this.status)}</div>
        <div class="lb-actions">
          <button class="btn ghost lb-back">戻る</button>
          <button class="btn primary lb-go" ${this.busy ? 'disabled' : ''}>${this.busy ? '接続中…' : this.tab === 'create' ? 'ルームを作る' : 'ルームに入る'}</button>
        </div>
        <div class="lb-note">インターネット経由で、同じルーム名とパスワードを入れた人どうしがつながります（最大${MAX_PLAYERS}人）。ホストの端末で怪獣とCPUの仲間が動くので、いちばん性能の良い端末がホストになるのがおすすめです。</div>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    const name = q('.lb-name'), room = q('.lb-room'), pass = q('.lb-pass');
    name.addEventListener('input', () => {
      this.form.name = name.value;
      const n = name.value.trim() || '○○';
      q('.pv-ship').textContent = vehicleName(n, 'destroyer');
      q('.pv-plane').textContent = vehicleName(n, 'f15');
    });
    room.addEventListener('input', () => { this.form.room = room.value; });
    pass.addEventListener('input', () => { this.form.pass = pass.value; });
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.go(); });
    this.el.querySelectorAll('.seg[data-name="veh"] button').forEach((b) => b.addEventListener('click', () => { this.form.vehicle = b.dataset.v; this.click(); this.render(); }));
    this.el.querySelectorAll('.lb-tabs button').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.status = ''; this.click(); this.render(); }));
    q('.lb-back').addEventListener('click', () => { this.click(); this.hide(); this.app.menu?.show(true); });
    q('.lb-go').addEventListener('click', () => this.go());
  }

  click() { this.app.audio.ui('click'); }

  setStatus(text, kind = '') {
    this.status = text;
    this.statusKind = kind;
    const el = this.el.querySelector('.lb-status');
    if (el) { el.textContent = text; el.className = `lb-status ${kind}`; }
  }

  async go() {
    if (this.busy) return;
    const f = this.form;
    if (!f.name.trim()) return this.setStatus('名前を入れてください', 'bad');
    if (!f.room.trim()) return this.setStatus('ルーム名を入れてください', 'bad');
    this.app.audio.unlock();
    this.saveForm();
    this.busy = true;
    this.setStatus(this.tab === 'create' ? 'ルームを作っています…' : 'ルームを探しています…');
    this.render();
    const session = new NetSession(this.app);
    const me = { name: f.name.trim(), vehicle: f.vehicle };
    try {
      if (this.tab === 'create') {
        const s = loadSettings();
        await session.host(f.room, f.pass, me, { mode: s.mode, difficulty: s.difficulty, cpuCount: Math.min(s.cpuCount, 8), sky: s.sky });
      } else {
        await session.join(f.room, f.pass, me);
      }
    } catch (e) {
      session.leave();
      this.busy = false;
      this.setStatus(netErrorText(e.code || e.type || 'network'), 'bad');
      this.render();
      return;
    }
    this.busy = false;
    this.attachSession(session);
    this.view = 'room';
    this.status = '';
    this.render();
    this.app.audio.ui('start');
  }

  attachSession(session) {
    this.session = session;
    this.app.net = session;
    session.on('lobby', () => { if (this.view === 'room' && this.visible) this.render(); });
    session.on('joined', (p) => this.app.hud.toast(`${p.name} さんが入りました`, 'ok'));
    session.on('left', (p) => this.app.hud.toast(`${p.name} さんが抜けました`, 'bad'));
    session.on('start', (settings, plan) => this.app.startMultiBattle(session, settings, plan));
    session.on('hostLost', () => this.app.onHostLost());
    session.on('error', (text) => this.setStatus(text, 'bad'));
  }

  leave() {
    if (this.session) this.session.leave();
    this.session = null;
    this.app.net = null;
    this.view = 'entry';
    this.render();
  }

  // ---------------------------------------------------------------- ルームの中
  renderRoom() {
    const ss = this.session;
    const host = ss.isHost;
    const st = ss.settings || {};
    const me = ss.me;
    const rows = ss.players.map((p) => `
      <div class="lb-p ${p.id === ss.myId ? 'me' : ''}">
        ${p.host ? '<span class="lb-host">ホスト</span>' : '<span class="lb-guest">参加</span>'}
        <b>${esc(vehicleName(p.name, p.vehicle))}</b>
        <span class="lb-pv">${esc(p.name)} ／ ${VEH_LABEL[p.vehicle] || ''}</span>
      </div>`).join('');
    this.el.innerHTML = `
      <div class="lobby-box">
        <h2>ルーム「${esc(ss.room)}」</h2>
        <div class="lb-sub">${ss.players.length} / ${MAX_PLAYERS} 人　${host ? '仲間にルーム名とパスワードを伝えてください' : 'ホストの出撃を待っています…'}</div>
        <div class="lb-players">${rows}</div>
        <div class="lb-row"><label>自分の機体</label>${seg('veh', VEH, me ? me.vehicle : this.form.vehicle)}</div>
        <div class="lb-grid">
          <div><label>モード</label>${seg('mode', Object.entries(MODES).map(([k, m]) => [k, m.label]), st.mode, !host)}</div>
          <div><label>難易度</label>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), st.difficulty, !host)}</div>
          <div><label>時間帯</label>${seg('sky', [['day', '昼'], ['dusk', '夕暮れ'], ['night', '夜']], st.sky, !host)}</div>
          <div><label>CPUの仲間 <b class="lb-cpu-n">${st.cpuCount ?? 0}</b> 機</label><input type="range" class="lb-cpu" min="0" max="${Math.min(CPU.max, 8)}" value="${st.cpuCount ?? 0}" ${host ? '' : 'disabled'}></div>
        </div>
        <div class="lb-status ${this.statusKind || ''}">${esc(this.status)}</div>
        <div class="lb-actions">
          <button class="btn ghost lb-leave">ルームを出る</button>
          ${host ? '<button class="btn primary lb-start">出撃</button>' : '<button class="btn primary" disabled>ホストの出撃を待っています</button>'}
        </div>
        <div class="lb-note">マルチプレイ中は一時停止できません。リアルモードでは、やられたら仲間の戦いを観戦します（全員やられたら負け）。</div>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    this.el.querySelectorAll('.seg[data-name="veh"] button').forEach((b) => b.addEventListener('click', () => {
      this.form.vehicle = b.dataset.v; this.saveForm(); ss.pick(b.dataset.v); this.click();
      if (!host) { const m = ss.me; if (m) m.vehicle = b.dataset.v; this.render(); }
    }));
    if (host) {
      this.el.querySelectorAll('.lb-grid .seg').forEach((g) => g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        ss.setSettings({ ...ss.settings, [g.dataset.name]: b.dataset.v }); this.click();
      })));
      const r = q('.lb-cpu');
      r.addEventListener('input', () => { q('.lb-cpu-n').textContent = r.value; });
      r.addEventListener('change', () => ss.setSettings({ ...ss.settings, cpuCount: +r.value }));
      q('.lb-start').addEventListener('click', () => {
        this.app.audio.unlock();
        this.app.audio.ui('start');
        const plan = makeSpawnPlan(ss.settings, ss.players.map(({ id, name, vehicle }) => ({ id, name, vehicle })));
        ss.start(plan);
      });
    }
    q('.lb-leave').addEventListener('click', () => { this.click(); this.leave(); });
  }
}
