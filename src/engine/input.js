/**
 * Input — pointer-lock FPS input with configurable bindings, mouse look
 * accumulation, and per-frame edge-triggered key/button queries.
 */
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
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;
    this._onLockChange = null;

    this._onKeyDown = (e) => {
      if (!this.enabled || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      if (this.locked && [
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
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked || e.target !== this.dom) return;
      const b = e.button;
      if (b < 3) { if (!this.buttons[b]) this.buttonsPressed[b] = true; this.buttons[b] = true; }
    };
    this._onMouseUp = (e) => {
      const b = e.button;
      if (b < 3) this.buttons[b] = false;
    };
    this._onWheel = (e) => { if (this.locked && e.target === this.dom) this.wheel += Math.sign(e.deltaY); };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this._onLockChange) this._onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = [false,false,false]; });
  }

  onLockChange(fn) { this._onLockChange = fn; }

  requestLock() {
    if (!this.dom.requestPointerLock) return;
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* pointer lock may be unavailable */ }
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedThisFrame.has(code); }
  released(code) { return this.releasedThisFrame.has(code); }
  mouseDown(b) { return this.buttons[b]; }
  mousePressed(b) { return this.buttonsPressed[b]; }

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
  }
}
