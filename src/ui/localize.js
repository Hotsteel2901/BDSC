/**
 * localize — swaps display fields on the shared game registries in place.
 *
 * Gameplay always reads the same fields (`def.name`, `node.desc`, ...); this
 * module keeps the English originals stashed and applies / restores the
 * Chinese translations from `lang/zh-content.js` when the language changes.
 * It also exposes small name lookups for keys that never live on an object
 * (status kinds, network enemy keys, buff labels).
 */

import { ITEMS, ITEMS_BY_ID } from '../game/items/registry.js';
import { AMMO_TYPES, AMMO_BY_ID } from '../game/ammo.js';
import { WEAPONS } from '../game/weapons.js';
import { TREE, BRANCHES } from '../game/progression.js';
import { RECIPES } from '../game/crafting.js';
import { DISTRICTS } from '../game/districts.js';
import { ENEMY_TYPES } from '../game/enemies.js';
import { getLang } from './i18n.js';
import { ZH_CONTENT } from './lang/zh-content.js';

// English archetype name -> type key, captured before any translation runs.
const ENEMY_NAME_TO_KEY = {};
for (const key in ENEMY_TYPES) ENEMY_NAME_TO_KEY[ENEMY_TYPES[key].name] = key;

const originals = new WeakMap();

function origField(obj, field) {
  let map = originals.get(obj);
  if (!map) { map = {}; originals.set(obj, map); }
  if (!(field in map)) map[field] = obj[field];
  return map[field];
}

/** Apply `zhValue` when Chinese is active, otherwise restore the original. */
function tr(obj, field, zhValue) {
  const en = origField(obj, field);
  obj[field] = getLang() === 'zh' && zhValue != null ? zhValue : en;
}

export function applyContentLanguage() {
  const zh = getLang() === 'zh';

  for (const a of AMMO_TYPES) {
    const c = ZH_CONTENT.ammo[a.id];
    tr(a, 'name', c && c.name);
    tr(a, 'desc', c && c.desc);
  }

  for (const it of ITEMS) {
    const c = ZH_CONTENT.item[it.id];
    if (it.ammoType) {
      // Generated ammo items derive their name/description from the round type.
      const a = AMMO_BY_ID[it.ammoType];
      const pct = Math.round((a.dmg ?? 1) * 100);
      tr(it, 'name', `${ZH_CONTENT.ammoItem.prefix}${a.name}`);
      tr(it, 'desc', `${a.desc}  ${ZH_CONTENT.ammoItem.dmgSuffix.replace('{n}', pct)}`);
    } else {
      tr(it, 'name', c && c.name);
      tr(it, 'desc', c && c.desc);
    }
    tr(it, 'cat', ZH_CONTENT.itemCat[origField(it, 'cat')]);
  }

  for (const w of WEAPONS) {
    const c = ZH_CONTENT.weapon[w.id];
    tr(w, 'cat', c && c.cat);
  }

  for (const id in TREE) {
    const c = ZH_CONTENT.tree[id];
    tr(TREE[id], 'name', c && c.name);
    tr(TREE[id], 'desc', c && c.desc);
  }
  for (const br of BRANCHES) tr(br, 'name', ZH_CONTENT.branch[br.id]);
  for (const r of RECIPES) tr(r, 'name', ZH_CONTENT.recipe[r.id]);
  for (const id in DISTRICTS) tr(DISTRICTS[id], 'name', ZH_CONTENT.district[id]);
  for (const key in ENEMY_TYPES) tr(ENEMY_TYPES[key], 'name', ZH_CONTENT.enemy[key]);

  return zh;
}

/* --------------------------- key-based lookups ---------------------------- */

/** Enemy display name from a type key, an English name (network) or a key-ish string. */
export function enemyName(keyOrName) {
  const key = ENEMY_TYPES[keyOrName] ? keyOrName : ENEMY_NAME_TO_KEY[keyOrName];
  if (key) return getLang() === 'zh' ? ZH_CONTENT.enemy[key] : origField(ENEMY_TYPES[key], 'name');
  return keyOrName;
}

export function itemDef(id) { return ITEMS_BY_ID[id]; }

export function statusName(kind) {
  return getLang() === 'zh' ? (ZH_CONTENT.status[kind] || kind) : kind.toUpperCase();
}

export function buffName(label) {
  return getLang() === 'zh' ? (ZH_CONTENT.buff[label] || label) : label;
}

export function slotName(slot) {
  return getLang() === 'zh' ? (ZH_CONTENT.slot[slot] || slot) : slot.toUpperCase();
}

export function grenadeName(kind) {
  if (getLang() !== 'zh') return String(kind).toUpperCase();
  return ZH_CONTENT.grenade[kind] || String(kind).toUpperCase();
}

export function revealName(mode) {
  if (getLang() !== 'zh') return String(mode).toUpperCase();
  return ZH_CONTENT.reveal[mode] || String(mode).toUpperCase();
}

export function weaponName(id) {
  const w = WEAPONS.find(x => x.id === id);
  return w ? w.name : String(id).toUpperCase();
}

export function categoryName(cat) {
  return getLang() === 'zh' ? (ZH_CONTENT.itemCat[cat] || cat) : cat;
}
