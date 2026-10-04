import { STATUS_DEFS } from './status.js';

/**
 * Ammunition types. Each round changes damage, penetration, spread, recoil,
 * projectile behaviour and/or applies a status effect. Weapons hold a currently
 * loaded ammo type; the effective stats are produced by
 * `applyAmmoToStats`.
 *
 * pen          0..1 armour penetration (reduces the armour flat reduction)
 * dmg          damage multiplier
 * pellets      extra projectiles per trigger pull
 * aoe          explosion radius on impact (metres, 0 = none)
 * pierce       enemies a round may pass through
 * ricochet     bounces off world geometry before expiring
 * chain        number of nearby enemies a hit can arc to
 * status       { kind, chance, dur, power } applied on hit
 * noFalloff    damage does not drop with distance
 * silent       reduces the noise that alerts enemies
 * selfHeal     health restored to the shooter per hit
 */
export const AMMO_TYPES = [
  { id: 'standard',  name: 'STANDARD',    rarity: 'common',    color: 0xffd27a, dmg: 1.00, pen: 0.00, spread: 1.00, recoil: 1.00, desc: 'Balanced ball ammunition.' },
  { id: 'hollow',    name: 'HOLLOW-POINT',rarity: 'common',    color: 0xffb347, dmg: 1.30, pen: -0.20, spread: 1.05, recoil: 1.15, status: { kind: 'bleed', chance: 0.55, dur: 5, power: 1 }, desc: 'Expands on impact; brutal against flesh, weak vs armour.' },
  { id: 'ap',        name: 'ARMOUR-PIERCE',rarity: 'uncommon', color: 0x9fe8ff, dmg: 0.92, pen: 0.60, spread: 1.00, recoil: 1.10, desc: 'Tungsten core defeats armour plating.' },
  { id: 'incendiary',name: 'INCENDIARY',  rarity: 'uncommon', color: 0xff6a22, dmg: 0.95, pen: 0.05, spread: 1.00, recoil: 1.05, status: { kind: 'burn', chance: 0.75, dur: 4, power: 1 }, desc: 'Ignites the target.' },
  { id: 'cryo',      name: 'CRYO',        rarity: 'uncommon', color: 0x66ddff, dmg: 0.90, pen: 0.05, spread: 1.00, recoil: 0.95, status: { kind: 'cryo', chance: 0.65, dur: 3.2, power: 1 }, desc: 'Supercooled rounds slow and eventually freeze.' },
  { id: 'shock',     name: 'SHOCK',       rarity: 'uncommon', color: 0xffee55, dmg: 0.90, pen: 0.10, spread: 1.00, recoil: 1.00, chain: 1, status: { kind: 'shock', chance: 0.55, dur: 2.2, power: 1 }, desc: 'Arcs to a nearby target and briefly stuns.' },
  { id: 'toxic',     name: 'TOXIC',       rarity: 'uncommon', color: 0x66ff44, dmg: 0.85, pen: 0.05, spread: 1.00, recoil: 0.95, status: { kind: 'poison', chance: 0.85, dur: 8, power: 1 }, desc: 'Coats the target in fast-acting neurotoxin.' },
  { id: 'corrosive', name: 'CORROSIVE',   rarity: 'rare',     color: 0xccff33, dmg: 0.90, pen: 0.35, spread: 1.00, recoil: 1.00, status: { kind: 'corrode', chance: 0.75, dur: 6, power: 1 }, desc: 'Dissolves armour, increasing all damage taken.' },
  { id: 'explosive', name: 'EXPLOSIVE',   rarity: 'rare',     color: 0xff8833, dmg: 0.90, pen: 0.10, spread: 1.05, recoil: 1.30, aoe: 1.7, desc: 'Micro-charge detonates on impact.' },
  { id: 'flechette', name: 'FLECHETTE',   rarity: 'uncommon', color: 0xd8e6ff, dmg: 0.42, pen: 0.15, spread: 1.60, recoil: 0.85, pellets: 4, status: { kind: 'bleed', chance: 0.35, dur: 5, power: 1 }, desc: 'A burst of razor darts.' },
  { id: 'ricochet',  name: 'RICOCHET',    rarity: 'rare',     color: 0xa0ffd0, dmg: 0.95, pen: 0.10, spread: 1.00, recoil: 0.95, ricochet: 1, desc: 'Bounces off surfaces — deadly in corridors.' },
  { id: 'piercing',  name: 'PIERCING',    rarity: 'rare',     color: 0xffe0ff, dmg: 1.05, pen: 0.30, spread: 0.95, recoil: 1.20, pierce: 2, desc: 'Punches through multiple hostiles.' },
  { id: 'tracker',   name: 'TRACKER',     rarity: 'uncommon', color: 0xff44cc, dmg: 0.85, pen: 0.05, spread: 1.00, recoil: 0.95, status: { kind: 'mark', chance: 1.0, dur: 9, power: 1 }, desc: 'Tags the target; marked foes take more damage and glow.' },
  { id: 'photon',    name: 'PHOTON',      rarity: 'rare',     color: 0x4de0ff, dmg: 1.00, pen: 0.25, spread: 0.90, recoil: 0.85, noFalloff: true, desc: 'Focused light; no damage falloff at range.' },
  { id: 'nanite',    name: 'NANITE',      rarity: 'epic',     color: 0x37ff8b, dmg: 0.90, pen: 0.10, spread: 1.00, recoil: 1.00, selfHeal: 1.2, status: { kind: 'nano', chance: 0.6, dur: 4, power: 1 }, desc: 'Repairs the shooter on every hit.' },
  { id: 'dragon',    name: "DRAGON'S BREATH", rarity: 'epic', color: 0xff5522, dmg: 0.34, pen: 0.00, spread: 2.20, recoil: 1.60, pellets: 6, status: { kind: 'burn', chance: 0.9, dur: 4, power: 1.5 }, desc: 'A short-range cone of fire.' },
  { id: 'subsonic',  name: 'SUBSONIC',    rarity: 'common',   color: 0xbba0ff, dmg: 0.95, pen: 0.05, spread: 0.92, recoil: 0.60, silent: true, desc: 'Quiet rounds with reduced recoil; harder to detect.' },
  { id: 'cluster',   name: 'CLUSTER',     rarity: 'epic',     color: 0xffaa55, dmg: 1.00, pen: 0.10, spread: 1.10, recoil: 1.35, aoe: 2.4, chain: 2, desc: 'Splits into bomblets on impact.' },
  { id: 'void',      name: 'VOID',        rarity: 'legendary',color: 0xaa66ff, dmg: 1.15, pen: 0.30, spread: 0.95, recoil: 1.10, chain: 1, status: { kind: 'weaken', chance: 0.8, dur: 5, power: 1 }, desc: 'Entropic rounds sap enemy strength.' },
  { id: 'overcharge',name: 'OVERCHARGE',  rarity: 'legendary',color: 0xffffff, dmg: 1.45, pen: 0.40, spread: 1.30, recoil: 1.70, aoe: 1.2, status: { kind: 'shock', chance: 0.6, dur: 2.2, power: 1 }, desc: 'Unstable high-yield rounds; huge damage, heavy kick.' },
];

export const AMMO_BY_ID = Object.fromEntries(AMMO_TYPES.map(a => [a.id, a]));
export function ammoDef(id) { return AMMO_BY_ID[id] || AMMO_BY_ID.standard; }

/**
 * Fold an ammo type into a weapon's effective stat block.
 * Stats object fields mirror the weapon definition and gain ammo-specific
 * fields consumed by the firing code.
 */
export function applyAmmoToStats(stats, ammoId) {
  const a = ammoDef(ammoId);
  return {
    ...stats,
    dmg: stats.dmg * a.dmg,
    spread: stats.spread * a.spread,
    recoilP: stats.recoilP * a.recoil,
    pellets: (stats.pellets || 1) + (a.pellets ? a.pellets - 1 : 0),
    pen: a.pen || 0,
    aoe: a.aoe || 0,
    pierce: a.pierce || 0,
    ricochet: a.ricochet || 0,
    chain: a.chain || 0,
    status: a.status || null,
    noFalloff: !!a.noFalloff,
    silent: !!a.silent,
    selfHeal: a.selfHeal || 0,
    tracer: a.color != null ? hexToTracer(a.color) : (stats.tracer || [1, 0.9, 0.5]),
    ammoColor: a.color,
    ammoName: a.name,
    ammoId: a.id,
  };
}

export function hexToTracer(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export { STATUS_DEFS };
