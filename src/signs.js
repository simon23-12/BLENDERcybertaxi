// Blender-rendered neon signs (atlas) mounted on the towers: flush boards + perpendicular blade signs.
import * as THREE from 'three';
import { enableSkyFog } from './fog.js';
import { timeU, mulberry32 } from './util.js';

const VS = /* glsl */`
attribute vec4 iRect; attribute vec4 iParam;
varying vec2 vUv; varying vec4 vP;
#include <fog_pars_vertex>
void main(){
  vUv = iRect.xy + uv * iRect.zw;
  vP = iParam;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = /* glsl */`
precision highp float;
uniform sampler2D tAtlas; uniform float uTime; uniform float uGain;
varying vec2 vUv; varying vec4 vP;
#include <fog_pars_fragment>
void main(){
  vec3 c = texture2D(tAtlas, vUv).rgb;
  // flicker: occasional dropouts per sign
  float f = 1.0;
  float t = uTime * (0.6 + vP.y * 1.4) + vP.y * 40.0;
  float drop = step(0.965, fract(sin(floor(t * 3.0) * 12.9898 + vP.y * 78.233) * 43758.5453));
  f *= mix(1.0, 0.18, drop * step(0.5, vP.z));
  f *= 0.92 + 0.08 * sin(uTime * 23.0 + vP.y * 50.0);
  gl_FragColor = vec4(c * uGain * vP.x * f, 1.0);
  #include <fog_fragment>
}`;

const HALO_VS = /* glsl */`
attribute vec3 iPos; attribute vec4 iCol;
varying vec2 vQ; varying vec3 vC;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += position.xy * iCol.a;
  vQ = position.xy * 2.0; vC = iCol.rgb;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const HALO_FS = /* glsl */`
precision highp float;
varying vec2 vQ; varying vec3 vC; uniform float uGain;
#include <fog_pars_fragment>
void main(){
  float r2 = dot(vQ, vQ);
  float a = max(exp(-r2 * 3.2) - 0.04, 0.0);
  gl_FragColor = vec4(vC * a * uGain, a);
  #include <fog_fragment>
}`;
const HOLO_FS = /* glsl */`
precision highp float;
uniform sampler2D tAtlas; uniform float uTime; uniform float uGain;
varying vec2 vUv; varying vec4 vP;
#include <fog_pars_fragment>
float hh(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  float t = uTime + vP.y * 10.0;
  float band = floor(uv.y / vP.w * 30.0);
  uv.x += step(0.93, hh(band + floor(t * 7.0))) * (hh(band * 3.1) - 0.5) * 0.004;
  vec3 c = texture2D(tAtlas, uv).rgb;
  float scan = 0.62 + 0.38 * sin((vUv.y / vP.w) * 420.0 - t * 9.0);
  float flick = 0.85 + 0.15 * sin(t * 31.0) * sin(t * 7.3);
  float drop = step(0.985, hh(floor(t * 5.0) + vP.y * 17.0));
  c = mix(c, c * vec3(0.55, 1.0, 1.15), 0.35);
  float a = scan * flick * (1.0 - drop * 0.8) * uGain * vP.x;
  gl_FragColor = vec4(c * a, a);
  #include <fog_fragment>
}`;

export class Signs {
  constructor(scene, city) { this.scene = scene; this.city = city; }

  async load(renderer, maxCount = 420) {
    const [meta, tex] = await Promise.all([
      fetch('assets/ui/signs.json').then((r) => r.json()),
      new Promise((res, rej) => new THREE.TextureLoader().load('assets/ui/signs.webp', res, undefined, rej)),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const AW = meta.atlas[0], AH = meta.atlas[1];
    const defs = meta.signs.map((s) => ({ ...s, rect: [s.x / AW, 1 - (s.y + s.h) / AH, s.w / AW, s.h / AH], aspect: s.w / s.h }));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { tAtlas: { value: tex }, uTime: timeU, uGain: { value: 2.6 }, ...THREE.UniformsLib.fog },
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.FrontSide,
    });
    enableSkyFog(mat);
    const rng = mulberry32(4242);
    const city = this.city;
    const inst = [];            // {pos, yaw, w, h, def}
    const tiers = city.boxes.map((b, i) => [b, i]).filter(([b]) => !b.ledge && (b.y1 - b.y0) >= 56 && b.x1 - b.x0 >= 40 && b.z1 - b.z0 >= 40);
    let guard = 0;
    while (inst.length < maxCount && guard++ < maxCount * 25) {
      const [b, id] = tiers[Math.floor(rng() * tiers.length)];
      const def = defs[Math.floor(rng() * defs.length)];
      const face = Math.floor(rng() * 4);               // 0:+x 1:-x 2:+z 3:-z
      const vertical = def.h > def.w;
      const h = vertical ? 18 + rng() * 22 : 7 + rng() * 10;
      const w = h * def.aspect;
      const along = face < 2 ? (b.z1 - b.z0) : (b.x1 - b.x0);
      if (along < w + 10) continue;
      const span = b.y1 - b.y0;
      if (span < h + 20) continue;
      const y = b.y0 + 10 + h / 2 + rng() * (span - h - 18);
      const c = (rng() - 0.5) * (along - w - 8);
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      let nx = 0, nz = 0, px, pz;
      if (face === 0) { nx = 1; px = b.x1 + 1.1; pz = mz + c; } else if (face === 1) { nx = -1; px = b.x0 - 1.1; pz = mz + c; }
      else if (face === 2) { nz = 1; pz = b.z1 + 1.1; px = mx + c; } else { nz = -1; pz = b.z0 - 1.1; px = mx + c; }
      // free space in front of the sign (so it is visible from the street)
      const ext = 18;
      const ax0 = Math.min(px, px + nx * ext) - (nz ? w / 2 : 0), ax1 = Math.max(px, px + nx * ext) + (nz ? w / 2 : 0);
      const az0 = Math.min(pz, pz + nz * ext) - (nx ? w / 2 : 0), az1 = Math.max(pz, pz + nz * ext) + (nx ? w / 2 : 0);
      if (city.overlaps(ax0, ax1, y - h / 2, y + h / 2, az0, az1, id)) continue;
      const yaw = Math.atan2(nx, nz);
      const bright = 0.7 + rng() * 0.6, fl = rng() < 0.3 ? 1 : 0;
      if (vertical && rng() < 0.55 && along > w + 24) {
        // blade sign: perpendicular to the wall, two-sided, near the face corner
        const bx = px + nx * (w / 2 + 0.6), bz = pz + nz * (w / 2 + 0.6);
        const tx = nz, tz = -nx;                    // tangent
        inst.push({ x: bx + tx * 0.0, y, z: bz + tz * 0.0, yaw: yaw + Math.PI / 2, w, h, def, bright, fl });
        inst.push({ x: bx, y, z: bz, yaw: yaw - Math.PI / 2, w, h, def, bright, fl });
      } else {
        inst.push({ x: px, y, z: pz, yaw, w, h, def, bright, fl });
      }
    }
    const n = inst.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    const rect = new Float32Array(n * 4), par = new Float32Array(n * 4);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    inst.forEach((o, i) => {
      q.setFromAxisAngle(up, o.yaw); s.set(o.w, o.h, 1); p.set(o.x, o.y, o.z);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
      rect.set(o.def.rect, i * 4); par.set([o.bright, rng(), o.fl, 0], i * 4);
    });
    geo.setAttribute('iRect', new THREE.InstancedBufferAttribute(rect, 4));
    geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(par, 4));
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.scene.add(mesh);
    this.count = n; this.inst = inst;
    this.makeHalos(inst, Math.min(n, maxCount));
    this.makeHolograms(defs, tex, rng, Math.round(maxCount / 28));
    return this;
  }

  // soft neon light pollution around every sign (additive, camera facing, fogged)
  makeHalos(inst, n) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = inst[i];
      const c = o.def.color || [1, 1, 1];
      const g = (c[0] + c[1] + c[2]) / 3;
      const sat = c.map((v) => Math.max(0, g + (v - g) * 2.0));
      const nx = Math.sin(o.yaw), nz = Math.cos(o.yaw);
      const size = Math.max(o.w, o.h) * 1.9;
      pos.set([o.x + nx * size * 0.1, o.y, o.z + nz * size * 0.1], i * 3);
      col.set([sat[0] * o.bright, sat[1] * o.bright, sat[2] * o.bright, size], i * 4);
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 4));
    const mat = new THREE.ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, uniforms: { uGain: { value: 0.28 }, ...THREE.UniformsLib.fog },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    enableSkyFog(mat, { additive: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false; mesh.renderOrder = 9;
    this.scene.add(mesh);
    this.halos = mesh;
  }

  // giant flickering hologram ads floating in front of tall towers
  makeHolograms(defs, tex, rng, count) {
    const city = this.city;
    const big = city.boxes.map((b, i) => [b, i]).filter(([b]) => !b.ledge && b.solid !== false && b.y1 > 260 && (b.y1 - b.y0) > 120);
    const inst = [];
    let guard = 0;
    while (inst.length < count && guard++ < count * 60) {
      const [b, id] = big[Math.floor(rng() * big.length)];
      const def = defs[Math.floor(rng() * defs.length)];
      const face = Math.floor(rng() * 4);
      const vertical = def.h > def.w;
      const w = vertical ? 26 + rng() * 14 : 48 + rng() * 34;
      const h = w / def.aspect;
      const y = Math.max(b.y0 + h / 2 + 20, Math.min(b.y1 - h / 2 - 10, b.y0 + 40 + rng() * (b.y1 - b.y0)));
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      const off = 9 + rng() * 6;
      let nx = 0, nz = 0, px, pz;
      if (face === 0) { nx = 1; px = b.x1 + off; pz = mz; } else if (face === 1) { nx = -1; px = b.x0 - off; pz = mz; }
      else if (face === 2) { nz = 1; pz = b.z1 + off; px = mx; } else { nz = -1; pz = b.z0 - off; px = mx; }
      const ext = 40;
      if (city.overlaps(Math.min(px, px + nx * ext) - (nz ? w / 2 : 2), Math.max(px, px + nx * ext) + (nz ? w / 2 : 2), y - h / 2, y + h / 2,
        Math.min(pz, pz + nz * ext) - (nx ? w / 2 : 2), Math.max(pz, pz + nz * ext) + (nx ? w / 2 : 2), id)) continue;
      inst.push({ x: px, y, z: pz, yaw: Math.atan2(nx, nz), w, h, def });
    }
    const n = inst.length;
    if (!n) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    const rect = new Float32Array(n * 4), par = new Float32Array(n * 4);
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: HOLO_FS, uniforms: { tAtlas: { value: tex }, uTime: timeU, uGain: { value: 1.35 }, ...THREE.UniformsLib.fog },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    enableSkyFog(mat, { additive: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    inst.forEach((o, i) => {
      q.setFromAxisAngle(up, o.yaw); sc.set(o.w, o.h, 1); p.set(o.x, o.y, o.z);
      m.compose(p, q, sc); mesh.setMatrixAt(i, m);
      rect.set(o.def.rect, i * 4); par.set([0.8 + rng() * 0.4, rng(), 0, o.def.rect[3]], i * 4);
    });
    geo.setAttribute('iRect', new THREE.InstancedBufferAttribute(rect, 4));
    geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(par, 4));
    mesh.frustumCulled = false; mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.holos = mesh; this.holoInst = inst;
    // halos for the holograms
    const hi = inst.map((o) => ({ ...o, bright: 0.9, w: o.w * 0.6, h: o.h * 0.6 }));
    const hgeo = new THREE.PlaneGeometry(1, 1);
    const hp = new Float32Array(n * 3), hc = new Float32Array(n * 4);
    hi.forEach((o, i) => {
      const c = o.def.color || [1, 1, 1]; const g = (c[0] + c[1] + c[2]) / 3;
      hp.set([o.x, o.y, o.z], i * 3);
      hc.set([...c.map((v) => Math.max(0, g + (v - g) * 2.0) * 0.8), Math.max(o.w, o.h) * 2.4], i * 4);
    });
    hgeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(hp, 3));
    hgeo.setAttribute('iCol', new THREE.InstancedBufferAttribute(hc, 4));
    const hm = new THREE.InstancedMesh(hgeo, this.halos.material, n);
    hm.frustumCulled = false; hm.renderOrder = 9;
    this.scene.add(hm);
  }
}
