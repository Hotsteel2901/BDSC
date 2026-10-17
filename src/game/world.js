import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { GeometryBuilder, addBox, addWalls, addTop, generateBuilding, buildInterior } from './buildings.js';
import { makeSignAtlas, makeSkyTexture, rngFactory } from './textures.js';

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
    // Every sign in the city shares one atlas + material; each chunk batches
    // its signs into a single mesh (one draw call instead of dozens).
    this.signAtlas = makeSignAtlas();
    this.signMaterial = new THREE.MeshBasicMaterial({
      map: this.signAtlas.texture, transparent: true, toneMapped: false,
    });
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
    this.onInteriorVisible = null;
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
    const hemi = new THREE.HemisphereLight(0x8499c8, 0x3a3028, 2.5);
    this.scene.add(hemi);
    const ambient = new THREE.AmbientLight(0x40506e, 1.15);
    this.scene.add(ambient);
    const moon = new THREE.DirectionalLight(0xdce6ff, 2.9);
    moon.position.set(-0.4, 1, 0.3).multiplyScalar(200);
    moon.castShadow = false;
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(0xffb070, 1.1);
    fill.position.set(0.6, 0.4, -0.7).multiplyScalar(200);
    this.scene.add(fill);
    this.hemi = hemi;
    this.ambient = ambient;
    this.moon = moon;
    this.fill = fill;
  }

  _setupLightPool() {
    // A small pool of point lights follows the player to light the nearest lamps.
    // They stay `visible` permanently and fade to zero intensity when unused:
    // toggling a light's visibility changes the scene's visible-light count,
    // which makes three.js recompile every lit material (frame hitches).
    this.lightPool = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffcc88, 0, 24, 2);
      l.visible = true;
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
    this._updateInteriorVisibility(camPos);
  }

  /** Show only the interiors whose building is close enough to matter. */
  _updateInteriorVisibility(camPos) {
    for (const ch of this.chunks.values()) if (ch.interiorGroup) ch.interiorGroup.visible = false;
    for (const b of this.enterables.values()) {
      const dx = b.x - camPos.x, dz = b.z - camPos.z;
      if (dx * dx + dz * dz < 85 * 85) {
        const ch = this.chunks.get(b.chunkKey);
        if (ch && ch.interiorGroup) ch.interiorGroup.visible = true;
        if (this.onInteriorVisible) this.onInteriorVisible(b);
      }
    }
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
      // Guarantee at least one enterable interior in every streamed chunk so
      // the interior content is discoverable instead of statistically rare.
      forceEnterOnce: true,
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

    // Build interiors for enterable buildings found in this chunk. They live in
    // a separate mesh group that is only shown when the player is near one of
    // its doors: an interior is never visible from the street, so rendering it
    // with every loaded chunk is pure waste.
    const enterableKeys = [];
    const intParts = { byMat: {}, colliders: [], props: [], signs: [], lamps: [] };
    // Cap detailed interiors per chunk; four is already a lot of explorable
    // floor space and keeps chunk generation / memory bounded.
    for (const b of parts.enterables) {
      const meta = this._enterMeta(b, rng);
      meta.cx = cx; meta.cz = cz; meta.chunkKey = key(cx, cz);
      buildInterior(rng, intParts, meta);
      const entryKey = meta.bx + ',' + meta.bz;
      this.enterables.set(entryKey, meta);
      enterableKeys.push(entryKey);
    }

    // merge per-material into meshes
    const mats = this.materials;
    const merge = (src, group) => {
      for (const k in src.byMat) {
        const gb = src.byMat[k];
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
    };
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    merge(parts, group);
    const interiorGroup = new THREE.Group();
    interiorGroup.matrixAutoUpdate = false;
    interiorGroup.visible = false;
    merge(intParts, interiorGroup);

    // colliders (interiors always collide, even while hidden)
    const allColliders = parts.colliders.concat(intParts.colliders);
    for (const c of allColliders) {
      this.colliderHash.insertBox(c);
    }

    // lamp positions (street + interior)
    const allLamps = (parts.lamps || []).concat(intParts.lamps || []);
    const lampBoxes = [];
    for (const l of allLamps) {
      const box = { min: new THREE.Vector3(l.x, l.y, l.z), max: new THREE.Vector3(l.x, l.y, l.z), lamp: true, color: l.color, intensity: l.intensity, range: l.range };
      this.lampHash.insertBox(box);
      lampBoxes.push(box);
    }

    // signs — batched into one atlas-mapped mesh per chunk
    const signs = [];
    if (parts.signs.length) {
      const pos = [], uv = [], idx = [];
      let base = 0;
      for (const s of parts.signs) {
        const [u0, v0, u1, v1] = this.signAtlas.uvFor(s.seed);
        const cos = Math.cos(s.ry), sin = Math.sin(s.ry);
        const hw = s.w / 2, hh = s.h / 2;
        const corners = [[-hw, -hh, u0, v0], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1]];
        for (const [lx, ly, u, v] of corners) {
          pos.push(s.x + lx * cos, s.y + ly, s.z - lx * sin);
          uv.push(u, v);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.signMaterial);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.signBatch = true;
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

    const ch = {
      cx, cz, group, interiorGroup, colliders: allColliders, lampBoxes, signs, beacons,
      enterableKeys, buildings,
    };
    this.chunks.set(key(cx, cz), ch);
    this.scene.add(group);
    this.scene.add(interiorGroup);
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
    if (ch.interiorGroup) {
      this.scene.remove(ch.interiorGroup);
      ch.interiorGroup.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    for (const c of ch.colliders) this.colliderHash.removeBox(c);
    for (const box of ch.lampBoxes) this.lampHash.removeBox(box);
    for (const s of ch.signs) {
      s.geometry.dispose();
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

    // Glowing curb strips: they outline every block in the ASCII pass, so the
    // street network reads instantly instead of dissolving into dark glyphs.
    const curbKey = rng() < 0.5 ? 'neonCyan' : (rng() < 0.5 ? 'neonAmber' : 'neonPink');
    const curb = this._builder(parts, curbKey);
    const ey = 0.195;
    addBox(curb, cx, ey, cz + pad / 2 - 0.28, pad - 0.9, 0.035, 0.07, 1, new THREE.Color(1, 1, 1));
    addBox(curb, cx, ey, cz - pad / 2 + 0.28, pad - 0.9, 0.035, 0.07, 1, new THREE.Color(1, 1, 1));
    addBox(curb, cx + pad / 2 - 0.28, ey, cz, 0.07, 0.035, pad - 0.9, 1, new THREE.Color(1, 1, 1));
    addBox(curb, cx - pad / 2 + 0.28, ey, cz, 0.07, 0.035, pad - 0.9, 1, new THREE.Color(1, 1, 1));

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
      if (parts.wantEnterable === undefined) parts.wantEnterable = rng() < 0.62;

      const buildingMetas = [];
      let forced = false;
      for (const lot of lots) {
        const dx = lot.x - cx, dz = lot.z - cz;
        // Face the door outward, away from the neighbouring lot, so entrances
        // are reachable from the street instead of opening into another block.
        const doorSide = (Math.abs(dx) > Math.abs(dz))
          ? (dx < 0 ? 3 : 2)
          : (Math.abs(dz) > 0.001 ? (dz < 0 ? 1 : 0) : Math.floor(rng() * 4));
        // Decide enterability *before* generating the shell. If we only capped
        // the interiors after the fact, a building could keep its cut doorway
        // with no walls/floors inside (an empty, non-colliding shell).
        const canEnter = (parts.enterables ? parts.enterables.length : 0) < 4;
        const forceEnter = !!parts.forceEnterOnce && !forced && canEnter;
        if (forceEnter) forced = true;
        const meta = generateBuilding(rng, parts, {
          x: lot.x, z: lot.z,
          maxW: lot.w * 0.94, maxD: lot.d * 0.94,
          minFloors, maxFloors,
          allowEnter: parts.wantEnterable && canEnter,
          forceEnter,
          doorSide,
        });
        buildingMetas.push(meta);
        buildings++;
      }
      if (forced) parts.forceEnterOnce = false;
      this._addStreetProps(parts, rng, cx, cz, pad, street, concrete, metal, buildingMetas);
      return buildings;
    }

    // ---- street props around the block ----
    this._addStreetProps(parts, rng, cx, cz, pad, street, concrete, metal, []);
    return buildings;
  }

  _buildPlaza(parts, rng, cx, cz, pad) {
    const concrete = this._builder(parts, 'concrete');
    const metal = this._builder(parts, 'metal');
    const walk = this._builder(parts, 'sidewalk');
    const glass = this._builder(parts, 'glassEmissive');
    const neon = this._builder(parts, 'neonPink');

    // pale stone paths crossing the plaza
    const pathCol = new THREE.Color(0.9, 0.92, 0.98);
    addTop(walk, cx, 0.185, cz, pad * 0.92, 3.4, 8, pathCol);
    addTop(walk, cx, 0.186, cz, 3.4, pad * 0.92, 8, pathCol);

    // ---- central fountain / monument ----
    const fr = 3.6;
    const rimCol = new THREE.Color(0.75, 0.78, 0.82);
    addBox(concrete, cx, 0.18, cz + fr, fr * 2 + 0.5, 0.55, 0.5, 2, rimCol);
    addBox(concrete, cx, 0.18, cz - fr, fr * 2 + 0.5, 0.55, 0.5, 2, rimCol);
    addBox(concrete, cx + fr, 0.18, cz, 0.5, 0.55, fr * 2 + 0.5, 2, rimCol);
    addBox(concrete, cx - fr, 0.18, cz, 0.5, 0.55, fr * 2 + 0.5, 2, rimCol);
    addBox(glass, cx, 0.6, cz, fr * 2 - 0.3, 0.07, fr * 2 - 0.3, 2, new THREE.Color(0.22, 0.55, 0.85));
    parts.colliders.push(boxCollider(cx, 0.18, cz, fr * 2 + 0.5, 0.55, fr * 2 + 0.5, 'prop'));
    // monument shaft + neon rings
    addBox(metal, cx, 0.6, cz, 1.0, 4.2, 1.0, 2, new THREE.Color(0.35, 0.38, 0.42));
    addBox(neon, cx, 2.2, cz, 1.15, 0.09, 1.15, 1, new THREE.Color(1, 1, 1));
    addBox(neon, cx, 3.4, cz, 1.12, 0.07, 1.12, 1, new THREE.Color(1, 1, 1));
    addBox(glass, cx, 4.85, cz, 0.55, 0.4, 0.55, 1, new THREE.Color(0.6, 0.9, 1));
    parts.props.push({ type: 'beacon', x: cx, y: 4.6, z: cz, color: 0xff4d9e });
    parts.signs = parts.signs || [];
    parts.signs.push({ x: cx, y: 3.05, z: cz + 1.2, w: 2.4, h: 0.55, ry: 0, seed: Math.floor(cx * 13 + cz * 7) & 0x7fffffff });

    // benches ringing the fountain
    const benchPos = [[0, fr + 2.6, 2.0, 0.6], [0, -(fr + 2.6), 2.0, 0.6], [fr + 2.6, 0, 0.6, 2.0], [-(fr + 2.6), 0, 0.6, 2.0]];
    for (const [bx, bz, bw, bd] of benchPos) {
      addBox(concrete, cx + bx, 0.18, cz + bz, bw, 0.45, bd, 2, new THREE.Color(0.65, 0.55, 0.42));
      parts.colliders.push(boxCollider(cx + bx, 0.18, cz + bz, bw, 0.45, bd, 'prop'));
    }

    // planters / trees in the open quadrants
    for (let i = 0; i < 4 + Math.floor(rng() * 4); i++) {
      const ang = (i / 7) * Math.PI * 2 + rng() * 0.5;
      const rad = fr + 4 + rng() * (pad * 0.28);
      const tx = cx + Math.cos(ang) * rad;
      const tz = cz + Math.sin(ang) * rad;
      if (Math.abs(tx - cx) > pad / 2 - 3 || Math.abs(tz - cz) > pad / 2 - 3) continue;
      addBox(concrete, tx, 0.18, tz, 1.4, 0.55, 1.4, 2, new THREE.Color(0.38, 0.4, 0.36));
      addBox(metal, tx, 0.7, tz, 0.45, 3.0, 0.45, 1, new THREE.Color(0.35, 0.26, 0.18));
      addBox(concrete, tx, 2.4, tz, 2.3, 2.0, 2.3, 2, new THREE.Color(0.18, 0.48, 0.26));
      parts.colliders.push(boxCollider(tx, 0.18, tz, 1.4, 2.6, 1.4, 'prop'));
    }

    // four corner lamps (they also feed the moving point-light pool)
    const lx = pad / 2 - 1.4;
    const lampCol = new THREE.Color(0.9, 0.92, 0.95);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._addLamp(parts, cx + sx * lx, cz + sz * lx, lampCol);

    // market stalls on two sides
    for (let i = 0; i < 2; i++) {
      const side = Math.floor(rng() * 4);
      const off = (rng() - 0.5) * (pad - 10);
      let sx = cx, sz = cz;
      if (side === 0) sz = cz + pad / 2 - 3.2;
      else if (side === 1) sz = cz - pad / 2 + 3.2;
      else if (side === 2) sx = cx + pad / 2 - 3.2;
      else sx = cx - pad / 2 + 3.2;
      if (side < 2) sx = cx + off; else sz = cz + off;
      addBox(metal, sx, 0.18, sz, 2.4, 0.9, 1.4, 2, new THREE.Color(0.5, 0.52, 0.56));
      addBox(neon, sx, 1.14, sz, 2.5, 0.07, 1.5, 1, new THREE.Color(1, 1, 1));
      addBox(concrete, sx, 2.2, sz, 2.7, 0.14, 1.7, 2, new THREE.Color(0.3, 0.3, 0.35));
      addBox(metal, sx - 1.1, 1.1, sz, 0.08, 2.2, 0.08, 1, new THREE.Color(0.4, 0.4, 0.45));
      addBox(metal, sx + 1.1, 1.1, sz, 0.08, 2.2, 0.08, 1, new THREE.Color(0.4, 0.4, 0.45));
      parts.colliders.push(boxCollider(sx, 0.18, sz, 2.4, 1.1, 1.4, 'prop'));
    }
  }

  _addStreetProps(parts, rng, cx, cz, pad, street, concrete, metal, metas = []) {
    const walk = this._builder(parts, 'sidewalk');
    const dark = this._builder(parts, 'metal');
    const glass = this._builder(parts, 'glassEmissive');
    const neon = this._builder(parts, 'neonCyan');
    const placed = [];
    const inside = (x, z, margin) => metas.some((b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin);
    const atDoor = (x, z, radius) => metas.some((b) => b.doorX != null && Math.hypot(x - b.doorX, z - b.doorZ) < radius);
    const free = (x, z, m = 1.0) => !inside(x, z, m) && !atDoor(x, z, m + 2.2) && !placed.some(p => Math.hypot(p.x - x, p.z - z) < p.r + m);
    const spot = (m = 1.0, edge = 0) => {
      for (let i = 0; i < 16; i++) {
        const x = cx + (rng() - 0.5) * (pad - 2.4 - edge);
        const z = cz + (rng() - 0.5) * (pad - 2.4 - edge);
        if (free(x, z, m)) return { x, z };
      }
      return null;
    };
    // Curbside placement keeps street furniture visible from the road instead
    // of randomly burying it in the last sliver of sidewalk behind a tower.
    const edgeSpot = (m = 1.0) => {
      for (let i = 0; i < 20; i++) {
        const side = Math.floor(rng() * 4);
        const t = (rng() - 0.5) * (pad - 7);
        const off = pad / 2 - 1.35;
        const x = side === 2 ? cx + off : side === 3 ? cx - off : cx + t;
        const z = side === 0 ? cz + off : side === 1 ? cz - off : cz + t;
        if (free(x, z, m)) return { x, z };
      }
      return spot(m);
    };

    // street lamps at the block corners + mid edges
    const corners = [
      [cx - pad / 2 + 1.2, cz - pad / 2 + 1.2],
      [cx + pad / 2 - 1.2, cz - pad / 2 + 1.2],
      [cx - pad / 2 + 1.2, cz + pad / 2 - 1.2],
      [cx + pad / 2 - 1.2, cz + pad / 2 - 1.2],
    ];
    const lampCol = new THREE.Color(0.85, 0.88, 0.92);
    for (const [lx, lz] of corners) {
      if (rng() < 0.1) continue;
      this._addLamp(parts, lx, lz, lampCol);
    }
    if (rng() < 0.7) this._addLamp(parts, cx, cz - pad / 2 + 1.2, lampCol);
    if (rng() < 0.7) this._addLamp(parts, cx, cz + pad / 2 - 1.2, lampCol);

    // traffic signal
    if (rng() < 0.6) {
      const tx = cx + pad / 2 - 1.2, tz = cz - pad / 2 + 1.2;
      addBox(metal, tx, 0.18, tz, 0.3, 4.5, 0.3, 1, lampCol);
      addBox(metal, tx, 4.4, tz, 0.3, 0.9, 0.3, 1, lampCol);
      parts.props.push({ type: 'beacon', x: tx, y: 4.9, z: tz, color: 0xffcc00 });
    }

    // crates, bins, planters, benches, vending machines, dumpsters
    const kinds = ['bin', 'planter', 'bench', 'vending', 'dumpster', 'crate', 'planter', 'bench'];
    for (let i = 0; i < 4 + Math.floor(rng() * 5); i++) {
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const p = edgeSpot(kind === 'bench' ? 1.4 : 1.0);
      if (!p) continue;
      const { x, z } = p;
      if (kind === 'bin') {
        addBox(concrete, x, 0.18, z, 0.7, 1.05, 0.7, 1, new THREE.Color(0.32, 0.36, 0.38));
        addBox(dark, x, 1.25, z, 0.76, 0.1, 0.76, 1, new THREE.Color(0.2, 0.22, 0.24));
        placed.push({ x, z, r: 0.8 });
        parts.colliders.push(boxCollider(x, 0.18, z, 0.7, 1.15, 0.7, 'prop'));
      } else if (kind === 'planter') {
        addBox(concrete, x, 0.18, z, 1.2, 0.55, 1.2, 2, new THREE.Color(0.4, 0.42, 0.38));
        addBox(concrete, x, 1.0, z, 1.7, 1.0, 1.7, 2, new THREE.Color(0.16, 0.42, 0.22));
        placed.push({ x, z, r: 1.1 });
        parts.colliders.push(boxCollider(x, 0.18, z, 1.2, 1.1, 1.2, 'prop'));
      } else if (kind === 'bench') {
        addBox(concrete, x, 0.18, z, 2.0, 0.42, 0.6, 2, new THREE.Color(0.62, 0.5, 0.38));
        addBox(concrete, x, 0.62, z - 0.24, 2.0, 0.5, 0.12, 2, new THREE.Color(0.62, 0.5, 0.38));
        placed.push({ x, z, r: 1.4 });
        parts.colliders.push(boxCollider(x, 0.18, z, 2.0, 0.6, 0.6, 'prop'));
      } else if (kind === 'vending') {
        addBox(metal, x, 0.18, z, 0.95, 2.0, 0.8, 2, new THREE.Color(0.3, 0.34, 0.4));
        addBox(glass, x, 1.2, z + 0.42, 0.7, 1.1, 0.04, 1, new THREE.Color(0.6, 0.9, 1));
        addBox(neon, x, 1.98, z + 0.42, 0.8, 0.09, 0.05, 1, new THREE.Color(1, 1, 1));
        placed.push({ x, z, r: 1.0 });
        parts.colliders.push(boxCollider(x, 0.18, z, 0.95, 2.0, 0.8, 'prop'));
      } else if (kind === 'dumpster') {
        addBox(metal, x, 0.18, z, 1.9, 1.0, 1.0, 2, new THREE.Color(0.26, 0.34, 0.3));
        addBox(dark, x, 1.2, z, 2.0, 0.12, 1.1, 1, new THREE.Color(0.18, 0.2, 0.22));
        placed.push({ x, z, r: 1.4 });
        parts.colliders.push(boxCollider(x, 0.18, z, 1.9, 1.2, 1.0, 'prop'));
      } else {
        const s = 0.8 + rng() * 0.7;
        addBox(parts.byMat['crate'] || (parts.byMat['crate'] = new GeometryBuilder()), x, 0.18, z, s, s, s, 2, new THREE.Color(1, 1, 1));
        placed.push({ x, z, r: s });
        parts.colliders.push(boxCollider(x, 0.18, z, s, s, s, 'prop'));
      }
    }

    // bus shelter
    if (rng() < 0.35) {
      const p = edgeSpot(2.2);
      if (p) {
        const { x, z } = p;
        addBox(metal, x - 1.6, 0.18, z, 0.08, 2.6, 0.08, 1, lampCol);
        addBox(metal, x + 1.6, 0.18, z, 0.08, 2.6, 0.08, 1, lampCol);
        addBox(metal, x, 2.78, z, 3.4, 0.1, 1.5, 2, new THREE.Color(0.3, 0.32, 0.36));
        addBox(glass, x, 1.6, z - 0.68, 3.2, 1.5, 0.05, 1, new THREE.Color(0.55, 0.8, 1));
        addBox(concrete, x, 0.6, z + 0.3, 2.8, 0.1, 0.45, 2, new THREE.Color(0.5, 0.55, 0.6));
        placed.push({ x, z, r: 2.2 });
        parts.colliders.push(boxCollider(x - 1.6, 0.18, z, 0.2, 2.6, 0.2, 'prop'));
        parts.colliders.push(boxCollider(x + 1.6, 0.18, z, 0.2, 2.6, 0.2, 'prop'));
      }
    }

    // parked cars along the kerb (proper low-poly car, not a bare box)
    if (rng() < 0.6) {
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const side = Math.floor(rng() * 4);
        const t = (rng() - 0.5) * (pad - 6);
        let px, pz, carW, carD;
        if (side === 0) { px = cx + t; pz = cz + pad / 2 - 1.0; carW = 4.2; carD = 2.0; }
        else if (side === 1) { px = cx + t; pz = cz - pad / 2 + 1.0; carW = 4.2; carD = 2.0; }
        else if (side === 2) { px = cx + pad / 2 - 1.0; pz = cz + t; carW = 2.0; carD = 4.2; }
        else { px = cx - pad / 2 + 1.0; pz = cz + t; carW = 2.0; carD = 4.2; }
        if (!free(px, pz, 1.6)) continue;
        const col = new THREE.Color().setHSL(rng(), 0.45, 0.28 + rng() * 0.16);
        const alongZ = carD > carW;
        addBox(metal, px, 0.32, pz, carW, 0.55, carD, 2, col);
        addBox(metal, px, 0.78, pz, carW * 0.82, 0.34, carD * 0.82, 2, col.clone().multiplyScalar(1.1));
        addBox(glass, px, 1.02, pz, carW * 0.62, 0.38, carD * 0.6, 1, new THREE.Color(0.25, 0.35, 0.45));
        // wheels
        const wx = alongZ ? carW / 2 : carW / 3, wz = alongZ ? carD / 3 : carD / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          addBox(dark, px + sx * wx * 0.9, 0.18, pz + sz * wz * 0.7, 0.24, 0.36, 0.24, 1, new THREE.Color(0.08, 0.09, 0.1));
        }
        placed.push({ x: px, z: pz, r: 2.2 });
        parts.colliders.push(boxCollider(px, 0.18, pz, carW, 1.1, carD, 'prop'));
      }
    }

    // ground clutter + puddles on the road
    for (let i = 0; i < 3; i++) {
      const x = cx + (rng() - 0.5) * (BLOCK - 2), z = cz + (rng() - 0.5) * (BLOCK - 2);
      if (inside(x, z, 0.5) || Math.abs(x - cx) < pad / 2 + 1 || Math.abs(z - cz) < pad / 2 + 1) continue;
      addTop(street, x, 0.025, z, 0.8 + rng() * 2.4, 0.5 + rng() * 1.6, 2, new THREE.Color(0.28, 0.36, 0.48));
    }
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
    parts.lamps.push({ x: x + 1.8, y: baseY + 6.6, z, color: 0xffcc88, intensity: 42, range: 32 });
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
        l.position.set(lamp.min.x, lamp.min.y, lamp.min.z);
        l.color.setHex(lamp.color || 0xffcc88);
        l.intensity = (lamp.intensity ?? 2.2);
        l.distance = lamp.range ?? 22;
      } else {
        l.intensity = 0;
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
  pointBlocked(x, y, z, pad = 0, tag = null) {
    const list = this.colliderHash.query(
      new THREE.Vector3(x - 0.1, y - 0.1, z - 0.1),
      new THREE.Vector3(x + 0.1, y + 0.1, z + 0.1),
      this._buf, this._seen
    );
    for (const b of list) {
      if (tag && b.tag !== tag) continue;
      if (x >= b.min.x - pad && x <= b.max.x + pad && z >= b.min.z - pad && z <= b.max.z + pad && y >= b.min.y - pad && y <= b.max.y + pad) return b;
    }
    return null;
  }

  /**
   * Offset of (x,z) from the centre of the BLOCK cell it sits in. Block
   * centres are `blockIndex * BLOCK + BLOCK/2` (see `_buildBlock`), NOT
   * multiples of BLOCK — getting this wrong inverts the whole street/pad map
   * and makes building interiors look like roads.
   */
  blockOffset(x, z) {
    return [
      x - (Math.floor(x / BLOCK) + 0.5) * BLOCK,
      z - (Math.floor(z / BLOCK) + 0.5) * BLOCK,
    ];
  }

  isWalkable(x, z) {
    const [dx, dz] = this.blockOffset(x, z);
    const half = PAD / 2 - 0.5;
    if (Math.abs(dx) < half && Math.abs(dz) < half) return false; // on a building/sidewalk pad
    return true;
  }

  groundHeight(x, z) {
    // sidewalk pads are raised; approximate
    const [dx, dz] = this.blockOffset(x, z);
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

  /**
   * Pick a yaw that looks down the most open direction from `pos`. Used by the
   * spawn logic so the player never starts nose-first into a facade.
   */
  openYaw(pos) {
    let bestA = 0, bestD = -1;
    const origin = new THREE.Vector3(pos.x, pos.y + 1.55, pos.z);
    const dir = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dir.set(Math.cos(a), 0, Math.sin(a));
      const hit = this.raycast(origin, dir, 80, (b) => b.tag === 'sidewalk');
      const d = hit ? hit.distance : 80;
      if (d > bestD) { bestD = d; bestA = a; }
    }
    return Math.atan2(-Math.cos(bestA), -Math.sin(bestA));
  }

  /** Random street position within radius chunks of the player. */
  randomStreetNear(cx, cz, minR, maxR) {
    const ang = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    return this.findStreetSpawn(x, z);
  }

  /**
   * A street position near (x,z) that is guaranteed not to be embedded in
   * solid geometry. Returns null if no clear spot is found.
   */
  clearStreetSpawn(x, z, radius = 0.6) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const jx = attempt === 0 ? x : x + (Math.random() - 0.5) * 20;
      const jz = attempt === 0 ? z : z + (Math.random() - 0.5) * 20;
      const s = this.findStreetSpawn(jx, jz);
      if (!this.pointBlocked(s.x, s.y + 0.9, s.z, radius)) return s;
    }
    return null;
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
