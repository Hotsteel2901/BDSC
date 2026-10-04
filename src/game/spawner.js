import * as THREE from 'three';
import { districtAt } from './districts.js';
import { t } from '../ui/i18n.js';

/**
 * SpawnDirector
 * -------------
 * Drives ENDLESS, position-following enemy spawning for the whole (unbounded)
 * map. It keeps a rolling population target around the player, spawns packs in
 * an annulus just outside easy sight, recycles units that fall far behind, and
 * escalates "threat" over time, on noise, and on kills. A periodic SURGE throws
 * a full squad at the player to create pacing peaks.
 *
 * Only the authoritative peer (host / solo) runs this; clients receive ghosts.
 */
export class SpawnDirector {
  constructor(world, enemies, effects, audio) {
    this.world = world;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.time = 0;
    this.threat = 1;
    this.spawnTimer = 1.2;
    this.surgeTimer = 22;
    this.kills = 0;
    this.lure = null;
    this.lureTimer = 0;
    this.noiseBoost = 0;
    this.despawnR = 200;
    this.minSpawnR = 46;
    this.maxSpawnR = 96;
    this.maxAlive = 46;
    this._objective = t('obj.contact');
    this.surgeCount = 0;
    this.onSurge = null;
    this.lastReport = 0;
  }

  /** Called by the game whenever the player makes a loud noise. */
  onNoise(pos, radius = 40) {
    this.noiseBoost = Math.min(8, this.noiseBoost + 2.5);
    if (!this.lure) { this.lure = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z); this.lureTimer = 6; }
  }

  onKill() {
    this.kills++;
    this.threat += 0.11;
  }

  get objective() { return this._objective; }

  update(dt, ctx) {
    if (!this.enabled || !this.enemies) return;
    this.time += dt;
    this.surgeCount = 0;

    // ---- escalation ----
    this.threat += dt * 0.018;
    this.noiseBoost = Math.max(0, this.noiseBoost - dt * 0.6);
    if (this.lure) { this.lureTimer -= dt; if (this.lureTimer <= 0) this.lure = null; }

    const DIFF = ctx.threatMul || 1;      // difficulty scalar
    const DENS = ctx.density || 1;        // density scalar
    const effThreat = this.threat * DIFF;
    const district = districtAt(ctx.player.pos.x, ctx.player.pos.z);
    const dens = DENS * (district.density || 1);

    const alive = this.enemies.countAlive();
    const targetAlive = Math.min(this.maxAlive, Math.round((6 + effThreat * 1.35) * dens));
    const interval = Math.max(0.55, (3.0 - effThreat * 0.07) / (dens * (1 + this.noiseBoost * 0.12)));

    // ---- steady spawning ----
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      if (alive < targetAlive) {
        const deficit = targetAlive - alive;
        const pack = Math.max(1, Math.min(4, Math.round(deficit * 0.35) + (Math.random() < 0.3 ? 1 : 0)));
        this._spawnPack(pack, effThreat, ctx, district);
      }
    }

    // ---- surges ----
    this.surgeTimer -= dt;
    if (this.surgeTimer <= 0 && alive < this.maxAlive - 4) {
      this.surgeTimer = Math.max(18, 46 - effThreat * 0.8) + Math.random() * 10;
      const n = Math.max(3, Math.min(9, Math.round((3 + effThreat * 0.35) * dens)));
      const centre = this._pickCentre(ctx);
      this.enemies.spawnSquad(centre, n, this._typePool(effThreat, district, true), { spread: 16, district });
      this.surgeCount = n;
      if (this.audio) this.audio.alarm();
      if (ctx.onSurge) ctx.onSurge(n, this.threat, district.name);
    }

    // ---- recycle far-behind units ----
    const px = ctx.player.pos.x, pz = ctx.player.pos.z;
    for (let i = this.enemies.list.length - 1; i >= 0; i--) {
      const e = this.enemies.list[i];
      if (e.ghost || !e.alive) continue;
      const d = Math.hypot(e.pos.x - px, e.pos.z - pz);
      if (d > this.despawnR && e.state !== 'combat') e.removeMe = true;
    }

    // ---- objective / status text ----
    if (this.time - this.lastReport > 0.5) {
      this.lastReport = this.time;
      this._objective = t('obj.threat', { t: Math.floor(this.threat), n: alive });
    }
  }

  _pickCentre(ctx) {
    const p = ctx.player.pos;
    const c = this.lure || p;
    return this.world.randomStreetNear(c.x, c.z, this.minSpawnR, this.maxSpawnR);
  }

  _spawnPack(n, effThreat, ctx, district) {
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      let pos = null;
      const centre = this._pickCentre(ctx);
      for (let tries = 0; tries < 5; tries++) {
        const cand = this.world.randomStreetNear(centre.x, centre.z, 6, 22);
        if (this.world.hasChunkAt(cand.x, cand.z)) { pos = cand; break; }
      }
      if (!pos) continue;
      const type = this._chooseType(effThreat, district);
      const elite = Math.random() < (district.elite || 0) * (1 + effThreat * 0.01);
      const e = this.enemies.spawn(type, pos, null, { hpMul: 1, elite });
      if (!e) continue;
      spawned++;
      this.effects.burst(new THREE.Vector3(pos.x, pos.y + 1, pos.z), new THREE.Vector3(0, 1, 0), elite ? 'explosion' : 'energy', elite ? 16 : 10, elite ? 1.3 : 0.9);
    }
    return spawned;
  }

  _chooseType(effThreat, district) {
    const w = (district && district.enemies) || { grunt: 1 };
    const gate = {
      grunt: 1,
      rusher: effThreat > 1.5 ? 1 : 0.35,
      drone: effThreat > 2.5 ? 1 : 0,
      heavy: effThreat > 4 ? 1 : 0,
      turret: effThreat > 5 ? 1 : 0,
      sniper: effThreat > 6 ? 1 : 0,
      officer: effThreat > 8 ? 1 : 0,
    };
    let total = 0;
    const list = [];
    for (const t in w) {
      const wt = (w[t] || 0) * (gate[t] || 0);
      if (wt > 0) { list.push([t, wt]); total += wt; }
    }
    if (!list.length) return 'grunt';
    let r = Math.random() * total;
    for (const [t, wt] of list) { r -= wt; if (r <= 0) return t; }
    return list[0][0];
  }

  _typePool(effThreat, district, surge) {
    // used by surge squads (returns a flat list for spawnSquad)
    const pool = [];
    for (let i = 0; i < 5; i++) pool.push(this._chooseType(effThreat, district));
    return pool.length ? pool : ['grunt'];
  }
}
