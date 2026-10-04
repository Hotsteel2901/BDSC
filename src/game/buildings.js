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
  const enterable = forceEnter || (allowEnter && floors >= 2 && floors <= 44 && rng() < 0.15);
  const doorSide = Math.floor(rng() * 4); // 0:+Z 1:-Z 2:+X 3:-X

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

  // ---- shell ----
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (enterable && si === 0) {
      addWallsWithDoor(wallWin, seg.x, seg.y, seg.z, seg.w, seg.h, seg.d, 5.0, floorH, col, doorSide, 2.2, seg.floors);
    } else {
      addWalls(wallWin, seg.x, seg.y, seg.z, seg.w, seg.h, seg.d, 5.0, floorH, col);
    }
    addTop(roofGB, seg.x, seg.y + seg.h, seg.z, seg.w, seg.d, 6, col);
  }

  // ground-floor solid collider for non-enterable OR upper mass collider for enterable
  if (!enterable) {
    parts.colliders.push(collider(x, 0, z, w, height, d, 'building'));
  } else {
    // enterable: solid mass for everything above the ground floor(s) we detail,
    // thin walls + floors for the detailed portion so the shell is preserved.
    const detailFloors = Math.min(segments[0].floors, 12);
    const detailH = detailFloors * floorH;
    // upper solid mass
    if (height > detailH) {
      parts.colliders.push(collider(x, detailH, z, w, height - detailH, d, 'building'));
    }
    parts.enterables = parts.enterables || [];
    parts.enterables.push({ x, z, w, d, detailFloors, floorH, seg: segments[0], col: col.clone(), doorSide });
  }

  // ---- rooftop details ----
  const topSeg = segments[segments.length - 1];
  const topY = topSeg.y + topSeg.h;
  addRooftop(rng, parts, topSeg.x, topY, topSeg.z, topSeg.w, topSeg.d, col, key, roofGB);

  return {
    x, z, w, d, height, floors, enterable, segments, col, doorSide, floorH,
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

  const floorH = b.floorH;
  const w = b.w, d = b.d;
  const hw = w / 2, hd = d / 2;
  const wallT = 0.4;
  const tint = b.col.clone().multiplyScalar(1.35).offsetHSL(0, -0.05, 0.06);

  // Which side has the street door (facing -Z by convention / toward nearest street)
  const doorSide = b.doorSide ?? 0; // 0:+Z 1:-Z 2:+X 3:-X
  const doorW = 2.2;

  for (let f = 0; f < b.detailFloors; f++) {
    const y = f * floorH;
    // perimeter walls (thin) with a doorway on the ground floor
    addInteriorWalls(wallGB, parts, b.x, y, b.z, w, d, floorH, wallT, tint, f === 0 ? doorSide : -1, doorW);

    // partition walls: a small maze
    const layout = interiorLayout(rng, w, d);
    for (const wall of layout.walls) {
      const isX = wall.axis === 'x';
      const ww = isX ? wall.len : wallT;
      const wd = isX ? wallT : wall.len;
      const wx = b.x + wall.x;
      const wz = b.z + wall.z;
      addBox(wallGB, wx, y + wallT / 2, wz, ww, floorH - wallT, wd, 3, tint);
      parts.colliders.push(collider(wx, y, wz, ww, floorH, wd, 'interior'));
    }
    // furniture: crates, desks, server racks
    for (const item of layout.items) {
      const ix = b.x + item.x, iz = b.z + item.z;
      if (item.type === 'crate') {
        addBox(concrete, ix, y + 0.5, iz, item.s, item.s, item.s, 2, tint.clone().multiplyScalar(0.9));
        parts.colliders.push(collider(ix, y, iz, item.s, item.s, item.s, 'prop'));
      } else if (item.type === 'desk') {
        addBox(metal, ix, y + 0.4, iz, item.s, 0.8, item.s * 0.6, 2, tint.clone().multiplyScalar(0.8));
        parts.colliders.push(collider(ix, y, iz, item.s, 0.8, item.s * 0.6, 'prop'));
      } else if (item.type === 'rack') {
        addBox(metal, ix, y + 1.1, iz, 0.8, 2.2, item.s, 2, tint.clone().multiplyScalar(0.6));
        parts.colliders.push(collider(ix, y, iz, 0.8, 2.2, item.s, 'prop'));
      }
    }
    // ceiling light panels (visible emissive + point lights in the pool)
    parts.lamps = parts.lamps || [];
    const quads = [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];
    for (const [qx, qz] of quads) {
      const lx = b.x + qx * w, lz = b.z + qz * d;
      addBox(key('lampEmissive'), lx, y + floorH - 0.12, lz, 1.2, 0.14, 0.45, 1, new THREE.Color(1, 1, 0.92));
      parts.lamps.push({ x: lx, y: y + floorH - 0.35, z: lz, color: 0xdce8ff, intensity: 22.0, range: Math.max(w, d) * 1.35 });
    }

    // floor slab for the next level, with a stairwell opening + the staircase
    if (f < b.detailFloors - 1) {
      addFloorWithStairwell(floorGB, parts, b, y + floorH, w, d, tint);
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

function interiorLayout(rng, w, d) {
  const walls = [];
  const items = [];
  const roomW = w - 1.6, roomD = d - 1.6;
  // 1-3 internal partitions
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    if (rng() < 0.5) {
      const len = roomW * (0.3 + rng() * 0.5);
      const xoff = (rng() - 0.5) * (roomW - len * 0.5);
      walls.push({ axis: 'x', x: xoff, z: (rng() - 0.5) * roomD * 0.7, len });
    } else {
      const len = roomD * (0.3 + rng() * 0.5);
      walls.push({ axis: 'z', z: (rng() - 0.5) * (roomD - len * 0.5), x: (rng() - 0.5) * roomW * 0.7, len });
    }
  }
  // furniture
  const m = Math.floor(rng() * 4);
  for (let i = 0; i < m; i++) {
    const t = rng();
    const type = t < 0.4 ? 'crate' : t < 0.75 ? 'desk' : 'rack';
    items.push({
      type,
      x: (rng() - 0.5) * (w - 3),
      z: (rng() - 0.5) * (d - 3),
      s: 0.8 + rng() * 0.9,
    });
  }
  return { walls, items };
}

function stairGeom(b) {
  const steps = 14;
  const run = Math.min(0.42, Math.max(0.22, (b.w - 2.8) / steps));
  const x0 = b.x - b.w / 2 + 1.0;
  const x1 = x0 + steps * run;
  const sz = b.z + b.d / 2 - 0.9;
  const sw = 1.6;
  return { steps, run, x0, x1, sz, sw, z0: sz - sw / 2, z1: sz + sw / 2 };
}

function regionFloor(GB, parts, cx, y, cz, rw, rd, tint) {
  if (rw < 0.15 || rd < 0.15) return;
  addTop(GB, cx, y, cz, rw, rd, 4, tint, false); // walking surface
  addTop(GB, cx, y, cz, rw, rd, 4, tint, true);  // ceiling of the floor below
  parts.colliders.push(collider(cx, y - 0.3, cz, rw, 0.3, rd, 'floor'));
}

function addFloorWithStairwell(GB, parts, b, y, w, d, tint) {
  const g = stairGeom(b);
  const cx = b.x, cz = b.z;
  const hw = w / 2, hd = d / 2;
  const holeX0 = g.x0 - 0.5, holeX1 = g.x1 + 0.5;
  const holeZ0 = g.z0 - 0.5;
  // region 1: full width, away from the stairwell (towards -Z)
  const r1d = (holeZ0) - (cz - hd);
  regionFloor(GB, parts, cx, y, (cz - hd + holeZ0) / 2, w, r1d, tint);
  // region 2 & 3: strips beside the stairwell, towards +Z
  const backD = (cz + hd) - holeZ0;
  const backCz = (holeZ0 + cz + hd) / 2;
  const r2w = (holeX0) - (cx - hw);
  regionFloor(GB, parts, (cx - hw + holeX0) / 2, y, backCz, r2w, backD, tint);
  const r3w = (cx + hw) - (holeX1);
  regionFloor(GB, parts, (holeX1 + cx + hw) / 2, y, backCz, r3w, backD, tint);
}

function addStaircase(rng, GB, metal, parts, b, y, floorIdx, doorSide) {
  const floorH = b.floorH;
  const g = stairGeom(b);
  const rise = floorH / g.steps;
  // step geometry + colliders
  for (let s = 0; s < g.steps; s++) {
    const px = g.x0 + (s + 0.5) * g.run;
    const top = y + (s + 1) * rise;
    // visual box from y to top
    const h = top - y;
    addBox(metal, px, y + h / 2, g.sz, g.run + 0.02, h, g.sw, 2, b.col.clone().multiplyScalar(0.75));
    parts.colliders.push(collider(px, y, g.sz, g.run + 0.02, h, g.sw, 'stair'));
  }
  // handrail posts
  for (let s = 0; s <= g.steps; s += 3) {
    const px = g.x0 + s * g.run;
    const top = y + (s) * rise;
    addBox(metal, px, top + 0.5, g.sz - g.sw / 2, 0.08, 1.0, 0.08, 1, b.col.clone().multiplyScalar(0.5));
  }
}
