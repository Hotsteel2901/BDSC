import * as THREE from 'three';

/**
 * Tactical layer: squads, role assignment, cover/flank scoring.
 * This module is deliberately free of rendering concerns so the decision logic
 * is easy to reason about. `ctx` throughout is:
 *   { world, nav, player, effects, audio, projectiles, time, difficulty }
 */

const _v = new THREE.Vector3();

export class Squad {
  constructor(id) {
    this.id = id;
    this.members = [];
    this.alerted = false;
    this.target = null;          // last known target position
    this.targetTime = -999;
    this.contactCount = 0;
    this.everSawPlayer = false;
    this.roleTimer = 0;
    this.reinforceCooldown = 0;
    this.alarmRaised = false;
    this.strategy = 'hold';
  }
  add(e) { e.squad = this; this.members.push(e); }
  remove(e) { const i = this.members.indexOf(e); if (i >= 0) this.members.splice(i, 1); }
  get alive() { return this.members.filter(m => m.alive); }

  reportContact(pos, time) {
    this.alerted = true;
    this.target = pos.clone();
    this.targetTime = time;
    this.contactCount++;
    if (!this.everSawPlayer) this.everSawPlayer = true;
  }

  update(dt, ctx) {
    this.reinforceCooldown -= dt;
    this.roleTimer -= dt;
    // forget a stale target
    if (this.target && ctx.time - this.targetTime > 22) {
      this.target = null;
      this.alerted = false;
    }
    if (this.roleTimer <= 0 && this.target) {
      this.roleTimer = 0.8;
      this._assignRoles(ctx);
    }
  }

  _assignRoles(ctx) {
    const alive = this.alive;
    if (!alive.length) return;
    const t = this.target;
    alive.forEach(e => { e.distToTarget = e.pos.distanceTo(t); });
    alive.sort((a, b) => a.distToTarget - b.distToTarget);

    // reset
    for (const e of alive) e.aiRole = 'assault';

    // snipers hold overwatch
    for (const e of alive) if (e.type.keepDist) e.aiRole = 'overwatch';

    // designate one flanker when we have numbers and room
    const nonSniper = alive.filter(e => !e.type.keepDist);
    if (nonSniper.length >= 3 && this.contactCount >= 1) {
      // pick the member with the most lateral offset potential
      nonSniper[nonSniper.length - 1].aiRole = 'flank';
    }
    // support/suppressor keeps one back to lay fire
    if (nonSniper.length >= 2) {
      const sup = nonSniper.find(e => e.aiRole === 'assault' && e.distToTarget > 12) || nonSniper[nonSniper.length - 1];
      if (sup && sup.aiRole === 'assault') sup.aiRole = 'support';
    }

    // choose squad strategy from average distance & casualties
    const avg = alive.reduce((s, e) => s + e.distToTarget, 0) / alive.length;
    if (alive.length <= 1) this.strategy = 'fallback';
    else if (avg < 20) this.strategy = 'press';
    else if (avg > 45) this.strategy = 'advance';
    else this.strategy = 'hold';
  }
}

/**
 * Score candidate positions that block line-of-sight from a threat.
 */
export function findCoverPoint(ctx, from, threat, opts = {}) {
  const { world, nav } = ctx;
  const radius = opts.radius ?? 9;
  const eyeY = from.y + (opts.eyeOffset ?? 1.4);
  let best = null, bestScore = -Infinity;
  const N = opts.samples ?? 18;
  const baseAng = Math.atan2(from.x - threat.x, from.z - threat.z);
  for (let i = 0; i < N; i++) {
    const ang = baseAng + (i / N) * Math.PI * 2;
    const r = 2 + Math.random() * radius;
    const px = from.x + Math.sin(ang) * r;
    const pz = from.z + Math.cos(ang) * r;
    if (!world.isWalkable(px, pz)) continue;
    const py = world.groundHeight(px, pz);
    // must block LOS from threat (threat eye ~1.6)
    const blocked = !nav.losClear(px, py + 1.2, pz, threat.x, threat.y + 1.6, threat.z);
    if (!blocked) continue;
    // must be able to see near its own position (not embedded in a wall)
    if (world.pointBlocked(px, py + 0.5, pz, 0.35)) continue;
    // prefer closer to the agent, and not too far from the threat (can still fight)
    const dAgent = Math.hypot(px - from.x, pz - from.z);
    const dThreat = Math.hypot(px - threat.x, pz - threat.z);
    let score = -dAgent * 1.2;
    if (dThreat < 6) score -= (6 - dThreat) * 3;     // don't hug the enemy
    if (dThreat > 55) score -= (dThreat - 55) * 1.5; // stay relevant
    // prefer cover that allows peeking at a nearby angle
    if (score > bestScore) { bestScore = score; best = new THREE.Vector3(px, py, pz); }
  }
  return best;
}

/** A position to the side of the threat line, advanced, with clear LOS. */
export function flankPoint(ctx, from, threat, side = 1, advance = 10) {
  const { world, nav } = ctx;
  const dx = threat.x - from.x, dz = threat.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len, nz = dz / len;
  const px = -nz * side, pz = nx * side; // perpendicular
  for (let step = advance; step >= 3; step -= 1.5) {
    for (const spread of [0, 4, 8, 12]) {
      const tx = from.x + px * (step * 0.9) + nx * step;
      const tz = from.z + pz * (step * 0.9) + nz * step;
      const gx = tx + px * spread * 0.3;
      const gz = tz + pz * spread * 0.3;
      if (!world.isWalkable(gx, gz)) continue;
      if (world.pointBlocked(gx, world.groundHeight(gx, gz) + 0.5, gz, 0.4)) continue;
      return new THREE.Vector3(gx, world.groundHeight(gx, gz), gz);
    }
  }
  return null;
}

/** A forward position toward the threat that stays in cover-ish, for advancing. */
export function advancePoint(ctx, from, threat, amount = 8) {
  const { world } = ctx;
  const dx = threat.x - from.x, dz = threat.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const baseX = from.x + (dx / len) * Math.min(amount, len * 0.7);
  const baseZ = from.z + (dz / len) * Math.min(amount, len * 0.7);
  // jitter to find a walkable spot
  for (const j of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [5, 0], [0, 5]]) {
    const x = baseX + j[0], z = baseZ + j[1];
    if (world.isWalkable(x, z) && !world.pointBlocked(x, world.groundHeight(x, z) + 0.5, z, 0.4))
      return new THREE.Vector3(x, world.groundHeight(x, z), z);
  }
  return null;
}

/** A position further from the threat, for retreating/fallback. */
export function retreatPoint(ctx, from, threat, amount = 16) {
  const { world } = ctx;
  const dx = from.x - threat.x, dz = from.z - threat.z;
  const len = Math.hypot(dx, dz) || 1;
  const bx = from.x + (dx / len) * amount;
  const bz = from.z + (dz / len) * amount;
  for (const j of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6]]) {
    const x = bx + j[0], z = bz + j[1];
    if (world.isWalkable(x, z)) return new THREE.Vector3(x, world.groundHeight(x, z), z);
  }
  return null;
}

/** Patrol point generator around a home position. */
export function patrolPoint(ctx, home, radius = 30) {
  const { world } = ctx;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * radius;
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    if (world.isWalkable(x, z)) return new THREE.Vector3(x, world.groundHeight(x, z), z);
  }
  return home.clone();
}

/**
 * Line-of-sight + field-of-view perception test.
 */
export function perceives(ctx, eye, targetPos, forward, viewRange, fovCos) {
  const dx = targetPos.x - eye.x, dy = targetPos.y - eye.y, dz = targetPos.z - eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > viewRange) return { seen: false, dist };
  const inv = 1 / (dist || 1);
  const dot = forward.x * dx * inv + forward.y * dy * inv + forward.z * dz * inv;
  if (dot < fovCos && dist > 3) return { seen: false, dist };
  const clear = ctx.nav.losClear(eye.x, eye.y, eye.z, targetPos.x, targetPos.y, targetPos.z);
  return { seen: clear, dist };
}
