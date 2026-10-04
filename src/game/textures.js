import * as THREE from 'three';

/**
 * Procedural texture library. Every surface is drawn to a canvas at runtime so
 * there are zero external assets. Textures are authored for *luminance* — the
 * ASCII shader reads brightness patterns, so window grids, brick courses, road
 * markings and panel seams all become visible character detail.
 */

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  return { c, ctx };
}

export function rngFactory(seed) {
  let s = seed >>> 0 || 1;
  return function rnd() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

let SRGB = THREE.SRGBColorSpace;
export function setSrgbSupported(v) { SRGB = v ? THREE.SRGBColorSpace : THREE.NoColorSpace; }

function texFrom(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = SRGB;
  t.needsUpdate = true;
  return t;
}

/* ---------------- FACADES ---------------- */
// Each facade tile is a 4x4 grid of windows/floors.
export function makeFacadeSet(size = 512, seed = 7) {
  const W = 4, H = 4; // windows per tile
  const cw = size / W, ch = size / H;
  const rnd = rngFactory(seed);

  // albedo
  const { c, ctx } = canvas(size);
  const base = 60 + rnd() * 40;
  ctx.fillStyle = `rgb(${base | 0},${(base * 1.02) | 0},${(base * 1.06) | 0})`;
  ctx.fillRect(0, 0, size, size);
  // subtle panel noise
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * 0.06;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }
  // window frames + glass
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const x = gx * cw, y = gy * ch;
      // spandrel (between floors)
      ctx.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.15})`;
      ctx.fillRect(x, y + ch * 0.68, cw, ch * 0.32);
      // frame
      ctx.fillStyle = `rgb(${(base + 30) | 0},${(base + 32) | 0},${(base + 36) | 0})`;
      ctx.fillRect(x + cw * 0.08, y + ch * 0.06, cw * 0.84, ch * 0.58);
      // glass
      const g = 55 + rnd() * 60;
      ctx.fillStyle = `rgb(${g | 0},${(g * 1.1) | 0},${(g * 1.25) | 0})`;
      ctx.fillRect(x + cw * 0.12, y + ch * 0.1, cw * 0.76, ch * 0.5);
      // mullion
      ctx.fillStyle = 'rgba(10,12,16,0.8)';
      ctx.fillRect(x + cw * 0.5 - 1, y + ch * 0.1, 2, ch * 0.5);
      ctx.fillRect(x + cw * 0.12, y + ch * 0.35, cw * 0.76, 1.5);
    }
  }
  const albedo = texFrom(c);

  // emissive (lit windows)
  const e = canvas(size);
  e.ctx.fillStyle = '#000';
  e.ctx.fillRect(0, 0, size, size);
  const tints = ['#ffd9a0', '#cfe6ff', '#fff2c8', '#a0d8ff', '#ffbc7a', '#d8f0ff'];  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      if (rnd() < 0.42) continue; // unlit
      const x = gx * cw, y = gy * ch;
      const tint = tints[(rnd() * tints.length) | 0];
      e.ctx.fillStyle = tint;
      e.ctx.globalAlpha = 0.35 + rnd() * 0.65;
      e.ctx.fillRect(x + cw * 0.12, y + ch * 0.1, cw * 0.76, ch * 0.5);
      // silhouettes in some windows
      if (rnd() < 0.22) {
        e.ctx.globalAlpha = 0.5;
        e.ctx.fillStyle = '#101820';
        e.ctx.fillRect(x + cw * (0.2 + rnd() * 0.3), y + ch * 0.28, cw * 0.14, ch * 0.32);
      }
      e.ctx.globalAlpha = 1;
    }
  }
  const emissive = texFrom(e.c, 1, true);
  return { albedo, emissive };
}

export function makeFacadeVariants(n = 6) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(makeFacadeSet(512, 101 + i * 37));
  return list;
}

/* ---------------- ROOFS ---------------- */
export function makeRoofTexture(size = 256, seed = 3) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(0, 0, size, size);
  // gravel
  for (let i = 0; i < 4000; i++) {
    const v = 20 + rnd() * 40;    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 4) | 0},0.5)`;
    ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
  // panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * size / 4, 0); ctx.lineTo(i * size / 4, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();
  }
  // vents
  for (let i = 0; i < 6; i++) {
    const x = rnd() * size, y = rnd() * size, w = 14 + rnd() * 26, h = 14 + rnd() * 26;
    ctx.fillStyle = '#2a2f36'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#0d0f12';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 3, y + 4 + k * (h / 5), w - 6, 2);
  }
  return texFrom(c);
}

/* ---------------- STREETS ---------------- */
export function makeStreetTexture(size = 512, seed = 5) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#30343a';
  ctx.fillRect(0, 0, size, size);
  // asphalt grain
  for (let i = 0; i < 12000; i++) {
    const v = 30 + rnd() * 40;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 3) | 0},0.35)`;
    ctx.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
  }
  // cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    let x = rnd() * size, y = rnd() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // crosswalk stripes (tile edges)
  ctx.fillStyle = 'rgba(200,200,190,0.55)';
  for (let i = 0; i < 6; i++) ctx.fillRect(10 + i * (size / 6.2), size * 0.42, size / 12, size * 0.16);
  // lane dashes down the middle
  ctx.fillStyle = 'rgba(220,200,90,0.6)';
  for (let i = 0; i < 6; i++) ctx.fillRect(size * 0.49, i * (size / 6) + 6, 4, size / 12);
  // manhole
  ctx.fillStyle = '#15171a';
  ctx.beginPath(); ctx.arc(size * 0.2, size * 0.75, 22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(90,95,100,0.6)';
  for (let r = 6; r < 22; r += 5) { ctx.beginPath(); ctx.arc(size * 0.2, size * 0.75, r, 0, Math.PI * 2); ctx.stroke(); }
  return texFrom(c);
}

/* ---------------- SIDEWALK ---------------- */
export function makeSidewalkTexture(size = 256, seed = 11) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3000; i++) {
    const v = 45 + rnd() * 30;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.3)`;
    ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * size / 2, 0); ctx.lineTo(i * size / 2, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * size / 2); ctx.lineTo(size, i * size / 2); ctx.stroke();
  }
  return texFrom(c);
}

/* ---------------- METAL / CONTAINER / CRATE ---------------- */
export function makeMetalTexture(size = 256, seed = 9) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#4a5058';
  ctx.fillRect(0, 0, size, size);
  // brushed streaks
  for (let i = 0; i < 400; i++) {
    const v = 60 + rnd() * 40;
    ctx.strokeStyle = `rgba(${v | 0},${v | 0},${(v + 6) | 0},0.3)`;
    ctx.beginPath(); const y = rnd() * size; ctx.moveTo(0, y); ctx.lineTo(size, y + (rnd() - 0.5) * 4); ctx.stroke();
  }
  // rivets
  for (let y = 12; y < size; y += 32) for (let x = 12; x < size; x += 32) {
    ctx.fillStyle = 'rgba(20,22,26,0.7)'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,170,180,0.5)'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // rust patches
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(120,60,30,${0.1 + rnd() * 0.2})`;
    ctx.beginPath(); ctx.arc(rnd() * size, rnd() * size, 6 + rnd() * 20, 0, Math.PI * 2); ctx.fill();
  }
  return texFrom(c);
}

export function makeCrateTexture(size = 256, seed = 21) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#6a4a2a';
  ctx.fillRect(0, 0, size, size);
  // planks
  for (let i = 0; i < 5; i++) {
    const v = 80 + rnd() * 40;
    ctx.fillStyle = `rgba(${v | 0},${(v * 0.7) | 0},${(v * 0.42) | 0},0.4)`;
    ctx.fillRect(0, i * size / 5 + 2, size, size / 5 - 4);
  }
  ctx.strokeStyle = 'rgba(30,20,10,0.9)'; ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(size - 4, size - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(size - 4, 4); ctx.lineTo(4, size - 4); ctx.stroke();
  // stencil
  ctx.fillStyle = 'rgba(255,190,60,0.55)';
  ctx.font = `bold ${Math.floor(size * 0.18)}px monospace`;
  ctx.fillText('BDSC-7', size * 0.14, size * 0.6);
  return texFrom(c);
}

/* ---------------- HOLO SIGN (emissive billboard) ---------------- */
export function makeSignTexture(text = 'BDSC', w = 512, h = 128, color = '#37ff8b', seed = 31) {
  const rnd = rngFactory(seed);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#04070a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.floor(h * 0.5)}px "Cascadia Mono", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = 18;
  ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = 0;
  // scan noise
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.08})`;
    ctx.fillRect(0, rnd() * h, w, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  t.needsUpdate = true;
  return t;
}

/* ---------------- INTERIOR WALL / FLOOR ---------------- */
export function makeInteriorWallTexture(size = 256, seed = 41) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#6b7178';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2500; i++) {
    const v = 90 + rnd() * 45;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v + 3) | 0},0.3)`;
    ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
  // wainscot
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, size * 0.7, size, size * 0.3);
  ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(0, size * 0.68, size, 3);
  return texFrom(c);
}

export function makeInteriorFloorTexture(size = 256, seed = 43) {
  const rnd = rngFactory(seed);
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#5c6169'; ctx.fillRect(0, 0, size, size);
  // tiles
  const n = 4, s = size / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 80 + rnd() * 40;
    ctx.fillStyle = `rgb(${v | 0},${v | 0},${(v + 2) | 0})`;
    ctx.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeRect(x * s, y * s, s, s);
  }
  return texFrom(c);
}

/* ---------------- SKY / STARFIELD ---------------- */
export function makeSkyTexture(size = 1024) {
  const rnd = rngFactory(99);
  const c = document.createElement('canvas');
  c.width = size; c.height = size / 2;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#050608');
  grad.addColorStop(0.45, '#0a1420');
  grad.addColorStop(0.72, '#14243a');
  grad.addColorStop(1, '#3a2a4a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, c.width, c.height);
  // stars
  for (let i = 0; i < 1500; i++) {
    const y = rnd() * c.height * 0.7;
    const a = (1 - y / (c.height * 0.7)) * rnd();
    ctx.fillStyle = `rgba(200,220,255,${a})`;
    ctx.fillRect(rnd() * c.width, y, 1.4, 1.4);
  }
  // nebula
  for (let i = 0; i < 26; i++) {
    const g = ctx.createRadialGradient(rnd() * c.width, rnd() * c.height * 0.5, 0, rnd() * c.width, rnd() * c.height * 0.5, 120 + rnd() * 240);
    const hue = 190 + rnd() * 140;
    g.addColorStop(0, `hsla(${hue},70%,60%,0.06)`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  }
  // skyline glow on horizon
  const g2 = ctx.createLinearGradient(0, c.height * 0.75, 0, c.height);
  g2.addColorStop(0, 'rgba(255,120,60,0)');
  g2.addColorStop(1, 'rgba(255,120,60,0.25)');
  ctx.fillStyle = g2; ctx.fillRect(0, c.height * 0.75, c.width, c.height * 0.25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}

/* ---------------- DECAL: hazard, arrows ---------------- */
export function makeHazardTexture(size = 256, seed = 51) {
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#e0b000';
  const bw = size / 6;
  for (let i = -6; i < 12; i++) {
    ctx.save(); ctx.translate(i * bw, 0); ctx.transform(1, 0, -1, 1, 0, 0);
    ctx.fillRect(0, 0, bw / 2, size); ctx.restore();
  }
  return texFrom(c);
}
