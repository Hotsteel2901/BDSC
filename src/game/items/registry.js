import { AMMO_TYPES } from '../ammo.js';

/**
 * Item registry — 70+ distinct items across categories. Every item has:
 *   id, name, cat, rarity, stack, weight, value, icon, desc
 *   model : { parts:[...] }          -> a bespoke procedural 3D model
 *   use   : { type, effect, params } -> a unique gameplay function
 *
 * `use.type`: 'use' (consumable/deployable/tool), 'ammo' (loads a round type),
 *             'attachment' (weapon mod), 'material' (crafting/economy).
 */

export const RARITY_COLORS = {
  common: 0x9aa0a8, uncommon: 0x37ff8b, rare: 0x4da6ff, epic: 0xb46bff, legendary: 0xffb000,
};

const B = (d, c, o = {}) => ({ s: 'box', d, c, ...o });
const C = (d, c, o = {}) => ({ s: 'cyl', d, c, ...o });
const S = (d, c, o = {}) => ({ s: 'sph', d, c, ...o });
const CO = (d, c, o = {}) => ({ s: 'cone', d, c, ...o });
const T = (d, c, o = {}) => ({ s: 'torus', d, c, ...o });
const I = (d, c, o = {}) => ({ s: 'ico', d, c, ...o });
const PX = (d, c, o = {}) => ({ s: 'caps', d, c, ...o });
const position = (p, r) => ({ p, r });

// ---------------------------------------------------------------- ammo items
function ammoItem(a) {
  const stripe = a.color;
  return {
    id: 'ammo_' + a.id,
    name: 'AMMO · ' + a.name,
    cat: 'ammo',
    rarity: a.rarity,
    stack: 999,
    weight: 0.02,
    value: 8,
    icon: '¦',
    desc: a.desc + `  (${Math.round(a.dmg * 100)}% dmg)`,
    ammoType: a.id,
    model: { scale: 0.9, parts: [
      B([0.42, 0.26, 0.3], 0x2b3038, { m: 0.7, ro: 0.5 }),
      B([0.44, 0.06, 0.32], 0x14181d, { p: [0, 0.02, 0] }),
      B([0.1, 0.24, 0.31], stripe, { e: stripe * 0.6, p: [0.14, 0, 0], m: 0.3, ro: 0.4 }),
      CO([0.05, 0.12], 0xd8b46a, { p: [-0.1, 0.2, -0.06], m: 0.9, ro: 0.3 }),
      CO([0.05, 0.12], 0xd8b46a, { p: [-0.1, 0.2, 0.06], m: 0.9, ro: 0.3 }),
      CO([0.05, 0.12], 0xd8b46a, { p: [0.02, 0.2, 0], m: 0.9, ro: 0.3 }),
    ] },
    use: { type: 'ammo', ammo: a.id, amount: a.rarity === 'legendary' || a.rarity === 'epic' ? 45 : a.rarity === 'rare' ? 90 : 160 },
  };
}

// ---------------------------------------------------------------- consumables
const CONSUMABLES = [
  {
    id: 'medkit', name: 'FIELD MEDKIT', cat: 'medical', rarity: 'common', stack: 8, weight: 1.0, value: 25, icon: '+',
    desc: 'Restores 60 health instantly.',
    model: { scale: 1.0, parts: [
      B([0.5, 0.34, 0.34], 0xe8ecef, { ro: 0.5 }),
      B([0.08, 0.34, 0.34], 0x444b52, { p: [0.22, 0, 0] }),
      B([0.24, 0.07, 0.08], 0xff3344, { e: 0x661111, p: [0, 0.01, 0.175] }),
      B([0.08, 0.2, 0.08], 0xff3344, { e: 0x661111, p: [0, 0.01, 0.175] }),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 60 } },
  },
  {
    id: 'bandage', name: 'GAUZE ROLL', cat: 'medical', rarity: 'common', stack: 12, weight: 0.2, value: 6, icon: '=',
    desc: 'Fast, small heal (25).',
    model: { scale: 0.8, parts: [
      C([0.16, 0.16, 0.3, 12], 0xf0efe8, { r: [0, 0, Math.PI / 2] }),
      C([0.08, 0.08, 0.32, 10], 0xd8d4c8, { r: [0, 0, Math.PI / 2] }),
      B([0.1, 0.05, 0.05], 0xff6a6a, {}),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 25 } },
  },
  {
    id: 'trauma_kit', name: 'TRAUMA KIT', cat: 'medical', rarity: 'rare', stack: 5, weight: 1.6, value: 70, icon: '✚',
    desc: 'Full 100 heal and stops bleeding.',
    model: { scale: 1.05, parts: [
      B([0.56, 0.38, 0.36], 0x2e7d5b, { ro: 0.5 }),
      B([0.6, 0.08, 0.4], 0x1c4d38, { p: [0, 0.18, 0] }),
      B([0.3, 0.09, 0.1], 0xff5566, { e: 0x881122, p: [0, 0, 0.185] }),
      B([0.1, 0.26, 0.1], 0xff5566, { e: 0x881122, p: [0, 0, 0.185] }),
      B([0.05, 0.05, 0.05], 0xffcc55, { e: 0x553300, p: [0.26, 0.18, 0.16] }),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 100, cure: ['bleed', 'poison'] } },
  },
  {
    id: 'stim_shot', name: 'STIM SHOT', cat: 'stim', rarity: 'uncommon', stack: 6, weight: 0.3, value: 35, icon: '↑',
    desc: 'Move 30% faster for 20s.',
    model: { scale: 1.0, parts: [
      C([0.05, 0.05, 0.42, 10], 0x9fe8c0, { e: 0x123, r: [0, 0, Math.PI / 2] }),
      C([0.09, 0.09, 0.1, 10], 0x2b6b45, { r: [0, 0, Math.PI / 2], p: [-0.24, 0, 0] }),
      B([0.16, 0.04, 0.04], 0xbfe8cf, { p: [0.16, 0, 0], r: [0, 0, 0] }),
      CO([0.02, 0.14], 0xd8dde2, { p: [0.34, 0, 0], r: [0, 0, -Math.PI / 2], m: 0.9, ro: 0.2 }),
      C([0.05, 0.05, 0.06, 8], 0x37ff8b, { e: 0x37ff8b, p: [-0.05, 0, 0], r: [0, 0, Math.PI / 2] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'stim', dur: 20, label: 'STIM', mods: { speed: 1.3 } } },
  },
  {
    id: 'adrenaline', name: 'ADRENALINE', cat: 'stim', rarity: 'uncommon', stack: 6, weight: 0.3, value: 40, icon: '↯',
    desc: 'Fire 25% faster for 15s.',
    model: { scale: 1.0, parts: [
      C([0.05, 0.05, 0.4, 10], 0xffcf8a, { r: [0, 0, Math.PI / 2] }),
      C([0.09, 0.09, 0.1, 10], 0x7a4a12, { r: [0, 0, Math.PI / 2], p: [-0.23, 0, 0] }),
      B([0.16, 0.04, 0.04], 0xffe0a0, { p: [0.16, 0, 0] }),
      CO([0.02, 0.14], 0xd8dde2, { p: [0.33, 0, 0], r: [0, 0, -Math.PI / 2], m: 0.9, ro: 0.2 }),
      C([0.05, 0.05, 0.06, 8], 0xffb000, { e: 0xffb000, p: [-0.05, 0, 0], r: [0, 0, Math.PI / 2] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'adren', dur: 15, label: 'ADRENALINE', mods: { firerate: 1.25 } } },
  },
  {
    id: 'regenerator', name: 'REGENERATOR', cat: 'medical', rarity: 'uncommon', stack: 5, weight: 0.6, value: 45, icon: '◵',
    desc: 'Regenerate 6 HP/s for 12s.',
    model: { scale: 1.0, parts: [
      C([0.16, 0.16, 0.36, 12], 0xdfe6ea, { m: 0.6 }),
      C([0.18, 0.18, 0.06, 12], 0x37ff8b, { e: 0x1b7a44, p: [0, 0.2, 0] }),
      C([0.18, 0.18, 0.06, 12], 0x37ff8b, { e: 0x1b7a44, p: [0, -0.2, 0] }),
      B([0.1, 0.12, 0.02], 0x1b7a44, { p: [0, 0, 0.17], e: 0x0a3a20 }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'regen', dur: 12, label: 'REGEN', mods: { regen: 6 } } },
  },
  {
    id: 'blood_pack', name: 'BLOOD PACK', cat: 'medical', rarity: 'rare', stack: 4, weight: 0.8, value: 65, icon: '●',
    desc: 'Heal 40 and permanently raise max HP by 10.',
    model: { scale: 1.0, parts: [
      B([0.36, 0.46, 0.22], 0xb02030, { ro: 0.4 }),
      B([0.4, 0.06, 0.24], 0x7a1522, { p: [0, 0.22, 0] }),
      C([0.03, 0.03, 0.2, 8], 0xdddddd, { p: [0.12, -0.28, 0], r: [0.4, 0, 0] }),
      B([0.14, 0.14, 0.02], 0xffffff, { p: [0, 0, 0.115], e: 0x333333 }),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 40, maxhp: 10 } },
  },
  {
    id: 'nano_serum', name: 'NANO SERUM', cat: 'medical', rarity: 'epic', stack: 3, weight: 0.4, value: 130, icon: '◈',
    desc: 'Permanently raise max HP by 25.',
    model: { scale: 1.0, parts: [
      C([0.12, 0.12, 0.44, 12], 0xcfe0ff, { o: 0.7, ro: 0.1 }),
      C([0.1, 0.1, 0.4, 10], 0x37ff8b, { e: 0x0f5a33 }),
      C([0.11, 0.11, 0.1, 10], 0x30363c, { p: [0, 0.26, 0], m: 0.8 }),
      C([0.03, 0.03, 0.05, 8], 0xffffff, { e: 0x88ffcc, p: [0, 0.32, 0] }),
    ] },
    use: { type: 'use', effect: 'maxhp', params: { amount: 25 } },
  },
  {
    id: 'combat_focus', name: 'COMBAT FOCUS', cat: 'stim', rarity: 'rare', stack: 5, weight: 0.3, value: 55, icon: '◆',
    desc: 'Deal 20% more damage for 20s.',
    model: { scale: 0.9, parts: [
      C([0.09, 0.09, 0.28, 10], 0xff4d6d, { r: [0, 0, Math.PI / 2], e: 0x400 } ),
      C([0.09, 0.09, 0.28, 10], 0x2a3038, { r: [0, 0, Math.PI / 2], p: [0.28, 0, 0] }),
      T([0.1, 0.02], 0xff4d6d, { e: 0x701, r: [0, Math.PI / 2, 0], p: [-0.18, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'focus', dur: 20, label: 'FOCUS', mods: { damage: 1.2 } } },
  },
  {
    id: 'antidote', name: 'ANTIDOTE', cat: 'medical', rarity: 'common', stack: 8, weight: 0.3, value: 20, icon: '✧',
    desc: 'Cures poison, burn and corrosion; heals 20.',
    model: { scale: 1.0, parts: [
      C([0.09, 0.09, 0.36, 12], 0xbfe6d0, { o: 0.7 }),
      C([0.07, 0.07, 0.3, 10], 0x3bbf7a, { e: 0x123 }),
      C([0.1, 0.1, 0.08, 10], 0x30363c, { p: [0, 0.22, 0], m: 0.8 }),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 20, cure: ['poison', 'burn', 'corrode'] } },
  },
  {
    id: 'painkiller', name: 'PAINKILLER', cat: 'medical', rarity: 'uncommon', stack: 8, weight: 0.2, value: 22, icon: '⊘',
    desc: 'Take 25% less damage for 15s.',
    model: { scale: 0.7, parts: [
      B([0.36, 0.04, 0.22], 0xd8dde2, { ro: 0.2, m: 0.2 }),
      B([0.1, 0.05, 0.06], 0x88bbff, { e: 0x112244, p: [-0.09, 0.04, 0] }),
      B([0.1, 0.05, 0.06], 0x88bbff, { e: 0x112244, p: [0.09, 0.04, 0] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'pain', dur: 15, label: 'PAINKILLER', mods: { dmgResist: 0.75 } } },
  },
  {
    id: 'energy_drink', name: 'ENERGY DRINK', cat: 'food', rarity: 'common', stack: 10, weight: 0.5, value: 12, icon: '⚡',
    desc: 'Faster + regenerating for 12s.',
    model: { scale: 1.0, parts: [
      C([0.11, 0.11, 0.4, 14], 0x22cc88, { m: 0.7, ro: 0.35 }),
      C([0.12, 0.12, 0.04, 14], 0xb8c2c8, { p: [0, 0.22, 0], m: 0.9, ro: 0.2 }),
      B([0.12, 0.14, 0.02], 0xffe14d, { p: [0, 0, 0.111], e: 0x554400 }),
      T([0.05, 0.01], 0xb8c2c8, { p: [0, 0.24, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'energy', dur: 12, label: 'ENERGISED', mods: { speed: 1.15, regen: 3 } } },
  },
  {
    id: 'ration_pack', name: 'RATION PACK', cat: 'food', rarity: 'common', stack: 10, weight: 0.6, value: 15, icon: '▤',
    desc: 'Heal 30 and regenerate for 8s.',
    model: { scale: 0.9, parts: [
      B([0.44, 0.3, 0.16], 0x6b5636, { ro: 0.8 }),
      B([0.46, 0.06, 0.18], 0x3f3320, { p: [0, 0.16, 0] }),
      B([0.18, 0.1, 0.02], 0xe0c060, { p: [0, 0, 0.081], e: 0x443300 }),
    ] },
    use: { type: 'use', effect: 'heal', params: { amount: 30, buff: { id: 'ration', dur: 8, label: 'FED', mods: { regen: 4 } } } },
  },
];

// ---------------------------------------------------------------- shields/armour
const ARMOR = [
  {
    id: 'armor_plate', name: 'ARMOUR PLATE', cat: 'armor', rarity: 'common', stack: 8, weight: 1.4, value: 30, icon: '⬛',
    desc: 'Adds 40 armour.',
    model: { scale: 1.0, parts: [
      B([0.5, 0.56, 0.1], 0x5a626b, { m: 0.7, ro: 0.45 }),
      B([0.42, 0.46, 0.04], 0x3c444c, { p: [0, 0, 0.07] }),
      S([0.03], 0x9aa0a8, { p: [-0.16, 0.18, 0.08], m: 0.9 }),
      S([0.03], 0x9aa0a8, { p: [0.16, 0.18, 0.08], m: 0.9 }),
      S([0.03], 0x9aa0a8, { p: [-0.16, -0.18, 0.08], m: 0.9 }),
      S([0.03], 0x9aa0a8, { p: [0.16, -0.18, 0.08], m: 0.9 }),
    ] },
    use: { type: 'use', effect: 'armor', params: { amount: 40 } },
  },
  {
    id: 'riot_plate', name: 'RIOT PLATE', cat: 'armor', rarity: 'rare', stack: 4, weight: 2.6, value: 80, icon: '▣',
    desc: 'Adds 80 armour.',
    model: { scale: 1.1, parts: [
      B([0.62, 0.7, 0.16], 0x3a4048, { m: 0.75, ro: 0.4 }),
      B([0.5, 0.56, 0.06], 0x22272d, { p: [0, 0, 0.11] }),
      B([0.66, 0.12, 0.2], 0x2a2f36, { p: [0, 0.28, -0.02] }),
      C([0.03, 0.03, 0.3, 8], 0x15181c, { p: [0, 0, 0.16], r: [0, 0, Math.PI / 2], m: 0.6 }),
    ] },
    use: { type: 'use', effect: 'armor', params: { amount: 80 } },
  },
  {
    id: 'overshield', name: 'OVERSHIELD EMITTER', cat: 'shield', rarity: 'epic', stack: 3, weight: 1.0, value: 120, icon: '◍',
    desc: 'Grants 60 temporary shield that decays over 20s.',
    model: { scale: 1.0, parts: [
      B([0.36, 0.14, 0.36], 0x2b3038, { m: 0.7 }),
      S([0.2], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.16, 0], o: 0.8 }),
      T([0.24, 0.02], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.14, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'shield', params: { amount: 60, dur: 20, decay: 3 } },
  },
  {
    id: 'reactive_plating', name: 'REACTIVE PLATING', cat: 'shield', rarity: 'rare', stack: 3, weight: 1.2, value: 90, icon: '✳',
    desc: 'Deflect damage back at attackers for 30s.',
    model: { scale: 1.0, parts: [
      B([0.46, 0.5, 0.12], 0x4a4030, { m: 0.7, ro: 0.5 }),
      CO([0.05, 0.16], 0xffb000, { e: 0x553300, p: [-0.14, 0.16, 0.09] }),
      CO([0.05, 0.16], 0xffb000, { e: 0x553300, p: [0.14, 0.16, 0.09] }),
      CO([0.05, 0.16], 0xffb000, { e: 0x553300, p: [0, -0.16, 0.09] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'thorns', dur: 30, label: 'REACTIVE', mods: { thorns: 0.6 } } },
  },
  {
    id: 'kinetic_barrier', name: 'KINETIC BARRIER', cat: 'shield', rarity: 'epic', stack: 3, weight: 1.0, value: 110, icon: '⬡',
    desc: 'Absorbs the next 120 damage (short duration).',
    model: { scale: 1.0, parts: [
      C([0.16, 0.16, 0.1, 6], 0x1a3a4a, { p: [0, -0.16, 0] }),
      I([0.22], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.1, 0], o: 0.85 }),
      T([0.26, 0.015], 0x9fe8ff, { e: 0x226688, p: [0, -0.05, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'shield', params: { amount: 120, dur: 10, decay: 0 } },
  },
  {
    id: 'nano_weave', name: 'NANO WEAVE', cat: 'armor', rarity: 'epic', stack: 3, weight: 0.8, value: 140, icon: '▦',
    desc: 'Permanently raise max armour by 30.',
    model: { scale: 0.9, parts: [
      C([0.16, 0.16, 0.34, 12], 0x6a7078, { r: [0, 0, Math.PI / 2], m: 0.6, ro: 0.5 }),
      C([0.17, 0.17, 0.1, 12], 0x37ff8b, { e: 0x0f5a33, r: [0, 0, Math.PI / 2], p: [0.1, 0, 0] }),
      B([0.28, 0.02, 0.02], 0x37ff8b, { e: 0x0f5a33, p: [-0.02, 0.14, 0] }),
    ] },
    use: { type: 'use', effect: 'maxarmor', params: { amount: 30 } },
  },
];

// ---------------------------------------------------------------- throwables
const THROWABLES = [
  { id: 'frag_grenade', name: 'FRAG GRENADE', cat: 'throwable', rarity: 'common', stack: 6, weight: 0.5, value: 25, icon: '✦', desc: 'Adds 2 fragmentation grenades.', grenade: 'frag',
    model: { scale: 1.0, parts: [
      S([0.17], 0x3f4a3a), S([0.175], 0x2c3428, { p: [0, 0.02, 0] }),
      C([0.05, 0.05, 0.1, 8], 0x9aa0a8, { p: [0, 0.2, 0], m: 0.9 }),
      B([0.14, 0.02, 0.02], 0xdddddd, { p: [0.1, 0.18, 0], r: [0, 0, 0.5] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'frag', count: 2 } } },
  { id: 'incendiary_grenade', name: 'INCENDIARY GRENADE', cat: 'throwable', rarity: 'uncommon', stack: 5, weight: 0.5, value: 35, icon: '✷', desc: 'Adds 2 incendiary grenades.',
    model: { scale: 1.0, parts: [
      C([0.16, 0.16, 0.34, 12], 0x8a2418, { ro: 0.4, m: 0.5 }),
      C([0.17, 0.17, 0.06, 12], 0xff6a22, { e: 0x6a2200, p: [0, 0.12, 0] }),
      C([0.17, 0.17, 0.06, 12], 0xff6a22, { e: 0x6a2200, p: [0, -0.12, 0] }),
      B([0.12, 0.02, 0.02], 0xffcf66, { e: 0x553300, p: [0, 0.2, 0] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'incendiary', count: 2 } } },
  { id: 'emp_grenade', name: 'EMP GRENADE', cat: 'throwable', rarity: 'uncommon', stack: 5, weight: 0.5, value: 40, icon: '⌁', desc: 'Adds 2 EMP grenades that stun machines.',
    model: { scale: 1.0, parts: [
      C([0.15, 0.15, 0.36, 12], 0x2a3a5a, { ro: 0.4, m: 0.6 }),
      C([0.16, 0.16, 0.04, 12], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.14, 0] }),
      C([0.16, 0.16, 0.04, 12], 0x4de0ff, { e: 0x0d5a7a, p: [0, -0.14, 0] }),
      T([0.09, 0.02], 0x66ddff, { e: 0x116688, p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'emp', count: 2 } } },
  { id: 'smoke_grenade', name: 'SMOKE GRENADE', cat: 'throwable', rarity: 'common', stack: 6, weight: 0.5, value: 20, icon: '≋', desc: 'Adds 2 smoke grenades.', grenade: 'smoke',
    model: { scale: 1.0, parts: [
      C([0.14, 0.14, 0.36, 12], 0x565b60, { ro: 0.5, m: 0.4 }),
      C([0.145, 0.145, 0.04, 12], 0xb8c2c8, { p: [0, 0.12, 0] }),
      C([0.145, 0.145, 0.04, 12], 0xb8c2c8, { p: [0, -0.12, 0] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'smoke', count: 2 } } },
  { id: 'flashbang', name: 'FLASHBANG', cat: 'throwable', rarity: 'common', stack: 6, weight: 0.4, value: 22, icon: '☀', desc: 'Adds 2 flashbangs that blind hostiles.',
    model: { scale: 1.0, parts: [
      C([0.13, 0.13, 0.34, 12], 0xd8dde2, { ro: 0.3, m: 0.4 }),
      C([0.135, 0.135, 0.04, 12], 0xffffff, { e: 0x888888, p: [0, 0.1, 0] }),
      C([0.135, 0.135, 0.04, 12], 0xffffff, { e: 0x888888, p: [0, -0.1, 0] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'flash', count: 2 } } },
  { id: 'cryo_grenade', name: 'CRYO GRENADE', cat: 'throwable', rarity: 'rare', stack: 4, weight: 0.5, value: 55, icon: '❄', desc: 'Adds 2 cryo grenades that freeze a radius.',
    model: { scale: 1.0, parts: [
      C([0.15, 0.15, 0.34, 12], 0x22506a, { ro: 0.35, m: 0.5 }),
      I([0.12], 0x9fe8ff, { e: 0x226688, p: [0, 0.16, 0], o: 0.9 }),
      I([0.1], 0x9fe8ff, { e: 0x226688, p: [0.1, -0.1, 0.06], o: 0.9 }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'cryo', count: 2 } } },
  { id: 'cluster_grenade', name: 'CLUSTER GRENADE', cat: 'throwable', rarity: 'epic', stack: 4, weight: 0.7, value: 90, icon: '✸', desc: 'Adds 2 cluster grenades (multi-detonation).',
    model: { scale: 1.0, parts: [
      C([0.16, 0.16, 0.3, 10], 0x4a3a2a, { ro: 0.5 }),
      S([0.07], 0xffaa55, { e: 0x553300, p: [0.11, 0.12, 0.08] }),
      S([0.07], 0xffaa55, { e: 0x553300, p: [-0.11, 0.12, -0.06] }),
      S([0.07], 0xffaa55, { e: 0x553300, p: [0, -0.12, 0.1] }),
    ] },
    use: { type: 'use', effect: 'grenade', params: { kind: 'cluster', count: 2 } } },
  { id: 'proximity_mine', name: 'PROXIMITY MINE', cat: 'deployable', rarity: 'uncommon', stack: 6, weight: 0.8, value: 45, icon: '◉', desc: 'Deploy an arming proximity mine.',
    model: { scale: 1.0, parts: [
      C([0.2, 0.22, 0.1, 16], 0x3a3f45, { m: 0.7 }),
      C([0.08, 0.08, 0.08, 10], 0xff3322, { e: 0xff3322, p: [0, 0.09, 0] }),
      CO([0.02, 0.08], 0x9aa0a8, { p: [0.14, 0, 0], r: [0, 0, -Math.PI / 2], m: 0.9 }),
      CO([0.02, 0.08], 0x9aa0a8, { p: [-0.14, 0, 0], r: [0, 0, Math.PI / 2], m: 0.9 }),
      CO([0.02, 0.08], 0x9aa0a8, { p: [0, 0, 0.14], r: [Math.PI / 2, 0, 0], m: 0.9 }),
    ] },
    use: { type: 'use', effect: 'deploy', params: { kind: 'mine' } } },
];

// ---------------------------------------------------------------- gadgets
const GADGETS = [
  { id: 'auto_turret', name: 'AUTO-TURRET', cat: 'deployable', rarity: 'rare', stack: 4, weight: 3.0, value: 100, icon: '⌖', desc: 'Deploy an allied turret that engages hostiles.',
    model: { scale: 1.0, parts: [
      C([0.24, 0.28, 0.12, 12], 0x2b3038, { m: 0.7 }),
      B([0.3, 0.26, 0.3], 0x3f464e, { p: [0, 0.2, 0], m: 0.6 }),
      C([0.05, 0.06, 0.36, 8], 0x22272d, { p: [0, 0.22, -0.26], r: [Math.PI / 2, 0, 0], m: 0.8 }),
      B([0.12, 0.06, 0.05], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.32, 0] }),
    ] },
    use: { type: 'use', effect: 'deploy', params: { kind: 'turret' } } },
  { id: 'assault_drone', name: 'ASSAULT DRONE', cat: 'deployable', rarity: 'epic', stack: 3, weight: 2.0, value: 150, icon: '✈', desc: 'Deploy an allied combat drone.',
    model: { scale: 1.0, parts: [
      B([0.34, 0.16, 0.44], 0x30363c, { m: 0.6 }),
      S([0.1], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.02, 0.2] }),
      C([0.03, 0.03, 0.34, 8], 0x22272d, { p: [0.24, 0.1, 0], r: [0, 0, Math.PI / 2] }),
      C([0.03, 0.03, 0.34, 8], 0x22272d, { p: [-0.24, 0.1, 0], r: [0, 0, Math.PI / 2] }),
      C([0.1, 0.1, 0.02, 10], 0x9aa0a8, { p: [0.4, 0.14, 0], m: 0.8 }),
      C([0.1, 0.1, 0.02, 10], 0x9aa0a8, { p: [-0.4, 0.14, 0], m: 0.8 }),
    ] },
    use: { type: 'use', effect: 'deploy', params: { kind: 'drone' } } },
  { id: 'recon_drone', name: 'RECON DRONE', cat: 'tool', rarity: 'uncommon', stack: 4, weight: 1.0, value: 60, icon: '◎', desc: 'Marks every nearby hostile for 15s.',
    model: { scale: 0.9, parts: [
      I([0.16], 0x3a5a4a, { m: 0.5 }),
      S([0.07], 0x37ff8b, { e: 0x0f5a33, p: [0, 0, 0.14] }),
      C([0.02, 0.02, 0.3, 8], 0x22272d, { p: [0.16, 0.06, 0], r: [0, 0, Math.PI / 2] }),
      C([0.02, 0.02, 0.3, 8], 0x22272d, { p: [-0.16, 0.06, 0], r: [0, 0, Math.PI / 2] }),
      C([0.06, 0.06, 0.01, 8], 0x9aa0a8, { p: [0.3, 0.1, 0] }),
      C([0.06, 0.06, 0.01, 8], 0x9aa0a8, { p: [-0.3, 0.1, 0] }),
    ] },
    use: { type: 'use', effect: 'reveal', params: { mode: 'mark', dur: 15, radius: 70 } } },
  { id: 'holo_decoy', name: 'HOLO DECOY', cat: 'deployable', rarity: 'rare', stack: 4, weight: 1.0, value: 85, icon: '◊', desc: 'Projects a decoy that lures hostiles for 10s.',
    model: { scale: 1.0, parts: [
      C([0.22, 0.24, 0.1, 12], 0x2b3038, { m: 0.7 }),
      CO([0.16, 0.34], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.28, 0], o: 0.6 }),
      T([0.2, 0.02], 0x9fe8ff, { e: 0x226688, p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'deploy', params: { kind: 'decoy' } } },
  { id: 'barrier_deployer', name: 'BARRIER DEPLOYER', cat: 'deployable', rarity: 'rare', stack: 4, weight: 2.0, value: 80, icon: '▥', desc: 'Deploys a solid cover wall.',
    model: { scale: 1.0, parts: [
      C([0.2, 0.2, 0.34, 10], 0x30463a, { m: 0.6 }),
      B([0.36, 0.28, 0.04], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0, 0.19], o: 0.8 }),
      C([0.05, 0.05, 0.06, 8], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.2, 0] }),
    ] },
    use: { type: 'use', effect: 'deploy', params: { kind: 'barrier' } } },
  { id: 'xray_scanner', name: 'X-RAY SCANNER', cat: 'tool', rarity: 'rare', stack: 4, weight: 0.8, value: 70, icon: '▤', desc: 'See hostiles through walls for 15s.',
    model: { scale: 0.9, parts: [
      B([0.4, 0.3, 0.05], 0x1a1f24, { m: 0.5 }),
      B([0.34, 0.24, 0.01], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0, 0.031] }),
      B([0.42, 0.02, 0.06], 0x30363c, { p: [0, 0.16, 0] }),
    ] },
    use: { type: 'use', effect: 'reveal', params: { mode: 'xray', dur: 15 } } },
  { id: 'radar_pulse', name: 'RADAR PULSE', cat: 'tool', rarity: 'uncommon', stack: 5, weight: 0.7, value: 50, icon: '◔', desc: 'Reveals hostiles on the map for 25s.',
    model: { scale: 0.9, parts: [
      C([0.22, 0.24, 0.06, 16], 0x2b3038, { m: 0.6 }),
      C([0.02, 0.02, 0.28, 8], 0x9aa0a8, { p: [0, 0.18, 0], m: 0.8 }),
      S([0.06], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.33, 0] }),
      T([0.16, 0.015], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.04, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'reveal', params: { mode: 'radar', dur: 25 } } },
  { id: 'blink_module', name: 'BLINK MODULE', cat: 'tool', rarity: 'rare', stack: 5, weight: 0.6, value: 75, icon: '⇢', desc: 'Teleport 18m forward.',
    model: { scale: 0.9, parts: [
      B([0.32, 0.32, 0.32], 0x22272d, { m: 0.7, ro: 0.4 }),
      I([0.14], 0xb46bff, { e: 0x4a1a7a, p: [0, 0, 0], o: 0.9 }),
      T([0.19, 0.02], 0xb46bff, { e: 0x4a1a7a, p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'blink', params: { distance: 18 } } },
  { id: 'time_dilation', name: 'TIME DILATION', cat: 'tool', rarity: 'epic', stack: 3, weight: 0.8, value: 160, icon: '⧗', desc: 'Slows time by 55% for 6s.',
    model: { scale: 1.0, parts: [
      C([0.09, 0.2, 0.22, 10], 0x2a3a5a, { e: 0x112244, p: [0, 0.16, 0] }),
      C([0.2, 0.09, 0.22, 10], 0x2a3a5a, { e: 0x112244, p: [0, -0.16, 0] }),
      T([0.1, 0.015], 0x4de0ff, { e: 0x226688, p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'timescale', params: { scale: 0.45, dur: 6 } } },
  { id: 'cloak_field', name: 'CLOAK FIELD', cat: 'tool', rarity: 'epic', stack: 3, weight: 0.8, value: 150, icon: '◌', desc: 'Become invisible to hostiles for 12s.',
    model: { scale: 1.0, parts: [
      B([0.3, 0.36, 0.2], 0x2b3038, { m: 0.6 }),
      CO([0.16, 0.3], 0x9fe8ff, { e: 0x226688, p: [0, 0.3, 0], o: 0.45 }),
      S([0.07], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0, 0.11] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'cloak', dur: 12, label: 'CLOAKED', mods: { invis: 1 } } } },
  { id: 'repair_kit', name: 'REPAIR KIT', cat: 'tool', rarity: 'uncommon', stack: 5, weight: 1.2, value: 55, icon: '⌗', desc: 'Restore 50 armour and 30 health.',
    model: { scale: 1.0, parts: [
      B([0.46, 0.3, 0.26], 0xb04030, { ro: 0.5 }),
      B([0.48, 0.04, 0.28], 0x7a2a1e, { p: [0, 0.16, 0] }),
      C([0.02, 0.02, 0.26, 6], 0xc8ccd0, { p: [0.1, 0, 0.16], r: [Math.PI / 2, 0, 0], m: 0.9 }),
      S([0.05], 0xc8ccd0, { p: [0.1, 0, 0.29], m: 0.9 }),
    ] },
    use: { type: 'use', effect: 'repair', params: { armor: 50, health: 30 } } },
  { id: 'jump_jets', name: 'JUMP JETS', cat: 'tool', rarity: 'uncommon', stack: 4, weight: 0.9, value: 60, icon: '↥', desc: 'Greatly increased jump for 18s.',
    model: { scale: 1.0, parts: [
      C([0.1, 0.12, 0.3, 10], 0x30363c, { m: 0.6, r: [0, 0, Math.PI / 2] }),
      C([0.11, 0.11, 0.05, 10], 0xff8833, { e: 0x7a3300, p: [0.16, 0, 0], r: [0, 0, Math.PI / 2] }),
      C([0.11, 0.11, 0.05, 10], 0xff8833, { e: 0x7a3300, p: [-0.16, 0, 0], r: [0, 0, Math.PI / 2] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'jets', dur: 18, label: 'JUMP JETS', mods: { jump: 2.0 } } } },
  { id: 'dash_module', name: 'DASH MODULE', cat: 'tool', rarity: 'common', stack: 8, weight: 0.4, value: 25, icon: '»', desc: 'Instantly dash forward.',
    model: { scale: 0.9, parts: [
      B([0.3, 0.06, 0.14], 0x30363c, { m: 0.6 }),
      CO([0.06, 0.18], 0x4de0ff, { e: 0x0d5a7a, p: [0.22, 0, 0], r: [0, 0, -Math.PI / 2] }),
      CO([0.06, 0.18], 0x4de0ff, { e: 0x0d5a7a, p: [-0.22, 0, 0], r: [0, 0, Math.PI / 2] }),
    ] },
    use: { type: 'use', effect: 'dash', params: { distance: 10 } } },
  { id: 'ammo_crate', name: 'AMMO CRATE', cat: 'ammo', rarity: 'uncommon', stack: 4, weight: 3.0, value: 60, icon: '▩', desc: 'Refills 50% of every weapon reserve.',
    model: { scale: 1.0, parts: [
      B([0.52, 0.36, 0.4], 0x4a5030, { m: 0.4, ro: 0.6 }),
      B([0.54, 0.06, 0.42], 0x323620, { p: [0, 0.18, 0] }),
      B([0.2, 0.12, 0.02], 0xffd400, { e: 0x554400, p: [0, 0, 0.201] }),
    ] },
    use: { type: 'use', effect: 'ammoReserve', params: { frac: 0.5 } } },
];

// ---------------------------------------------------------------- attachments
function attachment(id, name, slot, rarity, value, desc, mods, model) {
  return { id, name, cat: 'attachment', slot, rarity, stack: 4, weight: 0.6, value, icon: '⚙', desc, model, use: { type: 'attachment', slot, mods } };
}
const ATTACHMENTS = [
  attachment('muzzle_brake', 'MUZZLE BRAKE', 'muzzle', 'common', 45, 'Recoil −22%.', { recoilMul: 0.78 },
    { scale: 0.9, parts: [ C([0.06, 0.06, 0.22, 10], 0x30363c, { m: 0.8, r: [Math.PI / 2, 0, 0] }), C([0.07, 0.07, 0.04, 10], 0x4a5058, { p: [0, 0, 0.09], r: [Math.PI / 2, 0, 0], m: 0.8 }), B([0.14, 0.02, 0.06], 0x15181c, { p: [0, 0, 0.06] }) ] }),
  attachment('suppressor', 'SUPPRESSOR', 'muzzle', 'uncommon', 70, 'Silent, tighter spread, −10% damage.', { recoilMul: 0.85, spreadMul: 0.85, dmgMul: 0.9, silent: true },
    { scale: 0.95, parts: [ C([0.07, 0.07, 0.4, 12], 0x1c2024, { m: 0.7, r: [Math.PI / 2, 0, 0] }), C([0.075, 0.075, 0.04, 12], 0x2b3038, { p: [0, 0, 0.18], r: [Math.PI / 2, 0, 0], m: 0.7 }) ] }),
  attachment('compensator', 'COMPENSATOR', 'muzzle', 'common', 50, 'Spread −28%, recoil −8%.', { spreadMul: 0.72, recoilMul: 0.92 },
    { scale: 0.9, parts: [ C([0.06, 0.06, 0.2, 8], 0x3a4048, { m: 0.8, r: [Math.PI / 2, 0, 0] }), B([0.03, 0.1, 0.04], 0x22272d, { p: [0.06, 0, 0.05] }), B([0.03, 0.1, 0.04], 0x22272d, { p: [-0.06, 0, 0.05] }) ] }),
  attachment('extended_mag', 'EXTENDED MAG', 'magazine', 'common', 45, 'Magazine +35%.', { magMul: 1.35 },
    { scale: 0.9, parts: [ B([0.16, 0.34, 0.1], 0x2b3038, { m: 0.6 }), B([0.17, 0.04, 0.11], 0x4a5058, { p: [0, 0.16, 0] }) ] }),
  attachment('fast_mag', 'FAST MAG', 'magazine', 'uncommon', 65, 'Reload −30%.', { reloadMul: 0.7 },
    { scale: 0.9, parts: [ B([0.16, 0.28, 0.1], 0x30363c, { m: 0.6 }), B([0.04, 0.3, 0.12], 0x4de0ff, { e: 0x0d5a7a, p: [0.09, 0, 0] }) ] }),
  attachment('drum_mag', 'DRUM MAG', 'magazine', 'rare', 110, 'Magazine +120%, reload +40%.', { magMul: 2.2, reloadMul: 1.4 },
    { scale: 1.0, parts: [ C([0.2, 0.2, 0.14, 14], 0x2b3038, { m: 0.6, r: [Math.PI / 2, 0, 0] }), C([0.21, 0.21, 0.03, 14], 0x15181c, { p: [0, 0, 0.08], r: [Math.PI / 2, 0, 0] }) ] }),
  attachment('reflex_sight', 'REFLEX SIGHT', 'optic', 'common', 40, 'ADS spread −25%.', { adsSpreadMul: 0.75 },
    { scale: 0.85, parts: [ B([0.14, 0.1, 0.06], 0x22272d, { m: 0.6 }), B([0.1, 0.08, 0.01], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.01, 0.036] }) ] }),
  attachment('holo_sight', 'HOLOGRAPHIC SIGHT', 'optic', 'uncommon', 60, 'ADS spread −40%, slight zoom.', { adsSpreadMul: 0.6, adsZoom: 1.15 },
    { scale: 0.9, parts: [ B([0.16, 0.12, 0.07], 0x2b3038, { m: 0.6 }), B([0.12, 0.1, 0.01], 0x4de0ff, { e: 0x0d5a7a, p: [0, 0.01, 0.04] }) ] }),
  attachment('thermal_scope', 'THERMAL SCOPE', 'optic', 'epic', 160, 'Strong zoom; tags targets.', { adsZoom: 2.2, adsSpreadMul: 0.35, reveal: true, statusOnHit: { kind: 'mark', dur: 6, chance: 1 } },
    { scale: 1.0, parts: [ C([0.08, 0.08, 0.34, 12], 0x1c2024, { m: 0.6, r: [Math.PI / 2, 0, 0] }), C([0.09, 0.09, 0.03, 12], 0xff6a22, { e: 0x7a2200, p: [0, 0, 0.18], r: [Math.PI / 2, 0, 0] }) ] }),
  attachment('laser_sight', 'LASER SIGHT', 'underbarrel', 'common', 35, 'Hipfire spread −20%.', { spreadMul: 0.8 },
    { scale: 0.8, parts: [ B([0.06, 0.06, 0.14], 0x22272d, { m: 0.5 }), S([0.02], 0xff2222, { e: 0xff2222, p: [0, 0, 0.08] }) ] }),
  attachment('angled_grip', 'ANGLED GRIP', 'underbarrel', 'common', 40, 'Recoil −15%.', { recoilMul: 0.85 },
    { scale: 0.85, parts: [ B([0.08, 0.2, 0.1], 0x22272d, { m: 0.4, r: [0.3, 0, 0] }), B([0.09, 0.03, 0.11], 0x2b3038, { p: [0, 0.1, 0] }) ] }),
  attachment('match_trigger', 'MATCH TRIGGER', 'grip', 'uncommon', 75, 'Fire rate +18%.', { rateMul: 1.18 },
    { scale: 0.8, parts: [ B([0.12, 0.06, 0.16], 0x30363c, { m: 0.7 }), B([0.03, 0.1, 0.03], 0xffb000, { e: 0x553300, p: [0, -0.06, 0.04] }) ] }),
  attachment('heavy_barrel', 'HEAVY BARREL', 'muzzle', 'rare', 120, 'Damage +18%, recoil +25%.', { dmgMul: 1.18, recoilMul: 1.25 },
    { scale: 1.0, parts: [ C([0.07, 0.07, 0.5, 12], 0x1c2024, { m: 0.8, r: [Math.PI / 2, 0, 0] }), C([0.085, 0.085, 0.1, 12], 0x4a5058, { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0], m: 0.8 }) ] }),
  attachment('ap_rounds_kit', 'AP ROUNDS KIT', 'underbarrel', 'rare', 130, 'Armour penetration +35%.', { penAdd: 0.35, dmgMul: 0.95 },
    { scale: 0.85, parts: [ B([0.2, 0.12, 0.14], 0x3a4048, { m: 0.6 }), CO([0.04, 0.12], 0xd8b46a, { p: [-0.05, 0.1, 0], m: 0.9 }), CO([0.04, 0.12], 0xd8b46a, { p: [0.05, 0.1, 0], m: 0.9 }) ] }),
  attachment('explosive_kit', 'EXPLOSIVE ROUNDS KIT', 'underbarrel', 'epic', 190, 'Rounds explode on impact.', { aoeAdd: 1.6, dmgMul: 0.95 },
    { scale: 0.9, parts: [ B([0.2, 0.14, 0.16], 0x4a3a2a, { m: 0.6 }), S([0.05], 0xff8833, { e: 0x7a3300, p: [0, 0.12, 0] }) ] }),
];

// ---------------------------------------------------------------- materials
const MATERIALS = [
  { id: 'scrap_metal', name: 'SCRAP METAL', cat: 'material', rarity: 'common', stack: 999, weight: 0.05, value: 6, icon: '▪', desc: 'Salvage. Converts to 6 scrap.',
    model: { scale: 0.9, parts: [ B([0.3, 0.1, 0.2], 0x6a7078, { m: 0.8, ro: 0.4, r: [0.2, 0.3, 0] }), B([0.2, 0.12, 0.3], 0x565c64, { m: 0.8, p: [0.08, 0.1, 0], r: [0, 0.5, 0.2] }), S([0.05], 0x8a9098, { m: 0.9, p: [-0.1, 0.08, 0.08] }) ] },
    use: { type: 'material', scrap: 6 } },
  { id: 'electronics', name: 'ELECTRONICS', cat: 'material', rarity: 'uncommon', stack: 999, weight: 0.1, value: 14, icon: '▦', desc: 'Circuit boards. Converts to 14 scrap.',
    model: { scale: 0.9, parts: [ B([0.34, 0.04, 0.26], 0x1c4a30, { m: 0.4, ro: 0.6 }), B([0.08, 0.06, 0.08], 0xc8b040, { e: 0x443300, p: [-0.08, 0.04, 0] }), B([0.06, 0.05, 0.06], 0x30363c, { p: [0.07, 0.04, 0.06] }), C([0.02, 0.02, 0.02, 6], 0xc8ccd0, { p: [0.1, 0.04, -0.08], m: 0.9 }) ] },
    use: { type: 'material', scrap: 14, craft: 'electronics' } },
  { id: 'polymer', name: 'POLYMER BLOCK', cat: 'material', rarity: 'common', stack: 999, weight: 0.15, value: 10, icon: '▧', desc: 'Moulding stock. Converts to 10 scrap.',
    model: { scale: 0.9, parts: [ B([0.32, 0.32, 0.32], 0x2a5a7a, { m: 0.2, ro: 0.5, o: 0.9 }), B([0.34, 0.02, 0.34], 0x3a6a8a, { p: [0, 0.16, 0] }) ] },
    use: { type: 'material', scrap: 10, craft: 'polymer' } },
  { id: 'weapon_parts', name: 'WEAPON PARTS', cat: 'material', rarity: 'rare', stack: 999, weight: 0.2, value: 30, icon: '⚙', desc: 'Precision components. Converts to 30 scrap.',
    model: { scale: 0.9, parts: [ C([0.14, 0.14, 0.04, 14], 0x8a9098, { m: 0.9, r: [Math.PI / 2, 0, 0] }), C([0.1, 0.1, 0.05, 10], 0x6a7078, { m: 0.9, p: [0, 0, 0.08], r: [Math.PI / 2, 0, 0] }), C([0.03, 0.03, 0.2, 8], 0x565c64, { m: 0.9, p: [0.1, 0.05, 0], r: [Math.PI / 2, 0, 0] }) ] },
    use: { type: 'material', scrap: 30, craft: 'weapon_parts' } },
  { id: 'data_chip', name: 'DATA CHIP', cat: 'valuable', rarity: 'rare', stack: 999, weight: 0.05, value: 55, icon: '▣', desc: 'Encrypted data. +55 scrap and reveals the area.',
    model: { scale: 0.85, parts: [ B([0.26, 0.06, 0.18], 0x2a4a3a, { m: 0.5 }), B([0.22, 0.02, 0.14], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.04, 0] }), B([0.04, 0.03, 0.02], 0xc8b040, { e: 0x443300, p: [-0.14, 0, 0] }) ] },
    use: { type: 'use', effect: 'scrapReveal', params: { scrap: 55, dur: 20 } } },
  { id: 'gold_bar', name: 'GOLD BAR', cat: 'valuable', rarity: 'epic', stack: 999, weight: 1.0, value: 220, icon: '▬', desc: 'Pure gold. +220 scrap.',
    model: { scale: 1.0, parts: [ B([0.44, 0.12, 0.2], 0xffb000, { m: 0.95, ro: 0.25, e: 0x553300 }), B([0.4, 0.03, 0.16], 0xffd24d, { e: 0x554400, p: [0, 0.07, 0] }) ] },
    use: { type: 'material', scrap: 220 } },
  { id: 'nano_core', name: 'NANO CORE', cat: 'material', rarity: 'legendary', stack: 999, weight: 0.2, value: 300, icon: '◉', desc: 'Rare upgrade catalyst. +300 scrap.',
    model: { scale: 0.95, parts: [ I([0.16], 0x37ff8b, { e: 0x0f5a33, o: 0.95 }), I([0.1], 0xb46bff, { e: 0x3a1a6a, p: [0, 0, 0] }), T([0.2, 0.02], 0x9fe8ff, { e: 0x226688, r: [Math.PI / 2, 0, 0] }) ] },
    use: { type: 'material', scrap: 300 } },
  { id: 'supply_cache', name: 'SUPPLY CACHE', cat: 'container', rarity: 'uncommon', stack: 10, weight: 1.5, value: 40, icon: '▢', desc: 'Open to release 3 random supplies.',
    model: { scale: 1.0, parts: [ B([0.44, 0.4, 0.4], 0x4a5340, { m: 0.3, ro: 0.7 }), B([0.46, 0.06, 0.42], 0x2f3624, { p: [0, 0.2, 0] }), B([0.1, 0.1, 0.02], 0x37ff8b, { e: 0x0f5a33, p: [0, 0, 0.201] }) ] },
    use: { type: 'use', effect: 'loot', params: { count: 3 } } },
];

// ---------------------------------------------------------------- modules & tools
const MODULES = [
  { id: 'wpn_module', name: 'WEAPON MODULE', cat: 'module', rarity: 'uncommon', stack: 20, weight: 0.3, value: 60, icon: '⬢',
    desc: 'Grants +1 weapon mod point to your current weapon.',
    model: { scale: 0.85, parts: [
      B([0.3, 0.06, 0.3], 0x1c4a30, { m: 0.4 }),
      B([0.2, 0.03, 0.2], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.045, 0] }),
      C([0.02, 0.02, 0.02, 6], 0xc8ccd0, { p: [0.12, 0.04, 0.1], m: 0.9 }),
      C([0.02, 0.02, 0.02, 6], 0xc8ccd0, { p: [-0.12, 0.04, 0.1], m: 0.9 }),
      C([0.02, 0.02, 0.02, 6], 0xc8ccd0, { p: [0.12, 0.04, -0.1], m: 0.9 }),
    ] },
    use: { type: 'use', effect: 'modpoints', params: { amount: 1 } } },
  { id: 'capstone_core', name: 'CAPSTONE CORE', cat: 'module', rarity: 'epic', stack: 10, weight: 0.4, value: 200, icon: '❖',
    desc: 'Grants +3 weapon mod points.',
    model: { scale: 1.0, parts: [
      { s: 'octa', d: [0.18], c: 0xb46bff, e: 0x3a1a6a, o: 0.95 },
      { s: 'octa', d: [0.1], c: 0xffffff, e: 0x88aaff },
      T([0.22, 0.02], 0x9fe8ff, { e: 0x226688, r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'modpoints', params: { amount: 3 } } },
  { id: 'respec_chip', name: 'RESPEC CHIP', cat: 'module', rarity: 'rare', stack: 10, weight: 0.3, value: 120, icon: '↺',
    desc: 'Refunds every mod point spent on your current weapon.',
    model: { scale: 0.85, parts: [
      B([0.26, 0.05, 0.26], 0x30363c, { m: 0.5 }),
      B([0.18, 0.02, 0.18], 0xffb000, { e: 0x553300, p: [0, 0.04, 0] }),
      T([0.12, 0.02], 0xffd24d, { e: 0x554400, p: [0, 0.06, 0] }),
    ] },
    use: { type: 'use', effect: 'respec', params: {} } },
];

const TOOLS2 = [
  { id: 'luck_charm', name: 'LUCK CHARM', cat: 'tool', rarity: 'rare', stack: 5, weight: 0.3, value: 90, icon: '✦',
    desc: 'Raises loot rarity substantially for 60s.',
    model: { scale: 1.0, parts: [
      T([0.16, 0.03], 0xffb000, { e: 0x554400, r: [Math.PI / 2, 0, 0] }),
      S([0.09], 0xb46bff, { e: 0x3a1a6a, p: [0, 0.02, 0] }),
      CO([0.05, 0.14], 0xffd24d, { e: 0x554400, p: [0, -0.12, 0], r: [Math.PI, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'luck', dur: 60, label: 'LUCK+', mods: { luck: 0.6 } } } },
  { id: 'scavenger_beacon', name: 'SCAVENGER BEACON', cat: 'tool', rarity: 'rare', stack: 5, weight: 0.5, value: 90, icon: '⌂',
    desc: 'Greatly increases drop rate for 60s.',
    model: { scale: 1.0, parts: [
      C([0.16, 0.2, 0.12, 10], 0x2b3038, { m: 0.6 }),
      C([0.04, 0.04, 0.24, 8], 0x9aa0a8, { p: [0, 0.18, 0], m: 0.8 }),
      S([0.06], 0x37ff8b, { e: 0x0f5a33, p: [0, 0.32, 0] }),
      T([0.18, 0.015], 0x37ff8b, { e: 0x0f5a33, r: [Math.PI / 2, 0, 0] }),
    ] },
    use: { type: 'use', effect: 'buff', params: { id: 'scav', dur: 60, label: 'SCAVENGER', mods: { scavenger: 0.5 } } } },
  { id: 'idol', name: 'GILDED IDOL', cat: 'valuable', rarity: 'rare', stack: 20, weight: 0.8, value: 120, icon: '☗',
    desc: 'A treasure from the fringe. Converts to 120 scrap.',
    model: { scale: 1.0, parts: [
      C([0.14, 0.18, 0.28, 8], 0xffb000, { m: 0.9, ro: 0.25, e: 0x553300 }),
      S([0.11], 0xffd24d, { e: 0x554400, p: [0, 0.2, 0], m: 0.9 }),
      B([0.24, 0.06, 0.14], 0xc89000, { m: 0.9, p: [0, -0.16, 0] }),
    ] },
    use: { type: 'material', scrap: 120 } },
];

// ------------------------------------------------------------------ assemble
const ALL = [
  ...AMMO_TYPES.map(ammoItem),
  ...CONSUMABLES,
  ...ARMOR,
  ...THROWABLES,
  ...GADGETS,
  ...ATTACHMENTS,
  ...MATERIALS,
  ...MODULES,
  ...TOOLS2,
];

for (const it of ALL) {
  it.rarityColor = RARITY_COLORS[it.rarity] || 0x9aa0a8;
}

export const ITEMS = ALL;
export const ITEMS_BY_ID = Object.fromEntries(ALL.map(i => [i.id, i]));

export function itemDef(id) { return ITEMS_BY_ID[id] || null; }
export function itemsByCat(cat) { return ITEMS.filter(i => i.cat === cat); }
export function itemsBySlot(slot) { return ITEMS.filter(i => i.use && i.use.type === 'attachment' && i.use.slot === slot); }
export const ITEM_COUNT = ITEMS.length;
