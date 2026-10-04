import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173';

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-web-security',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  logs.push(`[${m.type()}] ${t}`);
  if (m.type() === 'error' && !/user gesture is required/i.test(t)) errors.push('CONSOLE ERROR: ' + t);
});
page.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')); });

function log(...a) { console.log(...a); }

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3500);

  await page.screenshot({ path: 'test/shot-00-menu.png' });
  const hasGame = await page.evaluate(() => !!window.__game);
  log('hasGame:', hasGame);
  const gl = await page.evaluate(() => {
    const g = window.__game;
    return g ? {
      renderer: !!g.renderer,
      ascii: !!g.composer,
      contextLost: g.renderer && g.renderer.getContext().isContextLost(),
      charSize: g.composer.charSize,
    } : null;
  });
  log('renderer:', JSON.stringify(gl));

  // Start SOLO
  await page.click('#btn-solo');
  await page.waitForTimeout(1500);
  // headless pointer-lock is unreliable; force the sim to run
  await page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });

  // let world stream + waves start
  await page.waitForTimeout(6000);

  const st = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state, wave: g.wave, waveState: g.waveState,
      enemies: g.enemies.list.length, alive: g.enemies.countAlive(),
      chunks: g.world.stats.chunks, buildings: g.world.stats.buildings,
      colliderCells: g.world.stats.colliders,
      player: { x: +g.player.pos.x.toFixed(2), y: +g.player.pos.y.toFixed(2), z: +g.player.pos.z.toFixed(2), hp: g.player.health },
      fps: g.fps,
      weapon: g.weaponSystem.def.name,
      drawCalls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
      pickups: g.pickups.length,
    };
  });
  log('STATE:', JSON.stringify(st, null, 1));

  await page.screenshot({ path: 'test/shot-01-start.png' });

  // move + look
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.mouse.move(700, 360);
  await page.waitForTimeout(300);

  // fire a burst
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(500);

  // switch weapons and fire
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(600);
  await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  await page.keyboard.press('Digit6');
  await page.waitForTimeout(600);
  await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  await page.keyboard.press('KeyG'); // grenade
  await page.waitForTimeout(1000);

  // deterministic combat test: spawn an enemy in front, aim, fire
  await page.evaluate(() => {
    const g = window.__game;
    const yaw = g.player.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const pos = g.world.findStreetSpawn(g.player.pos.x + fwd.x * 9, g.player.pos.z + fwd.z * 9);
    g.enemies.spawn('grunt', pos, null, {});
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const g = window.__game;
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) { if (!e.alive) continue; const d = e.pos.distanceTo(g.player.pos); if (d < bd) { bd = d; best = e; } }
    if (best) {
      const dx = best.pos.x - g.player.pos.x, dz = best.pos.z - g.player.pos.z;
      const dy = (best.pos.y + 1.0) - (g.player.pos.y + g.player.eyeHeight);
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  });
  await page.keyboard.press('Digit3'); // rifle
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(2600);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const combatRes = await page.evaluate(() => ({
    kills: window.__game.kills, alive: window.__game.enemies.countAlive(),
    score: window.__game.score, hp: window.__game.player.health,
    particles: window.__game.effects.count,
  }));
  log('COMBAT RESULT:', JSON.stringify(combatRes));

  const st2 = await page.evaluate(() => {
    const g = window.__game;
    return {
      enemies: g.enemies.list.length, alive: g.enemies.countAlive(),
      shots: g.shots, kills: g.kills,
      player: { x: +g.player.pos.x.toFixed(2), z: +g.player.pos.z.toFixed(2) },
      projectiles: g.projectiles.list.length,
      particles: g.effects.count,
      fps: g.fps,
    };
  });
  log('AFTER COMBAT:', JSON.stringify(st2, null, 1));
  await page.screenshot({ path: 'test/shot-02-combat.png' });

  // teleport player into a building interior to test interiors
  const interior = await page.evaluate(() => {
    const g = window.__game;
    if (!g.world.enterables.size) return { ok: false };
    const first = [...g.world.enterables.values()][0];
    // place near a corner of the ground floor, away from the staircase
    const V = g.player.pos.constructor;
    g.player.reset(new V(first.x - first.w / 2 + 2, 0.5, first.z - first.d / 2 + 2), Math.PI * 0.75);
    g.world.update(g.player.pos);
    return { ok: true, x: first.x, z: first.z, w: first.w, d: first.d, floors: first.detailFloors };
  });
  log('INTERIOR TEST:', JSON.stringify(interior));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test/shot-03-interior.png' });

  // collision sanity: try to walk into building centre
  const col = await page.evaluate(() => {
    const g = window.__game;
    return { onGround: g.player.onGround, y: +g.player.pos.y.toFixed(2), hp: g.player.health };
  });
  log('INTERIOR STATE:', JSON.stringify(col));

  // UI settings live-change test (char size, edge glyphs, ramp, tint)
  await page.evaluate(() => {
    const set = (id, val, ev) => { const e = document.getElementById(id); if (val !== null) e.value = val; e.dispatchEvent(new Event(ev, { bubbles: true })); };
    set('in-char', '9', 'input');
    set('in-edge', null, 'change');
    document.getElementById('in-edge').checked = false;
    set('in-ramp', '1', 'change');
    document.getElementById('in-color').checked = true;
  });
  await page.waitForTimeout(800);
  const uiState = await page.evaluate(() => ({ charSize: window.__game.composer.charSize, cellPx: window.__game.composer.cellPx, ramp: window.__game.composer.ramp.length }));
  log('UI SETTINGS STATE:', JSON.stringify(uiState));
  await page.screenshot({ path: 'test/shot-04-settings.png' });

  // Performance-ish: measure fps over 3s
  const perf = await page.evaluate(async () => {
    const g = window.__game;
    return await new Promise((res) => {
      let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res({ frames: n, ms: performance.now() - t0, fps: Math.round(n / ((performance.now() - t0) / 1000)), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }); };
      requestAnimationFrame(tick);
    });
  });
  log('PERF:', JSON.stringify(perf));

  fs.writeFileSync('test/console.log', logs.join('\n'));
  log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 30).forEach(e => log(e));
} catch (e) {
  log('TEST HARNESS ERROR:', e.message);
  errors.push('HARNESS: ' + e.message);
} finally {
  await browser.close();
  fs.writeFileSync('test/errors.log', errors.join('\n\n'));
  process.exit(errors.length ? 1 : 0);
}
