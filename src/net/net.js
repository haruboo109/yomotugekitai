// マルチプレイの通信
//  ・ルーム = ホストの PeerJS の ID（ルーム名から作る）。参加者はルーム名でホストにつなぐ
//  ・パスワードはホストが確かめる
//  ・ホストが怪獣と CPU の味方を動かし、その出来事を参加者へ送る。各プレイヤーは自分の機体を自分で動かして状態を送る
// PeerJS の公開サーバー（0.peerjs.com）で相手を見つけ、あとは端末どうしが直接（WebRTC）つながる。インターネット接続が必要。
// 開発用: URL に ?net=local を付けると、同じブラウザのタブどうしで通信する（BroadcastChannel）。

export const NET_VERSION = 1;
export const MAX_PLAYERS = 6;
const TICK = 1 / 12; // 状態を送る間隔（秒）

/** 文字列から短いハッシュ（ルーム名 → ID。日本語のルーム名でも使えるように） */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
export const roomPeerId = (room) => `yomotsu${NET_VERSION}-${hash(room.trim())}`;

/** プレイヤー名 → 機体の名前（船は「○○丸」、戦闘機は「○○号」） */
export function vehicleName(name, vehicle) {
  const n = (name || '').trim() || 'ななし';
  if (vehicle === 'destroyer') return /[丸艦]$/.test(n) ? n : `${n}丸`;
  return /[号機]$/.test(n) ? n : `${n}号`;
}

const ERR_TEXT = {
  'unavailable-id': 'そのルーム名はすでに使われています。別の名前にしてください',
  'peer-unavailable': 'ルームが見つかりません。ルーム名を確かめてください（ホストがルームを作っている必要があります）',
  network: 'マッチングサーバーにつながりません。インターネット接続を確かめてください',
  'server-error': 'マッチングサーバーでエラーが起きました。少し待ってからやり直してください',
  'socket-error': 'マッチングサーバーとの通信が切れました',
  'browser-incompatible': 'このブラウザは通信機能（WebRTC）に対応していません',
  timeout: '応答がありません。ルーム名・通信状態を確かめてください',
  password: 'パスワードが違います',
  full: 'ルームが満員です',
  started: 'このルームはすでに出撃しています',
  version: 'ゲームの版が違います。両方とも最新にしてください',
};
export const netErrorText = (code) => ERR_TEXT[code] || `通信エラー（${code}）`;

// ==================================================================== 通信路
/** PeerJS（インターネット越し） */
class PeerTransport {
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map(); // id → DataConnection
    this.peer = null;
  }

  async load() {
    if (!PeerTransport.lib) {
      try { PeerTransport.lib = await import('peerjs'); } catch (e) { throw Object.assign(new Error('peerjs'), { code: 'network' }); }
    }
    return PeerTransport.lib.Peer || PeerTransport.lib.default;
  }

  /** ホスト: ルームの ID で待ち受ける */
  async host(roomId) {
    const Peer = await this.load();
    return new Promise((resolve, reject) => {
      const peer = new Peer(roomId, { debug: 1 });
      this.peer = peer;
      const to = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), 15000);
      peer.on('open', (id) => { clearTimeout(to); this.myId = id; resolve(id); });
      peer.on('error', (err) => { clearTimeout(to); if (!this.myId) reject(Object.assign(err, { code: err.type })); else this.h.onError(err.type); });
      peer.on('connection', (conn) => this.wire(conn));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* 再接続できない */ } });
    });
  }

  /** 参加者: ルームの ID へつなぐ */
  async join(roomId) {
    const Peer = await this.load();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      const to = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), 15000);
      peer.on('error', (err) => { clearTimeout(to); if (!this.hostConn || !this.hostConn.open) reject(Object.assign(err, { code: err.type })); else this.h.onError(err.type); });
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(roomId, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => { clearTimeout(to); this.wire(conn, true); resolve(id); });
      });
    });
  }

  wire(conn, already = false) {
    const ready = () => {
      this.conns.set(conn.peer, conn);
      this.h.onOpen(conn.peer);
    };
    conn.on('data', (d) => this.h.onMessage(conn.peer, d));
    conn.on('close', () => { this.conns.delete(conn.peer); this.h.onClose(conn.peer); });
    conn.on('error', () => { this.conns.delete(conn.peer); this.h.onClose(conn.peer); });
    if (already || conn.open) ready(); else conn.on('open', ready);
  }

  send(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  drop(id) { const c = this.conns.get(id); if (c) setTimeout(() => c.close(), 300); this.conns.delete(id); }
  close() { for (const c of this.conns.values()) try { c.close(); } catch (e) { /* */ } this.conns.clear(); if (this.peer) try { this.peer.destroy(); } catch (e) { /* */ } this.peer = null; }
}

/** 同じブラウザのタブどうし（開発・確認用） */
class LocalTransport {
  constructor(handlers) {
    this.h = handlers;
    this.myId = `L${Math.random().toString(36).slice(2, 9)}`;
    this.ch = new BroadcastChannel('yomotsu-local-net');
    this.conns = new Set();
    this.ch.onmessage = (e) => this.recv(e.data);
  }
  post(to, msg) { this.ch.postMessage({ to, from: this.myId, room: this.room, msg }); }
  recv(p) {
    if (p.room !== this.room || (p.to !== this.myId && p.to !== '*')) return;
    if (p.msg && p.msg.__net === 'hello') {
      if (this.isHost) { this.conns.add(p.from); this.post(p.from, { __net: 'ok' }); this.h.onOpen(p.from); }
      return;
    }
    if (p.msg && p.msg.__net === 'ok') { this.conns.add(p.from); this.hostId = p.from; this.okResolve && this.okResolve(); return; }
    if (p.msg && p.msg.__net === 'bye') { this.conns.delete(p.from); this.h.onClose(p.from); return; }
    if (p.msg && p.msg.__net === 'taken') { if (this.isHost && this.pendingReject) this.pendingReject(Object.assign(new Error('taken'), { code: 'unavailable-id' })); return; }
    if (p.msg && p.msg.__net === 'who' && this.isHost) { this.post(p.from, { __net: 'taken' }); return; }
    if (this.conns.has(p.from)) this.h.onMessage(p.from, p.msg);
  }
  async host(roomId) {
    this.room = roomId; this.isHost = true;
    return new Promise((resolve, reject) => {
      this.pendingReject = reject;
      this.post('*', { __net: 'who' });
      setTimeout(() => { this.pendingReject = null; resolve(this.myId); }, 400);
    });
  }
  async join(roomId) {
    this.room = roomId;
    return new Promise((resolve, reject) => {
      this.okResolve = () => { this.h.onOpen(this.hostId); resolve(this.myId); };
      this.post('*', { __net: 'hello' });
      setTimeout(() => { if (!this.hostId) reject(Object.assign(new Error('nf'), { code: 'peer-unavailable' })); }, 1500);
    });
  }
  send(id, msg) { this.post(id, msg); }
  drop(id) { this.post(id, { __net: 'bye' }); this.conns.delete(id); }
  close() { for (const id of this.conns) this.post(id, { __net: 'bye' }); this.conns.clear(); this.ch.close(); }
}

// ==================================================================== ルームとゲームの通信
export class NetSession {
  constructor(app) {
    this.app = app;
    this.isHost = false;
    this.players = [];    // { id, name, vehicle, host }
    this.settings = null; // ホストが決めた設定
    this.myId = null;
    this.listeners = {};
    this.battle = null;
    this.sendT = 0;
    this.closed = false;
    const local = new URLSearchParams(location.search).get('net') === 'local';
    const handlers = {
      onOpen: (id) => this.onOpen(id),
      onMessage: (id, msg) => this.onMessage(id, msg),
      onClose: (id) => this.onPeerClose(id),
      onError: (code) => this.emit('error', netErrorText(code)),
    };
    this.tr = local ? new LocalTransport(handlers) : new PeerTransport(handlers);
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ...a) { for (const fn of this.listeners[type] || []) fn(...a); }

  get me() { return this.players.find((p) => p.id === this.myId); }
  playerById(id) { return this.players.find((p) => p.id === id); }

  // ---------------------------------------------------------------- ルーム
  async host(room, pass, me, settings) {
    this.isHost = true;
    this.room = room.trim();
    this.pass = pass;
    this.settings = settings;
    await this.tr.host(roomPeerId(this.room));
    this.myId = 'host';
    this.players = [{ id: 'host', name: me.name, vehicle: me.vehicle, host: true }];
    this.emit('lobby');
  }

  async join(room, pass, me) {
    this.isHost = false;
    this.room = room.trim();
    await this.tr.join(roomPeerId(this.room));
    return new Promise((resolve, reject) => {
      this.joinWait = { resolve, reject };
      this.toHost({ t: 'hello', ver: NET_VERSION, name: me.name, vehicle: me.vehicle, pass });
      setTimeout(() => { if (this.joinWait) { this.joinWait = null; reject(Object.assign(new Error('timeout'), { code: 'timeout' })); } }, 10000);
    });
  }

  toHost(msg) { this.tr.send(this.hostPeer, msg); }
  toAll(msg, except = null) { for (const p of this.players) if (p.peer && p.id !== except) this.tr.send(p.peer, msg); }

  onOpen(peer) { if (!this.isHost) this.hostPeer = peer; }

  onPeerClose(peer) {
    if (this.isHost) {
      const p = this.players.find((x) => x.peer === peer);
      if (!p) return;
      this.players = this.players.filter((x) => x !== p);
      this.emit('left', p);
      this.broadcastLobby();
      if (this.battle) this.battle.onNetPlayerLeft(p.id);
    } else if (peer === this.hostPeer && !this.closed) {
      this.emit('hostLost');
    }
  }

  broadcastLobby() {
    if (!this.isHost) return;
    const msg = { t: 'lobby', players: this.players.map(({ id, name, vehicle, host }) => ({ id, name, vehicle, host })), settings: this.settings, room: this.room };
    this.toAll(msg);
    this.emit('lobby');
  }

  setSettings(s) { this.settings = { ...s }; this.broadcastLobby(); }

  pick(vehicle) {
    if (this.isHost) { this.me.vehicle = vehicle; this.broadcastLobby(); }
    else this.toHost({ t: 'pick', vehicle });
  }

  /** ホストが出撃: 配置（どの機体をどこに置くか）を決めて全員に送る */
  start(plan) {
    this.inGame = true;
    this.toAll({ t: 'start', settings: this.settings, players: this.players.map(({ id, name, vehicle }) => ({ id, name, vehicle })), plan });
    this.emit('start', this.settings, plan);
  }

  leave() {
    this.closed = true;
    this.tr.close();
    this.battle = null;
  }

  // ---------------------------------------------------------------- 受信
  onMessage(peer, m) {
    if (!m || typeof m !== 'object') return;
    if (this.isHost) return this.onHostMessage(peer, m);
    return this.onClientMessage(m);
  }

  onHostMessage(peer, m) {
    let p = this.players.find((x) => x.peer === peer);
    if (m.t === 'hello') {
      const reject = (code) => { this.tr.send(peer, { t: 'reject', code }); this.tr.drop(peer); };
      if (m.ver !== NET_VERSION) return reject('version');
      if ((m.pass || '') !== (this.pass || '')) return reject('password');
      if (this.players.length >= MAX_PLAYERS) return reject('full');
      if (this.inGame) return reject('started');
      // 名前は記号（HTML になりうる文字・制御文字）を取り除いてから使う
      const clean = String(m.name || '').replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 10) || 'ななし';
      let name = clean;
      let n = 2;
      while (this.players.some((x) => x.name === name)) name = `${clean.slice(0, 8)}${n++}`;
      const id = `p${Math.random().toString(36).slice(2, 8)}`;
      p = { id, peer, name, vehicle: ['f15', 'zero', 'destroyer'].includes(m.vehicle) ? m.vehicle : 'f15', host: false };
      this.players.push(p);
      this.tr.send(peer, { t: 'welcome', id, name });
      this.emit('joined', p);
      this.broadcastLobby();
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'pick': if (['f15', 'zero', 'destroyer'].includes(m.vehicle)) { p.vehicle = m.vehicle; this.broadcastLobby(); } break;
      case 'vs': if (this.battle) { this.battle.onNetStates(m.vs); this.relay.push(...m.vs); } break;
      case 've': if (this.battle) { this.battle.onNetVehicleEvent(m.ev); this.toAll({ t: 've', ev: m.ev }, p.id); } break;
      case 'dmg': if (this.battle) this.battle.onNetDamage(m); break;
      default: break;
    }
  }

  onClientMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        if (this.joinWait) { this.joinWait.resolve(); this.joinWait = null; }
        break;
      case 'reject':
        if (this.joinWait) { this.joinWait.reject(Object.assign(new Error(m.code), { code: m.code })); this.joinWait = null; }
        break;
      case 'lobby':
        this.players = m.players;
        this.settings = m.settings;
        this.emit('lobby');
        break;
      case 'start':
        this.players = m.players;
        this.settings = m.settings;
        this.inGame = true;
        this.emit('start', m.settings, m.plan);
        break;
      case 'tick':
        if (!this.battle) break;
        if (m.k) this.battle.kaiju.applySnapshot(m.k);
        if (m.vs) this.battle.onNetStates(m.vs);
        break;
      case 'ev': if (this.battle) this.battle.kaiju.applyEvent(m); break;
      case 've': if (this.battle) this.battle.onNetVehicleEvent(m.ev); break;
      case 'skip': if (this.battle) this.battle.skipIntro(true); break;
      case 'end': if (this.battle) this.battle.onNetEnd(m); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- ゲーム中
  attach(battle) {
    this.battle = battle;
    this.relay = [];
    this.sendT = 0;
  }

  detach() { this.battle = null; this.inGame = false; }

  /** ホスト: 怪獣の出来事を全員へ */
  kaijuEvent(ev) { this.toAll({ t: 'ev', ...ev }); }

  /** 機体の出来事（やられた・発射・復活）。ホストは全員へ、参加者はホストへ（ホストが他の人へ回す） */
  vehicleEvent(ev) {
    if (this.isHost) this.toAll({ t: 've', ev });
    else this.toHost({ t: 've', ev });
  }

  sendDamage(amount, o) {
    this.toHost({ t: 'dmg', a: Math.round(amount * 10) / 10, h: o.head || null, f: o.flinch || 1, k: o.kind || '', p: o.part || '', by: o.owner ? o.owner.id : null });
  }

  sendSkip() { this.toAll({ t: 'skip' }); }

  endBattle(result, reason) {
    if (!this.isHost || !this.battle) return;
    this.toAll({ t: 'end', result, reason, scores: this.battle.netScores() });
  }

  update(dt) {
    const b = this.battle;
    if (!b) return;
    this.sendT += dt;
    if (this.sendT < TICK) return;
    this.sendT = 0;
    const mine = b.vehicles.filter((v) => v.local && (v.alive || v.dying) && !v.removed).map((v) => v.netState());
    if (this.isHost) {
      const vs = mine.concat(this.relay);
      this.relay = [];
      this.toAll({ t: 'tick', k: b.kaiju.snapshot(), vs });
    } else if (mine.length) {
      this.toHost({ t: 'vs', vs: mine });
    }
  }
}
