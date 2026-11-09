// iPad 向けタッチ操作
// 戦闘機: 左側どこでもドラッグで操縦（仮想スティック）＋右側のボタン。右側の空いた所をドラッグで見回す
// 船: 画面下の帯を左右ドラッグで舵、画面をタップで主砲（ドラッグなら見回す）、ボタンで機関砲・魚雷・速力
export class TouchControls {
  constructor(root, devices) {
    this.dev = devices;
    this.el = document.createElement('div');
    this.el.className = 'touch hidden';
    this.el.innerHTML = `
      <div class="t-stick-zone"></div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-rudder"><div class="t-rudder-knob"></div><span>舵</span></div>
      <div class="t-buttons"></div>
      <button class="t-pause interactive" aria-label="一時停止">Ⅱ</button>`;
    root.appendChild(this.el);
    this.zone = this.el.querySelector('.t-stick-zone');
    this.stick = this.el.querySelector('.t-stick');
    this.knob = this.el.querySelector('.t-knob');
    this.rudder = this.el.querySelector('.t-rudder');
    this.rudderKnob = this.el.querySelector('.t-rudder-knob');
    this.buttons = this.el.querySelector('.t-buttons');
    this.pauseBtn = this.el.querySelector('.t-pause');
    this.mode = null;
    this.stickId = null;
    this.rudderId = null;
    this.lookId = null;
    this.onPause = null;
    this.pauseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onPause && this.onPause(); });
    this.bind();
  }

  setMode(mode) {
    this.mode = mode;
    this.el.classList.toggle('hidden', !mode);
    this.el.dataset.mode = mode || '';
    const t = this.dev.touch;
    t.stick.active = false; t.steerDrag = 0; t.buttons = {};
    if (mode === 'fighter') {
      this.buttons.innerHTML = `
        <button data-b="gun" class="tb big hold">機関砲</button>
        <button data-b="missile" class="tb big">ミサイル</button>
        <button data-b="bomb" class="tb">爆撃</button>
        <button data-b="look" class="tb">怪獣カメラ</button>
        <button data-b="boost" class="tb hold">加速</button>
        <button data-b="brake" class="tb hold">減速</button>`;
    } else if (mode === 'ship') {
      this.buttons.innerHTML = `
        <button data-b="mg" class="tb big hold">機関砲</button>
        <button data-b="torpedo" class="tb big">魚雷</button>
        <button data-b="speedUp" class="tb">速力 ▲</button>
        <button data-b="speedDown" class="tb">速力 ▼</button>`;
    } else this.buttons.innerHTML = '';
    this.buttons.querySelectorAll('.tb').forEach((b) => {
      const name = b.dataset.b;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.dev.touch.buttons[name] = true;
        this.dev.touch.pressedButtons.add(name);
        this.dev.lastInput = 'touch';
        b.classList.add('on');
      });
      const up = (e) => { e.stopPropagation(); this.dev.touch.buttons[name] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  bind() {
    const t = this.dev.touch;
    const canvas = this.dev.canvas;
    const onDown = (e) => {
      if (e.pointerType !== 'touch' || !this.mode) return;
      this.dev.lastInput = 'touch';
      const x = e.clientX, y = e.clientY;
      if (this.mode === 'fighter') {
        if (x < innerWidth * 0.55 && this.stickId === null) {
          this.stickId = e.pointerId;
          this.sx = x; this.sy = y;
          this.stick.style.transform = `translate(${x}px, ${y}px)`;
          this.stick.classList.add('on');
          t.stick.active = true; t.stick.x = 0; t.stick.y = 0;
        } else if (this.lookId === null) {
          this.startLook(e, false);
        }
      } else if (this.mode === 'ship') {
        if (y > innerHeight - 130 && x > innerWidth * 0.2 && x < innerWidth * 0.8 && this.rudderId === null) {
          this.rudderId = e.pointerId;
          this.updateRudder(x);
        } else if (this.lookId === null) {
          // 指を離した時に動いていなければ「タップ＝主砲」、動かしたら見回し
          this.startLook(e, true);
        }
      }
    };
    const onMove = (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.stickId) {
        const r = 70;
        let dx = (e.clientX - this.sx) / r, dy = (e.clientY - this.sy) / r;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        t.stick.x = dx; t.stick.y = dy;
        this.knob.style.transform = `translate(${dx * r}px, ${dy * r}px)`;
      } else if (e.pointerId === this.rudderId) this.updateRudder(e.clientX);
      else if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
        this.lx = e.clientX; this.ly = e.clientY;
        if (!this.lookMoved && Math.hypot(e.clientX - this.lx0, e.clientY - this.ly0) > 14) { this.lookMoved = true; t.looking = true; }
        if (this.lookMoved) { t.lookDX += dx; t.lookDY += dy; }
      }
    };
    const onUp = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null; t.stick.active = false; t.stick.x = t.stick.y = 0;
        this.stick.classList.remove('on'); this.knob.style.transform = '';
      }
      if (e.pointerId === this.rudderId) { this.rudderId = null; t.steerDrag = 0; this.rudderKnob.style.left = '50%'; }
      if (e.pointerId === this.lookId) {
        if (!this.lookMoved && this.lookTap && performance.now() - this.lookT0 < 450) {
          t.tapAim = { nx: (this.lx0 / innerWidth) * 2 - 1, ny: -(this.ly0 / innerHeight) * 2 + 1 };
        }
        this.lookId = null; t.looking = false;
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
  }

  startLook(e, tapFires) {
    this.lookId = e.pointerId;
    this.lx = this.lx0 = e.clientX;
    this.ly = this.ly0 = e.clientY;
    this.lookMoved = false;
    this.lookTap = tapFires;
    this.lookT0 = performance.now();
  }

  updateRudder(x) {
    const r = this.rudder.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
    this.dev.touch.steerDrag = Math.abs(v) < 0.08 ? 0 : v;
    this.rudderKnob.style.left = `${(v * 0.5 + 0.5) * 100}%`;
  }
}
