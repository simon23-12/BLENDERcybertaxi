// Arcade flight model for the hover taxi + chase camera. No damage: collisions just bounce.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { EXTENT } from './city.js';

export const FLIGHT = {
  maxSpeed: 118, cruise: 26, accelGas: 34, accelIdle: 10, brakeDecel: 70,
  yawRate: 1.25, pitchMax: 0.95, radius: 3.4, minY: 14, maxY: 1500,
};

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Taxi {
  constructor() {
    this.pos = new THREE.Vector3(-120, 170, -120);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.speed = 0;
    this.yawVel = 0;
    this.quat = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.hit = 0;                 // seconds since last collision (for fx)
    this.lastImpact = 0;
    this.landed = false;
    this.boost = 0;
  }

  reset(pos, yaw = 0) {
    this.pos.copy(pos); this.yaw = yaw; this.pitch = 0; this.roll = 0; this.speed = 20;
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw)); this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  update(dt, inp, city, auto = null) {
    const F = FLIGHT;
    let steer = inp.steer, pitchIn = inp.pitch, gas = inp.gasV, brake = inp.brakeV;
    if (auto) ({ steer, pitchIn, gas, brake } = auto);

    // speed
    let target = F.cruise, acc = F.accelIdle;
    if (gas) { target = F.maxSpeed; acc = F.accelGas; }
    if (brake) { target = 0; acc = F.brakeDecel; }
    const dv = target - this.speed;
    this.speed += clamp(dv, -acc * dt, acc * dt);
    this.boost = lerp(this.boost, gas ? 1 : 0, 1 - Math.exp(-dt * 4));

    // orientation
    const yawRate = F.yawRate * (0.75 + 0.25 * clamp(this.speed / 40, 0, 1)) * (1 - 0.25 * clamp((this.speed - 60) / 60, 0, 1));
    const yawTarget = steer * yawRate;
    this.yawVel += (yawTarget - this.yawVel) * (1 - Math.exp(-dt * 6));
    this.yaw -= this.yawVel * dt;
    const pt = pitchIn * F.pitchMax;
    this.pitch += (pt - this.pitch) * (1 - Math.exp(-dt * 3.2));
    this.pitch = clamp(this.pitch, -1.2, 1.2);
    const rollT = clamp(steer * 0.62 + this.yawVel * 0.12, -0.8, 0.8);
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 5));

    // direction of travel
    const cp = Math.cos(this.pitch);
    this.fwd.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const desired = tmp.copy(this.fwd).multiplyScalar(this.speed);
    // vertical thrusters at low speed: pitch input lifts / lowers
    const hover = clamp(1 - this.speed / 28, 0, 1);
    desired.y += pitchIn * 26 * hover;
    const k = brake ? 6.5 : 3.2;
    this.vel.lerp(desired, 1 - Math.exp(-dt * k));

    // integrate with sub-steps (no tunnelling)
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / 2.2));
    const sdt = dt / steps;
    let impact = 0;
    const n = tmp2;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      const d = city.collide(this.pos, F.radius, n);
      if (d > 0) {
        const vn = this.vel.dot(n);
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          this.vel.addScaledVector(n, -vn * 1.35);                   // bounce
          this.vel.multiplyScalar(0.92);
          this.speed = Math.max(this.vel.length() * 0.9, 6);
          // keep heading roughly along the surface
          this.yaw += (Math.random() - 0.5) * 0.02;
        }
      }
    }
    if (impact > 4) { this.hit = 0; this.lastImpact = impact; } else this.hit += dt;
    this.impact = impact;

    // world bounds: soft force field
    const lim = EXTENT - 80;
    const push = (v, l) => (Math.abs(v) > l ? -Math.sign(v) * (Math.abs(v) - l) : 0);
    this.edge = 0;
    const px = push(this.pos.x, lim), pz = push(this.pos.z, lim);
    if (px || pz) { this.vel.x += px * 2.2 * dt * 10; this.vel.z += pz * 2.2 * dt * 10; this.edge = Math.min(1, (Math.abs(px) + Math.abs(pz)) / 60); }
    if (this.pos.y > F.maxY) { this.pos.y = F.maxY; this.vel.y = Math.min(0, this.vel.y); }

    // orientation quaternion: yaw -> pitch -> roll
    const q = this.quat;
    const e = new THREE.Euler(-this.pitch, this.yaw, this.roll, 'YXZ');
    q.setFromEuler(e);
  }
}

/** third-person chase camera */
export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.fov = 70;
    this.shake = 0;
    this.dist = 13.5; this.height = 4.2;
    this.init = false;
    this.t = 0;
  }

  update(dt, taxi, city) {
    this.t += dt;
    if (!this.init) { this.yaw = taxi.yaw; this.pitch = taxi.pitch; this.init = true; this.pos.copy(taxi.pos); }
    // lag behind heading
    let dy = taxi.yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 3.4));
    this.pitch += (taxi.pitch * 0.55 - this.pitch) * (1 - Math.exp(-dt * 2.6));
    this.roll += (taxi.roll * 0.35 - this.roll) * (1 - Math.exp(-dt * 3));

    const sp = clamp(taxi.speed / 118, 0, 1);
    const dist = this.dist + sp * 3.2;
    const cpch = Math.cos(this.pitch);
    const bx = -Math.sin(this.yaw) * cpch, by = -Math.sin(this.pitch), bz = -Math.cos(this.yaw) * cpch;
    const target = new THREE.Vector3(taxi.pos.x + bx * dist, taxi.pos.y + by * dist + this.height - sp * 0.8, taxi.pos.z + bz * dist);
    this.pos.lerp(target, 1 - Math.exp(-dt * 9));
    // keep camera out of geometry
    const n = new THREE.Vector3();
    city.collide(this.pos, 1.6, n);
    this.look.set(taxi.pos.x - bx * 14, taxi.pos.y - by * 14 + 1.4, taxi.pos.z - bz * 14);

    if (taxi.impact > 6) this.shake = Math.min(1.5, this.shake + taxi.impact * 0.02);
    this.shake *= Math.exp(-dt * 5);
    const s = this.shake, t = this.t;
    const c = this.camera;
    c.position.copy(this.pos);
    c.position.x += Math.sin(t * 47) * s * 0.35 + Math.sin(t * 9.3) * sp * 0.04;
    c.position.y += Math.cos(t * 53) * s * 0.35 + Math.sin(t * 7.1) * sp * 0.05;
    c.up.set(0, 1, 0);
    c.lookAt(this.look);
    c.rotateZ(-this.roll);
    const fovT = 66 + sp * 20 + taxi.boost * 5;
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}
