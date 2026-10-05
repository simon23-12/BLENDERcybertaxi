// Phone tilt (portrait) + two on-screen buttons (gas / brake). Keyboard fallback for desktop testing.
import { clamp } from './util.js';

const D2R = Math.PI / 180;

export class Input {
  constructor() {
    this.gas = 0; this.brake = 0;
    this.steer = 0; this.pitch = 0;          // -1..1 (right / nose-up positive)
    this.sens = 1.0; this.invert = false;
    this.hasMotion = false;
    this.motionGranted = false;
    this._raw = { steer: 0, elev: 0, ok: false };
    this._neutral = { steer: 0, elev: 35 * D2R };
    this._needCal = true;
    this._calBuf = [];
    this.keys = new Set();
    this.lastTilt = { steer: 0, pitch: 0 };
    this._bind();
  }

  _bind() {
    const hold = (el, key) => {
      if (!el) return;
      const on = (e) => { e.preventDefault(); this[key] = 1; el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
      const off = (e) => { e.preventDefault(); this[key] = 0; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(document.getElementById('btn-gas'), 'gas');
    hold(document.getElementById('btn-brake'), 'brake');
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** must be called from a user gesture (iOS 13+ permission) */
  async requestMotion() {
    let granted = true;
    try {
      const reqs = [];
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        reqs.push(DeviceOrientationEvent.requestPermission());
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        reqs.push(DeviceMotionEvent.requestPermission());
      }
      if (reqs.length) granted = (await Promise.all(reqs)).every((r) => r === 'granted');
    } catch (e) { granted = false; }
    this.motionGranted = granted;
    if (granted) {
      window.addEventListener('deviceorientation', (e) => this._onOrient(e), true);
    }
    return granted;
  }

  _onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * D2R, g = e.gamma * D2R;
    // gravity ("up") vector in device coordinates
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b), uz = Math.cos(g) * Math.cos(b);
    const steer = Math.atan2(-ux, Math.max(uy, 0.05) + 0.0);          // wheel-style rotation about the screen normal
    const elev = Math.asin(clamp(uz, -1, 1));                         // elevation of the screen normal
    const r = this._raw;
    r.steer = steer; r.elev = elev; r.ok = true;
    this.hasMotion = true;
  }

  /** capture the current pose as "neutral" (called on start and from the HUD) */
  calibrate() { this._needCal = true; this._calBuf = []; }

  update(dt) {
    let steer = 0, pitch = 0;
    const k = this.keys;
    if (this._raw.ok) {
      const r = this._raw;
      if (this._needCal) {
        this._calBuf.push([r.steer, r.elev]);
        if (this._calBuf.length >= 8) {
          let s = 0, e = 0; for (const [a, b] of this._calBuf) { s += a; e += b; }
          this._neutral.steer = s / this._calBuf.length;
          this._neutral.elev = e / this._calBuf.length;
          this._needCal = false;
        }
      }
      const ds = r.steer - this._neutral.steer;
      const de = r.elev - this._neutral.elev;
      const dz = 2.0 * D2R;
      const shape = (x, range) => { const a = Math.max(0, Math.abs(x) - dz) / range; return Math.sign(x) * Math.min(1, Math.pow(a, 1.15)); };
      steer = shape(ds, 32 * D2R / this.sens);
      pitch = shape(de, 24 * D2R / this.sens) * (this.invert ? -1 : 1);
      this.lastTilt.steer = ds; this.lastTilt.pitch = de;
    }
    // keyboard (also works together with tilt)
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ky = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    if (kx) steer = kx;
    if (ky) pitch = ky * (this.invert ? -1 : 1);
    const gasKey = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE');
    const brakeKey = k.has('KeyB') || k.has('ControlLeft') || k.has('KeyQ');
    // smooth
    const a = 1 - Math.exp(-dt * 14);
    this.steer += (steer - this.steer) * a;
    this.pitch += (pitch - this.pitch) * a;
    this.gasV = this.gas || gasKey ? 1 : 0;
    this.brakeV = this.brake || brakeKey ? 1 : 0;
  }
}
