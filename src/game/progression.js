import { applyAmmoToStats } from './ammo.js';
import { t } from '../ui/i18n.js';

/**
 * Weapon progression v2 — a multi-branch, multi-tier MOD TREE with exclusive
 * choices, capstone perks and mod points. Levels are earned from damage/kills;
 * each level grants mod points; nodes cost points and gate on tier + prerequisites.
 *
 *   LETHAL  damage / crit / execution / lifesteal
 *   TEMPO   fire rate / reload / overclock
 *   CONTROL accuracy / recoil / deadeye / headshots
 *   UTILITY magazine / penetration / armory / scavenger / ammo affinity
 *
 * Exclusivity at tier 3 means you commit to a build. Perks feed combat, and
 * UTILITY perks (scavenger, luck, affinity) directly change the loot system.
 */

export const MAX_WEAPON_LEVEL = 20;
export const MILESTONE_LEVELS = [5, 10, 15, 20];

export const BRANCHES = [
  { id: 'lethal', name: 'LETHAL', color: 0xff4d6d, icon: '✦' },
  { id: 'tempo', name: 'TEMPO', color: 0xffb000, icon: '↯' },
  { id: 'control', name: 'CONTROL', color: 0x4de0ff, icon: '◎' },
  { id: 'utility', name: 'UTILITY', color: 0x37ff8b, icon: '▥' },
];

export const TREE = {
  lethal1: { branch: 'lethal', tier: 1, cost: 1, name: 'HARDENED ROUNDS', desc: '+9% damage', mods: { dmg: 1.09 } },
  lethal2: { branch: 'lethal', tier: 2, cost: 1, req: ['lethal1'], name: 'FRANGIBLE TIPS', desc: '+8% damage, +6% crit chance', mods: { dmg: 1.08, crit: 0.06 } },
  lethal3a: { branch: 'lethal', tier: 3, cost: 2, req: ['lethal2'], exclusive: ['lethal3b'], name: 'EXECUTIONER', desc: '+45% crit damage; +30% dmg to foes below 35% HP', mods: { critMult: 0.45 }, perk: 'executioner' },
  lethal3b: { branch: 'lethal', tier: 3, cost: 2, req: ['lethal2'], exclusive: ['lethal3a'], name: 'HEAVY CALIBRE', desc: '+22% damage, −8% fire rate', mods: { dmg: 1.22, firerate: 0.92 } },
  lethal4: { branch: 'lethal', tier: 4, cost: 3, reqAny: ['lethal3a', 'lethal3b'], name: 'VAMPIRIC CORE', desc: 'Heal 5 HP per kill; +10% damage', mods: { dmg: 1.10 }, perk: 'lifesteal' },

  tempo1: { branch: 'tempo', tier: 1, cost: 1, name: 'LIGHT BOLT', desc: '+8% fire rate, +4% recoil', mods: { firerate: 1.08, recoil: 1.04 } },
  tempo2: { branch: 'tempo', tier: 2, cost: 1, req: ['tempo1'], name: 'LIGHTWEIGHT ACTION', desc: '−18% reload, +6% fire rate', mods: { reload: 0.82, firerate: 1.06 } },
  tempo3a: { branch: 'tempo', tier: 3, cost: 2, req: ['tempo2'], exclusive: ['tempo3b'], name: 'OVERCLOCK', desc: 'Fire rate ramps up to +30% while sustained', perk: 'overclock' },
  tempo3b: { branch: 'tempo', tier: 3, cost: 2, req: ['tempo2'], exclusive: ['tempo3a'], name: 'HAIR TRIGGER', desc: '+15% fire rate, −12% control', mods: { firerate: 1.15, recoil: 1.12 } },
  tempo4: { branch: 'tempo', tier: 4, cost: 3, reqAny: ['tempo3a', 'tempo3b'], name: 'KINETIC LOOP', desc: '+25% fire rate, rounds pierce once', mods: { firerate: 1.25 }, modsAdd: { pierce: 1 } },

  control1: { branch: 'control', tier: 1, cost: 1, name: 'MATCHED BARREL', desc: '−10% spread', mods: { spread: 0.90 } },
  control2: { branch: 'control', tier: 2, cost: 1, req: ['control1'], name: 'BRAKE SYSTEM', desc: '−16% recoil', mods: { recoil: 0.84 } },
  control3a: { branch: 'control', tier: 3, cost: 2, req: ['control2'], exclusive: ['control3b'], name: 'DEADEYE', desc: 'First shot after a pause: +70% dmg, pinpoint', perk: 'deadeye' },
  control3b: { branch: 'control', tier: 3, cost: 2, req: ['control2'], exclusive: ['control3a'], name: 'BIPOD STANCE', desc: '−30% spread & −10% recoil while crouched', mods: { recoil: 0.90 }, perk: 'bipod' },
  control4: { branch: 'control', tier: 4, cost: 3, reqAny: ['control3a', 'control3b'], name: 'GHOST PROTOCOL', desc: '+20% headshot damage, spread bloom halved', modsAdd: { headshot: 0.20 }, perk: 'stabilizer' },

  utility1: { branch: 'utility', tier: 1, cost: 1, name: 'EXTENDED FEED', desc: '+15% magazine', mods: { mag: 1.15 } },
  utility2: { branch: 'utility', tier: 2, cost: 1, req: ['utility1'], name: 'AP CORE', desc: '+30% penetration, +6% damage', mods: { pen: 0.30, dmg: 1.06 } },
  utility3a: { branch: 'utility', tier: 3, cost: 2, req: ['utility2'], exclusive: ['utility3b'], name: 'ARMORY', desc: 'Reserve ammo slowly regenerates; +25% reserve', perk: 'armory' },
  utility3b: { branch: 'utility', tier: 3, cost: 2, req: ['utility2'], exclusive: ['utility3a'], name: 'SCAVENGER', desc: '+35% drop rate, +0.5 luck', perk: 'scavenger', scavenger: 0.35, luck: 0.5 },
  utility4: { branch: 'utility', tier: 4, cost: 3, reqAny: ['utility3a', 'utility3b'], name: 'AMMO AFFINITY', desc: '+20% dmg with specialised ammo; loot biases to rare rounds', perk: 'affinity', luck: 0.25 },
};

export const NODE_IDS = Object.keys(TREE);

export class Progression {
  constructor() {
    this.scrap = 150;
    this.weapons = {};
    this.onLevelUp = null;
    this.onScrap = null;
  }

  reset() { this.scrap = 150; this.weapons = {}; }

  stateFor(id) {
    if (!this.weapons[id]) {
      this.weapons[id] = { id, level: 1, xp: 0, mp: 0, nodes: [], spent: 0, kills: 0 };
    }
    return this.weapons[id];
  }

  addScrap(n) { if (!n) return; this.scrap += n; if (this.onScrap) this.onScrap(n); }
  spendScrap(n) { if (this.scrap < n) return false; this.scrap -= n; return true; }

  addModPoints(id, n) { const s = this.stateFor(id); s.mp += n; return s.mp; }

  xpToNext(level) { return Math.floor(120 * Math.pow(1.18, level - 1)); }

  addXp(id, amount) {
    const s = this.stateFor(id);
    if (s.level >= MAX_WEAPON_LEVEL) return 0;
    s.xp += amount;
    let gained = 0;
    while (s.level < MAX_WEAPON_LEVEL && s.xp >= this.xpToNext(s.level)) {
      s.xp -= this.xpToNext(s.level);
      s.level++;
      s.mp += 1;
      if (MILESTONE_LEVELS.includes(s.level)) s.mp += 1;
      gained++;
    }
    if (gained && this.onLevelUp) this.onLevelUp(id, s.level, gained);
    return gained;
  }

  hasNode(state, nodeId) { return state.nodes.includes(nodeId); }

  nodeLockReason(id, nodeId) {
    const node = TREE[nodeId];
    if (!node) return t('fx.unknown');
    const s = this.stateFor(id);
    if (this.hasNode(s, nodeId)) return t('lock.owned');
    if (s.level < node.tier) return t('lock.level', { n: node.tier });
    if (node.req) for (const r of node.req) if (!this.hasNode(s, r)) return t('lock.req', { name: TREE[r].name });
    if (node.reqAny && !node.reqAny.some(r => this.hasNode(s, r))) return t('lock.reqAny', { name: TREE[node.reqAny[0]].name });
    if (node.exclusive) for (const ex of node.exclusive) if (this.hasNode(s, ex)) return t('lock.blocked', { name: TREE[ex].name });
    if (s.mp < node.cost) return t('lock.mp', { n: node.cost });
    return null;
  }
  canUnlock(id, nodeId) { return this.nodeLockReason(id, nodeId) === null; }

  unlockNode(id, nodeId) {
    if (!this.canUnlock(id, nodeId)) return false;
    const node = TREE[nodeId];
    const s = this.stateFor(id);
    s.mp -= node.cost;
    s.spent += node.cost;
    s.nodes.push(nodeId);
    return true;
  }

  respecCost(id) { const s = this.stateFor(id); return 40 * s.nodes.length; }
  respec(id) {
    const s = this.stateFor(id);
    if (!s.nodes.length) return false;
    const cost = this.respecCost(id);
    if (this.scrap < cost) return false;
    this.scrap -= cost;
    s.mp += s.spent;
    s.spent = 0;
    s.nodes = [];
    return true;
  }

  /** Aggregated node modifiers + perks for a weapon. */
  aggregate(state) {
    const agg = {
      dmg: 1, firerate: 1, spread: 1, recoil: 1, mag: 1, reload: 1,
      pen: 0, crit: 0, critMult: 0, headshot: 0, pierce: 0,
      scavenger: 0, luck: 0,
      perks: {},
    };
    for (const nid of state.nodes) {
      const n = TREE[nid];
      if (!n) continue;
      if (n.mods) for (const k in n.mods) {
        if (k === 'pen') agg.pen += n.mods[k];
        else if (k === 'crit') agg.crit += n.mods[k];
        else if (k === 'critMult') agg.critMult += n.mods[k];
        else if (k in agg && typeof agg[k] === 'number' && ['dmg', 'firerate', 'spread', 'recoil', 'mag', 'reload'].includes(k)) agg[k] *= n.mods[k];
      }
      if (n.modsAdd) for (const k in n.modsAdd) {
        if (k === 'pierce') agg.pierce += n.modsAdd[k];
        else if (k === 'headshot') agg.headshot += n.modsAdd[k];
      }
      if (n.perk) agg.perks[n.perk] = true;
      if (n.scavenger) agg.scavenger += n.scavenger;
      if (n.luck) agg.luck += n.luck;
    }
    return agg;
  }

  computeStats(baseDef, state, ammoId, buffs, attachResolver) {
    const agg = this.aggregate(state);
    let stats = { ...baseDef };

    stats.dmg *= agg.dmg;
    stats.rpm *= agg.firerate;
    stats.spread *= agg.spread;
    stats.recoilP *= agg.recoil;
    stats.mag = Math.max(1, Math.round(baseDef.mag * agg.mag));
    stats.reload *= agg.reload;

    // attachments
    const at = state.attachments || {};
    let penAdd = agg.pen, aoeAdd = 0, extraStatus = null, reveal = false, silent = false, extraMag = 1, extraRate = 1, extraDmg = 1, extraReload = 1, extraRecoil = 1, extraSpread = 1;
    for (const slot in at) {
      const m = attachResolver ? attachResolver(at[slot]) : null;
      if (!m) continue;
      if (m.dmgMul) extraDmg *= m.dmgMul;
      if (m.recoilMul) extraRecoil *= m.recoilMul;
      if (m.spreadMul) extraSpread *= m.spreadMul;
      if (m.magMul) extraMag *= m.magMul;
      if (m.reloadMul) extraReload *= m.reloadMul;
      if (m.rateMul) extraRate *= m.rateMul;
      if (m.penAdd) penAdd += m.penAdd;
      if (m.aoeAdd) aoeAdd += m.aoeAdd;
      if (m.silent) silent = true;
      if (m.reveal) reveal = true;
      if (m.statusOnHit) extraStatus = m.statusOnHit;
      if (m.adsZoom) stats.scope = Math.max(stats.scope || 1, m.adsZoom);
    }
    stats.dmg *= extraDmg; stats.recoilP *= extraRecoil; stats.spread *= extraSpread;
    stats.mag = Math.max(1, Math.round(stats.mag * extraMag));
    stats.reload *= extraReload; stats.rpm *= extraRate;

    // ammo type
    stats = applyAmmoToStats(stats, ammoId || 'standard');
    if (penAdd) stats.pen = Math.min(1.2, (stats.pen || 0) + penAdd);
    if (aoeAdd) stats.aoe = (stats.aoe || 0) + aoeAdd;
    if (silent) stats.silent = true;
    if (reveal) stats.reveal = true;
    if (extraStatus) stats.attachmentStatus = extraStatus;

    // perks -> effects
    stats.crit = agg.crit;
    stats.critMult = 2.0 + agg.critMult;
    stats.headshotMul = (baseDef.headshotMul || 2.0) + agg.headshot;
    stats.pierce = (stats.pierce || 0) + agg.pierce;
    stats.perks = { ...agg.perks };
    stats.scavenger = agg.scavenger;
    stats.luck = agg.luck;
    if (agg.perks.affinity && ammoId && ammoId !== 'standard') stats.dmg *= 1.2;

    // buffs
    if (buffs) {
      stats.dmg *= buffs.value('damage');
      stats.rpm *= buffs.value('firerate');
      if (buffs.value('reload') !== 1) stats.reload /= buffs.value('reload');
    }

    stats.level = state.level;
    return stats;
  }
}

export function makeAttachResolver(itemsById) {
  return (itemId) => {
    const it = itemsById[itemId];
    return it && it.use && it.use.type === 'attachment' ? it.use.mods : null;
  };
}
