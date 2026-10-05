// Visual effects: thruster plasma, speed streaks, sparks, blinking aviation beacons, mission beams.
import * as THREE from 'three';
import { enableSkyFog } from './fog.js';
import { timeU, clamp } from './util.js';

const flameVS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vT;
#include <fog_pars_vertex>
void main(){
  vT = uv.y;                       // 0 at nozzle .. 1 at tip
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const flameFS = /* glsl */`
precision highp float;
varying vec3 vN; varying vec3 vV; varying float vT;
uniform float uTime; uniform float uPower; uniform vec3 uCore; uniform vec3 uEdge; uniform float uSeed;
#include <fog_pars_fragment>
float h(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float f = abs(dot(normalize(vN), normalize(vV)));
  float flick = 0.75 + 0.25 * sin(uTime * 61.0 + uSeed) * sin(uTime * 37.0 + uSeed * 2.0);
  float len = pow(max(1.0 - vT, 0.0), 1.4);
  float diamonds = 0.8 + 0.2 * sin(vT * 38.0 - uTime * 24.0 + uSeed);
  float a = len * pow(f, 1.2) * flick * diamonds * uPower;
  vec3 col = mix(uEdge, uCore, pow(f, 2.0) * (1.0 - vT * 0.6));
  gl_FragColor = vec4(col * a * 3.2, a);
  #include <fog_fragment>
}`;

const streakVS = /* glsl */`
attribute vec3 aBase; attribute float aEnd; attribute float aSeed;
uniform vec3 uCam; uniform vec3 uVel; uniform float uBox; uniform float uLen; uniform float uTime;
varying float vA;
void main(){
  vec3 rel = aBase - uCam;
  rel = mod(rel + vec3(uBox * 0.5), vec3(uBox)) - vec3(uBox * 0.5);
  vec3 p = uCam + rel;
  vec3 dir = -normalize(uVel + vec3(0.0001));
  p += dir * aEnd * uLen;
  float d = length(rel) / (uBox * 0.5);
  vA = (1.0 - aEnd) * (1.0 - smoothstep(0.55, 1.0, d)) * (0.4 + 0.6 * fract(aSeed * 7.31));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const streakFS = /* glsl */`
precision highp float; varying float vA; uniform float uPower; uniform vec3 uColor;
void main(){ gl_FragColor = vec4(uColor * vA * uPower, vA * uPower); }`;

const pointsVS = /* glsl */`
attribute float aPhase; attribute float aSize; attribute vec3 aColor; attribute float aLife;
uniform float uTime; uniform float uScale; uniform float uBlink; uniform float uMode;
varying vec3 vC; varying float vA;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float b = 1.0;
  if (uBlink > 0.5) { float t = fract(uTime * 0.55 + aPhase); b = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.12, 0.5, t)); b = max(b, 0.04); }
  vC = aColor; vA = b * aLife;
  gl_PointSize = clamp(aSize * uScale / max(-mvPosition.z, 1.0), 1.5, 90.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const pointsFS = /* glsl */`
precision highp float;
varying vec3 vC; varying float vA; uniform float uGain;
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.0) * vA;
  gl_FragColor = vec4(vC * a * uGain, a);
  #include <fog_fragment>
}`;

const beamVS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vH;
#include <fog_pars_vertex>
void main(){
  vH = uv.y;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const beamFS = /* glsl */`
precision highp float;
varying vec3 vN; varying vec3 vV; varying float vH; uniform vec3 uColor; uniform float uTime; uniform float uGain;
#include <fog_pars_fragment>
void main(){
  float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - vH * 20.0);
  float a = f * pulse * (1.0 - vH * 0.85) * uGain;
  gl_FragColor = vec4(uColor * a, a);
  #include <fog_fragment>
}`;

export function addMat(vs, fs, uniforms, extra = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, uniforms: { ...THREE.UniformsLib.fog, ...uniforms },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, ...extra,
  });
  enableSkyFog(m, { additive: true });
  return m;
}

export class FX {
  constructor(scene, taxiGroup, marks, city, tier) {
    this.scene = scene; this.group = taxiGroup; this.tier = tier;
    // ---- thrusters
    this.flames = [];
    const mk = (pos, r, len, seed) => {
      const g = new THREE.CylinderGeometry(r * 0.12, r, len, 20, 1, true);
      g.translate(0, len / 2, 0);          // base at origin, tip at +y
      g.rotateX(-Math.PI / 2);             // tip towards -z (rear)
      const m = addMat(flameVS, flameFS, {
        uTime: timeU, uPower: { value: 0.0 }, uCore: { value: new THREE.Color(0.75, 0.92, 1.0) },
        uEdge: { value: new THREE.Color(0.1, 0.35, 1.0) }, uSeed: { value: seed },
      }, { side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(pos);
      mesh.renderOrder = 5;
      taxiGroup.add(mesh);
      this.flames.push({ mesh, m, len, big: len > 3 });
    };
    const P = (n, d) => marks[n] || d;
    mk(P('thr_rl', new THREE.Vector3(-1.0, 0.66, -3.4)), 0.30, 5.5, 0.0);
    mk(P('thr_rr', new THREE.Vector3(1.0, 0.66, -3.4)), 0.30, 5.5, 2.0);
    this.flameFront = [];
    // underside glow (bloom catches it)
    // ---- speed streaks
    const n = tier.streaks;
    const base = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2), seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 160, y = (Math.random() - 0.5) * 160, z = (Math.random() - 0.5) * 160, s = Math.random();
      for (let k = 0; k < 2; k++) { base.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; seed[i * 2 + k] = s; }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    sg.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    sg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.streakU = { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, 0, 1) }, uBox: { value: 160 }, uLen: { value: 6 },
      uTime: timeU, uPower: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.85, 1.0) } };
    this.streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({
      vertexShader: streakVS, fragmentShader: streakFS, uniforms: this.streakU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.streaks.frustumCulled = false; this.streaks.renderOrder = 6;
    scene.add(this.streaks);
    // ---- sparks
    const ns = 160;
    this.sp = { n: ns, pos: new Float32Array(ns * 3), vel: new Float32Array(ns * 3), life: new Float32Array(ns), col: new Float32Array(ns * 3), size: new Float32Array(ns), phase: new Float32Array(ns), head: 0 };
    const spg = new THREE.BufferGeometry();
    spg.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    spg.setAttribute('aLife', new THREE.BufferAttribute(this.sp.life, 1).setUsage(THREE.DynamicDrawUsage));
    spg.setAttribute('aColor', new THREE.BufferAttribute(this.sp.col, 3));
    spg.setAttribute('aSize', new THREE.BufferAttribute(this.sp.size, 1));
    spg.setAttribute('aPhase', new THREE.BufferAttribute(this.sp.phase, 1));
    this.sparks = new THREE.Points(spg, addMat(pointsVS, pointsFS, { uTime: timeU, uScale: { value: 900 }, uBlink: { value: 0 }, uMode: { value: 0 }, uGain: { value: 3.0 } }));
    this.sparks.frustumCulled = false; this.sparks.renderOrder = 7;
    scene.add(this.sparks);
    // ---- aviation beacons
    const bp = city.beacons;
    const bpos = new Float32Array(bp.length * 3), bph = new Float32Array(bp.length), bsz = new Float32Array(bp.length), bcol = new Float32Array(bp.length * 3), blife = new Float32Array(bp.length).fill(1);
    bp.forEach((p, i) => { bpos.set([p.x, p.y, p.z], i * 3); bph[i] = Math.random(); bsz[i] = 60; bcol.set([1.0, 0.1, 0.06], i * 3); });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bg.setAttribute('aPhase', new THREE.BufferAttribute(bph, 1));
    bg.setAttribute('aSize', new THREE.BufferAttribute(bsz, 1));
    bg.setAttribute('aColor', new THREE.BufferAttribute(bcol, 3));
    bg.setAttribute('aLife', new THREE.BufferAttribute(blife, 1));
    this.beacons = new THREE.Points(bg, addMat(pointsVS, pointsFS, { uTime: timeU, uScale: { value: 900 }, uBlink: { value: 1 }, uMode: { value: 0 }, uGain: { value: 6.0 } }));
    this.beacons.frustumCulled = false; this.beacons.renderOrder = 7;
    scene.add(this.beacons);
    // ---- lights on the taxi
    this.spot = new THREE.SpotLight(0xdff0ff, 9000, 260, 0.42, 0.85, 1.4);
    this.spotTarget = new THREE.Object3D();
    this.spot.position.set(0, 0.9, 2.6); this.spotTarget.position.set(0, -2, 60);
    taxiGroup.add(this.spot, this.spotTarget); this.spot.target = this.spotTarget;
    this.under = new THREE.PointLight(0x35c8ff, 900, 60, 1.6);
    this.under.position.set(0, -0.6, 0);
    taxiGroup.add(this.under);
    this.rear = new THREE.PointLight(0xff2a1a, 260, 40, 1.6);
    this.rear.position.set(0, 1.0, -3.6);
    taxiGroup.add(this.rear);
    this.beams = [];
    // ---- rooftop searchlights (volumetric-looking cones)
    this.search = [];
    const tops = city.beacons.filter((p) => p.y > 220);
    const cols = [0xbfe8ff, 0x35e8ff, 0xff7ad8, 0xffd9a0];
    const nS = Math.min(tier.searchlights ?? 10, tops.length);
    for (let i = 0; i < nS; i++) {
      const p = tops[Math.floor((i + 0.5) * tops.length / nS)];
      const g = new THREE.CylinderGeometry(26, 0.6, 900, 24, 1, true);
      g.translate(0, 450, 0);
      const m = addMat(beamVS, beamFS, { uColor: { value: new THREE.Color(cols[i % cols.length]) }, uTime: timeU, uGain: { value: 0.16 } }, { side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(p); mesh.position.y -= 2;
      mesh.frustumCulled = false; mesh.renderOrder = 2;
      scene.add(mesh);
      this.search.push({ mesh, ph: Math.random() * 6.28, sp: 0.12 + Math.random() * 0.2, tilt: 0.22 + Math.random() * 0.3 });
    }
  }

  addBeam(color, radius, height) {
    const g = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
    g.translate(0, height / 2, 0);
    const m = addMat(beamVS, beamFS, { uColor: { value: new THREE.Color(color) }, uTime: timeU, uGain: { value: 1.2 } }, { side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 4;
    this.scene.add(mesh);
    return mesh;
  }

  spark(p, n, speed, color = [1.0, 0.7, 0.3]) {
    const s = this.sp;
    for (let i = 0; i < n; i++) {
      const k = s.head; s.head = (s.head + 1) % s.n;
      s.pos[k * 3] = p.x; s.pos[k * 3 + 1] = p.y; s.pos[k * 3 + 2] = p.z;
      const a = Math.random() * 6.28, e = Math.random() * 2 - 1, r = Math.sqrt(1 - e * e);
      const v = speed * (0.4 + Math.random());
      s.vel[k * 3] = Math.cos(a) * r * v; s.vel[k * 3 + 1] = e * v; s.vel[k * 3 + 2] = Math.sin(a) * r * v;
      s.life[k] = 1; s.size[k] = 12 + Math.random() * 20;
      s.col[k * 3] = color[0]; s.col[k * 3 + 1] = color[1]; s.col[k * 3 + 2] = color[2];
    }
    this.sparks.geometry.attributes.aColor.needsUpdate = true;
    this.sparks.geometry.attributes.aSize.needsUpdate = true;
  }

  update(dt, taxi, camera, inp) {
    for (const l of this.search) {
      const a = timeU.value * l.sp + l.ph;
      l.mesh.rotation.set(Math.sin(a) * l.tilt, 0, Math.cos(a * 0.9) * l.tilt);
    }
    // thrusters
    const pw = 0.45 + 0.35 * clamp(taxi.speed / 60, 0, 1) + 0.9 * taxi.boost + 0.15 * (inp.gasV ? 1 : 0);
    for (const f of this.flames) {
      f.m.uniforms.uPower.value = pw;
      f.mesh.scale.set(1, 1, 0.45 + 0.85 * clamp(0.35 + taxi.boost + taxi.speed / 140, 0, 1.3));
    }
    this.under.intensity = 700 + 400 * taxi.boost;
    this.rear.intensity = inp.brakeV ? 380 : 110;
    // streaks
    const su = this.streakU;
    su.uCam.value.copy(camera.position);
    su.uVel.value.copy(taxi.vel);
    const sp = taxi.vel.length();
    su.uLen.value = 2 + sp * 0.12;
    su.uPower.value = clamp((sp - 25) / 80, 0, 1) * 1.1;
    // sparks
    const s = this.sp;
    for (let i = 0; i < s.n; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt * 1.6;
      s.vel[i * 3 + 1] -= 18 * dt;
      s.pos[i * 3] += s.vel[i * 3] * dt; s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt; s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
      if (s.life[i] < 0) s.life[i] = 0;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.aLife.needsUpdate = true;
  }

  setPointScale(h) { this.sparks.material.uniforms.uScale.value = h * 0.9; this.beacons.material.uniforms.uScale.value = h * 0.9; }
}
