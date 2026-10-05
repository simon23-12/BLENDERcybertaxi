// Atmospheric layers: steam plumes rising from roof vents and street grates (soft, animated, fogged).
import * as THREE from 'three';
import { enableSkyFog } from './fog.js';
import { timeU, mulberry32 } from './util.js';
import { P, NB } from './city.js';

const VS = /* glsl */`
attribute vec4 iPos;      // xyz base, w = seed
attribute vec3 iSize;     // width, height, brightness
uniform float uTime;
varying vec2 vUv; varying float vSeed; varying float vB;
#include <fog_pars_vertex>
void main(){
  vUv = uv; vSeed = iPos.w; vB = iSize.z;
  vec3 base = iPos.xyz;
  vec3 toCam = cameraPosition - base; toCam.y = 0.0;
  vec3 f = normalize(toCam + vec3(1e-3, 0.0, 0.0));
  vec3 r = vec3(f.z, 0.0, -f.x);
  float lean = uv.y * uv.y * iSize.y * 0.18;                     // wind pushes the top of the plume
  vec3 wp = base + r * (position.x * iSize.x * (0.45 + 1.1 * uv.y)) + vec3(lean, uv.y * iSize.y, lean * 0.4);
  wp += r * sin(uTime * 0.4 + iPos.w * 30.0 + uv.y * 3.0) * uv.y * 3.0;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */`
precision highp float;
uniform float uTime; uniform vec3 uColor; uniform float uGain;
varying vec2 vUv; varying float vSeed; varying float vB;
#include <fog_pars_fragment>
float h21(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 q = vec2(vUv.x * 2.2, vUv.y * 3.2 - uTime * 0.22) + vSeed * 17.0;
  float n = vn(q) * 0.55 + vn(q * 2.3 + 3.1) * 0.3 + vn(q * 5.1 - 1.7) * 0.15;
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float shape = smoothstep(0.0, 0.55, edge) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  float a = clamp((n - 0.32) * 1.9, 0.0, 1.0) * shape * vB;
  // lit from below by the street / vent light
  vec3 c = mix(uColor * 1.6, uColor * 0.7, vUv.y);
  gl_FragColor = vec4(c * a * uGain, a);
  #include <fog_fragment>
}`;

export class Atmos {
  constructor(scene, city, tier) {
    this.scene = scene;
    const rng = mulberry32(777);
    const items = [];
    const nRoof = tier.steam ?? 40;
    // roof vents (the decorative boxes on tower tops)
    const vents = city.boxes.filter((b) => b.solid === false && b.layer === 2 && (b.y1 - b.y0) < 14);
    for (let i = 0; i < nRoof && vents.length; i++) {
      const b = vents[Math.floor(rng() * vents.length)];
      items.push([(b.x0 + b.x1) / 2, b.y1, (b.z0 + b.z1) / 2, rng(), 10 + rng() * 10, 30 + rng() * 40, 0.55 + rng() * 0.4]);
    }
    // street grates: big lazy plumes out of the canyon floor
    const nStreet = Math.round(nRoof * 0.8);
    for (let i = 0; i < nStreet; i++) {
      const axis = rng() < 0.5;
      const line = (Math.floor(rng() * (2 * NB + 1)) - NB + 0.5) * P;
      const along = (rng() - 0.5) * 2 * NB * P;
      const off = (rng() - 0.5) * 50;
      const x = axis ? along : line + off, z = axis ? line + off : along;
      items.push([x, 0, z, rng(), 26 + rng() * 22, 90 + rng() * 110, 0.6 + rng() * 0.4]);
    }
    const n = items.length;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.translate(0, 0.5, 0);
    const ip = new Float32Array(n * 4), is = new Float32Array(n * 3);
    items.forEach((it, i) => { ip.set(it.slice(0, 4), i * 4); is.set(it.slice(4), i * 3); });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(is, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uTime: timeU, uColor: { value: new THREE.Color(0.42, 0.36, 0.40) }, uGain: { value: 0.55 }, ...THREE.UniformsLib.fog },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    enableSkyFog(mat, { additive: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false; mesh.renderOrder = 6;
    scene.add(mesh);
    this.mesh = mesh;
  }
}
