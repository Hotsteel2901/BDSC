import * as THREE from 'three';

/**
 * ProjectileManager — physical projectiles (grenades, plasma bolts, rockets)
 * with gravity, bouncing, world collision, proximity/AoE damage and tracers.
 */
export class ProjectileManager {
  constructor(scene, effects, world, audio) {
    this.scene = scene;
    this.effects = effects;
    this.world = world;
    this.audio = audio;
    this.list = [];
    this.pool = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.smokes = [];
    this._enemies = null;
    this._player = null;
    this.sparkGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this.grenadeGeo = new THREE.IcosahedronGeometry(0.16, 1);
    this.rocketGeo = new THREE.ConeGeometry(0.13, 0.5, 6);
    // Fixed pool of always-visible glow lights for plasma/rockets. A light per
    // projectile would change the scene's visible-light count on every shot and
    // force three.js to recompile all lit materials (explosion-frame hitches).
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.visible = true;
      this.group.add(l);
      this.lights.push(l);
    }
  }

  _getMesh(type, color) {
    let mesh;
    if (type === 'grenade') {
      mesh = new THREE.Mesh(this.grenadeGeo, new THREE.MeshStandardMaterial({ color: 0x2a3038, emissive: color, emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.4 }));
    } else if (type === 'rocket') {
      mesh = new THREE.Mesh(this.rocketGeo, new THREE.MeshStandardMaterial({ color: 0x555b62, emissive: 0xff6600, emissiveIntensity: 1.2 }));
      mesh.rotation.x = Math.PI / 2;
    } else {
      mesh = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    }
    return mesh;
  }

  spawn(opts) {
    const {
      pos, vel, type = 'plasma', damage = 30, radius = 0, fuse = -1,
      owner = 'player', color = 0x66ddff, gravity = 0, bounce = 0, life = 6,
      speed = 0, aoe = 0, kind = null,
    } = opts;
    let p = this.pool.pop();
    if (!p) p = { mesh: null };
    if (p.mesh) { this.group.remove(p.mesh); }
    p.mesh = this._getMesh(type, color);
    p.mesh.position.copy(pos);
    this.group.add(p.mesh);

    p.pos = pos.clone();
    p.vel = vel.clone();
    p.type = type;
    p.damage = damage;
    p.radius = radius;
    p.hitRadius = type === 'grenade' ? 0.18 : 0.22;
    p.fuse = fuse;
    p.owner = owner;
    p.color = color;
    p.gravity = gravity;
    p.bounce = bounce;
    p.life = life;
    p.aoe = aoe;
    p.kind = kind;
    p.active = true;
    this.list.push(p);
    return p;
  }

  spawnGrenade(pos, dir, owner = 'player', power = 16, kind = 'frag') {
    return this.spawn({
      pos, vel: dir.clone().multiplyScalar(power).add(new THREE.Vector3(0, 3, 0)),
      type: 'grenade', damage: kind === 'emp' || kind === 'smoke' || kind === 'flash' ? 10 : 120,
      aoe: kind === 'emp' ? 7.5 : kind === 'cryo' ? 6.5 : kind === 'flash' ? 8 : 6.5,
      fuse: kind === 'smoke' ? 1.2 : kind === 'flash' ? 1.6 : 2.2, owner,
      gravity: 20, bounce: 0.42, color: grenadeColor(kind), life: 4, kind,
    });
  }
  spawnPlasma(pos, dir, owner = 'player', speed = 70, damage = 42, color = 0x66ddff) {
    return this.spawn({
      pos, vel: dir.clone().multiplyScalar(speed), type: 'plasma',
      damage, aoe: 2.2, owner, color, gravity: 0, life: 4,
    });
  }
  spawnRocket(pos, dir, owner = 'player', speed = 48) {
    return this.spawn({
      pos, vel: dir.clone().multiplyScalar(speed), type: 'rocket',
      damage: 90, aoe: 5.0, owner, color: 0xff8844, gravity: 0, life: 6,
    });
  }

  update(dt, enemies, player) {
    this._enemies = enemies;
    this._player = player;
    // decay smoke zones
    const now = performance.now() / 1000;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      if (now > s.until) {
        if (s.mesh && s.mesh.parent) s.mesh.parent.remove(s.mesh);
        this.smokes.splice(i, 1);
      } else if (s.mesh) {
        s.mesh.scale.setScalar(1 + Math.sin(now * 1.5 + s.phase) * 0.05);
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.fuse > 0) {
        p.fuse -= dt;
        if (p.fuse <= 0) { this._detonate(p, enemies, player); this._remove(i, p); continue; }
      }
      // integrate with sub-stepping
      if (p.gravity) p.vel.y -= p.gravity * dt;
      const move = p.vel.clone().multiplyScalar(dt);
      const dist = move.length();
      if (dist > 0.0001) {
        const dir = move.clone().normalize();
        const hit = this.world.raycast(p.pos, dir, dist + p.hitRadius, (b) => b.tag === 'sidewalk');
        if (hit && hit.distance <= dist + p.hitRadius) {
          // impact
          const worldHit = hit.distance > 0.001 ? hit : null;
          // enemy direct hit check before world
          const eHit = enemies.raycastProjectile(p.pos, dir, hit.distance + 0.2);
          if (eHit && eHit.t < hit.distance) {
            this._applyDirect(p, eHit, enemies, player);
            this._remove(i, p); continue;
          }
          if (p.bounce > 0) {
            // reflect
            const n = new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]);
            p.vel.reflect(n).multiplyScalar(p.bounce);
            p.pos.copy(hit.point).addScaledVector(n, p.hitRadius + 0.02);
            this.effects.burst(hit.point, n, 'metal', 4, 0.5);
            if (this.audio) this.audio.grenadeBounce();
          } else {
            this._detonate(p, enemies, player, hit.point, new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]));
            this._remove(i, p); continue;
          }
        } else {
          // enemy direct hit check
          const eHit = enemies.raycastProjectile(p.pos, dir, dist + p.hitRadius);
          if (eHit) {
            this._applyDirect(p, eHit, enemies, player);
            this._remove(i, p); continue;
          }
          p.pos.add(move);
        }
      }
      if (p.life <= 0) { this._detonate(p, enemies, player); this._remove(i, p); continue; }

      // sync mesh
      p.mesh.position.copy(p.pos);
      if (p.type === 'rocket') {
        const m = new THREE.Matrix4().lookAt(p.pos, p.pos.clone().add(p.vel), new THREE.Vector3(0, 1, 0));
        p.mesh.quaternion.setFromRotationMatrix(m);
      } else if (p.type === 'grenade') {
        p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 4;
      }
      // trail
      if (p.type !== 'grenade' && Math.random() < 0.7) {
        this.effects.spawnParticle(p.pos.x, p.pos.y, p.pos.z,
          (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
          (p.color >> 16 & 255) / 255, (p.color >> 8 & 255) / 255, (p.color & 255) / 255,
          0.12, 0.25, 0, 2);
      }
    }

    // Assign the fixed glow-light pool to the nearest active plasma/rocket
    // projectiles; idle pool lights drop to zero intensity (never toggled
    // visible) so the scene's light count stays constant.
    let li = 0;
    for (const p of this.list) {
      if ((p.type === 'plasma' || p.type === 'rocket') && li < this.lights.length) {
        const l = this.lights[li++];
        l.position.copy(p.pos);
        l.color.setHex(p.color);
        l.intensity = p.type === 'rocket' ? 2.6 : 2.0;
      }
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
  }

  _applyDirect(p, eHit, enemies, player) {
    if (p.aoe > 0) {
      this.effects.explosion(eHit.point, 1);
      this._aoe(eHit.point, p.aoe, p.damage, enemies, player, p.owner);
      if (this.audio) this.audio.explosion(1);
    } else {
      enemies.damage(eHit.enemy, p.damage, eHit.point, p.vel.clone().normalize(), false, 'plasma');
      this.effects.burst(eHit.point, p.vel.clone().normalize().negate(), 'energy', 10, 1);
    }
  }

  _detonate(p, enemies, player, point, normal) {
    const pt = point || p.pos.clone();
    if (p.kind && p.kind !== 'frag') {
      this._grenadeEffect(pt, p.kind, p, enemies, player);
      return;
    }
    const scale = p.type === 'grenade' ? 1.2 : p.type === 'rocket' ? 1.4 : 0.5;
    this.effects.explosion(pt, scale);
    this._aoe(pt, p.aoe || 3, p.damage, enemies, player, p.owner);
    if (this.audio) this.audio.explosion(scale);
  }

  _statusArea(pt, radius, enemies, player, owner, kind, dur, power) {
    const r2 = radius * radius;
    if (owner === 'enemy') {
      if (player && player.alive) {
        const d = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z).distanceToSquared(pt);
        if (d < r2) player.applyStatus(kind, dur, power);
      }
      return;
    }
    for (const e of enemies.list) {
      if (!e.alive || e.ghost) continue;
      if (e.center.distanceToSquared(pt) < r2) e.applyStatus(kind, dur, power);
    }
  }

  _grenadeEffect(pt, kind, p, enemies, player) {
    const E = this.effects, A = this.audio;
    switch (kind) {
      case 'incendiary':
        E.explosion(pt, 1.2); if (A) A.explosion(1.1);
        this._aoe(pt, p.aoe, p.damage * 0.7, enemies, player, p.owner);
        this._statusArea(pt, p.aoe, enemies, player, p.owner, 'burn', 5, 1.5);
        for (let i = 0; i < 60; i++) E.spawnParticle(pt.x, pt.y, pt.z, (Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8, 1, 0.5, 0.12, 0.4, 0.8, -1, 1.2);
        break;
      case 'emp':
        E.shockRing(pt, 0x66ddff, 0.7, 30); E.flash(pt, 0x66ddff, 16, 0.3); if (A) A.explosion(0.6);
        this._statusArea(pt, p.aoe, enemies, player, p.owner, 'stun', 1.6, 1);
        this._aoe(pt, p.aoe, p.damage, enemies, player, p.owner);
        break;
      case 'smoke': {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(4.6, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0x9aa4ac, transparent: true, opacity: 0.55, depthWrite: false }));
        mesh.position.copy(pt); mesh.position.y += 2.2;
        this.group.add(mesh);
        const now = performance.now() / 1000;
        this.smokes.push({ pos: pt.clone().setY(pt.y + 2.2), r: 5.2, until: now + 9, mesh, phase: Math.random() * 6 });
        for (let i = 0; i < 40; i++) E.spawnParticle(pt.x, pt.y + 1, pt.z, (Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3, 0.6, 0.62, 0.65, 0.5, 1.2, 0.2, 0.6);
        if (A) A.explosion(0.3);
        // nearby enemies lose their fix
        if (p.owner !== 'enemy') for (const e of enemies.list) { if (e.alive && !e.ghost && e.pos.distanceTo(pt) < p.aoe) { e.state = 'search'; e.target = null; e.searchTimer = 3; } }
        break;
      }
      case 'flash':
        E.flash(pt, 0xffffff, 30, 0.3); E.shockRing(pt, 0xffffff, 0.4, 24);
        this._statusArea(pt, p.aoe, enemies, player, p.owner, 'stun', 1.4, 1);
        if (p.owner !== 'enemy') for (const e of enemies.list) {
          if (e.alive && !e.ghost && e.pos.distanceTo(pt) < p.aoe) { e.state = 'search'; e.burstLeft = 0; }
        }
        if (A) A.alarm();
        break;
      case 'cryo':
        E.explosion(pt, 0.5); E.shockRing(pt, 0x9fe8ff, 0.6, 22); if (A) A.explosion(0.5);
        this._aoe(pt, p.aoe, p.damage * 0.5, enemies, player, p.owner);
        this._statusArea(pt, p.aoe, enemies, player, p.owner, 'cryo', 4, 1.5);
        break;
      case 'cluster': {
        E.explosion(pt, 1.0); if (A) A.explosion(1.0);
        this._aoe(pt, p.aoe, p.damage * 0.6, enemies, player, p.owner);
        for (let i = 0; i < 5; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 0.5, (Math.random() - 0.5) * 5).add(pt);
          setTimeout(() => {
            E.explosion(off, 0.7); if (A) A.explosion(0.7);
            this._aoe(off, 3.0, p.damage * 0.4, enemies, player, p.owner);
          }, 120 + i * 90);
        }
        break;
      }
      default:
        E.explosion(pt, 1.1); this._aoe(pt, p.aoe, p.damage, enemies, player, p.owner); if (A) A.explosion(1.0);
    }
  }

  _aoe(point, radius, damage, enemies, player, owner) {
    if (!radius) return;
    const r2 = radius * radius;
    if (owner !== 'enemy') {
      for (const e of enemies.list) {
        if (!e.alive) continue;
        const d = e.center.distanceToSquared(point);
        if (d < r2) {
          const falloff = 1 - Math.sqrt(d) / radius;
          enemies.damage(e, damage * falloff, point, new THREE.Vector3(0, 1, 0), false, 'explosion');
        }
      }
    }
    if (player && player.alive && owner === 'enemy') {
      const d = new THREE.Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z).distanceToSquared(point);
      if (d < r2) {
        const falloff = 1 - Math.sqrt(d) / radius;
        player.takeDamage(damage * falloff * 0.7);
      }
    }
  }

  _remove(i, p) {
    p.active = false;
    this.group.remove(p.mesh);
    this.list.splice(i, 1);
    if (this.pool.length < 64) this.pool.push(p);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i, this.list[i]);
    for (const s of this.smokes) if (s.mesh && s.mesh.parent) s.mesh.parent.remove(s.mesh);
    this.smokes.length = 0;
    for (const l of this.lights) l.intensity = 0;
  }
}

function grenadeColor(kind) {
  switch (kind) {
    case 'incendiary': return 0xff6a22;
    case 'emp': return 0x4de0ff;
    case 'smoke': return 0x9aa4ac;
    case 'flash': return 0xffffff;
    case 'cryo': return 0x9fe8ff;
    case 'cluster': return 0xffaa55;
    default: return 0xff4400;
  }
}
