// Loads the Blender-baked facade tiles into texture arrays and builds the instanced building material.
import * as THREE from 'three';
import { enableSkyFog } from './fog.js';
import { loadImage, timeU } from './util.js';

const ROOF_LAYER = 6;

async function loadArray(urls, size, colorSpace, renderer, onTick, aniso = 4) {
  const n = urls.length;
  const data = new Uint8Array(size * size * 4 * n);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < n; i++) {
    const img = await loadImage(urls[i]);
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    data.set(px, i * size * size * 4);
    onTick?.();
  }
  const tex = new THREE.DataArrayTexture(data, size, size, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = colorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
  tex.unpackAlignment = 4;
  tex.needsUpdate = true;
  return tex;
}

export async function loadFacades(renderer, tier, onTick) {
  const meta = await (await fetch('assets/tex/facades.json')).json();
  const n = meta.types.length;
  const tag = tier.texRes >= 1536 ? '2k' : '1k';
  const u = (k, sfx) => Array.from({ length: n }, (_, i) => `assets/tex/f${i}_${k}${sfx}.webp`);
  const sizeA = tier.texRes, sizeE = Math.min(tier.texRes, 1024);
  const A = await loadArray(u('a', '_' + tag), sizeA, THREE.SRGBColorSpace, renderer, onTick, tier.aniso);
  const Nr = await loadArray(u('n', '_' + tag), sizeA, THREE.NoColorSpace, renderer, onTick, tier.aniso);
  const E = await loadArray(u('e', '_' + tag), sizeE, THREE.SRGBColorSpace, renderer, onTick, tier.aniso);
  const Mt = await loadArray(u('m', ''), 512, THREE.NoColorSpace, renderer, onTick);
  return { A, N: Nr, E, M: Mt, cells: meta.types.map((t) => new THREE.Vector2(t.cells[0], t.cells[1])), tile: meta.tile, emitMax: meta.emitMax };
}

export function makeBuildingMaterial(fx) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
  m.name = 'buildings';
  m.envMapIntensity = 1.0;
  const uniforms = {
    tAlb: { value: fx.A }, tNrm: { value: fx.N }, tEm: { value: fx.E }, tMeta: { value: fx.M },
    uCells: { value: fx.cells }, uTime: timeU, uTile: { value: fx.tile }, uEmitMax: { value: fx.emitMax },
    uEmitGain: { value: 1.0 }, uAmbLow: { value: 0.14 }, uPar: { value: fx.parallax ?? 0 },
  };
  m.userData.uniforms = uniforms;
  if (fx.parallaxSteps) m.defines = { ...(m.defines || {}), PARALLAX_STEPS: fx.parallaxSteps };
  enableSkyFog(m, { key: 'building' + (fx.parallaxSteps || 0) });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iInfo;
        varying vec4 vInfo; varying vec2 vUvT; varying vec3 vWN; varying vec3 vWT; varying vec3 vWB; varying vec3 vWP; varying float vLayer;
        uniform float uTile;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp4 = instanceMatrix * vec4(transformed, 1.0);
          vWP = wp4.xyz;
          vec3 nw = normal;
          float seed = iInfo.y;
          float mir = step(0.5, fract(seed * 13.37)) * 2.0 - 1.0;                // mirror u
          vec2 off = vec2(floor(fract(seed * 7.13) * 8.0) / 8.0, floor(fract(seed * 3.71) * 4.0) / 4.0);
          vec3 right, up = vec3(0.0, 1.0, 0.0);
          float layer = iInfo.x;
          if (abs(nw.y) > 0.5) {
            right = vec3(1.0, 0.0, 0.0); up = vec3(0.0, 0.0, -1.0); layer = ${ROOF_LAYER}.0;
            vUvT = vec2(wp4.x, -wp4.z) / uTile;
          } else if (abs(nw.x) > 0.5) {
            right = nw.x > 0.0 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 0.0, 1.0);
            vUvT = vec2(dot(wp4.xyz, right), wp4.y) / uTile;
          } else {
            right = nw.z > 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(-1.0, 0.0, 0.0);
            vUvT = vec2(dot(wp4.xyz, right), wp4.y) / uTile;
          }
          vUvT.x *= mir; right *= mir;
          vUvT += off;
          vWN = nw; vWT = right; vWB = up; vLayer = layer; vInfo = iInfo;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2DArray tAlb; uniform sampler2DArray tNrm; uniform sampler2DArray tEm; uniform sampler2DArray tMeta;
        uniform vec2 uCells[7]; uniform float uTime; uniform float uEmitMax; uniform float uEmitGain; uniform float uAmbLow; uniform float uPar; uniform float uTile;
        varying vec4 vInfo; varying vec2 vUvT; varying vec3 vWN; varying vec3 vWT; varying vec3 vWB; varying vec3 vWP; varying float vLayer;
        float h21(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
        vec3 hueRot(vec3 c, float a){ float s = sin(a), co = cos(a); vec3 k = vec3(0.57735);
          return c * co + cross(k, c) * s + k * dot(k, c) * (1.0 - co); }
        float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          float a = h21(i.xy + i.z*17.0), b = h21(i.xy + vec2(1.,0.) + i.z*17.0), c = h21(i.xy + vec2(0.,1.) + i.z*17.0), d = h21(i.xy + vec2(1.,1.) + i.z*17.0);
          float a2 = h21(i.xy + (i.z+1.)*17.0), b2 = h21(i.xy + vec2(1.,0.) + (i.z+1.)*17.0), c2 = h21(i.xy + vec2(0.,1.) + (i.z+1.)*17.0), d2 = h21(i.xy + vec2(1.,1.) + (i.z+1.)*17.0);
          return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(a2,b2,f.x), mix(c2,d2,f.x), f.y), f.z); }
        vec4 cybTexA, cybTexN, cybTexE, cybTexM; vec2 vCybUv;`)
      .replace('#include <map_fragment>', `
        {
          vec2 uvb = vUvT;
          vec2 gx = dFdx(vUvT), gy = dFdy(vUvT);
          #ifdef PARALLAX_STEPS
          {
            vec3 Vw = cameraPosition - vWP;
            float dist = length(Vw);
            float pf = 1.0 - smoothstep(55.0, 140.0, dist);
            vec3 Vn = Vw / dist;
            vec3 Vt = vec3(dot(Vn, vWT), dot(Vn, vWB), dot(Vn, vWN));
            if (pf > 0.02 && Vt.z > 0.12) {
              float scale = 2.0 / uTile * pf;                 // height range 0.42..0.75 of 6 m = 2 m of relief
              vec2 dUV = (Vt.xy / Vt.z) * scale / float(PARALLAX_STEPS);
              float layerD = 1.0 / float(PARALLAX_STEPS);
              float curD = 0.0;
              vec2 uvc = uvb;
              float hh0 = 1.0 - clamp((textureGrad(tMeta, vec3(uvc, vLayer), gx, gy).b - 0.42) / 0.33, 0.0, 1.0);
              float prevD = 0.0, prevH = hh0;
              for (int i = 0; i < PARALLAX_STEPS; i++) {
                if (curD >= hh0) break;
                prevD = curD; prevH = hh0;
                uvc -= dUV; curD += layerD;
                hh0 = 1.0 - clamp((textureGrad(tMeta, vec3(uvc, vLayer), gx, gy).b - 0.42) / 0.33, 0.0, 1.0);
              }
              float after = hh0 - curD, before = prevH - prevD;
              float wgt = after / (after - before - 1e-5);
              uvb = uvc + dUV * clamp(wgt, 0.0, 1.0);
            }
          }
          #endif
          vec3 uvw = vec3(uvb, vLayer);
          vCybUv = uvb;
          cybTexA = textureGrad(tAlb, uvw, gx, gy); cybTexN = textureGrad(tNrm, uvw, gx, gy); cybTexE = textureGrad(tEm, uvw, gx, gy); cybTexM = textureGrad(tMeta, uvw, gx, gy);
          diffuseColor.rgb *= cybTexA.rgb * (0.85 + 0.3 * fract(vInfo.y * 91.3));
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = max(cybTexN.b, 0.05);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = cybTexM.g;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tn = vec3(cybTexN.rg * 2.0 - 1.0, 0.0);
          tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
          vec3 wn = normalize(vWT * tn.x + vWB * tn.y + vWN * tn.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz) * faceDirection;
        }`)
      .replace('#include <emissivemap_fragment>', `
        {
          vec2 cells = uCells[int(vLayer + 0.5)];
          vec2 cid = floor(vCybUv * cells);
          float hh = h21(cid + vInfo.y * 91.7 + vLayer * 13.1);
          float lit = step(hh, vInfo.w);
          float fl = step(0.97, h21(cid * 1.7 + 7.7)) * step(0.0, sin(uTime * (1.5 + hh * 2.0) + hh * 40.0));
          lit = clamp(lit - fl, 0.0, 1.0);
          vec2 fwc = fwidth(vUvT * cells);
          float aaF = clamp(max(fwc.x, fwc.y) * 1.6 - 0.25, 0.0, 1.0);   // cells smaller than ~1px -> use the mean
          lit = mix(lit, vInfo.w, aaF);
          float gate = mix(1.0, lit, cybTexM.r);
          vec3 em = cybTexE.rgb * uEmitMax * uEmitGain * gate;
          em = hueRot(em, vInfo.z * 6.2831853);
          totalEmissiveRadiance += em;
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          float amb = mix(uAmbLow, 1.0, smoothstep(10.0, 700.0, vWP.y));
          float n1 = vn3(vWP * 0.0035);
          vec3 zone = mix(vec3(0.55, 0.85, 1.25), vec3(1.25, 0.65, 1.05), n1);
          zone = mix(zone, vec3(1.25, 0.9, 0.6), smoothstep(0.55, 0.9, vn3(vWP * 0.0021 + 11.0)));
          #if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
            iblIrradiance *= amb * zone;
          #endif
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
            iblRadiance *= amb * zone;
          #endif
        }`);
    prev?.(sh, r);
  };
  return m;
}
