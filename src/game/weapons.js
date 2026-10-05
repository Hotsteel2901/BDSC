import * as THREE from 'three';
import { t } from '../ui/i18n.js';

export const WEAPONS = [
  { id: 'pistol', name: 'VECTOR-9', cat: 'SIDEARM', dmg: 26, rpm: 320, mode: 'semi', mag: 12, reserve: 120, spread: 0.007, moveSpread: 0.02, recoilP: 1.05, recoilY: 0.28, reload: 1.45, pellets: 1, range: 140, color: 0xffddaa, tracer: [1, 0.85, 0.5] },
  { id: 'smg', name: 'WASP SMG', cat: 'CQC', dmg: 15, rpm: 900, mode: 'auto', mag: 36, reserve: 360, spread: 0.019, moveSpread: 0.03, recoilP: 0.5, recoilY: 0.34, reload: 1.8, pellets: 1, range: 120, color: 0xffe0b0, tracer: [1, 0.82, 0.45] },
  { id: 'rifle', name: 'PULSE AR', cat: 'ASSAULT', dmg: 22, rpm: 640, mode: 'auto', mag: 30, reserve: 300, spread: 0.011, moveSpread: 0.026, recoilP: 0.72, recoilY: 0.3, reload: 2.05, pellets: 1, range: 240, color: 0xffe6c0, tracer: [1, 0.88, 0.55] },
  { id: 'shotgun', name: 'BREACH-12', cat: 'BREACH', dmg: 12, rpm: 78, mode: 'pump', mag: 6, reserve: 60, spread: 0.07, moveSpread: 0.02, recoilP: 2.5, recoilY: 0.7, reload: 2.4, perShell: 0.5, pellets: 9, range: 46, color: 0xffcc88, tracer: [1, 0.72, 0.35] },
  { id: 'sniper', name: 'LANCE DMR', cat: 'PRECISION', dmg: 108, rpm: 48, mode: 'semi', mag: 5, reserve: 35, spread: 0.0012, moveSpread: 0.06, recoilP: 3.4, recoilY: 0.5, reload: 2.9, pellets: 1, range: 700, scope: 3.4, color: 0xddeeff, tracer: [0.8, 0.95, 1.0] },
  { id: 'plasma', name: 'ION CASTER', cat: 'ENERGY', dmg: 44, rpm: 190, mode: 'auto', mag: 20, reserve: 160, spread: 0.009, moveSpread: 0.02, recoilP: 0.85, recoilY: 0.35, reload: 2.2, projectile: 'plasma', range: 300, color: 0x66ddff, tracer: [0.4, 0.9, 1.0] },
  { id: 'launcher', name: 'HOUND RL', cat: 'HEAVY', dmg: 90, rpm: 58, mode: 'semi', mag: 4, reserve: 20, spread: 0.006, moveSpread: 0.03, recoilP: 3.6, recoilY: 0.9, reload: 3.2, projectile: 'rocket', range: 400, color: 0xff8844, tracer: [1, 0.6, 0.2] },
  // Melee: a Tang dao (Chinese saber). No ammo/reload; swings with a light
  // 3-hit combo, each variant with its own arc, trail and impact timing.
  { id: 'dao', name: 'TANG DAO', cat: 'MELEE', dmg: 88, rpm: 168, mode: 'melee', melee: true, reach: 3.0, arc: 1.5, mag: 0, reserve: 0, reload: 0, spread: 0, moveSpread: 0, recoilP: 0.9, recoilY: 0.4, range: 3.0, color: 0xbfe9ff, tracer: [0.72, 0.95, 1.0] },
];

/**
 * WeaponSystem — owns the procedural first-person viewmodels, ammo state,
 * fire-mode logic, spread/recoil model and hitscan/projectile resolution.
 */
export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx; // { camera, player, world, audio, effects, projectiles, enemies, net }
    this.materials = this._makeMats();
    this.viewRoot = new THREE.Group();
    ctx.camera.add(this.viewRoot);
    // A short-range fill light so the procedural viewmodel always reads well in
    // the ASCII pass without significantly lighting the world.
    this.viewLight = new THREE.PointLight(0xdfe8ff, 2.4, 1.1, 2);
    this.viewLight.position.set(0.15, 0.25, 0.05);
    this.viewRoot.add(this.viewLight);
    this.viewLightWarm = new THREE.PointLight(0xffcf9a, 1.4, 0.9, 2);
    this.viewLightWarm.position.set(0.5, -0.3, -0.2);
    this.viewRoot.add(this.viewLightWarm);
    this.muzzleFlash = this._makeFlash();
    this.viewRoot.add(this.muzzleFlash.root);
    // Melee slash trail (camera space; a fading crescent that sweeps with the swing).
    this.slash = this._makeSlash();
    this.viewRoot.add(this.slash.root);

    this.progression = ctx.progression || null;
    this.buffs = ctx.buffs || null;
    this.inventory = ctx.inventory || null;
    this.attachResolver = ctx.attachResolver || (() => null);

    this.weapons = WEAPONS.map((d) => ({
      base: d,
      id: d.id,
      ammoType: d.projectile ? 'standard' : 'standard',
      attachments: {},
      stats: { ...d },
      ammo: d.mag,
      reserve: d.reserve,
      mag: d.mag,
      ready: true,
    }));
    this.index = 2; // rifle
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.switching = 0;
    this.pump = 0;
    this.spreadBloom = 0;
    this.ads = 0;           // 0..1 aim-down-sights
    this.adsTarget = 0;
    this.modelos = null;
    this.time = 0;
    this.firedThisPress = false;
    this.recoilKick = new THREE.Vector3();
    this.recoilRot = new THREE.Vector2();
    this._overclock = 0;
    this._lastShotAt = -9;
    this._vmBasePos = new THREE.Vector3(0.32, -0.28, -0.55);
    this._vmAdsPos = new THREE.Vector3(0, -0.16, -0.42);
    // Melee combo / swing state
    this._melee = null;      // { t, dur, variant, hitAt, hit, freeze, hitCount }
    this._combo = 0;         // advances per swing, wraps 0..2
    this._comboTimer = 0;    // resets the combo when idle
    // Blade-deflection buff: earned by holding a swing for >5s. The chance
    // scales with how slowly you move; fully braced = 100% but rooted until you
    // release the button.
    this._meleeHold = 0;
    this._deflect = 0;
    this._deflectActive = false;
    this._deflectStep = 0;
    this.lastShotTime = 0;
    this.onKillCallback = null;
    this.buildModels();
    this._selectVisual(this.index, true);
  }

  _makeMats() {
    return {
      body: new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.85, roughness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.6, roughness: 0.55 }),
      accent: new THREE.MeshStandardMaterial({ color: 0x1b2026, emissive: 0x37ff8b, emissiveIntensity: 1.4, roughness: 0.3 }),
      accentWarm: new THREE.MeshStandardMaterial({ color: 0x201a12, emissive: 0xffb000, emissiveIntensity: 1.4, roughness: 0.3 }),
      accentCyan: new THREE.MeshStandardMaterial({ color: 0x12202a, emissive: 0x4de0ff, emissiveIntensity: 1.6, roughness: 0.3 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x224455, emissive: 0x66ccff, emissiveIntensity: 0.4, transparent: true, opacity: 0.5 }),
    };
  }

  _box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  _buildGunModel(id) {
    const g = new THREE.Group();
    const B = this.materials.body, D = this.materials.dark;
    let accent = this.materials.accent;
    if (id === 'plasma') accent = this.materials.accentCyan;
    if (id === 'launcher' || id === 'shotgun') accent = this.materials.accentWarm;

    switch (id) {
      case 'pistol': {
        g.add(this._box(0.09, 0.11, 0.42, 0, 0, -0.1, B));
        g.add(this._box(0.07, 0.06, 0.34, 0, 0.06, -0.32, D));
        g.add(this._box(0.08, 0.18, 0.1, 0, -0.13, 0.05, D));
        g.add(this._box(0.04, 0.03, 0.06, 0, 0.09, -0.44, accent));
        g.add(this._box(0.02, 0.1, 0.02, 0, 0.02, -0.47, accent));
        break;
      }
      case 'smg': {
        g.add(this._box(0.1, 0.12, 0.5, 0, 0, -0.15, B));
        g.add(this._box(0.06, 0.06, 0.5, 0, 0.07, -0.42, D));
        g.add(this._box(0.08, 0.22, 0.12, 0, -0.15, 0.02, D));
        g.add(this._box(0.07, 0.1, 0.06, 0, -0.12, -0.32, D));
        g.add(this._box(0.03, 0.02, 0.1, 0, 0.1, -0.5, accent));
        break;
      }
      case 'rifle': {
        g.add(this._box(0.11, 0.13, 0.6, 0, 0, -0.2, B));
        g.add(this._box(0.06, 0.06, 0.7, 0, 0.075, -0.55, D));
        g.add(this._box(0.09, 0.24, 0.14, 0, -0.16, -0.02, D));
        g.add(this._box(0.06, 0.1, 0.08, 0, -0.1, -0.42, D));
        g.add(this._box(0.1, 0.09, 0.22, 0, -0.02, 0.16, D)); // stock
        g.add(this._box(0.03, 0.04, 0.04, 0, 0.11, -0.36, D));
        g.add(this._box(0.05, 0.03, 0.24, 0, 0.115, -0.3, accent)); // rail
        g.add(this._box(0.03, 0.02, 0.08, 0, 0.11, -0.62, accent));
        break;
      }
      case 'shotgun': {
        g.add(this._box(0.13, 0.14, 0.62, 0, 0, -0.16, B));
        g.add(this._box(0.07, 0.07, 0.8, 0, 0.06, -0.6, D));
        g.add(this._box(0.07, 0.07, 0.8, 0, -0.02, -0.6, D)); // tube
        g.add(this._box(0.09, 0.22, 0.13, 0, -0.16, 0.02, D));
        g.add(this._box(0.11, 0.1, 0.24, 0, -0.02, 0.2, D)); // stock
        g.add(this._box(0.05, 0.03, 0.12, 0, 0.09, -0.42, accent));
        break;
      }
      case 'sniper': {
        g.add(this._box(0.11, 0.13, 0.7, 0, 0, -0.24, B));
        g.add(this._box(0.05, 0.05, 1.1, 0, 0.06, -0.8, D));
        g.add(this._box(0.1, 0.22, 0.14, 0, -0.16, -0.05, D));
        g.add(this._box(0.12, 0.11, 0.28, 0, -0.02, 0.2, D));
        // scope
        g.add(this._box(0.08, 0.08, 0.36, 0, 0.2, -0.3, D));
        g.add(this._box(0.09, 0.09, 0.03, 0, 0.2, -0.5, accent));
        g.add(this._box(0.09, 0.09, 0.03, 0, 0.2, -0.1, accent));
        g.add(this._box(0.04, 0.16, 0.04, 0, 0.1, -0.3, D));
        break;
      }
      case 'plasma': {
        g.add(this._box(0.14, 0.16, 0.66, 0, 0, -0.2, B));
        g.add(this._box(0.08, 0.08, 0.5, 0, 0.08, -0.5, D));
        g.add(this._box(0.1, 0.26, 0.15, 0, -0.18, -0.02, D));
        g.add(this._box(0.12, 0.1, 0.26, 0, -0.02, 0.18, D));
        // coil rings
        for (let i = 0; i < 4; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 12), accent);
          ring.position.set(0, 0.08, -0.5 + i * 0.14);
          ring.rotation.y = Math.PI / 2;
          g.add(ring);
        }
        g.add(this._box(0.1, 0.06, 0.06, 0, 0.08, -0.72, accent));
        break;
      }
      case 'launcher': {
        g.add(this._box(0.16, 0.16, 0.8, 0, 0, -0.2, B));
        g.add(this._box(0.18, 0.18, 0.14, 0, 0, -0.62, D));
        g.add(this._box(0.18, 0.18, 0.14, 0, 0, 0.22, D));
        g.add(this._box(0.1, 0.24, 0.14, 0, -0.17, 0.0, D));
        g.add(this._box(0.06, 0.06, 0.5, 0, 0.12, -0.2, accent));
        g.add(this._box(0.05, 0.05, 0.1, 0, 0.14, -0.3, D));
        break;
      }
      case 'dao': {
        // A Tang dao: pommel, wrapped grip, disc guard, a long single-edged
        // blade with a bright emissive edge. Kept *slim and modestly lit* — a
        // wide/over-bright blade smears into a slab under the ASCII bloom.
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd7e2ec, metalness: 0.9, roughness: 0.22, emissive: 0x223038, emissiveIntensity: 0.5 });
        const edgeMat = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x7fe0f0, emissiveIntensity: 1.15, roughness: 0.3, toneMapped: false });
        g.add(this._box(0.07, 0.07, 0.34, 0, 0, -0.22, D));           // grip
        g.add(this._box(0.09, 0.09, 0.05, 0, 0, -0.035, accent));      // pommel
        g.add(this._box(0.26, 0.035, 0.055, 0, 0, -0.41, accent));     // disc guard
        // long blade (1.85 m), thin profile
        g.add(this._box(0.042, 0.018, 1.72, 0, 0.006, -1.32, bladeMat));
        g.add(this._box(0.010, 0.024, 1.70, 0.017, 0.006, -1.32, edgeMat));
        g.add(this._box(0.038, 0.016, 0.30, 0.012, 0.008, -2.32, bladeMat));  // tip
        g.add(this._box(0.009, 0.022, 0.28, 0.024, 0.008, -2.32, edgeMat));
        break;
      }
      default: {
        g.add(this._box(0.1, 0.12, 0.5, 0, 0, -0.2, B));
      }
    }
    // muzzle reference
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, id === 'sniper' ? 0.06 : 0.0, id === 'shotgun' ? -1.0 : id === 'sniper' ? -1.35 : -0.75);
    g.add(muzzle);
    g.userData.muzzle = muzzle;
    g.traverse(o => { o.frustumCulled = false; });
    return g;
  }

  _makeFlash() {
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xa07038, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), mat);
    root.add(quad);
    const light = new THREE.PointLight(0xffbb66, 0, 1.5, 2);
    root.add(light);
    root.visible = false;
    return { root, quad, light, mat, life: 0 };
  }

  _makeSlash() {
    const tex = makeSlashTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: 0x63d0ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), mat);
    mesh.position.set(0, -0.05, -0.98);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return { root: mesh, mat, life: 0, max: 1, variant: 0 };
  }

  buildModels() {
    if (this._models) this._models.forEach(m => this.viewRoot.remove(m));
    this._models = this.weapons.map((w) => {
      const g = this._buildGunModel(w.base.id);
      g.visible = false;
      this.viewRoot.add(g);
      return g;
    });
    this._recomputeAll();
  }

  /** Recompute the effective stat block for one weapon. */
  recompute(w) {
    if (!this.progression) { w.stats = { ...w.base }; return w.stats; }
    const state = this.progression.stateFor(w.base.id);
    state.attachments = w.attachments;
    w.stats = this.progression.computeStats(w.base, state, w.ammoType, this.buffs, this.attachResolver);
    w.mag = w.stats.mag;
    if (w.ammo > w.mag) w.ammo = w.mag;
    return w.stats;
  }
  _recomputeAll() { for (const w of this.weapons) this.recompute(w); }

  /** Load a different ammunition type on the current weapon + add reserve. */
  loadAmmo(ammoId, amount) {
    const w = this.weapon;
    w.ammoType = ammoId;
    w.reserve += amount;
    this.recompute(w);
    return w.stats.ammoName || ammoId;
  }

  /** Equip an attachment item onto the currently selected weapon. */
  equipAttachment(item) {
    const slot = item.use.slot;
    const w = this.weapon;
    const prev = w.attachments[slot];
    if (prev === item.id) return { ok: false, msg: t('wep.alreadyFitted') };
    w.attachments[slot] = item.id;
    this.recompute(w);
    if (prev && this.inventory) this.inventory.add(prev, 1);
    return { ok: true, msg: t('wep.slotFitted', { slot: t('slot.' + slot) }) };
  }

  /** Refill a fraction of every weapon's reserve. */
  refillReserve(frac = 0.5) {
    for (const w of this.weapons) {
      const cap = Math.ceil(w.base.reserve * 1.5);
      w.reserve = Math.min(cap, w.reserve + Math.ceil(w.base.reserve * frac));
    }
  }

  _selectVisual(index, instant = false) {
    this._models.forEach((m, i) => { m.visible = i === index; });
    this.currentModel = this._models[index];
  }

  get weapon() { return this.weapons[this.index]; }
  get def() { return this.weapons[this.index].stats; }
  get baseDef() { return this.weapons[this.index].base; }

  /** True when the current weapon has real magnification (DMR / thermal optic). */
  get scoped() { return (this.def.scope || 1) > 1.05; }

  switchTo(i) {
    if (i === this.index || i < 0 || i >= this.weapons.length) return;
    if (this.switching > 0) return;
    this.index = i;
    this.reloading = false;
    this.reloadT = 0;
    this.switching = 0.45;
    this._melee = null;
    if (this.slash) { this.slash.root.visible = false; this.slash.mat.opacity = 0; }
    this._selectVisual(i);
    if (this.ctx.audio) this.ctx.audio.reload(1);
  }

  reload() {
    const w = this.weapon;
    if (this.reloading) return;
    if (w.ammo >= w.mag || w.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = w.stats.perShell ? w.stats.perShell : w.stats.reload;
    if (this.ctx.audio) this.ctx.audio.reload(0);
    if (!w.stats.perShell) {
      setTimeout(() => this.ctx.audio && this.ctx.audio.reload(1), w.stats.reload * 500);
    }
  }

  _finishReloadStep() {
    const w = this.weapon;
    const need = w.mag - w.ammo;
    const take = Math.min(need, w.reserve, w.stats.perShell ? 1 : need);
    w.ammo += take;
    w.reserve -= take;
    if (w.stats.perShell && w.ammo < w.mag && w.reserve > 0) {
      this.reloadT = w.stats.perShell;
      if (this.ctx.audio) this.ctx.audio.reload(0);
    } else {
      this.reloading = false;
    }
  }

  addAmmo(id, amount) {
    const w = this.weapons.find(x => x.base.id === id);
    if (w) w.reserve += amount;
  }

  update(dt, input, active = true) {
    this.time += dt;
    const player = this.ctx.player;
    if (this.progression) for (const w of this.weapons) this.recompute(w);
    // overclock bleed + armory reserve regen (perks)
    this._overclock = Math.max(0, this._overclock - dt * 0.9);
    const curW = this.weapon;
    if (curW.stats.perks && curW.stats.perks.armory) {
      const cap = Math.ceil(curW.base.reserve * 1.25);
      if (curW.reserve < cap) curW.reserve = Math.min(cap, curW.reserve + 4 * dt);
    }
    for (const w of this.weapons) w.ready = true;

    // switching / reload timers
    if (this.switching > 0) this.switching -= dt;
    if (this.pump > 0) this.pump -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this._finishReloadStep();
    }
    if (this.cooldown > 0) this.cooldown -= dt;

    if (active) {
      // weapon selection
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];
      for (let i = 0; i < digits.length && i < this.weapons.length; i++) if (input.pressed(digits[i])) this.switchTo(i);
      const wheel = input.takeWheel();
      if (wheel) {
        let ni = (this.index + (wheel > 0 ? 1 : -1) + this.weapons.length) % this.weapons.length;
        this.switchTo(ni);
      }
      if (input.pressed('KeyR')) this.reload();

      // fire
      const w = this.weapon;
      const adsHeld = input.mouseDown(2);
      const fireHeld = input.mouseDown(0);
      if (w.stats.melee) {
        // melee: hold LMB to chain swings; RMB is a subtle guard (no zoom)
        this.adsTarget = adsHeld ? 0.35 : 0;
        this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * 10);
        if (this.switching <= 0 && this.cooldown <= 0 && fireHeld) this._swing();
        // continuous-hold meter -> blade deflection buff
        if (fireHeld) this._meleeHold = Math.min(12, this._meleeHold + dt);
        else this._meleeHold = 0;
      } else {
        this._meleeHold = 0;
        const semi = w.stats.mode === 'semi' || w.stats.mode === 'pump';
        const wantFire = semi ? input.mousePressed(0) : input.mouseDown(0);
        // ADS
        this.adsTarget = adsHeld ? 1 : 0;
        this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * 10);
        if (this.switching <= 0 && !this.reloading && wantFire && this.cooldown <= 0) {
          if (w.ammo > 0) this._fire();
          else {
            if (this.ctx.audio) this.ctx.audio.dryFire();
            this.cooldown = 0.3;
            this.reload();
          }
        }
      }
    } else {
      this.adsTarget = 0;
      this.ads += (0 - this.ads) * Math.min(1, dt * 8);
    }

    // blade-deflection buff (only meaningful while holding a melee swing)
    this._updateDeflect(dt, active && input.mouseDown(0));

    // melee swing timeline (advances even while paused just to settle)
    this._tickMelee(dt);

    // spread bloom decay
    this.spreadBloom = Math.max(0, this.spreadBloom - dt * 3.2);

    // viewmodel animation
    this._animateViewModel(dt);
    // muzzle flash timer
    if (this.muzzleFlash.life > 0) {
      this.muzzleFlash.life -= dt;
      const t = Math.max(0, this.muzzleFlash.life / 0.06);
      this.muzzleFlash.mat.opacity = t * 0.6;
      this.muzzleFlash.light.intensity = 0;
      this.muzzleFlash.quad.scale.setScalar(0.4 + (1 - t) * 0.4);
      this.muzzleFlash.root.visible = t > 0;
    }
  }

  _animateViewModel(dt) {
    const player = this.ctx.player;
    const m = this.currentModel;
    if (!m) return;
    const speed = player.speed;
    const bob = player.bobAmount;
    const t = this.time;
    // sway from look velocity
    const swayX = THREE.MathUtils.clamp((player.yaw - (this._lastYaw ?? player.yaw)) * 4, -0.06, 0.06);
    const swayY = THREE.MathUtils.clamp((player.pitch - (this._lastPitch ?? player.pitch)) * 4, -0.06, 0.06);
    this._lastYaw = player.yaw; this._lastPitch = player.pitch;

    const adsBlend = this.ads;
    const base = this._vmBasePos.clone().lerp(this._vmAdsPos, adsBlend);
    const bobX = Math.sin(t * (player.sprinting ? 13 : 9)) * 0.012 * bob * (1 - adsBlend);
    const bobY = Math.abs(Math.cos(t * (player.sprinting ? 13 : 9))) * 0.012 * bob * (1 - adsBlend);
    // recoil spring
    this.recoilKick.multiplyScalar(Math.max(0, 1 - dt * 12));
    this.recoilRot.multiplyScalar(Math.max(0, 1 - dt * 12));

    // reload dip
    let reloadRot = 0, reloadDrop = 0;
    if (this.reloading) {
      const w = this.weapon;
      const total = w.stats.perShell ? w.stats.perShell : w.stats.reload;
      const p = 1 - THREE.MathUtils.clamp(this.reloadT / total, 0, 1);
      const s = Math.sin(p * Math.PI);
      reloadRot = s * 0.9;
      reloadDrop = s * 0.22;
    }
    // switch drop
    if (this.switching > 0) reloadDrop += (this.switching / 0.45) * 0.4;

    if (this.def.melee) {
      this._poseMelee(m, dt, swayX, swayY, bob, reloadDrop);
    } else {
      m.position.set(
        base.x + swayX + bobX - this.recoilKick.x,
        base.y + swayY + bobY - reloadDrop - this.recoilKick.y,
        base.z + this.recoilKick.z
      );
      m.rotation.set(
        reloadRot + this.recoilRot.x - swayY * 2,
        this.recoilRot.y - swayX * 3,
        this.recoilRot.y * 1.5 + (this.adsTarget ? 0 : 0.02)
      );
    }

    // While looking through a scope, hide the viewmodel: its solid optic body
    // would otherwise fill the lens. The HUD scope overlay takes over.
    m.visible = !(this.scoped && this.ads > 0.5);

    // Slash trail sweep/fade.
    this._animateSlash(dt);
  }

  /** Procedural Tang-dao poses: three distinct swings (horizontal / chop / rising). */
  _poseMelee(m, dt, swayX, swayY, bob, drop) {
    const swing = this._melee;
    const bobX = Math.sin(this.time * 9) * 0.014 * bob;
    const bobY = Math.abs(Math.cos(this.time * 9)) * 0.012 * bob;
    let pose;
    if (!swing) {
      pose = DAO_IDLE;
    } else {
      const p = THREE.MathUtils.clamp(swing.t / swing.dur, 0, 1);
      const v = swing.variant;
      const wind = DAO_WIND[v], end = DAO_END[v];
      if (p < 0.28) {
        // wind-up: ease from the ready stance into the cocked pose (no pop)
        pose = lerpPose(DAO_IDLE, wind, THREE.MathUtils.smoothstep(p / 0.28, 0, 1));
      } else if (p < 0.60) {
        // the cut: fast ease-out
        const u = (p - 0.28) / 0.32;
        pose = lerpPose(wind, end, 1 - Math.pow(1 - u, 3));
      } else {
        // follow-through: settle at the end pose
        const u = (p - 0.60) / 0.40;
        pose = lerpPose(end, end, THREE.MathUtils.smoothstep(u, 0, 1));
      }
    }
    let lunge = 0;
    if (swing) {
      const p = THREE.MathUtils.clamp(swing.t / swing.dur, 0, 1);
      lunge = Math.sin(Math.PI * Math.min(1, p / 0.62)) * 0.12;
    }
    m.position.set(
      pose[0] + swayX + bobX - this.recoilKick.x,
      pose[1] + swayY + bobY - drop - this.recoilKick.y,
      pose[2] + this.recoilKick.z - lunge
    );
    m.rotation.set(
      pose[3] + this.recoilRot.x - swayY * 2,
      pose[4] + this.recoilRot.y - swayX * 1.2,
      pose[5] + swayY * 1.2
    );
  }

  _animateSlash(dt) {
    const s = this.slash;
    if (!s || s.life <= 0) return;
    const t = 1 - s.life / s.max;          // 0..1
    const v = s.variant;
    const rot0 = v === 0 ? -0.25 : v === 1 ? 1.45 : -1.15;
    const sweep = v === 0 ? 2.50 : v === 1 ? -2.70 : 2.50;
    s.root.rotation.z = rot0 + sweep * THREE.MathUtils.smoothstep(t, 0, 1);
    const env = Math.sin(Math.PI * Math.min(1, t * 1.05));
    const dim = v === 1 ? 0.34 : 0.5;
    const shrink = v === 1 ? 0.58 : 0.80;
    s.mat.opacity = env * dim;
    s.root.scale.setScalar((0.74 + 0.16 * t) * shrink);
  }

  /** Begin one melee swing (combo index cycles the three variants). */
  _swing() {
    const def = this.def;
    const dur = 60 / Math.max(40, def.rpm);
    const variant = this._combo % 3;
    this._combo = (this._combo + 1) % 3;
    this._comboTimer = 0.55;
    this._melee = { t: 0, dur, variant, hitAt: dur * 0.42, hit: false, freeze: 0, hits: 0 };
    this.cooldown = dur * 0.84;
    const a = this.ctx.audio;
    if (a && a.swordSwing) a.swordSwing(variant);
    // slash trail
    this.slash.life = this.slash.max = dur * 1.0;
    this.slash.variant = variant;
    this.slash.root.visible = true;
    this.slash.mat.opacity = 0;
    if (this.ctx.player) this.ctx.player.addRecoil(0.003, 0);
  }

  _tickMelee(dt) {
    if (this._comboTimer > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0 && !this._melee) this._combo = 0;
    }
    const m = this._melee;
    if (m) {
      if (m.freeze > 0) m.freeze -= dt;   // hit-stop: the blade "sticks" on impact
      else m.t += dt;
      if (!m.hit && m.t >= m.hitAt) { m.hit = true; this._meleeHit(m); }
      if (m.t >= m.dur) this._melee = null;
    }
    if (this.slash.life > 0) {
      this.slash.life -= dt;
      if (this.slash.life <= 0) { this.slash.root.visible = false; this.slash.mat.opacity = 0; }
    }
  }

  /**
   * Blade deflection: after holding a melee swing for >5s, incoming bullets can
   * be cut out of the air. The chance rises as you slow down (100% when braced
   * still — but you're rooted until you release), and decays toward 20% at a
   * full sprint. Releasing LMB (or single-tapping) resets it to zero.
   */
  _updateDeflect(dt, holding) {
    const player = this.ctx.player;
    const eligible = holding && !!this.def.melee && this._meleeHold > 5;
    if (!eligible) {
      this._deflect = 0;
      this._deflectActive = false;
      if (player) player.bladeRoot = false;
      return;
    }
    const speed = player.speed;
    if (speed <= 0.25 && player.onGround) {
      this._deflect = 1.0;
      player.bladeRoot = true;                  // braced: rooted in place
    } else {
      const t = Math.min(1, speed / Math.max(1, player.sprintSpeed));
      this._deflect = Math.max(0.2, 0.5 - 0.3 * t);
      player.bladeRoot = false;
    }
    this._deflectActive = true;
  }

  /** Called from Player.takeDamage for bullet hits. Returns true if deflected. */
  tryDeflect(kind, point) {
    if (kind !== 'bullet' || !this._deflectActive || this._deflect <= 0) return false;
    if (Math.random() > this._deflect) return false;
    const ctx = this.ctx;
    const player = ctx.player;
    const p = point ? new THREE.Vector3(point.x, point.y, point.z) : player.eyePos;
    this._deflectStep = (this._deflectStep + 1) % 6;
    if (ctx.audio && ctx.audio.swordDeflect) ctx.audio.swordDeflect(this._deflectStep, this._deflect);
    if (ctx.effects) {
      ctx.effects.burst(p, new THREE.Vector3(0, 1, 0), 'metal', 10, 0.9);
      if (ctx.effects.flash) ctx.effects.flash(p, 0xbfe9ff, 3, 0.12);
    }
    if (ctx.hud && ctx.hud.hitmark) ctx.hud.hitmark(true);
    player.viewShake = Math.min(1, player.viewShake + 0.06);
    return true;
  }

  /** Resolves a swing's damage against every enemy inside the arc. */
  _meleeHit(m) {
    const ctx = this.ctx;
    const def = this.def;
    const player = ctx.player;
    const look = player.getLookDir();
    const origin = player.eyePos;
    origin.y -= 0.25;
    const reach = def.reach || 2.8;
    const arcCos = Math.cos(Math.min(1.6, def.arc || 1.2));
    const tmp = new THREE.Vector3();
    let count = 0, anyHead = false;
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.ghost) continue;
      const c = e.center;
      const dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > reach + e.type.radius) continue;
      const inv = 1 / Math.max(0.001, dist);
      const nx = dx * inv, ny = dy * inv, nz = dz * inv;
      if (nx * look.x + ny * look.y + nz * look.z < arcCos) continue;
      const wHit = ctx.world.raycast(origin, tmp.set(nx, ny, nz), dist, (b) => b.tag === 'sidewalk');
      if (wHit && wHit.distance < dist - 0.35) continue;
      const head = dy > 0.5 && (nx * look.x + ny * look.y + nz * look.z) > 0.85;
      const falloff = 1 - Math.min(0.35, (dist / reach) * 0.35);
      const dmg = def.dmg * falloff * (head ? (def.headshotMul || 2) : 1);
      if (this.progression) this.progression.addXp('dao', dmg * 0.5 + (head ? 4 : 1));
      if (ctx.stats) ctx.stats.hits++;
      const wasAlive = e.alive;
      ctx.enemies.damage(e, dmg, c, look, head, 'dao');
      if (wasAlive && !e.alive && def.perks && def.perks.lifesteal) ctx.player.heal(5);
      // knockback + stagger: the blade bites and shoves the target
      e.vel.x += look.x * 5.5; e.vel.z += look.z * 5.5;
      e.stagger = Math.max(e.stagger, 0.4);
      ctx.effects.burst(c, tmp.set(-look.x, 0.2, -look.z).normalize(), 'blood', head ? 22 : 16, head ? 1.4 : 1.15);
      ctx.effects.burst(c, tmp.set(look.x, 0.4, look.z).normalize(), 'metal', 6, 0.7);
      if (head) anyHead = true;
      count++;
    }
    m.hits = count;
    const a = ctx.audio;
    if (count > 0) {
      // 阻力: the swing slams to a stop, the blade is shoved back, the camera
      // kicks and the whole sim hit-stops for a beat.
      m.freeze = 0.035;
      m.t = Math.max(m.t, m.hitAt);          // hold the pose at the moment of contact
      this.recoilKick.set((Math.random() - 0.5) * 0.03, 0.03, 0.16);
      this.recoilRot.set(-0.13, (Math.random() - 0.5) * 0.10);
      player.viewShake = Math.min(1.1, player.viewShake + 0.20 + 0.06 * count);
      player.addRecoil(0.014, (Math.random() - 0.5) * 0.008);
      if (this.ctx.stats) this.ctx.stats._hitStop = 0.06;   // global impact stop
      if (a && a.swordHit) a.swordHit(anyHead ? 'head' : 'flesh', 1 + 0.2 * count);
      if (ctx.hud) ctx.hud.hitmark(anyHead);
      if (a) a.duckMusic(0.22, 0.4);
    } else {
      if (a && a.swordMiss) a.swordMiss();
    }
  }

  _fire() {
    const w = this.weapon;
    const def = w.stats;
    const ctx = this.ctx;
    const player = ctx.player;
    const camera = ctx.camera;

    w.ammo--;
    const perks = def.perks || {};
    const oc = perks.overclock ? (1 + this._overclock * 0.30) : 1;
    this.cooldown = 60 / (def.rpm * oc);
    if (def.mode === 'pump') this.pump = 0.35;
    this._overclock = Math.min(1, this._overclock + 0.08);

    // deadeye: first shot after a pause is pinpoint and empowered
    const deadeye = !!perks.deadeye && (this.time - this._lastShotAt) > 0.8;
    this._lastShotAt = this.time;

    // spread
    const moving = Math.min(1, player.speed / player.sprintSpeed);
    const adsMul = 1 - this.ads * 0.6;
    let baseSpread = def.spread + def.moveSpread * moving + this.spreadBloom * 0.02;
    if (perks.bipod && player.crouching) baseSpread *= 0.7;
    if (deadeye) baseSpread = 0;
    const bloomGain = def.recoilP * 0.28 * (perks.stabilizer ? 0.5 : 1);
    this.spreadBloom = Math.min(1.4, this.spreadBloom + bloomGain);

    const eye = player.eyePos;
    const look = player.getLookDir();

    if (ctx.audio) ctx.audio.gunshot(def.id === 'sniper' ? 'sniper' : def.id === 'shotgun' ? 'shotgun' : def.id === 'smg' ? 'smg' : def.id === 'pistol' ? 'pistol' : def.id === 'plasma' ? 'plasma' : 'rifle');
    if (ctx.audio) ctx.audio.duckMusic(0.35, 0.5);

    // muzzle flash
    const muzzleWorld = new THREE.Vector3();
    this.muzzleFlash.root.getWorldPosition(muzzleWorld);
    this.muzzleFlash.root.position.copy(muzzleWorld);
    // reposition flash in world? it's a child of camera-space root; keep in view space
    this.muzzleFlash.root.position.set(0, def.id === 'sniper' ? 0.02 : 0, def.id === 'sniper' ? -1.6 : -1.2);
    this.muzzleFlash.root.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.muzzleFlash.life = 0.05;
    this.muzzleFlash.mat.opacity = 0.6;
    this.muzzleFlash.light.intensity = 0;
    this.muzzleFlash.quad.scale.setScalar(0.6);
    this.muzzleFlash.root.visible = true;

    // recoil
    player.addRecoil(def.recoilP * 0.012 * (1 - this.ads * 0.5), (Math.random() - 0.5) * def.recoilY * 0.012);
    this.recoilKick.set(0, 0.02 * def.recoilP, 0.05 * def.recoilP);
    this.recoilKick.x = (Math.random() - 0.5) * 0.01 * def.recoilP;
    this.recoilRot.set(def.recoilP * 0.05, (Math.random() - 0.5) * def.recoilY * 0.06);

    if (def.projectile) {
      const origin = eye.clone().addScaledVector(look, 0.6);
      const dir = this._applySpread(look, baseSpread * 0.3 * adsMul);
      if (def.projectile === 'plasma') {
        ctx.projectiles.spawnPlasma(origin, dir, 'player', 80, def.dmg, 0x66ddff);
      } else {
        ctx.projectiles.spawnRocket(origin, dir, 'player', 55);
      }
      if (ctx.net) ctx.net.sendShot(origin, dir, def.projectile);
      return;
    }

    const pellets = def.pellets || 1;
    const wh = w;
    for (let p = 0; p < pellets; p++) {
      const dir = this._applySpread(look, baseSpread * adsMul);
      this._fireBallistic(eye, dir, def, wh, deadeye);
    }
    if (ctx.stats) ctx.stats.shots += pellets;
    if (ctx.net) ctx.net.sendShot(eye, look, null);
    if (w.base.id === 'shotgun') setTimeout(() => ctx.audio && ctx.audio.shellDrop(), 300);
  }

  _applySpread(dir, spread) {
    if (spread <= 0) return dir.clone();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) up.set(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    return dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r).normalize();
  }

  _fireBallistic(origin, dir, def, w, deadeye = false) {
    const ctx = this.ctx;
    const world = ctx.world;
    const enemies = ctx.enemies;
    const effects = ctx.effects;
    let pierce = def.pierce || 0;
    let bounces = def.ricochet || 0;
    const hitSet = new Set();
    let o = origin.clone();
    let d = dir.clone();
    let traveled = 0;
    const maxTravel = def.range;

    for (let iter = 0; iter < 8 && traveled < maxTravel; iter++) {
      const range = maxTravel - traveled;
      const wHit = world.raycast(o, d, range, (b) => b.tag === 'sidewalk');
      const wDist = wHit ? wHit.distance : range;
      const eHit = enemies.raycast(o, d, wDist, hitSet);

      if (eHit && eHit.t <= wDist) {
        const head = eHit.head;
        let dmg = def.dmg * (head ? (def.headshotMul || 2) : 1);
        if (deadeye) dmg *= 1.7;
        let crit = false;
        if (def.crit > 0 && Math.random() < def.crit) { dmg *= def.critMult; crit = true; }
        if (def.perks && def.perks.executioner && eHit.enemy.health / eHit.enemy.maxHealth < 0.35) dmg *= 1.3;
        const wasAlive = eHit.enemy.alive;
        if (ctx.stats) ctx.stats.hits++;
        enemies.damage(eHit.enemy, dmg, eHit.point, d, head, w.base.id);
        if (wasAlive && !eHit.enemy.alive && def.perks && def.perks.lifesteal) ctx.player.heal(5);
        if (this.progression) this.progression.addXp(w.base.id, dmg * 0.4 + (head ? 5 : 1));
        this._applyAmmoOnHit(eHit.enemy, def, eHit.point, d, ctx);
        effects.burst(eHit.point, d.clone().negate(), crit ? 'energy' : 'blood', head ? 18 : crit ? 16 : 12, head ? 1.3 : crit ? 1.5 : 1);
        effects.tracer(o, eHit.point, def.tracer, 0.06);
        if (def.selfHeal) ctx.player.heal(def.selfHeal);
        if (head) { if (ctx.audio) ctx.audio.headshot(); if (ctx.hud) ctx.hud.hitmark(true); }
        else { if (ctx.audio) ctx.audio.impact(crit ? 'metal' : 'flesh', 0); if (ctx.hud) ctx.hud.hitmark(false); }
        if (def.aoe > 0) this._aoeShot(eHit.point, def, ctx);
        if (pierce > 0 && !(def.aoe > 0)) {
          pierce--;
          hitSet.add(eHit.enemy);
          traveled += eHit.t + 0.06;
          o = eHit.point.clone().addScaledVector(d, 0.08);
          continue;
        }
        return;
      }

      if (wHit) {
        const n = new THREE.Vector3(wHit.normal[0], wHit.normal[1], wHit.normal[2]);
        if (bounces > 0) {
          bounces--;
          traveled += wHit.t + 0.06;
          o = wHit.point.clone().addScaledVector(n, 0.06);
          d = d.clone().reflect(n).normalize();
          effects.burst(wHit.point, n, surfaceFromTag(wHit.box.tag), 5, 0.6);
          effects.tracer(o, o.clone().addScaledVector(d, 5), def.tracer, 0.04);
          continue;
        }
        const kind = surfaceFromTag(wHit.box.tag);
        effects.burst(wHit.point, n, kind, 8, 0.8);
        effects.decal(wHit.point, n, 0.3);
        if (ctx.audio) ctx.audio.impact(kind, 0);
        effects.tracer(o, wHit.point, def.tracer, 0.05);
        if (def.aoe > 0) this._aoeShot(wHit.point, def, ctx);
        return;
      }

      effects.tracer(o, o.clone().addScaledVector(d, range), def.tracer, 0.05);
      return;
    }
  }

  _applyAmmoOnHit(enemy, def, point, dir, ctx) {
    const list = [];
    if (def.status) list.push(def.status);
    if (def.attachmentStatus) list.push(def.attachmentStatus);
    for (const s of list) {
      if (Math.random() <= (s.chance ?? 1)) enemy.applyStatus(s.kind, s.dur || 4, s.power || 1);
    }
    if (def.chain > 0) this._chain(enemy, point, def, ctx);
  }

  _chain(source, from, def, ctx) {
    const hit = new Set([source]);
    let cur = from.clone();
    for (let i = 0; i < def.chain; i++) {
      let best = null, bd = 12 * 12;
      for (const e of ctx.enemies.list) {
        if (!e.alive || e.ghost || hit.has(e)) continue;
        const d2 = e.center.distanceToSquared(cur);
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (!best) break;
      hit.add(best);
      const to = best.center;
      ctx.effects.tracer(cur, to, [0.7, 0.9, 1.0], 0.08);
      if (def.status) best.applyStatus(def.status.kind, def.status.dur, def.status.power * 0.6);
      ctx.enemies.damage(best, def.dmg * 0.5, to, to.clone().sub(cur).normalize(), false, 'chain');
      cur = to;
    }
  }

  _aoeShot(point, def, ctx) {
    const r = def.aoe;
    if (!r) return;
    ctx.effects.explosion(point, Math.min(1.6, 0.6 + r * 0.4));
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.ghost) continue;
      const d = e.center.distanceTo(point);
      if (d < r) {
        const f = 1 - d / r;
        ctx.enemies.damage(e, def.dmg * 0.6 * f, e.center, new THREE.Vector3(0, 1, 0), false, 'aoe');
        if (def.status) e.applyStatus(def.status.kind, def.status.dur, def.status.power);
      }
    }
  }

  getScopedFov(baseFov) {
    const def = this.def;
    if (def.scope) return baseFov / (1 + (def.scope - 1) * this.ads);
    return baseFov * (1 - 0.18 * this.ads);
  }
}

function surfaceFromTag(tag) {
  switch (tag) {
    case 'building': return 'concrete';
    case 'interior': return 'concrete';
    case 'metal': return 'metal';
    case 'lamp': return 'metal';
    case 'prop': return 'wood';
    case 'roof': return 'concrete';
    default: return 'concrete';
  }
}

/**
 * Slash-trail texture: a glowing crescent with a soft tail. Drawn on a 2D canvas
 * and used additively on the camera-space slash plane, so the swing leaves a
 * bright arc that reads clearly in the ASCII pass.
 */
function makeSlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.translate(128, 128);
  const r = 94;
  const a0 = -0.80, a1 = 1.25;
  const steps = 52;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const a = a0 + (a1 - a0) * t;
    const alpha = Math.pow(1 - t, 1.5) * 0.55;
    x.strokeStyle = `rgba(180,240,255,${alpha.toFixed(3)})`;
    x.lineWidth = 8 * (1 - 0.3 * t);
    x.lineCap = 'round';
    x.beginPath();
    x.arc(0, 0, r, a, a + (a1 - a0) / steps * 1.5);
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------- Tang-dao swing keyframes ------------------------ */
// Pose = [posX, posY, posZ, rotX, rotY, rotZ] in camera space.
const DAO_IDLE = [0.46, -0.40, -0.52, 0.22, 1.05, -0.32];
const DAO_WIND = [
  [0.55, -0.18, -0.50, 0.05, -1.30, -0.10], // 0 horizontal: cocked to the right
  [0.14, 0.36, -0.44, 1.45, 0.05, 0.08],    // 1 chop: raised overhead
  [-0.34, -0.46, -0.48, -0.60, 1.10, -0.15], // 2 rising: low-left
];
const DAO_END = [
  [-0.46, -0.36, -0.46, 0.20, 1.35, 0.12],  // 0 horizontal: swept left
  [0.06, -0.24, -0.52, -0.35, 0.02, 0.06],  // 1 chop: down-forward
  [0.50, -0.14, -0.44, 0.75, -1.05, 0.12],  // 2 rising: high-right
];
function lerpPose(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t, a[5] + (b[5] - a[5]) * t,
  ];
}
