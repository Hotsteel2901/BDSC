import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
await page.bringToFront();
const errors = [];
page.on('pageerror', (e) => { if (!/user gesture is required/i.test(e.message)) errors.push(e.message); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2800);
await page.click('#btn-solo'); await page.waitForTimeout(1400);
await page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const g = window.__game;
  window.__minY = Infinity;
  const orig = g.player.update.bind(g.player);
  g.player.update = (dt, i, a) => { orig(dt, i, a); if (g.player.pos.y < window.__minY) window.__minY = g.player.pos.y; };
});

let worst = Infinity, offGround = 0, samples = 0;
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.world.findStreetSpawn((Math.random() - 0.5) * 5000, (Math.random() - 0.5) * 5000);
    g.player.reset(s, Math.random() * 6.28);
    window.__minY = Infinity;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(() => ({ min: +window.__minY.toFixed(2), y: +window.__game.player.pos.y.toFixed(2), on: window.__game.player.onGround }));
  if (r.min < worst) worst = r.min;
  if (!r.on) offGround++;
  samples++;
}

// big fall from 40m straight down onto the current (road) column
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.findStreetSpawn(300, 300);
  g.player.reset(s, 0); g.player.pos.y = 40; g.player.vel.set(0, 0, 0); window.__minY = Infinity;
});
await page.waitForTimeout(12000);
const fall = await page.evaluate(() => ({ min: +window.__minY.toFixed(2), y: +window.__game.player.pos.y.toFixed(2), on: window.__game.player.onGround, gh: +window.__game.world.groundHeight(window.__game.player.pos.x, window.__game.player.pos.z).toFixed(2) }));

console.log('WALK worst=' + worst + ' offGround=' + offGround + '/' + samples);
console.log('FALL ', JSON.stringify(fall));
console.log('ERRORS', errors.length);
const ok = worst > -0.35 && fall.y <= fall.gh + 0.5;
console.log(ok ? 'GROUND OK' : 'GROUND FAIL');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
