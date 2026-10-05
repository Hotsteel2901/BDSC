import { chromium } from 'playwright';

/**
 * Mobile acceptance — emulates touch phones and drives the whole on-screen
 * control set: dynamic move/look sticks, fire/ADS/crouch/jump/reload/grenade/
 * heal buttons, the 7-weapon strip, quickbar slots, inventory, pause and the
 * portrait rotate hint. Also checks the touch layout stays on screen and
 * overlap-free on a narrow landscape phone.
 *
 * Run with the dev server up:  npm run test:mobile
 */
const url = (process.argv[2] || 'http://localhost:5173') + '/?touch=1';
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const errors = [];

const newPhone = async (viewport) => {
  const ctx = await browser.newContext({
    viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/AudioContext/i.test(e.message)) errors.push('PAGEERROR: ' + e.message.split('\n')[0]); });
  page.on('console', (m) => {
    const txt = m.text();
    // headless containers have no audio device; the AudioContext warning is environmental
    if (m.type() === 'error' && !/AudioContext/i.test(txt)) errors.push('CONSOLE: ' + txt.split('\n')[0]);
  });
  return { ctx, page };
};

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

// Injected helper: synthetic touch pointer events + frame-based waits so the
// test is stable on slow software renderers.
const HELPERS = `(el, type, x, y, id=7) => {
  el.dispatchEvent(new PointerEvent(type, { pointerId:id, pointerType:'touch', isPrimary:true, clientX:x, clientY:y, bubbles:true, cancelable:true }));
}`;

try {
  const { ctx, page } = await newPhone({ width: 844, height: 390 });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  check(await page.evaluate(() => document.body.classList.contains('touch')), 'touch mode detected');
  check(await page.evaluate(() => !!document.querySelector('#touch')), 'touch layer exists');
  check(await page.evaluate(() => !document.querySelector('#touch').classList.contains('on')), 'touch controls hidden in menu');
  check(await page.evaluate(() => (document.querySelector('#menu-controls').textContent || '').includes('stick') || document.documentElement.lang === 'zh'), 'menu hint switched to touch wording');
  await page.screenshot({ path: 'test/m-01-menu.png' });

  await page.click('#btn-solo');
  await page.waitForTimeout(3500);
  await page.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); g.input.requestLock(); });
  await page.waitForTimeout(2200);
  check(await page.evaluate(() => document.querySelector('#touch').classList.contains('on')), 'touch controls visible while playing');
  check(await page.evaluate(() => window.__game.input.locked), 'virtual look lock active');
  await page.screenshot({ path: 'test/m-02-play.png' });

  // ---- move joystick (drag up) + auto sprint + analogue reset ----
  const moved = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const zone = document.querySelector('#tzone-move');
    const g = window.__game;
    const p0 = { x: g.player.pos.x, z: g.player.pos.z };
    f(zone, 'pointerdown', 180, 300);
    f(zone, 'pointermove', 180, 210);
    await frames(30);
    const sprinting = g.player.sprinting;
    const axis = { ...g.input.vMove };
    f(zone, 'pointerup', 180, 210);
    await frames(3);
    return { dist: Math.hypot(g.player.pos.x - p0.x, g.player.pos.z - p0.z), sprinting, axis, after: { ...g.input.vMove } };
  }, { helpers: HELPERS });
  check(moved.dist > 3, `move stick drives the player (${moved.dist.toFixed(1)}m)`);
  check(moved.sprinting, 'auto-sprint at full stick deflection');
  check(moved.axis.y > 0.5, 'analogue axis points forward');
  check(moved.after.x === 0 && moved.after.y === 0, 'axis resets on release');

  // ---- look drag ----
  const look = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const zone = document.querySelector('#tzone-look');
    const g = window.__game;
    const yaw0 = g.player.yaw; const pitch0 = g.player.pitch;
    f(zone, 'pointerdown', 600, 180);
    f(zone, 'pointermove', 680, 150);
    f(zone, 'pointerup', 680, 150);
    await frames(3);
    return { dyaw: Math.abs(g.player.yaw - yaw0), dpitch: Math.abs(g.player.pitch - pitch0) };
  }, { helpers: HELPERS });
  check(look.dyaw > 0.05 && look.dpitch > 0.02, `look drag rotates the camera (dyaw ${look.dyaw.toFixed(2)})`);

  // ---- fire (hold) ----
  const fire = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const b = document.querySelector('.tbtn.fire');
    const g = window.__game;
    const shots0 = g.shots; const ammo0 = g.weaponSystem.weapon.ammo;
    f(b, 'pointerdown', 770, 340);
    await frames(6);
    f(b, 'pointerup', 770, 340);
    await frames(2);
    return { fired: g.shots > shots0 || g.weaponSystem.weapon.ammo < ammo0, shots: g.shots };
  }, { helpers: HELPERS });
  check(fire.fired, `fire button shoots (shots ${fire.shots})`);

  // ---- ADS + crouch toggles ----
  const toggles = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    f(document.querySelector('.tbtn.ads'), 'pointerdown', 700, 240);
    f(document.querySelector('.tbtn.crouch'), 'pointerdown', 630, 130);
    await frames(4);
    const ads = g.weaponSystem.adsTarget === 1;
    const crouch = g.player.crouching;
    const adsOn = document.querySelector('.tbtn.ads').classList.contains('on');
    const crouchOn = document.querySelector('.tbtn.crouch').classList.contains('on');
    f(document.querySelector('.tbtn.ads'), 'pointerdown', 700, 240);
    f(document.querySelector('.tbtn.crouch'), 'pointerdown', 630, 130);
    await frames(4);
    return { ads, crouch, adsOn, crouchOn, adsOff: g.weaponSystem.adsTarget === 0, crouchOff: !g.player.crouching };
  }, { helpers: HELPERS });
  check(toggles.ads && toggles.adsOn, 'ADS toggle on');
  check(toggles.crouch && toggles.crouchOn, 'crouch toggle on');
  check(toggles.adsOff && toggles.crouchOff, 'toggles switch back off');

  // ---- jump ----
  const jump = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    g.player.onGround = true;
    f(document.querySelector('.tbtn.jump'), 'pointerdown', 700, 330);
    await frames(4);
    f(document.querySelector('.tbtn.jump'), 'pointerup', 700, 330);
    const airborne = !g.player.onGround || g.player.vel.y > 0.5;
    await frames(30);
    return airborne;
  }, { helpers: HELPERS });
  check(jump, 'jump button leaves the ground');

  // ---- reload ----
  const reload = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    g.weaponSystem.reloading = false;
    g.weaponSystem.weapon.ammo = 3;
    f(document.querySelector('.tbtn.reload'), 'pointerdown', 700, 250);
    await frames(3);
    return g.weaponSystem.reloading;
  }, { helpers: HELPERS });
  check(reload, 'reload button starts a reload');

  // ---- weapon strip (all 8) ----
  const weapons = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    const strip = document.querySelectorAll('#touch-weapons .tweap');
    f(strip[0], 'pointerdown', 300, 20);
    await frames(14);
    const idx1 = g.weaponSystem.index;
    f(strip[4], 'pointerdown', 400, 20);
    await frames(14);
    const idx5 = g.weaponSystem.index;
    f(strip[7], 'pointerdown', 500, 20);
    await frames(14);
    return { idx1, idx4: idx5, idx8: g.weaponSystem.index, melee: !!g.weaponSystem.def.melee, buttons: strip.length };
  }, { helpers: HELPERS });
  check(weapons.buttons === 8, 'all 8 weapons on the touch strip');
  check(weapons.idx1 === 0 && weapons.idx4 === 4, `weapon strip selects (1 -> ${weapons.idx1}, 5 -> ${weapons.idx4})`);
  check(weapons.idx8 === 7 && weapons.melee, `weapon strip selects the melee dao (8 -> ${weapons.idx8})`);

  // ---- quickbar slot ----
  const quick = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    g.inventory.add('medkit', 2);
    g.inventory.setHotbar(0, 'medkit');
    g.player.health = 40;
    const hp0 = g.player.health;
    f(document.querySelector('[data-qi="0"]'), 'pointerdown', 320, 370);
    await frames(6);
    return { used: g.player.health > hp0, hp: g.player.health };
  }, { helpers: HELPERS });
  check(quick.used, 'quickbar slot uses the item (heal)');

  // ---- grenade ----
  const nade = await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    const frames = (n) => new Promise(res => { let i = 0; const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const g = window.__game;
    const n0 = g.grenades;
    f(document.querySelector('.tbtn.grenade'), 'pointerdown', 660, 110);
    await frames(4);
    return { n0, n1: g.grenades, proj: g.projectiles.list.length };
  }, { helpers: HELPERS });
  check(nade.n1 < nade.n0 || nade.proj > 0, `grenade button throws (${nade.n0} -> ${nade.n1})`);

  // ---- inventory open/close ----
  await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    f(document.querySelector('#touch-top .tbtn.inv'), 'pointerdown', 800, 20);
    await new Promise(r => setTimeout(r, 600));
  }, { helpers: HELPERS });
  const invState = await page.evaluate(() => ({
    open: window.__game.hud.inventoryOpen,
    hidden: !document.querySelector('#touch').classList.contains('on'),
  }));
  check(invState.open, 'inventory button opens the inventory');
  check(invState.hidden, 'touch controls hidden over the inventory');
  await page.screenshot({ path: 'test/m-03-inventory.png' });
  await page.evaluate(() => { document.querySelector('#btn-inv-close').click(); });
  await page.waitForTimeout(500);
  check(await page.evaluate(() => !window.__game.hud.inventoryOpen), 'inventory closes');

  // ---- layout: buttons on screen, no overlaps, quickbar clear of the cluster ----
  const layout = await page.evaluate(() => {
    const onScreen = (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth + 1 && r.y + r.height <= innerHeight + 1;
    const btns = [...document.querySelectorAll('#touch-actions .tbtn, #touch-top .tbtn')];
    const rects = btns.map(b => ({ r: b.getBoundingClientRect(), id: b.className }));
    const offscreen = rects.filter(x => !onScreen(x.r)).map(x => x.id);
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ox > 4 && oy > 4) overlaps.push(rects[i].id + ' vs ' + rects[j].id);
      }
    }
    const qb = document.querySelector('#quickbar').getBoundingClientRect();
    const cluster = document.querySelector('#touch-actions').getBoundingClientRect();
    const quickClear = qb.x + qb.width < cluster.x + 1;
    return { offscreen, overlaps, count: rects.length, quickClear };
  });
  check(layout.count >= 9, `all action buttons rendered (${layout.count})`);
  check(layout.offscreen.length === 0, 'no action button off screen: ' + layout.offscreen.join(','));
  check(layout.overlaps.length === 0, 'no action button overlaps: ' + layout.overlaps.join(','));
  check(layout.quickClear, 'quickbar does not overlap the action cluster');

  // ---- pause ----
  await page.evaluate(async ({ helpers }) => {
    const f = eval(helpers);
    f(document.querySelector('#touch-top .tbtn.pause'), 'pointerdown', 800, 20);
    await new Promise(r => setTimeout(r, 600));
  }, { helpers: HELPERS });
  const paused = await page.evaluate(() => ({ state: window.__game.state, hidden: !document.querySelector('#touch').classList.contains('on') }));
  check(paused.state === 'paused' && paused.hidden, 'pause button pauses + hides controls');
  await ctx.close();

  // ---- narrow landscape: quickbar must stay clear of the cluster ----
  const { ctx: ctxN, page: pageN } = await newPhone({ width: 667, height: 375 });
  await pageN.goto(url, { waitUntil: 'load' });
  await pageN.waitForTimeout(3500);
  await pageN.click('#btn-solo');
  await pageN.waitForTimeout(3000);
  await pageN.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); g.input.requestLock(); });
  await pageN.waitForTimeout(1200);
  const narrow = await pageN.evaluate(() => {
    const onScreen = (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth + 1 && r.y + r.height <= innerHeight + 1;
    const btns = [...document.querySelectorAll('#touch-actions .tbtn')].map(b => b.getBoundingClientRect());
    const qb = document.querySelector('#quickbar').getBoundingClientRect();
    // compare against the actual bottom-row buttons, not the cluster's bounding box
    const bottom = [...document.querySelectorAll('#touch-actions .tbtn.jump, #touch-actions .tbtn.fire')]
      .map(b => b.getBoundingClientRect().x).sort((a, b) => a - b)[0];
    return { offscreen: btns.filter(r => !onScreen(r)).length, quickClear: qb.x + qb.width < bottom + 1 };
  });
  check(narrow.offscreen === 0, 'narrow phone: buttons on screen');
  check(narrow.quickClear, 'narrow phone: quickbar clear of the cluster');
  await pageN.screenshot({ path: 'test/m-04-narrow.png' });
  await ctxN.close();

  // ---- portrait: rotate hint ----
  const { ctx: ctxP, page: pageP } = await newPhone({ width: 390, height: 844 });
  await pageP.goto(url, { waitUntil: 'load' });
  await pageP.waitForTimeout(3500);
  await pageP.click('#btn-solo');
  await pageP.waitForTimeout(3000);
  await pageP.evaluate(() => { const g = window.__game; g.state = 'playing'; g.hud.showPause(false); g._startedAt = performance.now(); g.input.requestLock(); });
  await pageP.waitForTimeout(1200);
  const portrait = await pageP.evaluate(() => {
    const rot = document.querySelector('#touch-rotate');
    return { display: getComputedStyle(rot).display, text: rot.textContent.trim() };
  });
  check(portrait.display === 'flex', 'portrait shows the rotate-device hint');
  check(portrait.text.length > 0, 'rotate hint has text');
  await pageP.screenshot({ path: 'test/m-05-portrait.png' });
  await ctxP.close();
} catch (e) {
  fail.push('HARNESS: ' + e.message);
  console.error('HARNESS ERROR', e.stack || e.message);
}

await browser.close();
console.log('\n=== ERRORS (' + errors.length + ') ===');
errors.slice(0, 10).forEach(e => console.log(' ' + e));
console.log('=== RESULT: ' + (fail.length ? fail.length + ' FAILURES' : 'ALL PASSED') + ' ===');
fail.forEach(f => console.log(' - ' + f));
process.exit(fail.length || errors.length ? 1 : 0);
