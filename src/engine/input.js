/**
 * Input — pointer-lock FPS input with configurable bindings, mouse look
 * accumulation, and per-frame edge-triggered key/button queries.
 *
 * On touch devices the same query API is fed by virtual input coming from the
 * on-screen controls (see src/ui/touch.js): virtual keys/buttons merge with the
 * keyboard/mouse state, and analogue movement is exposed via `moveAxis()`.
 */

/** True on phones/tablets (or when forced with ?touch=1 / ?touch=0). */
export function isTouchDevice() {
  try {
    const forced = new URLSearchParams(window.location.search).get('touch');
    if (forced === '1') return true;
    if (forced === '0') return false;
  } catch (e) { /* ignore */ }
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const points = (navigator.maxTouchPoints || 0) > 0;
  return coarse || (('ontouchstart' in window) && points);
}

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = [false, false, false];
    this.buttonsPressed = [false, false, false];
    this._locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;
    this._onLockChange = null;

    // ---- touch / virtual input ----
    this.touch = isTouchDevice();
    this.touchLocked = false;
    this.vKeys = new Set();
    this.vPressed = new Set();
    this.vReleased = new Set();
    this.vButtons = [false, false, false];
    this.vButtonsPressed = [false, false, false];
    this.vMove = { x: 0, y: 0 };

    this._onKeyDown = (e) => {
      if (!this.enabled || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      if (this._locked && [
        'KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ControlLeft',
        'Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7',
        'KeyR','KeyE','KeyQ','KeyM','KeyF','KeyG','KeyH','KeyC','KeyV'
      ].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.releasedThisFrame.add(e.code);
    };
    this._onMouseMove = (e) => {
      if (!this._locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this._locked || e.target !== this.dom) return;
      const b = e.button;
      if (b < 3) { if (!this.buttons[b]) this.buttonsPressed[b] = true; this.buttons[b] = true; }
    };
    this._onMouseUp = (e) => {
      const b = e.button;
      if (b < 3) this.buttons[b] = false;
    };
    this._onWheel = (e) => { if (this._locked && e.target === this.dom) this.wheel += Math.sign(e.deltaY); };
    this._onLock = () => {
      this._locked = document.pointerLockElement === this.dom;
      if (this._onLockChange) this._onLockChange(this._locked);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.buttons = [false, false, false];
      this.vKeys.clear();
      this.vButtons = [false, false, false];
      this.vMove.x = 0; this.vMove.y = 0;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', this._onBlur);
  }

  onLockChange(fn) { this._onLockChange = fn; }

  /** Desktop: real pointer lock. Touch: virtual "look is live" flag. */
  get locked() { return this.touch ? this.touchLocked : this._locked; }

  requestLock() {
    if (this.touch) { this.touchLocked = true; return; }
    if (!this.dom.requestPointerLock) return;
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* pointer lock may be unavailable */ }
  }
  exitLock() {
    if (this.touch) { this.touchLocked = false; return; }
    if (document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code) || this.vKeys.has(code); }
  pressed(code) { return this.pressedThisFrame.has(code) || this.vPressed.has(code); }
  released(code) { return this.releasedThisFrame.has(code) || this.vReleased.has(code); }
  mouseDown(b) { return this.buttons[b] || this.vButtons[b]; }
  mousePressed(b) { return this.buttonsPressed[b] || this.vButtonsPressed[b]; }

  /** Analogue move axis (x = strafe, y = forward), set by the touch joystick. */
  moveAxis() { return this.vMove; }

  /* ------------------------------ virtual API ------------------------------ */
  pressVirtual(code) {
    if (!this.vKeys.has(code)) this.vPressed.add(code);
    this.vKeys.add(code);
  }
  releaseVirtual(code) {
    if (this.vKeys.has(code)) this.vReleased.add(code);
    this.vKeys.delete(code);
  }
  holdVirtual(code, on) { if (on) this.pressVirtual(code); else this.releaseVirtual(code); }

  pressButton(b) {
    if (!this.vButtons[b]) this.vButtonsPressed[b] = true;
    this.vButtons[b] = true;
  }
  releaseButton(b) { this.vButtons[b] = false; }

  addLook(dx, dy) { this.mouseDX += dx; this.mouseDY += dy; }
  setMoveAxis(x, y) { this.vMove.x = x; this.vMove.y = y; }

  /** Release every virtual hold (used when the touch UI hides). */
  clearVirtuals() {
    this.vKeys.clear();
    this.vButtons = [false, false, false];
    this.vMove.x = 0; this.vMove.y = 0;
  }

  /** Consume mouse delta (call once per frame after use). */
  takeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.buttonsPressed = [false, false, false];
    this.vPressed.clear();
    this.vReleased.clear();
    this.vButtonsPressed = [false, false, false];
  }
}
