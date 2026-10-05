// HDR render target + dual-filter bloom + filmic composite (tone map, grade, CA, grain, vignette).
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function triangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

export class FullPass {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(FullPass.geo || (FullPass.geo = triangle()), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}

const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({
  vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false,
  toneMapped: false, ...extra,
});

const DOWN = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel; uniform float karis; uniform float thresh;
varying vec2 vUv;
vec3 tap(vec2 o){ return texture2D(tSrc, vUv + o * texel).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kar(vec3 c){ return c / (1.0 + luma(c)); }
void main(){
  vec3 a = tap(vec2(-2.,2.)), b = tap(vec2(0.,2.)), c = tap(vec2(2.,2.));
  vec3 d = tap(vec2(-2.,0.)), e = tap(vec2(0.,0.)), f = tap(vec2(2.,0.));
  vec3 g = tap(vec2(-2.,-2.)), h = tap(vec2(0.,-2.)), i = tap(vec2(2.,-2.));
  vec3 j = tap(vec2(-1.,1.)), k = tap(vec2(1.,1.)), l = tap(vec2(-1.,-1.)), m = tap(vec2(1.,-1.));
  vec3 col;
  if (karis > 0.5) {
    vec3 g0 = (kar(a)+kar(b)+kar(d)+kar(e)) * 0.25;
    vec3 g1 = (kar(b)+kar(c)+kar(e)+kar(f)) * 0.25;
    vec3 g2 = (kar(d)+kar(e)+kar(g)+kar(h)) * 0.25;
    vec3 g3 = (kar(e)+kar(f)+kar(h)+kar(i)) * 0.25;
    vec3 g4 = (kar(j)+kar(k)+kar(l)+kar(m)) * 0.25;
    col = g0*0.125 + g1*0.125 + g2*0.125 + g3*0.125 + g4*0.5;
    // soft threshold in the (karis-weighted) domain
    float lm = luma(col);
    col *= smoothstep(thresh * 0.4, thresh, lm / max(1.0 - lm, 0.05));
    col = col / max(1.0 - luma(col), 0.05);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel; uniform float radius;
varying vec2 vUv;
void main(){
  vec2 t = texel * radius;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + vec2(-t.x, 0.)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2( t.x, 0.)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0., -t.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.,  t.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( t.x, -t.y)).rgb;
  c += texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb;
  c += texture2D(tSrc, vUv + vec2( t.x,  t.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const COMPOSITE = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloomGain; uniform float exposure; uniform float time;
uniform float ca; uniform float vig; uniform float grain; uniform float speed; uniform float flash;
uniform vec2 res;
varying vec2 vUv;

vec3 aces(vec3 x){
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = inM * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  // radial speed blur (5 taps) + chromatic aberration
  vec2 dir = d * (0.012 * speed + 0.0);
  vec3 col = vec3(0.0);
  float caAmt = ca * (0.6 + r2 * 3.0) + speed * 0.0016;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float k = float(i) / 3.0;
    vec2 o = -dir * k;
    acc.r += texture2D(tScene, uv + o + d * caAmt).r;
    acc.g += texture2D(tScene, uv + o).g;
    acc.b += texture2D(tScene, uv + o - d * caAmt).b;
  }
  col = acc * 0.25;
  vec3 bl = texture2D(tBloom, uv).rgb;
  col += bl * bloomGain;
  col *= exposure;
  col += flash * vec3(0.9, 0.5, 0.3);
  // grade: teal shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.86, 1.02, 1.12), 1.0 - smoothstep(0.0, 0.25, l));
  col = mix(col, col * vec3(1.10, 1.0, 0.90), smoothstep(0.6, 3.0, l));
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // vignette
  col *= 1.0 - vig * smoothstep(0.15, 0.85, r2 * 2.0);
  // grain + dither
  float g = hash(uv * res + fract(time * 7.0)) - 0.5;
  col += g * (grain + 1.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.opts = opts;
    this.w = 4; this.h = 4;
    this.levels = [];
    this.u = {
      bloomGain: { value: 0.7 }, exposure: { value: 1.0 }, time: { value: 0 }, ca: { value: 0.0025 },
      vig: { value: 0.55 }, grain: { value: 0.025 }, speed: { value: 0 }, flash: { value: 0 },
      res: { value: new THREE.Vector2(1, 1) },
    };
    this.down = new FullPass(mat(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 }, thresh: { value: 1.3 } }));
    this.up = new FullPass(mat(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1.0 } },
      { blending: THREE.AdditiveBlending, transparent: true }));
    this.comp = new FullPass(mat(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, ...this.u }));
    this.hdr = null;
  }

  rtOpts(extra = {}) {
    return { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace, ...extra };
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.u.res.value.set(w, h);
    this.hdr?.dispose();
    this.hdr = new THREE.WebGLRenderTarget(w, h, this.rtOpts({ depthBuffer: true, samples: this.opts.msaa }));
    this.levels.forEach((l) => l.dispose());
    this.levels = [];
    let lw = Math.max(2, w >> 1), lh = Math.max(2, h >> 1);
    const n = this.opts.bloomLevels;
    for (let i = 0; i < n; i++) {
      this.levels.push(new THREE.WebGLRenderTarget(lw, lh, this.rtOpts()));
      lw = Math.max(2, lw >> 1); lh = Math.max(2, lh >> 1);
    }
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.hdr);
    r.clear();
    r.render(scene, camera);
    this.sceneInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    // bloom chain
    const dm = this.down.material.uniforms;
    const um = this.up.material.uniforms;
    let src = this.hdr.texture;
    let sw = this.w, sh = this.h;
    for (let i = 0; i < this.levels.length; i++) {
      dm.tSrc.value = src;
      dm.texel.value.set(1 / sw, 1 / sh);
      dm.karis.value = i === 0 ? 1 : 0;
      this.down.render(r, this.levels[i]);
      src = this.levels[i].texture;
      sw = this.levels[i].width; sh = this.levels[i].height;
    }
    r.autoClear = false;
    for (let i = this.levels.length - 1; i > 0; i--) {
      um.tSrc.value = this.levels[i].texture;
      um.texel.value.set(1 / this.levels[i].width, 1 / this.levels[i].height);
      um.radius.value = 1.0;
      this.up.render(r, this.levels[i - 1]);
    }
    r.autoClear = true;
    const cm = this.comp.material.uniforms;
    cm.tScene.value = this.hdr.texture;
    cm.tBloom.value = this.levels[0].texture;
    this.comp.render(r, null);
  }
}
