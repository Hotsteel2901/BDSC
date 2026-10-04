import * as THREE from 'three';

/**
 * Procedural item model factory.
 *
 * Every item definition carries a `model` spec: a list of primitive parts with
 * shape, dimensions, transform, colour and material hints. This builds a real,
 * detailed 3D model for each item with zero external assets. Materials are
 * cached by their parameter signature so dozens of items stay cheap.
 */

const matCache = new Map();
function getMaterial(color, emissive, metal, rough, opacity) {
  const key = `${color}|${emissive}|${metal}|${rough}|${opacity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: emissive || 0x000000,
      emissiveIntensity: emissive ? 1.5 : 0,
      metalness: metal,
      roughness: rough,
      transparent: opacity < 1,
      opacity,
      toneMapped: !emissive,
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map();
function getGeometry(part) {
  const s = part.s || 'box';
  const d = part.d || [1, 1, 1];
  const key = s + ':' + d.join(',');
  let g = geoCache.get(key);
  if (g) return g;
  switch (s) {
    case 'box': g = new THREE.BoxGeometry(d[0], d[1], d[2]); break;
    case 'cyl': g = new THREE.CylinderGeometry(d[0], d[1] ?? d[0], d[2], d[3] || 10); break;
    case 'sph': g = new THREE.SphereGeometry(d[0], 10, 8); break;
    case 'cone': g = new THREE.ConeGeometry(d[0], d[1], d[2] || 10); break;
    case 'torus': g = new THREE.TorusGeometry(d[0], d[1], 8, 16); break;
    case 'ico': g = new THREE.IcosahedronGeometry(d[0], 0); break;
    case 'caps': g = new THREE.CapsuleGeometry(d[0], d[1], 4, 8); break;
    case 'ring': g = new THREE.RingGeometry(d[0], d[1], d[2] || 16); break;
    case 'tetra': g = new THREE.TetrahedronGeometry(d[0]); break;
    case 'octa': g = new THREE.OctahedronGeometry(d[0]); break;
    case 'dodec': g = new THREE.DodecahedronGeometry(d[0]); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  geoCache.set(key, g);
  return g;
}

/**
 * Build a THREE.Group for an item definition.
 * opts.glow adds an emissive under-ring (world pickups).
 */
export function buildItemModel(def, opts = {}) {
  const g = new THREE.Group();
  const spec = def.model || { parts: [{ s: 'box', d: [0.4, 0.4, 0.4], c: 0x888888 }] };
  for (const part of spec.parts) {
    const mesh = new THREE.Mesh(
      getGeometry(part),
      getMaterial(part.c ?? 0x99a0aa, part.e ?? 0, part.m ?? 0.5, part.ro ?? 0.5, part.o ?? 1)
    );
    if (part.p) mesh.position.set(part.p[0], part.p[1], part.p[2]);
    if (part.r) mesh.rotation.set(part.r[0] || 0, part.r[1] || 0, part.r[2] || 0);
    mesh.frustumCulled = true;
    g.add(mesh);
  }
  if (spec.scale) g.scale.setScalar(spec.scale);
  if (opts.glow) {
    const col = def.rarityColor || 0x37ff8b;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.44, 20),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.28;
    ring.name = 'glowRing';
    g.add(ring);
  }
  def.__modelScale = spec.scale || 1;
  return g;
}

export function disposeItemModel(g) {
  // geometries + materials are shared via caches; only remove from parent.
  if (g.parent) g.parent.remove(g);
}
