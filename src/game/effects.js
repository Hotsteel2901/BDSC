import * as THREE from 'three';

/**
 * Effects — GPU-friendly particle system (sparks, dust, blood, smoke, debris),
 * tracer lines, impact decals, explosion rings and dynamic flash lights.
 * All pooled; no allocation during play.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.maxParticles = 6000;
    this.count = 0;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.maxParticles * 3);
    this.col = new Float32Array(this.maxParticles * 3);
    this.size = new Float32Array(this.maxParticles);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vColor * a, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // particle data (structure of arrays)
    this.pv = new Float32Array(this.maxParticles * 3); // velocity
    this.life = new Float32Array(this.maxParticles);
    this.maxLife = new Float32Array(this.maxParticles);
    this.baseCol = new Float32Array(this.maxParticles * 3);
    this.grav = new Float32Array(this.maxParticles);
    this.baseSize = new Float32Array(this.maxParticles);
    this.drag = new Float32Array(this.maxParticles);
    this.next = 0;

    // tracers
    this.maxTracers = 400;
    this.tgeo = new THREE.BufferGeometry();
    this.tpos = new Float32Array(this.maxTracers * 2 * 3);
    this.tcol = new Float32Array(this.maxTracers * 2 * 3);
    this.tgeo.setAttribute('position', new THREE.BufferAttribute(this.tpos, 3));
    this.tgeo.setAttribute('color', new THREE.BufferAttribute(this.tcol, 3));
    this.tgeo.setDrawRange(0, 0);
    this.tline = new THREE.LineSegments(this.tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tline.frustumCulled = false;
    scene.add(this.tline);
    this.tlife = new Float32Array(this.maxTracers);
    this.tmax = new Float32Array(this.maxTracers);
    this.tbase = new Float32Array(this.maxTracers * 3);
    this.tNext = 0;

    // decals
    this.maxDecals = 96;
    this.decals = [];
    const decalCanvas = makeDecalTexture();
    const decalMat = new THREE.MeshBasicMaterial({ map: decalCanvas, transparent: true, depthWrite: false, opacity: 0.9 });
    for (let i = 0; i < this.maxDecals; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), decalMat.clone());
      m.visible = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.decalNext = 0;

    // expanding shock rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.4, 0.6, 24);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, speed: 1 });
    }
    this.ringNext = 0;

    // flash lights pool
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 30, 2);
      l.visible = false;
      scene.add(l);
      this.flashes.push({ light: l, life: 0, max: 1, intensity: 1 });
    }
    this.flashNext = 0;

    // gib chunks — solid debris flung on a violent kill (reads strongly in ASCII)
    this.maxChunks = 96;
    this.chunks = [];
    const chunkGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < this.maxChunks; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x000000, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(chunkGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.chunks.push({ mesh, mat, life: 0, max: 1, vel: new THREE.Vector3(), spin: new THREE.Vector3(), grav: -20, size: 0.12 });
    }
    this.chunkNext = 0;
  }

  /**
   * Violent death burst: flings solid debris chunks plus a particle explosion,
   * shock ring and flash. `dir` biases the spray (e.g. the shot/knife direction).
   */
  gib(point, dir, opts = {}) {
    const accent = new THREE.Color(opts.accent != null ? opts.accent : 0xff5533);
    const blood = !!opts.blood;
    const scale = opts.scale || 1;
    const n = opts.chunks || (blood ? 16 : 14);
    const d = dir || new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const c = this.chunks[this.chunkNext];
      this.chunkNext = (this.chunkNext + 1) % this.maxChunks;
      c.mesh.visible = true;
      c.mesh.position.copy(point).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.5));
      c.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.size = (0.055 + Math.random() * 0.14) * scale;
      c.mesh.scale.setScalar(c.size);
      const sp = (2.5 + Math.random() * 5.5) * scale;
      c.vel.set(
        d.x * sp * (0.35 + Math.random()) + (Math.random() - 0.5) * sp * 1.5,
        d.y * sp * 0.8 + Math.random() * sp * 1.1,
        d.z * sp * (0.35 + Math.random()) + (Math.random() - 0.5) * sp * 1.5
      );
      c.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      c.grav = -20;
      c.life = c.max = 0.8 + Math.random() * 0.7;
      if (blood) {
        c.mat.color.setRGB(0.42 + Math.random() * 0.25, 0.05, 0.07);
        c.mat.emissive.setRGB(0.16, 0.0, 0.0);
        c.mat.emissiveIntensity = 0.5;
      } else {
        c.mat.color.setRGB(accent.r * 0.5 + 0.1, accent.g * 0.5 + 0.1, accent.b * 0.5 + 0.1);
        c.mat.emissive.copy(accent);
        c.mat.emissiveIntensity = 1.3;
      }
      c.mat.opacity = 1;
    }
    this.burst(point, d, blood ? 'blood' : 'explosion', Math.round(26 * scale), 1.1 * scale, false);
    this.shockRing(point, blood ? 0xff4466 : 0x66ddff, 0.45, 22 * scale);
    this.flash(point, blood ? 0xff5577 : 0xffcc66, 5 * scale, 0.22);
  }

  spawnParticle(x, y, z, vx, vy, vz, r, g, b, size, life, gravity = -9, drag = 1.5) {
    const i = this.next;
    this.next = (this.next + 1) % this.maxParticles;
    if (this.count < this.maxParticles) this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.pv[i3] = vx; this.pv[i3 + 1] = vy; this.pv[i3 + 2] = vz;
    this.baseCol[i3] = r; this.baseCol[i3 + 1] = g; this.baseCol[i3 + 2] = b;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.baseSize[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag;
  }

  burst(point, normal, kind = 'concrete', count = 14, power = 1, dust = true) {
    const dir = normal || new THREE.Vector3(0, 1, 0);
    const palettes = {
      concrete: [0.7, 0.7, 0.68],
      metal: [0.9, 0.92, 1.0],
      glass: [0.6, 0.85, 1.0],
      wood: [0.7, 0.5, 0.3],
      flesh: [0.9, 0.12, 0.14],
      blood: [0.8, 0.05, 0.08],
      dirt: [0.5, 0.4, 0.3],
      shield: [0.4, 0.9, 1.0],
      energy: [0.4, 0.9, 1.0],
      explosion: [1.0, 0.6, 0.2],
    };
    const p = palettes[kind] || palettes.concrete;
    for (let i = 0; i < count; i++) {
      const sp = (1.5 + Math.random() * 4) * power;
      const vx = dir.x * sp * (0.4 + Math.random()) + (Math.random() - 0.5) * sp;
      const vy = dir.y * sp * (0.4 + Math.random()) + Math.random() * sp * 0.8;
      const vz = dir.z * sp * (0.4 + Math.random()) + (Math.random() - 0.5) * sp;
      const jitter = 0.6 + Math.random() * 0.6;
      this.spawnParticle(
        point.x + (Math.random() - 0.5) * 0.2, point.y + (Math.random() - 0.5) * 0.2, point.z + (Math.random() - 0.5) * 0.2,
        vx, vy, vz,
        p[0] * jitter, p[1] * jitter, p[2] * jitter,
        (0.05 + Math.random() * 0.09) * power,
        0.3 + Math.random() * 0.5,
        kind === 'flesh' || kind === 'blood' ? -14 : -9,
        1.2
      );
    }
    // dust puff
    if (dust) for (let i = 0; i < count * 0.4; i++) {
      this.spawnParticle(point.x, point.y, point.z,
        (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5,
        0.35, 0.35, 0.36, 0.2 + Math.random() * 0.2, 0.6 + Math.random() * 0.6, 0.2, 0.6);
    }
  }

  tracer(from, to, color = [1.0, 0.85, 0.4], life = 0.09) {
    const i = this.tNext;
    this.tNext = (this.tNext + 1) % this.maxTracers;
    const o = i * 6;
    this.tpos[o] = from.x; this.tpos[o + 1] = from.y; this.tpos[o + 2] = from.z;
    this.tpos[o + 3] = to.x; this.tpos[o + 4] = to.y; this.tpos[o + 5] = to.z;
    for (let k = 0; k < 2; k++) {
      this.tcol[o + k * 3] = color[0];
      this.tcol[o + k * 3 + 1] = color[1];
      this.tcol[o + k * 3 + 2] = color[2];
    }
    this.tbase[o] = color[0]; this.tbase[o + 1] = color[1]; this.tbase[o + 2] = color[2];
    this.tbase[o + 3] = color[0]; this.tbase[o + 4] = color[1]; this.tbase[o + 5] = color[2];
    this.tlife[i] = life; this.tmax[i] = life;
    this.tgeo.setDrawRange(0, this.maxTracers * 2);
  }

  decal(point, normal, size = 0.35) {
    const d = this.decals[this.decalNext];
    this.decalNext = (this.decalNext + 1) % this.maxDecals;
    const m = d.mesh;
    m.visible = true;
    m.position.copy(point).addScaledVector(normal, 0.02);
    const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const mtx = new THREE.Matrix4();
    const lookM = new THREE.Matrix4().lookAt(new THREE.Vector3(), normal.clone().negate(), up);
    mtx.makeRotationFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(lookM));
    mtx.scale(new THREE.Vector3(size, size, size));
    mtx.setPosition(m.position);
    m.matrix.copy(mtx);
    m.matrixWorld.copy(mtx);
    d.life = 14;
    m.material.opacity = 0.9;
  }

  shockRing(point, color = 0xffaa55, max = 1.0, speed = 18) {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % this.rings.length;
    r.mesh.visible = true;
    r.mesh.position.copy(point);
    r.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    r.mesh.material.color.setHex(color);
    r.mesh.scale.setScalar(0.2);
    r.life = max; r.max = max; r.speed = speed;
  }

  flash(point, color = 0xffaa55, intensity = 8, life = 0.25) {
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % this.flashes.length;
    f.light.visible = true;
    f.light.position.copy(point);
    f.light.color.setHex(color);
    f.light.intensity = intensity;
    f.intensity = intensity;
    f.life = life; f.max = life;
  }

  explosion(point, scale = 1) {
    this.burst(point, new THREE.Vector3(0, 1, 0), 'explosion', 46 * scale, 1.6 * scale);
    // fireball particles
    for (let i = 0; i < 30; i++) {
      const sp = 4 + Math.random() * 10 * scale;
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      this.spawnParticle(point.x, point.y, point.z,
        Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.7, Math.sin(ph) * Math.sin(th) * sp,
        1.0, 0.45 + Math.random() * 0.3, 0.1,
        0.4 + Math.random() * 0.5 * scale, 0.4 + Math.random() * 0.5, -2, 1.4);
    }
    // smoke
    for (let i = 0; i < 24; i++) {
      this.spawnParticle(point.x, point.y + 0.5, point.z,
        (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3,
        0.2, 0.2, 0.2, 0.6 + Math.random() * 0.6, 1.2 + Math.random(), 0.6, 0.7);
    }
    this.shockRing(point, 0xffcc66, 0.6, 26 * scale);
    this.flash(point, 0xff8844, 9 * scale, 0.35);
  }

  update(dt) {
    // particles
    let active = 0;
    const n = this.maxParticles;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.pv[i3] *= d; this.pv[i3 + 2] *= d;
      this.pv[i3 + 1] = this.pv[i3 + 1] * d + this.grav[i] * dt;
      this.pos[i3] += this.pv[i3] * dt;
      this.pos[i3 + 1] += this.pv[i3 + 1] * dt;
      this.pos[i3 + 2] += this.pv[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i3] = this.baseCol[i3] * t;
      this.col[i3 + 1] = this.baseCol[i3 + 1] * t;
      this.col[i3 + 2] = this.baseCol[i3 + 2] * t;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
      active++;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;

    // tracers
    let tActive = 0;
    for (let i = 0; i < this.maxTracers; i++) {
      if (this.tlife[i] > 0) {
        this.tlife[i] -= dt;
        const t = Math.max(0, this.tlife[i] / this.tmax[i]);
        const o = i * 6;
        for (let k = 0; k < 6; k++) this.tcol[o + k] = this.tbase[o + k] * t;
        tActive++;
      } else {
        const o = i * 6;
        for (let k = 0; k < 6; k++) this.tcol[o + k] = 0;
      }
    }
    this.tgeo.attributes.position.needsUpdate = true;
    this.tgeo.attributes.color.needsUpdate = true;

    // decals
    for (const d of this.decals) {
      if (d.life > 0) {
        d.life -= dt;
        if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.9;
        if (d.life <= 0) d.mesh.visible = false;
      }
    }

    // rings
    for (const r of this.rings) {
      if (r.life > 0) {
        r.life -= dt;
        const t = 1 - Math.max(0, r.life / r.max);
        r.mesh.scale.setScalar(0.2 + t * r.speed * 0.4);
        r.mesh.material.opacity = Math.max(0, 1 - t);
        if (r.life <= 0) r.mesh.visible = false;
      }
    }

    // flashes
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        const t = Math.max(0, f.life / f.max);
        f.light.intensity = f.intensity * t * t;
        if (f.life <= 0) f.light.visible = false;
      }
    }

    // gib chunks
    for (const c of this.chunks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vel.y += c.grav * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const t = c.life / c.max;
      c.mat.opacity = Math.min(1, t * 2.2);
      c.mesh.scale.setScalar(c.size * (0.45 + 0.55 * t));
    }
  }
}

function makeDecalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.5, 'rgba(20,10,10,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  // cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(32, 32);
    const a = Math.random() * Math.PI * 2;
    ctx.lineTo(32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
