/**
 * Buffs — timed multiplicative/additive modifiers granted by consumables,
 * tools and deployables. Kept on the player; queried by movement, weapons and
 * damage code.
 *
 * Supported mod keys:
 *   speed, jump, damage, firerate, reload, dmgResist, thorns, lifesteal (mult)
 *   regen (additive HP/s), invis (flag), radar/xray (flag), timescale (mult)
 */
export class Buffs {
  constructor() {
    this.active = new Map(); // id -> { until, mods, label, dur, started }
    this.time = 0;
    this.onExpire = null;
  }

  add(id, dur, mods, label) {
    const existing = this.active.get(id);
    this.active.set(id, {
      until: this.time + dur, dur, mods: mods || {}, label: label || id,
      started: this.time, refresh: !!existing,
    });
  }

  remove(id) { this.active.delete(id); }
  has(id) { const b = this.active.get(id); return !!b && b.until > this.time; }

  update(dt) {
    this.time += dt;
    for (const [id, b] of this.active) {
      if (b.until <= this.time) {
        this.active.delete(id);
        if (this.onExpire) this.onExpire(id, b);
      }
    }
  }

  /** Product of a multiplicative modifier across all buffs. */
  value(key) {
    let v = 1;
    for (const [, b] of this.active) {
      if (b.mods[key] != null) v *= b.mods[key];
    }
    return v;
  }

  /** Sum of an additive modifier across all buffs. */
  additive(key) {
    let v = 0;
    for (const [, b] of this.active) {
      if (b.mods[key] != null) v += b.mods[key];
    }
    return v;
  }

  any(key) {
    for (const [, b] of this.active) if (b.mods[key]) return true;
    return false;
  }

  list() {
    const out = [];
    for (const [id, b] of this.active) {
      out.push({ id, label: b.label, remaining: Math.max(0, b.until - this.time), dur: b.dur });
    }
    return out;
  }

  clear() { this.active.clear(); }
}
