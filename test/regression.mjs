import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Regression suite for the systems that are easy to break and hard to see:
 *
 *   · FUN MODE must not leak into the next normal run
 *   · the Tang-dao guard must actually deflect bullets (bullet kind was dropped
 *     by the enemy target proxy, which silently disabled the whole mechanic)
 *   · grenades must never fall through the pavement
 *   · the ASCII grid must be screen-space (glyphs used to be quantised to the
 *     low-res scene target and looked like blocky noise)
 *   · audio must cap voice load and resync the DnB scheduler after a stall
 *   · enterable buildings must have walkable doors and climbable staircases
 */

const url = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().split('\n')[0]); });

let failures = [];
let data = {};
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  data = await page.evaluate(async () => {
    const g = window.__game;
    const V = g.player.pos.constructor;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fails = [];
    const check = (ok, name, info) => { if (!ok) fails.push(name + (info !== undefined ? ' :: ' + JSON.stringify(info) : '')); };
    const snapshot = {};

    /* ---------------- FUN MODE -> normal mode ---------------- */
    document.getElementById('in-fun').checked = true;
    await g.startGame({ solo: true });
    snapshot.fun = {
      attachments: g.weaponSystem.weapons.map((w) => Object.keys(w.attachments).length),
      reserve: g.weaponSystem.weapons[2].reserve,
      invincible: g.player.invincible,
      spawnerFun: g.spawner.funMode,
      grenades: g.grenades,
      level: g.progression.stateFor('rifle').level,
    };
    check(snapshot.fun.attachments.every((n) => n === 5), 'fun mode gives every attachment', snapshot.fun.attachments);
    check(snapshot.fun.reserve === 9999, 'fun mode reserve', snapshot.fun.reserve);
    check(snapshot.fun.invincible === true, 'fun mode invincible', snapshot.fun.invincible);
    check(snapshot.fun.spawnerFun === true, 'fun mode spawner', snapshot.fun.spawnerFun);

    g.quitToMenu();
    document.getElementById('in-fun').checked = false;
    await g.startGame({ solo: true });
    snapshot.normal = {
      attachments: g.weaponSystem.weapons.map((w) => Object.keys(w.attachments).length),
      reserve: g.weaponSystem.weapons[2].reserve,
      invincible: g.player.invincible,
      speedMul: g.player.speedMul,
      spawnerFun: g.spawner.funMode,
      grenades: g.grenades,
      level: g.progression.stateFor('rifle').level,
      isHost: g._isHost,
      isClient: g._isClient,
      maxHealth: g.player.maxHealth,
      scrap: g.progression.scrap,
    };
    check(snapshot.normal.attachments.every((n) => n === 0), 'normal run has no inherited attachments', snapshot.normal.attachments);
    check(snapshot.normal.reserve === g.weaponSystem.weapons[2].base.reserve, 'normal reserve restored', snapshot.normal.reserve);
    check(snapshot.normal.invincible === false, 'normal run is not invincible', snapshot.normal.invincible);
    check(snapshot.normal.speedMul === 1, 'normal speed restored', snapshot.normal.speedMul);
    check(snapshot.normal.spawnerFun === false, 'normal spawner restored', snapshot.normal.spawnerFun);
    check(snapshot.normal.grenades === 4, 'normal grenade count', snapshot.normal.grenades);
    check(snapshot.normal.level === 1, 'normal weapon level reset', snapshot.normal.level);
    check(snapshot.normal.isHost === true && snapshot.normal.isClient === false, 'solo run is host', snapshot.normal);
    check(snapshot.normal.maxHealth === 100, 'max health reset', snapshot.normal.maxHealth);

    /* ---------------- Tang-dao guard / parry ---------------- */
    g.weaponSystem.index = 7;
    g.weaponSystem._deflectActive = true;
    g.weaponSystem._deflect = 1;
    g.player.armor = 0; g.player.shield = 0; g.player.health = 100;
    const ctx = g.enemies.makeCtx(g.player, g.camera.position);
    for (let i = 0; i < 12; i++) {
      ctx.targets[0].takeDamage(20, { x: 0, y: 0, z: 1 }, 'bullet', { x: 0, y: 2, z: 0 });
    }
    check(g.player.health === 100, '100% guard deflects every bullet', g.player.health);
    // ...and without the guard bullets still hurt (the proxy must not swallow everything)
    g.weaponSystem._deflectActive = false;
    g.weaponSystem._deflect = 0;
    ctx.targets[0].takeDamage(10, { x: 0, y: 0, z: 1 }, 'bullet', { x: 0, y: 2, z: 0 });
    check(g.player.health < 100, 'unguarded bullets still damage', g.player.health);
    snapshot.parry = { health: g.player.health };

    // guard stance becomes active when braced and holding for >5 s
    g.state = 'paused';
    const idle = { down: () => false, pressed: () => false, released: () => false, mouseDown: () => false, mousePressed: () => false, takeWheel: () => 0, touch: false, moveAxis: () => null };
    g.player.reset(g.world.findStreetSpawn(216, 216), 0);
    for (let i = 0; i < 30; i++) g.player.update(1 / 60, idle, true);
    g.weaponSystem._meleeHold = 6;
    g.weaponSystem._updateDeflect(1 / 60, true);
    check(g.weaponSystem._deflect === 1 && g.weaponSystem._guardStance === true, 'braced guard stance', {
      deflect: g.weaponSystem._deflect, stance: g.weaponSystem._guardStance, onGround: g.player.onGround,
    });
    snapshot.guardStance = { deflect: g.weaponSystem._deflect, stance: g.weaponSystem._guardStance };

    /* ---------------- grenades never go through the floor ---------------- */
    g.state = 'playing';
    g.spawner.enabled = false;
    g.enemies.reset();
    g.projectiles.clear();
    g.player.reset(g.world.findStreetSpawn(216, 216), 0);
    g.world.update(g.player.pos);
    const gh = g.world.groundHeight(g.player.pos.x, g.player.pos.z);
    const p = g.projectiles.spawnGrenade(
      new V(g.player.pos.x, g.player.pos.y + 1.2, g.player.pos.z),
      new V(0, -1, 0), 'player', 4, 'frag', { up: 0 });
    let minY = Infinity;
    for (let i = 0; i < 110; i++) {
      await sleep(16);
      if (p.active) minY = Math.min(minY, p.pos.y);
    }
    check(minY >= gh - 0.02, 'grenade stays above ground', { gh, minY, active: p.active });
    snapshot.grenade = { gh: +gh.toFixed(2), minY: +minY.toFixed(2) };

    /* ---------------- ASCII pipeline ---------------- */
    const u = g.composer.material.uniforms;
    const sr = u.uScreenRes.value;
    check(sr.x === window.innerWidth && sr.y === window.innerHeight, 'ASCII grid uses screen pixels', { sr: [sr.x, sr.y], win: [window.innerWidth, window.innerHeight] });
    check(g.composer.fontCols === 16, 'glyph atlas columns', g.composer.fontCols);
    check(g.composer.rt.width >= Math.floor(window.innerWidth / g.composer.charSize) * 4, 'scene target supersampled for cells', g.composer.rt.width);
    check(g.composer.charSize >= 12, 'readable default cell size', g.composer.charSize);
    snapshot.ascii = { charSize: g.composer.charSize, rt: [g.composer.rt.width, g.composer.rt.height], font: [g.composer.fontCols, g.composer.fontRows] };

    /* ---------------- audio overload protection ---------------- */
    for (let i = 0; i < 500; i++) g.audio.gunshot('rifle', 0);
    check(g.audio.ctx.state === 'running', 'audio context still running', g.audio.ctx.state);
    check(g.audio._voiceLoad <= g.audio._voiceCap * 1.75, 'voice budget capped', g.audio._voiceLoad);
    const now = g.audio.ctx.currentTime;
    g.dnb._nextTime = now - 10;
    g.dnb._needsResync = true;
    g.dnb._schedule();
    check(g.dnb._nextTime > now - 1, 'DnB scheduler skips missed time instead of flooding', g.dnb._nextTime - now);
    snapshot.audio = { state: g.audio.ctx.state, load: +g.audio._voiceLoad.toFixed(1), ahead: +(g.dnb._nextTime - now).toFixed(2) };

    /* ---------------- interiors: door + staircase ---------------- */
    g.state = 'paused';
    let ent = null;
    for (const b of g.world.enterables.values()) if (b.detailFloors >= 5) { ent = b; break; }
    if (!ent) {
      fails.push('no enterable building found');
    } else {
      const nx = ent.doorNx, nz = ent.doorNz;
      const probes = {};
      for (const [name, px, pz, py] of [
        ['outside', ent.doorX + nx * 0.6, ent.doorZ + nz * 0.6, 0.9],
        ['inside', ent.doorX - nx * 0.6, ent.doorZ - nz * 0.6, 0.9],
        ['insideHead', ent.doorX - nx * 1.6, ent.doorZ - nz * 1.6, 1.7],
      ]) probes[name] = !!g.world.pointBlocked(px, py, pz, 0.35);
      check(!probes.outside && !probes.inside && !probes.insideHead, 'doorway is clear', probes);

      const holdW = { ...idle, down: (k) => k === 'KeyW' };
      const sim = (secs) => { const n = Math.round(secs * 60); for (let i = 0; i < n; i++) g.player.update(1 / 60, holdW, true); };

      g.player.reset(new V(ent.doorX + nx * 4, 0.5, ent.doorZ + nz * 4), Math.atan2(nx, nz));
      sim(3.0);
      const ox = (g.player.pos.x - ent.doorX) * nx + (g.player.pos.z - ent.doorZ) * nz;
      check(ox < -0.5, 'player can walk through the entrance', { ox: +ox.toFixed(2), pos: g.player.pos.toArray() });

      const steps = 14, margin = Math.min(1.6, ent.w * 0.18);
      const run = Math.min(0.42, Math.max(0.22, (ent.w - margin * 2) / steps));
      const sx = ent.x - ent.w / 2 + margin, sz = ent.z + ent.d / 2 - 2.3;
      const laneZ = sz - (1.5 + 0.2) / 2;
      g.player.reset(new V(sx - 1.0, 0.35, laneZ), -Math.PI / 2);
      sim(6.0);
      check(g.player.pos.y > (ent.floorH || 3.6) * 0.8, 'staircase is climbable', {
        y: +g.player.pos.y.toFixed(2), target: ent.floorH,
      });
      snapshot.interior = {
        floors: ent.detailFloors, y: +g.player.pos.y.toFixed(2), doorY: +ent.floorH.toFixed(1),
        probes,
      };
    }

    return { fails, snapshot };
  });

  failures = data.fails || [];
  if (errors.length) failures.push(...errors);
  console.log('SNAPSHOT', JSON.stringify(data.snapshot, null, 1));
} catch (e) {
  failures.push('HARNESS: ' + e.message);
} finally {
  await browser.close();
}

console.log('\n=== REGRESSION ' + (failures.length ? 'FAILURES: ' + failures.length : 'OK') + ' ===');
for (const f of failures.slice(0, 30)) console.log(' ✗ ' + f);
fs.writeFileSync('test/regression.log', failures.join('\n'));
process.exit(failures.length ? 1 : 0);
