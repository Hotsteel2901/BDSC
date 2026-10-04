import { ITEMS, ITEMS_BY_ID } from '../items/registry.js';

/**
 * Loot tables. A table rolls a number of weighted entries; an entry is either an
 * explicit item id or a `@category` reference resolved to a weighted item within
 * that category. `luck` biases both explicit rare entries and the rarity of
 * rolled items, so progression perks and consumables genuinely change drops.
 */

export const RARITY_W = { common: 1, uncommon: 0.5, rare: 0.25, epic: 0.1, legendary: 0.05 };
export const LUCK_TIER = { common: 0, uncommon: 0.35, rare: 0.9, epic: 1.8, legendary: 3.0 };
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const CAT = {};
for (const it of ITEMS) (CAT[it.cat] = CAT[it.cat] || []).push(it);

function luckMult(rarity, luck) { return 1 + Math.max(0, luck) * (LUCK_TIER[rarity] || 0); }

function weightedPick(rng, list, weightFn) {
  let total = 0;
  for (const x of list) total += weightFn(x);
  let r = rng() * total;
  for (const x of list) { r -= weightFn(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

function resolveRef(ref, rng, luck) {
  if (ref[0] === '@') {
    const list = CAT[ref.slice(1)];
    if (!list || !list.length) return null;
    const it = weightedPick(rng, list, (x) => (RARITY_W[x.rarity] || 0.1) * luckMult(x.rarity, luck));
    return it;
  }
  return ITEMS_BY_ID[ref] || null;
}

function entryWeight(e, luck) {
  if (e.ref[0] === '@') return e.w;
  const it = ITEMS_BY_ID[e.ref];
  return e.w * (it ? luckMult(it.rarity, luck) : 1);
}

function countFor(item, rng, table) {
  if (!item) return 1;
  if (item.cat === 'ammo') return Math.round((table.ammoCount || 40) * (0.6 + rng() * 0.9));
  if (item.cat === 'material' || item.cat === 'valuable') return 1 + Math.floor(rng() * 3);
  if (item.cat === 'container' || item.cat === 'attachment') return 1;
  return 1;
}

/** Roll a table. Returns [{ id, count }, ...]. */
export function rollTable(rng, tableId, luck = 0) {
  const t = TABLES[tableId] || TABLES.street;
  const n = t.rolls[0] + Math.floor(rng() * (t.rolls[1] - t.rolls[0] + 1));
  const out = [];
  let total = 0;
  for (const e of t.entries) total += entryWeight(e, luck);
  for (let i = 0; i < n; i++) {
    let r = rng() * total;
    let chosen = t.entries[t.entries.length - 1];
    for (const e of t.entries) { r -= entryWeight(e, luck); if (r <= 0) { chosen = e; break; } }
    const item = resolveRef(chosen.ref, rng, luck);
    if (item) out.push({ id: item.id, count: countFor(item, rng, t) });
  }
  // bad-luck protection: guarantee a minimum rarity
  if (t.minRarity) {
    const minRank = RARITY_ORDER.indexOf(t.minRarity);
    const has = out.some(o => RARITY_ORDER.indexOf((ITEMS_BY_ID[o.id] || {}).rarity) >= minRank);
    if (!has) {
      const pool = ITEMS.filter(x => RARITY_ORDER.indexOf(x.rarity) >= minRank && x.id !== 'supply_cache');
      if (pool.length) {
        const it = weightedPick(rng, pool, (x) => (RARITY_W[x.rarity] || 0.1) * luckMult(x.rarity, luck));
        if (out.length) out[out.length - 1] = { id: it.id, count: countFor(it, rng, t) };
        else out.push({ id: it.id, count: 1 });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- tables
export const TABLES = {
  // generic street / structure scatter
  street: { rolls: [1, 2], entries: [
    { ref: '@ammo', w: 42 }, { ref: '@material', w: 24 }, { ref: '@medical', w: 14 },
    { ref: 'armor_plate', w: 8 }, { ref: '@throwable', w: 8 }, { ref: '@food', w: 8 },
    { ref: '@tool', w: 5 }, { ref: '@attachment', w: 4 }, { ref: '@valuable', w: 3 },
    { ref: 'supply_cache', w: 2 },
  ] },

  // generic container
  container_ammo: { rolls: [2, 3], ammoCount: 70, entries: [
    { ref: 'ammo_crate', w: 26 }, { ref: '@ammo', w: 60 }, { ref: '@material', w: 14 },
  ] },
  container_medical: { rolls: [2, 3], entries: [
    { ref: 'medkit', w: 22 }, { ref: 'bandage', w: 22 }, { ref: 'trauma_kit', w: 10 },
    { ref: 'stim_shot', w: 12 }, { ref: 'regenerator', w: 8 }, { ref: 'blood_pack', w: 6 },
    { ref: 'antidote', w: 10 }, { ref: 'painkiller', w: 8 }, { ref: 'nano_serum', w: 3 },
  ] },
  container_weapon: { rolls: [2, 3], entries: [
    { ref: '@attachment', w: 44 }, { ref: '@ammo', w: 28 }, { ref: 'weapon_parts', w: 20 },
    { ref: 'supply_cache', w: 8 }, { ref: 'wpn_module', w: 6 },
  ] },

  // interior rooms by purpose
  interior_common: { rolls: [1, 2], entries: [
    { ref: '@material', w: 30 }, { ref: '@medical', w: 16 }, { ref: '@ammo', w: 24 },
    { ref: '@food', w: 12 }, { ref: '@tool', w: 9 }, { ref: 'armor_plate', w: 7 },
    { ref: '@valuable', w: 6 },
  ] },
  interior_office: { rolls: [1, 2], entries: [
    { ref: 'electronics', w: 26 }, { ref: 'data_chip', w: 16 }, { ref: '@attachment', w: 16 },
    { ref: '@ammo', w: 18 }, { ref: 'luck_charm', w: 5 }, { ref: 'painkiller', w: 8 },
  ] },
  interior_lab: { rolls: [1, 3], entries: [
    { ref: 'nano_serum', w: 8 }, { ref: 'nano_core', w: 6 }, { ref: 'antidote', w: 12 },
    { ref: 'stim_shot', w: 14 }, { ref: '@tool', w: 16 }, { ref: 'electronics', w: 16 },
    { ref: 'capstone_core', w: 4 },
  ] },
  interior_armory: { rolls: [2, 3], entries: [
    { ref: '@attachment', w: 42 }, { ref: 'weapon_parts', w: 24 }, { ref: 'heavy_barrel', w: 6 },
    { ref: 'explosive_kit', w: 3 }, { ref: '@ammo', w: 20 }, { ref: 'wpn_module', w: 8 },
  ] },

  // enemy drop tables
  enemy_grunt: { rolls: [1, 2], entries: [
    { ref: '@ammo', w: 50 }, { ref: '@material', w: 30 }, { ref: 'medkit', w: 8 },
    { ref: 'armor_plate', w: 6 }, { ref: '@throwable', w: 6 },
  ] },
  enemy_rusher: { rolls: [1, 2], entries: [
    { ref: '@ammo', w: 40 }, { ref: 'stim_shot', w: 12 }, { ref: '@material', w: 24 },
    { ref: 'bandage', w: 12 }, { ref: 'adrenaline', w: 8 },
  ] },
  enemy_heavy: { rolls: [1, 3], entries: [
    { ref: 'armor_plate', w: 20 }, { ref: 'riot_plate', w: 8 }, { ref: 'weapon_parts', w: 16 },
    { ref: '@ammo', w: 28 }, { ref: 'ammo_crate', w: 6 }, { ref: 'overshield', w: 5 },
  ] },
  enemy_sniper: { rolls: [1, 2], entries: [
    { ref: 'reflex_sight', w: 12 }, { ref: 'holo_sight', w: 9 }, { ref: 'thermal_scope', w: 3 },
    { ref: '@ammo', w: 40 }, { ref: 'data_chip', w: 8 }, { ref: 'match_trigger', w: 6 },
  ] },
  enemy_drone: { rolls: [1, 2], entries: [
    { ref: 'electronics', w: 30 }, { ref: '@ammo', w: 30 }, { ref: 'data_chip', w: 12 },
    { ref: 'nano_core', w: 3 }, { ref: 'recon_drone', w: 6 },
  ] },
  enemy_turret: { rolls: [2, 3], entries: [
    { ref: 'weapon_parts', w: 26 }, { ref: 'electronics', w: 20 }, { ref: '@attachment', w: 14 },
    { ref: 'nano_core', w: 5 }, { ref: 'ammo_crate', w: 8 }, { ref: 'auto_turret', w: 4 },
  ] },
  enemy_officer: { rolls: [2, 3], minRarity: 'uncommon', entries: [
    { ref: '@tool', w: 20 }, { ref: '@deployable', w: 14 }, { ref: 'supply_cache', w: 10 },
    { ref: 'nano_core', w: 6 }, { ref: 'capstone_core', w: 4 }, { ref: 'wpn_module', w: 9 },
  ] },
  elite: { rolls: [2, 3], minRarity: 'rare', entries: [
    { ref: '@attachment', w: 20 }, { ref: '@tool', w: 15 }, { ref: 'nano_core', w: 10 },
    { ref: 'gold_bar', w: 10 }, { ref: 'capstone_core', w: 8 }, { ref: 'wpn_module', w: 12 },
    { ref: 'luck_charm', w: 6 }, { ref: 'scavenger_beacon', w: 6 }, { ref: 'respec_chip', w: 5 },
  ] },

  // region themes
  region_core: { rolls: [1, 2], entries: [
    { ref: '@attachment', w: 16 }, { ref: '@tool', w: 12 }, { ref: 'nano_core', w: 7 },
    { ref: '@ammo', w: 24 }, { ref: 'electronics', w: 16 }, { ref: 'overshield', w: 5 },
  ] },
  region_industrial: { rolls: [1, 2], entries: [
    { ref: '@material', w: 26 }, { ref: 'weapon_parts', w: 20 }, { ref: 'electronics', w: 16 },
    { ref: 'ammo_crate', w: 10 }, { ref: '@attachment', w: 10 }, { ref: 'ap_rounds_kit', w: 4 },
  ] },
  region_residential: { rolls: [1, 2], entries: [
    { ref: '@medical', w: 22 }, { ref: '@food', w: 16 }, { ref: '@ammo', w: 30 },
    { ref: '@material', w: 18 }, { ref: 'bandage', w: 12 },
  ] },
  region_slums: { rolls: [1, 3], entries: [
    { ref: '@ammo', w: 32 }, { ref: '@throwable', w: 16 }, { ref: '@material', w: 22 },
    { ref: 'medkit', w: 9 }, { ref: 'frag_grenade', w: 8 },
  ] },
  region_market: { rolls: [1, 2], entries: [
    { ref: '@valuable', w: 16 }, { ref: '@tool', w: 14 }, { ref: '@attachment', w: 14 },
    { ref: '@ammo', w: 22 }, { ref: 'gold_bar', w: 4 }, { ref: 'luck_charm', w: 5 },
  ] },
  region_fringe: { rolls: [1, 3], entries: [
    { ref: '@ammo', w: 28 }, { ref: '@material', w: 22 }, { ref: 'nano_core', w: 6 },
    { ref: '@attachment', w: 10 }, { ref: '@valuable', w: 12 }, { ref: 'capstone_core', w: 3 },
  ] },
};

export function tableForEnemy(typeKey) {
  return TABLES['enemy_' + typeKey] ? 'enemy_' + typeKey : 'enemy_grunt';
}
export function tableForContainer(rand) {
  return rand < 0.5 ? 'container_ammo' : rand < 0.8 ? 'container_medical' : 'container_weapon';
}
