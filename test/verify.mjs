import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Full warning/error audit — drives a long gameplay session and collects every
 * console message and page error, then reports unique lines.
 */
const url = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });

const errors = new Map();
const warnings = new Map();
const add = (map, k) => map.set(k, (map.get(k) || 0) + 1);
page.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) add(errors, 'PAGEERROR: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); });
page.on('console', (m) => {
  const t = m.text().split('\n')[0];
  if (/user gesture is required/i.test(t)) return;
  if (m.type() === 'error') add(errors, t);
  else if (m.type() === 'warning') add(warnings, t);
});

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.click('#btn-solo');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });

  // exercise a broad slice of gameplay
  await page.evaluate(async () => {
    const g = window.__game;
    // give resources + use a spread of items
    g.inventory.slots.fill(null);
    g.inventory.add('medkit', 3); g.inventory.add('stim_shot', 3); g.inventory.add('overshield', 2);
    g.inventory.add('auto_turret', 2); g.inventory.add('wpn_module', 2); g.inventory.add('luck_charm', 2);
    g.player.health = 40;
    for (const id of ['medkit', 'stim_shot', 'overshield', 'auto_turret', 'wpn_module', 'luck_charm']) g.useItemId(id);
    // elites + drops
    for (let i = 0; i < 6; i++) g.enemies.spawn('heavy', g.world.findStreetSpawn(g.player.pos.x + 8 + i, g.player.pos.z + 6), null, { elite: i % 2 === 0 });
    g.loot.dropAt(g.player.pos, 'officer', true);
    // tree + craft
    g.progression.scrap = 9000;
    for (const nid of ['lethal1', 'lethal2', 'lethal3a', 'tempo1', 'tempo2', 'control1', 'utility1', 'utility2', 'utility3b']) g.progression.unlockNode('rifle', nid);
    g.weaponSystem.recompute(g.weaponSystem.weapon);
  });

  // move, look, fire, grenade, switch weapons, open menus over ~14s
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(500 + i * 20, 288);
    await page.waitForTimeout(300);
  }
  await page.mouse.down(); await page.waitForTimeout(1400); await page.mouse.up();
  await page.keyboard.press('Digit4'); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  await page.keyboard.press('Digit6'); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  await page.keyboard.press('KeyG');
  await page.keyboard.press('Digit1'); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__game.toggleInventory(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const g = window.__game; g.hud._invTab = 'craft'; g.hud._renderInventory(g); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const g = window.__game; g.toggleInventory(); g.openArsenal(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const g = window.__game; g.hud.hideArsenal(); g.setPaused(true); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__game.setPaused(false); });
  // keep fighting a while with the ASCII pass under load
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => ({
    state: window.__game.state,
    alive: window.__game.enemies.countAlive(),
    loot: window.__game.loot.active.length,
    fps: window.__game.fps,
  }));
  console.log('FINAL STATE:', JSON.stringify(state));
  await page.screenshot({ path: 'test/shot-verify.png' });
} catch (e) {
  add(errors, 'HARNESS: ' + e.message);
} finally {
  await browser.close();
  const dump = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `[x${v}] ${k}`).join('\n');
  const werr = dump(errors), wwarn = dump(warnings);
  console.log('\n=== ERRORS (' + [...errors.values()].reduce((a, b) => a + b, 0) + ') ===\n' + (werr || '(none)'));
  console.log('\n=== WARNINGS (' + [...warnings.values()].reduce((a, b) => a + b, 0) + ') ===\n' + (wwarn || '(none)'));
  fs.writeFileSync('test/verify-report.log', 'ERRORS\n' + werr + '\n\nWARNINGS\n' + wwarn);
  process.exit(errors.size ? 1 : 0);
}
