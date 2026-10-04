/**
 * Status effects — damage-over-time, control and debuff states applied to
 * enemies (and, where relevant, the player). Each status has a colour used for
 * particle feedback and a set of stacking modifiers resolved by
 * `computeStatusMods`.
 */
export const STATUS_DEFS = {
  burn:    { name: 'BURN',    color: 0xff6a22, dot: 7,  dur: 4,  maxStacks: 4, particles: 'fire' },
  bleed:   { name: 'BLEED',   color: 0xff2a44, dot: 5,  dur: 5,  maxStacks: 5, particles: 'blood' },
  poison:  { name: 'POISON',  color: 0x66ff44, dot: 4,  dur: 8,  maxStacks: 3, particles: 'toxic' },
  cryo:    { name: 'FROZEN',  color: 0x66ddff, slow: 0.45, dur: 3.2, maxStacks: 2, particles: 'ice' },
  shock:   { name: 'SHOCKED', color: 0xffee55, stun: 0.5, chain: 9, dur: 2.2, maxStacks: 2, particles: 'spark' },
  corrode: { name: 'CORRODED',color: 0xccff33, vuln: 0.25, dur: 6, maxStacks: 3, particles: 'acid' },
  mark:    { name: 'MARKED',  color: 0xff44cc, vuln: 0.15, reveal: true, dur: 9, maxStacks: 1, particles: 'mark' },
  weaken:  { name: 'WEAKENED',color: 0xaa88ff, dmgMul: 0.55, dur: 5, maxStacks: 2, particles: 'void' },
  stun:    { name: 'STUNNED', color: 0xffffff, stun: 1.1, dur: 1.1, maxStacks: 1, particles: 'spark' },
  nano:    { name: 'NANITE',  color: 0x37ff8b, vuln: 0.1, dur: 4, maxStacks: 2, particles: 'nano' },
};

export function statusDef(kind) { return STATUS_DEFS[kind] || null; }

/** Resolve the combined modifiers of a status map { kind: {t,dur,power,stacks} }. */
export function computeStatusMods(statuses) {
  const mods = {
    speedMul: 1, fireMul: 1, dmgTakenMul: 1, dmgDealtMul: 1,
    stunned: false, revealed: false, dps: 0,
  };
  if (!statuses) return mods;
  for (const kind in statuses) {
    const s = statuses[kind];
    if (!s || s.t <= 0) continue;
    const def = STATUS_DEFS[kind];
    if (!def) continue;
    const stacks = s.stacks || 1;
    if (def.dot) mods.dps += def.dot * stacks * (s.power || 1);
    if (def.slow) mods.speedMul *= Math.pow(1 - def.slow, stacks);
    if (def.stun) { mods.stunned = true; mods.speedMul = Math.min(mods.speedMul, 0.05); mods.fireMul *= 0.1; }
    if (def.vuln) mods.dmgTakenMul *= 1 + def.vuln * stacks;
    if (def.dmgMul) mods.dmgDealtMul *= Math.pow(def.dmgMul, stacks);
    if (def.reveal) mods.revealed = true;
  }
  return mods;
}
