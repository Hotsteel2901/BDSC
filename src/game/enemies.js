import * as THREE from 'three';
import { Squad, findCoverPoint, flankPoint, advancePoint, retreatPoint, patrolPoint, perceives } from './ai.js';
import { computeStatusMods, STATUS_DEFS } from './status.js';

/* ============================ enemy archetypes ============================ */
export const ENEMY_TYPES = {
  grunt: {
    name: 'GRUNT', hp: 110, speed: 3.7, accel: 14, view: 68, fovDeg: 115, height: 1.85, radius: 0.45,
    weapon: { rpm: 430, dmg: 9, burstMin: 3, burstMax: 6, burstPause: [0.45, 1.1], spread: 0.055, range: 75, reload: 2.2, mag: 30 },
    accuracy: 0.5, aggression: 1.0, grenades: 1, scale: 1.0, accent: 0xff3b30, xp: 10, melee: false,
  },
  rusher: {
    name: 'RUSHER', hp: 80, speed: 6.4, accel: 26, view: 58, fovDeg: 130, height: 1.7, radius: 0.42,
    weapon: { rpm: 640, dmg: 12, burstMin: 4, burstMax: 8, burstPause: [0.2, 0.5], spread: 0.09, range: 42, reload: 1.6, mag: 24 },
    accuracy: 0.4, aggression: 1.8, grenades: 0, scale: 0.92, accent: 0xff8a00, xp: 12, melee: true, meleeRange: 2.4, meleeDmg: 22,
  },
  heavy: {
    name: 'HEAVY', hp: 320, speed: 2.5, accel: 8, view: 62, fovDeg: 100, height: 2.3, radius: 0.65,
    weapon: { rpm: 780, dmg: 7, burstMin: 12, burstMax: 24, burstPause: [0.8, 1.6], spread: 0.08, range: 70, reload: 4.0, mag: 120 },
    accuracy: 0.42, aggression: 0.9, grenades: 2, scale: 1.35, accent: 0xff2a2a, xp: 25, melee: false,
  },
  sniper: {
    name: 'MARKSMAN', hp: 95, speed: 3.0, accel: 12, view: 130, fovDeg: 70, height: 1.9, radius: 0.45,
    weapon: { rpm: 42, dmg: 58, burstMin: 1, burstMax: 1, burstPause: [1.6, 2.6], spread: 0.012, range: 200, reload: 2.8, mag: 5 },
    accuracy: 0.86, aggression: 0.5, grenades: 0, scale: 1.02, accent: 0x9dfffb, xp: 20, melee: false, keepDist: 55, laser: true,
  },
  drone: {
    name: 'DRONE', hp: 55, speed: 7.2, accel: 24, view: 70, fovDeg: 150, height: 0.9, radius: 0.45,
    weapon: { rpm: 620, dmg: 6, burstMin: 5, burstMax: 10, burstPause: [0.3, 0.7], spread: 0.075, range: 55, reload: 1.4, mag: 40 },
    accuracy: 0.38, aggression: 1.3, grenades: 0, scale: 0.85, accent: 0x4de0ff, xp: 15, flying: true, hover: 4.0, melee: false,
  },
  turret: {
    name: 'TURRET', hp: 240, speed: 0, accel: 0, view: 82, fovDeg: 360, height: 1.4, radius: 0.6,
    weapon: { rpm: 560, dmg: 10, burstMin: 10, burstMax: 20, burstPause: [0.7, 1.3], spread: 0.05, range: 80, reload: 0, mag: 9999 },
    accuracy: 0.58, aggression: 1.0, grenades: 0, scale: 1.1, accent: 0xffd400, xp: 22, stationary: true, melee: false,
  },
  officer: {
    name: 'OFFICER', hp: 200, speed: 3.9, accel: 16, view: 78, fovDeg: 125, height: 2.0, radius: 0.5,
    weapon: { rpm: 520, dmg: 13, burstMin: 3, burstMax: 7, burstPause: [0.4, 0.9], spread: 0.045, range: 85, reload: 2.2, mag: 36 },
    accuracy: 0.62, aggression: 1.1, grenades: 2, scale: 1.12, accent: 0xff30d0, xp: 35, officer: true, melee: false,
  },
};

/* --------------- hostile marker (visibility aid) --------------- */
// A single shared chevron texture; each marker tints it with the archetype accent.
let _hostileMarkerTex = null;
function hostileMarkerTexture() {
  if (_hostileMarkerTex) return _hostileMarkerTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  // Solid downward triangle → an unmistakable "hostile here" tag whose centre
  // is filled, so the ASCII cell sampler always lands on it.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(32, 58);
  ctx.lineTo(6, 8);
  ctx.lineTo(58, 8);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  _hostileMarkerTex = tex;
  return tex;
}

function makeHostileMarker(type) {
  const mat = new THREE.SpriteMaterial({
    map: hostileMarkerTexture(),
    color: type.accent,
    transparent: true,
    depthTest: true,   // occluded by walls — no wall-hack, but reads over low cover
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(1.0);
  s.renderOrder = 5;
  return s;
}

/* ============================ model building ============================== */
function buildModel(type) {
  const g = new THREE.Group();
  const scale = type.scale || 1;
  const h = type.height;

  // Bodies are self-lit in the archetype colour so hostiles never disappear into
  // the neon-dark city; the small chest core stays the brightest point.
  const accentCol = new THREE.Color(type.accent);
  const skin = new THREE.MeshStandardMaterial({ color: 0x6d7883, metalness: 0.55, roughness: 0.45, vertexColors: false, emissive: accentCol, emissiveIntensity: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2129, metalness: 0.55, roughness: 0.5, emissive: accentCol, emissiveIntensity: 0.09 });
  const core = new THREE.MeshStandardMaterial({ color: 0x120000, emissive: type.accent, emissiveIntensity: 2.4, roughness: 0.3, toneMapped: false });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: type.accent, emissiveIntensity: 1.7, roughness: 0.3, toneMapped: false });
  const parts = { root: g, materials: { skin, dark, core, accentMat } };

  // Floating hostile marker (sprite always faces the camera). Placed on every
  // archetype so units are locatable at range and through the ASCII pass.
  parts.marker = makeHostileMarker(type);
  parts.marker.position.y = h + 0.55;
  g.add(parts.marker);

  if (type.flying) {
    // drone: central pod + 4 rotor arms
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.8), skin);
    body.position.y = h * 0.5; g.add(body);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), core);
    eye.position.set(0, h * 0.52, -0.42); g.add(eye);
    parts.core = eye;
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + i * Math.PI / 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.12), dark);
      arm.position.set(Math.cos(ang) * 0.45, h * 0.5, Math.sin(ang) * 0.45);
      arm.rotation.y = -ang; g.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8), accentMat);
      rotor.position.set(Math.cos(ang) * 0.7, h * 0.55, Math.sin(ang) * 0.7); g.add(rotor);
      if (i === 0) parts.rotor = rotor;
    }
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.4), dark);
    gun.position.set(0, h * 0.42, -0.55); g.add(gun);
    parts.muzzle = new THREE.Object3D(); parts.muzzle.position.set(0, h * 0.42, -0.78); g.add(parts.muzzle);
    parts.headY = h * 0.5;
    g.scale.setScalar(1);
    parts.canAnimateLegs = false;
    return parts;
  }
  if (type.stationary) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * scale, 0.7 * scale, 0.5, 8), dark);
    base.position.y = 0.25; g.add(base);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), skin);
    body.position.y = 0.85; g.add(body);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), core);
    eye.position.set(0, 0.95, -0.38); g.add(eye);
    parts.core = eye;
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 8), dark);
    cannon.rotation.x = Math.PI / 2; cannon.position.set(0, 0.8, -0.6); g.add(cannon);
    parts.muzzle = new THREE.Object3D(); parts.muzzle.position.set(0, 0.8, -1.05); g.add(parts.muzzle);
    parts.headY = 0.95;
    parts.canAnimateLegs = false;
    parts.turretBody = body; parts.turretEye = eye; parts.cannon = cannon;
    // scale whole turret
    g.scale.setScalar(1);
    return parts;
  }

  // humanoid
  const legH = h * 0.45;
  const torsoH = h * 0.34;
  const headH = h * 0.14;
  const hipY = legH;
  const torsoY = hipY + torsoH / 2;
  const headY = hipY + torsoH + headH / 2;

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.22 * scale, 0.32 * scale), dark);
  pelvis.position.y = hipY; g.add(pelvis);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, torsoH, 0.4 * scale), skin);
  torso.position.y = torsoY; g.add(torso);
  // chest core
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.18 * scale, 0.06), core);
  chest.position.set(0, torsoY + torsoH * 0.12, -0.22 * scale); g.add(chest);
  parts.core = chest;
  // shoulder pads + glowing trim (reads as a bright line in ASCII)
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.86 * scale, 0.2 * scale, 0.44 * scale), dark);
  shoulder.position.y = torsoY + torsoH * 0.34; g.add(shoulder);
  const shoulderTrim = new THREE.Mesh(new THREE.BoxGeometry(0.9 * scale, 0.06, 0.46 * scale), accentMat);
  shoulderTrim.position.y = torsoY + torsoH * 0.34 + 0.11 * scale; g.add(shoulderTrim);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.54 * scale, 0.06, 0.34 * scale), accentMat);
  belt.position.y = hipY + 0.01 * scale; g.add(belt);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36 * scale, headH, 0.36 * scale), skin);
  head.position.y = headY; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3 * scale, 0.07, 0.04), accentMat);
  visor.position.set(0, headY + 0.02, -0.2 * scale); g.add(visor);
  parts.head = head; parts.visor = visor;

  // legs (pivot at hip)
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16 * scale, hipY, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2 * scale, legH * 0.55, 0.24 * scale), dark);
    upper.position.y = -legH * 0.28; pivot.add(upper);
    const lowerPivot = new THREE.Group(); lowerPivot.position.y = -legH * 0.55; pivot.add(lowerPivot);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, legH * 0.5, 0.2 * scale), skin);
    lower.position.y = -legH * 0.25; lowerPivot.add(lower);
    pivot.userData.lower = lowerPivot;
    g.add(pivot);
    return pivot;
  }
  parts.legL = makeLeg(-1);
  parts.legR = makeLeg(1);

  // arms (pivot at shoulder) — hold weapon forward
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.44 * scale, torsoY + torsoH * 0.28, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, torsoH * 0.75, 0.18 * scale), skin);
    upper.position.y = -torsoH * 0.35; pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, torsoH * 0.7, 0.16 * scale), dark);
    fore.position.set(0, -torsoH * 0.7, -torsoH * 0.35); pivot.add(fore);
    pivot.rotation.x = -Math.PI / 2.2;
    g.add(pivot);
    return pivot;
  }
  parts.armL = makeArm(-1);
  parts.armR = makeArm(1);

  // weapon
  const gunLen = type.keepDist ? 1.3 : type.name === 'HEAVY' ? 1.1 : 0.8;
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, gunLen), dark);
  gun.add(gunBody);
  const gunAcc = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, gunLen * 0.5), accentMat);
  gunAcc.position.set(0, 0.11, -gunLen * 0.1); gun.add(gunAcc);
  gun.position.set(0, torsoY - torsoH * 0.2, -0.5 * scale);
  g.add(gun);
  parts.gun = gun;
  parts.muzzle = new THREE.Object3D(); parts.muzzle.position.set(0, 0, -gunLen / 2 - 0.1); gun.add(parts.muzzle);
  if (type.laser) {
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 4, 4), laserMat);
    beam.rotation.x = Math.PI / 2; beam.position.set(0, 0, -gunLen / 2 - 2);
    gun.add(beam); parts.laser = beam;
  }
  parts.headY = headY;
  parts.canAnimateLegs = true;
  return parts;
}

/** Ray vs vertical capsule. Returns { t, point, head } or null. */
function rayCapsule(ox, oy, oz, dx, dy, dz, base, radius, height, maxDist) {
  // closest approach of ray to the capsule axis (x=base.x, z=base.z, y in [base.y, base.y+height])
  const ax = base.x, az = base.z;
  const y0 = base.y, y1 = base.y + height;
  let best = null;
  // sample along the capsule axis
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const cy = y0 + (height * i / steps);
    const ex = ox - ax, ey = oy - cy, ez = oz - az;
    const t = -(ex * dx + ey * dy + ez * dz);
    if (t < 0 || t > maxDist) continue;
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    const dd = Math.hypot(px - ax, pz - az, py - cy);
    if (dd < radius) {
      if (!best || t < best.t) best = { t, py, point: new THREE.Vector3(px, py, pz), head: py > y0 + height * 0.82 };
    }
  }
  return best;
}

/* ============================== enemy ==================================== */
export class Enemy {
  constructor(type, pos, squad, opts = {}) {
    this.type = type;
    this.typeKey = opts.typeKey || null;
    this.id = opts.id ?? null;
    this.ghost = !!opts.ghost;
    this.elite = !!opts.elite;
    this.gx = 0; this.gy = 0; this.gz = 0; this.gyaw = 0;
    this.currentTarget = null;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.aimYaw = this.yaw;
    this.maxHealth = type.hp * (opts.hpMul ?? 1);
    this.health = this.maxHealth;
    this.alive = true;
    this.state = 'patrol';
    this.awareness = 0;
    this.role = 'patrol';
    this.aiRole = 'assault';
    this.squad = squad;
    this.home = pos.clone();
    this.target = null;         // Vector3 last known
    this.targetEnemy = null;
    this.lastSeen = -999;
    this.firstSeenTime = -999;
    this.hasSeen = false;
    this.reactionTimer = 0;
    this.fireTimer = 0;
    this.burstLeft = 0;
    this.burstCooldown = 0;
    this.reloadTimer = 0;
    this.mag = type.weapon.mag;
    this.grenades = type.grenades;
    this.grenadeCd = 2 + Math.random() * 4;
    this.behavior = 'advance';
    this.behaviorTimer = Math.random() * 0.5;
    this.behaviorDest = null;
    this.path = null;
    this.pathIndex = 0;
    this.replanTimer = 0;
    this.coverPos = null;
    this.suppression = 0;
    this.stagger = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.deadTime = 0;
    this.deathSpin = new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5)).multiplyScalar(4);
    this.alertLevel = 0;
    this.investigate = null;
    this.walkPhase = Math.random() * 6;
    this.wantCrouch = false;
    this.meleeCd = 0;
    this.hitFlash = 0;
    this.officerReinforceCd = 8 + Math.random() * 8;
    this.aks = 0;
    this.lastDamageTime = -99;
    this.avoidTimer = 0;
    this._sep = new THREE.Vector3();
    // status effects: { kind: { t, dur, power, stacks } }
    this.statuses = {};
    this.statusMods = { speedMul: 1, fireMul: 1, dmgTakenMul: 1, dmgDealtMul: 1, stunned: false, revealed: false, dps: 0 };
    this._statusFxTimer = 0;

    this.parts = buildModel(type);
    this.root = this.parts.root;
    this.root.position.copy(pos);
    this.pos.y = opts.groundY ?? 0;
    this.root.position.y = this.pos.y;
    this.yaw = Math.random() * Math.PI * 2;
    this.root.rotation.y = this.yaw;
  }

  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.type.height * 0.5, this.pos.z);
  }
  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.parts.headY, this.pos.z);
  }

  /* ------------------------------ update -------------------------------- */
  update(dt, ctx) {
    if (!this.alive) { this._updateDead(dt); return; }
    const T = this.type;

    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.suppression = Math.max(0, this.suppression - dt * 0.7);
    this.stagger = Math.max(0, this.stagger - dt);
    this.meleeCd -= dt;
    this.grenadeCd -= dt;
    this.officerReinforceCd -= dt;

    this._tickStatuses(dt, ctx);

    if (this.stagger > 0 || this.statusMods.stunned) {
      this._applyVelocity(dt, ctx);
      this._animate(dt, ctx);
      return;
    }

    this._perceive(dt, ctx);
    this._think(dt, ctx);
    this._act(dt, ctx);
    this._applyVelocity(dt, ctx);
    this._animate(dt, ctx);
  }

  /* ------------------------------ status -------------------------------- */
  applyStatus(kind, dur, power = 1, stacks = 1) {
    const def = STATUS_DEFS[kind];
    if (!def) return;
    const cur = this.statuses[kind];
    if (cur) {
      cur.t = Math.max(cur.t, dur);
      cur.stacks = Math.min(def.maxStacks, cur.stacks + stacks);
      cur.power = Math.max(cur.power, power);
    } else {
      this.statuses[kind] = { t: dur, dur, power, stacks: Math.min(def.maxStacks, stacks) };
    }
    // being afflicted also wakes the unit up
    if (this.state === 'patrol' && kind !== 'mark') {
      this.state = 'search'; this.searchTimer = 5; this.awareness = Math.max(this.awareness, 0.6);
      this.behaviorTimer = 0;
    }
  }

  hasStatus(kind) { return !!this.statuses[kind] && this.statuses[kind].t > 0; }

  clearStatuses() { this.statuses = {}; }

  _tickStatuses(dt, ctx) {
    const st = this.statuses;
    let any = false;
    for (const k in st) {
      const s = st[k];
      s.t -= dt;
      if (s.t <= 0) { delete st[k]; continue; }
      any = true;
    }
    const mods = computeStatusMods(st);
    this.statusMods = mods;

    // apply damage over time
    if (mods.dps > 0) {
      this.health -= mods.dps * dt;
      if (this.health <= 0) {
        this.health = 0;
        this.alive = false;
        this.state = 'dead';
        this.deathTime = 0;
        if (ctx && ctx.manager) {
          ctx.effects.burst(this.center, new THREE.Vector3(0, 1, 0), 'explosion', 22, 1.1);
          ctx.manager._onDotKill(this, ctx);
        }
        return;
      }
    }

    // particle + glow feedback
    if (any) {
      this._statusFxTimer -= dt;
      if (this._statusFxTimer <= 0) {
        this._statusFxTimer = 0.12;
        const c = this.center;
        for (const k in st) {
          const def = STATUS_DEFS[k];
          if (!def) continue;
          const col = def.color;
          const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
          if (Math.random() < 0.6) {
            ctx.effects.spawnParticle(
              c.x + (Math.random() - 0.5) * this.type.radius * 2,
              c.y + (Math.random() - 0.5) * this.type.height,
              c.z + (Math.random() - 0.5) * this.type.radius * 2,
              (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6,
              r, g, b, 0.09, 0.35, def.dot ? 0.4 : -1.0, 1.2
            );
          }
        }
      }
    }
    // tint the core by the strongest active status
    if (this.parts && this.parts.materials && this.parts.materials.core) {
      let tint = null;
      for (const k in st) { if (STATUS_DEFS[k]) { tint = STATUS_DEFS[k].color; break; } }
      if (tint != null && this.hitFlash < 0.1) this.parts.materials.core.emissive.setHex(tint);
      else if (this.hitFlash < 0.1) this.parts.materials.core.emissive.setHex(this.type.accent);
    }
  }

  /* --------------------------- perception ------------------------------- */
  _perceive(dt, ctx) {
    const T = this.type;
    const eye = this.eyePos;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const fovCos = Math.cos((T.fovDeg * Math.PI / 180) / 2);
    const viewRange = T.view * (ctx.time - this.lastDamageTime < 2 ? 1.3 : 1);
    const targets = ctx.targets || [];

    let best = null, bestDist = Infinity, bestChest = null;
    for (const tgt of targets) {
      if (!tgt.alive) continue;
      if (tgt.cloaked && this.pos.distanceTo(tgt.pos) > 4) continue;
      const chest = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.4, tgt.pos.z);
      const r = perceives(ctx, eye, chest, forward, viewRange, fovCos);
      if (!r.seen) continue;
      // smoke blocks line of sight
      if (ctx.smokes && ctx.smokes.length) {
        let blocked = false;
        for (const s of ctx.smokes) {
          if (chest.distanceToSquared(s.pos) < s.r * s.r) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      if (r.dist < bestDist) { best = tgt; bestDist = r.dist; bestChest = chest; }
    }

    if (best) {
      if (!this.hasSeen) { this.hasSeen = true; this.firstSeenTime = ctx.time; this.reactionTimer = (0.22 + Math.random() * 0.4) / ctx.difficulty.aimSpeed; }
      this.awareness = Math.min(1, this.awareness + dt * 2.5);
      this.target = bestChest;
      this.currentTarget = best;
      this.lastSeen = ctx.time;
      if (this.state !== 'combat') {
        this.state = 'combat';
        this.role = 'combat';
        if (this.squad) this.squad.reportContact(bestChest, ctx.time);
        ctx.manager.onSight(this, bestChest, ctx);
      }
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.35);
      if (this.state === 'combat' && ctx.time - this.lastSeen > 2.5) {
        this.state = 'search';
        this.searchTimer = 6 + Math.random() * 4;
        if (this.target) this.investigate = this.target.clone();
      }
    }

    // proximity detection (very close, any angle)
    if (this.state === 'patrol') {
      for (const tgt of targets) {
        if (!tgt.alive) continue;
        const d = this.pos.distanceTo(tgt.pos);
        if (d < 3.5) {
          this.state = 'combat';
          this.currentTarget = tgt;
          this.target = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z);
          this.lastSeen = ctx.time;
          if (this.squad) this.squad.reportContact(this.target, ctx.time);
          ctx.manager.onSight(this, this.target, ctx);
          break;
        } else if (d < 9) {
          this.state = 'investigate';
          this.investigate = tgt.pos.clone();
          this.awareness = 0.5;
        }
      }
    }
  }

  /* ------------------------------ think --------------------------------- */
  _think(dt, ctx) {
    this.behaviorTimer -= dt;
    this.replanTimer -= dt;

    if (this.state === 'combat') {
      if (this.behaviorTimer <= 0) { this.behaviorTimer = 0.35 + Math.random() * 0.4; this._chooseCombatBehavior(ctx); }
    } else if (this.state === 'patrol') {
      if (this.behaviorTimer <= 0) {
        this.behaviorTimer = 2.5 + Math.random() * 3;
        this.behavior = 'patrol';
        this.behaviorDest = patrolPoint(ctx, this.home, 34);
        this.replanTimer = 0;
      }
    } else if (this.state === 'investigate') {
      if (this.behaviorTimer <= 0) {
        this.behaviorTimer = 1.0 + Math.random();
        this.behavior = 'investigate';
        this.behaviorDest = (this.investigate || this.target || this.home).clone();
        // add search jitter
        this.behaviorDest.x += (Math.random() - 0.5) * 6;
        this.behaviorDest.z += (Math.random() - 0.5) * 6;
        const g = ctx.world.findStreetSpawn(this.behaviorDest.x, this.behaviorDest.z);
        this.behaviorDest = g;
        this.replanTimer = 0;
      }
    } else if (this.state === 'search') {
      this.searchTimer -= dt;
      if (this.behaviorTimer <= 0) {
        this.behaviorTimer = 1.4 + Math.random();
        this.behavior = 'search';
        const base = this.investigate || this.target || this.home;
        this.behaviorDest = patrolPoint(ctx, base, 18);
        this.replanTimer = 0;
      }
      if (this.searchTimer <= 0 && this.awareness < 0.05) {
        this.state = 'patrol';
        this.hasSeen = false;
      }
    }
  }

  _chooseCombatBehavior(ctx) {
    const T = this.type;
    const dist = this.target ? this.pos.distanceTo(this.target) : 999;
    const healthFrac = this.health / this.maxHealth;
    const visible = this.target && this._canSeeTarget(ctx);
    const scores = {};

    // forced behaviors
    if (this.mag <= 0) { this._setBehavior('reload', ctx); return; }
    if (T.melee && dist < T.meleeRange + 0.6) { this._setBehavior('melee', ctx); return; }

    scores.suppress = (visible ? 40 : 0) + (this.aiRole === 'support' ? 30 : 0) + (dist > 15 ? 12 : 0) + (this.mag > 8 ? 10 : -30);
    scores.advance = (this.aiRole === 'assault' ? 26 : 6) + (dist > 30 ? 16 : 0) + this.suppression * -20;
    scores.takeCover = (healthFrac < 0.5 ? 45 : 0) + (ctx.time - this.lastDamageTime < 1.2 ? 30 : 0) + this.suppression * 35 + (this.aiRole === 'support' ? 8 : 0);
    scores.flank = (this.aiRole === 'flank' ? 55 : 0) + (dist > 14 ? 8 : -20);
    scores.strafe = (visible ? 22 : 0) + (dist < 20 ? 18 : 0) + (T.aggression > 1.2 ? 8 : 0);
    scores.reload = 0;
    scores.grenade = (this.grenades > 0 && this.grenadeCd <= 0 && !visible && dist > 8 && dist < 38 ? 34 : -100);
    scores.retreat = (healthFrac < 0.22 ? 60 : -100) + (this.squad && this.squad.strategy === 'fallback' ? 20 : 0);
    scores.overwatch = (T.keepDist ? 40 : 0) + (dist < T.keepDist * 0.7 ? 22 : 0);

    let best = 'suppress', bestScore = -Infinity;
    const bias = { suppress: 0, advance: 0.3 * T.aggression, takeCover: 0, flank: 0, strafe: 0, reload: 0, grenade: 0, retreat: 0, overwatch: 0 };
    for (const k in scores) {
      const s = scores[k] + (bias[k] || 0) + Math.random() * 8;
      if (s > bestScore) { bestScore = s; best = k; }
    }
    // some persistence to avoid jitter
    if (this.behavior && scores[this.behavior] !== undefined && Math.random() < 0.35) best = this.behavior;
    this._setBehavior(best, ctx);
  }

  _setBehavior(b, ctx) {
    if (b === this.behavior && this.behaviorDest) return;
    this.behavior = b;
    this.behaviorDest = null;
    this.coverPos = null;
    this.replanTimer = 0;
    if (b === 'takeCover' || b === 'reload') {
      this.wantCrouch = true;
    } else {
      this.wantCrouch = false;
    }
    switch (b) {
      case 'suppress':
        this.behaviorDest = findCoverPoint(ctx, this.pos, this.target || this.pos, { radius: 7 }) || this.pos.clone();
        break;
      case 'advance':
        this.behaviorDest = advancePoint(ctx, this.pos, this.target || this.pos, 10 + Math.random() * 8) || this.pos.clone();
        break;
      case 'takeCover':
        this.behaviorDest = findCoverPoint(ctx, this.pos, this.target || this.pos, { radius: 10 }) || retreatPoint(ctx, this.pos, this.target || this.pos, 8) || this.pos.clone();
        break;
      case 'flank': {
        const side = this.squad && this.squad.members.indexOf(this) % 2 === 0 ? 1 : -1;
        this.behaviorDest = flankPoint(ctx, this.pos, this.target || this.pos, side, 14) || advancePoint(ctx, this.pos, this.target || this.pos, 12);
        break;
      }
      case 'strafe':
        this.strafeDir = Math.random() < 0.5 ? 1 : -1;
        this.behaviorDest = this.pos.clone();
        break;
      case 'retreat':
        this.behaviorDest = retreatPoint(ctx, this.pos, this.target || this.pos, 18) || this.pos.clone();
        break;
      case 'overwatch':
        if (this.target && this.pos.distanceTo(this.target) < this.type.keepDist) {
          this.behaviorDest = retreatPoint(ctx, this.pos, this.target, 12) || this.pos.clone();
        } else {
          this.behaviorDest = findCoverPoint(ctx, this.pos, this.target || this.pos, { radius: 8 }) || this.pos.clone();
        }
        break;
      case 'grenade':
        this.behaviorDest = findCoverPoint(ctx, this.pos, this.target || this.pos, { radius: 6 }) || this.pos.clone();
        // throw now
        this._throwGrenade(ctx);
        this.behavior = 'suppress';
        this.behaviorTimer = 0.8;
        break;
      case 'melee':
        this.behaviorDest = null; // handled in act
        break;
    }
    this.replanTimer = 0;
  }

  _canSeeTarget(ctx) {
    if (!this.target) return false;
    const eye = this.eyePos;
    return ctx.nav.losClear(eye.x, eye.y, eye.z, this.target.x, this.target.y, this.target.z);
  }

  /* ------------------------------- act ---------------------------------- */
  _act(dt, ctx) {
    // path to behavior destination
    if (this.behavior === 'strafe') {
      // lateral movement around current position relative to target
      if (this.target) {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len * this.strafeDir, pz = dx / len * this.strafeDir;
        this.desiredMove = new THREE.Vector3(px, 0, pz).multiplyScalar(this.type.speed * 0.7);
      }
    } else if (this.behavior === 'melee') {
      if (this.target) {
        const d = this.pos.distanceTo(this.target);
        if (d < this.type.meleeRange) {
          const tgt = this.currentTarget;
          if (this.meleeCd <= 0 && tgt && tgt.alive) {
            tgt.takeDamage(this.type.meleeDmg * ctx.difficulty.damage);
            ctx.audio.hurt(Math.min(1, this.type.meleeDmg / 30));
            this.meleeCd = 1.1;
            ctx.effects.burst(new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1, tgt.pos.z), new THREE.Vector3(0, 1, 0), 'flesh', 16, 1.2);
          }
          this.desiredMove = new THREE.Vector3();
        } else {
          this._followPath(dt, ctx, this.target, this.type.speed * 1.05);
        }
      }
    } else if (this.behaviorDest) {
      this._followPath(dt, ctx, this.behaviorDest, this.type.speed);
      if (!this.type.stationary && this.pos.distanceTo(this.behaviorDest) < 1.6) {
        // arrived
        if (this.state === 'patrol' || this.state === 'search' || this.state === 'investigate') {
          this.behaviorDest = null; this.behaviorTimer = 0;
        } else {
          // in combat: recompute the destination next tick (keeps pressure on)
          this.behaviorDest = null;
          this.behaviorTimer = Math.min(this.behaviorTimer, 0.2);
        }
      }
    } else {
      this.desiredMove = new THREE.Vector3();
    }

    // face movement / target
    let faceX = 0, faceZ = 0;
    if (this.state === 'combat' && this.target) {
      faceX = this.target.x - this.pos.x;
      faceZ = this.target.z - this.pos.z;
    } else if (this.desiredMove && this.desiredMove.lengthSq() > 0.01) {
      faceX = this.desiredMove.x; faceZ = this.desiredMove.z;
    }
    if (faceX !== 0 || faceZ !== 0) {
      const targetYaw = Math.atan2(faceX, faceZ);
      let d = targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 7);
    }

    // combat shooting
    if (this.state === 'combat') this._combat(dt, ctx);
  }

  _followPath(dt, ctx, dest, speed) {
    if (!this.path || this.replanTimer <= 0 || !this._pathValid(dest)) {
      this.replanTimer = 1.4 + Math.random() * 1.2;
      const p = ctx.nav.findPath(this.pos.x, this.pos.z, dest.x, dest.z);
      if (p && p.length) { this.path = p; this.pathIndex = 0; }
      else this.path = [dest.clone()];
    }
    if (!this.path) { this.desiredMove = new THREE.Vector3(); return; }
    let wp = this.path[this.pathIndex];
    while (wp && this.pos.distanceToSquared(new THREE.Vector3(wp.x, this.pos.y, wp.z)) < 1.8 * 1.8) {
      this.pathIndex++;
      wp = this.path[this.pathIndex];
    }
    if (!wp) {
      this.desiredMove = new THREE.Vector3();
      return;
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const desired = new THREE.Vector3(dx / len, 0, dz / len).multiplyScalar(speed);
    this.desiredMove = desired;
  }

  _pathValid(dest) {
    if (!this.path || !this.path.length) return false;
    const last = this.path[this.path.length - 1];
    return last.distanceToSquared(dest) < 4 * 4;
  }

  _combat(dt, ctx) {
    const T = this.type;
    const wep = T.weapon;
    const visible = this._canSeeTarget(ctx);
    const dist = this.target ? this.pos.distanceTo(this.target) : 999;

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.mag = wep.mag;
      return;
    }
    if (this.mag <= 0) { this.reloadTimer = wep.reload; return; }

    if (this.target && ctx.time - this.lastSeen > 0.7) {
      // no direct sight — hold fire, maybe reposition
    }

    // grenade opportunity handled by behavior

    if (!visible) return;

    // aim smoothing / reaction
    if (ctx.time - this.firstSeenTime < this.reactionTimer) return;

    this.fireTimer -= dt;
    if (this.burstCooldown > 0) { this.burstCooldown -= dt; return; }
    if (this.burstLeft <= 0) {
      this.burstLeft = Math.floor(wep.burstMin + Math.random() * (wep.burstMax - wep.burstMin + 1));
    }
    if (this.fireTimer > 0) return;
    this.fireTimer = 60 / (wep.rpm * (this.statusMods ? this.statusMods.fireMul : 1));
    this.burstLeft--;
    this.mag--;
    this._shoot(ctx, dist, visible);
    if (this.burstLeft <= 0) {
      this.burstCooldown = wep.burstPause[0] + Math.random() * (wep.burstPause[1] - wep.burstPause[0]);
      this.burstCooldown /= ctx.difficulty.fireRate;
    }
    // call reinforcements for officers
    if (T.officer && this.officerReinforceCd <= 0 && Math.random() < 0.2) {
      this.officerReinforceCd = 14 + Math.random() * 10;
      ctx.manager.requestReinforcements(this, ctx);
    }
  }

  _shoot(ctx, dist, visible) {
    const T = this.type;
    const wep = T.weapon;
    const muzzleWorld = new THREE.Vector3();
    this.parts.muzzle.getWorldPosition(muzzleWorld);
    const tgt = this.currentTarget || (ctx.targets && ctx.targets.find(t => t.alive));
    if (!tgt || !tgt.alive) return;
    const playerChest = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.3, tgt.pos.z);

    // accuracy model
    let acc = T.accuracy * ctx.difficulty.accuracy;
    acc *= THREE.MathUtils.clamp(1 - dist / (T.view * 1.4), 0.28, 1.0);
    acc *= (1 - this.suppression * 0.35);
    acc *= (1 - Math.min(0.4, (tgt.speed || 0) / 20));
    if (!visible) acc *= 0.4;
    if (this.type.moving) acc *= 0.85;

    const dir = new THREE.Vector3().subVectors(playerChest, muzzleWorld).normalize();
    // add spread
    const spread = wep.spread * (1 + this.suppression);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread * (Math.random() < acc ? 0.4 : 1.6);
    const shotDir = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r).normalize();

    // world occlusion
    const wHit = ctx.world.raycast(muzzleWorld, shotDir, wep.range, (b) => b.tag === 'sidewalk');
    const maxD = wHit ? wHit.distance : wep.range;
    let hitPlayer = false;
    // player capsule test
    const cap = rayCapsule(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, shotDir.x, shotDir.y, shotDir.z,
      new THREE.Vector3(tgt.pos.x, tgt.pos.y + 0.2, tgt.pos.z), 0.5, 1.6, maxD);
    if (cap && tgt.alive) {
      // apply accuracy roll
      if (Math.random() < 0.35 + acc * 0.65) {
        hitPlayer = true;
        tgt.takeDamage(wep.dmg * ctx.difficulty.damage * (this.statusMods ? this.statusMods.dmgDealtMul : 1));
        if (ctx.audio) ctx.audio.hurt(Math.min(1, wep.dmg / 25));
      }
    }

    const end = hitPlayer && cap ? cap.point : (wHit ? wHit.point : muzzleWorld.clone().addScaledVector(shotDir, wep.range));
    ctx.effects.tracer(muzzleWorld, end, T.laser ? [1, 0.3, 0.3] : [1, 0.55, 0.25], 0.07);
    ctx.effects.spawnParticle(end.x, end.y, end.z, 0, 1, 0, 1, 0.7, 0.3, 0.12, 0.15, 0, 2);
    if (!hitPlayer && wHit) {
      ctx.effects.burst(wHit.point, new THREE.Vector3(wHit.normal[0], wHit.normal[1], wHit.normal[2]), 'concrete', 5, 0.6);
    }
    // muzzle flash visual
    ctx.effects.spawnParticle(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, 0, 0, 0, 1, 0.8, 0.4, 0.18, 0.06, 0, 4);
    if (ctx.audio) ctx.audio.gunshot(T.name === 'HEAVY' ? 'turret' : T.keepDist ? 'sniper' : 'rifle', muzzleWorld.distanceTo(ctx.cameraPos));
    if (ctx.net && ctx.net.isHost) ctx.net.sendEnemyShot(muzzleWorld, end);
  }

  _throwGrenade(ctx) {
    if (this.grenades <= 0 || this.grenadeCd > 0) return;
    this.grenades--;
    this.grenadeCd = 6 + Math.random() * 5;
    const from = this.eyePos;
    const to = (this.target || ctx.player.pos).clone();
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    // arc toward the target
    const vel = dir.multiplyScalar(10 + dist * 0.35);
    vel.y += 4.5;
    ctx.projectiles.spawn({
      pos: from, vel, type: 'grenade', damage: 90, aoe: 6, fuse: 2.0,
      owner: 'enemy', gravity: 20, bounce: 0.4, color: 0xff4400, life: 4,
    });
    if (ctx.audio) ctx.audio.radio();
  }

  notifyNoise(pos, level) {
    if (!this.alive) return;
    if (this.state === 'patrol') {
      this.state = 'investigate';
      this.investigate = pos.clone();
      this.awareness = Math.max(this.awareness, 0.4);
      this.behaviorTimer = 0;
    }
  }

  takeDamage(amount, point, dir, head, src) {
    if (!this.alive) return false;
    let dmg = amount * (this.statusMods ? this.statusMods.dmgTakenMul : 1);
    this.health -= dmg;
    this.hitFlash = 1;
    this.lastDamageTime = this._ctxTime || 0;
    this.suppression = Math.min(1.5, this.suppression + 0.4 + (head ? 0.3 : 0));
    if (head && this.health > 0) this.stagger = Math.max(this.stagger, 0.14);
    else this.stagger = Math.max(this.stagger, 0.05);
    // become aware when shot
    if (this.state === 'patrol') {
      this.state = 'combat';
      this.hasSeen = false;
      this.firstSeenTime = this._ctxTime || 0;
      this.target = point.clone();
      if (this.squad) this.squad.reportContact(point, this._ctxTime || 0);
      this.reactionTimer = 0.15;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = 'dead';
      this.deathTime = 0;
      return true;
    }
    return false;
  }

  _updateDead(dt) {
    this.deadTime += dt;
    if (this.parts && this.parts.marker) this.parts.marker.visible = false;
    // fall over + sink
    const t = Math.min(1, this.deadTime * 2.5);
    this.root.rotation.x = t * Math.PI / 2 * 0.9;
    this.root.rotation.z += this.deathSpin.z * dt * 0.2;
    if (this.deadTime > 1.5) {
      this.root.position.y = this.pos.y - (this.deadTime - 1.5) * 0.6;
      this.root.traverse(o => { if (o.material && o.material.transparent !== undefined) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - (this.deadTime - 1.5)); } });
    }
    if (this.deadTime > 3.5) this.removeMe = true;
  }

  _applyVelocity(dt, ctx) {
    const T = this.type;
    let desired = this.desiredMove || new THREE.Vector3();
    this.desiredMove = null;
    // separation from other enemies
    const sep = ctx.manager.separation(this);
    desired.add(sep);
    // personal-space bubble around players so units never clip into the camera
    if (ctx.targets) {
      const R = this.type.melee ? this.type.meleeRange * 0.8 : 2.4;
      for (const tgt of ctx.targets) {
        if (!tgt.alive) continue;
        const dx = this.pos.x - tgt.pos.x, dz = this.pos.z - tgt.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const push = (R - d) / R;
          desired.x += (dx / d) * push * this.type.speed * 1.6;
          desired.z += (dz / d) * push * this.type.speed * 1.6;
        }
      }
    }
    // status movement modifiers (freeze / stun / slow)
    desired.multiplyScalar(this.statusMods ? this.statusMods.speedMul : 1);

    // obstacle avoidance (feelers)
    if (desired.lengthSq() > 0.01 && !T.flying) {
      const dir = desired.clone().normalize();
      const ahead = 1.5;
      const probe = new THREE.Vector3(this.pos.x + dir.x * ahead, this.pos.y + 0.9, this.pos.z + dir.z * ahead);
      if (ctx.world.pointBlocked(probe.x, probe.y, probe.z, this.type.radius)) {
        // steer perpendicular
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        if (ctx.world.pointBlocked(this.pos.x + perp.x * 1.6, this.pos.y + 0.9, this.pos.z + perp.z * 1.6, this.type.radius))
          perp.negate();
        desired = perp.multiplyScalar(T.speed);
      }
    }

    const a = T.accel || 12;
    this.vel.x += (desired.x - this.vel.x) * Math.min(1, dt * a * 0.4);
    this.vel.z += (desired.z - this.vel.z) * Math.min(1, dt * a * 0.4);
    this.type.moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;

    // integrate with collision (axis-separated). Flyers collide too, so they
    // can no longer drift through a building shell and shoot out of the walls
    // (a unit whose ray starts inside a solid box passes the slab test).
    if (!T.stationary) {
      const nx = this.pos.x + this.vel.x * dt;
      if (!ctx.world.pointBlocked(nx, this.pos.y + 0.9, this.pos.z, this.type.radius * 0.8)) this.pos.x = nx;
      else this.vel.x = 0;
      const nz = this.pos.z + this.vel.z * dt;
      if (!ctx.world.pointBlocked(this.pos.x, this.pos.y + 0.9, nz, this.type.radius * 0.8)) this.pos.z = nz;
      else this.vel.z = 0;
    } else {
      this.vel.set(0, 0, 0);
    }

    // vertical
    if (T.flying) {
      const hoverTarget = ctx.world.groundHeight(this.pos.x, this.pos.z) + (T.hover || 4);
      // avoid clipping into buildings: raise if blocked
      let extra = 0;
      if (ctx.world.pointBlocked(this.pos.x, hoverTarget, this.pos.z, 0.8)) extra = 3;
      const ty = hoverTarget + extra + Math.sin(ctx.time * 2 + this.walkPhase) * 0.4;
      this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 3);
    } else if (!T.stationary) {
      const g = ctx.world.groundHeight(this.pos.x, this.pos.z);
      this.pos.y += (g - this.pos.y) * Math.min(1, dt * 12);
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  _animate(dt, ctx) {
    const T = this.type;
    const parts = this.parts;
    // Hostile marker: keep a roughly constant on-screen size so distant units
    // stay readable, and pulse gently so moving targets catch the eye.
    if (parts.marker) {
      const dist = ctx && ctx.cameraPos ? ctx.cameraPos.distanceTo(this.pos) : 24;
      const s = THREE.MathUtils.clamp(dist * 0.045, 0.45, 3.6);
      parts.marker.scale.set(s, s, s);
      const tm = ctx ? ctx.time : 0;
      parts.marker.position.y = T.height + 0.55 + Math.sin(tm * 3 + this.walkPhase) * 0.05;
      // gentle pulse so moving hostiles catch the eye
      parts.marker.material.opacity = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(tm * 5 + this.walkPhase));
      parts.marker.visible = this.alive;
    }
    if (T.stationary) {
      if (parts.cannon) {
        // aim turret at target
        const to = this.target || (this.state === 'combat' ? null : null);
        if (to) {
          const dx = to.x - this.pos.x, dz = to.z - this.pos.z;
          this.root.rotation.y = Math.atan2(dx, dz);
          parts.cannon.rotation.x = Math.PI / 2;
        }
      }
      return;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (parts.canAnimateLegs) {
      this.walkPhase += dt * (2 + speed * 2.2);
      const sw = Math.sin(this.walkPhase) * Math.min(1, speed / 4) * (this.wantCrouch ? 0.4 : 0.8);
      parts.legL.rotation.x = sw;
      parts.legR.rotation.x = -sw;
      if (parts.legL.userData.lower) parts.legL.userData.lower.rotation.x = Math.max(0, -sw) * 0.8;
      if (parts.legR.userData.lower) parts.legR.userData.lower.rotation.x = Math.max(0, sw) * 0.8;
      // torso bob
      parts.root.position.y = this.pos.y + Math.abs(Math.sin(this.walkPhase)) * 0.04 * Math.min(1, speed / 4);
      // arms: aim
      if (this.state === 'combat' && this.target) {
        const aimPitch = THREE.MathUtils.clamp(Math.atan2(
          (this.target.y) - (this.pos.y + parts.headY), this.pos.distanceTo(this.target)), -1, 1);
        parts.armL.rotation.x = -Math.PI / 2.2 + aimPitch;
        parts.armR.rotation.x = -Math.PI / 2.2 + aimPitch;
      } else {
        parts.armL.rotation.x = -Math.PI / 2.2;
        parts.armR.rotation.x = -Math.PI / 2.2;
      }
      // crouch
      const crouchTarget = this.wantCrouch ? 0.35 : 0;
      parts.root.scale.y += ((1 - crouchTarget) - parts.root.scale.y) * Math.min(1, dt * 6);
    } else if (parts.rotor) {
      parts.rotor.rotation.y += dt * 30;
    }
    // hit flash on core
    if (parts.materials) {
      const f = this.hitFlash;
      parts.materials.core.emissiveIntensity = 1.6 + f * 6;
      parts.materials.core.emissive.setHex(f > 0.1 ? 0xffffff : T.accent);
    }
    // laser
    if (parts.laser) parts.laser.visible = this.state === 'combat';
  }
}

/* =========================== enemy manager =============================== */
export class EnemyManager {
  constructor(scene, world, nav, effects, audio, projectiles) {
    this.scene = scene;
    this.world = world;
    this.nav = nav;
    this.effects = effects;
    this.audio = audio;
    this.projectiles = projectiles;
    this.list = [];
    this.squads = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.difficulty = { aimSpeed: 1, accuracy: 1, damage: 1, fireRate: 1, hp: 1 };
    this.time = 0;
    this.onKill = null;
    this._nextSquad = 0;
    this.nextId = 1;
    this.net = null;
    this._spawnAccum = 0;
    this._buf = new THREE.Vector3();
    this._sep = new THREE.Vector3();
  }

  reset() {
    for (const e of this.list) this.group.remove(e.root);
    this.list.length = 0;
    this.squads.length = 0;
  }

  makeCtx(player, cameraPos) {
    const targets = [{
      id: 'me', isLocal: true, alive: player.alive, speed: player.speed,
      cloaked: player.cloaked,
      pos: player.pos,
      takeDamage: (a) => player.takeDamage(a),
    }];
    if (this.net && this.net.isHost) {
      for (const [, p] of this.net.players) {
        if (!p.pos) continue;
        targets.push({
          id: p.id, isLocal: false, alive: p.alive !== 0,
          speed: 0,
          pos: new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z),
          takeDamage: (a) => this.net.sendDamage(p.id, a, false),
        });
      }
    }
    return {
      world: this.world, nav: this.nav, player, targets,
      effects: this.effects, audio: this.audio, projectiles: this.projectiles,
      manager: this, net: this.net,
      smokes: this.projectiles ? this.projectiles.smokes : [],
      cameraPos, time: this.time, difficulty: this.difficulty,
    };
  }

  spawn(typeName, pos, squad = null, opts = {}) {
    const type = ENEMY_TYPES[typeName];
    if (!type) return null;

    // Never spawn embedded in solid geometry. A unit inside a building mass is
    // untouchable: the player's hitscan hits the shell first, while the unit's
    // own shot ray starts *inside* the AABB (where the slab test reports no hit)
    // so it fires straight out through the wall.
    if (!opts.ghost) {
      const r = (type.radius || 0.5) * 0.7;
      if (this.world.pointBlocked(pos.x, pos.y + 0.9, pos.z, r)) {
        const clear = this.world.clearStreetSpawn(pos.x, pos.z, r);
        if (!clear) return null;
        pos = clear;
      }
    }

    if (!squad) {
      squad = this.squads.find(s => s.members.length < 5) || this._newSquad();
    }
    const e = new Enemy(type, pos, squad, { hpMul: this.difficulty.hp * (opts.hpMul ?? 1), id: this.nextId++, typeKey: typeName, ghost: opts.ghost, elite: opts.elite });
    if (opts.elite) {
      e.maxHealth *= 1.8; e.health = e.maxHealth;
      e.root.scale.multiplyScalar(1.15);
      const aura = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 20),
        new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      aura.rotation.x = Math.PI / 2; aura.position.y = 0.1; e.root.add(aura);
      e.aura = aura;
    }
    squad.add(e);
    this.group.add(e.root);
    this.list.push(e);
    return e;
  }

  spawnGhost(typeName, id, pos, yaw) {
    let e = this.list.find(x => x.ghost && x.id === id);
    if (!e) {
      const type = ENEMY_TYPES[typeName] || ENEMY_TYPES.grunt;
      e = new Enemy(type, pos, null, { id, typeKey: typeName, ghost: true });
      e.state = 'combat';
      this.group.add(e.root);
      this.list.push(e);
    }
    e.gx = pos.x; e.gy = pos.y; e.gz = pos.z; e.gyaw = yaw;
    return e;
  }

  _newSquad() {
    const s = new Squad(this._nextSquad++);
    this.squads.push(s);
    return s;
  }

  spawnSquad(centre, count, types, opts = {}) {
    const squad = this._newSquad();
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const t = types[Math.floor(Math.random() * types.length)];
      const pos = this.world.randomStreetNear(centre.x, centre.z, 2, opts.spread ?? 12);
      const e = this.spawn(t, pos, squad, opts);
      if (e) spawned.push(e);
    }
    squad.alerted = false;
    return { squad, enemies: spawned };
  }

  update(dt, player, cameraPos) {
    this.time += dt;
    const ctx = this.makeCtx(player, cameraPos);
    for (const s of this.squads) s.update(dt, ctx);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e._ctxTime = this.time;
      if (e.ghost) {
        const dx = e.gx - e.pos.x, dz = e.gz - e.pos.z;
        e.vel.set(dx * 8, 0, dz * 8);
        e.pos.x += dx * Math.min(1, dt * 12);
        e.pos.y += (e.gy - e.pos.y) * Math.min(1, dt * 12);
        e.pos.z += dz * Math.min(1, dt * 12);
        let dy = e.gyaw - e.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw += dy * Math.min(1, dt * 12);
        e.state = 'combat';
        e.root.position.copy(e.pos);
        e.root.rotation.y = e.yaw;
        e._animate(dt, ctx);
      } else {
        e.update(dt, ctx);
        // Safety net: if a unit somehow ends up embedded in a solid building
        // mass (spawn nudge, a drone drifting through a wall, a chunk edge),
        // move it back onto the street rather than leaving an untouchable
        // shooter firing out of the walls.
        if (e.alive) {
          e._embedCheck = (e._embedCheck ?? 0) - dt;
          if (e._embedCheck <= 0) {
            e._embedCheck = 0.6 + Math.random() * 0.6;
            if (this.world.pointBlocked(e.pos.x, e.pos.y + 0.9, e.pos.z, 0.15, 'building')) {
              const clear = this.world.clearStreetSpawn(e.pos.x, e.pos.z, 0.6);
              if (clear) {
                e.pos.set(clear.x, clear.y, clear.z);
                e.vel.set(0, 0, 0);
                e.root.position.copy(e.pos);
              } else {
                e.removeMe = true;
              }
            }
          }
        }
      }
      if (e.removeMe) {
        this.group.remove(e.root);
        // Sprites share a module-level geometry in three.js — never dispose it.
        e.root.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); });
        if (e.squad) e.squad.remove(e);
        this.list.splice(i, 1);
      }
    }
    // prune empty squads
    for (let i = this.squads.length - 1; i >= 0; i--) {
      if (this.squads[i].members.length === 0) this.squads.splice(i, 1);
    }
  }

  /** Client-side: apply a host snapshot of all enemies. */
  applySnapshot(arr) {
    const seen = new Set();
    for (const s of arr) {
      seen.add(s.i);
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      const e = this.spawnGhost(s.t, s.i, pos, s.yaw);
      e.health = s.hp;
      e.maxHealth = e.maxHealth || s.hp;
      if (s.d) { e.alive = false; e.removeMe = true; }
      else {
        e.alive = true;
        e.removeMe = false;
      }
    }
    // remove ghosts not present in the snapshot
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.ghost && !seen.has(e.id)) {
        this.group.remove(e.root);
        this.list.splice(i, 1);
      }
    }
  }

  /** Host-side: apply a client's reported hit. */
  damageById(id, amount, head, point, dir, src) {
    const e = this.list.find(x => x.id === id);
    if (!e || !e.alive) return;
    const p = point ? new THREE.Vector3(point.x, point.y, point.z) : e.center;
    const d = dir ? new THREE.Vector3(dir.x, dir.y, dir.z) : new THREE.Vector3(0, 0, 1);
    this.damage(e, amount, p, d, head, src);
    if (this.net && this.net.isHost && !e.alive) {
      this.net.sendKill(e.typeKey || e.type.name, 'REMOTE', head);
    }
  }

  /** Kill reward path used when damage-over-time finishes a unit. */
  _onDotKill(enemy, ctx) {
    if (this.audio) this.audio.enemyDeath(enemy.type.flying ? 'drone' : 'grunt');
    if (this.audio) this.audio.killConfirm();
    if (this.net && this.net.isHost) this.net.sendKill(enemy.typeKey || enemy.type.name, this.net.name, false);
    if (this.onKill) this.onKill(enemy, false);
  }

  separation(e) {
    const out = this._sep.set(0, 0, 0);
    let n = 0;
    for (const o of this.list) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 9 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        out.x += (dx / d) * (1 - d / 3) * e.type.speed * 0.6;
        out.z += (dz / d) * (1 - d / 3) * e.type.speed * 0.6;
        n++;
      }
    }
    return out;
  }

  raycast(origin, dir, maxDist, ignore) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive) continue;
      if (ignore && ignore.has(e)) continue;
      const base = new THREE.Vector3(e.pos.x, e.pos.y + 0.15, e.pos.z);
      const r = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, base, e.type.radius + 0.25, e.type.height * 0.92, maxDist);
      if (r && (!best || r.t < best.t)) best = { enemy: e, t: r.t, point: r.point, head: r.head };
    }
    return best;
  }

  raycastProjectile(pos, dir, maxDist) {
    return this.raycast(pos, dir, maxDist);
  }

  damage(enemy, amount, point, dir, head, src) {
    if (!enemy || !enemy.alive) return;
    if (this.net && !this.net.isHost && enemy.ghost) {
      this.net.sendHit(enemy.id, amount, head, point);
    }
    const before = enemy.health;
    const killed = enemy.takeDamage(amount, point, dir, head, src);
    // alert squad / nearby on damage
    if (enemy.squad) enemy.squad.reportContact(point, this.time);
    if (killed) {
      this.effects.burst(enemy.center, new THREE.Vector3(0, 1, 0), 'explosion', 30, 1.4);
      this.effects.shockRing(enemy.center, 0xffaa44, 0.4, 14);
      if (this.audio) this.audio.enemyDeath(enemy.type.flying ? 'drone' : 'grunt');
      if (this.audio) this.audio.killConfirm();
      if (this.net && this.net.isHost) this.net.sendKill(enemy.typeKey || enemy.type.name, this.net.name, head);
      if (this.onKill) this.onKill(enemy, head);
    } else {
      if (this.audio) this.audio.impact('flesh', 0);
    }
  }

  onSight(enemy, pos, ctx) {
    // propagate to squad
    if (enemy.squad) enemy.squad.reportContact(pos, this.time);
    // radio to nearby enemies
    let relayed = 0;
    for (const o of this.list) {
      if (o === enemy || !o.alive) continue;
      const d = o.pos.distanceTo(enemy.pos);
      if (d < 45) {
        if (o.state === 'patrol') { o.state = 'investigate'; o.investigate = pos.clone(); o.awareness = Math.max(o.awareness, 0.5); o.behaviorTimer = 0; }
        if (o.state === 'combat') { o.target = pos.clone(); o.lastSeen = this.time; }
        if (o.squad && o.squad !== enemy.squad && relayed < 6) { o.squad.reportContact(pos, this.time); relayed++; }
      }
    }
    if (!this._alarmed && this.time > 3) {
      this._alarmed = true;
      if (this.audio) this.audio.alarm();
      setTimeout(() => { this._alarmed = false; }, 8000);
    }
  }

  notifyNoise(pos, radius, level = 1) {
    for (const e of this.list) {
      if (!e.alive) continue;
      if (e.pos.distanceTo(pos) < radius) e.notifyNoise(pos, level);
    }
  }

  requestReinforcements(officer, ctx) {
    if (this.list.length > 42) return;
    const centre = officer.pos;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const pos = this.world.randomStreetNear(centre.x, centre.z, 25, 45);
      const t = ['grunt', 'rusher', 'drone'][Math.floor(Math.random() * 3)];
      const e = this.spawn(t, pos, null, { hpMul: 1 });
      if (!e) continue;
      e.state = 'investigate';
      e.investigate = ctx.player.pos.clone();
      this.effects.burst(new THREE.Vector3(pos.x, pos.y + 1, pos.z), new THREE.Vector3(0, 1, 0), 'energy', 12, 1);
    }
    if (this.audio) this.audio.spawnWarp();
  }

  countAlive() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }

  alertAll(pos) {
    for (const e of this.list) {
      if (!e.alive) continue;
      if (e.state === 'patrol') { e.state = 'investigate'; e.investigate = pos.clone(); e.awareness = 0.6; e.behaviorTimer = 0; }
    }
  }
}
