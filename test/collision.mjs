import { chromium } from 'playwright';

/**
 * Collision regression — walking straight into a building face (or a street
 * prop) must never fling the player along the wall to a far corner. Drives the
 * player into each face/corner of the nearest building and prop and asserts the
 * per-frame displacement stays in normal walking range.
 *
 * Run with the dev server up:  npm run test:collision
 */
const url = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/i.test(m.text())) errors.push(m.text().split('\n')[0]); });

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await page.click('#btn-solo');
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const g = window.__game;
    g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now();
    g.spawner.enabled = false;
    for (const e of g.enemies.list) e.removeMe = true;
  });

  const result = await page.evaluate(async () => {
    const g = window.__game;
    const P = g.player;
    const V = P.pos.constructor;
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });

    const colliders = [...new Set(g.world.queryColliders(
      new V(P.pos.x - 90, 0, P.pos.z - 90), new V(P.pos.x + 90, 80, P.pos.z + 90)
    ))];
    const nearest = (tag) => colliders
      .filter(b => b.tag === tag)
      .sort((a, b) => a.min.distanceToSquared(P.pos) - b.min.distanceToSquared(P.pos))[0];

    const approach = async (box, mode) => {
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const r = P.radius;
      let x = cx, z = cz;
      if (mode === 'x-') x = box.min.x - r - 0.35;
      if (mode === 'x+') x = box.max.x + r + 0.35;
      if (mode === 'z-') z = box.min.z - r - 0.35;
      if (mode === 'z+') z = box.max.z + r + 0.35;
      if (mode === 'corner') { x = box.min.x - r - 0.35; z = box.min.z - r - 0.35; }
      if (mode === 'corner2') { x = box.max.x + r + 0.35; z = box.max.z + r + 0.35; }
      const gh = g.world.groundHeight(x, z);
      P.reset(new V(x, gh + 0.15, z), Math.atan2(-(cx - x), -(cz - z)));
      P.vel.set(0, 0, 0);
      await frames(6);

      let maxJump = 0;
      let prevX = P.pos.x, prevZ = P.pos.z;
      g.input.pressVirtual('KeyW');
      for (let i = 0; i < 26; i++) {
        await frames(1);
        maxJump = Math.max(maxJump, Math.hypot(P.pos.x - prevX, P.pos.z - prevZ));
        prevX = P.pos.x; prevZ = P.pos.z;
      }
      g.input.releaseVirtual('KeyW');
      const info = { tag: box.tag, mode, maxJump: +maxJump.toFixed(3), elevated: P.pos.y > 1.0 };
      P.reset(new V(0, 20, 0), 0);
      await frames(2);
      return info;
    };

    const runs = [];
    const building = nearest('building');
    const prop = nearest('lamp') || nearest('prop');
    if (building) for (const m of ['x-', 'x+', 'z-', 'z+', 'corner', 'corner2']) runs.push(await approach(building, m));
    if (prop) for (const m of ['x-', 'x+', 'z-', 'z+', 'corner']) runs.push(await approach(prop, m));
    return { hasBuilding: !!building, hasProp: !!prop, runs };
  });

  check(result.hasBuilding, 'found a building collider near spawn');
  check(result.hasProp, 'found a street prop near spawn');
  for (const r of result.runs) {
    check(r.maxJump < 0.6, `${r.tag}/${r.mode}: no teleport (max ${r.maxJump}m/frame)`);
    check(!r.elevated, `${r.tag}/${r.mode}: blocked, not snapped on top (y<=1)`);
  }
} catch (e) {
  fail.push('HARNESS: ' + e.message);
  console.error('HARNESS ERROR', e.stack || e.message);
}

await browser.close();
console.log('\n=== ERRORS (' + errors.length + ') ===');
errors.slice(0, 5).forEach(e => console.log(' ' + e));
console.log('=== RESULT: ' + (fail.length ? fail.length + ' FAILURES' : 'ALL PASSED') + ' ===');
fail.forEach(f => console.log(' - ' + f));
process.exit(fail.length || errors.length ? 1 : 0);
