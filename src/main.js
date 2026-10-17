import * as THREE from 'three';
import { AsciiComposer, DEFAULT_RAMP, DETAIL_RAMP, SYMBOL_RAMP } from './engine/ascii.js';
import { Input } from './engine/input.js';
import { AudioEngine } from './engine/audio.js';
import { DnBEngine } from './music/dnb.js';
import { World } from './game/world.js';
import { setSrgbSupported } from './game/textures.js';
import { NavGrid } from './game/nav.js';
import { Effects } from './game/effects.js';
import { ProjectileManager } from './game/projectiles.js';
import { EnemyManager } from './game/enemies.js';
import { WeaponSystem } from './game/weapons.js';
import { Player } from './game/player.js';
import { Net } from './game/net.js';
import { HUD } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { SpawnDirector } from './game/spawner.js';
import { Buffs } from './game/buffs.js';
import { Inventory } from './game/items/inventory.js';
import { LootSystem } from './game/items/loot.js';
import { Deployables } from './game/deployables.js';
import { Progression, makeAttachResolver, MAX_WEAPON_LEVEL, NODE_IDS, TREE } from './game/progression.js';
import { ITEMS_BY_ID } from './game/items/registry.js';
import { applyItemEffect } from './game/items/effects.js';
import { districtAt } from './game/districts.js';
import { craft } from './game/crafting.js';
import { t, getLang, setLang } from './ui/i18n.js';
import { applyContentLanguage, enemyName, weaponName } from './ui/localize.js';

/** Seconds of holding G for a full-power grenade throw. */
const GRENADE_CHARGE_TIME = 1.15;

class Game {
  constructor() {
    applyContentLanguage();
    document.documentElement.lang = getLang();
    this.canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x03060a, 1);

    // Software rasterisers (headless/CI) are handled by keeping every canvas
    // texture in sRGB — see textures.js.
    let srgbOk = true;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rstr = (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '';
      this.gpuString = rstr;
    } catch (e) { /* ignore */ }
    setSrgbSupported(srgbOk);

    this.scene = new THREE.Scene();
    this.baseFov = 78;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.05, 4000);
    this.scene.add(this.camera);

    this.composer = new AsciiComposer(this.renderer, { charSize: 14, ramp: DEFAULT_RAMP });
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.dnb = new DnBEngine(this.audio);

    this.world = new World(this.scene);
    this.nav = new NavGrid(this.world, 27);
    this.effects = new Effects(this.scene);
    this.projectiles = new ProjectileManager(this.scene, this.effects, this.world, this.audio);
    this.enemies = new EnemyManager(this.scene, this.world, this.nav, this.effects, this.audio, this.projectiles);
    this.player = new Player(this.camera, this.world, this.audio);
    this.weaponSystem = new WeaponSystem({
      camera: this.camera, player: this.player, world: this.world, audio: this.audio,
      effects: this.effects, projectiles: this.projectiles, enemies: this.enemies,
      cameraPos: this.camera.position, net: null,
    });
    this.net = new Net();
    this.enemies.net = this.net;
    this.weaponSystem.ctx.net = this.net;
    this.weaponSystem.ctx.stats = this;
    // route incoming bullets through the melee blade-deflection buff
    this.player.deflectHook = (kind, point) => this.weaponSystem.tryDeflect(kind, point);

    // ---- new systems: buffs, inventory, progression, loot, deployables, spawns ----
    this.buffs = new Buffs();
    this.inventory = new Inventory(40, 240);
    this.progression = new Progression();
    this.attachResolver = makeAttachResolver(ITEMS_BY_ID);
    this.player.buffs = this.buffs;
    this.player.enemies = this.enemies;
    for (const key of ['progression', 'buffs', 'inventory', 'attachResolver']) {
      this.weaponSystem.ctx[key] = this[key];
      this.weaponSystem[key] = this[key];
    }
    this.deployables = new Deployables(this.scene, this.world, this.enemies, this.effects, this.audio, this.projectiles);
    this.loot = new LootSystem(this.scene, this.world, this.inventory, this.effects, this.audio);
    this.world.onInteriorVisible = (b) => this.loot.populateInterior(b);
    this.spawner = new SpawnDirector(this.world, this.enemies, this.effects, this.audio);
    this.reveal = { mode: null, until: 0 };
    this.grenadeKind = 'frag';
    this.grenadeCharge = 0;
    this.grenadeCharging = false;
    this._grenadeChargeT = 0;
    this._grenadeWasFull = false;
    this.nearEntrance = null;
    this.world.onChunkUnload = (cx, cz) => this.loot.offChunk(cx, cz);

    this.hud = new HUD(document.getElementById('ui'));
    // desktop gets a no-op stand-in so the main loop can call it unconditionally
    this.touch = this.input.touch ? new TouchControls(this) : { setVisible() {}, update() {} };

    this.enemies.onKill = (enemy, head) => {
      this.kills++;
      this.score += enemy.type.xp || 10;
      if (head) this.headshots++;
      this.progression.addScrap(Math.round((enemy.type.xp || 10) * 1.6));
      if (this.spawner) this.spawner.onKill();
      if (this.loot) this.loot.dropAt(enemy.pos, enemy.typeKey || 'grunt', enemy.elite);
      // weight & feedback: a kill kicks the camera; melee kills get a sting
      this.player.viewShake = Math.min(1.2, this.player.viewShake + 0.22);
      if (this.audio.swordKill && enemy.lastDamageSrc === 'dao') this.audio.swordKill();
      this.hud.killFeed(`<span style="color:var(--accent)">${t('hud.you')}</span> ▸ ${enemyName(enemy.typeKey || enemy.type.name)}${head ? ' ⌖' : ''}`);
    };
    this.loot.onPickup = (def, got) => {
      this.hud.toast(t('msg.pickup', { n: got, name: def.name }));
    };
    this.progression.onLevelUp = (id, lvl) => {
      this.hud.toast(t('msg.levelUp', { weapon: weaponName(id), lvl }));
      if (this.audio) this.audio.killConfirm();
    };
    this.progression.onScrap = (n) => { /* HUD polls progression.scrap */ };

    this.state = 'menu';
    this.fps = 60;
    this._fpsAcc = 0; this._fpsCount = 0;
    this.kills = 0; this.headshots = 0; this.score = 0;
    this.shots = 0; this.hits = 0;
    this.grenades = 4;
    this.wave = 1;
    this.pickups = [];
    this.avatarGroup = new THREE.Group();
    this.scene.add(this.avatarGroup);
    this.objectiveText = t('obj.awaiting');
    this.config = { difficulty: 1, density: 1, track: 0 };
    this.funMode = false;
    this._lastChunks = 0;
    this._netAcc = 0;
    this._lowHealthWarn = 0;
    this._shake = 0;
    this._hitStop = 0;   // brief global time-stop on heavy melee impacts
    this.menuOpen = false;

    // spawn player at a street
    const spawn = this.world.findStreetSpawn(120, 120);
    this.player.reset(spawn, this.world.openYaw(spawn));
    this.world.update(this.player.pos);

    this._bindUI();
    this._bindNet();
    this._bindResize();
    this._bindInput();
    this._buildMuzzleless();

    this.last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.hud.showMenu();
  }

  _buildMuzzleless() {
    // muzzle world anchor for player tracer origin
    this.playerMuzzle = new THREE.Object3D();
    this.camera.add(this.playerMuzzle);
    this.playerMuzzle.position.set(0.25, -0.15, -0.9);
  }

  _bindInput() {
    this.input.onLockChange((locked) => {
      if (locked) { this._hadLock = true; return; }
      // ignore spurious immediate loss right after requesting the lock
      if (performance.now() - (this._startedAt || 0) < 1500) return;
      if (this.state === 'playing' && !this.menuOpen) this.setPaused(true);
    });
    this.canvas.addEventListener('mousedown', () => {
      if (this.input.touch) return;
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
  }

  _bindResize() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.composer.setSize(w, h);
    });
  }

  _bindUI() {
    const $ = (id) => document.getElementById(id);

    // ASCII rendering is optional — some players prefer the raw 3D view.
    // The choice persists across sessions, and the ASCII-only controls are
    // greyed out while it is off.
    const asciiOnly = ['in-char', 'in-ramp', 'in-color', 'in-edge'];
    const syncAsciiControls = () => {
      const on = $('in-ascii').checked;
      for (const id of asciiOnly) {
        const el = $(id);
        el.disabled = !on;
        const label = el.closest('label');
        if (label) label.style.opacity = on ? '' : '0.4';
      }
    };
    if (localStorage.getItem('bdsc_ascii') === '0') $('in-ascii').checked = false;
    if (this.input.touch && localStorage.getItem('bdsc_ascii') !== '0') $('in-char').value = '14';
    this.composer.enabled = $('in-ascii').checked;
    syncAsciiControls();

    const applySettings = () => {
      this.composer.enabled = $('in-ascii').checked;
      localStorage.setItem('bdsc_ascii', this.composer.enabled ? '1' : '0');
      syncAsciiControls();
      this.composer.charSize = parseInt($('in-char').value, 10);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.audio.setVolumes({ music: parseFloat($('in-music').value), sfx: parseFloat($('in-sfx').value) });
      this.composer.color = $('in-color').checked;
      this.composer.material.uniforms.uColor.value = this.composer.color ? 1 : 0;
      this.composer.edge = $('in-edge').checked;
      this.composer.material.uniforms.uEdge.value = this.composer.edge ? 1 : 0;
    };
    ['in-char', 'in-ramp', 'in-color', 'in-edge', 'in-ascii', 'in-music', 'in-sfx'].forEach(id => {
      $(id).addEventListener('input', () => {
        if (id === 'in-ramp') this._reloadRamp();
        else applySettings();
      });
      $(id).addEventListener('change', play => {});
    });

    $('btn-host').addEventListener('click', () => this.startGame({ host: true }));
    $('btn-join').addEventListener('click', () => this.startGame({ host: false, joinOnly: true }));
    $('btn-solo').addEventListener('click', () => this.startGame({ solo: true }));
    $('in-track').addEventListener('change', () => {
      const track = this.dnb.setTrack(parseInt($('in-track').value, 10));
      if (track) this.hud.setMenuStatus(t('menu.status.playing', { name: track.name }));
    });
    $('in-lang').addEventListener('change', () => {
      if (!setLang($('in-lang').value)) return;
      applyContentLanguage();
      this.hud.refreshLanguage();
    });
    // FUN MODE ("爽玩"): overrides difficulty / density / track entirely.
    const funEl = $('in-fun');
    const syncFunMode = () => {
      const on = funEl.checked;
      for (const id of ['in-diff', 'in-density', 'in-track']) {
        const el = $(id);
        if (el) el.disabled = on;
      }
    };
    funEl.addEventListener('change', syncFunMode);
    syncFunMode();
    $('btn-resume').addEventListener('click', () => this.setPaused(false));
    $('btn-arsenal').addEventListener('click', () => this.openArsenal());
    $('btn-quit').addEventListener('click', () => this.quitToMenu());
    $('btn-quit2').addEventListener('click', () => this.quitToMenu());
    $('btn-respawn').addEventListener('click', () => this.respawn());
  }

  _reloadRamp() {
    const v = document.getElementById('in-ramp').value;
    const ramp = v === '1' ? SYMBOL_RAMP : (v === '2' ? DETAIL_RAMP : DEFAULT_RAMP);
    this.composer.setRamp(ramp);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  _bindNet() {
    const net = this.net;
    net.on('playerJoin', (p) => { this._ensureAvatar(p); this.hud.toast(t('msg.playerJoin', { name: p.name })); });
    net.on('playerLeave', (msg) => {
      this.hud.toast(t('msg.playerLeave', { name: msg.name }));
      const p = net.players.get(msg.from);
      if (p && p.mesh) this.avatarGroup.remove(p.mesh);
    });
    net.on('here', (msg) => { if (!net.isHost) {} this.hud.setMenuStatus(t('menu.status.here', { name: msg.name })); });
    net.on('snapshot', (arr) => { if (!this.net.isHost) this.enemies.applySnapshot(arr); });
    net.on('hitReport', (msg) => {
      if (!this.net.isHost) return;
      this.enemies.damageById(msg.e, msg.d, !!msg.h, { x: msg.x, y: msg.y, z: msg.z }, null, msg.from);
    });
    net.on('takeDamage', (msg) => { this.player.takeDamage(msg.a, null, 'bullet', msg.p ? new THREE.Vector3(msg.p.x, msg.p.y, msg.p.z) : null); this.hud.damageFlash(); });
    net.on('shot', (msg) => {
      const from = new THREE.Vector3(msg.x, msg.y, msg.z);
      const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz);
      if (msg.p) return;
      const to = from.clone().addScaledVector(dir, 60);
      this.effects.tracer(from, to, [0.6, 1.0, 0.7], 0.05);
    });
    net.on('enemyShot', (msg) => {
      const from = new THREE.Vector3(msg.x, msg.y, msg.z);
      const to = new THREE.Vector3(msg.tx, msg.ty, msg.tz);
      this.effects.tracer(from, to, [1, 0.5, 0.2], 0.06);
    });
    net.on('killFeed', (msg) => { this.hud.killFeed(`<span style="color:var(--accent)">${msg.k}</span> ▸ ${enemyName(msg.et)}${msg.h ? ' ⌖' : ''}`); });
    net.on('chat', (msg) => { this.hud.toast(`${msg.name}: ${msg.m}`); });
    net.on('objective', (msg) => { this.objectiveText = msg.m; });
    net.on('disconnected', () => { this.hud.toast(t('msg.relayDown')); });
    net.on('reconnected', () => { this.hud.toast(t('msg.relayUp')); });
  }

  _ensureAvatar(p) {
    if (p.mesh) return;
    p.mesh = buildAvatar(new THREE.Color(p.color[0], p.color[1], p.color[2]));
    this.avatarGroup.add(p.mesh);
  }

  async startGame(opts = {}) {
    this.audio.resume();
    this.config.difficulty = parseFloat(document.getElementById('in-diff').value);
    this.config.density = parseFloat(document.getElementById('in-density').value);
    this.config.track = parseInt(document.getElementById('in-track').value, 10);
    const funEl = document.getElementById('in-fun');
    const wantFun = !!(funEl && funEl.checked);

    this.enemies.difficulty = {
      aimSpeed: this.config.difficulty,
      accuracy: 0.7 + this.config.difficulty * 0.3,
      damage: 0.55 + this.config.difficulty * 0.5,
      fireRate: 0.8 + this.config.difficulty * 0.3,
      hp: 0.75 + this.config.difficulty * 0.4,
    };

    // A new run must never inherit role flags from the previous one. Leaving
    // `_isClient` set after a co-op client session made the next SOLO run
    // believe it was still a client (no host AI / spawn director at all).
    this._isClient = false;
    this._isHost = false;

    if (!opts.solo) {
      this.hud.setMenuStatus(t('menu.status.connecting'));
      try {
        const res = await this.net.join(
          document.getElementById('in-room').value,
          document.getElementById('in-name').value,
          { host: !!opts.host }
        );
        this.hud.setMenuStatus(t(opts.host ? 'menu.status.host' : 'menu.status.client', { broker: res.broker }));
        if (!opts.host) {
          // demote: wait for host snapshots
          this._isClient = true;
        }
      } catch (e) {
        this.hud.setMenuStatus(t('menu.status.relayFail', { err: this.net.lastError }));
      }
    }

    if (!this._isClient) this._isHost = true;
    this.enemies.net = this.net;

    // FUN MODE force-plays its exclusive, relentless BGM and ignores the
    // difficulty/density/track selections.
    this.funMode = wantFun;
    if (this.funMode) this.dnb.setTrack('berserk');
    else this.dnb.setTrack(this.config.track);
    this.dnb.start();
    this.audio.setShouldRun(true);
    this.audio.startAmbience();

    this.hud.hideMenu();
    this.hud.setHudVisible(true);
    this.setPaused(false);

    this.state = 'playing';
    this._startedAt = performance.now();
    this.input.requestLock();

    // Wipe everything the previous run could have left behind *before* the new
    // run's modifiers are applied. This is what makes FUN MODE -> normal mode
    // safe: perks, maxed mod trees, free attachments, 9999 reserve ammo and the
    // hyper-spawn director are all reset here.
    this._resetRunState();

    const spawn = this.world.findStreetSpawn(this.player.pos.x + 4, this.player.pos.z + 4);
    this.player.reset(spawn, this.world.openYaw(spawn));
    if (this.funMode) this._applyFunMode();
    this.objectiveText = t('obj.inbound');
    this.hud.toast(opts.solo ? t('msg.solo') : (this._isHost ? t('msg.hosting') : t('msg.joined')));
    if (this.funMode) this.hud.toast(t('msg.funmode'));
    if (this.input.touch) this.hud.toast(t('touch.hint'));
  }

  /** Neutralise every per-run system. Must be idempotent and complete. */
  _resetRunState() {
    this.kills = 0; this.headshots = 0; this.score = 0; this.shots = 0; this.hits = 0;
    this.grenades = 4; this.grenadeKind = 'frag';
    this.grenadeCharging = false; this.grenadeCharge = 0; this._grenadeChargeT = 0;
    this._grenadeWasFull = false;
    this._grenadeTime = -9;
    this.player.hitEvent = null;
    this.wave = 1;
    this.enemies.reset();
    this.projectiles.clear();
    this.deployables.clear();
    this.loot.clear();
    this.loot.taken.clear();
    this.buffs.clear();
    this.inventory.slots.fill(null);
    this.inventory.hotbar.fill(null);
    this.progression.reset();
    this.spawner.reset();
    this.weaponSystem.resetRun();
    this.reveal = { mode: null, until: 0 };
    this.player.resetRun();
    this._hitStop = 0;
    this._hitPulse = 0;
    // A new run always starts with no overlay soft-pausing the simulation.
    this.menuOpen = false;
    this._invPrevState = null;
    if (this.hud && this.hud.inventoryOpen) this.hud.toggleInventory(this);
    if (this.hud && this.hud.arsenalOpen) this.hud.hideArsenal();
  }

  /**
   * FUN MODE ("爽玩"): a pure power fantasy — the player is invincible and
   * faster, every weapon is max level with every mod-tree node unlocked and
   * best-in-slot attachments, ammo/grenades/scrap are effectively unlimited,
   * and the SpawnDirector floods the map with hostiles.
   */
  _applyFunMode() {
    const p = this.player;
    p.invincible = true;
    p.speedMul = 1.6;
    p.jumpMul = 1.25;
    p.health = p.maxHealth;
    p.armor = p.maxArmor;

    // Max every weapon: level 20 plus the entire mod tree (both exclusive
    // branches included — this is a power fantasy, not a fair build).
    for (const w of this.weaponSystem.weapons) {
      const st = this.progression.stateFor(w.base.id);
      st.level = MAX_WEAPON_LEVEL;
      st.xp = 0;
      st.mp = 0;
      st.nodes = [...NODE_IDS];
      st.spent = st.nodes.reduce((n, id) => n + (TREE[id] ? TREE[id].cost : 0), 0);
    }
    // Best-in-slot attachments on every weapon (assigned directly, no inventory).
    const best = { muzzle: 'heavy_barrel', optic: 'thermal_scope', magazine: 'drum_mag', underbarrel: 'explosive_kit', grip: 'match_trigger' };
    for (const w of this.weaponSystem.weapons) {
      w.attachments = {};
      for (const slot in best) if (ITEMS_BY_ID[best[slot]]) w.attachments[slot] = best[slot];
      this.weaponSystem.recompute(w);
      w.ammo = w.mag;
      w.reserve = 9999;
    }
    this.grenades = 99;
    this.progression.scrap = Math.max(this.progression.scrap, 99999);

    // Hyper-spawning horde: tighter annulus, higher cap, no recycling.
    this.spawner.funMode = true;
    this.spawner.minSpawnR = 30;
    this.spawner.maxSpawnR = 74;
    this.spawner.despawnR = 280;
  }

  setPaused(on) {
    if (this.state !== 'playing' && on) return;
    if (on && this.hud.inventoryOpen) this.toggleInventory();
    this.state = on ? 'paused' : 'playing';
    this.hud.showPause(on);
    if (on) this.input.exitLock(); else this.input.requestLock();
  }

  quitToMenu() {
    this.state = 'menu';
    this.hud.showPause(false);
    this.hud.showDead(false);
    this.hud.showMenu();
    this.hud.setHudVisible(false);
    if (this.net.enabled) this.net.leave();
    this._isClient = false; this._isHost = false;
    this.dnb.stop();
    this.audio.stopAmbience();
    this.audio.setShouldRun(false);
    this.grenadeCharging = false; this.grenadeCharge = 0;
    this.input.exitLock();
  }

  respawn() {
    this.hud.showDead(false);
    const spawn = this.world.findStreetSpawn(this.player.pos.x, this.player.pos.z);
    this.player.reset(spawn, this.world.openYaw(spawn));
    this.weaponSystem.weapons.forEach((w) => { w.ammo = w.mag; w.reserve = Math.max(w.reserve, w.base.reserve); });
    this.state = 'playing';
    this.input.requestLock();
  }

  /* ---------------------------- items & abilities --------------------------- */
  toggleInventory() {
    const open = this.hud.toggleInventory(this);
    this.menuOpen = open;
    if (open) {
      // Soft-pause: time stops while the bag is open, but the pause menu is not
      // shown. Enemies used to keep shooting during inventory management.
      this._invPrevState = this.state;
      if (this.state === 'playing') this.state = 'paused';
      this.input.exitLock();
    } else {
      if (this._invPrevState && this.state === 'paused' && !this.hud.arsenalOpen) {
        this.state = this._invPrevState === 'playing' ? 'playing' : this._invPrevState;
      }
      this._invPrevState = null;
      if (this.state === 'playing') this.input.requestLock();
    }
  }

  openArsenal() {
    this.hud.showPause(false);
    this.hud.showArsenal(this);
  }

  useItemId(id) {
    const def = ITEMS_BY_ID[id];
    if (!def || !this.inventory.has(id)) return false;
    const res = applyItemEffect(this, def);
    if (res.consumed) this.inventory.remove(id, 1);
    if (res.msg) this.hud.toast(res.msg);
    if (this.audio) this.audio.uiClick();
    return res.consumed;
  }

  useHotbar(index) {
    const id = this.inventory.hotbar[index];
    if (!id) return;
    this.useItemId(id);
  }

  quickHeal() {
    const p = this.player;
    const priority = ['trauma_kit', 'medkit', 'blood_pack', 'bandage', 'ration_pack', 'regenerator'];
    for (const id of priority) {
      if (this.inventory.has(id)) { this.useItemId(id); return; }
    }
    for (const s of this.inventory.slots) {
      if (!s) continue;
      const d = ITEMS_BY_ID[s.id];
      if (d && d.use && d.use.type === 'use' && d.use.effect === 'heal') { this.useItemId(s.id); return; }
    }
    this.hud.toast(t('msg.noHeal'));
  }

  setReveal(mode, dur, radius = 90) {
    this.reveal.mode = mode;
    this.reveal.until = performance.now() / 1000 + dur;
    this.reveal.radius = radius;
  }
  get revealActive() { return this.reveal.mode && (performance.now() / 1000) < this.reveal.until; }

  addModPoints(n) {
    const id = this.weaponSystem.baseDef.id;
    this.progression.addModPoints(id, n);
    this.weaponSystem.recompute(this.weaponSystem.weapon);
    this.hud.toast(t('msg.modPoints', { n, weapon: this.weaponSystem.baseDef.name }));
  }

  craftRecipe(id) {
    const res = craft(this, id);
    this.hud.toast(res.msg);
    if (res.ok && this.audio) this.audio.pickup('ammo');
    else if (this.audio) this.audio.uiError();
    return res.ok;
  }

  /* ------------------------------ player attack ---------------------------- */
  /**
   * Grenades are charged, not tap-thrown: hold G to wind up, release to throw.
   * Charge controls both throw speed and the upward arc, so a short tap lobs a
   * grenade at your feet and a full charge sails it across the street.
   */
  beginGrenadeCharge() {
    if (this.grenades <= 0) { this.hud.toast(t('msg.noGrenades')); return; }
    if (this.weaponSystem.time - (this._grenadeTime || -9) < 0.45) return;
    this.grenadeCharging = true;
    this._grenadeChargeT = 0;
    this.grenadeCharge = 0;
    this._grenadeWasFull = false;
  }

  releaseGrenadeCharge() {
    if (!this.grenadeCharging) return;
    const charge = Math.max(0, Math.min(1, this._grenadeChargeT / GRENADE_CHARGE_TIME));
    this.grenadeCharging = false;
    this.grenadeCharge = 0;
    if (this.grenades <= 0) return;
    this._grenadeTime = this.weaponSystem.time;
    this.grenades--;
    const eye = this.player.eyePos;
    const dir = this.player.getLookDir();
    // Spawn just ahead of the eye but never inside the ground.
    const pos = eye.clone().addScaledVector(dir, 0.55);
    const gh = this.world.groundHeight(pos.x, pos.z);
    if (pos.y < gh + 0.5) pos.y = gh + 0.5;
    // Standing flush against a wall: spawn closer to the eye rather than
    // starting the grenade inside the collider (which the slab test can miss).
    if (this.world.pointBlocked(pos.x, pos.y, pos.z, 0.12)) {
      pos.copy(eye).addScaledVector(dir, 0.18);
      if (pos.y < gh + 0.4) pos.y = gh + 0.4;
    }
    const power = 12 + charge * 17;
    const up = 2.4 + charge * 3.4;
    this.projectiles.spawnGrenade(pos, dir, 'player', power, this.grenadeKind, { up, charge });
    if (this.audio) this.audio.grenadeThrow(charge);
  }

  updateGrenadeCharge(dt) {
    if (!this.grenadeCharging) return;
    this._grenadeChargeT += dt;
    const charge = Math.max(0, Math.min(1, this._grenadeChargeT / GRENADE_CHARGE_TIME));
    this.grenadeCharge = charge;
    if (charge >= 1 && !this._grenadeWasFull) {
      this._grenadeWasFull = true;
      if (this.audio) this.audio.chargeReady();
    }
  }

  /** Highlight the nearest enterable doorway so interiors are discoverable. */
  _updateNearEntrance() {
    const p = this.player.pos;
    let best = null;
    let bd = 4.6 * 4.6;
    for (const b of this.world.enterables.values()) {
      if (b.doorX == null) continue;
      // Only advertise the entrance from *outside* the footprint; inside the
      // lobby the same prompt just blocks the view.
      if (Math.abs(p.x - b.x) < b.w / 2 - 0.4 && Math.abs(p.z - b.z) < b.d / 2 - 0.4) continue;
      const ox = (p.x - b.doorX) * (b.doorNx || 0) + (p.z - b.doorZ) * (b.doorNz || 0);
      if (ox < -0.15) continue;
      const dx = p.x - b.doorX, dz = p.z - b.doorZ;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = b; }
    }
    this.nearEntrance = best;
  }

  updateLowHealth(dt) {
    if (this.player.health < 35 && this.player.alive) {
      this._lowHealthWarn -= dt;
      if (this._lowHealthWarn <= 0) { this._lowHealthWarn = 1.6; this.audio.lowHealth(); }
    }
  }

  /* -------------------------------- avatars -------------------------------- */
  updateAvatars(dt) {
    if (!this.net.enabled) return;
    for (const [, p] of this.net.players) {
      if (!p.mesh || !p.pos) continue;
      this._ensureAvatar(p);
      const mesh = p.mesh;
      const rig = mesh.userData.rig;
      let speed = 0;
      if (p._lastX !== undefined) speed = Math.hypot(p.pos.x - p._lastX, p.pos.z - p._lastZ) / Math.max(0.016, dt);
      p._lastX = p.pos.x; p._lastZ = p.pos.z;
      if (rig) {
        rig.speed += (Math.min(9, speed) - rig.speed) * Math.min(1, dt * 8);
        rig.phase += dt * (3 + rig.speed * 2.2);
        const amp = Math.min(1, rig.speed / 6);
        const sw = Math.sin(rig.phase) * amp;
        rig.legs[0].rotation.x = sw * 0.75;
        rig.legs[1].rotation.x = -sw * 0.75;
        rig.arms[0].rotation.x = -1.05 - sw * 0.18;
        rig.arms[1].rotation.x = -1.05 + sw * 0.18;
        rig.head.rotation.y = Math.sin(rig.phase * 0.35) * 0.18;
        mesh.position.set(p.pos.x, p.pos.y + Math.abs(Math.sin(rig.phase)) * 0.045 * amp, p.pos.z);
      } else {
        mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
      }
      mesh.rotation.y = p.yaw || 0;
      mesh.visible = p.alive !== 0;
    }
  }

  /* --------------------------------- loop ---------------------------------- */
  _loop(now) {
    requestAnimationFrame(this._loop);
    const rawDt = (now - this.last) / 1000;
    let dt = rawDt;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.0001;

    // Heavy melee impacts briefly slow the whole simulation (hit-stop) so the
    // blow lands with weight.
    if (this.state === 'playing' && this._hitStop > 0) {
      this._hitStop -= dt;
      dt *= 0.12;
    }

    // Report real wall-clock FPS; the simulation's dt is clamped separately to
    // avoid tunnelling, which used to make the FPS readout lie on slow devices.
    this._fpsAcc += Math.max(0.0001, rawDt); this._fpsCount++;
    if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsCount / this._fpsAcc); this._fpsAcc = 0; this._fpsCount = 0; }

    const active = this.state === 'playing';

    // audio housekeeping: teardown finished voices + recover a wedged context
    this.audio.tick(dt);

    // look (scaled by the current zoom so scoped aim stays controllable)
    if (active && this.input.locked) {
      const { dx, dy } = this.input.takeMouse();
      const zoom = this.camera.fov / this.baseFov;
      this.player.applyLook(dx * zoom, dy * zoom);
    } else { this.input.takeMouse(); }

    // Inventory toggling works even while the soft-paused bag is open.
    if (this.input.pressed('KeyI')) {
      if (this.hud.inventoryOpen) this.toggleInventory();
      else if (this.state === 'playing' && !this.menuOpen) this.toggleInventory();
    }

    // pause via ESC (overlays close first, then the pause toggle)
    if (this.input.pressed('Escape') && this.hud.inventoryOpen) this.toggleInventory();
    else if (this.input.pressed('Escape') && this.hud.arsenalOpen) this.hud.hideArsenal();
    else if (this.input.pressed('Escape') && this.state === 'playing') this.setPaused(true);
    else if (this.input.pressed('Escape') && this.state === 'paused') this.setPaused(false);

    if (active) {
      this.player.update(dt, this.input, true);
      this.weaponSystem.update(dt, this.input, !this.menuOpen);
      // grenade: hold to charge, release to throw (tap for a short lob)
      if (!this.menuOpen) {
        this.updateGrenadeCharge(dt);
        if (this.input.pressed('KeyG')) this.beginGrenadeCharge();
        if (this.grenadeCharging && this.input.released('KeyG')) this.releaseGrenadeCharge();
      } else if (this.grenadeCharging) {
        this.grenadeCharging = false;
        this.grenadeCharge = 0;
      }
      // quick-use hotbar + inventory + quick heal
      const hotKeys = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'];
      if (!this.menuOpen) for (let i = 0; i < hotKeys.length; i++) if (this.input.pressed(hotKeys[i])) this.useHotbar(i);
      if (this.input.pressed('KeyQ') && !this.menuOpen) this.quickHeal();
    } else {
      if (this.grenadeCharging) { this.grenadeCharging = false; this.grenadeCharge = 0; }
      this.player.update(dt, this.input, false);
      this.weaponSystem.update(dt, this.input, false);
    }

    // world streaming
    this.world.update(this.player.pos);
    if (this.world.stats.chunks !== this._lastChunks) { this._lastChunks = this.world.stats.chunks; this.nav.clearCache(); }
    this._updateNearEntrance();

    // Buff timers freeze with the simulation; pausing must not burn stims.
    if (active) this.buffs.update(dt);

    // district + loot modifiers derived from the current weapon's tree + buffs
    this.district = districtAt(this.player.pos.x, this.player.pos.z);
    const cdef = this.weaponSystem.def;
    this.luck = (cdef.luck || 0) + this.buffs.additive('luck');
    this.scavenger = (cdef.scavenger || 0) + this.buffs.additive('scavenger');
    this.loot.luck = this.luck;
    this.loot.scavenger = this.scavenger;

    // enemies + projectiles + effects (world simulation scaled by time dilation)
    const timescale = this.buffs.value('timescale');
    const sdt = dt * timescale;
    if (active) {
      this.enemies.update(sdt, this.player, this.camera.position);
      this.projectiles.update(sdt, this.enemies, this.player);
      this.deployables.update(sdt, this.player, this);
      this.effects.update(dt);
      this.loot.ensureAround(this.player);
      this.loot.update(dt, this.player, this);
      if (this._isHost) {
        this.spawner.update(dt, {
          player: this.player, density: this.config.density, threatMul: this.config.difficulty,
          onSurge: (n, threat, dname) => { this.hud.toast(t('msg.surge', { n, dname: dname || '' })); },
        });
        this.wave = Math.floor(this.spawner.threat);
        this.objectiveText = this.spawner.objective;
      }
      this.updateLowHealth(dt);
    } else {
      // Paused / menu / death: keep cosmetic particles alive and keep the
      // camera parked on the player, but freeze the combat simulation.
      // Previously enemies kept shooting through the pause menu and buffs kept
      // ticking while the player could not react.
      this.player.update(dt, this.input, false);
      // Settle cosmetic weapon state (muzzle flash, slash trail, viewmodel)
      // without letting hits resolve — the melee timeline gates on game state.
      this.weaponSystem.update(dt, this.input, false);
      this.effects.update(dt);
    }

    // network
    this.net.update(dt, {
      pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch,
      health: this.player.health, armor: this.player.armor, crouching: this.player.crouching,
      alive: this.player.alive,
    }, this._isHost ? this.enemies : null, this);
    this.updateAvatars(dt);

    // weapon id for net
    this.player.weaponId = this.weaponSystem.def.id;

    // death handling
    if (active && !this.player.alive) {
      this.state = 'dead';
      this.hud.showDead(true,
        t('dead.stats', { wave: this.wave, kills: this.kills, heads: this.headshots, score: this.score }));
      this.input.exitLock();
      this.dnb.setIntensity(0.6);
    }

    // hit tracking counters
    this.weaponSystem.ctx.hud = this.hud;

    // music intensity from combat pressure
    const nearCombat = this.enemies.list.some(e => e.alive && e.state === 'combat' && e.pos.distanceTo(this.player.pos) < 40);
    this.dnb.setIntensity(this.funMode ? 1.6 : (nearCombat ? 1.35 : (this.enemies.countAlive() > 0 ? 1.1 : 0.8)));

    // Damage feedback comes from discrete takeDamage events (not burn ticks).
    if (this.player.hitEvent) {
      const ev = this.player.hitEvent;
      this.player.hitEvent = null;
      if (ev.amount > 0.5) {
        this._hitPulse = 0.8;
        this.hud.damageFlash();
      }
    }

    // scope zoom (DMR scope / thermal optic magnify; plain ADS gets a slight zoom)
    const targetFov = this.weaponSystem.getScopedFov(this.baseFov);
    if (Math.abs(this.camera.fov - targetFov) > 0.02) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    // render
    this.composer.setHit(Math.min(1, this._hitPulse || 0));
    this._hitPulse = Math.max(0, (this._hitPulse || 0) - dt * 3);
    this.composer.render(this.scene, this.camera, now * 0.001);
    this.touch.setVisible(this.state === 'playing' && !this.menuOpen && !this.hud.inventoryOpen && !this.hud.arsenalOpen);
    this.touch.update(this);
    this.hud.update(this);
    this.input.endFrame();
  }
}

/* ------------------------------- avatar mesh ------------------------------ */
function buildAvatar(color) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xa2adb8, metalness: 0.4, roughness: 0.5 });
  const suit = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), emissive: color, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.45 });
  const core = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: color, emissiveIntensity: 2.4, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2026, metalness: 0.6, roughness: 0.5 });
  const add = (parent, w, h, d, x, y, z, m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const legH = 0.8;
  const hipY = legH + 0.1;
  const torsoY = hipY + 0.38;
  const headY = torsoY + 0.48;

  // hips + torso
  add(g, 0.46, 0.2, 0.3, 0, hipY, 0, dark);
  add(g, 0.62, 0.72, 0.36, 0, torsoY, 0, skin);
  add(g, 0.68, 0.16, 0.42, 0, torsoY + 0.3, 0, dark);       // shoulder yoke
  add(g, 0.66, 0.05, 0.4, 0, torsoY + 0.4, 0, core);        // glowing collar
  add(g, 0.2, 0.2, 0.06, 0, torsoY + 0.08, -0.2, core);     // chest core
  add(g, 0.34, 0.4, 0.18, 0, torsoY + 0.02, 0.24, dark);    // backpack
  add(g, 0.18, 0.05, 0.03, 0, torsoY + 0.1, 0.34, core);

  // head
  const head = add(g, 0.34, 0.32, 0.34, 0, headY, 0, skin);
  add(head, 0.28, 0.06, 0.04, 0, 0.02, -0.18, core);
  add(head, 0.36, 0.05, 0.38, 0, 0.15, 0, dark);
  add(head, 0.02, 0.2, 0.02, 0.14, 0.24, 0.06, core);

  // legs with pivots
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, legH + 0.05, 0);
    add(pivot, 0.22, 0.5, 0.24, 0, -0.24, 0, suit);
    add(pivot, 0.2, 0.4, 0.22, 0, -0.62, 0, dark);
    add(pivot, 0.24, 0.14, 0.34, 0, -0.82, -0.04, dark);
    g.add(pivot); legs.push(pivot);
  }
  // arms with pivots + rifle
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.4, torsoY + 0.22, 0);
    add(pivot, 0.16, 0.5, 0.18, 0, -0.25, 0, suit);
    add(pivot, 0.14, 0.36, 0.16, 0, -0.58, -0.04, dark);
    add(pivot, 0.14, 0.14, 0.2, 0, -0.8, -0.1, skin);
    pivot.rotation.x = -1.05;
    g.add(pivot); arms.push(pivot);
  }
  add(g, 0.09, 0.12, 0.55, 0.08, torsoY - 0.02, -0.38, dark);
  add(g, 0.05, 0.04, 0.2, 0.08, torsoY + 0.05, -0.32, core);

  // friendly marker above the head so allies read at a glance
  const tag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  tag.rotation.x = Math.PI; tag.position.set(0, headY + 0.5, 0); g.add(tag);

  g.userData.rig = { legs, arms, head, phase: Math.random() * 6.28, lastX: 0, lastZ: 0, speed: 0 };
  return g;
}

/* -------------------------------- bootstrap ------------------------------- */
const game = new Game();
window.__game = game;
