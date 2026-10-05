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
    uEmitGain: { value: 1.0 }, uAmbLow: { value: 0.12 }, uLed: { value: 3.5 },
  };
  m.userData.uniforms = uniforms;
  if (fx.parallaxSteps) m.defines = { ...(m.defines || {}), PARALLAX_STEPS: fx.parallaxSteps };
  enableSkyFog(m, { key: 'building2-' + (fx.parallaxSteps || 0) });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iInfo;
        varying vec4 vInfo; varying vec2 vUvT; varying vec3 vWN; varying vec3 vWT; varying vec3 vWB; varying vec3 vWP; varying float vLayer;
        varying vec4 vFace; varying float vScale;
        uniform float uTile;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp4 = instanceMatrix * vec4(transformed, 1.0);
          vWP = wp4.xyz;
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec3 nw = normal;
          float seed = iInfo.y;
          float mir = step(0.5, fract(seed * 13.37)) * 2.0 - 1.0;                // mirror u
          vec2 off = vec2(floor(fract(seed * 7.13) * 8.0) / 8.0, floor(fract(seed * 3.71) * 4.0) / 4.0);
          vec3 right, up = vec3(0.0, 1.0, 0.0);
          float layer = iInfo.x;
          // per building tile scale (bigger panels / windows on some towers)
          float h2 = fract(seed * 5.77);
          float s = 1.0;
          if (layer > 4.5 || (layer > 1.5 && layer < 2.5)) s = h2 < 0.35 ? 2.0 : (h2 < 0.6 ? 1.5 : 1.0);
          else if (layer < 0.5 || (layer > 3.5 && layer < 4.5)) s = h2 < 0.3 ? 1.5 : 1.0;
          else if (layer > 2.5 && layer < 3.5) s = h2 < 0.5 ? 1.5 : 2.0;
          if (abs(nw.y) > 0.5) {
            right = vec3(1.0, 0.0, 0.0); up = vec3(0.0, 0.0, -1.0); layer = ${ROOF_LAYER}.0; s = 1.0;
            vUvT = vec2(wp4.x, -wp4.z) / uTile;
            vFace = vec4(0.0, 1e4, transformed.y * sc.y, sc.y);
          } else if (abs(nw.x) > 0.5) {
            right = nw.x > 0.0 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 0.0, 1.0);
            vUvT = vec2(dot(wp4.xyz, right), wp4.y) / uTile;
            vFace = vec4(transformed.z * sc.z, 0.5 * sc.z, transformed.y * sc.y, sc.y);
          } else {
            right = nw.z > 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(-1.0, 0.0, 0.0);
            vUvT = vec2(dot(wp4.xyz, right), wp4.y) / uTile;
            vFace = vec4(transformed.x * sc.x, 0.5 * sc.x, transformed.y * sc.y, sc.y);
          }
          vUvT /= s;
          vUvT.x *= mir; right *= mir;
          vUvT += off;
          vWN = nw; vWT = right; vWB = up; vLayer = layer; vInfo = iInfo; vScale = s;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2DArray tAlb; uniform sampler2DArray tNrm; uniform sampler2DArray tEm; uniform sampler2DArray tMeta;
        uniform vec2 uCells[7]; uniform float uTime; uniform float uEmitMax; uniform float uEmitGain; uniform float uAmbLow; uniform float uTile; uniform float uLed;
        varying vec4 vInfo; varying vec2 vUvT; varying vec3 vWN; varying vec3 vWT; varying vec3 vWB; varying vec3 vWP; varying float vLayer;
        varying vec4 vFace; varying float vScale;
        float h21(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
        vec3 hueRot(vec3 c, float a){ float s = sin(a), co = cos(a); vec3 k = vec3(0.57735);
          return c * co + cross(k, c) * s + k * dot(k, c) * (1.0 - co); }
        float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
        vec4 cybTexA, cybTexN, cybTexE, cybTexM; vec2 vCybUv;
        float cybCorner, cybGrime, cybDE;`)
      .replace('#include <map_fragment>', `
        {
          float seed = vInfo.y;
          float hA = fract(seed * 17.31);
          // structural corner columns (dark, no windows) frame each tower
          float pil = vLayer > 5.5 ? 0.0 : (hA < 0.22 ? 0.0 : (hA < 0.55 ? 2.0 : (hA < 0.82 ? 4.0 : 6.0)));
          cybDE = vFace.y - abs(vFace.x);
          cybCorner = (vFace.w > 6.0) ? 1.0 - step(pil, cybDE) : 0.0;
          vec2 uvb = vUvT;
          vec2 gx = dFdx(vUvT), gy = dFdy(vUvT);
          #ifdef PARALLAX_STEPS
          if (cybCorner < 0.5) {
            vec3 Vw = cameraPosition - vWP;
            float dist = length(Vw);
            float pf = 1.0 - smoothstep(55.0, 140.0, dist);
            vec3 Vn = Vw / dist;
            vec3 Vt = vec3(dot(Vn, vWT), dot(Vn, vWB), dot(Vn, vWN));
            if (pf > 0.02 && Vt.z > 0.12) {
              float scale = 2.0 / (uTile * vScale) * pf;
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
          // macro grime: long vertical rain streaks + blotches + street soot  -> kills the tiling look
          float au = dot(vWP, abs(vWT));
          float g1 = vn2(vec2(au * 0.07 + seed * 31.0, vWP.y * 0.0045));
          float g2 = vn2(vec2(au * 0.018, vWP.y * 0.012) + seed * 7.0);
          cybGrime = mix(0.42, 1.12, g1) * mix(0.7, 1.1, g2) * mix(0.5, 1.0, smoothstep(0.0, 110.0, vWP.y));
          vec3 tint = mix(vec3(1.06, 0.98, 0.9), vec3(0.88, 0.96, 1.08), fract(seed * 53.1));
          vec3 alb = cybTexA.rgb * tint * cybGrime;
          alb = mix(alb, vec3(0.022, 0.024, 0.028) * mix(0.7, 1.2, g1), cybCorner);
          diffuseColor.rgb *= alb;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(clamp(cybTexN.b + (1.0 - cybGrime) * 0.25, 0.05, 1.0), 0.32, cybCorner);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = mix(cybTexM.g, 0.75, cybCorner);`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tn = vec3(cybTexN.rg * 2.0 - 1.0, 0.0);
          tn.xy *= 1.0 - cybCorner;
          tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
          vec3 wn = normalize(vWT * tn.x + vWB * tn.y + vWN * tn.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz) * faceDirection;
        }`)
      .replace('#include <emissivemap_fragment>', `
        {
          float seed = vInfo.y;
          float hB = fract(seed * 29.17), hC = fract(seed * 41.73), hD = fract(seed * 61.37);
          vec2 cells = uCells[int(vLayer + 0.5)];
          vec2 cid = floor(vCybUv * cells);
          float litF = vInfo.w;
          // floors are lit in clusters (offices / apartments), not as random confetti
          float floorOn = step(h21(vec2(cid.y * 1.31, seed * 37.0 + vLayer)), litF * 1.1)
                        * step(0.32, vn2(vec2(cid.x * 0.21 + seed * 9.0, cid.y * 0.09)));
          float hc = h21(cid + seed * 91.7 + vLayer * 13.1);
          float lit = mix(step(hc, litF * 0.15), step(hc, 0.82), floorOn);
          float fl = step(0.985, h21(cid * 1.7 + 7.7)) * step(0.0, sin(uTime * (1.5 + hc * 2.0) + hc * 40.0));
          lit = clamp(lit - fl, 0.0, 1.0);
          vec2 fwc = fwidth(vUvT * cells);
          float aaF = clamp(max(fwc.x, fwc.y) * 1.6 - 0.25, 0.0, 1.0);
          lit = mix(lit, litF * 0.55, aaF);
          vec3 e = cybTexE.rgb * uEmitMax;
          float lum = dot(e, vec3(0.3, 0.59, 0.11));
          // one interior colour temperature per building (warm sodium / cool office / sick fluorescent / rare pink)
          vec3 lc = hB < 0.48 ? vec3(1.0, 0.66, 0.36) : (hB < 0.8 ? vec3(0.72, 0.86, 1.0) : (hB < 0.93 ? vec3(0.72, 1.0, 0.7) : vec3(1.0, 0.45, 0.78)));
          lc *= 0.55 + 0.6 * hc;
          vec3 winE = lum * lc * lit;
          // fixtures (LED strips, neon tubes): one accent colour per building, only in some tile rows/columns
          vec3 acc = hD < 0.3 ? vec3(0.1, 0.85, 1.0) : (hD < 0.55 ? vec3(1.0, 0.18, 0.75) : (hD < 0.8 ? vec3(1.0, 0.55, 0.15) : vec3(0.85, 0.9, 1.0)));
          vec2 tcell = floor(vCybUv);
          float fixOn = step(h21(tcell * vec2(0.37, 1.13) + seed * 19.0), hB < 0.5 ? 0.55 : 0.2);
          vec3 fixE = mix(hueRot(e, vInfo.z * 6.2831853), lum * acc, 0.7) * fixOn * mix(1.0, 0.35, aaF);
          float wm = smoothstep(0.04, 0.35, cybTexM.r);
          vec3 em = mix(fixE, winE, wm) * uEmitGain * (1.0 - cybCorner);
          // LED edge lines on ~1/3 of the towers: corner verticals + roof line (strong silhouettes in the fog)
          if (hC < 0.34 && vFace.w > 6.0 && vLayer < 5.5) {
            vec3 ledC = hD < 0.3 ? vec3(0.1, 0.85, 1.0) : (hD < 0.55 ? vec3(1.0, 0.18, 0.75) : (hD < 0.8 ? vec3(1.0, 0.55, 0.15) : vec3(0.85, 0.9, 1.0)));
            float w = 0.45;
            float fw = max(fwidth(cybDE), 1e-3);
            float edgeV = (1.0 - smoothstep(w, w + fw * 1.5, cybDE)) * min(1.0, w / fw);
            float dTop = vFace.w - vFace.z;
            float fwt = max(fwidth(dTop), 1e-3);
            float edgeT = (1.0 - smoothstep(w, w + fwt * 1.5, dTop)) * min(1.0, w / fwt);
            float dash = hD > 0.6 ? step(0.35, fract(vFace.z / 7.0 - uTime * 0.25)) : 1.0;
            em += ledC * uLed * max(edgeV * dash, edgeT);
          }
          totalEmissiveRadiance += em;
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          float amb = mix(uAmbLow, 1.0, smoothstep(10.0, 700.0, vWP.y));
          float n1 = vn2(vWP.xz * 0.0028 + vWP.y * 0.001);
          vec3 zone = mix(vec3(0.55, 0.85, 1.25), vec3(1.2, 0.65, 1.05), n1);
          // warm street glow bouncing up the lower canyon walls
          zone += vec3(0.9, 0.38, 0.16) * (1.0 - smoothstep(0.0, 160.0, vWP.y)) * 1.4;
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
