import * as THREE from 'three';

/**
 * Player — first-person controller with capsule-vs-AABB collision, step-up,
 * crouch, sprint, jump and air control. Also serves as the camera rig.
 */
export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    this.pos = new THREE.Vector3(0, 1.7, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.radius = 0.42;
    this.standHeight = 1.8;
    this.crouchHeight = 1.05;
    this.eyeOffset = -0.12; // eye near top of capsule
    this.height = this.standHeight;
    this.eyeHeight = this.standHeight + this.eyeOffset;

    this.onGround = false;
    this.wasOnGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.walkSpeed = 5.4;
    this.sprintSpeed = 9.0;
    this.crouchSpeed = 2.8;
    this.jumpSpeed = 6.2;
    this.accel = 60;
    this.airAccel = 12;
    this.friction = 10;
    this.gravity = 22;
    this.stepHeight = 0.45;

    this.maxHealth = 100;
    this.health = 100;
    this.maxArmor = 100;
    this.armor = 25;
    this.alive = true;
    this.regenDelay = 6;
    this.regenRate = 9;
    this._sinceDamage = 999;

    // shield pool (overshield / kinetic barrier)
    this.shield = 0;
    this.maxShield = 200;
    this.shieldDecay = 0;
    // buffs + statuses (assigned by the game)
    this.buffs = null;
    this.enemies = null;
    this.statuses = {};
    this.statusMods = { speedMul: 1, dmgTakenMul: 1, dps: 0, dmgDealtMul: 1, fireMul: 1 };
    this.cloaked = false;
    this._dashCd = 0;

    this.bobTime = 0;
    this.bobAmount = 0;
    this.landImpact = 0;
    this.viewShake = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this._stepPhase = 0;

    this.moveInput = new THREE.Vector2();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this._tmpMin = new THREE.Vector3();
    this._tmpMax = new THREE.Vector3();
    this._buf = [];
    this._seen = new Set();
  }

  reset(pos, yaw = 0) {
    this.pos.copy(pos);
    this.pos.y += 0.3;
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;    this.health = this.maxHealth;
    this.armor = 25;
    this.shield = 0; this.shieldDecay = 0;
    this.statuses = {};
    this.cloaked = false;
    this.alive = true;
    this._sinceDamage = 999;
    this.recoilPitch = 0; this.recoilYaw = 0;
    if (this.buffs) this.buffs.clear();
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  applyLook(dx, dy) {
    const s = 0.0022;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.03;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  updateLookRecoil(dt) {
    // spring the recoil back to centre
    const k = 12;
    this.recoilPitch += (-this.recoilPitch * k) * dt;
    this.recoilYaw += (-this.recoilYaw * k) * dt;
  }

  update(dt, input, enabled = true) {
    if (!enabled) { this._syncCamera(); return; }
    // --- desired movement ---
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.forward.copy(forward); this.right.copy(right);

    let ix = 0, iz = 0;
    if (input.down('KeyW')) iz += 1;
    if (input.down('KeyS')) iz -= 1;
    if (input.down('KeyD')) ix += 1;
    if (input.down('KeyA')) ix -= 1;
    // analogue touch stick overrides the digital keys when deflected
    let mag = Math.min(1, Math.hypot(ix, iz));
    if (input.moveAxis) {
      const ax = input.moveAxis();
      if (ax && (ax.x * ax.x + ax.y * ax.y) > 0.0001) {
        ix = ax.x; iz = ax.y;
        mag = Math.min(1, Math.hypot(ix, iz));
      }
    }
    this.moveInput.set(ix, iz);

    this.crouching = input.down('ControlLeft') || input.down('KeyC');
    // touch: pushing the stick to the edge auto-sprints (no shift key needed)
    const wantSprint = (input.down('ShiftLeft') || (input.touch && mag > 0.85)) && iz > 0.15 && !this.crouching;
    this.sprinting = wantSprint;

    const targetHeight = this.crouching ? this.crouchHeight : this.standHeight;
    this.height += (targetHeight - this.height) * Math.min(1, dt * 12);
    this.eyeHeight = this.height + this.eyeOffset;

    const speedMul = this.buffs ? this.buffs.value('speed') : 1;
    const maxSpeed = (this.crouching ? this.crouchSpeed : (this.sprinting ? this.sprintSpeed : this.walkSpeed)) * speedMul * (this.statusMods ? this.statusMods.speedMul : 1);

    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, iz);
    wish.addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(maxSpeed * mag);

    // --- horizontal accel ---
    const a = this.onGround ? this.accel : this.airAccel;
    const dv = new THREE.Vector3().subVectors(wish, new THREE.Vector3(this.vel.x, 0, this.vel.z));
    const dvLen = dv.length();
    if (dvLen > 0) {
      const step = Math.min(dvLen, a * dt);
      this.vel.x += (dv.x / dvLen) * step;
      this.vel.z += (dv.z / dvLen) * step;
    }
    // ground friction when no input
    if (this.onGround && wish.lengthSq() < 0.001) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0) {
        const drop = Math.min(speed, this.friction * dt * Math.max(1, speed * 0.2));
        this.vel.x *= Math.max(0, 1 - drop / speed);
        this.vel.z *= Math.max(0, 1 - drop / speed);
      }
    }

    // --- jump ---
    if (input.down('Space') && this.onGround) {
      this.vel.y = this.jumpSpeed * (this.buffs ? this.buffs.value('jump') : 1);
      this.onGround = false;
      if (this.audio) this.audio.jump();
    }

    // --- gravity ---
    this.vel.y -= this.gravity * dt;
    if (this.vel.y < -60) this.vel.y = -60;

    // integrate + collide
    this._move(dt);

    // --- ground check ---
    this.wasOnGround = this.onGround;
    this.onGround = this._checkGround();
    if (this.onGround && !this.wasOnGround) {
      const impact = -this.landImpact;
      if (this.audio) this.audio.land(impact > 5);
      this.viewShake = Math.min(0.6, Math.max(0, impact * 0.05));
    }

    // --- footsteps ---
    const spd = this.speed;
    if (this.onGround && spd > 0.8) {
      this._stepPhase += dt * spd * 0.9;
      if (this._stepPhase > 1) {
        this._stepPhase = 0;
        if (this.audio) this.audio.footstep(this._surface(), this.sprinting);
      }
    }

    // --- health regen ---
    this._sinceDamage += dt;
    const regenBonus = this.buffs ? this.buffs.additive('regen') : 0;
    if (this.alive && (this._sinceDamage > this.regenDelay || regenBonus > 0) && this.health < this.maxHealth) {
      const rate = (this._sinceDamage > this.regenDelay ? this.regenRate : 0) + regenBonus;
      if (rate > 0) this.health = Math.min(this.maxHealth, this.health + rate * dt);
    }
    // --- shield decay + buff/status resolution ---
    if (this.shield > 0 && this.shieldDecay > 0) {
      this.shield = Math.max(0, this.shield - this.shieldDecay * dt);
    }
    this.cloaked = this.buffs ? this.buffs.any('invis') : false;
    this._tickStatuses(dt);
    this._dashCd = Math.max(0, this._dashCd - dt);

    // --- view bob ---
    if (this.onGround) {
      const targetBob = spd > 0.8 ? Math.min(1, spd / this.sprintSpeed) : 0;
      this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
      this.bobTime += dt * (this.sprinting ? 13 : 9) * (spd > 0.8 ? 1 : 0);
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 6);
    }
    this.viewShake *= Math.max(0, 1 - dt * 6);
    this.landImpact *= Math.max(0, 1 - dt * 6);
    this.updateLookRecoil(dt);

    this._syncCamera();
  }

  _surface() {
    // guess surface type from collider under the player
    const list = this.world.queryColliders(
      this._tmpMin.set(this.pos.x - 0.5, this.pos.y - 0.3, this.pos.z - 0.5),
      this._tmpMax.set(this.pos.x + 0.5, this.pos.y + 0.1, this.pos.z + 0.5)
    );
    for (const b of list) if (b.tag === 'sidewalk' || b.tag === 'street') return 'concrete';
    return 'concrete';
  }

  _checkGround() {
    const r = this.radius * 0.9;
    const min = this._tmpMin.set(this.pos.x - r, this.pos.y - 0.35, this.pos.z - r);
    const max = this._tmpMax.set(this.pos.x + r, this.pos.y + 0.05, this.pos.z + r);
    const list = this.world.queryColliders(min, max, this._buf, this._seen);
    for (const b of list) {
      if (b.min.y <= this.pos.y + 0.08 && b.max.y >= this.pos.y - 0.35 &&
          this.pos.x > b.min.x - r && this.pos.x < b.max.x + r &&
          this.pos.z > b.min.z - r && this.pos.z < b.max.z + r) {
        return true;
      }
    }
    // ground plane fallback (terrain height, exact)
    return this.pos.y <= this.world.groundHeight(this.pos.x, this.pos.z) + 0.05;
  }

  _move(dt) {
    const r = this.radius;
    // Sub-step both axes so fast movement/jumps can't tunnel through thin
    // colliders (interior walls, sidewalk kerbs, floor slabs).
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    const hSteps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let s = 0; s < hSteps; s++) {
      const px = this.pos.x;
      this.pos.x += dx / hSteps;
      this._resolve('x', r, px);
      const pz = this.pos.z;
      this.pos.z += dz / hSteps;
      this._resolve('z', r, pz);
    }
    // vertical
    this.landImpact = this.vel.y;
    const dy = this.vel.y * dt;
    const vSteps = Math.max(1, Math.ceil(Math.abs(dy) / 0.2));
    for (let s = 0; s < vSteps; s++) {
      const prevY = this.pos.y;
      this.pos.y += dy / vSteps;
      this._resolveVertical(r, prevY);
    }
  }

  _collect(r) {
    const min = this._tmpMin.set(this.pos.x - r, this.pos.y, this.pos.z - r);
    const max = this._tmpMax.set(this.pos.x + r, this.pos.y + this.height, this.pos.z + r);
    return this.world.queryColliders(min, max, this._buf, this._seen);
  }

  _resolve(axis, r, prev) {
    const EPS = 1e-4;
    const list = this._collect(r);
    for (const b of list) {
      const ex0 = b.min.x - r, ex1 = b.max.x + r;
      const ez0 = b.min.z - r, ez1 = b.max.z + r;
      const ey0 = b.min.y, ey1 = b.max.y;
      // Sitting exactly on an expanded face is *touching*, not overlapping:
      // without this, the axis resolved first would leave the player on the
      // boundary and the second axis would then shove them along the wall to
      // the box's far end (the "teleported to a corner" bug).
      if (this.pos.x <= ex0 + EPS || this.pos.x >= ex1 - EPS) continue;
      if (this.pos.z <= ez0 + EPS || this.pos.z >= ez1 - EPS) continue;
      if (this.pos.y + this.height <= ey0 + 0.001 || this.pos.y >= ey1 - 0.001) continue;

      // Try step-up, but only while actually grounded: a small kerb/stair is
      // climbed, whereas an airborne player falling past a tall obstacle must
      // be blocked instead of snapping to its top. The step must also lead
      // somewhere with headroom and walkable footing.
      if (this.onGround && this.vel.y <= 0.1 &&
          b.max.y - this.pos.y <= this.stepHeight && b.max.y - this.pos.y > 0.001 &&
          !this._blockedAbove(b.max.y + 0.05)) {
        this.pos.y = b.max.y + 0.001;
        this.onGround = true;
        this.vel.y = Math.max(0, this.vel.y);
        continue;
      }
      // Push out against the face we entered through (fall back to the
      // nearest face only if we were already inside before this step).
      if (axis === 'x') {
        let target;
        if (prev <= ex0 + EPS) target = ex0;
        else if (prev >= ex1 - EPS) target = ex1;
        else target = (this.pos.x < (ex0 + ex1) / 2) ? ex0 : ex1;
        this.pos.x = target;
        this.vel.x = 0;
      } else {
        let target;
        if (prev <= ez0 + EPS) target = ez0;
        else if (prev >= ez1 - EPS) target = ez1;
        else target = (this.pos.z < (ez0 + ez1) / 2) ? ez0 : ez1;
        this.pos.z = target;
        this.vel.z = 0;
      }
    }
  }

  _resolveVertical(r, prevY) {
    const list = this._collect(r);
    const prevFeet = prevY, prevHead = prevY + this.height;
    for (const b of list) {
      const ex0 = b.min.x - r, ex1 = b.max.x + r;
      const ez0 = b.min.z - r, ez1 = b.max.z + r;
      if (this.pos.x < ex0 || this.pos.x > ex1) continue;
      if (this.pos.z < ez0 || this.pos.z > ez1) continue;
      const feet = this.pos.y, head = this.pos.y + this.height;
      if (head <= b.min.y + 0.001 || feet >= b.max.y - 0.001) continue;
      // Only treat this as a vertical collision if the player was actually
      // above (landing) or below (head-bump) the surface before the step.
      // Touching a wall/prop from the side must block, not teleport onto it.
      if (this.vel.y <= 0 && prevFeet >= b.max.y - 0.03) {
        this.pos.y = b.max.y + 0.001;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.vel.y > 0 && prevHead <= b.min.y + 0.03) {
        this.pos.y = b.min.y - this.height - 0.001;
        this.vel.y = 0;
      }
    }
    // solid ground plane (roads have no collider box): the terrain height under
    // the player is the floor, so the player can never sink through the street.
    const gh = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh && this.vel.y <= 0) {
      this.pos.y = gh;
      this.vel.y = 0;
      this.onGround = true;
    }
    // safety net if we ever fall below the terrain (e.g. chunk streaming edge)
    if (this.pos.y < gh - 6) { this.pos.y = gh + 0.2; this.vel.y = 0; this.onGround = true; }
  }

  _blockedAbove(y) {
    const r = this.radius * 0.8;
    for (let probeY = y + 0.1; probeY < y + this.height; probeY += 0.4) {
      const list = this.world.colliderHash.query(
        this._tmpMin.set(this.pos.x - r, probeY, this.pos.z - r),
        this._tmpMax.set(this.pos.x + r, probeY + 0.2, this.pos.z + r),
        [], new Set()
      );
      if (list.length) return true;
    }
    return false;
  }

  takeDamage(amount, fromDir = null) {
    if (!this.alive) return;
    let dmg = amount * (this.buffs ? this.buffs.value('dmgResist') : 1);
    // armour absorbs 60% of incoming damage
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.6);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    // shield pool absorbs next
    if (this.shield > 0) {
      const a = Math.min(this.shield, dmg);
      this.shield -= a;
      dmg -= a;
    }
    this.health -= dmg;
    this._sinceDamage = 0;
    this.viewShake = Math.min(0.8, this.viewShake + 0.25 + amount * 0.003);
    if (fromDir) {
      this.recoilYaw += fromDir.x * 0.02;
      this.recoilPitch += fromDir.z * 0.02;
    }
    // reactive plating: retaliate against nearby attackers
    const thorns = this.buffs ? this.buffs.value('thorns') : 1;
    if (thorns > 1 && this.enemies) {
      for (const e of this.enemies.list) {
        if (!e.alive || e.ghost) continue;
        if (e.center.distanceTo(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z)) < 7) {
          this.enemies.damage(e, amount * 0.4 * (thorns - 1) + 4, e.center, new THREE.Vector3(0, 1, 0), false, 'thorns');
        }
      }
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  heal(v) { this.health = Math.min(this.maxHealth, this.health + v); }
  giveArmor(v) { this.armor = Math.min(this.maxArmor, this.armor + v); }
  addMaxHealth(v) { this.maxHealth += v; this.health += v; }
  addMaxArmor(v) { this.maxArmor += v; this.armor += v; }
  giveShield(v, dur = 15, decay = 0) {
    this.shield = Math.min(this.maxShield, this.shield + v);
    this.shieldDecay = decay;
  }
  cure(kind) { if (this.statuses[kind]) delete this.statuses[kind]; }
  applyStatus(kind, dur, power = 1) {
    if (this.statuses[kind]) { this.statuses[kind].t = Math.max(this.statuses[kind].t, dur); }
    else this.statuses[kind] = { t: dur, dur, power, stacks: 1 };
  }
  _tickStatuses(dt) {
    let dps = 0, speedMul = 1, dmgTaken = 1;
    for (const k in this.statuses) {
      const s = this.statuses[k];
      s.t -= dt;
      if (s.t <= 0) { delete this.statuses[k]; continue; }
      if (k === 'burn') dps += 6;
      else if (k === 'bleed') dps += 5;
      else if (k === 'poison') dps += 4;
      else if (k === 'cryo') speedMul *= 0.6;
      else if (k === 'corrode') dmgTaken *= 1.2;
      else if (k === 'stun') speedMul = 0.0;
    }
    this.statusMods = { speedMul, dmgTakenMul: dmgTaken, dps };
    if (dps > 0 && this.alive) {
      this.health -= dps * dt;
      if (this.health <= 0) { this.health = 0; this.alive = false; }
    }
  }

  /** Teleport forward up to `dist`, stopping at the first clear spot. */
  blink(dist, world) {
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (let d = dist; d >= 2; d -= 1.5) {
      const x = this.pos.x + dir.x * d, z = this.pos.z + dir.z * d;
      if (!world.isWalkable(x, z)) continue;
      if (world.pointBlocked(x, world.groundHeight(x, z) + 1.0, z, this.radius)) continue;
      this.pos.x = x; this.pos.z = z;
      this.pos.y = world.groundHeight(x, z) + 0.2;
      this.vel.set(0, 0, 0);
      return true;
    }
    return false;
  }

  /** Impulse dash forward. */
  dash(dist) {
    if (this._dashCd > 0) return false;
    this._dashCd = 0.6;
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.vel.x += dir.x * dist * 3.0;
    this.vel.z += dir.z * dist * 3.0;
    return true;
  }

  _syncCamera() {
    const bob = this.bobAmount;
    const bx = Math.sin(this.bobTime) * 0.045 * bob;
    const by = Math.abs(Math.cos(this.bobTime)) * 0.035 * bob;
    const shake = this.viewShake;
    const sx = (Math.random() - 0.5) * shake * 0.4;
    const sy = (Math.random() - 0.5) * shake * 0.4;
    this.camera.position.set(
      this.pos.x + bx + sx,
      this.pos.y + this.eyeHeight + by + sy,
      this.pos.z
    );
    const yaw = this.yaw + this.recoilYaw + sx * 0.2;
    const pitch = this.pitch + this.recoilPitch + sy * 0.2;
    this.camera.rotation.set(pitch, yaw, Math.sin(this.bobTime * 0.5) * 0.01 * bob, 'YXZ');
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.viewShake = Math.min(1.2, this.viewShake + Math.abs(pitch) * 0.3);
  }

  getLookDir() {
    const e = new THREE.Euler(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, 0, 'YXZ');
    return new THREE.Vector3(0, 0, -1).applyEuler(e);
  }
}
