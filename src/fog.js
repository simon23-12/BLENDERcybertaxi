// Global height-fog that fades distant geometry into the Blender-rendered sky panorama.
// Every material that wants it calls enableSkyFog(material).
import * as THREE from 'three';

export const fogU = {
  tFogSky: { value: null },
  // x: density at y=0 (per metre)  y: 1/scale height  z: constant haze density  w: sky colour multiplier
  fogH: { value: new THREE.Vector4(0.0016, 1 / 320, 0.00018, 1.0) },
  // warm light pollution glowing up out of the street canyons: rgb, scale height (m)
  fogGlow: { value: new THREE.Vector4(0.2, 0.07, 0.07, 110.0) },
};

export function installFogChunks() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  #ifdef FOG_SKY
    varying vec3 vFogRay;
  #endif
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifdef FOG_SKY
    vFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
  #endif
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_SKY
    varying vec3 vFogRay;
    uniform sampler2D tFogSky;
    uniform vec4 fogH;
    uniform vec4 fogGlow;
    float cybGH(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    float cybGN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(cybGH(i), cybGH(i + vec2(1.0, 0.0)), f.x), mix(cybGH(i + vec2(0.0, 1.0)), cybGH(i + vec2(1.0, 1.0)), f.x), f.y); }
    vec3 cybFogSky(vec3 d) {
      vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
      return texture2D(tFogSky, uv).rgb;
    }
    float cybFogFactor(out vec3 fdir) {
      float dist = length(vFogRay);
      fdir = vFogRay / max(dist, 1e-3);
      float b = fogH.y;
      float a = clamp(b * fdir.y * dist, -18.0, 18.0);
      float t = abs(a) < 1e-3 ? 1.0 : (1.0 - exp(-a)) / a;
      float od = fogH.x * exp(-b * cameraPosition.y) * dist * t + fogH.z * dist;
      return 1.0 - exp(-od);
    }
  #else
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear;
      uniform float fogFar;
    #endif
  #endif
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_SKY
    vec3 cybFD;
    float cybFF = cybFogFactor(cybFD);
    #ifdef FOG_ADDITIVE
      gl_FragColor.rgb *= (1.0 - cybFF);
    #else
      float cybPY = cameraPosition.y + vFogRay.y;
      vec2 cybPXZ = cameraPosition.xz + vFogRay.xz;
      float cybCl = cybGN(cybPXZ * 0.0035);
      vec3 cybGC = mix(fogGlow.rgb, fogGlow.rgb * vec3(0.7, 1.1, 2.6), smoothstep(0.55, 0.85, cybGN(cybPXZ * 0.0021 + 9.0)));
      vec3 cybFC = cybFogSky(cybFD) * fogH.w + cybGC * (0.35 + 1.3 * cybCl) * exp(-max(cybPY, 0.0) / fogGlow.w);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, cybFC, cybFF);
    #endif
  #else
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;
}

/** Hook a material up to the sky fog (works for built-in and ShaderMaterial). */
export function enableSkyFog(material, { additive = false, key = '' } = {}) {
  material.fog = true;
  material.defines = material.defines || {};
  material.defines.FOG_SKY = '';
  if (additive) material.defines.FOG_ADDITIVE = '';
  if (material.isShaderMaterial) {
    material.uniforms.tFogSky = fogU.tFogSky;
    material.uniforms.fogH = fogU.fogH;
    material.uniforms.fogGlow = fogU.fogGlow;
    material.uniforms.fogColor = material.uniforms.fogColor || { value: new THREE.Color() };
    return material;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.tFogSky = fogU.tFogSky;
    shader.uniforms.fogH = fogU.fogH;
    shader.uniforms.fogGlow = fogU.fogGlow;
    if (prev) prev(shader, renderer);
  };
  material.customProgramCacheKey = () => 'skyfog' + (additive ? 'A' : '') + key;
  return material;
}

/** scene.fog only has to exist so three.js defines USE_FOG; the real parameters are in fogU. */
export function makeSceneFog() {
  return new THREE.Fog(0x000000, 1, 1e6);
}
