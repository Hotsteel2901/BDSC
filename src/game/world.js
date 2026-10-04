import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { GeometryBuilder, addBox, addWalls, addTop, generateBuilding, buildInterior } from './buildings.js';
import { makeSignTexture, makeSkyTexture, makeHazardTexture, rngFactory } from './textures.js';

// ---------------------------------------------------------------------------
// City metrics
// ---------------------------------------------------------------------------
export const BLOCK = 54;          // block pitch (metres)
export const ROAD = 14;           // road width
export const PAD = BLOCK - ROAD;  // buildable pad half-extent reference
export const CHUNK = 4;           // blocks per chunk edge
export const CHUNK_SIZE = CHUNK * BLOCK;
export const LOAD_RADIUS = 4;     // chunks
export const UNLOAD_RADIUS = 6;

const HASH_CELL = 12;

/** Generic spatial hash for AABBs / points. */
export class SpatialHash {
  constructor(cell = HASH_CELL) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insertBox(box) {
    const c = this.cell;
    const x0 = Math.floor(box.min.x / c), x1 = Math.floor(box.max.x / c);
    const z0 = Math.floor(box.min.z / c), z1 = Math.floor(box.max.z / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(box);
      }
  }
  removeBox(box) {
    const c = this.cell;
    const x0 = Math.floor(box.min.x / c), x1 = Math.floor(box.max.x / c);
    const z0 = Math.floor(box.min.z / c), z1 = Math.floor(box.max.z / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        const arr = this.map.get(k);
        if (arr) {
          const i = arr.indexOf(box);
          if (i >= 0) arr.splice(i, 1);
          if (arr.length === 0) this.map.delete(k);
        }
      }
  }
  query(min, max, out, seen) {
    out.length = 0;
    seen = seen || new Set();
    seen.clear();
    const c = this.cell;
    const x0 = Math.floor(min.x / c), x1 = Math.floor(max.x / c);
    const z0 = Math.floor(min.z / c), z1 = Math.floor(max.z / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(this._key(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (seen.has(b)) continue;
          seen.add(b);
          out.push(b);
        }
      }
    return out;
  }
  queryPoint(x, z, out) {
    out.length = 0;
    const c = this.cell;
    const arr = this.map.get(this._key(Math.floor(x / c), Math.floor(z / c)));
    if (arr) for (const b of arr) out.push(b);
    return out;
  }
}

/** Segment vs AABB (slab). Returns t in [0,maxDist] or -1. */
export function raySegmentAABB(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = 0, tmax = Infinity, axis = -1, sign = 1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [min.x, min.y, min.z], mx = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return { t: -1 };
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv;
      let t2 = (mx[i] - o[i]) * inv;
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return { t: -1 };
    }
  }
  if (axis < 0) return { t: -1 };
  const n = [0, 0, 0]; n[axis] = sign;
  return { t: tmin, normal: n, axis };
}

function key(cx, cz) { return cx + ',' + cz; }

/**
 * World — owns the city, streams chunks around the viewer, and provides
 * collision + navigation queries.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.materials = createMaterials();
    this.chunks = new Map();
    this._loadCenter = null;
    this._loadQueue = [];
    this.colliderHash = new SpatialHash(12);
    this.lampHash = new SpatialHash(32);
    this.signGroup = new THREE.Group();
    this.propGroup = new THREE.Group();
    this.scene.add(this.signGroup);
    this.scene.add(this.propGroup);
    this.beacons = [];
    this.enterables = new Map(); // "bx,bz" -> building meta
    this._seen = new Set();
    this._buf = [];
    this._lampBuf = [];
    this.pendingSpawns = [];
    this.onChunkLoad = null;
    this.onChunkUnload = null;
    this.stats = { chunks: 0, colliders: 0, buildings: 0 };

    this._setupSky();
    this._setupLighting();
    this._setupLightPool();
    this._setupGroundFallback();
  }

  _setupSky() {
    const skyTex = makeSkyTexture(1024);
    this.scene.background = skyTex;
    this.scene.fog = new THREE.FogExp2(0x0a1620, 0.0021);
    this.skyTex = skyTex;
  }

  _setupLighting() {
    const hemi = new THREE.HemisphereLight(0x8499c8, 0x3a3028, 2.3);
    this.scene.add(hemi);
    const ambient = new THREE.AmbientLight(0x40506e, 0.95);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(0xdce6ff, 2.9);
    moon.position.set(-0.4, 1, 0.3).multiplyScalar(200);
    moon.castShadow = false;
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(0xffb070, 0.95);
    fill.position.set(0.6, 0.4, -0.7).multiplyScalar(200);
    this.scene.add(fill);
    this.hemi = hemi;
    this.ambient = ambient;
    this.moon = moon;
    this.fill = fill;
  }

  _setupLightPool() {
    // A small pool of point lights follows the player to light the nearest lamps.
    this.lightPool = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffcc88, 0, 24, 2);
      l.visible = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
  }

  _setupGroundFallback() {
    // A distant ground so the horizon is never empty between chunk loads.
    const g = new THREE.PlaneGeometry(20000, 20000);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 1 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = -0.05;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.fallbackGround = mesh;
  }

  // ---- streaming ------------------------------------------------------
  update(camPos) {
    const ccx = Math.floor(camPos.x / CHUNK_SIZE);
    const ccz = Math.floor(camPos.z / CHUNK_SIZE);
    const center = key(ccx, ccz);
    if (center !== this._loadCenter) {
      this._loadCenter = center;
      for (const [k, ch] of this.chunks) {
        if (Math.abs(ch.cx - ccx) > UNLOAD_RADIUS || Math.abs(ch.cz - ccz) > UNLOAD_RADIUS) {
          this._unloadChunk(k, ch);
        }
      }
      this._loadQueue = [];
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
          const cx = ccx + dx, cz = ccz + dz;
          if (!this.chunks.has(key(cx, cz))) this._loadQueue.push({ cx, cz, dist: dx * dx + dz * dz });
        }
      }
      this._loadQueue.sort((a, b) => a.dist - b.dist || a.cx - b.cx || a.cz - b.cz);
    }
    for (let i = 0; i < 3 && this._loadQueue.length; i++) {
      const { cx, cz } = this._loadQueue.shift();
      if (!this.chunks.has(key(cx, cz))) this._loadChunk(cx, cz);
    }
    this._updateLightPool(camPos);
    this._updateBeacons(camPos);
  }

  _loadChunk(cx, cz) {
    const parts = {
      byMat: {},
      colliders: [],
      props: [],
      signs: [],
      lamps: [],
      enterables: [],
      facadeCount: this.materials.facades.length,
    };
    const rng = rngFactory(((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9) >>> 0);

    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    // ground for the chunk
    const street = this._builder(parts, 'street');
    addTop(street, baseX + CHUNK_SIZE / 2, 0, baseZ + CHUNK_SIZE / 2, CHUNK_SIZE, CHUNK_SIZE, 27, new THREE.Color(1, 1, 1));

    let buildings = 0;
    for (let bx = 0; bx < CHUNK; bx++) {
      for (let bz = 0; bz < CHUNK; bz++) {
        const gx = cx * CHUNK + bx;
        const gz = cz * CHUNK + bz;
        buildings += this._buildBlock(parts, rng, gx, gz, baseX + bx * BLOCK + BLOCK / 2, baseZ + bz * BLOCK + BLOCK / 2);
      }
    }

    // Build interiors for enterable buildings found in this chunk
    const enterableKeys = [];
    for (const b of parts.enterables) {
      const meta = this._enterMeta(b, rng);
      buildInterior(rng, parts, meta);
      const entryKey = meta.bx + ',' + meta.bz;
      this.enterables.set(entryKey, meta);
      enterableKeys.push(entryKey);
    }

    // merge per-material into meshes
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const mats = this.materials;
    for (const k in parts.byMat) {
      const gb = parts.byMat[k];
      if (gb.isEmpty()) continue;
      const geo = gb.toGeometry();
      let mat;
      if (k.startsWith('facade')) mat = mats.facades[parseInt(k.slice(6), 10) % mats.facades.length];
      else mat = mats[k] || mats.concrete;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }

    // colliders
    for (const c of parts.colliders) {
      this.colliderHash.insertBox(c);
    }

    // lamp positions
    const lampBoxes = [];
    for (const l of parts.lamps) {
      const box = { min: new THREE.Vector3(l.x, l.y, l.z), max: new THREE.Vector3(l.x, l.y, l.z), lamp: true, color: l.color, intensity: l.intensity, range: l.range };
      this.lampHash.insertBox(box);
      lampBoxes.push(box);
    }

    // signs (individual meshes with textures)
    const signs = [];
    for (const s of parts.signs) {
      const tex = makeSignTexture(pickSignText(s.seed), 512, 128, pickSignColor(s.seed), s.seed);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.ry;
      mesh.userData.sign = true;
      mesh.userData.flicker = 0.4 + rng();
      this.signGroup.add(mesh);
      signs.push(mesh);
    }

    // beacons (blinking lights)
    const beacons = [];
    for (const p of parts.props) {
      if (p.type === 'beacon') {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), new THREE.MeshBasicMaterial({ color: p.color, toneMapped: false }));
        m.position.set(p.x, p.y, p.z);
        m.userData.phase = rng() * Math.PI * 2;
        this.propGroup.add(m);
        this.beacons.push(m);
        beacons.push(m);
      } else if (p.type === 'light') {
        // interior lights are baked as emissive geometry; add a static point light
        // only for a subset to keep the light count sane (handled by pool).
      }
    }

    const ch = { cx, cz, group, colliders: parts.colliders, lampBoxes, signs, beacons, enterableKeys, buildings };
    this.chunks.set(key(cx, cz), ch);
    this.scene.add(group);
    this.stats.chunks = this.chunks.size;
    this.stats.buildings += buildings;
    this.stats.colliders = this.colliderHash.map.size;
    if (this.onChunkLoad) this.onChunkLoad(cx, cz);
  }

  _builder(parts, k) {
    if (!parts.byMat[k]) parts.byMat[k] = new GeometryBuilder();
    return parts.byMat[k];
  }

  _unloadChunk(k, ch) {
    if (this.onChunkUnload) this.onChunkUnload(ch.cx, ch.cz);
    this.scene.remove(ch.group);
    ch.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const c of ch.colliders) this.colliderHash.removeBox(c);
    for (const box of ch.lampBoxes) this.lampHash.removeBox(box);
    for (const s of ch.signs) {
      s.geometry.dispose();
      if (s.material.map) s.material.map.dispose();
      s.material.dispose();
      this.signGroup.remove(s);
    }
    for (const b of ch.beacons) {
      this.propGroup.remove(b);
      b.geometry.dispose();
      b.material.dispose();
      this.beacons.splice(this.beacons.indexOf(b), 1);
    }
    for (const entryKey of ch.enterableKeys) this.enterables.delete(entryKey);
    this.chunks.delete(k);
    this.stats.chunks = this.chunks.size;
    this.stats.buildings -= ch.buildings;
    this.stats.colliders = this.colliderHash.map.size;
  }

  _enterMeta(b, rng) {
    // derive block coords for the building centre
    const bx = Math.round(b.x / BLOCK);
    const bz = Math.round(b.z / BLOCK);
    return {
      ...b,
      bx, bz,
      col: b.col.clone(),
      floorH: b.floorH,
      doorSide: b.doorSide ?? Math.floor(rng() * 4),
    };
  }

  _buildBlock(parts, rng, gx, gz, cx, cz) {
    const street = this._builder(parts, 'street');
    const walk = this._builder(parts, 'sidewalk');
    const concrete = this._builder(parts, 'concrete');
    const metal = this._builder(parts, 'metal');

    // sidewalk pad (raised) — leaves the road ring around it
    const pad = PAD;
    const walkCol = new THREE.Color(0.9, 0.9, 0.92);
    addTop(walk, cx, 0.18, cz, pad, pad, 8, walkCol);
    // sidewalk edges (kerb)
    const kh = 0.18;
    addWalls(walk, cx, 0, cz + pad / 2 - 0.2, pad, kh, 0.4, 6, 1, walkCol);
    addWalls(walk, cx, 0, cz - pad / 2 + 0.2, pad, kh, 0.4, 6, 1, walkCol);
    addWalls(walk, cx + pad / 2 - 0.2, 0, cz, 0.4, kh, pad, 6, 1, walkCol);
    addWalls(walk, cx - pad / 2 + 0.2, 0, cz, 0.4, kh, pad, 6, 1, walkCol);
    // kerb collider (low)
    parts.colliders.push(boxCollider(cx, 0, cz, pad, kh, pad, 'sidewalk'));

    // district type
    const districtRnd = rng();
    let buildings = 0;

    if (districtRnd < 0.08) {
      // plaza / park
      this._buildPlaza(parts, rng, cx, cz, pad);
    } else {
      // subdivide the pad into lots
      const layout = rng();
      const lots = [];
      if (layout < 0.34) {
        lots.push({ x: cx, z: cz, w: pad, d: pad });
      } else if (layout < 0.6) {
        const w = pad * (0.45 + rng() * 0.1);
        lots.push({ x: cx - (pad - w) / 2, z: cz, w, d: pad });
        lots.push({ x: cx + (pad - w) / 2, z: cz, w, d: pad });
      } else if (layout < 0.8) {
        const d = pad * (0.45 + rng() * 0.1);
        lots.push({ x: cx, z: cz - (pad - d) / 2, w: pad, d });
        lots.push({ x: cx, z: cz + (pad - d) / 2, w: pad, d });
      } else {
        const w = pad * 0.47, d = pad * 0.47;
        lots.push({ x: cx - pad * 0.26, z: cz - pad * 0.26, w, d });
        lots.push({ x: cx + pad * 0.26, z: cz - pad * 0.26, w, d });
        lots.push({ x: cx - pad * 0.26, z: cz + pad * 0.26, w, d });
        lots.push({ x: cx + pad * 0.26, z: cz + pad * 0.26, w, d });
      }

      // urban density: taller toward city centre
      const distCentre = Math.hypot(cx, cz) / (BLOCK * 8);
      const tallBias = Math.max(0, 1 - Math.min(1, distCentre));
      const maxFloors = Math.round(4 + tallBias * 46 + rng() * 12);
      const minFloors = 2 + Math.floor(rng() * 3);
      if (parts.wantEnterable === undefined) parts.wantEnterable = rng() < 0.2;

      for (const lot of lots) {
        const meta = generateBuilding(rng, parts, {
          x: lot.x, z: lot.z,
          maxW: lot.w * 0.94, maxD: lot.d * 0.94,
          minFloors, maxFloors,
          allowEnter: parts.wantEnterable,
          forceEnter: false,
        });
        buildings++;
      }
    }

    // ---- street props around the block ----
    this._addStreetProps(parts, rng, cx, cz, pad, street, concrete, metal);
    return buildings;
  }

  _buildPlaza(parts, rng, cx, cz, pad) {
    const concrete = this._builder(parts, 'concrete');
    const metal = this._builder(parts, 'metal');
    const walk = this._builder(parts, 'sidewalk');
    // central fountain / monument
    const r = 2 + rng() * 2;
    addBox(concrete, cx, 0.18, cz, r * 2, 0.8, r * 2, 3, new THREE.Color(0.8, 0.82, 0.85));
    parts.colliders.push(boxCollider(cx, 0.18, cz, r * 2, 0.8, r * 2, 'prop'));
    // benches
    for (let i = 0; i < 4 + Math.floor(rng() * 6); i++) {
      const bx = cx + (rng() - 0.5) * (pad - 4);
      const bz = cz + (rng() - 0.5) * (pad - 4);
      addBox(concrete, bx, 0.18, bz, 1.8, 0.5, 0.6, 2, new THREE.Color(0.7, 0.6, 0.5));
      parts.colliders.push(boxCollider(bx, 0.18, bz, 1.8, 0.5, 0.6, 'prop'));
    }
    // trees (low-poly: trunk + foliage box)
    for (let i = 0; i < 3 + Math.floor(rng() * 5); i++) {
      const tx = cx + (rng() - 0.5) * (pad - 4);
      const tz = cz + (rng() - 0.5) * (pad - 4);
      addBox(metal, tx, 0.18, tz, 0.5, 3, 0.5, 1, new THREE.Color(0.4, 0.3, 0.2));
      addBox(parts.byMat['concrete'] || (parts.byMat['concrete'] = new GeometryBuilder()), tx, 3, tz, 2.4, 2.2, 2.4, 2, new THREE.Color(0.2, 0.5, 0.25));
      parts.colliders.push(boxCollider(tx, 0.18, tz, 0.6, 6, 0.6, 'prop'));
    }
    parts.colliders.push(boxCollider(cx, 0, cz, pad, 0.18, pad, 'sidewalk'));
  }

  _addStreetProps(parts, rng, cx, cz, pad, street, concrete, metal) {
    // lamps at block corners
    const corners = [
      [cx - pad / 2 + 1.2, cz - pad / 2 + 1.2],
      [cx + pad / 2 - 1.2, cz - pad / 2 + 1.2],
      [cx - pad / 2 + 1.2, cz + pad / 2 - 1.2],
      [cx + pad / 2 - 1.2, cz + pad / 2 - 1.2],
    ];
    const lampCol = new THREE.Color(0.85, 0.88, 0.92);
    for (const [lx, lz] of corners) {
      if (rng() < 0.15) continue;
      this._addLamp(parts, lx, lz, lampCol);
    }
    // mid-edge lamps on long blocks
    if (rng() < 0.6) this._addLamp(parts, cx, cz - pad / 2 + 1.2, lampCol);
    if (rng() < 0.6) this._addLamp(parts, cx, cz + pad / 2 - 1.2, lampCol);

    // traffic signal at one corner (emissive boxes)
    if (rng() < 0.5) {
      const tx = cx + pad / 2 - 1.2, tz = cz - pad / 2 + 1.2;
      addBox(metal, tx, 0.18, tz, 0.3, 4.5, 0.3, 1, lampCol);
      addBox(metal, tx, 4.4, tz, 0.3, 0.9, 0.3, 1, lampCol);
      parts.props.push({ type: 'beacon', x: tx, y: 4.9, z: tz, color: 0xffcc00 });
    }

    // trash bins / hydrants / barriers
    for (let i = 0; i < 2 + Math.floor(rng() * 4); i++) {
      const px = cx + (rng() - 0.5) * (pad - 2);
      const pz = cz + (rng() - 0.5) * (pad - 2);
      if (rng() < 0.5) {
        addBox(concrete, px, 0.18, pz, 0.7, 1.1, 0.7, 1, new THREE.Color(0.35, 0.38, 0.4));
        parts.colliders.push(boxCollider(px, 0.18, pz, 0.7, 1.1, 0.7, 'prop'));
      } else {
        addBox(this._builder(parts, 'hazard'), px, 0.18, pz, 1.6, 0.9, 0.4, 1, new THREE.Color(1, 1, 1));
        parts.colliders.push(boxCollider(px, 0.18, pz, 1.6, 0.9, 0.4, 'prop'));
      }
    }

    // parked cars (simple low-poly) along the kerb
    if (rng() < 0.5) {
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const side = Math.floor(rng() * 4);
        const t = (rng() - 0.5) * (pad - 4);
        let px, pz, carW, carD;
        if (side === 0) { px = cx + t; pz = cz + pad / 2 - 0.9; carW = 4.2; carD = 2.0; }
        else if (side === 1) { px = cx + t; pz = cz - pad / 2 + 0.9; carW = 4.2; carD = 2.0; }
        else if (side === 2) { px = cx + pad / 2 - 0.9; pz = cz + t; carW = 2.0; carD = 4.2; }
        else { px = cx - pad / 2 + 0.9; pz = cz + t; carW = 2.0; carD = 4.2; }
        const col = new THREE.Color().setHSL(rng(), 0.5, 0.35 + rng() * 0.2);
        addBox(this._builder(parts, 'concrete'), px, 0.3, pz, carW, 0.9, carD, 2, col);
        addBox(this._builder(parts, 'windowPane'), px, 1.15, pz, carW * 0.7, 0.6, carD * 0.75, 1, new THREE.Color(0.2, 0.3, 0.4));
        parts.colliders.push(boxCollider(px, 0.3, pz, carW, 1.4, carD, 'prop'));
      }
    }

    // ground clutter: puddles (dark decals), debris
  }

  _addLamp(parts, x, z, col) {
    const metal = this._builder(parts, 'metal');
    const lampMat = this._builder(parts, 'lampEmissive');
    const baseY = 0.18;
    // pole
    addBox(metal, x, baseY, z, 0.28, 7, 0.28, 1, col.clone().multiplyScalar(0.6));
    // arm
    addBox(metal, x + 0.9, baseY + 7, z, 2.0, 0.2, 0.2, 1, col.clone().multiplyScalar(0.6));
    // head (emissive)
    addBox(lampMat, x + 1.8, baseY + 6.85, z, 0.8, 0.35, 0.5, 1, new THREE.Color(1, 1, 0.85));
    parts.colliders.push(boxCollider(x, baseY, z, 0.5, 7, 0.5, 'lamp'));
    parts.lamps.push({ x: x + 1.8, y: baseY + 6.6, z, color: 0xffcc88, intensity: 16, range: 26 });
  }

  _updateLightPool(camPos) {
    this.lampHash.query(
      new THREE.Vector3(camPos.x - 40, 0, camPos.z - 40),
      new THREE.Vector3(camPos.x + 40, 0, camPos.z + 40),
      this._lampBuf, this._seen
    );
    const lamps = this._lampBuf;
    lamps.sort((a, b) => {
      const da = (a.min.x - camPos.x) ** 2 + (a.min.z - camPos.z) ** 2;
      const db = (b.min.x - camPos.x) ** 2 + (b.min.z - camPos.z) ** 2;
      return da - db;
    });
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const lamp = lamps[i];
      if (lamp) {
        l.visible = true;
        l.position.set(lamp.min.x, lamp.min.y, lamp.min.z);
        l.color.setHex(lamp.color || 0xffcc88);
        l.intensity = (lamp.intensity ?? 2.2) * 0.9;
        l.distance = lamp.range ?? 22;
      } else {
        l.visible = false;
      }
    }
  }

  _updateBeacons(camPos) {
    const t = performance.now() * 0.001;
    for (const b of this.beacons) {
      const dx = b.position.x - camPos.x, dz = b.position.z - camPos.z;
      if (dx * dx + dz * dz > 90 * 90) { b.visible = false; continue; }
      b.visible = true;
      const s = 0.6 + 0.4 * Math.sin(t * 3 + b.userData.phase);
      b.material.opacity = s;
      b.material.transparent = true;
      b.scale.setScalar(0.7 + 0.6 * s);
    }
  }

  // ---- queries --------------------------------------------------------
  queryColliders(min, max) {
    return this.colliderHash.query(min, max, this._buf, this._seen);
  }

  /**
   * Ray vs world. dir must be normalised. Returns nearest hit.
   * filterTag(box) -> bool (true = ignore)
   */
  raycast(origin, dir, maxDist = 300, ignore = null) {
    // gather candidate colliders along the ray
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, maxDist);
    const min = new THREE.Vector3(Math.min(origin.x, end.x) - 1, Math.min(origin.y, end.y) - 1, Math.min(origin.z, end.z) - 1);
    const max = new THREE.Vector3(Math.max(origin.x, end.x) + 1, Math.max(origin.y, end.y) + 1, Math.max(origin.z, end.z) + 1);
    const list = this.colliderHash.query(min, max, [], new Set());
    let best = { t: Infinity, box: null, normal: null };
    for (const b of list) {
      if (ignore && ignore(b)) continue;
      const r = raySegmentAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b.min, b.max);
      if (r.t >= 0 && r.t <= maxDist && r.t < best.t) { best = { t: r.t, box: b, normal: r.normal }; }
    }
    if (best.t === Infinity) return null;
    best.point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.t);
    best.distance = best.t;
    return best;
  }

  /** Is a point inside a solid collider's footprint at the given y? */
  pointBlocked(x, y, z, pad = 0) {
    const list = this.colliderHash.query(
      new THREE.Vector3(x - 0.1, y - 0.1, z - 0.1),
      new THREE.Vector3(x + 0.1, y + 0.1, z + 0.1),
      this._buf, this._seen
    );
    for (const b of list) {
      if (x >= b.min.x - pad && x <= b.max.x + pad && z >= b.min.z - pad && z <= b.max.z + pad && y >= b.min.y - pad && y <= b.max.y + pad) return b;
    }
    return null;
  }

  isWalkable(x, z) {
    const bcx = Math.round(x / BLOCK) * BLOCK;
    const bcz = Math.round(z / BLOCK) * BLOCK;
    const dx = x - bcx, dz = z - bcz;
    const half = PAD / 2 - 0.5;
    if (Math.abs(dx) < half && Math.abs(dz) < half) return false; // inside building pad
    return true;
  }

  groundHeight(x, z) {
    // sidewalk pads are raised; approximate
    const bcx = Math.round(x / BLOCK) * BLOCK;
    const bcz = Math.round(z / BLOCK) * BLOCK;
    const dx = x - bcx, dz = z - bcz;
    const half = PAD / 2;
    if (Math.abs(dx) < half && Math.abs(dz) < half) return 0.18;
    return 0;
  }

  /**
   * Find a street spawn position near (x,z): snaps to the nearest walkable
   * road cell and returns a y just above ground.
   */
  findStreetSpawn(x, z) {
    if (this.isWalkable(x, z)) return new THREE.Vector3(x, this.groundHeight(x, z) + 0.1, z);
    // spiral outward to find road
    for (let r = 1; r < 30; r += 1) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r * 3;
        const nz = z + Math.sin(ang) * r * 3;
        if (this.isWalkable(nx, nz)) return new THREE.Vector3(nx, this.groundHeight(nx, nz) + 0.1, nz);
      }
    }
    return new THREE.Vector3(x, 0.2, z);
  }

  /** Random street position within radius chunks of the player. */
  randomStreetNear(cx, cz, minR, maxR) {
    const ang = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    return this.findStreetSpawn(x, z);
  }

  hasChunkAt(x, z) {
    return this.chunks.has(key(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  }
}

// helpers ------------------------------------------------------------------
function boxCollider(cx, y0, cz, w, h, d, tag) {
  return {
    min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
    tag,
  };
}

const SIGN_WORDS = ['BDSC', 'NEO-TOKYO', 'GRID', 'NULLSEC', 'AXIOM', 'HOLLOW', 'CIRCUIT', 'RAIN', 'SECTOR-7', 'TERMINAL', 'NO ENTRY', '24/7', 'RAMEN', 'PLASMA', 'VOID'];
const SIGN_COLORS = ['#37ff8b', '#ff4d9e', '#4de0ff', '#ffb000', '#ff5555'];
function pickSignText(seed) { return SIGN_WORDS[Math.abs(seed) % SIGN_WORDS.length]; }
function pickSignColor(seed) { return SIGN_COLORS[Math.abs((seed >> 3)) % SIGN_COLORS.length]; }
