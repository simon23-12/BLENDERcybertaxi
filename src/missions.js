// Taxi fares: land on a ledge pad, passenger boards, fly to the destination ledge, get paid. Never fails.
import * as THREE from 'three';
import { clamp } from './util.js';

const QUOTES = [
  'Take me to the top. And please, no turbulence.',
  'Zero-G Lounge, and step on it!',
  'Is it always this foggy down here?',
  'My meeting started ten minutes ago…',
  'Do you take credits, or only cash?',
  'Just drive. I need to think.',
  'Last time the cabbie talked the whole way.',
  'Mind the traffic — I bruise easily.',
  'I heard the view at night is something else.',
];
const DEST = ['LOTUS TOWER', 'ZERO-G LOUNGE', 'MEGA BAZAAR', 'ORBIT HOTEL', 'NEON DOCKS', 'SKY CLINIC', 'ARCADE 9', 'NOODLE SPIRE', 'HELIX PLAZA', 'AURORA DECK'];

export class Missions {
  constructor({ city, fx, hud, audio, scene }) {
    this.city = city; this.fx = fx; this.hud = hud; this.audio = audio; this.scene = scene;
    this.mode = 'taxi';
    this.state = 'pickup';
    this.money = 0;
    this.target = null; this.pickup = null;
    this.boardT = 0;
    this.tStart = 0; this.t = 0;
    this.beamPick = fx.addBeam(0x35e8ff, 3.2, 420);
    this.beamDrop = fx.addBeam(0xffb62e, 3.2, 420);
    this.beamPick.visible = this.beamDrop.visible = false;
    this.name = DEST[0];
    this.worldMarker = new THREE.Vector3();
    this.hasMarker = false;
    // passenger hologram sprite
    this.passenger = this._makePassenger();
    scene.add(this.passenger);
    this.passenger.visible = false;
  }

  _makePassenger() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
    const glow = (draw) => { g.shadowColor = '#35e8ff'; g.shadowBlur = 14; g.fillStyle = '#9ff6ff'; draw(); };
    glow(() => {
      g.beginPath(); g.arc(64, 44, 22, 0, 7); g.fill();                  // head
      g.beginPath(); g.moveTo(34, 74); g.quadraticCurveTo(64, 62, 94, 74); g.lineTo(100, 170); g.lineTo(28, 170); g.closePath(); g.fill();   // coat
      g.fillRect(40, 168, 18, 70); g.fillRect(70, 168, 18, 70);           // legs
      g.fillRect(104, 150, 18, 26);                                       // case
    });
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 128, 1.5);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 2.2, 2.2), fog: false });
    const s = new THREE.Sprite(m);
    s.scale.set(3.2, 6.4, 1);
    s.center.set(0.5, 0);
    return s;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'free') {
      this.beamPick.visible = this.beamDrop.visible = false; this.passenger.visible = false; this.hasMarker = false;
      this.hud.setMission(null);
    } else this.startPickup(this._lastPos || new THREE.Vector3(0, 100, 0));
  }

  startPickup(pos) {
    const L = this.city.ledges;
    const cand = L.filter((l) => { const d = Math.hypot(l.center.x - pos.x, l.center.z - pos.z); return d > 260 && d < 1100; });
    this.pickup = (cand.length ? cand : L)[Math.floor(Math.random() * (cand.length || L.length))];
    this.target = this.pickup;
    this.state = 'pickup';
    this.boardT = 0;
    this.beamPick.position.copy(this.pickup.landing).setY(this.pickup.center.y);
    this.beamPick.visible = true; this.beamDrop.visible = false;
    this.passenger.position.copy(this.pickup.landing).setY(this.pickup.center.y);
    this.passenger.position.addScaledVector(this.pickup.normal, -4);
    this.passenger.visible = true;
    this.name = 'PICKUP';
    this.tStart = this.t;
    this.hud.setMission('PASSENGER WAITING', 'Land on the lit ledge · hold still');
  }

  startCarry() {
    const L = this.city.ledges;
    const p = this.pickup.center;
    let cand = L.filter((l) => { const d = Math.hypot(l.center.x - p.x, l.center.z - p.z); return d > 520 && d < 1500 && l !== this.pickup; });
    if (!cand.length) cand = L.filter((l) => l !== this.pickup);
    this.target = cand[Math.floor(Math.random() * cand.length)];
    this.state = 'carry';
    this.boardT = 0;
    this.dest = DEST[Math.floor(Math.random() * DEST.length)];
    this.beamPick.visible = false; this.beamDrop.visible = true;
    this.beamDrop.position.copy(this.target.landing).setY(this.target.center.y);
    this.passenger.visible = false;
    this.tCarry = this.t;
    this.fareDist = Math.hypot(this.target.center.x - p.x, this.target.center.z - p.z);
    this.hud.setMission('DESTINATION · ' + this.dist2(this.dest), 'Bring them to the ' + this.dest);
  }

  dist2(n) { return n; }

  update(dt, taxi, camera) {
    this.t += dt;
    this._lastPos = taxi.pos;
    const hud = this.hud;
    if (this.mode === 'free' || !this.target) { this.hasMarker = false; return; }
    const tg = this.target;
    const dx = taxi.pos.x - tg.landing.x, dz = taxi.pos.z - tg.landing.z;
    const dh = Math.hypot(dx, dz), dy = taxi.pos.y - tg.landing.y;
    const dist = Math.hypot(dh, dy);
    const inZone = dh < 16 && dy > -6 && dy < 16;
    const slow = taxi.speed < 15;
    const want = inZone && slow;
    this.boardT = clamp(this.boardT + (want ? dt : -dt * 2.5), 0, 2.4);
    const prog = this.boardT / 2.4;
    hud.setBoard(prog, inZone && !slow ? 'SLOW DOWN — HOLD BRAKE' : null);

    // beam pulse + passenger
    const beam = this.state === 'pickup' ? this.beamPick : this.beamDrop;
    beam.material.uniforms.uGain.value = 0.9 + 0.5 * Math.sin(this.t * 4) * (inZone ? 1 : 0.4) + (want ? 1.2 : 0);
    if (this.passenger.visible) {
      this.passenger.material.opacity = 0.85 + 0.15 * Math.sin(this.t * 9);
      this.passenger.position.lerp(want ? taxi.pos.clone().add(new THREE.Vector3(0, -2, 0)) : this.passenger.position, want ? clamp(prog * prog * 0.12, 0, 0.12) : 0);
      this.passenger.scale.setScalar(1 - prog * 0.5);
    }

    if (this.boardT >= 2.4) {
      this.boardT = 0;
      if (this.state === 'pickup') {
        this.audio.board(); this.audio.chime(true);
        hud.toast('PASSENGER ON BOARD\n“' + QUOTES[Math.floor(Math.random() * QUOTES.length)] + '”', 3600);
        this.startCarry();
      } else {
        const secs = this.t - this.tCarry;
        const base = 40 + Math.round(this.fareDist * 0.16);
        const bonus = Math.max(0, Math.round((this.fareDist / 38 - secs) * 1.8));
        const tip = Math.round(Math.random() * 20);
        const fare = base + bonus + tip;
        this.money += fare;
        hud.setFare(this.money);
        this.audio.cash(); this.audio.chime(false);
        hud.toast(`ARRIVED · +$${fare}\n${bonus ? 'SPEED BONUS +$' + bonus : 'THANK YOU!'}`, 3200);
        this.beamDrop.visible = false;
        this.startPickup(taxi.pos);
      }
      return;
    }

    // marker position (above the target) + text
    this.hasMarker = true;
    this.worldMarker.copy(tg.landing).setY(tg.center.y + 34);
    this.markerText = `${this.state === 'pickup' ? 'PICKUP' : (this.dest || 'DROP-OFF')} · ${Math.round(dist)} M`;
    if (this.state === 'pickup') hud.setMission('PASSENGER WAITING', `${Math.round(dist)} m · ${this.dirText(taxi, tg)}`);
    else hud.setMission('TO ' + (this.dest || 'DESTINATION'), `${Math.round(dist)} m · ${this.dirText(taxi, tg)}`);
  }

  dirText(taxi, tg) {
    const dy = tg.landing.y - taxi.pos.y;
    return dy > 40 ? 'CLIMB' : dy < -40 ? 'DESCEND' : 'LEVEL';
  }
}
