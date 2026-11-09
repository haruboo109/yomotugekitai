// タイトル・設定（出撃前）・一時停止・結果画面
import { DIFFICULTY, MODES, CPU } from '../config.js';
import { formatTime } from '../core/util.js';

const VEHICLES = [
  { id: 'f15', name: '戦闘機 F-15J', sub: 'イーグル', role: '機動力で頭を狙う遊撃', good: '速い・小回り・当たり判定が小さい', bad: '強い武器ほど怪獣に近づく必要がある', weapons: '機関砲（押して乱射）／ミサイル8発（ロックオン）／爆撃（ゲージ）' },
  { id: 'destroyer', name: '護衛艦 やまなみ', sub: 'イージス駆逐艦', role: '遠距離から撃つ火力艦・おとり', good: '主砲で遠くから安定して撃てる・魚雷が強力', bad: '遅く、予告に気づくのが遅れると逃げ切れない', weapons: '127mm主砲（照準してクリック）／機関砲（押して乱射）／魚雷3本' },
  { id: 'zero', name: '零式艦上戦闘機', sub: 'レシプロ機', role: '旋回性能に優れた格闘機', good: '最も小回りがきく・機銃が強い', bad: '遅い・ミサイルの代わりに無誘導ロケット', weapons: '機関砲（押して乱射）／ロケット弾10発／爆撃（ゲージ）' },
];

const STORE_KEY = 'yomotsu-settings-v1';

export function loadSettings() {
  const def = { vehicle: 'destroyer', mode: 'real', difficulty: 'normal', cpuCount: 4, cpuMix: { manual: false, fighters: 2 }, sky: 'day', quality: 'auto', volume: 0.8, music: 0.45, invertPitch: false };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s) return { ...def, ...s, cpuMix: { ...def.cpuMix, ...(s.cpuMix || {}) } };
  } catch (e) { /* 読めなくても既定値で動く */ }
  return def;
}

export function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できない環境 */ }
}

function seg(name, options, value) {
  return `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

export class Menu {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'menu interactive';
    root.appendChild(this.el);
    this.settings = loadSettings();
    this.recommended = null;
    this.render();
  }

  render() {
    const s = this.settings;
    this.el.innerHTML = `
      <div class="title-block">
        <div class="title-kicker">海上防衛戦</div>
        <h1 class="title">ヨモツ</h1>
        <div class="title-sub">三つ首の怪獣を、海で止めろ。</div>
      </div>
      <div class="panel">
        <div class="section">
          <div class="label">機体</div>
          <div class="vehicles">
            ${VEHICLES.map((v) => `
              <button class="vcard ${v.id === s.vehicle ? 'on' : ''}" data-v="${v.id}">
                <div class="vname">${v.name}<small>${v.sub}</small></div>
                <div class="vrole">${v.role}</div>
                <div class="vline good">＋ ${v.good}</div>
                <div class="vline bad">－ ${v.bad}</div>
                <div class="vweap">${v.weapons}</div>
              </button>`).join('')}
          </div>
        </div>
        <div class="grid">
          <div class="section"><div class="label">モード</div>${seg('mode', Object.entries(MODES).map(([k, m]) => [k, m.label]), s.mode)}
            <div class="hint">${s.mode === 'real' ? 'やられた機体は復活しない。自分がやられたらゲームオーバー' : '味方が近づくと復活できる。予告や操作に慣れる用'}</div></div>
          <div class="section"><div class="label">難易度</div>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), s.difficulty)}
            <div class="hint">怪獣のHP・予告の長さ・CPUの腕前がまとめて変わる</div></div>
          <div class="section"><div class="label">時間帯</div>${seg('sky', [['day', '昼'], ['dusk', '夕暮れ'], ['night', '夜']], s.sky)}</div>
          <div class="section"><div class="label">画質</div>${seg('quality', [['auto', '自動'], ['high', '高'], ['medium', '中'], ['low', '低']], s.quality)}</div>
        </div>
        <div class="section cpu">
          <div class="label">CPUの仲間 <b class="cpu-n">${s.cpuCount}</b> 機 <span class="reco">${this.recommended !== null ? `（この端末のおすすめ: ${this.recommended} 機）` : '（性能を測定中…）'}</span></div>
          <input type="range" min="0" max="${CPU.max}" value="${s.cpuCount}" class="cpu-range">
          <div class="cpu-mix">
            ${seg('mix', [['auto', '編成おまかせ'], ['manual', '手動']], s.cpuMix.manual ? 'manual' : 'auto')}
            <div class="mix-manual ${s.cpuMix.manual ? '' : 'hidden'}">戦闘機 <b class="mix-f">${Math.min(s.cpuMix.fighters, s.cpuCount)}</b> ／ 護衛艦 <b class="mix-s">${s.cpuCount - Math.min(s.cpuMix.fighters, s.cpuCount)}</b>
              <input type="range" min="0" max="${s.cpuCount}" value="${Math.min(s.cpuMix.fighters, s.cpuCount)}" class="mix-range"></div>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost help-btn">操作説明</button>
          <button class="btn ghost opt-btn">音量</button>
          <button class="btn ghost mp-btn">マルチプレイ</button>
          <button class="btn primary go">出撃</button>
        </div>
        <div class="opts hidden">
          <label>効果音 <input type="range" min="0" max="1" step="0.05" value="${s.volume}" class="vol"></label>
          <label>音楽 <input type="range" min="0" max="1" step="0.05" value="${s.music}" class="mus"></label>
          <label class="chk"><input type="checkbox" class="inv" ${s.invertPitch ? 'checked' : ''}> 戦闘機の上下を反転</label>
          <label class="chk"><input type="checkbox" class="voice" ${s.voice !== false ? 'checked' : ''}> 中継のアナウンサーの声</label>
        </div>
      </div>
      <div class="help hidden">
        <div class="help-inner">
          <h2>操作説明</h2>
          <div class="help-cols">
            <div><h3>戦闘機（PC）</h3><ul>
              <li><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> 機首の上げ下げ</li>
              <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> 旋回</li>
              <li><kbd>Shift</kbd> 加速　<kbd>Q</kbd> 減速</li>
              <li>左クリック / <kbd>Space</kbd> 長押し 機関砲（撃ち続けると過熱）</li>
              <li><kbd>E</kbd> ミサイル（頭に向けてロックオン）</li>
              <li><kbd>F</kbd> 爆撃（ゲージ満タンで1発）</li>
              <li>右ドラッグ 見回す（離すと戻る）</li>
              <li><kbd>C</kbd> 怪獣を追うカメラに切り替え</li></ul></div>
            <div><h3>護衛艦（PC）</h3><ul>
              <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> 舵（進路を変える）</li>
              <li><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd> 速力を変える</li>
              <li>マウスで照準、左クリックで主砲（緑の輪で発射可能）</li>
              <li><kbd>Space</kbd> 長押し 機関砲（照準へ乱射・過熱に注意）</li>
              <li><kbd>F</kbd> / <kbd>E</kbd> 魚雷（1隻3本まで。海面の点線の方向へ1本ずつ）</li>
              <li>右ドラッグ 視点を自由に回す　<kbd>C</kbd> 怪獣の方へ戻す　ホイール ズーム</li></ul></div>
            <div><h3>iPad</h3><ul>
              <li>戦闘機: 画面左をドラッグして操縦、右のボタンで発射、右側の空いた所をドラッグで見回す</li>
              <li>護衛艦: 画面下の帯を左右にドラッグで舵、タップで主砲、ドラッグで見回す</li></ul>
              <h3>コツ</h3><ul>
              <li>怪獣の攻撃は当たれば一撃でやられるが、必ず光る予告がある</li>
              <li>頭が光って溜めている間に撃ち込むと怯んで止まる</li>
              <li>撃った直後の頭は硬直して大ダメージのチャンス</li>
              <li>HPが2割を切ると「極太ビーム」を10秒溜める。阻止ゲージが満タンになるまで撃ちまくれば止まる（紫の範囲の低空にいると巻き込まれる。戦闘機は高く上がれば助かる）</li>
              <li>空母の近くで補給（ミサイル・魚雷）</li>
              <li>登場シーン（テレビ中継）はクリックか <kbd>Enter</kbd> で飛ばせる</li>
              <li><kbd>Esc</kbd> / <kbd>P</kbd> 一時停止</li></ul>
              <h3>マルチプレイ</h3><ul>
              <li>メニューの「マルチプレイ」から。ホストはルーム名とパスワードを決めて「ルームを作る」、仲間は同じルーム名とパスワードを入れて「ルームに入る」（最大6人・インターネット接続が必要）</li>
              <li>入力した名前があなたの機体の名前になる（船は「○○丸」、戦闘機は「○○号」）</li></ul></div>
          </div>
          <button class="btn primary help-close">閉じる</button>
        </div>
      </div>
      <div class="credit">Blender 5.2 で作ったモデルと three.js で動く ブラウザゲーム ／ ver.1.2</div>`;
    this.bind();
  }

  bind() {
    const s = this.settings;
    const el = this.el;
    const click = () => this.app.audio.ui('click');
    el.querySelectorAll('.vcard').forEach((b) => b.addEventListener('click', () => { s.vehicle = b.dataset.v; click(); this.save(); this.render(); }));
    el.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const name = g.dataset.name, v = b.dataset.v;
        if (name === 'mix') s.cpuMix.manual = v === 'manual';
        else s[name] = v;
        click();
        this.save();
        if (name === 'sky') this.app.setSky(v);
        this.render();
      }));
    });
    const r = el.querySelector('.cpu-range');
    r.addEventListener('input', () => {
      s.cpuCount = +r.value;
      el.querySelector('.cpu-n').textContent = s.cpuCount;
      this.save();
    });
    r.addEventListener('change', () => this.render());
    const mr = el.querySelector('.mix-range');
    if (mr) mr.addEventListener('input', () => {
      s.cpuMix.fighters = +mr.value;
      el.querySelector('.mix-f').textContent = s.cpuMix.fighters;
      el.querySelector('.mix-s').textContent = s.cpuCount - s.cpuMix.fighters;
      this.save();
    });
    el.querySelector('.go').addEventListener('click', () => { this.app.audio.unlock(); this.app.audio.ui('start'); this.app.startBattle({ ...s, cpuMix: { ...s.cpuMix } }); });
    el.querySelector('.mp-btn').addEventListener('click', () => { this.app.audio.unlock(); click(); this.app.openLobby(); });
    el.querySelector('.help-btn').addEventListener('click', () => { click(); el.querySelector('.help').classList.remove('hidden'); });
    el.querySelector('.help-close').addEventListener('click', () => { click(); el.querySelector('.help').classList.add('hidden'); });
    el.querySelector('.opt-btn').addEventListener('click', () => { click(); el.querySelector('.opts').classList.toggle('hidden'); });
    const vol = el.querySelector('.vol'), mus = el.querySelector('.mus'), inv = el.querySelector('.inv');
    vol.addEventListener('input', () => { s.volume = +vol.value; this.app.audio.setVolume(s.volume); this.save(); });
    mus.addEventListener('input', () => { s.music = +mus.value; this.app.audio.setMusicVolume(s.music); this.save(); });
    inv.addEventListener('change', () => { s.invertPitch = inv.checked; this.save(); });
    const voice = el.querySelector('.voice');
    voice.addEventListener('change', () => { s.voice = voice.checked; this.save(); });
    el.addEventListener('pointerdown', () => this.app.audio.unlock(), { once: true });
  }

  setRecommended(n) {
    this.recommended = n;
    const r = this.el.querySelector('.reco');
    if (r) r.textContent = `（この端末のおすすめ: ${n} 機）`;
  }

  save() { saveSettings(this.settings); }
  show(on) { this.el.classList.toggle('hidden', !on); }
}

export class Loading {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.innerHTML = `<div class="ld-title">ヨモツ</div><div class="ld-bar"><i></i></div><div class="ld-text">読み込み中…</div>`;
    root.appendChild(this.el);
  }
  set(p, text) {
    this.el.querySelector('i').style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.querySelector('.ld-text').textContent = text;
  }
  hide() { this.el.classList.add('out'); setTimeout(() => this.el.remove(), 900); }
}

export class PauseMenu {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'pause hidden interactive';
    this.el.innerHTML = `<div class="pause-box"><h2>一時停止</h2>
      <button class="btn primary resume">再開</button>
      <button class="btn ghost restart">最初からやり直す</button>
      <button class="btn ghost quit">メニューへ戻る</button>
      <div class="pause-hint">Esc / P で再開</div></div>`;
    root.appendChild(this.el);
    this.el.querySelector('.resume').addEventListener('click', () => { if (this.mp) this.show(false); else app.setPaused(false); });
    this.el.querySelector('.restart').addEventListener('click', () => app.restart());
    this.el.querySelector('.quit').addEventListener('click', () => app.backToMenu());
  }
  get visible() { return !this.el.classList.contains('hidden'); }
  /** mp=true: マルチプレイ（ゲームは止まらない） */
  show(on, mp = false) {
    this.mp = mp && on;
    this.el.querySelector('h2').textContent = this.mp ? 'メニュー（マルチプレイ中は止まりません）' : '一時停止';
    this.el.querySelector('.resume').textContent = this.mp ? '戦闘に戻る' : '再開';
    this.el.querySelector('.restart').style.display = this.mp ? 'none' : '';
    this.el.querySelector('.quit').textContent = this.mp ? 'ルームから抜けてメニューへ' : 'メニューへ戻る';
    this.el.querySelector('.pause-hint').textContent = this.mp ? 'Esc で閉じる' : 'Esc / P で再開';
    this.el.classList.toggle('hidden', !on);
  }
}

export class ResultScreen {
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'result hidden interactive';
    root.appendChild(this.el);
  }
  show(battle) {
    const st = battle.stats, r = battle.result;
    const win = r.result === 'victory';
    const time = (st.endTime || battle.time) - (st.startTime || 0);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const k = battle.kaiju;
    const distLeft = k.distanceToCity;
    let score = 0;
    if (win) score += 50 + Math.max(0, 30 - time / 20) + Math.min(20, distLeft / 100);
    score += Math.min(30, st.playerDamage / (k.maxHp / 30)) + st.playerFlinches * 3 - st.playerDeaths * 8 - st.alliesLost * 2;
    const rank = win ? (score >= 95 ? 'S' : score >= 78 ? 'A' : score >= 60 ? 'B' : 'C') : 'D';
    const reason = r.reason === 'city' ? '怪獣が街に上陸した' : r.reason === 'player' ? (battle.net ? '全員が撃破された' : '撃破された') : '';
    const mp = !!battle.net;
    const scores = mp ? (battle.net.isHost ? battle.netScores() : battle.netScoreList || []) : null;
    const scoreTable = scores && scores.length ? `<div class="res-mp"><div class="res-mp-title">プレイヤーごとのダメージ</div>${scores.map((s, i) => `<div class="res-mp-row"><span>${i + 1}</span><b>${s.name.replace(/[<>&]/g, '')}</b><i>${s.damage.toLocaleString()}</i></div>`).join('')}</div>` : '';
    const cityNote = battle.cityDamaged ? '（極太ビームで沿岸部に被害が出た）' : '';
    this.el.innerHTML = `<div class="result-box ${win ? 'win' : 'lose'}">
      <div class="res-title">${win ? '迎撃成功' : '迎撃失敗'}</div>
      <div class="res-sub">${win ? `街まで ${(distLeft / 1000).toFixed(2)} km の地点で怪獣を沈めた${cityNote}` : reason}</div>
      <div class="res-rank">評価 <b>${rank}</b></div>
      <div class="res-grid">
        <div><span>戦闘時間</span><b>${formatTime(time)}</b></div>
        <div><span>与えたダメージ</span><b>${Math.round(st.playerDamage).toLocaleString()}</b></div>
        <div><span>溜めを止めた回数</span><b>${st.playerFlinches}</b></div>
        <div><span>倒した首</span><b>${st.headsKilled} / 3</b></div>
        <div><span>命中率</span><b>${acc}%</b></div>
        <div><span>失った味方</span><b>${st.alliesLost}</b></div>
        <div><span>撃破された回数</span><b>${st.playerDeaths}</b></div>
        <div><span>難易度</span><b>${battle.diff.label}・${battle.mode.label}</b></div>
      </div>
      ${scoreTable}
      <div class="res-actions">${mp ? '<button class="btn primary again">ロビーへ戻る</button><button class="btn ghost menu">ルームを出る</button>' : '<button class="btn primary again">もう一度</button><button class="btn ghost menu">メニューへ</button>'}</div></div>`;
    this.el.querySelector('.again').addEventListener('click', () => this.app.restart());
    this.el.querySelector('.menu').addEventListener('click', () => this.app.backToMenu());
    this.el.classList.remove('hidden');
  }
  hide() { this.el.classList.add('hidden'); }
}
