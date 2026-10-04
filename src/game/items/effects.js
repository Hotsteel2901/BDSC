import * as THREE from 'three';

/**
 * Item effect dispatcher. Maps an item's `use` descriptor to real gameplay.
 * Returns { consumed, msg } so the caller can update the inventory and HUD.
 */
export function applyItemEffect(game, item) {
  const use = item.use;
  if (!use) return { consumed: false, msg: 'NOTHING HAPPENS' };
  const p = game.player;
  const P = use.params || {};

  try {
    switch (use.type) {
      case 'material': {
        game.progression.addScrap(use.scrap || 0);
        return { consumed: true, msg: `+${use.scrap || 0} SCRAP` };
      }
      case 'ammo': {
        game.weaponSystem.loadAmmo(use.ammo, use.amount || 60);
        return { consumed: true, msg: `LOADED ${game.weaponSystem.def.ammoName || use.ammo.toUpperCase()}` };
      }
      case 'attachment': {
        const res = game.weaponSystem.equipAttachment(item);
        return { consumed: res.ok, msg: res.msg };
      }
      case 'use': {
        return USE_EFFECTS[use.effect] ? USE_EFFECTS[use.effect](game, p, P, item) : { consumed: false, msg: 'NO EFFECT' };
      }
      default:
        return { consumed: false, msg: 'UNKNOWN' };
    }
  } catch (err) {
    console.error('item effect failed', item.id, err);
    return { consumed: false, msg: 'FAILED' };
  }
}

const USE_EFFECTS = {
  heal(game, p, P) {
    const before = p.health;
    p.heal(P.amount || 0);
    if (P.maxhp) p.addMaxHealth(P.maxhp);
    if (P.cure) for (const c of P.cure) p.cure(c);
    if (P.buff) game.buffs.add(P.buff.id, P.buff.dur, P.buff.mods, P.buff.label);
    return { consumed: true, msg: `+${Math.round(p.health - before)} HP` };
  },
  maxhp(game, p, P) {
    p.addMaxHealth(P.amount || 0);
    return { consumed: true, msg: `MAX HP +${P.amount}` };
  },
  maxarmor(game, p, P) {
    p.addMaxArmor(P.amount || 0);
    return { consumed: true, msg: `MAX ARMOUR +${P.amount}` };
  },
  armor(game, p, P) {
    p.giveArmor(P.amount || 0);
    return { consumed: true, msg: `+${P.amount} ARMOUR` };
  },
  shield(game, p, P) {
    p.giveShield(P.amount || 0, P.dur || 15, P.decay || 0);
    return { consumed: true, msg: `+${P.amount} SHIELD` };
  },
  repair(game, p, P) {
    p.giveArmor(P.armor || 0);
    p.heal(P.health || 0);
    return { consumed: true, msg: `REPAIRED` };
  },
  buff(game, p, P) {
    game.buffs.add(P.id, P.dur, P.mods, P.label);
    return { consumed: true, msg: `${P.label} ACTIVE` };
  },
  grenade(game, p, P) {
    game.grenadeKind = P.kind || 'frag';
    game.grenades = Math.min(9, game.grenades + (P.count || 1));
    return { consumed: true, msg: `${(P.kind || 'frag').toUpperCase()} x${P.count}` };
  },
  deploy(game, p, P) {
    const dir = p.getLookDir();
    const pos = new THREE.Vector3(p.pos.x + dir.x * 2.6, p.pos.y, p.pos.z + dir.z * 2.6);
    const s = game.world.findStreetSpawn(pos.x, pos.z);
    if (!game.world.hasChunkAt(s.x, s.z)) return { consumed: false, msg: 'TOO FAR' };
    const d = game.deployables.deploy(P.kind, s, dir, game);
    return { consumed: !!d, msg: d ? `${P.kind.toUpperCase()} DEPLOYED` : 'DEPLOY FAILED' };
  },
  reveal(game, p, P) {
    game.setReveal(P.mode || 'radar', P.dur || 15, P.radius || 90);
    return { consumed: true, msg: `${(P.mode || 'radar').toUpperCase()} ACTIVE` };
  },
  scrapReveal(game, p, P) {
    game.progression.addScrap(P.scrap || 0);
    game.setReveal('radar', P.dur || 20, 90);
    return { consumed: true, msg: `+${P.scrap} SCRAP · AREA REVEALED` };
  },
  ammoReserve(game, p, P) {
    game.weaponSystem.refillReserve(P.frac || 0.5);
    return { consumed: true, msg: 'AMMO RESUPPLY' };
  },
  blink(game, p, P) {
    const ok = p.blink(P.distance || 16, game.world);
    return { consumed: ok, msg: ok ? 'BLINK' : 'NO ROOM' };
  },
  dash(game, p, P) {
    p.dash(P.distance || 10);
    return { consumed: true, msg: 'DASH' };
  },
  timescale(game, p, P) {
    game.buffs.add('timeslow', P.dur || 5, { timescale: P.scale || 0.5 }, 'TIME DILATION');
    return { consumed: true, msg: 'TIME DILATED' };
  },
  loot(game, p, P) {
    const n = P.count || 2;
    for (let i = 0; i < n; i++) game.loot.spawnRandomNear(p.pos.x, p.pos.z, 2, 6);
    return { consumed: true, msg: `CACHE OPENED (${n})` };
  },
  modpoints(game, p, P) {
    const n = P.amount || 1;
    const id = game.weaponSystem.baseDef.id;
    game.progression.addModPoints(id, n);
    game.weaponSystem.recompute(game.weaponSystem.weapon);
    return { consumed: true, msg: `+${n} MOD POINT${n > 1 ? 'S' : ''} (${game.weaponSystem.baseDef.name})` };
  },
  respec(game, p, P) {
    const id = game.weaponSystem.baseDef.id;
    const ok = game.progression.respec(id);
    if (ok) game.weaponSystem.recompute(game.weaponSystem.weapon);
    return { consumed: ok, msg: ok ? `RESPEC ${game.weaponSystem.baseDef.name}` : 'NOTHING TO REFUND' };
  },
};
