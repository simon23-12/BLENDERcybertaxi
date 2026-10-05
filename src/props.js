// Street level ground, ledge landing pads, signs.
import * as THREE from 'three';
import { enableSkyFog } from './fog.js';
import { P, EXTENT } from './city.js';
import { timeU } from './util.js';

export class Props {
  constructor(scene, city, renderer) { this.scene = scene; this.city = city; this.renderer = renderer; }

  makeGround() {
    const size = (EXTENT + 2500) * 2;
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.22, metalness: 0.3 });
    enableSkyFog(m, { key: 'ground' });
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vGW; uniform float uTime;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 q = vGW.xz;
          float ux = abs(mod(q.x, ${P.toFixed(1)}) - ${(P / 2).toFixed(1)});
          float uz = abs(mod(q.y, ${P.toFixed(1)}) - ${(P / 2).toFixed(1)});
          float stX = step(uz, 36.0), stZ = step(ux, 36.0);     // street running along x / along z
          // edge lamps
          float lampX = stX * step(abs(uz - 34.5), 0.9) * step(0.55, fract(q.x / 22.0));
          float lampZ = stZ * step(abs(ux - 34.5), 0.9) * step(0.55, fract(q.y / 22.0));
          float id = floor(q.x / 22.0) + floor(q.y / 22.0) * 7.0;
          vec3 lampC = mix(vec3(1.0, 0.55, 0.18), vec3(0.2, 0.85, 1.0), step(0.78, gh(vec2(id, 3.0))));
          totalEmissiveRadiance += lampC * (lampX + lampZ) * 6.0;
          // dashed centre lines
          float cl = stX * step(uz, 0.45) * step(0.5, fract(q.x / 12.0)) + stZ * step(ux, 0.45) * step(0.5, fract(q.y / 12.0));
          totalEmissiveRadiance += vec3(0.7, 0.8, 1.0) * cl * 1.2;
          // glowing signs / puddle sheen
          float pud = smoothstep(0.55, 0.8, gh(floor(q / 18.0)));
          roughnessFactor = mix(roughnessFactor, 0.05, pud * (stX + stZ));
        }`);
      prev?.(sh, r);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** textured landing pad decals (additive) on every ledge */
  makePads(fx) {
    const L = this.city.ledges;
    const c = document.createElement('canvas'); c.width = 512; c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 400);
    g.strokeStyle = '#35e8ff'; g.lineWidth = 8; g.shadowColor = '#35e8ff'; g.shadowBlur = 18;
    g.strokeRect(18, 18, 476, 364);
    g.strokeStyle = '#ffb62e'; g.lineWidth = 5; g.shadowColor = '#ffb62e';
    g.beginPath(); g.arc(256, 200, 120, 0, 7); g.stroke();
    g.fillStyle = '#ffb62e'; g.font = 'bold 110px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowBlur = 22; g.fillText('T', 256, 206);
    g.fillStyle = '#35e8ff'; g.shadowColor = '#35e8ff';
    for (let i = 0; i < 6; i++) { g.beginPath(); const x = 60 + i * 78; g.moveTo(x, 360); g.lineTo(x + 24, 340); g.lineTo(x + 48, 360); g.lineTo(x + 48, 366); g.lineTo(x + 24, 346); g.lineTo(x, 366); g.closePath(); g.fill(); }
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#ff35d8' : '#35e8ff'; g.shadowColor = g.fillStyle; g.fillRect(40 + i * 36, 30, 16, 16); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.2), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    enableSkyFog(mat, { additive: true, key: 'pad' });
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, mat, L.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    L.forEach((l, i) => {
      // long axis (texture x) runs along the wall; texture y (=world z before rotation) points outwards
      const yaw = Math.atan2(l.normal.x, l.normal.z);   // rotate +z onto normal
      q.setFromAxisAngle(up, yaw);
      s.set(l.width - 4, 1, l.depth - 4);
      p.copy(l.center).setY(l.center.y + 0.1);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
    });
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.padMesh = mesh;
  }
}
