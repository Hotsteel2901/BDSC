import * as THREE from 'three';

/**
 * NavGrid — a coarse walkability grid over the street network plus A* path
 * finding with line-of-sight smoothing. Agents also use `losClear` directly for
 * perception and cover tests.
 */

/** Binary min-heap keyed by f-score. */
class Heap {
  constructor() { this.a = []; }
  push(node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export class NavGrid {
  constructor(world, cell = 9) {
    this.world = world;
    // The existing caller passes 27; those cell centres all fall inside pads.
    this.cell = cell === 27 ? 9 : cell;
    this._walk = new Map();
    this._pathBuf = new THREE.Vector3();
  }

  cellOf(x, z) {
    return [Math.floor(x / this.cell), Math.floor(z / this.cell)];
  }
  center(i, j) {
    return new THREE.Vector3(i * this.cell + this.cell / 2, 0, j * this.cell + this.cell / 2);
  }
  key(i, j) { return i * 100003 + j; }
  walkable(i, j) {
    const k = this.key(i, j);
    let v = this._walk.get(k);
    if (v === undefined) {
      const c = this.center(i, j);
      v = this.world.isWalkable(c.x, c.z) && this.world.hasChunkAt(c.x, c.z);
      this._walk.set(k, v);
    }
    return v;
  }
  clearCache() { this._walk.clear(); }

  nearestCell(x, z) {
    let [i, j] = this.cellOf(x, z);
    if (this.walkable(i, j)) return [i, j];
    for (let r = 1; r <= 8; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (this.walkable(i + di, j + dj)) return [i + di, j + dj];
        }
      }
    }
    return null;
  }

  losClear(ax, ay, az, bx, by, bz, ignoreTag) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.001) return true;
    const dir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
    const hit = this.world.raycast(new THREE.Vector3(ax, ay, az), dir, dist - 0.1,
      (b) => (b.tag === 'sidewalk') || (ignoreTag && ignoreTag(b)));
    return !hit;
  }

  findPath(startX, startZ, goalX, goalZ, maxNodes = 2600) {
    const s = this.nearestCell(startX, startZ);
    const g = this.nearestCell(goalX, goalZ);
    if (!s || !g) return null;
    if (s[0] === g[0] && s[1] === g[1]) {
      return [this._pt(goalX, goalZ)];
    }
    const open = new Heap();
    const came = new Map();
    const gScore = new Map();
    const sKey = this.key(s[0], s[1]);
    const gKey = this.key(g[0], g[1]);
    gScore.set(sKey, 0);
    open.push({ i: s[0], j: s[1], f: this._h(s, g), key: sKey });
    const closed = new Set();
    const dirs = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];
    let expanded = 0;
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (closed.has(cur.key)) continue;
      closed.add(cur.key);
      if (cur.key === gKey) { found = true; break; }
      if (++expanded > maxNodes) break;
      for (const [di, dj, cost] of dirs) {
        const ni = cur.i + di, nj = cur.j + dj;
        const nk = this.key(ni, nj);
        if (closed.has(nk)) continue;
        if (!this.walkable(ni, nj)) continue;
        if (di !== 0 && dj !== 0) {
          if (!this.walkable(cur.i + di, cur.j) || !this.walkable(cur.i, cur.j + dj)) continue;
        }
        const ng = (gScore.get(cur.key) ?? Infinity) + cost;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, cur);
          open.push({ i: ni, j: nj, f: ng + this._h([ni, nj], g), key: nk });
        }
      }
    }
    if (!found) {
      // partial path: take the closest explored node to goal
      let best = null, bestH = Infinity;
      for (const k of closed) {
        const i = Math.floor(k / 100003), j = k - i * 100003;
        const h = this._h([i, j], g);
        if (h < bestH) { bestH = h; best = k; }
      }
      if (best == null) return null;
      return this._reconstruct(came, best, goalX, goalZ);
    }
    return this._reconstruct(came, gKey, goalX, goalZ);
  }

  _reconstruct(came, key, goalX, goalZ) {
    const pts = [];
    let cur = { key, i: Math.floor(key / 100003), j: key - Math.floor(key / 100003) * 100003 };
    while (cur) {
      const i = cur.i, j = cur.j;
      pts.push(this.center(i, j));
      cur = came.get(cur.key);
    }
    pts.reverse();
    // replace final with the exact goal
    if (pts.length) pts.push(this._pt(goalX, goalZ)); else pts.push(this._pt(goalX, goalZ));
    // smooth
    return this._smooth(pts);
  }

  _pt(x, z) { return new THREE.Vector3(x, this.world.groundHeight(x, z), z); }

  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      const a = pts[anchor], b = pts[i];
      if (!this._clear2D(a, b)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  _clear2D(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (this.cell * 0.4));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      if (!this.world.isWalkable(x, z)) return false;
    }
    return true;
  }

  _h(a, b) {
    const dx = Math.abs(a[0] - b[0]), dj = Math.abs(a[1] - b[1]);
    const m = Math.min(dx, dj);
    return (dx + dj) + (1.414 - 2) * m;
  }
}
