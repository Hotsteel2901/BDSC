import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Visual acceptance — captures every screen/scene to test/v-*.png for review.
 */
const url = process.argv[2] || 'http://localhost:5173';
const dir = 'test';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) errors.push('PAGEERROR: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/user gesture is required/i.test(m.text())) errors.push(m.text().split('\n')[0]); });

const shot = async (name) => { await page.screenshot({ path: `${dir}/v-${name}.png` }); console.log('shot', name); };
const play = () => page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await shot('01-menu');

  await page.click('#btn-solo');
  await page.waitForTimeout(1500);
  await play();
  await page.waitForTimeout(3000);
  await shot('02-outdoor');

  // ---- loot closeup with mixed rarities ----
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pitch = -0.22;
    const f = g.player.getLookDir();
    const rx = -f.z, rz = f.x; // right vector
    const items = ['heavy_barrel', 'thermal_scope', 'nano_core', 'gold_bar', 'capstone_core', 'trauma_kit', 'supply_cache', 'armor_plate'];
    items.forEach((id, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const bx = g.player.pos.x + f.x * (3.4 + row * 0.9) + rx * (col - 1.5) * 0.85;
      const bz = g.player.pos.z + f.z * (3.4 + row * 0.9) + rz * (col - 1.5) * 0.85;
      const s = g.world.findStreetSpawn(bx, bz);
      g.loot._spawn(id, 1, s.x, g.world.groundHeight(s.x, s.z) + 0.3, s.z, 'vis' + i, 'vis');
    });
  });
  await page.waitForTimeout(900);
  await shot('03-loot');

  // ---- far district ----
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.world.findStreetSpawn(1600, -1500);
    g.player.reset(s, 0.7);
  });
  await page.waitForTimeout(3500);
  await shot('04-district');

  // ---- combat ----
  await page.evaluate(() => {
    const g = window.__game;
    for (const e of g.enemies.list) e.removeMe = true;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    g.player.health = 100; g.player.giveShield(60, 20, 2); g.player.giveArmor(50);
    const f = g.player.getLookDir();
    for (let i = 0; i < 3; i++) {
      const x = g.player.pos.x + f.x * (12 + i * 2) + (i - 1) * 2.5;
      const z = g.player.pos.z + f.z * (12 + i * 2) + (i - 1) * 1.5;
      const s = g.world.findStreetSpawn(x, z);
      g.enemies.spawn(i === 0 ? 'heavy' : 'grunt', s, null, { elite: i === 0 });
    }
    let best = null, bd = -1;
    for (const e of g.enemies.list) { if (!e.alive) continue; const d = e.pos.distanceTo(g.player.pos); if (d > bd) { bd = d; best = e; } }
    if (best) {
      const dx = best.pos.x - g.player.pos.x, dz = best.pos.z - g.player.pos.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = 0; // level view down the street
    }
  });
  await page.waitForTimeout(700);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await shot('05-combat');
  await page.evaluate(() => { window.__game.composer.enabled = false; });
  await page.waitForTimeout(90);
  await shot('05b-combat-raw');
  await page.evaluate(() => { window.__game.composer.enabled = true; });
  await page.mouse.up();
  await page.evaluate(() => { const g = window.__game; g.projectiles.spawnGrenade(g.player.eyePos, g.player.getLookDir(), 'player', 14, 'incendiary'); });
  await page.waitForTimeout(2200);
  await shot('06-explosion');

  // ---- HUD status chips + low health + overclock ----
  await page.evaluate(() => {
    const g = window.__game;
    g.buffs.add('stim', 20, { speed: 1.3 }, 'STIM');
    g.buffs.add('focus', 20, { damage: 1.2 }, 'FOCUS');
    g.buffs.add('luck', 60, { luck: 0.6 }, 'LUCK+');
    g.player.giveShield(60, 20, 3);
    g.player.health = 34; g.player.armor = 40;
    g.player.applyStatus('burn', 6, 1);
    g.setReveal('xray', 20, 120);
  });
  await page.waitForTimeout(700);
  await shot('07-hud-status');

  // ---- interiors ----
  const gotInterior = await page.evaluate(() => {
    const g = window.__game;
    if (!g.world.enterables.size) return false;
    const b = [...g.world.enterables.values()].find(x => x.detailFloors >= 6) || [...g.world.enterables.values()][0];
    const V = g.player.pos.constructor;
    g.player.reset(new V(b.x - b.w / 2 + 2.2, 0.5, b.z - b.d / 2 + 2.2), Math.PI * 0.75);
    g.world.update(g.player.pos);
    return true;
  });
  await page.waitForTimeout(3000);
  await shot('08-interior-ground');
  await page.evaluate(() => {
    const g = window.__game;
    const b = [...g.world.enterables.values()][0];
    const V = g.player.pos.constructor;
    g.player.reset(new V(b.x - b.w / 2 + 2.2, (b.floorH || 3.6) * 3 + 0.4, b.z - b.d / 2 + 2.2), Math.PI * 0.25);
  });
  await page.waitForTimeout(2500);
  await shot('09-interior-upper');

  // ---- inventory / craft / guide / arsenal / pause / death ----
  await page.evaluate(() => {
    const g = window.__game;
    g.inventory.slots.fill(null);
    g.inventory.add('medkit', 5); g.inventory.add('nano_serum', 3); g.inventory.add('auto_turret', 2);
    g.inventory.add('heavy_barrel', 2); g.inventory.add('ammo_incendiary', 400); g.inventory.add('nano_core', 9);
    g.inventory.add('gold_bar', 4); g.inventory.add('capstone_core', 3); g.inventory.add('overshield', 3);
    g.inventory.add('thermal_scope', 1); g.inventory.add('stim_shot', 6); g.inventory.add('scrap_metal', 500);
    g.inventory.add('luck_charm', 2); g.inventory.add('ammo_void', 120); g.inventory.add('respec_chip', 2);
  });
  await page.evaluate(() => { window.__game.toggleInventory(); });
  await page.waitForTimeout(700);
  await shot('10-inventory');
  await page.evaluate(() => { const g = window.__game; g.hud._invTab = 'craft'; g.hud._renderInventory(g); });
  await page.waitForTimeout(500);
  await shot('11-craft');
  await page.evaluate(() => { const g = window.__game; g.hud._invTab = 'guide'; g.hud._renderInventory(g); });
  await page.waitForTimeout(500);
  await shot('12-guide');
  await page.evaluate(() => { const g = window.__game; g.hud._invTab = 'items'; g.toggleInventory(); g.progression.scrap = 4200; g.openArsenal(); });
  await page.waitForTimeout(700);
  await shot('13-arsenal');
  await page.evaluate(() => { const g = window.__game; g.hud.hideArsenal(); g.setPaused(true); });
  await page.waitForTimeout(500);
  await shot('14-pause');
  await page.evaluate(() => { const g = window.__game; g.setPaused(false); g.player.takeDamage(9999); });
  await page.waitForTimeout(800);
  await shot('15-death');

  // ---- multiplayer both ends ----
  const room = 'VIS' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const client = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const hErr = [], cErr = [];
  host.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) hErr.push(e.message); });
  client.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) cErr.push(e.message); });
  await host.goto(url, { waitUntil: 'load' }); await host.waitForTimeout(1500);
  await client.goto(url, { waitUntil: 'load' }); await client.waitForTimeout(1500);
  await host.evaluate((r) => { document.getElementById('in-room').value = r; }, room);
  await client.evaluate((r) => { document.getElementById('in-room').value = r; }, room);
  await host.click('#btn-host'); await host.waitForTimeout(2500);
  await client.click('#btn-join'); await client.waitForTimeout(7000);
  for (const p of [host, client]) await p.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });
  // client walks up to host's area to be visible
  await host.evaluate(() => { const g = window.__game; g.player.reset(g.world.findStreetSpawn(300, 300), Math.PI); });
  await client.evaluate(() => { const g = window.__game; g.player.reset(g.world.findStreetSpawn(300, 306), 0); });
  await host.waitForTimeout(3500);
  await client.waitForTimeout(3500);
  const hAv = await host.evaluate(() => { const g = window.__game; const a = []; for (const [, p] of g.net.players) if (p.pos) a.push({ n: p.name, dx: +(p.pos.x - g.player.pos.x).toFixed(1), dz: +(p.pos.z - g.player.pos.z).toFixed(1), mesh: !!p.mesh, vis: p.mesh ? p.mesh.visible : null }); return a; });
  const cAv = await client.evaluate(() => { const g = window.__game; const a = []; for (const [, p] of g.net.players) if (p.pos) a.push({ n: p.name, dx: +(p.pos.x - g.player.pos.x).toFixed(1), dz: +(p.pos.z - g.player.pos.z).toFixed(1), mesh: !!p.mesh, vis: p.mesh ? p.mesh.visible : null }); return a; });
  console.log('HOST AVATARS:', JSON.stringify(hAv), 'CLIENT AVATARS:', JSON.stringify(cAv));
  await host.screenshot({ path: `${dir}/v-16-net-host.png` });
  await client.screenshot({ path: `${dir}/v-17-net-client.png` });
  console.log('net host errors', hErr.length, 'client errors', cErr.length);
  errors.push(...hErr, ...cErr);
} catch (e) {
  errors.push('HARNESS: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
} finally {
  await browser.close();
  console.log('\n=== VISUAL HARNESS ERRORS (' + errors.length + ') ===');
  errors.slice(0, 20).forEach((e) => console.log(e));
  fs.writeFileSync('test/visual-errors.log', errors.join('\n\n'));
  process.exit(errors.length ? 1 : 0);
}
