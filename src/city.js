// Procedural megacity: tiered towers on a Manhattan grid, skybridges, landing ledges, collision grid.
import * as THREE from 'three';
import { mulberry32, fbm, clamp, lerp } from './util.js';

export const P = 240;          // block pitch
export const BLOCK = 168;      // block footprint (street width = P - BLOCK = 72)
export const NB = 7;           // blocks each side of the centre
export const EXTENT = NB * P + 120;
export const GROUND = 0;
const CELL = 48;

const snap = (v, s = 8) => Math.round(v / s) * s;

export class City {
  constructor() {
    this.boxes = [];       // {x0,x1,y0,y1,z0,z1,layer,seed,hue,lit,solid}
    this.grid = new Map();
    this.ledges = [];
    this.beacons = [];     // tower top positions for blinking aviation lights
    this.spawn = new THREE.Vector3(-120, 170, -120);
    this.mesh = null;
  }

  addBox(b) {
    const idx = this.boxes.length;
    this.boxes.push(b);
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
      const k = i * 4096 + j;
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(idx);
    }
    return idx;
  }

  /** boxes overlapping AABB (excluding ignore index) */
  overlaps(x0, x1, y0, y1, z0, z1, ignore = -1) {
    const seen = new Set();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const arr = this.grid.get(i * 4096 + j);
        if (!arr) continue;
        for (const id of arr) {
          if (id === ignore || seen.has(id)) continue;
          seen.add(id);
          const b = this.boxes[id];
          if (b.solid === false) continue;
          if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0 && z0 < b.z1 && z1 > b.z0) return true;
        }
      }
    }
    return false;
  }

  solidAt(x, y, z) { return this.overlaps(x - 0.5, x + 0.5, y - 0.5, y + 0.5, z - 0.5, z + 0.5); }

  generate(seed = 1337) {
    const rng = mulberry32(seed);
    const R = (a, b) => a + (b - a) * rng();
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const wpick = (pairs) => {
      let t = 0; for (const [, w] of pairs) t += w;
      let r = rng() * t;
      for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
      return pairs[0][0];
    };
    const towers = [];

    const makeTower = (x0, x1, z0, z1, H, zone, cx, cz, baseY = 0) => {
      H = Math.max(32, snap(H));
      const seedv = rng();
      const hue = rng() < 0.4 ? -0.17 + rng() * 0.27 : 0;
      const lit = lerp(0.05, 0.5, Math.pow(rng(), 1.15));
      const lowerSet = zone < 0.3 ? [[2, 4], [1, 3], [3, 2]] : zone < 0.65 ? [[1, 3], [3, 3], [2, 1]] : [[1, 2], [3, 2], [2, 1]];
      const bodySet = zone < 0.3 ? [[3, 3], [1, 3], [0, 2], [5, 1]] : zone < 0.65 ? [[0, 4], [4, 3], [3, 1], [5, 2]] : [[5, 4], [0, 3], [4, 3]];
      const upSet = [[5, 3], [0, 3], [4, 2], [3, 1]];
      const layerP = wpick(lowerSet), layerB = wpick(bodySet);
      const layerU = rng() < 0.55 ? layerB : wpick(upSet);
      const tower = { x0, x1, z0, z1, H, tiers: [] };
      const push = (a0, a1, b0, b1, y0, y1, layer) => {
        if (a1 - a0 < 24 || b1 - b0 < 24 || y1 - y0 < 8) return -1;
        const id = this.addBox({ x0: a0, x1: a1, y0, y1, z0: b0, z1: b1, layer, seed: seedv, hue, lit });
        tower.tiers.push(id);
        // architectural trim (no collision): cornice + belt bands
        const th = y1 - y0;
        if (th >= 40) {
          const tl = layer === 4 ? 4 : 5;
          this.addBox({ x0: a0 - 1.5, x1: a1 + 1.5, y0: y1 - 2, y1: y1 + 1, z0: b0 - 1.5, z1: b1 + 1.5, layer: tl, seed: seedv, hue, lit: 0, solid: false });
          const step = 88 + 8 * Math.floor(rng() * 3);
          for (let yy = y0 + step; yy < y1 - 16; yy += step) {
            this.addBox({ x0: a0 - 0.8, x1: a1 + 0.8, y0: yy, y1: yy + 3, z0: b0 - 0.8, z1: b1 + 0.8, layer: tl, seed: seedv, hue, lit: 0, solid: false });
          }
        }
        return id;
      };
      let y = baseY;
      const podH = (H > 160 && baseY === 0) ? snap(R(24, 72)) : 0;
      if (podH) { push(x0, x1, z0, z1, 0, podH, layerP); y = podH; }
      let ins0 = 8 * Math.floor(R(0, 3));
      if ((x1 - x0) - 2 * ins0 < 40 || (z1 - z0) - 2 * ins0 < 40) ins0 = 0;
      const bodyTop = H - y > 120 ? snap(y + (H - y) * R(0.55, 0.78)) : H;
      push(x0 + ins0, x1 - ins0, z0 + ins0, z1 - ins0, y, bodyTop, layerB);
      let top = bodyTop, ins = ins0;
      if (H - bodyTop >= 40) {
        ins = ins0 + 8 * Math.floor(R(1, 4));
        if ((x1 - x0) - 2 * ins < 24 || (z1 - z0) - 2 * ins < 24) ins = ins0 + 8;
        const id = push(x0 + ins, x1 - ins, z0 + ins, z1 - ins, bodyTop, H, layerU);
        if (id >= 0) top = H; else top = bodyTop;
        if (id >= 0 && H - bodyTop >= 120 && rng() < 0.5) {            // third setback
          const ins2 = ins + 8 * Math.floor(R(1, 3));
          const t2 = snap(bodyTop + (H - bodyTop) * 0.6);
          // replace the last tier's top: shrink the upper box and add crown
          const ub = this.boxes[id];
          ub.y1 = t2;
          push(x0 + ins2, x1 - ins2, z0 + ins2, z1 - ins2, t2, H, layerU === 5 ? 0 : 5);
        }
        ins = ins;
      }
      // ---- massing variety: exterior service risers + cantilevered blocks (break the flat box faces)
      {
        const own = new Set(tower.tiers);
        const ignoreOwn = (x0, x1, y0, y1, z0, z1) => {
          // overlaps anything that is not this tower
          for (const id of [...own]) { const b = this.boxes[id]; if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0 && z0 < b.z1 && z1 > b.z0) continue; }
          let hit = false;
          const saved = [...own].map((id) => { const b = this.boxes[id]; const s = b.solid; b.solid = false; return [b, s]; });
          hit = this.overlaps(x0, x1, y0, y1, z0, z1);
          saved.forEach(([b, s]) => { b.solid = s; });
          return hit;
        };
        const body = tower.tiers.map((id) => this.boxes[id]).sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0))[0];
        const attach = (b, face, along, w, d, y0, y1, layer, solid = true) => {
          let box;
          const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
          if (face === 0) box = { x0: b.x1 - 1, x1: b.x1 + d, z0: mz + along - w / 2, z1: mz + along + w / 2 };
          else if (face === 1) box = { x0: b.x0 - d, x1: b.x0 + 1, z0: mz + along - w / 2, z1: mz + along + w / 2 };
          else if (face === 2) box = { z0: b.z1 - 1, z1: b.z1 + d, x0: mx + along - w / 2, x1: mx + along + w / 2 };
          else box = { z0: b.z0 - d, z1: b.z0 + 1, x0: mx + along - w / 2, x1: mx + along + w / 2 };
          if (ignoreOwn(box.x0 - 2, box.x1 + 2, y0, y1, box.z0 - 2, box.z1 + 2)) return -1;
          const id = this.addBox({ ...box, y0, y1, layer, seed: rng(), hue: rng() < 0.3 ? -0.15 + rng() * 0.25 : 0, lit: R(0.1, 0.5), solid });
          own.add(id);
          return id;
        };
        if (body && body.y1 - body.y0 > 80) {
          const nR = rng() < 0.6 ? 1 + Math.floor(rng() * 3) : 0;
          for (let k = 0; k < nR; k++) {
            const face = Math.floor(rng() * 4);
            const span = face < 2 ? body.z1 - body.z0 : body.x1 - body.x0;
            const w = 8 + 4 * Math.floor(rng() * 2);
            if (span < w + 24) continue;
            const along = snap((rng() - 0.5) * (span - w - 16), 4);
            const stack = rng() < 0.45 ? snap(R(12, 40)) : 0;
            attach(body, face, along, w, snap(R(4, 8), 2), body.y0, body.y1 + stack, rng() < 0.6 ? 2 : 5);
          }
          // cantilever: a heavy block bolted onto the facade at mid height
          if (rng() < 0.4 && body.y1 - body.y0 > 140) {
            const face = Math.floor(rng() * 4);
            const span = face < 2 ? body.z1 - body.z0 : body.x1 - body.x0;
            const w = snap(span * R(0.35, 0.7));
            const h = snap(R(16, 40));
            const y0 = snap(R(body.y0 + 40, body.y1 - h - 24));
            attach(body, face, snap((rng() - 0.5) * (span - w)), w, snap(R(8, 12), 2), y0, y0 + h, wpick([[0, 2], [3, 2], [5, 2], [1, 1]]));
          }
        }
      }
      // roof clutter on the top tier
      {
        const tb = this.boxes[tower.tiers[tower.tiers.length - 1]];
        const n = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) {
          const w = 8 * Math.floor(R(1, 3)), d = 8 * Math.floor(R(1, 3));
          if (tb.x1 - tb.x0 < w + 16 || tb.z1 - tb.z0 < d + 16) continue;
          const px = R(tb.x0 + 8, tb.x1 - 8 - w), pz = R(tb.z0 + 8, tb.z1 - 8 - d);
          this.addBox({ x0: px, x1: px + w, y0: tb.y1, y1: tb.y1 + R(4, 12), z0: pz, z1: pz + d, layer: 2, seed: rng(), hue: 0, lit: 0.2, solid: false });
        }
      }
      // spire
      const sx = (x0 + x1) / 2, sz = (z0 + z1) / 2;
      if (H > 280 && rng() < 0.65) {
        const sh = snap(R(40, 120));
        this.addBox({ x0: sx - 4, x1: sx + 4, y0: top, y1: top + sh, z0: sz - 4, z1: sz + 4, layer: 2, seed: seedv, hue, lit: 0.1 });
        this.beacons.push(new THREE.Vector3(sx, top + sh + 3, sz));
      } else if (H > 200) {
        this.beacons.push(new THREE.Vector3(sx + R(-10, 10), top + 3, sz + R(-10, 10)));
      }
      towers.push(tower);
      return tower;
    };

    for (let bi = -NB; bi <= NB; bi++) {
      for (let bj = -NB; bj <= NB; bj++) {
        const cx = bi * P, cz = bj * P, h = BLOCK / 2;
        const n = fbm(cx / 1000 + 5.3, cz / 1000 + 1.7, 11, 3);
        const dc = Math.hypot(cx, cz) / EXTENT;
        const zone = fbm(cx / 900 + 40, cz / 900 - 12, 77, 2);
        let H0 = 90 + 1080 * Math.pow(clamp(n * 1.25 + (1 - dc) * 0.22 - 0.08, 0, 1), 1.55);
        const kind = rng();
        // keep the spawn crossing open and give the player a few low "parks"
        if (kind < 0.07) {                                              // low district
          makeTower(cx - h, cx + h, cz - h, cz + h, R(40, 110), zone, cx, cz);
        } else if (kind < 0.40) {                                       // single
          const i0 = 8 * Math.floor(R(0, 3)), i1 = 8 * Math.floor(R(0, 3));
          makeTower(cx - h + i0, cx + h - i1, cz - h + i1, cz + h - i0, H0 * R(0.75, 1.2), zone, cx, cz);
        } else if (kind < 0.62) {                                       // double
          const alongX = rng() < 0.5, g = 8;
          for (let s = 0; s < 2; s++) {
            const lo = s === 0 ? -h : g / 2, hi = s === 0 ? -g / 2 : h;
            if (alongX) makeTower(cx + lo, cx + hi, cz - h, cz + h, H0 * R(0.5, 1.15), zone, cx, cz);
            else makeTower(cx - h, cx + h, cz + lo, cz + hi, H0 * R(0.5, 1.15), zone, cx, cz);
          }
        } else if (kind < 0.86) {                                       // quad
          const g = 16;
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
            const x0 = cx + (a === 0 ? -h : g / 2), x1 = cx + (a === 0 ? -g / 2 : h);
            const z0 = cz + (b === 0 ? -h : g / 2), z1 = cz + (b === 0 ? -g / 2 : h);
            makeTower(x0, x1, z0, z1, H0 * R(0.35, 1.05), zone, cx, cz);
          }
        } else {                                                        // plaza: podium + slender towers
          const podH = snap(R(32, 64));
          this.addBox({ x0: cx - h, x1: cx + h, y0: 0, y1: podH, z0: cz - h, z1: cz + h, layer: wpick([[1, 2], [2, 2], [3, 1]]), seed: rng(), hue: 0, lit: R(0.2, 0.6) });
          const nt = 1 + Math.floor(rng() * 3);
          for (let t = 0; t < nt; t++) {
            const w = 8 * Math.floor(R(5, 9)), d = 8 * Math.floor(R(5, 9));
            const px = snap(cx + R(-h + w / 2 + 8, h - w / 2 - 8)), pz = snap(cz + R(-h + d / 2 + 8, h - d / 2 - 8));
            makeTower(px - w / 2, px + w / 2, pz - d / 2, pz + d / 2, Math.max(H0 * R(0.6, 1.1), podH + 96), zone, cx, cz, podH);
          }
        }
      }
    }

    this.makeBridges(rng, wpick);
    this.makeLedges(rng);
    return this;
  }

  makeBridges(rng, wpick) {
    const R = (a, b) => a + (b - a) * rng();
    let n = 0;
    for (let bi = -NB; bi <= NB; bi++) {
      for (let bj = -NB; bj <= NB; bj++) {
        for (const axis of ['x', 'z']) {
          if (rng() > 0.42) continue;
          const cx = bi * P, cz = bj * P, h = BLOCK / 2;
          if (axis === 'x' && bi === NB) continue;
          if (axis === 'z' && bj === NB) continue;
          const y = snap(R(72, 520));
          const off = snap(R(-56, 56));
          let a0, a1, p0, p1;
          if (axis === 'x') { a0 = cx + h; a1 = cx + P - h; p0 = cz + off; }
          else { a0 = cz + h; a1 = cz + P - h; p0 = cx + off; }
          const test = (a, p) => axis === 'x' ? this.solidAt(a, y + 6, p) : this.solidAt(p, y + 6, a);
          if (!(test(a0 - 3, p0) && test(a1 + 3, p0))) continue;
          if (!(test(a0 - 3, p0 - 6) && test(a1 + 3, p0 + 6))) continue;
          const layer = wpick([[0, 3], [3, 3], [5, 2]]);
          const b = axis === 'x'
            ? { x0: a0 - 2, x1: a1 + 2, y0: y, y1: y + 12, z0: p0 - 8, z1: p0 + 8 }
            : { x0: p0 - 8, x1: p0 + 8, y0: y, y1: y + 12, z0: a0 - 2, z1: a1 + 2 };
          if (this.overlaps(b.x0 + 4, b.x1 - 4, b.y0, b.y1, b.z0 + 4, b.z1 - 4)) continue;
          this.addBox({ ...b, layer, seed: rng(), hue: rng() < 0.5 ? 0 : (rng() - 0.5) * 0.4, lit: R(0.5, 0.95) });
          n++;
        }
      }
    }
    this.bridgeCount = n;
  }

  makeLedges(rng) {
    const R = (a, b) => a + (b - a) * rng();
    const cand = this.boxes.map((b, i) => [b, i]).filter(([b]) => (b.y1 - b.y0) >= 72 && b.y1 > 100 && b.layer !== undefined && !b.bridge);
    let tries = 0;
    while (this.ledges.length < 150 && tries++ < 4000) {
      const [b, id] = cand[Math.floor(rng() * cand.length)];
      const face = Math.floor(rng() * 4);       // 0:+x 1:-x 2:+z 3:-z
      const along = face < 2 ? (b.z1 - b.z0) : (b.x1 - b.x0);
      if (along < 56) continue;
      const w = 36, depth = 28, th = 2;
      const c = snap(R(-along / 2 + w / 2 + 12, along / 2 - w / 2 - 12));
      const y = snap(R(b.y0 + 24, b.y1 - 24));
      if (y < 48) continue;
      let ab;
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      if (face === 0) ab = { x0: b.x1, x1: b.x1 + depth, z0: mz + c - w / 2, z1: mz + c + w / 2 };
      else if (face === 1) ab = { x0: b.x0 - depth, x1: b.x0, z0: mz + c - w / 2, z1: mz + c + w / 2 };
      else if (face === 2) ab = { z0: b.z1, z1: b.z1 + depth, x0: mx + c - w / 2, x1: mx + c + w / 2 };
      else ab = { z0: b.z0 - depth, z1: b.z0, x0: mx + c - w / 2, x1: mx + c + w / 2 };
      // free approach space: ledge + 40 m further out and 30 m above
      const ext = 44;
      const chk = { ...ab };
      if (face === 0) chk.x1 += ext; else if (face === 1) chk.x0 -= ext; else if (face === 2) chk.z1 += ext; else chk.z0 -= ext;
      if (this.overlaps(chk.x0, chk.x1, y - 6, y + 34, chk.z0, chk.z1, id)) continue;
      // the wall must really be there along the whole ledge height
      const slab = { ...ab, y0: y, y1: y + th };
      const bid = this.addBox({ ...slab, layer: 5, seed: rng(), hue: 0, lit: 0, ledge: true });
      const nrm = new THREE.Vector3(face === 0 ? 1 : face === 1 ? -1 : 0, 0, face === 2 ? 1 : face === 3 ? -1 : 0);
      const center = new THREE.Vector3((ab.x0 + ab.x1) / 2, y + th, (ab.z0 + ab.z1) / 2);
      this.ledges.push({ id: this.ledges.length, center, normal: nrm, width: w, depth, boxId: bid,
        landing: center.clone().addScaledVector(nrm, -2).setY(y + th + 5) });
    }
  }

  /** Instanced mesh with per-instance facade info. */
  buildMesh(material) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const n = this.boxes.length;
    const mesh = new THREE.InstancedMesh(g, material, n);
    const info = new Float32Array(n * 4);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const b = this.boxes[i];
      m.makeScale(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2);
      mesh.setMatrixAt(i, m);
      info[i * 4] = b.layer; info[i * 4 + 1] = b.seed; info[i * 4 + 2] = b.hue; info[i * 4 + 3] = b.lit;
    }
    g.setAttribute('iInfo', new THREE.InstancedBufferAttribute(info, 4));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    return mesh;
  }

  /** Push a sphere out of geometry. Returns max penetration normal info or null. */
  collide(p, r, outN) {
    let hit = false;
    let maxDepth = 0;
    outN.set(0, 0, 0);
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const seen = this._seen || (this._seen = new Set());
      seen.clear();
      for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
        for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
          const arr = this.grid.get(i * 4096 + j);
          if (!arr) continue;
          for (const id of arr) {
            if (seen.has(id)) continue; seen.add(id);
            const b = this.boxes[id];
            if (b.solid === false) continue;
            const cx = clamp(p.x, b.x0, b.x1), cy = clamp(p.y, b.y0, b.y1), cz = clamp(p.z, b.z0, b.z1);
            let dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r * r) continue;
            let nx, ny, nz, depth;
            if (d2 > 1e-6) {
              const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; depth = r - d;
            } else {                                   // centre inside box: push out the shortest way
              const ds = [p.x - b.x0, b.x1 - p.x, p.y - b.y0, b.y1 - p.y, p.z - b.z0, b.z1 - p.z];
              let k = 0; for (let q = 1; q < 6; q++) if (ds[q] < ds[k]) k = q;
              nx = ny = nz = 0;
              if (k === 0) nx = -1; else if (k === 1) nx = 1; else if (k === 2) ny = -1; else if (k === 3) ny = 1; else if (k === 4) nz = -1; else nz = 1;
              depth = ds[k] + r;
            }
            p.x += nx * depth; p.y += ny * depth; p.z += nz * depth;
            outN.x += nx * depth; outN.y += ny * depth; outN.z += nz * depth;
            hit = true; any = true; maxDepth = Math.max(maxDepth, depth);
          }
        }
      }
      if (!any) break;
    }
    if (p.y - r < GROUND + 4) { const d = GROUND + 4 - (p.y - r); p.y += d; outN.y += d; hit = true; maxDepth = Math.max(maxDepth, d); }
    if (hit) outN.normalize();
    return hit ? maxDepth : 0;
  }
}
