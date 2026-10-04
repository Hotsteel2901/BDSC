/**
 * Districts — deterministic city regions. The same (x,z) always yields the same
 * district on every peer, so loot and enemy mixes agree in co-op. Districts
 * drive which loot tables and which enemy archetypes (and elite odds) are used.
 */

export const DISTRICTS = {
  CORE: {
    id: 'CORE', name: 'CORE DISTRICT', color: 0x4de0ff,
    loot: 'region_core', interior: ['interior_office', 'interior_armory', 'interior_lab'],
    elite: 0.11, density: 1.1,
    enemies: { grunt: 4, rusher: 2, drone: 2, heavy: 4, sniper: 3, officer: 3, turret: 2 },
  },
  INDUSTRIAL: {
    id: 'INDUSTRIAL', name: 'INDUSTRIAL ZONE', color: 0xffb000,
    loot: 'region_industrial', interior: ['interior_armory', 'interior_common'],
    elite: 0.08, density: 1.0,
    enemies: { grunt: 4, rusher: 3, heavy: 4, turret: 4, drone: 1, sniper: 1, officer: 1 },
  },
  RESIDENTIAL: {
    id: 'RESIDENTIAL', name: 'RESIDENTIAL BLOCKS', color: 0x37ff8b,
    loot: 'region_residential', interior: ['interior_common', 'interior_lab'],
    elite: 0.05, density: 0.95,
    enemies: { grunt: 6, rusher: 3, drone: 2, heavy: 1, sniper: 1, officer: 1, turret: 0 },
  },
  SLUMS: {
    id: 'SLUMS', name: 'LOWER SLUMS', color: 0xff4d9e,
    loot: 'region_slums', interior: ['interior_common'],
    elite: 0.06, density: 1.05,
    enemies: { grunt: 4, rusher: 6, drone: 3, heavy: 1, officer: 1, sniper: 0, turret: 1 },
  },
  MARKET: {
    id: 'MARKET', name: 'NIGHT MARKET', color: 0xb46bff,
    loot: 'region_market', interior: ['interior_office', 'interior_common'],
    elite: 0.08, density: 1.0,
    enemies: { grunt: 5, rusher: 4, drone: 3, heavy: 2, sniper: 2, officer: 2, turret: 1 },
  },
  FRINGE: {
    id: 'FRINGE', name: 'OUTER FRINGE', color: 0x9aa0a8,
    loot: 'region_fringe', interior: ['interior_armory', 'interior_lab'],
    elite: 0.15, density: 0.9,
    enemies: { grunt: 4, rusher: 4, drone: 4, heavy: 3, sniper: 3, officer: 2, turret: 1 },
  },
};

const SUPER = 560;   // supercell size (metres)

function hash2(i, j) {
  let h = (i * 73856093) ^ (j * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

export function districtIdAt(x, z) {
  const d = Math.hypot(x, z);
  if (d < 620) return 'CORE';
  const i = Math.floor(x / SUPER), j = Math.floor(z / SUPER);
  const h = hash2(i, j);
  if (d > 2600 && h < 0.5) return 'FRINGE';
  if (h < 0.26) return 'INDUSTRIAL';
  if (h < 0.52) return 'RESIDENTIAL';
  if (h < 0.76) return 'SLUMS';
  return 'MARKET';
}

export function districtAt(x, z) {
  return DISTRICTS[districtIdAt(x, z)] || DISTRICTS.RESIDENTIAL;
}
