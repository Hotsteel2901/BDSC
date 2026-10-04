import * as THREE from 'three';

/**
 * Deployables — allied entities created by gadget items: auto-turrets, combat
 * drones, proximity mines, hard-light barriers and holo decoys. They fight for
 * the player, occupy space (barriers add collision) and expire over time.
 */
export class Deployables {
  constructor(scene, world, enemies, effects, audio, projectiles) {
    this.scene = scene;
    this.world = world;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.projectiles = projectiles;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.cap = 24;
  }

  clear() {
    for (const d of this.list) this._destroy(d);
    this.list.length = 0;
  }

  deploy(kind, pos, dir, ctx) {
    if (this.list.length >= this.cap) {
      // recycle the oldest
      this._destroy(this.list.shift());
    }
    const base = pos.clone();
    base.y = this.world.groundHeight(base.x, base.z) + 0.05;
    let d;
    switch (kind) {
      case 'turret': d = this._turret(base, ctx); break;
      case 'drone': d = this._drone(base, ctx); break;
      case 'mine': d = this._mine(base); break;
      case 'barrier': d = this._barrier(base, dir); break;
      case 'decoy': d = this._decoy(base); break;
      default: return null;
    }
    if (!d) return null;
    this.group.add(d.mesh);
    this.list.push(d);
    this.effects.burst(base.clone().setY(base.y + 0.5), new THREE.Vector3(0, 1, 0), 'energy', 12, 1);
    return d;
  }

  _turret(pos, ctx) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.45 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x0f5a33, emissive: 0x37ff8b, emissiveIntensity: 1.6, roughness: 0.3, toneMapped: false });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.14, 12), dark); base.position.y = 0.07; g.add(base);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.4), dark); body.position.y = 0.34; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), dark); head.position.y = 0.58; head.name = 'head'; g.add(head);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.58, -0.4); head.add(barrel);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.04), accent); eye.position.set(0, 0.04, -0.18); head.add(eye);
    g.position.copy(pos);
    return { kind: 'turret', mesh: g, pos: pos.clone(), head, life: 32, fireCd: 0, dmg: 9, range: 36, hp: 200 };
  }

  _drone(pos, ctx) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x30363c, metalness: 0.6, roughness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x0d5a7a, emissive: 0x4de0ff, emissiveIntensity: 1.5, roughness: 0.3, toneMapped: false });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.5), dark); g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), accent); eye.position.set(0, 0.02, -0.24); g.add(eye);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), dark); arm.position.set(sx * 0.34, 0.08, 0); g.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 10), accent); rotor.position.set(sx * 0.5, 0.12, 0); rotor.name = 'rotor'; g.add(rotor);
    }
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.3), dark); gun.position.set(0, -0.12, -0.24); g.add(gun);
    g.position.copy(pos); g.position.y += 3.4;
    return { kind: 'drone', mesh: g, pos: pos.clone(), life: 40, fireCd: 0, dmg: 8, range: 30, hover: 3.4, hp: 120, angle: Math.random() * 6.28 };
  }

  _mine(pos) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.7, roughness: 0.5 }));
    g.add(body);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3322, toneMapped: false }));
    led.position.y = 0.08; g.add(led);
    const light = new THREE.PointLight(0xff3322, 1.5, 4, 2); light.position.y = 0.2; g.add(light);
    g.position.copy(pos); g.position.y += 0.05;
    return { kind: 'mine', mesh: g, pos: pos.clone(), life: 90, arm: 1.0, led, light };
  }

  _barrier(pos, dir) {
    const yaw = dir ? Math.atan2(dir.x, dir.z) : 0;
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x0d5a7a, emissive: 0x2a7a9a, emissiveIntensity: 0.5, transparent: true, opacity: 0.72, metalness: 0.2, roughness: 0.4 }));
    panel.position.y = 1.3; g.add(panel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.16, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x37ff8b, emissive: 0x37ff8b, emissiveIntensity: 1.4, toneMapped: false }));
    frame.position.y = 0.1; g.add(frame);
    g.position.copy(pos); g.rotation.y = yaw;
    // collision box (axis-aligned approximation)
    const halfX = Math.abs(Math.cos(yaw)) * 2.0 + Math.abs(Math.sin(yaw)) * 0.15;
    const halfZ = Math.abs(Math.sin(yaw)) * 2.0 + Math.abs(Math.cos(yaw)) * 0.15;
    const col = {
      min: new THREE.Vector3(pos.x - halfX, pos.y, pos.z - halfZ),
      max: new THREE.Vector3(pos.x + halfX, pos.y + 2.6, pos.z + halfZ),
      tag: 'barrier',
    };
    this.world.colliderHash.insertBox(col);
    return { kind: 'barrier', mesh: g, pos: pos.clone(), life: 25, col };
  }

  _decoy(pos) {
    const g = new THREE.Group();
    const d = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4de0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    d.position.y = 1.0; g.add(d);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
    g.position.copy(pos);
    return { kind: 'decoy', mesh: g, pos: pos.clone(), life: 12, pulse: 0 };
  }

  _destroy(d) {
    if (d.col) this.world.colliderHash.removeBox(d.col);
    if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
    d.mesh.traverse(o => { if (o.isMesh) o.geometry = o.geometry; });
  }

  _nearestEnemy(x, y, z, range) {
    let best = null, bd = range * range;
    for (const e of this.enemies.list) {
      if (!e.alive || e.ghost) continue;
      const dx = e.pos.x - x, dy = e.pos.y - y, dz = e.pos.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt, player, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt;
      if (d.life <= 0) { this._destroy(d); this.list.splice(i, 1); continue; }

      if (d.kind === 'turret') {
        const e = this._nearestEnemy(d.pos.x, d.pos.y + 0.6, d.pos.z, d.range);
        if (e) {
          const dx = e.pos.x - d.pos.x, dz = e.pos.z - d.pos.z;
          const ty = Math.atan2(dx, dz);
          let dy = ty - d.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          d.mesh.rotation.y += dy * Math.min(1, dt * 8);
          d.fireCd -= dt;
          if (d.fireCd <= 0) {
            d.fireCd = 0.14;
            const from = new THREE.Vector3(d.pos.x, d.pos.y + 0.6, d.pos.z);
            const to = e.center;
            const r = this.world.raycast(from, to.clone().sub(from).normalize(), from.distanceTo(to), (b) => b.tag === 'sidewalk');
            if (!r || r.distance > from.distanceTo(to) - 0.2) {
              this.enemies.damage(e, d.dmg, to, new THREE.Vector3().subVectors(to, from).normalize(), false, 'turret');
              this.effects.tracer(from, to, [0.4, 1, 0.6], 0.05);
              this.effects.spawnParticle(to.x, to.y, to.z, 0, 0, 0, 0.4, 1, 0.6, 0.12, 0.1, 0, 3);
            }
          }
        }
      } else if (d.kind === 'drone') {
        d.angle += dt * 0.7;
        const tx = player.pos.x + Math.cos(d.angle) * 4;
        const tz = player.pos.z + Math.sin(d.angle) * 4;
        d.pos.x += (tx - d.pos.x) * Math.min(1, dt * 2.5);
        d.pos.z += (tz - d.pos.z) * Math.min(1, dt * 2.5);
        d.pos.y += ((this.world.groundHeight(d.pos.x, d.pos.z) + d.hover) - d.pos.y) * Math.min(1, dt * 2);
        d.mesh.position.copy(d.pos);
        d.mesh.children.forEach(c => { if (c.name === 'rotor') c.rotation.y += dt * 30; });
        const e = this._nearestEnemy(d.pos.x, d.pos.y, d.pos.z, d.range);
        if (e) {
          d.fireCd -= dt;
          if (d.fireCd <= 0) {
            d.fireCd = 0.22;
            const from = d.pos.clone();
            const to = e.center;
            this.enemies.damage(e, d.dmg, to, to.clone().sub(from).normalize(), false, 'drone');
            this.effects.tracer(from, to, [0.3, 0.9, 1], 0.05);
          }
        }
      } else if (d.kind === 'mine') {
        d.arm -= dt;
        if (d.led) { const p = 0.5 + 0.5 * Math.sin(performance.now() * 0.01); d.led.material.color.setRGB(1, p * 0.3, 0); if (d.light) d.light.intensity = 1 + p * 2; }
        if (d.arm <= 0) {
          const e = this._nearestEnemy(d.pos.x, d.pos.y + 0.3, d.pos.z, 3.2);
          if (e) {
            this._explode(d.pos, 6.0, 130);
            this._destroy(d); this.list.splice(i, 1); continue;
          }
        }
      } else if (d.kind === 'barrier') {
        // pulse the frame
        d.mesh.children.forEach(c => { if (c.material && c.material.emissiveIntensity != null) c.material.emissiveIntensity = 1.0 + Math.sin(performance.now() * 0.006) * 0.5; });
      } else if (d.kind === 'decoy') {
        d.pulse -= dt;
        if (d.pulse <= 0) {
          d.pulse = 0.5;
          for (const e of this.enemies.list) {
            if (!e.alive || e.ghost) continue;
            if (Math.hypot(e.pos.x - d.pos.x, e.pos.z - d.pos.z) < 40) {
              if (e.state === 'patrol') { e.state = 'investigate'; e.investigate = d.pos.clone(); e.behaviorTimer = 0; }
              else if (e.state === 'combat' && Math.random() < 0.3) { e.investigate = d.pos.clone(); }
            }
          }
        }
        d.mesh.rotation.y += dt * 1.5;
      }
    }
  }

  _explode(pos, radius, dmg) {
    this.effects.explosion(pos.clone().setY(pos.y + 0.4), 1.1);
    if (this.audio) this.audio.explosion(1.0);
    for (const e of this.enemies.list) {
      if (!e.alive || e.ghost) continue;
      const d = e.center.distanceTo(pos);
      if (d < radius) {
        const f = 1 - d / radius;
        this.enemies.damage(e, dmg * f, e.center, new THREE.Vector3(0, 1, 0), false, 'mine');
        e.applyStatus('burn', 3, 1);
      }
    }
  }
}
