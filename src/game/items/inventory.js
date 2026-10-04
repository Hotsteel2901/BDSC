import { itemDef } from './registry.js';

/**
 * Inventory — a slot + stack container with weight accounting and a 7-slot
 * quick-use hotbar. Pure data; the UI in hud.js renders it.
 */
export class Inventory {
  constructor(capacity = 30, maxWeight = 140) {
    this.capacity = capacity;
    this.maxWeight = maxWeight;
    this.slots = new Array(capacity).fill(null); // { id, count }
    this.hotbar = new Array(7).fill(null);       // item ids
    this.taken = new Set();                      // world-loot keys consumed this session
  }

  def(id) { return itemDef(id); }

  countOf(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }
  has(id, count = 1) { return this.countOf(id) >= count; }

  totalWeight() {
    let w = 0;
    for (const s of this.slots) if (s) { const d = this.def(s.id); if (d) w += d.weight * s.count; }
    return w;
  }
  isOverweight() { return this.totalWeight() > this.maxWeight; }

  isFull() { return this.slots.every(s => s !== null); }

  /** Number of items that fit in current stacks and empty slots (slot limit only). */
  maxAdd(id, count = Infinity) {
    const def = this.def(id);
    if (!def) return 0;
    const stack = def.stack || 1;
    let room = 0;
    for (const s of this.slots) {
      room += s ? (s.id === id ? Math.max(0, stack - s.count) : 0) : stack;
      if (room >= count) return count;
    }
    return room;
  }

  /** Add items; returns the number that did NOT fit. */
  add(id, count = 1) {
    const def = this.def(id);
    if (!def) return count;
    const stack = def.stack || 1;
    let left = count;
    // fill existing stacks first
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < stack) {
        const put = Math.min(left, stack - s.count);
        s.count += put; left -= put;
      }
    }
    // then empty slots
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(left, stack);
        this.slots[i] = { id, count: put };
        left -= put;
      }
    }
    return left;
  }

  remove(id, count = 1) {
    let left = count;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(left, s.count);
        s.count -= take; left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }

  removeSlot(index, count = 1) {
    const s = this.slots[index];
    if (!s) return 0;
    const take = Math.min(count, s.count);
    s.count -= take;
    if (s.count <= 0) this.slots[index] = null;
    return take;
  }

  /** Auto-assign a hotbar slot for a consumable/tool if not already present. */
  ensureHotbar(id) {
    if (this.hotbar.includes(id)) return;
    const idx = this.hotbar.indexOf(null);
    if (idx >= 0) this.hotbar[idx] = id;
  }

  setHotbar(index, id) {
    // remove id from any other slot
    for (let i = 0; i < this.hotbar.length; i++) if (this.hotbar[i] === id) this.hotbar[i] = null;
    this.hotbar[index] = id;
  }
}
