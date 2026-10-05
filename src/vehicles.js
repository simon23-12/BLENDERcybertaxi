// Blender-baked vehicles: the hero taxi + instanced traffic.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { enableSkyFog } from './fog.js';
import { P, NB, EXTENT } from './city.js';
import { mulberry32, clamp } from './util.js';

const texLoader = new THREE.TextureLoader();
const loadTex = (url, srgb, renderer, size = 0) => new Promise((res, rej) => texLoader.load(url, (t0) => {
  let t = t0;
  if (size && t0.image.width > size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    cv.getContext('2d').drawImage(t0.image, 0, 0, size, size);
    t = new THREE.CanvasTexture(cv); t0.dispose();
  }
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  res(t);
}, undefined, rej));

export async function loadVehicle(kind, renderer, { emissive = 3.0, size = 0 } = {}) {
  const glb = await new GLTFLoader().loadAsync(`assets/models/${kind}.glb`);
  let mesh = null; const marks = {};
  glb.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  glb.scene.updateMatrixWorld(true);
  glb.scene.traverse((o) => { if (!o.isMesh && o.name && o !== glb.scene) marks[o.name] = o.getWorldPosition(new THREE.Vector3()); });
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  const [a, n, orm, e] = await Promise.all([
    loadTex(`assets/models/${kind}_a.webp`, true, renderer, size),
    loadTex(`assets/models/${kind}_n.webp`, false, renderer, size),
    loadTex(`assets/models/${kind}_orm.webp`, false, renderer, size),
    loadTex(`assets/models/${kind}_e.webp`, true, renderer, Math.min(size || 1024, 1024)),
  ]);
  const material = new THREE.MeshStandardMaterial({
    map: a, normalMap: n, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
    emissiveMap: e, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: emissive,
  });
  material.normalScale.set(1, -1);
  enableSkyFog(material, { key: 'veh-' + kind });
  // camera-relative key + cool rim light so the cabs read clearly against the dark canyon
  const keyU = { value: new THREE.Color(0.55, 0.55, 0.6) }, rimU = { value: new THREE.Color(0.12, 0.3, 0.45) };
  material.userData.key = keyU; material.userData.rim = rimU;
  const prevOBC = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prevOBC?.(sh, r);
    sh.uniforms.uKey = keyU; sh.uniforms.uRim = rimU;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uKey; uniform vec3 uRim;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 kd = normalize(vec3(0.35, 0.8, 0.5));
          reflectedLight.directDiffuse += material.diffuseColor * uKey * max(dot(normal, kd), 0.0);
          vec3 hv = normalize(kd + normalize(vViewPosition));
          reflectedLight.directSpecular += uKey * 0.6 * pow(max(dot(normal, hv), 0.0), 2.0 / max(material.roughness * material.roughness, 0.02));
          float rim = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 3.0);
          reflectedLight.directSpecular += uRim * rim;
        }`);
  };
  return { kind, geometry, material, marks };
}

// ----------------------------------------------------------------------------------------------
// traffic
// ----------------------------------------------------------------------------------------------
const LAYERS = [46, 78, 118, 165, 220, 290, 370, 470, 600, 760];
const PAINTS = [0x1a1c24, 0x2a2f45, 0xe8e8ee, 0xb21f2d, 0xe8a317, 0x243a5e, 0x6b2f8f, 0x1d6b78, 0x888a94, 0xff5a1f, 0x0e0f12, 0xd0d4dc];

export class Traffic {
  constructor(scene, vehicles, count) {
    this.scene = scene;
    this.rng = mulberry32(99);
    this.kinds = [];
    const mix = { sedan: 0.36, sport: 0.14, van: 0.14, truck: 0.1, bus: 0.07, taxi: 0.19 };
    this.cars = [];
    const per = {};
    for (const k of Object.keys(mix)) per[k] = Math.max(2, Math.round(count * mix[k]));
    for (const [kind, v] of Object.entries(vehicles)) {
      const n = per[kind];
      if (!n || !v) continue;
      const mesh = new THREE.InstancedMesh(v.geometry, v.material, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        if (kind === 'taxi') col.setRGB(1, 1, 1); else col.setHex(PAINTS[Math.floor(this.rng() * PAINTS.length)]);
        mesh.setColorAt(i, col);
      }
      mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      const rad = { sedan: 2.6, sport: 2.6, van: 3.2, truck: 5.5, bus: 5.5, taxi: 3.0 }[kind];
      for (let i = 0; i < n; i++) this.cars.push({ kind, mesh, idx: i, x: 1e5, y: 0, z: 0, dx: 0, dz: 1, speed: 0, rad, yaw: 0, bob: this.rng() * 6.28, y0: 0 });
      this.kinds.push(mesh);
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0); this.p = new THREE.Vector3();
    this.time = 0;
  }

  respawn(c, pp) {
    const r = this.rng;
    const axisX = r() < 0.5;                    // moving along x (lane runs along a street parallel to x)
    const R = 1250;
    // street line near the player
    const base = Math.round((axisX ? pp.z : pp.x) / P - 0.5) + Math.floor((r() - 0.5) * 7);
    const line = (base + 0.5) * P;
    const dir = r() < 0.5 ? 1 : -1;
    const lane = line + dir * 15 * (axisX ? 1 : -1) + (r() - 0.5) * 6;
    const along = (axisX ? pp.x : pp.z) + (r() - 0.5) * 2 * R;
    if (Math.abs(line) > EXTENT - 60 || Math.abs(along) > EXTENT - 40) { c.x = 1e5; return; }
    // altitude: layers near the player
    let layer;
    for (let t = 0; t < 8; t++) { layer = LAYERS[Math.floor(r() * LAYERS.length)]; if (Math.abs(layer - pp.y) < 380) break; }
    c.y0 = layer + (r() - 0.5) * 8;
    if (axisX) { c.x = along; c.z = lane; c.dx = dir; c.dz = 0; } else { c.x = lane; c.z = along; c.dx = 0; c.dz = dir; }
    c.speed = (c.kind === 'bus' || c.kind === 'truck' ? 20 : 28) + r() * 28;
    c.yaw = Math.atan2(c.dx, c.dz);
  }

  update(dt, playerPos) {
    this.time += dt;
    const m = this.m, q = this.q, s = this.s, p = this.p;
    for (const c of this.cars) {
      if (c.x > 9e4) { this.respawn(c, playerPos); }
      else {
        c.x += c.dx * c.speed * dt; c.z += c.dz * c.speed * dt;
        const ddx = c.x - playerPos.x, ddz = c.z - playerPos.z;
        if (ddx * ddx + ddz * ddz > 1300 * 1300 || Math.abs(c.x) > EXTENT || Math.abs(c.z) > EXTENT) this.respawn(c, playerPos);
      }
      c.y = c.y0 + Math.sin(this.time * 0.8 + c.bob) * 1.2;
      q.setFromAxisAngle(this.up, c.yaw);
      p.set(c.x, c.y, c.z);
      m.compose(p, q, s);
      c.mesh.setMatrixAt(c.idx, m);
    }
    for (const mesh of this.kinds) mesh.instanceMatrix.needsUpdate = true;
  }

  /** soft collision with traffic; returns the car hit or null */
  collide(pos, r, vel) {
    for (const c of this.cars) {
      const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
      const rr = r + c.rad;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr || Math.abs(dy) > rr) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        pos.x += nx * (rr - d); pos.y += ny * (rr - d); pos.z += nz * (rr - d);
        const rel = (vel.x - c.dx * c.speed) * nx + vel.y * ny + (vel.z - c.dz * c.speed) * nz;
        if (rel < 0) { vel.x -= nx * rel * 1.4; vel.y -= ny * rel * 1.4; vel.z -= nz * rel * 1.4; }
        return { car: c, impact: -rel };
      }
    }
    return null;
  }
}
