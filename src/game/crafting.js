import { ITEMS_BY_ID } from './items/registry.js';

/**
 * Crafting — converts looted materials + scrap into ammo, attachments, modules
 * and consumables. This is the economic bridge between the loot system and the
 * upgrade tree (weapon parts → mod modules → tree nodes).
 */
export const RECIPES = [
  { id: 'c_ammo_incendiary', name: 'INCENDIARY AMMO', cat: 'ammo', out: { id: 'ammo_incendiary', count: 1 }, cost: { scrap: 40, items: { electronics: 1 } } },
  { id: 'c_ammo_ap', name: 'ARMOUR-PIERCE AMMO', cat: 'ammo', out: { id: 'ammo_ap', count: 1 }, cost: { scrap: 50, items: { weapon_parts: 1 } } },
  { id: 'c_ammo_explosive', name: 'EXPLOSIVE AMMO', cat: 'ammo', out: { id: 'ammo_explosive', count: 1 }, cost: { scrap: 80, items: { electronics: 1, weapon_parts: 1 } } },
  { id: 'c_ammo_void', name: 'VOID AMMO', cat: 'ammo', out: { id: 'ammo_void', count: 1 }, cost: { scrap: 120, items: { nano_core: 1, electronics: 1 } } },

  { id: 'c_medkit', name: 'FIELD MEDKIT', cat: 'medical', out: { id: 'medkit', count: 2 }, cost: { scrap: 30, items: { polymer: 1 } } },
  { id: 'c_stim', name: 'STIM SHOT', cat: 'medical', out: { id: 'stim_shot', count: 2 }, cost: { scrap: 35, items: { electronics: 1 } } },
  { id: 'c_armor', name: 'ARMOUR PLATE', cat: 'armor', out: { id: 'armor_plate', count: 2 }, cost: { scrap: 40, items: { polymer: 2 } } },
  { id: 'c_nanoserum', name: 'NANO SERUM', cat: 'medical', out: { id: 'nano_serum', count: 1 }, cost: { scrap: 200, items: { nano_core: 1, electronics: 2 } } },

  { id: 'c_grenade', name: 'FRAG GRENADES', cat: 'throwable', out: { id: 'frag_grenade', count: 3 }, cost: { scrap: 25, items: { polymer: 1 } } },
  { id: 'c_turret', name: 'AUTO-TURRET', cat: 'deployable', out: { id: 'auto_turret', count: 1 }, cost: { scrap: 120, items: { weapon_parts: 2, electronics: 2 } } },

  { id: 'c_reflex', name: 'REFLEX SIGHT', cat: 'attachment', out: { id: 'reflex_sight', count: 1 }, cost: { scrap: 40, items: { electronics: 1 } } },
  { id: 'c_extmag', name: 'EXTENDED MAG', cat: 'attachment', out: { id: 'extended_mag', count: 1 }, cost: { scrap: 50, items: { polymer: 1, weapon_parts: 1 } } },
  { id: 'c_heavybarrel', name: 'HEAVY BARREL', cat: 'attachment', out: { id: 'heavy_barrel', count: 1 }, cost: { scrap: 120, items: { weapon_parts: 2 } } },

  { id: 'c_module', name: 'WEAPON MODULE (+1 MP)', cat: 'module', out: { id: 'wpn_module', count: 1 }, cost: { scrap: 60, items: { weapon_parts: 1, electronics: 1 } } },
  { id: 'c_capstone', name: 'CAPSTONE CORE (+3 MP)', cat: 'module', out: { id: 'capstone_core', count: 1 }, cost: { scrap: 150, items: { nano_core: 2, electronics: 2 } } },
  { id: 'c_respec', name: 'RESPEC CHIP', cat: 'module', out: { id: 'respec_chip', count: 1 }, cost: { scrap: 100, items: { electronics: 2 } } },
  { id: 'c_luck', name: 'LUCK CHARM', cat: 'tool', out: { id: 'luck_charm', count: 1 }, cost: { scrap: 60, items: { electronics: 1, data_chip: 1 } } },
  { id: 'c_scav', name: 'SCAVENGER BEACON', cat: 'tool', out: { id: 'scavenger_beacon', count: 1 }, cost: { scrap: 60, items: { polymer: 1, data_chip: 1 } } },
];

export function recipe(id) { return RECIPES.find(r => r.id === id); }

export function canCraft(inv, scrap, id) {
  const r = recipe(id);
  if (!r) return { ok: false, why: 'UNKNOWN' };
  if (scrap < r.cost.scrap) return { ok: false, why: 'SCRAP' };
  for (const k in r.cost.items) if (!inv.has(k, r.cost.items[k])) return { ok: false, why: 'MISSING ' + (ITEMS_BY_ID[k] ? ITEMS_BY_ID[k].name : k) };
  let room = inv.maxAdd(r.out.id, r.out.count);
  if (room < r.out.count) {
    const stack = ITEMS_BY_ID[r.out.id].stack || 1;
    for (const k in r.cost.items) {
      let left = r.cost.items[k];
      for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
        const s = inv.slots[i];
        if (!s || s.id !== k) continue;
        const removed = Math.min(left, s.count);
        if (removed === s.count) room += stack;
        left -= removed;
      }
    }
  }
  if (room < r.out.count) return { ok: false, why: 'INVENTORY FULL' };
  return { ok: true, why: '' };
}

/** Perform a craft. Returns { ok, msg }. */
export function craft(game, id) {
  const r = recipe(id);
  if (!r) return { ok: false, msg: 'UNKNOWN RECIPE' };
  const chk = canCraft(game.inventory, game.progression.scrap, id);
  if (!chk.ok) return { ok: false, msg: chk.why === 'SCRAP' ? 'NOT ENOUGH SCRAP' : chk.why };
  game.progression.scrap -= r.cost.scrap;
  for (const k in r.cost.items) game.inventory.remove(k, r.cost.items[k]);
  game.inventory.add(r.out.id, r.out.count);
  return { ok: true, msg: `CRAFTED ${r.out.count}× ${ITEMS_BY_ID[r.out.id].name}` };
}
