import * as THREE from 'three';

/**
 * GeometryBuilder — accumulates raw triangles with position/normal/uv/colour so
 * many small pieces can be merged into a single draw call per material.
 */
export class GeometryBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  addQuad(p0, p1, p2, p3, n, uv, color) {
    const base = this.pos.length / 3;
    const verts = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
    this.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  isEmpty() { return this.idx.length === 0; }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _c = new THREE.Color();

/** Vertical prism walls (open top/bottom), UVs scaled by tile size. */
export function addWalls(GB, cx, y0, cz, w, h, d, tileX, tileY, color) {
  const hw = w / 2, hd = d / 2, y1 = y0 + h;
  const ux = w / tileX, uy = h / tileY, uz = d / tileX;
  const c = color;
  // +Z
  GB.addQuad([cx - hw, y0, cz + hd], [cx + hw, y0, cz + hd], [cx + hw, y1, cz + hd], [cx - hw, y1, cz + hd], [0, 0, 1], [0, 0, ux, 0, ux, uy, 0, uy], c);
  // -Z
  GB.addQuad([cx + hw, y0, cz - hd], [cx - hw, y0, cz - hd], [cx - hw, y1, cz - hd], [cx + hw, y1, cz - hd], [0, 0, -1], [0, 0, ux, 0, ux, uy, 0, uy], c);
  // +X
  GB.addQuad([cx + hw, y0, cz + hd], [cx + hw, y0, cz - hd], [cx + hw, y1, cz - hd], [cx + hw, y1, cz + hd], [1, 0, 0], [0, 0, uz, 0, uz, uy, 0, uy], c);
  // -X
  GB.addQuad([cx - hw, y0, cz - hd], [cx - hw, y0, cz + hd], [cx - hw, y1, cz + hd], [cx - hw, y1, cz - hd], [-1, 0, 0], [0, 0, uz, 0, uz, uy, 0, uy], c);
}

/** Horizontal face facing up at y. */
export function addTop(GB, cx, y, cz, w, d, tile, color, flip = false) {
  const hw = w / 2, hd = d / 2;
  const ux = w / tile, uz = d / tile;
  if (!flip) {
    GB.addQuad([cx - hw, y, cz + hd], [cx + hw, y, cz + hd], [cx + hw, y, cz - hd], [cx - hw, y, cz - hd], [0, 1, 0], [0, 0, ux, 0, ux, uz, 0, uz], color);
  } else {
    GB.addQuad([cx - hw, y, cz - hd], [cx + hw, y, cz - hd], [cx + hw, y, cz + hd], [cx - hw, y, cz + hd], [0, -1, 0], [0, 0, ux, 0, ux, uz, 0, uz], color);
  }
}

/** Axis-aligned solid box (all six faces). */
export function addBox(GB, cx, cy, cz, w, h, d, tile, color) {
  addWalls(GB, cx, cy, cz, w, h, d, tile, tile, color);
  addTop(GB, cx, cy + h, cz, w, d, tile, color);
  addTop(GB, cx, cy, cz, w, d, tile, color, true);
}

function collider(cx, y0, cz, w, h, d, tag = 'wall') {
  return {
    min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
    tag,
  };
}

/**
 * Generate one building. Appends geometry to `parts` (a ChunkParts aggregator)
 * and returns its metadata.
 *
 * parts: { byMat: {key: GeometryBuilder}, colliders: [], props: [], navNodes: [],
 *          spawns: [], signs: [] }
 */
export function generateBuilding(rng, parts, cfg) {
  const key = (k) => {
    if (!parts.byMat[k]) parts.byMat[k] = new GeometryBuilder();
    return parts.byMat[k];
  };

  let { x, z, maxW, maxD, minFloors, maxFloors, allowEnter, forceEnter } = cfg;
  const floorH = 3.6;
  const style = rng();
  const facadeCount = parts.facadeCount || 6;
  const variant = `facade${Math.floor(rng() * facadeCount)}`;
  const tint = 0.7 + rng() * 0.55;

  // footprint
  let w = maxW * (0.5 + rng() * 0.5);
  let d = maxD * (0.5 + rng() * 0.5);
  const floors = Math.floor(minFloors + rng() * (maxFloors - minFloors + 1));
  const height = floors * floorH;

  const isTower = floors >= 14;
  // Interiors are a major slice of the map, not a 3% curiosity. One building per
  // chunk is forced enterable (world.js) and the rest roll a healthy chance.
  const enterable = forceEnter || (allowEnter && floors >= 2 && floors <= 44 && rng() < 0.30);
  const doorSide = (cfg.doorSide != null) ? cfg.doorSide : Math.floor(rng() * 4); // 0:+Z 1:-Z 2:+X 3:-X

  const col = new THREE.Color().setHSL(
    0.55 + (rng() - 0.5) * 0.14,
    0.05 + rng() * 0.10,
    0.48 + tint * 0.20
  );

  // ---- stacked segments (setbacks) ----
  const segments = [];
  let segY = 0;
  let sw = w, sd = d, sx = x, sz = z;
  const segCount = isTower ? (rng() < 0.5 ? 2 : 3) : 1;
  const totalFloors = floors;
  let remaining = totalFloors;
  for (let s = 0; s < segCount; s++) {
    const isLast = s === segCount - 1;
    const f = isLast ? remaining : Math.max(3, Math.round(remaining * (0.4 + rng() * 0.3)));
    remaining -= f;
    if (f <= 0) break;
    const hFac = f * floorH;
    if (s > 0) {
      const shrink = 0.68 + rng() * 0.2;
      sw *= shrink; sd *= shrink;
      sx = x + (rng() - 0.5) * (w - sw) * 0.6;
      sz = z + (rng() - 0.5) * (d - sd) * 0.6;
    }
    segments.push({ x: sx, z: sz, w: sw, d: sd, y: segY, h: hFac, floors: f, groundSeg: s === 0 });
    segY += hFac;
    if (remaining <= 0) break;
  }
  // ensure at least one segment
  if (segments.length === 0) segments.push({ x, z, w, d, y: 0, h: height, floors, groundSeg: true });

  const wallWin = key(variant);
  const roofGB = key('roof');

  // Street-facing entrance (canopy, neon frame, floor mat, lamp, sign) — only
  // for enterable buildings, so empty interiors are never advertised.
  if (enterable) addEntrance(parts, x, z, w, d, doorSide, col);

  // ---- shell ----
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (enterable && si === 0) {
      addWallsWithDoor(wallWin, seg.x, seg.y, seg.z, seg.w, seg.h, seg.d, 5.0, floorH, col, doorSide, 2.2, seg.floors);
    } else {
      addWalls(wallWin, seg.x, seg.y, seg.z, seg.w, seg.h, seg.d, 5.0, floorH, col);
    }
    addTop(roofGB, seg.x, seg.y + seg.h, seg.z, seg.w, seg.d, 6, col);
    addFacadeDetail(parts, rng, seg, col, variant, enterable ? doorSide : -1);
  }

  // ground-floor solid collider for non-enterable OR upper mass collider for enterable
  if (!enterable) {
    parts.colliders.push(collider(x, 0, z, w, height, d, 'building'));
  } else {
    // enterable: solid mass for everything above the ground floor(s) we detail,
    // thin walls + floors for the detailed portion so the shell is preserved.
    const detailFloors = Math.min(segments[0].floors, 8);
    const detailH = detailFloors * floorH;
    // upper solid mass
    if (height > detailH) {
      parts.colliders.push(collider(x, detailH, z, w, height - detailH, d, 'building'));
    }
    const di = doorInfo(x, z, w, d, doorSide);
    parts.enterables = parts.enterables || [];
    parts.enterables.push({
      x, z, w, d, detailFloors, floorH, seg: segments[0], col: col.clone(), doorSide,
      doorX: di.x, doorZ: di.z, doorNx: di.nx, doorNz: di.nz,
    });
  }

  // ---- rooftop details ----
  const topSeg = segments[segments.length - 1];
  const topY = topSeg.y + topSeg.h;
  addRooftop(rng, parts, topSeg.x, topY, topSeg.z, topSeg.w, topSeg.d, col, key, roofGB);

  const di = doorInfo(x, z, w, d, doorSide);
  return {
    x, z, w, d, height, floors, enterable, segments, col, doorSide, floorH,
    doorX: di.x, doorZ: di.z, doorNx: di.nx, doorNz: di.nz,
  };
}

/**
 * Walls for the ground floor with a door gap on `doorSide`, and (optionally)
 * window band gaps above so tall ground floors read better.
 */
function addWallsWithDoor(GB, cx, y0, cz, w, h, d, tileX, tileY, color, doorSide, doorW, floors) {
  const hw = w / 2, hd = d / 2, y1 = y0 + h;
  const ux = w / tileX, uy = h / tileY, uz = d / tileX;
  const half = doorW / 2;
  const C = color;
  // +Z  (doorSide 0)
  drawWallSide(GB, 'z+', cx, cz, hw, hd, y0, y1, ux, uz, uy, C, doorSide === 0, half);
  // -Z  (doorSide 1)
  drawWallSide(GB, 'z-', cx, cz, hw, hd, y0, y1, ux, uz, uy, C, doorSide === 1, half);
  // +X  (doorSide 2)
  drawWallSide(GB, 'x+', cx, cz, hw, hd, y0, y1, uz, ux, uy, C, doorSide === 2, half);
  // -X  (doorSide 3)
  drawWallSide(GB, 'x-', cx, cz, hw, hd, y0, y1, uz, ux, uy, C, doorSide === 3, half);
}

function drawWallSide(GB, side, cx, cz, hw, hd, y0, y1, uLen, uOther, uy, C, hasDoor, half) {
  if (!hasDoor) {
    switch (side) {
      case 'z+': GB.addQuad([cx - hw, y0, cz + hd], [cx + hw, y0, cz + hd], [cx + hw, y1, cz + hd], [cx - hw, y1, cz + hd], [0, 0, 1], [0, 0, uLen, 0, uLen, uy, 0, uy], C); break;
      case 'z-': GB.addQuad([cx + hw, y0, cz - hd], [cx - hw, y0, cz - hd], [cx - hw, y1, cz - hd], [cx + hw, y1, cz - hd], [0, 0, -1], [0, 0, uLen, 0, uLen, uy, 0, uy], C); break;
      case 'x+': GB.addQuad([cx + hw, y0, cz + hd], [cx + hw, y0, cz - hd], [cx + hw, y1, cz - hd], [cx + hw, y1, cz + hd], [1, 0, 0], [0, 0, uOther, 0, uOther, uy, 0, uy], C); break;
      case 'x-': GB.addQuad([cx - hw, y0, cz - hd], [cx - hw, y0, cz + hd], [cx - hw, y1, cz + hd], [cx - hw, y1, cz - hd], [-1, 0, 0], [0, 0, uOther, 0, uOther, uy, 0, uy], C); break;
    }
    return;
  }
  // split into left and right segments around the door gap, leaving a lintel above
  const doorH = Math.min(3.0, y1 - y0);
  if (side === 'z+' || side === 'z-') {
    const sign = side === 'z+' ? 1 : -1;
    const z = cz + sign * hd;
    const n = [0, 0, sign];
    const xa = cx - hw, xb = cx - half, xc = cx + half, xd = cx + hw;
    // left panel
    GB.addQuad([xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], n, [0, 0, (xb - xa) / 5, 0, (xb - xa) / 5, uy, 0, uy], C);
    // right panel
    GB.addQuad([xc, y0, z], [xd, y0, z], [xd, y1, z], [xc, y1, z], n, [0, 0, (xd - xc) / 5, 0, (xd - xc) / 5, uy, 0, uy], C);
    // lintel above the door
    GB.addQuad([xb, y0 + doorH, z], [xc, y0 + doorH, z], [xc, y1, z], [xb, y1, z], n, [0, 0, (xc - xb) / 5, 0, (xc - xb) / 5, (y1 - y0 - doorH) / 3.6, 0, (y1 - y0 - doorH) / 3.6], C);
  } else {
    const sign = side === 'x+' ? 1 : -1;
    const x = cx + sign * hw;
    const n = [sign, 0, 0];
    const za = cz - hd, zb = cz - half, zc = cz + half, zd = cz + hd;
    GB.addQuad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], n, [0, 0, (zb - za) / 5, 0, (zb - za) / 5, uy, 0, uy], C);
    GB.addQuad([x, y0, zc], [x, y0, zd], [x, y1, zd], [x, y1, zc], n, [0, 0, (zd - zc) / 5, 0, (zd - zc) / 5, uy, 0, uy], C);
    GB.addQuad([x, y0 + doorH, zb], [x, y0 + doorH, zc], [x, y1, zc], [x, y1, zb], n, [0, 0, (zc - zb) / 5, 0, (zc - zb) / 5, (y1 - y0 - doorH) / 3.6, 0, (y1 - y0 - doorH) / 3.6], C);
  }
}


/** Door centre + outward normal for one façade side (0:+Z 1:-Z 2:+X 3:-X). */
function doorInfo(x, z, w, d, side) {
  switch (side) {
    case 1: return { x, z: z - d / 2, nx: 0, nz: -1, tx: 1, tz: 0 };
    case 2: return { x: x + w / 2, z, nx: 1, nz: 0, tx: 0, tz: 1 };
    case 3: return { x: x - w / 2, z, nx: -1, nz: 0, tx: 0, tz: 1 };
    default: return { x, z: z + d / 2, nx: 0, nz: 1, tx: 1, tz: 0 };
  }
}

/**
 * Enterable-building entrance: canopy, neon door frame, lit floor mat, a
 * street lamp in the light pool and a readable holo sign. This is the landmark
 * players navigate to, so it must read from across the street in ASCII.
 */
function addEntrance(parts, x, z, w, d, side, col) {
  const key = (k) => (parts.byMat[k] = parts.byMat[k] || new GeometryBuilder());
  const metal = key('metal');
  const neon = key('neonCyan');
  const warm = key('lampEmissive');
  const info = doorInfo(x, z, w, d, side);
  const outX = info.nx * 0.9, outZ = info.nz * 0.9;
  const metalCol = col.clone().multiplyScalar(1.15);

  // canopy (sticks out over the pavement)
  if (info.nx === 0) {
    addBox(metal, info.x, 3.02, info.z + info.nz * 0.8, 3.2, 0.14, 1.6, 2, metalCol);
    addBox(warm, info.x, 2.88, info.z + info.nz * 0.55, 2.2, 0.08, 0.4, 1, new THREE.Color(1, 0.95, 0.85));
  } else {
    addBox(metal, info.x + info.nx * 0.8, 3.02, info.z, 1.6, 0.14, 3.2, 2, metalCol);
    addBox(warm, info.x + info.nx * 0.55, 2.88, info.z, 0.4, 0.08, 2.2, 1, new THREE.Color(1, 0.95, 0.85));
  }

  // neon door frame: two uprights + lintel
  const upH = 2.75;
  if (info.nx === 0) {
    for (const sgn of [-1, 1]) addBox(neon, info.x + sgn * 1.22, 0.18 + upH / 2, info.z + info.nz * 0.045, 0.08, upH, 0.08, 1, new THREE.Color(1, 1, 1));
    addBox(neon, info.x, 0.18 + upH, info.z + info.nz * 0.045, 2.55, 0.08, 0.08, 1, new THREE.Color(1, 1, 1));
    // floor mat / threshold glow
    addBox(neon, info.x, 0.195, info.z + info.nz * 0.75, 2.4, 0.025, 1.3, 1, new THREE.Color(1, 1, 1));
  } else {
    for (const sgn of [-1, 1]) addBox(neon, info.x + info.nx * 0.045, 0.18 + upH / 2, info.z + sgn * 1.22, 0.08, upH, 0.08, 1, new THREE.Color(1, 1, 1));
    addBox(neon, info.x + info.nx * 0.045, 0.18 + upH, info.z, 0.08, 0.08, 2.55, 1, new THREE.Color(1, 1, 1));
    addBox(neon, info.x + info.nx * 0.75, 0.195, info.z, 1.3, 0.025, 2.4, 1, new THREE.Color(1, 1, 1));
  }

  // entrance lamp goes into the shared point-light pool
  parts.lamps = parts.lamps || [];
  parts.lamps.push({
    x: info.x + outX, y: 2.85, z: info.z + outZ,
    color: 0x9fe8ff, intensity: 28, range: 22,
  });

  // glowing holo sign above the canopy
  parts.signs = parts.signs || [];
  parts.signs.push({
    x: info.x + info.nx * 0.12, y: 3.7, z: info.z + info.nz * 0.12,
    w: 2.6, h: 0.62, ry: side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2,
    seed: Math.floor(info.x * 17 + info.z * 31) & 0x7fffffff,
  });
}

/** Thin ledges, corner neon, protruding AC units — the skyline silhouette. */
function addFacadeDetail(parts, rng, seg, col, variant, doorSide = -1) {
  const key = (k) => (parts.byMat[k] = parts.byMat[k] || new GeometryBuilder());
  const metal = key('metal');
  const fh = seg.floors > 0 ? seg.h / seg.floors : seg.h;
  const hw = seg.w / 2, hd = seg.d / 2;
  const light = col.clone().multiplyScalar(1.25);

  // horizontal cornice bands every few floors
  const step = 3 + Math.floor(rng() * 2);
  for (let f = step; f < seg.floors; f += step) {
    const y = seg.y + f * fh;
    addBox(metal, seg.x, y, seg.z + hd + 0.06, seg.w, 0.12, 0.16, 2, light);
    addBox(metal, seg.x, y, seg.z - hd - 0.06, seg.w, 0.12, 0.16, 2, light);
    addBox(metal, seg.x + hw + 0.06, y, seg.z, 0.16, 0.12, seg.d, 2, light);
    addBox(metal, seg.x - hw - 0.06, y, seg.z, 0.16, 0.12, seg.d, 2, light);
  }

  // corner neon strips on roughly half the segments
  if (rng() < 0.55) {
    const neonKey = ['neonCyan', 'neonPink', 'neonAmber', 'neonGreen'][Math.floor(rng() * 4)];
    const neon = key(neonKey);
    const h = Math.min(seg.h, 22);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      addBox(neon, seg.x + sx * (hw + 0.045), seg.y + h / 2, seg.z + sz * (hd + 0.045), 0.09, h, 0.09, 1, new THREE.Color(1, 1, 1));
    }
  }

  // a couple of AC boxes / balconies sticking out of the façade
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const side = Math.floor(rng() * 4);
    const u = (rng() - 0.5) * 0.8;
    const f = 1 + Math.floor(rng() * Math.max(1, seg.floors - 1));
    const y = seg.y + f * fh - 0.3;
    const bw = 0.8 + rng() * 1.4, bh = 0.5 + rng() * 0.7;
    if (side === 0) addBox(metal, seg.x + u * seg.w, y, seg.z + hd + 0.22, bw, bh, 0.45, 2, light);
    else if (side === 1) addBox(metal, seg.x + u * seg.w, y, seg.z - hd - 0.22, bw, bh, 0.45, 2, light);
    else if (side === 2) addBox(metal, seg.x + hw + 0.22, y, seg.z + u * seg.d, 0.45, bh, bw, 2, light);
    else addBox(metal, seg.x - hw - 0.22, y, seg.z + u * seg.d, 0.45, bh, bw, 2, light);
  }

  // large wall holo-signs high on the façade (batched, so cheap)
  if (seg.h > 12 && rng() < 0.45) {
    const side = Math.floor(rng() * 4);
    if (!(seg.groundSeg && side === doorSide)) {
      const sw = 3.2 + rng() * 4.2, sh = sw * 0.24;
      const y = seg.y + 5.5 + rng() * Math.max(1, Math.min(seg.h, 36) - 7.5);
      let sx = seg.x, sz = seg.z, ry = 0;
      if (side === 0) { sx = seg.x + (rng() - 0.5) * (seg.w - sw - 1); sz = seg.z + seg.d / 2 + 0.07; ry = 0; }
      else if (side === 1) { sx = seg.x + (rng() - 0.5) * (seg.w - sw - 1); sz = seg.z - seg.d / 2 - 0.07; ry = Math.PI; }
      else if (side === 2) { sz = seg.z + (rng() - 0.5) * (seg.d - sw - 1); sx = seg.x + seg.w / 2 + 0.07; ry = Math.PI / 2; }
      else { sz = seg.z + (rng() - 0.5) * (seg.d - sw - 1); sx = seg.x - seg.w / 2 - 0.07; ry = -Math.PI / 2; }
      parts.signs = parts.signs || [];
      parts.signs.push({ x: sx, y, z: sz, w: sw, h: sh, ry, seed: Math.floor(rng() * 1e6) });
    }
  }

  // ground-floor shop glazing on the other façades (street life)
  if (seg.groundSeg) addShopfronts(parts, rng, seg, col, doorSide);
}

/** Bright glazed shop bands + awnings around the ground floor. */
function addShopfronts(parts, rng, seg, col, doorSide = -1) {
  if (rng() > 0.78) return;
  const key = (k) => (parts.byMat[k] = parts.byMat[k] || new GeometryBuilder());
  const glass = key('glassEmissive');
  const metal = key('metal');
  const hw = seg.w / 2, hd = seg.d / 2;
  const y = 0.18;
  const sides = [0, 1, 2, 3].filter((side) => side !== doorSide && rng() < 0.72);
  for (const side of sides) {
    const alongZ = side === 0 || side === 1;
    const len = (alongZ ? seg.w : seg.d) - 1.2;
    if (len < 3) continue;
    const count = Math.max(1, Math.floor(len / 2.6));
    for (let i = 0; i < count; i++) {
      const u = -len / 2 + (i + 0.5) * (len / count);
      const panelW = Math.min(1.8, len / count - 0.4);
      if (panelW < 0.7) continue;
      const z = side === 0 ? seg.z + hd + 0.04 : side === 1 ? seg.z - hd - 0.04 : seg.z + u;
      const x = side === 2 ? seg.x + hw + 0.04 : side === 3 ? seg.x - hw - 0.04 : seg.x + u;
      if (alongZ) addBox(glass, x, y + 1.35, z, panelW, 1.9, 0.08, 1, new THREE.Color(0.65, 0.85, 1));
      else addBox(glass, x, y + 1.35, z, 0.08, 1.9, panelW, 1, new THREE.Color(0.65, 0.85, 1));
    }
    // awning over the shop band
    const aw = len + 0.4;
    if (alongZ) addBox(metal, seg.x, y + 2.55, side === 0 ? seg.z + hd + 0.45 : seg.z - hd - 0.45, aw, 0.1, 1.0, 2, col.clone().multiplyScalar(0.9));
    else addBox(metal, side === 2 ? seg.x + hw + 0.45 : seg.x - hw - 0.45, y + 2.55, seg.z, 1.0, 0.1, aw, 2, col.clone().multiplyScalar(0.9));
  }
}

function addRooftop(rng, parts, cx, y, cz, w, d, col, key, roofGB) {
  const metal = key('metal');
  const concrete = key('concrete');
  const acc = key('roof');

  // parapet
  const pw = 0.5, ph = 1.0;
  const hw = w / 2, hd = d / 2;
  const pc = col.clone().multiplyScalar(1.1);
  // four thin walls around roof edge
  addWalls(acc, cx, y, cz + hd - pw / 2, w, ph, pw, 6, 2, pc);
  addWalls(acc, cx, y, cz - hd + pw / 2, w, ph, pw, 6, 2, pc);
  addWalls(acc, cx + hw - pw / 2, y, cz, pw, ph, d, 6, 2, pc);
  addWalls(acc, cx - hw + pw / 2, y, cz, pw, ph, d, 6, 2, pc);

  // AC units / vents
  const nUnits = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < nUnits; i++) {
    const uw = 1.5 + rng() * 2.5, uh = 1.0 + rng() * 2.0, ud = 1.5 + rng() * 2.5;
    const ux = cx + (rng() - 0.5) * (w - uw - 2);
    const uz = cz + (rng() - 0.5) * (d - ud - 2);
    addBox(metal, ux, y + 0.2, uz, uw, uh, ud, 2, col.clone().multiplyScalar(0.8));
    if (rng() < 0.5) parts.colliders.push(collider(ux, y + 0.2, uz, uw, uh, ud, 'roof'));
  }
  // water tank / cooling tower
  if (rng() < 0.45) {
    const tw = 2 + rng() * 3, th = 2 + rng() * 3;
    const tx = cx + (rng() - 0.5) * (w - tw - 2);
    const tz = cz + (rng() - 0.5) * (d - tw - 2);
    addBox(metal, tx, y + 0.2, tz, tw, th, tw, 2.5, col.clone().multiplyScalar(0.7));
    parts.colliders.push(collider(tx, y + 0.2, tz, tw, th, tw, 'roof'));
  }
  // antenna mast + beacon
  if (rng() < 0.55) {
    const mx = cx + (rng() - 0.5) * (w - 2);
    const mz = cz + (rng() - 0.5) * (d - 2);
    const mh = 3 + rng() * 7;
    addBox(metal, mx, y, mz, 0.35, mh, 0.35, 2, col.clone().multiplyScalar(0.6));
    parts.props = parts.props || [];
    parts.props.push({ type: 'beacon', x: mx, y: y + mh, z: mz, color: 0xff2020 });
  }
  // rooftop neon sign / billboard
  if (rng() < 0.3) {
    const side = Math.floor(rng() * 4);
    const sw = 3 + rng() * 5, sh = 1.5 + rng() * 2;
    const off = (rng() - 0.5) * (w - sw - 1);
    let px, pz, ry;
    if (side === 0) { px = cx + off; pz = cz + hd + 0.15; ry = 0; }
    else if (side === 1) { px = cx + off; pz = cz - hd - 0.15; ry = Math.PI; }
    else if (side === 2) { px = cx + hw + 0.15; pz = cz + off; ry = Math.PI / 2; }
    else { px = cx - hw - 0.15; pz = cz + off; ry = -Math.PI / 2; }
    parts.signs = parts.signs || [];
    parts.signs.push({ x: px, y: y + ph + sh / 2 + 0.2, z: pz, w: sw, h: sh, ry, seed: Math.floor(rng() * 1e6) });
  }
}

/**
 * Build an interior volume for an enterable building: floors, partition walls,
 * a connecting staircase, furniture and ceiling lights. Adds to chunk geometry
 * and colliders. `b` is the metadata returned by generateBuilding.
 */
export function buildInterior(rng, parts, b) {
  const key = (k) => (parts.byMat[k] = parts.byMat[k] || new GeometryBuilder());
  const wallGB = key('interiorWall');
  const floorGB = key('interiorFloor');
  const metal = key('metal');
  const concrete = key('concrete');
  const crate = key('crate');
  const glass = key('glassEmissive');
  const neon = key('neonCyan');

  const floorH = b.floorH;
  const w = b.w, d = b.d;
  const wallT = 0.4;
  const tint = b.col.clone().multiplyScalar(1.35).offsetHSL(0, -0.05, 0.06);

  // Which side has the street door (0:+Z 1:-Z 2:+X 3:-X)
  const doorSide = b.doorSide ?? 0;
  const doorW = 2.2;

  for (let f = 0; f < b.detailFloors; f++) {
    const y = f * floorH;
    // perimeter walls (thin) with a doorway on the ground floor
    addInteriorWalls(wallGB, parts, b.x, y, b.z, w, d, floorH, wallT, tint, f === 0 ? doorSide : -1, doorW);

    // partition walls: split around a real doorway so no room is sealed off
    const layout = interiorLayout(rng, b);
    for (const wall of layout.walls) addPartitionWall(wallGB, parts, wall, y, floorH, wallT, tint);

    // furniture: crates, desks with monitors, server racks, planters
    for (const item of layout.items) {
      const ix = b.x + item.x, iz = b.z + item.z;
      const col = tint.clone().multiplyScalar(item.shade || 0.85);
      if (item.type === 'crate') {
        addBox(crate, ix, y + item.s / 2, iz, item.s, item.s, item.s, 2, col);
        parts.colliders.push(collider(ix, y, iz, item.s, item.s, item.s, 'prop'));
      } else if (item.type === 'desk') {
        addBox(metal, ix, y + 0.36, iz, item.s, 0.72, item.s * 0.6, 2, col);
        // monitor
        addBox(glass, ix, y + 0.95, iz, item.s * 0.5, 0.34, 0.06, 1, new THREE.Color(0.6, 0.85, 1));
        parts.colliders.push(collider(ix, y, iz, item.s, 0.8, item.s * 0.6, 'prop'));
      } else if (item.type === 'rack') {
        addBox(metal, ix, y + 1.1, iz, 0.8, 2.2, item.s, 2, col.clone().multiplyScalar(0.75));
        // LED strip on the front face
        addBox(neon, ix, y + 1.5, iz - item.s / 2 - 0.02, 0.5, 0.06, 0.04, 1, new THREE.Color(1, 1, 1));
        parts.colliders.push(collider(ix, y, iz, 0.8, 2.2, item.s, 'prop'));
      } else if (item.type === 'bench') {
        addBox(metal, ix, y + 0.22, iz, item.s, 0.44, 0.5, 2, col);
        parts.colliders.push(collider(ix, y, iz, item.s, 0.44, 0.5, 'prop'));
      } else if (item.type === 'plant') {
        addBox(concrete, ix, y + 0.28, iz, 0.5, 0.56, 0.5, 1, col.clone().multiplyScalar(0.8));
        addBox(concrete, ix, y + 0.9, iz, 1.1, 0.9, 1.1, 2, new THREE.Color(0.18, 0.45, 0.24));
        parts.colliders.push(collider(ix, y, iz, 0.6, 1.2, 0.6, 'prop'));
      }
    }

    // A bright horizontal light strip at ceiling height gives every floor a
    // readable horizon line in the ASCII pass.
    for (const sx of [-1, 1]) {
      addBox(neon, b.x + sx * (w / 2 - 0.35), y + floorH - 0.2, b.z, 0.08, 0.08, Math.max(2, d - 2.4), 1, new THREE.Color(1, 1, 1));
    }

    // utility pipes / cable tray hugging the ceiling
    const pipeY = y + floorH - 0.32;
    for (let i = 0; i < 2; i++) {
      const px = b.x + (i === 0 ? -1 : 1) * (w / 2 - 0.5);
      addBox(metal, px, pipeY, b.z, 0.12, 0.12, Math.max(3, d - 2.2), 2, tint.clone().multiplyScalar(0.65));
      addBox(metal, px, pipeY - 0.28, b.z - d / 4, 0.1, 0.6, 0.1, 1, tint.clone().multiplyScalar(0.55));
    }

    // lockers / storage bays — on the wall opposite the stairwell (and opposite
    // an x-facing entrance) so they never block the landing or the doorway.
    if (rng() < 0.6) {
      const nlock = 2 + Math.floor(rng() * 3);
      // Ground floor: never use the wall that contains the entrance. An
      // x-facing door (2/3) uses the opposite x wall; a -Z door (1) uses an x
      // wall; a +Z door (0) can safely use the opposite (-Z) wall.
      let onX = false, sideSign = 1;
      if (f === 0) {
        if (doorSide === 2) { onX = true; sideSign = -1; }
        else if (doorSide === 3) { onX = true; sideSign = 1; }
        else if (doorSide === 1) { onX = true; sideSign = 1; }
      }
      for (let i = 0; i < nlock; i++) {
        const off = (i - (nlock - 1) / 2) * 0.65;
        const lx = onX ? b.x + sideSign * (w / 2 - 0.8) : b.x + off;
        const lz = onX ? b.z + off : b.z - d / 2 + 0.8;
        addBox(metal, lx, y + 0.95, lz, onX ? 0.5 : 0.55, 1.9, onX ? 0.55 : 0.5, 2, tint.clone().multiplyScalar(0.62));
        const fx = onX ? lx - sideSign * 0.27 : lx;
        const fz = onX ? lz : lz + 0.27;
        addBox(key('glassEmissive'), fx, y + 1.45, fz, onX ? 0.02 : 0.3, 0.05, onX ? 0.3 : 0.02, 1, new THREE.Color(0.5, 0.8, 1));
        parts.colliders.push(collider(lx, y, lz, onX ? 0.5 : 0.55, 1.9, onX ? 0.55 : 0.5, 'prop'));
      }
    }

    // glowing threshold just inside the street door (ground floor only)
    if (f === 0) {
      const din = doorInfo(b.x, b.z, w, d, doorSide);
      addBox(neon, din.x - din.nx * 1.2, y + 0.22, din.z - din.nz * 1.2, 2.3, 0.04, 2.3, 1, new THREE.Color(1, 1, 1));
      parts.lamps.push({ x: din.x - din.nx * 1.4, y: y + 2.6, z: din.z - din.nz * 1.4, color: 0xffd9a0, intensity: 20, range: 10 });
    }

    // ceiling light panels (visible emissive + point lights in the pool)
    parts.lamps = parts.lamps || [];
    const quads = [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];
    for (const [qx, qz] of quads) {
      const lx = b.x + qx * w, lz = b.z + qz * d;
      addBox(key('ceilingLight'), lx, y + floorH - 0.12, lz, 1.0, 0.12, 0.34, 1, new THREE.Color(0.85, 0.92, 1));
      parts.lamps.push({ x: lx, y: y + floorH - 0.35, z: lz, color: 0xdce8ff, intensity: 58.0, range: Math.max(w, d) * 1.3 });
    }

    // floor slab for the next level, with a stairwell opening + the staircase
    if (f < b.detailFloors - 1) {
      addFloorWithStairwell(floorGB, parts, b, y + floorH, w, d, tint, f);
      addStaircase(rng, wallGB, metal, parts, b, y, f, doorSide);
    } else {
      addTop(floorGB, b.x, y + floorH, b.z, w, d, 4, tint, false);
      addTop(floorGB, b.x, y + floorH, b.z, w, d, 4, tint, true);
    }
  }

  // roof access hatch
  const topY = b.detailFloors * floorH;
  addBox(metal, b.x, topY, b.z, 1.4, 0.3, 1.4, 1, tint);
}

/**
 * A partition wall with a 1.15 m doorway in the middle and a lintel above it.
 * Walls are built as two slabs so the rooms on either side stay connected.
 */
function addPartitionWall(GB, parts, wall, y, floorH, wallT, color) {
  const gap = 1.15;
  const seg = (wall.len - gap) / 2;
  if (seg < 0.35) return;
  const off = gap / 2 + seg / 2;
  const h = floorH - wallT;
  const isX = wall.axis === 'x';
  const centers = [-off, off];
  for (const o of centers) {
    const cx = isX ? wall.x + o : wall.x;
    const cz = isX ? wall.z : wall.z + o;
    const ww = isX ? seg : wallT;
    const wd = isX ? wallT : seg;
    addBox(GB, cx, y + wallT / 2, cz, ww, h, wd, 3, color);
    parts.colliders.push(collider(cx, y, cz, ww, h, wd, 'interior'));
  }
  // lintel above the doorway (no collider at walking height)
  const lh = 0.55;
  const ww = isX ? gap : wallT;
  const wd = isX ? wallT : gap;
  addBox(GB, wall.x, y + h - lh / 2, wall.z, ww, lh, wd, 3, color);
}

function interiorLayout(rng, b) {
  const w = b.w, d = b.d;
  const margin = 1.8;
  const roomW = w - margin * 2;
  const roomD = d - margin * 2;
  const walls = [];
  const items = [];

  // Keep door approaches and the stairwell clear of walls and furniture.
  // stairGeom/doorInfo return *world* coordinates; layout walls/items are
  // stored relative to the building centre. Convert the keep-out rectangles
  // into the same local space (this mismatch used to let furniture spawn on
  // top of the staircase and block the climb).
  const g = stairGeom(b);
  const stairs = {
    x0: Math.min(g.x0, g.x1) - 0.8 - b.x, x1: Math.max(g.x0, g.x1) + 0.8 - b.x,
    z0: Math.min(g.laneZ0, g.laneZ1) - g.sw / 2 - 0.8 - b.z,
    z1: Math.max(g.laneZ0, g.laneZ1) + g.sw / 2 + 0.8 - b.z,
  };
  const di = doorInfo(b.x, b.z, w, d, b.doorSide ?? 0);
  const inward = 4.0, halfDoor = 2.0;
  const dw = infoToRect(b, di, inward, halfDoor);
  const doorZone = { x0: dw.x0 - b.x, x1: dw.x1 - b.x, z0: dw.z0 - b.z, z1: dw.z1 - b.z };
  const zones = [stairs, doorZone];
  const overlapsZone = (x, z, rw, rd) => zones.some((z0) =>
    x + rw / 2 > z0.x0 && x - rw / 2 < z0.x1 && z + rd / 2 > z0.z0 && z - rd / 2 < z0.z1);

  // 1-3 internal partitions, each with a doorway and clear of the safe zones.
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const useX = rng() < 0.5;
      const maxLen = (useX ? roomW : roomD) * 0.78;
      const len = 2.6 + rng() * Math.max(0.1, maxLen - 2.6);
      if (len < 2.6) break;
      const x = (rng() - 0.5) * Math.max(0.1, roomW - (useX ? len : 0));
      const z = (rng() - 0.5) * Math.max(0.1, roomD - (useX ? 0 : len));
      const rw = useX ? len : 0.4, rd = useX ? 0.4 : len;
      if (overlapsZone(x, z, rw + 0.6, rd + 0.6)) continue;
      // keep clear of other partitions
      let clash = false;
      for (const wl of walls) {
        const ww = wl.axis === 'x' ? wl.len : 0.4, wd = wl.axis === 'x' ? 0.4 : wl.len;
        if (Math.abs(wl.x - x) < (rw + ww) / 2 + 0.8 && Math.abs(wl.z - z) < (rd + wd) / 2 + 0.8) { clash = true; break; }
      }
      if (clash) continue;
      walls.push({ axis: useX ? 'x' : 'z', x, z, len });
      break;
    }
  }

  // Furniture. Rejection-sample so nothing spawns inside the stairwell/doorway.
  const m = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < m; i++) {
    const types = ['crate', 'desk', 'rack', 'bench', 'plant'];
    const type = types[Math.floor(rng() * types.length)];
    const s = type === 'rack' ? 0.9 + rng() * 0.5 : 0.9 + rng() * 0.9;
    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = (rng() - 0.5) * (roomW - s);
      const z = (rng() - 0.5) * (roomD - s);
      const rw = type === 'bench' ? s * 1.6 : s, rd = type === 'bench' ? 0.6 : s;
      if (overlapsZone(x, z, rw + 1.0, rd + 1.0)) continue;
      let clash = false;
      for (const it of items) {
        if (Math.hypot(it.x - x, it.z - z) < (it.s + s) * 0.72 + 0.5) { clash = true; break; }
      }
      if (clash) continue;
      // Keep clear of partition walls (and therefore their doorways).
      for (const wl of walls) {
        const ww = wl.axis === 'x' ? wl.len : 0.4, wd = wl.axis === 'x' ? 0.4 : wl.len;
        if (Math.abs(wl.x - x) < (rw + ww) / 2 + 0.55 && Math.abs(wl.z - z) < (rd + wd) / 2 + 0.55) { clash = true; break; }
      }
      if (clash) continue;
      items.push({ type, x, z, s, shade: 0.8 + rng() * 0.3 });
      placed = true;
      break;
    }
    if (!placed) continue;
  }
  return { walls, items };
}

/** Axis-aligned rectangle extending `inward` metres from a door on `di`. */
function infoToRect(b, di, inward, half) {
  if (di.nx === 0) {
    return di.nz > 0
      ? { x0: b.x - half, x1: b.x + half, z0: b.z + b.d / 2 - inward, z1: b.z + b.d / 2 + 0.4 }
      : { x0: b.x - half, x1: b.x + half, z0: b.z - b.d / 2 - 0.4, z1: b.z - b.d / 2 + inward };
  }
  return di.nx > 0
    ? { x0: b.x + b.w / 2 - inward, x1: b.x + b.w / 2 + 0.4, z0: b.z - half, z1: b.z + half }
    : { x0: b.x - b.w / 2 - 0.4, x1: b.x - b.w / 2 + inward, z0: b.z - half, z1: b.z + half };
}

function addInteriorWalls(GB, parts, cx, y, cz, w, d, h, t, color, doorSide, doorW) {
  const hw = w / 2 - t / 2, hd = d / 2 - t / 2;
  const sides = [
    { axis: 'x', pos: hd, len: w }, // +Z
    { axis: 'x', pos: -hd, len: w }, // -Z
    { axis: 'z', pos: hw, len: d }, // +X
    { axis: 'z', pos: -hw, len: d }, // -X
  ];
  sides.forEach((s, i) => {
    if (i === doorSide) {
      // split into two segments leaving a door gap centered
      const seg = (s.len - doorW) / 2;
      const off = doorW / 2 + seg / 2;
      if (s.axis === 'x') {
        for (const sign of [-1, 1]) {
          const px = cx + sign * off;
          addBox(GB, px, y + t / 2, cz + s.pos, seg, h, t, 3, color);
          parts.colliders.push(collider(px, y, cz + s.pos, seg, h, t, 'interior'));
        }
      } else {
        for (const sign of [-1, 1]) {
          const pz = cz + sign * off;
          addBox(GB, cx + s.pos, y + t / 2, pz, t, h, seg, 3, color);
          parts.colliders.push(collider(cx + s.pos, y, pz, t, h, seg, 'interior'));
        }
      }
    } else {
      if (s.axis === 'x') {
        addBox(GB, cx, y + t / 2, cz + s.pos, w, h, t, 3, color);
        parts.colliders.push(collider(cx, y, cz + s.pos, w, h, t, 'interior'));
      } else {
        addBox(GB, cx + s.pos, y + t / 2, cz, t, h, d, 3, color);
        parts.colliders.push(collider(cx + s.pos, y, cz, t, h, d, 'interior'));
      }
    }
  });
}

/**
 * Stairwell geometry. Two parallel lanes run along the +Z wall: even floors
 * ascend +X in lane 0, odd floors ascend -X in lane 1 (a switchback). That way
 * the flight one floor up is in the *other* lane, so it never hangs directly
 * over the player's head (with a 3.6 m floor and a 1.8 m player a stacked
 * flight would leave exactly zero clearance and the climb would jam).
 */
function stairGeom(b) {
  const steps = 14;
  const margin = Math.min(1.6, b.w * 0.18);
  const run = Math.min(0.42, Math.max(0.22, (b.w - margin * 2) / steps));
  const x0 = b.x - b.w / 2 + margin;
  const x1 = x0 + steps * run;
  const sw = 1.5;          // lane width
  const gap = 0.2;         // gap between the two lanes
  const sz = b.z + b.d / 2 - 2.3;
  const laneZ0 = sz - (sw + gap) / 2;
  const laneZ1 = sz + (sw + gap) / 2;
  return { steps, run, x0, x1, sw, laneZ0, laneZ1, sz };
}

function regionFloor(GB, parts, cx, y, cz, rw, rd, tint) {
  if (rw < 0.15 || rd < 0.15) return;
  addTop(GB, cx, y, cz, rw, rd, 4, tint, false); // walking surface
  addTop(GB, cx, y, cz, rw, rd, 4, tint, true);  // ceiling of the floor below
  parts.colliders.push(collider(cx, y - 0.3, cz, rw, 0.3, rd, 'floor'));
}

/** Floor slab with a stairwell opening cut only over the lane of flight `floorIdx`. */
function addFloorWithStairwell(GB, parts, b, y, w, d, tint, floorIdx) {
  const g = stairGeom(b);
  const cx = b.x, cz = b.z;
  const hw = w / 2, hd = d / 2;
  const laneZ = (floorIdx % 2 === 0) ? g.laneZ0 : g.laneZ1;
  const holeX0 = g.x0 - 0.5, holeX1 = g.x1 + 0.5;
  const holeZ0 = laneZ - g.sw / 2 - 0.5;
  const holeZ1 = laneZ + g.sw / 2 + 0.5;
  // region 1: full width, away from the stairwell (towards -Z)
  regionFloor(GB, parts, cx, y, (cz - hd + holeZ0) / 2, w, holeZ0 - (cz - hd), tint);
  // region 2 & 3: strips beside the stairwell, towards +Z
  const backD = (cz + hd) - holeZ0;
  const backCz = (holeZ0 + cz + hd) / 2;
  regionFloor(GB, parts, (cx - hw + holeX0) / 2, y, backCz, holeX0 - (cx - hw), backD, tint);
  regionFloor(GB, parts, (holeX1 + cx + hw) / 2, y, backCz, (cx + hw) - holeX1, backD, tint);
  // region 4: solid floor over the *other* lane (between the hole and the +Z wall)
  regionFloor(GB, parts, (holeX0 + holeX1) / 2, y, (holeZ1 + cz + hd) / 2, holeX1 - holeX0, (cz + hd) - holeZ1, tint);
}

function addStaircase(rng, GB, metal, parts, b, y, floorIdx, doorSide) {
  const floorH = b.floorH;
  const g = stairGeom(b);
  const rise = floorH / g.steps;
  const lane = ((floorIdx % 2) + 2) % 2;
  const dir = lane === 0 ? 1 : -1;             // lane 0 ascends +X, lane 1 ascends -X
  const z = lane === 0 ? g.laneZ0 : g.laneZ1;
  for (let s = 0; s < g.steps; s++) {
    const px = dir > 0 ? g.x0 + (s + 0.5) * g.run : g.x1 - (s + 0.5) * g.run;
    const top = y + (s + 1) * rise;
    const h = top - y;
    addBox(metal, px, y + h / 2, z, g.run + 0.02, h, g.sw, 2, b.col.clone().multiplyScalar(0.75));
    parts.colliders.push(collider(px, y, z, g.run + 0.02, h, g.sw, 'stair'));
  }
  // handrail posts + top rails along both edges of the lane
  const railCol = b.col.clone().multiplyScalar(0.55);
  for (let s = 0; s <= g.steps; s += 3) {
    const px = dir > 0 ? g.x0 + s * g.run : g.x1 - s * g.run;
    const top = y + s * rise;
    addBox(metal, px, top + 0.5, z - g.sw / 2, 0.08, 1.0, 0.08, 1, railCol);
    addBox(metal, px, top + 0.5, z + g.sw / 2, 0.08, 1.0, 0.08, 1, railCol);
    // rail segment to the next post (kept axis-aligned for cheap geometry)
    const s2 = Math.min(g.steps, s + 3);
    if (s2 > s) {
      const p2 = dir > 0 ? g.x0 + s2 * g.run : g.x1 - s2 * g.run;
      const mid = (px + p2) / 2, len = Math.abs(p2 - px);
      addBox(metal, mid, top + 1.02, z - g.sw / 2, len, 0.05, 0.05, 1, railCol);
      addBox(metal, mid, top + 1.02, z + g.sw / 2, len, 0.05, 0.05, 1, railCol);
    }
  }
}
