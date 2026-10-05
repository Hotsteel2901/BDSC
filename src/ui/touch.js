import { t } from './i18n.js';

/**
 * TouchControls — mobile HUD: two dynamic joysticks (move / look), a weapon
 * strip, an action button cluster and a portrait "rotate device" hint.
 *
 * Everything is routed through the virtual input API of `Input`, so gameplay
 * code keeps reading the same keys/buttons it always has.
 */

const HOTKEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'];
const MOVE_RADIUS = 62;   // px before the move stick clamps
const LOOK_SCALE = 2.0;   // touch px -> mouse px

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.root = document.getElementById('ui');
    this.active = false;
    this._crouch = false;
    this._ads = false;
    this._movePid = null;
    this._lookPid = null;

    this._build();
    this._bind();
    // touch players get touch-specific menu hint text (also survives language switches)
    const hint = this.root.querySelector('#menu-controls');
    if (hint) {
      hint.dataset.i18n = 'touch.hint';
      hint.textContent = t('touch.hint');
    }
    document.body.classList.add('touch');
    this.setVisible(false);
  }

  /* ------------------------------- DOM ---------------------------------- */
  _build() {
    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="tzone" id="tzone-move">
        <div class="tstick" id="tstick-move"><div class="tknob"></div></div>
      </div>
      <div class="tzone" id="tzone-look">
        <div class="tstick look" id="tstick-look"><div class="tknob"></div></div>
      </div>
      <div id="touch-weapons"></div>
      <div id="touch-top">
        <div class="tbtn square pause" data-tap="Escape"><b>❚❚</b><span data-i18n="touch.pause">${t('touch.pause')}</span></div>
        <div class="tbtn square inv" data-tap="KeyI"><b>▤</b><span data-i18n="touch.inv">${t('touch.inv')}</span></div>
      </div>
      <div id="touch-actions">
        <div class="tbtn small heal" data-tap="KeyQ"><b>✚</b><span data-i18n="touch.heal">${t('touch.heal')}</span></div>
        <div class="tbtn small grenade" data-tap="KeyG"><b>✦</b><span data-i18n="touch.grenade">${t('touch.grenade')}</span></div>
        <div class="tbtn small crouch" data-toggle="crouch"><b>▼</b><span data-i18n="touch.crouch">${t('touch.crouch')}</span></div>
        <div class="tbtn reload" data-tap="KeyR"><b>⟳</b><span data-i18n="touch.reload">${t('touch.reload')}</span></div>
        <div class="tbtn ads" data-toggle="ads"><b>◎</b><span data-i18n="touch.ads">${t('touch.ads')}</span></div>
        <div class="tbtn jump" data-hold="Space"><b>⤒</b><span data-i18n="touch.jump">${t('touch.jump')}</span></div>
        <div class="tbtn fire" data-hold="fire"><b>◉</b><span data-i18n="touch.fire">${t('touch.fire')}</span></div>
      </div>
      <div id="touch-rotate"><div class="panel"><div class="rot-ico">⟳</div><div data-i18n="touch.rotate">${t('touch.rotate')}</div></div></div>
    `;
    this.root.appendChild(el);
    this.el = el;

    // Weapon strip (tap to select 1..8).
    const strip = el.querySelector('#touch-weapons');
    strip.innerHTML = this.game.weaponSystem.weapons.map((w, i) =>
      `<div class="tweap" data-digit="Digit${i + 1}"><b>${i + 1}</b><span>${w.base.name.slice(0, 3)}</span></div>`
    ).join('');
    this._weapEls = [...strip.querySelectorAll('.tweap')];
  }

  /* ------------------------------ bindings ------------------------------- */
  _bind() {
    const input = this.input;
    const el = this.el;

    // --- dynamic move joystick ---
    const moveStick = el.querySelector('#tstick-move');
    this._stick(el.querySelector('#tzone-move'), moveStick,
      () => { input.setMoveAxis(0, 0); moveStick.classList.remove('sprint'); },
      (dx, dy, clamped) => {
        const len = Math.hypot(dx, dy);
        if (len < 1) { input.setMoveAxis(0, 0); moveStick.classList.remove('sprint'); return; }
        const scale = Math.min(1, len / MOVE_RADIUS);
        input.setMoveAxis((dx / len) * scale, (-dy / len) * scale);
        moveStick.classList.toggle('sprint', scale > 0.85 && dy < 0);
        this._placeKnob(moveStick, clamped.x, clamped.y, MOVE_RADIUS);
      });

    // --- look area (dynamic stick visual, swipe look) ---
    const lookStick = el.querySelector('#tstick-look');
    let lastX = 0, lastY = 0;
    this._stick(el.querySelector('#tzone-look'), lookStick,
      () => {},
      (dx, dy, clamped, ev) => {
        input.addLook((ev.clientX - lastX) * LOOK_SCALE, (ev.clientY - lastY) * LOOK_SCALE);
        lastX = ev.clientX; lastY = ev.clientY;
        this._placeKnob(lookStick, clamped.x, clamped.y, MOVE_RADIUS * 0.8);
      },
      (x, y) => { lastX = x; lastY = y; });

    // --- hold buttons (fire / jump) ---
    el.querySelectorAll('[data-hold]').forEach((b) => {
      const kind = b.dataset.hold;
      const press = () => { if (kind === 'fire') input.pressButton(0); else input.pressVirtual(kind); };
      const release = () => { if (kind === 'fire') input.releaseButton(0); else input.releaseVirtual(kind); };
      this._holdButton(b, press, release);
    });

    // --- tap buttons (reload / grenade / heal / inventory / pause) ---
    el.querySelectorAll('[data-tap]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // press+release immediately: the edge is consumed on the next frame
        input.pressVirtual(b.dataset.tap);
        input.releaseVirtual(b.dataset.tap);
      });
    });

    // --- toggles (ADS / crouch) ---
    el.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (b.dataset.toggle === 'ads') {
          this._ads = !this._ads;
          if (this._ads) input.pressButton(2); else input.releaseButton(2);
          b.classList.toggle('on', this._ads);
        } else {
          this._crouch = !this._crouch;
          input.holdVirtual('ControlLeft', this._crouch);
          b.classList.toggle('on', this._crouch);
        }
      });
    });

    // --- weapon strip ---
    el.querySelectorAll('[data-digit]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.pressVirtual(b.dataset.digit);
        input.releaseVirtual(b.dataset.digit);
      });
    });

    // --- HUD quickbar slots become tappable ---
    const qb = this.root.querySelector('#quickbar');
    if (qb) {
      qb.addEventListener('pointerdown', (e) => {
        const slot = e.target.closest('[data-qi]');
        if (!slot) return;
        e.preventDefault();
        const key = HOTKEYS[+slot.dataset.qi];
        input.pressVirtual(key);
        input.releaseVirtual(key);
      });
    }

    // losing focus releases every virtual hold
    window.addEventListener('blur', () => this._releaseAll(false));
  }

  /**
   * Generic dynamic stick zone. `moveCb` receives (dx, dy, clamped, event),
   * `startCb`/`endCb` manage the axis reset and bookkeeping.
   */
  _stick(zone, stick, endCb, moveCb, startCb) {
    let pid = null;
    let baseX = 0, baseY = 0;
    const clamp = (dx, dy, r) => {
      const len = Math.hypot(dx, dy);
      if (len <= r || len === 0) return { x: dx, y: dy };
      return { x: (dx / len) * r, y: (dy / len) * r };
    };

    zone.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      try { zone.setPointerCapture(pid); } catch (err) { /* synthetic pointers */ }
      baseX = e.clientX; baseY = e.clientY;
      stick.style.left = baseX + 'px';
      stick.style.top = baseY + 'px';
      stick.classList.add('active');
      this._placeKnob(stick, 0, 0, MOVE_RADIUS);
      if (startCb) startCb(baseX, baseY);
      if (endCb) endCb();
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - baseX, dy = e.clientY - baseY;
      moveCb(dx, dy, clamp(dx, dy, MOVE_RADIUS), e);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      stick.classList.remove('active', 'sprint');
      if (endCb) endCb();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _placeKnob(stick, x, y, r) {
    const c = Math.hypot(x, y);
    const k = c > r && c > 0 ? r / c : 1;
    const knob = stick.firstElementChild;
    knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
  }

  _holdButton(el, press, release) {
    let held = false;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (held) return;
      held = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      el.classList.add('on');
      press();
    };
    const up = () => {
      if (!held) return;
      held = false;
      el.classList.remove('on');
      release();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  /* ------------------------------- state --------------------------------- */
  setVisible(on) {
    if (on === this.active) return;
    this.active = on;
    this.el.classList.toggle('on', on);
    document.body.classList.toggle('touch-play', on);
    if (!on) this._releaseAll(true);
  }

  _releaseAll(resetToggles) {
    const input = this.input;
    input.clearVirtuals();
    input.releaseButton(0);
    input.releaseButton(2);
    input.setMoveAxis(0, 0);
    this.el.querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
    if (resetToggles) {
      this._ads = false;
      this._crouch = false;
    }
  }

  /** Per-frame: highlight the active weapon in the strip. */
  update(game) {
    if (!this.active) return;
    const idx = game.weaponSystem.index;
    for (let i = 0; i < this._weapEls.length; i++) {
      this._weapEls[i].classList.toggle('sel', i === idx);
    }
  }
}
