import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Systems test — exercises the new layers (items, inventory, ammo, statuses,
 * progression, deployables, spawn director) and fails on any runtime error.
 */
const url = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); });
page.on('console', (m) => { if (m.type() === 'error' && !/user gesture is required/i.test(m.text())) errors.push('CONSOLE: ' + m.text().split('\n')[0]); });

function log(...a) { console.log(...a); }

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.click('#btn-solo');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });
  await page.waitForTimeout(2500);

  const report = await page.evaluate(async () => {
    const g = window.__game;
    const R = {};
    const mod = await import('/src/game/items/registry.js');
    const models = await import('/src/game/items/models.js');
    const ammo = await import('/src/game/ammo.js');
    const status = await import('/src/game/status.js');
    const effects = await import('/src/game/items/effects.js');

    // ---- items ----
    R.itemCount = mod.ITEM_COUNT;
    R.cats = {};
    let modelsBuilt = 0;
    for (const it of mod.ITEMS) {
      const m = models.buildItemModel(it, { glow: true });
      if (m && m.children.length) modelsBuilt++;
      R.cats[it.cat] = (R.cats[it.cat] || 0) + 1;
    }
    R.modelsBuilt = modelsBuilt;
    R.uniqueIds = new Set(mod.ITEMS.map(i => i.id)).size;

    // ---- apply every item effect ----
    let applied = 0, failed = [];
    for (const it of mod.ITEMS) {
      // ensure requirements
      if (it.id.startsWith('ammo_')) g.weaponSystem.loadAmmo(it.ammoType, 10);
      else g.inventory.add(it.id, 3);
      try {
        const res = effects.applyItemEffect(g, it);
        if (res && res.msg != null) applied++;
      } catch (e) { failed.push(it.id + ':' + e.message); }
    }
    R.effectsApplied = applied;
    R.effectFailures = failed;

    // ---- inventory behaviour ----
    const inv = g.inventory;
    inv.slots.fill(null); inv.hotbar.fill(null);
    const leftover = inv.add('scrap_metal', 500);
    R.stackLeftover = leftover;
    R.stackAdded = inv.countOf('scrap_metal');
    const removed = inv.remove('scrap_metal', 200);
    R.removed = removed;
    R.stackAfterRemove = inv.countOf('scrap_metal');
    // hotbar + quick heal
    inv.add('medkit', 2); inv.ensureHotbar('medkit');
    R.hotbar0 = inv.hotbar[0];
    g.player.health = 50;
    g.quickHeal();
    R.healthAfterQuickHeal = g.player.health;

    // ---- ammo types ----
    R.ammoTypes = ammo.AMMO_TYPES.length;
    let ammoOk = 0;
    for (const a of ammo.AMMO_TYPES) {
      g.weaponSystem.loadAmmo(a.id, 30);
      const stats = g.weaponSystem.def;
      if (stats.ammoName && stats.tracer) ammoOk++;
    }
    R.ammoApplied = ammoOk;

    // ---- statuses on an enemy ----
    const e = g.enemies.spawn('grunt', g.world.findStreetSpawn(g.player.pos.x + 6, g.player.pos.z + 6));
    let stOk = 0;
    for (const k in status.STATUS_DEFS) { e.applyStatus(k, 5, 1); stOk++; }
    R.statusKinds = stOk;
    R.statusApplied = Object.keys(e.statuses).length;

    // ---- progression (deep multi-branch tree) ----
    const prog = await import('/src/game/progression.js');
    R.branches = prog.BRANCHES.length;
    R.nodeCount = prog.NODE_IDS.length;
    let unlocked = 0, weaponStates = 0, badStat = [];
    for (const w of g.weaponSystem.weapons) {
      weaponStates++;
      const st = g.progression.stateFor(w.base.id);
      st.level = 20; st.mp = 80;
      for (const nid of prog.NODE_IDS) if (g.progression.unlockNode(w.base.id, nid)) unlocked++;
      g.weaponSystem.recompute(w);
      const s = w.stats;
      if (!(s.dmg > 0) || !(s.rpm > 0) || !Number.isFinite(s.dmg) || w.mag < 1) badStat.push(w.base.id);
    }
    R.weapons = weaponStates; R.nodesUnlocked = unlocked; R.badStat = badStat;
    R.exclusiveViolation = g.weaponSystem.weapons.some(w => {
      const st = g.progression.stateFor(w.base.id);
      return st.nodes.includes('lethal3a') && st.nodes.includes('lethal3b');
    });
    g.progression.scrap = 99999;
    R.respec = g.progression.respec('rifle');
    const rif = g.weaponSystem.weapons.find(w => w.base.id === 'rifle');
    R.riflePerks = Object.keys(rif.stats.perks || {});
    R.rifleCrit = +rif.stats.crit.toFixed(2);
    R.riflePen = +rif.stats.pen.toFixed(2);

    // exercise perks at runtime (crit/executioner/deadeye/lifesteal paths)
    rif.ammo = rif.mag; rif.reserve = 9999; g.weaponSystem.index = 2;
    g.weaponSystem.spreadBloom = 0.4;
    for (let i = 0; i < 25; i++) { g.weaponSystem.cooldown = 0; g.weaponSystem._fire(); }
    R.perkFireOk = true;

    // ---- districts ----
    const dist = await import('/src/game/districts.js');
    const seen = new Set();
    for (let i = 0; i < 3000; i++) seen.add(dist.districtIdAt((Math.random() - 0.5) * 9000, (Math.random() - 0.5) * 9000));
    R.districts = [...seen].sort();
    R.districtDeterministic = dist.districtIdAt(123.4, -500) === dist.districtIdAt(123.4, -500);

    // ---- loot tables ----
    const tables = await import('/src/game/loot/tables.js');
    R.tableCount = Object.keys(tables.TABLES).length;
    let rolls = 0, badRefs = [], rarityCounts = {};
    for (const tid in tables.TABLES) {
      for (let i = 0; i < 30; i++) {
        const out = tables.rollTable(Math.random, tid, 0);
        for (const o of out) {
          rolls++;
          const it = mod.ITEMS_BY_ID[o.id];
          if (!it) badRefs.push(tid + ':' + o.id);
          else rarityCounts[it.rarity] = (rarityCounts[it.rarity] || 0) + 1;
        }
      }
    }
    R.tableRolls = rolls; R.badRefs = badRefs; R.rarityCounts = rarityCounts;
    const rareShare = (luck) => {
      let rare = 0, tot = 0;
      for (let i = 0; i < 4000; i++) {
        const out = tables.rollTable(Math.random, 'street', luck);
        const it = out[0] && mod.ITEMS_BY_ID[out[0].id];
        if (it) { tot++; if (['rare', 'epic', 'legendary'].includes(it.rarity)) rare++; }
      }
      return tot ? rare / tot : 0;
    };
    R.rareShare0 = +rareShare(0).toFixed(3);
    R.rareShare2 = +rareShare(2.0).toFixed(3);

    // ---- crafting ----
    const craftMod = await import('/src/game/crafting.js');
    g.inventory.slots.fill(null);
    g.inventory.add('electronics', 30); g.inventory.add('weapon_parts', 30);
    g.inventory.add('polymer', 30); g.inventory.add('nano_core', 12); g.inventory.add('data_chip', 12);
    g.progression.scrap = 99999;
    let crafted = 0; const craftFail = [];
    for (const r of craftMod.RECIPES) { const res = craftMod.craft(g, r.id); if (res.ok) crafted++; else craftFail.push(r.id + ':' + res.msg); }
    R.recipes = craftMod.RECIPES.length; R.crafted = crafted; R.craftFail = craftFail;

    // ---- enemy drop sources + elites ----
    const dropBefore = g.loot.active.length;
    for (let i = 0; i < 18; i++) g.loot.dropAt(g.player.pos, 'officer', i % 2 === 0);
    R.enemyDrops = g.loot.active.length - dropBefore;
    const elite = g.enemies.spawn('grunt', g.world.findStreetSpawn(g.player.pos.x + 5, g.player.pos.z + 5), null, { elite: true });
    R.eliteSpawned = !!(elite && elite.elite);
    R.eliteHp = elite ? Math.round(elite.maxHealth) : 0;

    // ---- deployables ----
    let deployed = 0;
    for (const kind of ['turret', 'drone', 'mine', 'barrier', 'decoy']) {
      const pos = g.world.findStreetSpawn(g.player.pos.x + 3 + deployed, g.player.pos.z + 3);
      const d = g.deployables.deploy(kind, pos, { x: 1, z: 0 }, g);
      if (d) deployed++;
    }
    R.deployed = deployed;

    // ---- grenades (each kind) ----
    let grenades = 0;
    for (const kind of ['frag', 'incendiary', 'emp', 'smoke', 'flash', 'cryo', 'cluster']) {
      const pos = g.player.eyePos;
      const dir = g.player.getLookDir();
      g.projectiles.spawnGrenade(pos, dir, 'player', 10, kind);
      grenades++;
    }
    R.grenades = grenades;

    // ---- spawn director ----
    for (let i = 0; i < 40; i++) g.spawner.update(0.1, { player: g.player, density: 1.5, threatMul: 1.5 });
    R.spawnedAlive = g.enemies.countAlive();
    R.threat = g.spawner.threat;

    // ---- loot ----
    R.lootActive = g.loot.active.length;
    R.lootTaken = g.loot.taken.size;
    R.renderCalls = g.renderer.info.render.calls;
    return R;
  });

  log('SYSTEMS REPORT:');
  log(JSON.stringify(report, null, 1));

  await page.waitForTimeout(2500); // let projectiles/deployables tick
  const after = await page.evaluate(() => ({
    projectileFail: window.__game.projectiles.list.length,
    deployed: window.__game.deployables.list.length,
    enemyStatuses: window.__game.enemies.list.filter(e => Object.keys(e.statuses).length).length,
    fps: window.__game.fps,
    lootActive: window.__game.loot.active.length,
  }));
  log('AFTER TICK:', JSON.stringify(after));
  await page.screenshot({ path: 'test/shot-systems.png' });

  // open inventory + arsenal and screenshot
  await page.evaluate(() => { window.__game.toggleInventory(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/shot-inventory.png' });
  await page.evaluate(() => { const g = window.__game; g.hud._invTab = 'craft'; g.hud._renderInventory(g); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/shot-craft.png' });
  await page.evaluate(() => { const g = window.__game; if (g.hud.inventoryOpen) g.toggleInventory(); g.openArsenal(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test/shot-arsenal.png' });
} catch (e) {
  errors.push('HARNESS: ' + e.message);
} finally {
  await browser.close();
  fs.writeFileSync('test/systems-errors.log', errors.join('\n\n'));
  log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 25).forEach(e => log(e));
  process.exit(errors.length ? 1 : 0);
}
