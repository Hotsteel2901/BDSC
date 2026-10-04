import * as THREE from 'three';
import { itemDef } from './registry.js';
import { buildItemModel } from './models.js';
import { rngFactory } from '../textures.js';
import { CHUNK_SIZE } from '../world.js';
import { districtAt } from '../districts.js';
import { rollTable, tableForEnemy, tableForContainer } from '../loot/tables.js';

/**
 * LootSystem v2 — sparse world loot driven by *tables*.
 *
 *   · every chunk is themed by its DISTRICT (region_* tables)
 *   · interiors roll purpose tables (office / lab / armory / common)
 *   · containers roll container tables
 *   · enemies drop from per-archetype tables (elites roll the elite table)
 *
 * Rarity + weights live in tables.js; `luck` biases toward rarer loot and
 * `scavenger` increases how much drops, both supplied by the upgrade tree and
 * consumables — so progression and loot are genuinely linked.
 */
export class LootSystem {
  constructor(scene, world, inventory, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.inventory = inventory;
    this.effects = effects;
    this.audio = audio;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.active = [];
    this.taken = inventory.taken;
    this.remaining = new Map();
    this.populated = new Set();
    this.cap = 900;
    this.time = 0;
    this.onPickup = null;
    this.playerPos = new THREE.Vector3();
    this.luck = 0;
    this.scavenger = 0;
  }

  clear() {
    for (const l of this.active) if (l.mesh.parent) l.mesh.parent.remove(l.mesh);
    this.active.length = 0;
    this.populated.clear();
    this.remaining.clear();
  }

  ensureAround(player) {
    this.playerPos.copy(player.pos);
    const CS = CHUNK_SIZE;
    const pcx = Math.floor(player.pos.x / CS), pcz = Math.floor(player.pos.z / CS);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = `${cx},${cz}`;
        if (this.populated.has(key)) continue;
        if (!this.world.hasChunkAt(cx * CS + CS / 2, cz * CS + CS / 2)) continue;
        this.populated.add(key);
        this.onChunkLoad(cx, cz);
      }
    }
  }

  onChunkLoad(cx, cz) {
    const rng = rngFactory(((cx * 92837111) ^ (cz * 689287499) ^ 0x1b873593) >>> 0);
    const cx0 = cx * CHUNK_SIZE, cz0 = cz * CHUNK_SIZE;
    const district = districtAt(cx0 + CHUNK_SIZE / 2, cz0 + CHUNK_SIZE / 2);
    const luck = this.luck;
    const scav = 1 + this.scavenger;

    // -------- street scatter (region table) --------
    const streetCount = Math.round((9 + Math.floor(rng() * 8)) * scav);
    for (let i = 0; i < streetCount; i++) {
      const key = `${cx},${cz},s${i}`;
      const x = cx0 + rng() * CHUNK_SIZE, z = cz0 + rng() * CHUNK_SIZE;
      const s = this.world.findStreetSpawn(x, z);
      const rolls = rollTable(rng, district.loot, luck);
      this._spawnList(rolls, s.x, this.world.groundHeight(s.x, s.z) + 0.3, s.z, key, `${cx},${cz}`);
      if (this.active.length >= this.cap) break;
    }

    // -------- containers + structure caches --------
    const containers = Math.round((2 + Math.floor(rng() * 4)) * scav);
    for (let i = 0; i < containers; i++) {
      const key = `${cx},${cz},c${i}`;
      const x = cx0 + rng() * CHUNK_SIZE, z = cz0 + rng() * CHUNK_SIZE;
      const s = this.world.findStreetSpawn(x, z);
      if (rng() < 0.35) {
        const rolls = rollTable(rng, tableForContainer(rng()), luck);
        this._spawnList(rolls, s.x, this.world.groundHeight(s.x, s.z) + 0.3, s.z, key, `${cx},${cz}`);
      } else {
        this._spawn('supply_cache', 1, s.x, this.world.groundHeight(s.x, s.z) + 0.3, s.z, key + '#0', `${cx},${cz}`);
      }
      if (this.active.length >= this.cap) break;
    }

    // -------- interior loot (dense, purpose-themed) --------
    const enterables = [...this.world.enterables.values()]
      .filter(b => b.x >= cx0 && b.x < cx0 + CHUNK_SIZE && b.z >= cz0 && b.z < cz0 + CHUNK_SIZE)
      .sort((a, b) => a.bx - b.bx || a.bz - b.bz);
    for (const b of enterables) {
      const floors = b.detailFloors || 1;
      const theme = district.interior[(Math.abs(b.bx * 7 + b.bz * 13)) % district.interior.length];
      for (let f = 0; f < floors; f++) {
        const perFloor = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < perFloor; k++) {
          const key = `${cx},${cz},i${b.bx},${b.bz},${f},${k}`;
          const px = b.x + (rng() - 0.5) * (b.w - 2.6);
          const pz = b.z + (rng() - 0.5) * (b.d - 2.6);
          const py = f * (b.floorH || 3.6) + 0.2;
          if (this.world.pointBlocked(px, py + 0.3, pz, 0.25)) continue;
          const rolls = rollTable(rng, theme, luck);
          this._spawnList(rolls, px, py, pz, key, `${cx},${cz}`);
          if (this.active.length >= this.cap) break;
        }
        if (this.active.length >= this.cap) break;
      }
    }
  }

  offChunk(cx, cz) {
    const tag = `${cx},${cz}`;
    this.populated.delete(tag);
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].chunkTag === tag) {
        if (this.active[i].mesh.parent) this.active[i].mesh.parent.remove(this.active[i].mesh);
        this.active.splice(i, 1);
      }
    }
  }

  _spawnList(rolls, x, y, z, key, chunkTag) {
    let i = 0;
    for (const r of rolls) {
      const k = key + '#' + i;
      if (this.taken.has(k)) { i++; continue; }
      const ox = ((i % 2) - 0.5) * 0.5, oz = (Math.floor(i / 2) - 0.5) * 0.5;
      this._spawn(r.id, r.count, x + ox, y, z + oz, k, chunkTag);
      i++;
    }
  }

  _spawn(defId, count, x, y, z, key, chunkTag) {
    const def = itemDef(defId);
    if (!def || this.taken.has(key)) return null;
    if (this.active.length >= this.cap) return null;
    count = this.remaining.get(key) ?? count;
    const mesh = buildItemModel(def, { glow: true });
    mesh.position.set(x, y + 0.25, z);
    if (def.model && def.model.scale) mesh.scale.setScalar(def.model.scale);
    this.group.add(mesh);
    const loot = { defId, count, pos: new THREE.Vector3(x, y, z), mesh, key, chunkTag, phase: Math.random() * 6.28, baseY: y + 0.25 };
    this.active.push(loot);
    return loot;
  }

  /** Enemy drop using its archetype table (or the elite table). */
  dropAt(pos, typeKey = 'grunt', elite = false) {
    const table = elite ? 'elite' : tableForEnemy(typeKey);
    const chance = Math.min(0.95, (elite ? 1 : 0.4) * (1 + this.scavenger * 0.5));
    if (Math.random() > chance) return;
    const rolls = rollTable(Math.random, table, this.luck);
    const s = this.world.findStreetSpawn(pos.x, pos.z);
    const key = 'drop' + Math.floor(Math.random() * 1e9);
    this._spawnList(rolls, s.x, this.world.groundHeight(s.x, s.z) + 0.3, s.z, key, 'drop');
  }

  spawnRandomNear(x, z, minR, maxR) {
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const s = this.world.findStreetSpawn(x + Math.cos(a) * r, z + Math.sin(a) * r);
    const district = districtAt(s.x, s.z);
    const rolls = rollTable(Math.random, district.loot, this.luck);
    const key = 'cache' + Math.floor(Math.random() * 1e9);
    this._spawnList(rolls, s.x, this.world.groundHeight(s.x, s.z) + 0.3, s.z, key, 'cache');
  }

  update(dt, player, game) {
    this.time += dt;
    const t = this.time;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const l = this.active[i];
      l.mesh.rotation.y += dt * 1.4;
      l.mesh.position.y = l.baseY + Math.sin(t * 2 + l.phase) * 0.09;
      const ring = l.mesh.getObjectByName('glowRing');
      if (ring) ring.rotation.z += dt * 0.8;

      const dx = l.pos.x - player.pos.x, dy = l.pos.y - player.pos.y, dz = l.pos.z - player.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 420 * 420 && !this.remaining.has(l.key) && (l.chunkTag === 'drop' || l.chunkTag === 'cache')) {
        if (l.mesh.parent) l.mesh.parent.remove(l.mesh);
        this.active.splice(i, 1);
        continue;
      }
      if (player.alive && d2 < 3.2 * 3.2) {
        const d = Math.sqrt(d2) || 1;
        const pull = Math.min(1, dt * 6);
        l.mesh.position.x += (-dx / d) * pull * 6 * dt;
        l.mesh.position.z += (-dz / d) * pull * 6 * dt;
      }
      if (player.alive && d2 < 1.7 * 1.7) {
        const def = itemDef(l.defId);
        const left = this.inventory.add(l.defId, l.count);
        if (left < l.count) {
          const got = l.count - left;
          if (left === 0) {
            this.taken.add(l.key);
            this.remaining.delete(l.key);
            if (l.mesh.parent) l.mesh.parent.remove(l.mesh);
            this.active.splice(i, 1);
          } else {
            l.count = left;
            this.remaining.set(l.key, left);
          }
          if (this.audio) this.audio.pickup(def.cat === 'medical' || def.cat === 'food' ? 'health' : def.cat === 'armor' || def.cat === 'shield' ? 'armor' : 'ammo');
          if (this.inventory.ensureHotbar && ['medical', 'stim', 'tool', 'food', 'module', 'throwable'].includes(def.cat)) this.inventory.ensureHotbar(l.defId);
          if (this.onPickup) this.onPickup(def, got);
          continue;
        }
      }
    }
  }
}
