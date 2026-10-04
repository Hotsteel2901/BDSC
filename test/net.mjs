import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });

const room = 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase();

async function newPage() {
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  return p;
}

const host = await newPage();
const client = await newPage();

await host.evaluate((r) => { document.getElementById('in-room').value = r; }, room);
await client.evaluate((r) => { document.getElementById('in-room').value = r; }, room);

await host.click('#btn-host');
await host.waitForTimeout(2500);
await client.click('#btn-join');
await client.waitForTimeout(7000);

// In one browser only one page can hold pointer lock, which triggers auto-pause;
// force both back to playing for the sync test.
for (const p of [host, client]) {
  await p.evaluate(() => {
    const g = window.__game;
    g.state = 'playing';
    g.hud.showPause(false);
    g.waveTimer = 0.2;
  });
}
await host.waitForTimeout(6000);

const hostState = await host.evaluate(() => {
  const g = window.__game;
  return { enabled: g.net.enabled, connected: g.net.connected, isHost: g.net.isHost, players: g.net.players.size, broker: g.net.broker, enemies: g.enemies.list.length, room: g.net.room, ping: g.net.ping };
});
const clientState = await client.evaluate(() => {
  const g = window.__game;
  return { enabled: g.net.enabled, connected: g.net.connected, isHost: g.net.isHost, players: g.net.players.size, broker: g.net.broker, enemies: g.enemies.list.length, ghosts: g.enemies.list.filter(e => e.ghost).length, room: g.net.room };
});
console.log('HOST  :', JSON.stringify(hostState));
console.log('CLIENT:', JSON.stringify(clientState));

// move client and see if host sees remote player move
await client.keyboard.down('KeyW');
await client.waitForTimeout(1500);
await client.keyboard.up('KeyW');
await client.waitForTimeout(1500);
const hostSees = await host.evaluate(() => {
  const g = window.__game;
  const arr = [];
  for (const [, p] of g.net.players) arr.push({ name: p.name, x: p.pos ? +p.pos.x.toFixed(1) : null, hasMesh: !!p.mesh });
  return { players: arr, avatars: g.avatarGroup.children.length };
});
console.log('HOST SEES:', JSON.stringify(hostSees));

// client shoots an enemy ghost -> host should register damage / kill
const killTest = await client.evaluate(async () => {
  const g = window.__game;
  // wait for at least one ghost
  return { ghosts: g.enemies.list.filter(e => e.ghost).length };
});
console.log('CLIENT GHOSTS:', JSON.stringify(killTest));

await host.screenshot({ path: 'test/shot-net-host.png' });
await client.screenshot({ path: 'test/shot-net-client.png' });

await browser.close();
