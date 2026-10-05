// Blender-rendered megacity panorama: log-encoded 8-bit WebP -> half-float HDR render target,
// used as (1) sky dome with altitude parallax, (2) PMREM environment, (3) fog colour source.
import * as THREE from 'three';
import { FullPass } from './post.js';
import { fogU } from './fog.js';

const A = 0.02, M = 64.0;   // must match tools/pack_sky.py

const DECODE_V = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }`;
const DECODE_F = /* glsl */`
precision highp float;
uniform sampler2D tSrc; varying vec2 vUv;
const float A = ${A.toFixed(5)}; const float M = ${M.toFixed(3)};
void main(){
  vec3 y = texture2D(tSrc, vUv).rgb;
  vec3 x = A * (exp(y * log(1.0 + M / A)) - 1.0);
  gl_FragColor = vec4(x, 1.0);
}`;

const BLUR_F = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform float lod; varying vec2 vUv;
void main(){
  vec3 c = textureLod(tSrc, vUv, lod).rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

const DOME_V = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;     // depth = far plane
}`;
const DOME_F = /* glsl */`
precision highp float;
uniform sampler2D tSky; uniform float gain; uniform vec3 camOff; uniform float R;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  // ray from (0,camOff.y,0) towards d hits a sphere of radius R -> altitude parallax
  vec3 o = vec3(0.0, camOff.y, 0.0);
  float b = dot(o, d);
  float t = -b + sqrt(b * b - dot(o, o) + R * R);
  vec3 p = normalize(o + d * t);
  float u1 = atan(p.z, p.x) * 0.15915494 + 0.5;
  float u2 = fract(u1 + 0.5) - 0.5;
  float v = asin(clamp(p.y, -1.0, 1.0)) * 0.31830989 + 0.5;
  float du = min(fwidth(u1), fwidth(u2));
  vec3 c = textureGrad(tSky, vec2(u1, v), vec2(du, dFdx(v)), vec2(du, dFdy(v))).rgb;
  gl_FragColor = vec4(c * gain, 1.0);
}`;

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = null;
    this.gain = 1.0;
  }

  async load(url, tier) {
    const tex = await new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    const r = this.renderer;
    const w = Math.min(tex.image.width, tier.skyW), h = w / 2;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
      wrapS: THREE.RepeatWrapping,
    });
    const dec = new FullPass(new THREE.ShaderMaterial({
      vertexShader: DECODE_V, fragmentShader: DECODE_F, uniforms: { tSrc: { value: tex } }, depthTest: false, depthWrite: false,
    }));
    dec.render(r, this.rt);
    tex.dispose();

    // blurred small copy for fog colour
    const fogRT = new THREE.WebGLRenderTarget(256, 128, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
      wrapS: THREE.RepeatWrapping,
    });
    const blur = new FullPass(new THREE.ShaderMaterial({
      vertexShader: DECODE_V, fragmentShader: BLUR_F, uniforms: { tSrc: { value: this.rt.texture }, lod: { value: Math.log2(w / 256) + 0.5 } },
      depthTest: false, depthWrite: false,
    }));
    blur.render(r, fogRT);
    fogU.tFogSky.value = fogRT.texture;
    this.fogRT = fogRT;

    // dome
    const g = new THREE.SphereGeometry(1, 48, 32);
    const m = new THREE.ShaderMaterial({
      vertexShader: DOME_V, fragmentShader: DOME_F, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { tSky: { value: this.rt.texture }, gain: { value: this.gain }, camOff: { value: new THREE.Vector3() }, R: { value: 7000 } },
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(g, m);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.scene.add(this.dome);

    // environment for PBR materials
    const pm = new THREE.PMREMGenerator(r);
    this.rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.env = pm.fromEquirectangular(this.rt.texture);
    pm.dispose();
    this.scene.environment = this.env.texture;
    return this;
  }

  update(camera) {
    if (!this.dome) return;
    this.dome.position.copy(camera.position);
    const far = camera.far * 0.9;
    this.dome.scale.setScalar(far);
    this.dome.material.uniforms.camOff.value.set(0, camera.position.y - 460, 0);
    this.dome.material.uniforms.gain.value = this.gain;
  }
}
