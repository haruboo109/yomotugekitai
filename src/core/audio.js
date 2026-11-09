// 音: Web Audio API による合成（外部の音声素材なし・ライセンスの心配なし）
import * as THREE from 'three';

const HEAD_PITCH = { R: 1.6, C: 0.7, L: 1.0, all: 0.8 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVolume = 0.45;
    this.listener = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
    this.loops = {};
    this.lastPlay = {};
  }

  /** ユーザー操作の後に呼ぶ（ブラウザの自動再生制限のため） */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    // テレビ中継の時は「テレビのスピーカーの音」にする（低音と高音を削る）
    this.tvHP = ctx.createBiquadFilter(); this.tvHP.type = 'highpass'; this.tvHP.frequency.value = 10;
    this.tvLP = ctx.createBiquadFilter(); this.tvLP.type = 'lowpass'; this.tvLP.frequency.value = 20000;
    this.master.connect(this.tvHP).connect(this.tvLP).connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVolume; this.musicBus.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    // 残響
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.55;
    this.revSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = this.makeNoise(3, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.startAmbience();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }

  makeNoise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  makeImpulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  noise(buf = this.noiseBuf, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (!loop) s.playbackRate.value = 0.85 + Math.random() * 0.3;
    return s;
  }

  /** 位置つきの出力先（距離減衰・左右・遅延） */
  spatial(pos, ref = 200, maxDelay = 2.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let gain = 1, delay = 0, pan = 0;
    if (pos) {
      const d = pos.distanceTo(this.listener);
      gain = ref / (ref + d);
      delay = Math.min(maxDelay, d / 340) * 0.6;
      const dir = pos.clone().sub(this.listener).normalize();
      pan = THREE.MathUtils.clamp(dir.dot(this.right), -1, 1) * 0.8;
      // 遠い音は高音が抜ける
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = THREE.MathUtils.clamp(18000 * Math.pow(ref / (ref + d), 0.6), 400, 18000);
      g.connect(lp);
      if (p) { p.pan.value = pan; lp.connect(p); p.connect(this.sfx); } else lp.connect(this.sfx);
      if (gain > 0.02) {
        const send = ctx.createGain(); send.gain.value = Math.min(0.8, 0.25 + d / 4000);
        lp.connect(send).connect(this.revSend);
      }
    } else {
      g.connect(this.sfx);
    }
    return { node: g, gain, t: ctx.currentTime + delay };
  }

  throttle(name, interval) {
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < interval * 1000) return false;
    this.lastPlay[name] = now;
    return true;
  }

  env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    param.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + a + d);
  }

  // ------------------------------------------------------------------ 効果音
  explosion(pos, size = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 260 * Math.sqrt(size));
    const t = out.t;
    const amp = Math.min(1.4, 0.55 * size) * out.gain * 2.2;
    if (amp < 0.004) return;
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 1.4 * Math.sqrt(size));
    const g = ctx.createGain();
    this.env(g.gain, t, 0.01, amp, 1.6 * Math.sqrt(size));
    n.connect(lp).connect(g).connect(out.node);
    n.start(t); n.stop(t + 3.5);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g2 = ctx.createGain(); this.env(g2.gain, t, 0.01, amp * 1.1, 1.0);
    o.connect(g2).connect(out.node);
    o.start(t); o.stop(t + 1.3);
  }

  fire(weapon, pos, isPlayer) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (weapon === 'gun') {
      const out = this.spatial(isPlayer ? null : pos, 200);
      const t = out.t, a = (isPlayer ? 0.7 : 0.9) * (isPlayer ? 1 : out.gain * 2);
      if (a < 0.01) return;
      const n = this.noise();
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 900; hp.Q.value = 0.6;
      const g = ctx.createGain(); this.env(g.gain, t, 0.002, a, 0.35);
      n.connect(hp).connect(g).connect(out.node); n.start(t); n.stop(t + 0.6);
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      const g2 = ctx.createGain(); this.env(g2.gain, t, 0.002, a * 0.9, 0.3);
      o.connect(g2).connect(out.node); o.start(t); o.stop(t + 0.4);
    } else if (weapon === 'missile') {
      const out = this.spatial(isPlayer ? null : pos, 150);
      const t = out.t, a = isPlayer ? 0.35 : out.gain * 0.6;
      if (a < 0.01) return;
      const n = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5); bp.frequency.exponentialRampToValueAtTime(900, t + 1.6);
      const g = ctx.createGain(); this.env(g.gain, t, 0.04, a, 1.6);
      n.connect(bp).connect(g).connect(out.node); n.start(t); n.stop(t + 2);
    } else if (weapon === 'torpedo') {
      this.splash(pos, 0.5);
      const out = this.spatial(isPlayer ? null : pos, 150);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, out.t); o.frequency.exponentialRampToValueAtTime(45, out.t + 0.3);
      const g = ctx.createGain(); this.env(g.gain, out.t, 0.005, isPlayer ? 0.5 : out.gain * 0.6, 0.35);
      o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 0.5);
    } else if (weapon === 'bomb') {
      const out = this.spatial(isPlayer ? null : pos, 150);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1400, out.t); o.frequency.exponentialRampToValueAtTime(380, out.t + 2.4);
      const g = ctx.createGain(); this.env(g.gain, out.t, 0.2, isPlayer ? 0.12 : out.gain * 0.15, 2.3);
      o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 2.8);
    }
  }

  /** 自機の機関砲（鳴らしている間ループ音）。kind: ship=CIWS（低く速い連射）/ fighter */
  gun(on, kind = 'fighter') { this.gunOn = on; this.gunKind = kind; this.gunT = performance.now(); }

  /** 遠くの味方の機関砲（パラパラという音） */
  distantMG(pos) {
    if (!this.ctx || !this.throttle('dmg', 0.09)) return;
    const ctx = this.ctx, out = this.spatial(pos, 180);
    const a = out.gain * 0.9;
    if (a < 0.01) return;
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.002, a, 0.06);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 0.12);
  }

  /** 首が噛みつく音（顎が鳴る） */
  snap(pos) {
    if (!this.ctx || !this.throttle('snap', 0.4)) return;
    const ctx = this.ctx, out = this.spatial(pos, 700);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.4;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.004, Math.min(1, out.gain * 2.2), 0.18);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 0.3);
    this.roar(pos, 0.22, 1.7);
  }

  /** 極太ビームの溜め音（だんだん高く強くなるうなり）。on=false で止める */
  megaCharge(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.megaLoop) {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 82;
      const n = this.noise(this.noiseBuf, true);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 2;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(lp); o2.connect(lp); n.connect(bp).connect(lp);
      lp.connect(g).connect(this.sfx);
      o1.start(); o2.start(); n.start();
      g.gain.setTargetAtTime(0.16, t, 0.5);
      this.megaLoop = { o1, o2, n, lp, bp, g, nextBeat: 0 };
    } else if (!on && this.megaLoop) {
      const L = this.megaLoop;
      this.megaLoop = null;
      L.g.gain.setTargetAtTime(0.0001, t, 0.12);
      setTimeout(() => { try { L.o1.stop(); L.o2.stop(); L.n.stop(); } catch (e) { /* 停止済み */ } }, 900);
    }
  }

  megaChargeLevel(p) {
    const L = this.megaLoop;
    if (!L || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 55 + p * 170;
    L.o1.frequency.setTargetAtTime(f, t, 0.1);
    L.o2.frequency.setTargetAtTime(f * 1.498, t, 0.1);
    L.lp.frequency.setTargetAtTime(400 + p * 3400, t, 0.1);
    L.bp.frequency.setTargetAtTime(300 + p * 2600, t, 0.1);
    L.g.gain.setTargetAtTime(0.12 + p * 0.24, t, 0.2);
    const now = performance.now() / 1000;
    if (now >= L.nextBeat) { L.nextBeat = now + (0.95 - p * 0.6); this.heartbeat(0.45 + p * 0.55); }
  }

  /** 鼓動（ドクン） */
  heartbeat(a = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [d, k] of [[0, 1], [0.17, 0.7]]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(62, t + d); o.frequency.exponentialRampToValueAtTime(34, t + d + 0.18);
      const g = ctx.createGain(); this.env(g.gain, t + d, 0.005, 0.5 * a * k, 0.22);
      o.connect(g).connect(this.sfx); o.start(t + d); o.stop(t + d + 0.3);
    }
  }

  /** 極太ビームの発射音 */
  megaFire(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 4000);
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, out.t); lp.frequency.exponentialRampToValueAtTime(300, out.t + 3.0);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.02, Math.min(1.4, out.gain * 3), 3.0);
    n.connect(lp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 3.4);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, out.t); o.frequency.exponentialRampToValueAtTime(40, out.t + 2.8);
    const og = ctx.createGain(); this.env(og.gain, out.t, 0.02, 0.35, 2.8);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 900;
    o.connect(olp).connect(og).connect(out.node); o.start(out.t); o.stop(out.t + 3.0);
    this.explosion(pos, 4);
    this.roar(pos, 1.3, 0.85);
  }

  /** 味方がやられた時の警報（低い2音） */
  allyLost(big = false) {
    if (!this.ctx || !this.throttle('lost', 0.8)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = big ? [392, 311, 261] : [440, 349];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = ctx.createGain(); this.env(g.gain, t + i * 0.22, 0.01, 0.16, 0.32);
      o.connect(lp).connect(g).connect(this.sfx); o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.4);
    });
  }

  /** 足を海面に叩きつける轟音 */
  stomp(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1600);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(40, out.t); o.frequency.exponentialRampToValueAtTime(18, out.t + 1.4);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.01, Math.min(1.2, out.gain * 3.0), 1.8);
    o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 2.0);
    this.explosion(pos, 3.2);
    for (let i = 0; i < 4; i++) setTimeout(() => this.splash(pos, 2.8), 120 + i * 140);
  }

  splash(pos, size = 1) {
    if (!this.ctx || !this.throttle('splash' + Math.round(size * 3), 0.05)) return;
    const ctx = this.ctx, out = this.spatial(pos, 120 * size);
    const a = Math.min(0.8, 0.5 * size) * out.gain * 2;
    if (a < 0.006) return;
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + Math.random() * 500; bp.Q.value = 0.5;
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.01, a, 0.6 + size * 0.5);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 2);
  }

  footstep(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 900);
    const a = out.gain * 1.6;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(48, out.t); o.frequency.exponentialRampToValueAtTime(22, out.t + 0.8);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.02, a, 1.0);
    o.connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 1.2);
    this.splash(pos, 1.6);
  }

  roar(pos, intensity = 1, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1600);
    const t = out.t, dur = 3.2 * intensity;
    const a = Math.min(1, out.gain * 1.4) * intensity;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    const mix = ctx.createGain();
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(a, t + 0.35);
    env.gain.setValueAtTime(a, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const base = 105 * pitch;
    for (const det of [0, 7, -11, 15]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.25, t + dur * 0.3);
      o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);
      o.detune.value = det * 6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 7 + Math.random() * 4;
      const lg = ctx.createGain(); lg.gain.value = 9;
      lfo.connect(lg).connect(o.frequency);
      o.connect(mix); o.start(t); o.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const n = this.noise();
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 900; nb.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    n.connect(nb).connect(ng).connect(mix); n.start(t); n.stop(t + dur + 0.1);
    mix.connect(shaper);
    const formants = [[620, 5], [1150, 6], [2500, 8]];
    const sum = ctx.createGain(); sum.gain.value = 0.55;
    for (const [f, q] of formants) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * pitch; bp.Q.value = q;
      shaper.connect(bp).connect(sum);
    }
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 380;
    shaper.connect(low).connect(sum);
    sum.connect(env).connect(out.node);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(45, t); sub.frequency.linearRampToValueAtTime(38, t + dur);
    const sg = ctx.createGain(); this.env(sg.gain, t, 0.3, a * 0.8, dur);
    sub.connect(sg).connect(out.node); sub.start(t); sub.stop(t + dur + 0.2);
  }

  kaijuPain(pos, s = 0.38) { if (this.throttle('pain', 0.6)) this.roar(pos, Math.min(0.9, s), 1.45); }
  headKilled(pos) { this.explosion(pos, 3); this.roar(pos, 0.6, 1.25); }

  telegraph(kind, isPlayer, pos, key) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // 溜めの音（頭ごとに音程が違う）
    const out = this.spatial(pos, 900);
    const t = out.t;
    const p = HEAD_PITCH[key || 'all'];
    const dur = kind === 'converge' ? 2.4 : kind === 'sweep' ? 1.5 : 1.2;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120 * p, t); o.frequency.exponentialRampToValueAtTime(900 * p, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300 * p, t); bp.frequency.exponentialRampToValueAtTime(2200 * p, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, out.gain * 0.6), t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(bp).connect(g).connect(out.node); o.start(t); o.stop(t + dur + 0.2);
    if (kind === 'tail' || kind === 'claw') this.roar(pos, 0.35, 1.1);
    // 警告音（自分が狙われている時・大技）
    if (isPlayer || kind === 'converge' || kind === 'tail' || kind === 'claw') {
      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const b = ctx.createOscillator(); b.type = 'square';
        b.frequency.value = i % 2 ? 660 : 990;
        const bg = ctx.createGain();
        this.env(bg.gain, now + i * 0.16, 0.005, 0.09, 0.12);
        b.connect(bg).connect(this.sfx); b.start(now + i * 0.16); b.stop(now + i * 0.16 + 0.16);
      }
    }
  }

  beam(kind, key, pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1200);
    const t = out.t, p = HEAD_PITCH[key] || 1;
    const dur = kind === 'converge' ? 1.2 : 1.5;
    const n = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 * p; lp.Q.value = 4;
    const g = ctx.createGain(); this.env(g.gain, t, 0.03, Math.min(1, out.gain * 1.8), dur);
    n.connect(lp).connect(g).connect(out.node); n.start(t); n.stop(t + dur + 0.3);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70 * p, t); o.frequency.linearRampToValueAtTime(55 * p, t + dur);
    const g2 = ctx.createGain(); this.env(g2.gain, t, 0.02, Math.min(0.8, out.gain * 1.2), dur);
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600;
    o.connect(lp2).connect(g2).connect(out.node); o.start(t); o.stop(t + dur + 0.2);
  }

  bolt(pos) {
    if (!this.ctx || !this.throttle('bolt', 0.06)) return;
    const ctx = this.ctx, out = this.spatial(pos, 700);
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(2400, out.t); o.frequency.exponentialRampToValueAtTime(220, out.t + 0.25);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.003, out.gain * 0.5, 0.25);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    o.connect(lp).connect(g).connect(out.node); o.start(out.t); o.stop(out.t + 0.3);
  }

  swipe(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, out = this.spatial(pos, 1000);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(200, out.t); bp.frequency.exponentialRampToValueAtTime(1200, out.t + 0.3); bp.frequency.exponentialRampToValueAtTime(300, out.t + 0.8);
    const g = ctx.createGain(); this.env(g.gain, out.t, 0.05, out.gain * 1.6, 0.9);
    n.connect(bp).connect(g).connect(out.node); n.start(out.t); n.stop(out.t + 1.2);
    for (let i = 0; i < 3; i++) setTimeout(() => this.splash(pos, 2.5), 250 + i * 120);
  }

  ui(name) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const freqs = name === 'start' ? [523, 659, 784] : name === 'respawn' ? [659, 880] : name === 'back' ? [440, 330] : [880];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this.env(g.gain, t + i * 0.07, 0.005, 0.12, 0.18);
      o.connect(g).connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25);
    });
  }

  // ------------------------------------------------------------------ 環境音・エンジン
  startAmbience() {
    const ctx = this.ctx;
    const n = this.noise(this.brownBuf, true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.18;
    lfo.connect(lg).connect(g.gain);
    n.connect(lp).connect(g).connect(this.amb);
    n.start(); lfo.start();
    // 風（飛行中に大きくなる）
    const w = this.noise(this.noiseBuf, true);
    const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 700; wb.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0;
    w.connect(wb).connect(wg).connect(this.amb); w.start();
    this.loops.wind = { g: wg, f: wb };
    // エンジン（船: 低いうなり / ジェット: 高音 / レシプロ: 断続）
    const eo = ctx.createOscillator(); eo.type = 'sawtooth'; eo.frequency.value = 55;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300;
    const eg = ctx.createGain(); eg.gain.value = 0;
    eo.connect(ef).connect(eg).connect(this.sfx); eo.start();
    const jn = this.noise(this.noiseBuf, true);
    const jf = ctx.createBiquadFilter(); jf.type = 'bandpass'; jf.frequency.value = 1800; jf.Q.value = 1.2;
    const jg = ctx.createGain(); jg.gain.value = 0;
    jn.connect(jf).connect(jg).connect(this.sfx); jn.start();
    this.loops.engine = { o: eo, f: ef, g: eg, jf, jg };
    // 機銃
    const mo = ctx.createOscillator(); mo.type = 'square'; mo.frequency.value = 26;
    const mn = this.noise(this.noiseBuf, true);
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 1300; mf.Q.value = 0.7;
    const mg = ctx.createGain(); mg.gain.value = 0;
    const am = ctx.createGain(); am.gain.value = 0;
    const amScale = ctx.createGain(); amScale.gain.value = 0.5;
    mo.connect(amScale).connect(am.gain);
    mn.connect(mf).connect(am).connect(mg).connect(this.sfx);
    mo.start(); mn.start();
    this.loops.mg = { g: mg, o: mo };
    // 報道ヘリのローター音（バタバタという羽音＋タービンの高音）
    const hn = this.noise(this.brownBuf, true);
    const hbp = ctx.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 110; hbp.Q.value = 0.9;
    const ham = ctx.createGain(); ham.gain.value = 0.55;
    const hlfo = ctx.createOscillator(); hlfo.type = 'square'; hlfo.frequency.value = 19.5;
    const hlg = ctx.createGain(); hlg.gain.value = 0.45;
    hlfo.connect(hlg).connect(ham.gain);
    const hw = ctx.createOscillator(); hw.type = 'triangle'; hw.frequency.value = 1680;
    const hwg = ctx.createGain(); hwg.gain.value = 0.035;
    const hg = ctx.createGain(); hg.gain.value = 0;
    hn.connect(hbp).connect(ham).connect(hg);
    hw.connect(hwg).connect(hg);
    hg.connect(this.amb);
    hn.start(); hlfo.start(); hw.start();
    this.loops.heli = { g: hg };
  }

  /** 報道ヘリの音の大きさ（0で無音） */
  setHeli(level) {
    if (!this.ctx || !this.loops.heli) return;
    this.loops.heli.g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.25);
  }

  /** テレビ中継の音（スピーカー越しのこもった音・音楽を下げる） */
  setTV(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tvLP.frequency.setTargetAtTime(on ? 5200 : 20000, t, 0.08);
    this.tvHP.frequency.setTargetAtTime(on ? 170 : 10, t, 0.08);
    this.musicBus.gain.setTargetAtTime(on ? this.musicVolume * 0.25 : this.musicVolume, t, 0.3);
  }

  /** ニュースの速報チャイム */
  tvJingle(urgent = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = urgent ? [1318.5, 1661.2, 1975.5, 1661.2, 1975.5] : [1046.5, 1318.5, 1568];
    notes.forEach((f, i) => {
      for (const [type, mul, a] of [['sine', 1, 0.16], ['triangle', 2, 0.04]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
        const g = ctx.createGain(); this.env(g.gain, t + i * 0.13, 0.005, a, 0.7);
        o.connect(g).connect(this.sfx); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.9);
      }
    });
  }

  /** 画面が切り替わる時の電波の雑音 */
  tvStatic(dur = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.setValueAtTime(0.18, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp).connect(g).connect(this.sfx); n.start(t); n.stop(t + dur + 0.05);
  }

  startBattle(b) { this.battle = b; }
  stopBattle() {
    this.battle = null;
    if (!this.ctx) return;
    this.setHeli(0);
    this.setTV(false);
    this.megaCharge(false);
    const e = this.loops.engine, t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0, t, 0.2); e.jg.gain.setTargetAtTime(0, t, 0.2);
    this.loops.mg.g.gain.setTargetAtTime(0, t, 0.05);
    this.loops.wind.g.gain.setTargetAtTime(0, t, 0.5);
    this.music(null);
  }

  update(dt, b) {
    if (!this.ctx) return;
    const cam = b.camera;
    this.listener.copy(cam.position);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    const p = b.player;
    const e = this.loops.engine;
    if (p && p.alive) {
      if (p.kind === 'ship') {
        const k = Math.abs(p.speed) / 20;
        e.o.frequency.setTargetAtTime(42 + k * 30, t, 0.3);
        e.g.gain.setTargetAtTime(0.05 + k * 0.08, t, 0.3);
        e.jg.gain.setTargetAtTime(0.0, t, 0.3);
        this.loops.wind.g.gain.setTargetAtTime(0.08, t, 0.5);
      } else {
        const th = p.throttle || 0.5;
        if (p.type === 'zero') {
          e.o.frequency.setTargetAtTime(70 + th * 50, t, 0.2);
          e.g.gain.setTargetAtTime(0.12 + th * 0.08, t, 0.2);
          e.f.frequency.setTargetAtTime(900, t, 0.2);
          e.jg.gain.setTargetAtTime(0.02, t, 0.2);
        } else {
          e.o.frequency.setTargetAtTime(90 + th * 60, t, 0.2);
          e.g.gain.setTargetAtTime(0.04, t, 0.2);
          e.jf.frequency.setTargetAtTime(1200 + th * 1600, t, 0.2);
          e.jg.gain.setTargetAtTime(0.05 + th * 0.12, t, 0.2);
        }
        this.loops.wind.g.gain.setTargetAtTime(0.06 + (p.speed / 240) * 0.18, t, 0.3);
        this.loops.wind.f.frequency.setTargetAtTime(500 + p.speed * 4, t, 0.3);
      }
    } else {
      e.g.gain.setTargetAtTime(0, t, 0.3);
      e.jg.gain.setTargetAtTime(0, t, 0.3);
    }
    const gunOn = this.gunOn && performance.now() - this.gunT < 120;
    const ship = this.gunKind === 'ship';
    this.loops.mg.o.frequency.setTargetAtTime(ship ? 16 : (p && p.type === 'zero' ? 14 : 26), t, 0.02);
    this.loops.mg.g.gain.setTargetAtTime(gunOn ? (ship ? 0.3 : 0.22) : 0, t, 0.02);
    this.updateMusic(dt, b);
  }

  // ------------------------------------------------------------------ 音楽（手続き生成の緊張感あるループ）
  music(state) {
    this.musicState = state;
    if (!this.ctx) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    if (state === 'victory') this.chord([146.8, 220, 293.7, 370, 440], 5, 0.16);
    if (state === 'defeat') this.chord([73.4, 87.3, 110, 130.8], 6, 0.16);
  }

  chord(freqs, dur, amp) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of freqs) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2200, t + dur * 0.4);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp / freqs.length, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(this.musicBus); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  updateMusic(dt, b) {
    if (this.musicState !== 'battle') return;
    const ctx = this.ctx;
    const rage = b.kaiju && b.kaiju.rage;
    const bpm = rage ? 104 : 86;
    const spb = 60 / bpm / 2;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat, i = this.beat % 16;
      const pattern = rage ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
      if (pattern[i]) this.taiko(t, i === 0 || i === 8 ? 1 : 0.6);
      if (i % 2 === 1 && rage) this.tick(t);
      if (this.beat % 32 === 0) this.drone(t, spb * 32, rage);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  taiko(t, a) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const g = ctx.createGain(); this.env(g.gain, t, 0.003, 0.5 * a, 0.45);
    o.connect(g).connect(this.musicBus); o.start(t); o.stop(t + 0.5);
    const n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 1;
    const ng = ctx.createGain(); this.env(ng.gain, t, 0.002, 0.25 * a, 0.15);
    n.connect(bp).connect(ng).connect(this.musicBus); n.start(t); n.stop(t + 0.2);
  }

  tick(t) {
    const ctx = this.ctx;
    const n = this.noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); this.env(g.gain, t, 0.001, 0.05, 0.05);
    n.connect(hp).connect(g).connect(this.musicBus); n.start(t); n.stop(t + 0.08);
  }

  drone(t, dur, rage) {
    const ctx = this.ctx;
    const root = rage ? 77.8 : 73.4;
    for (const [f, a] of [[root, 0.08], [root * 1.5, 0.05], [root * 2, 0.035], [root * (rage ? 1.06 : 1.19), 0.03]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rage ? 520 : 360;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.musicBus); o.start(t); o.stop(t + dur + 0.1);
    }
  }
}
