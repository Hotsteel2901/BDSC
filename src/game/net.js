import mqtt from 'mqtt';

/**
 * Net — co-op multiplayer over a *public* MQTT relay (no server to deploy).
 * Default broker is a public MQTT-over-WebSocket endpoint; several are tried in
 * order so it works anywhere with internet access.
 *
 * Model: the room creator is the authoritative HOST. The host runs all enemy AI
 * and broadcasts compact enemy snapshots; every peer broadcasts its own player
 * transform and shot events; clients report hits, the host applies damage.
 */

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const PREFIX = 'bdsc/gr1dfall/v1/';

function resolveBrokers() {
  const list = [];
  try {
    const params = new URLSearchParams(location.search);
    const custom = params.get('broker') || localStorage.getItem('bdsc_broker');
    if (custom) list.push(custom);
  } catch (e) { /* ignore */ }
  return list.concat(BROKERS);
}

export class Net {
  constructor() {
    this.client = null;
    this.room = null;
    this.id = Math.random().toString(36).slice(2, 8);
    this.name = 'OPERATIVE-' + this.id.slice(0, 3).toUpperCase();
    this.enabled = false;
    this.isHost = false;
    this.connected = false;
    this.players = new Map(); // id -> {id,name,color,pos,yaw,pitch,hp,weapon,lastSeen,mesh}
    this.broker = null;
    this.handlers = {};
    this.sendRate = 1 / 18;
    this._sendAcc = 0;
    this._snapRate = 1 / 9;
    this._snapAcc = 0;
    this.ping = 0;
    this._pingTime = 0;
    this._pingTimer = 0;
    this.lastError = null;
    this._order = [];
    this.brokers = resolveBrokers();
  }

  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); }
  emit(event, ...args) { const h = this.handlers[event]; if (h) for (const f of h) f(...args); }

  _connectBroker(index, room, opts) {
    return new Promise((resolve, reject) => {
      const brokers = this.brokers;
      if (index >= brokers.length) { reject(new Error('all brokers failed')); return; }
      const url = brokers[index];
      let settled = false;
      const client = mqtt.connect(url, {
        clientId: 'bdsc_' + this.id + '_' + Math.random().toString(16).slice(2, 6),
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 8000,
        keepalive: 30,
        protocolVersion: 4,
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { client.end(true); } catch (e) {}
        this._connectBroker(index + 1, room, opts).then(resolve).catch(reject);
      }, 9000);
      client.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ client, url });
      });
      client.on('error', (err) => {
        this.lastError = String(err && err.message || err);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { client.end(true); } catch (e) {}
          this._connectBroker(index + 1, room, opts).then(resolve).catch(reject);
        }
      });
    });
  }

  async join(room, name, opts = {}) {
    this.room = (room || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
    if (name) this.name = name.slice(0, 16);
    this.isHost = !!opts.host;
    const { client, url } = await this._connectBroker(0, this.room, opts);
    this.client = client;
    this.broker = url;
    this.connected = true;
    this.enabled = true;

    const base = PREFIX + this.room + '/';
    this.topic = base;
    client.subscribe(base + '#', { qos: 0 }, () => {});

    client.on('message', (topic, payload) => {
      let msg;
      try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
      if (!msg || msg.from === this.id) return;
      this._handle(topic, msg);
    });
    client.on('close', () => { this.connected = false; this.emit('disconnected'); });
    client.on('reconnect', () => {});
    client.on('connect', () => {
      this.connected = true;
      if (this.client) this.client.subscribe(base + '#', { qos: 0 }, () => {});
      this.emit('reconnected');
    });

    // announce
    this.publish('join', { name: this.name, host: this.isHost, color: this._color() });
    // request state from others
    this.publish('who', {});
    this._pingTimer = setInterval(() => { this._pingTime = performance.now(); this.publish('ping', {}); }, 2000);
    return { broker: url, room: this.room, id: this.id };
  }

  _color() {
    const h = (parseInt(this.id, 36) % 360) / 360;
    return hslToRgb(h, 0.65, 0.55);
  }

  leave() {
    if (!this.client) return;
    try { this.publish('leave', { name: this.name }); } catch (e) {}
    if (this._pingTimer) clearInterval(this._pingTimer);
    try { this.client.end(true); } catch (e) {}
    this.client = null;
    this.connected = false;
    this.enabled = false;
    this.players.clear();
  }

  publish(type, data) {
    if (!this.client || !this.client.connected) return;
    const msg = { from: this.id, name: this.name, t: Date.now(), ...data };
    this.client.publish(PREFIX + this.room + '/' + type, JSON.stringify(msg), { qos: 0 });
  }

  // ---- outgoing --------------------------------------------------------
  sendPlayerState(p) {
    this.publish('p', {
      name: this.name,
      x: round2(p.pos.x), y: round2(p.pos.y), z: round2(p.pos.z),
      yaw: round2(p.yaw), pitch: round2(p.pitch),
      hp: Math.round(p.health), ar: Math.round(p.armor),
      w: p.weaponId || 'rifle', st: p.crouching ? 1 : 0, al: p.alive ? 1 : 0,
      host: this.isHost,
    });
  }
  sendShot(origin, dir, projectile) {
    this.publish('shot', { x: round2(origin.x), y: round2(origin.y), z: round2(origin.z), dx: round2(dir.x), dy: round2(dir.y), dz: round2(dir.z), p: projectile || 0 });
  }
  sendEnemyShot(from, to) {
    this.publish('eshot', { x: round2(from.x), y: round2(from.y), z: round2(from.z), tx: round2(to.x), ty: round2(to.y), tz: round2(to.z) });
  }
  sendHit(enemyId, dmg, head, point) {
    this.publish('hit', { e: enemyId, d: Math.round(dmg), h: head ? 1 : 0, x: round2(point.x), y: round2(point.y), z: round2(point.z) });
  }
  sendSnapshot(list) {
    if (!this.isHost) return;
    const arr = list.map(e => ({
      i: e.id, t: e.typeKey, x: round2(e.pos.x), y: round2(e.pos.y), z: round2(e.pos.z),
      yaw: round2(e.yaw), hp: Math.round(e.health), d: e.alive ? 0 : 1,
    }));
    this.publish('snap', { e: arr });
  }
  sendDamage(targetId, amount, head) {
    this.publish('dmg', { to: targetId, a: Math.round(amount), h: head ? 1 : 0 });
  }
  sendKill(enemyType, killerName, head) {
    this.publish('kill', { et: enemyType, k: killerName, h: head ? 1 : 0 });
  }
  sendChat(text) { this.publish('chat', { m: text.slice(0, 200) }); }
  sendObjective(text) { this.publish('obj', { m: text.slice(0, 120) }); }

  // ---- incoming --------------------------------------------------------
  _handle(topic, msg) {
    const type = topic.slice(this.topic.length);
    switch (type) {
      case 'join': {
        this.emit('join', msg);
        this.publish('welcome', { to: msg.from, name: this.name, host: this.isHost });
        break;
      }
      case 'welcome': {
        this.emit('welcome', msg);
        break;
      }
      case 'who': {
        this.publish('here', { name: this.name, host: this.isHost });
        this._lastState && this.sendPlayerState(this._lastState);
        break;
      }
      case 'here': this.emit('here', msg); break;
      case 'leave': {
        this.players.delete(msg.from);
        this.emit('playerLeave', msg);
        break;
      }
      case 'p': {
        let p = this.players.get(msg.from);
        if (!p) {
          p = { id: msg.from, name: msg.name, color: msg.color || hslToRgb((parseInt(msg.from, 36) % 360) / 360, 0.65, 0.55), mesh: null };
          this.players.set(msg.from, p);
          this.emit('playerJoin', p);
        }
        p.name = msg.name || p.name;
        p.pos = p.pos || { x: 0, y: 0, z: 0 };
        // smooth interpolation targets
        p.tx = msg.x; p.ty = msg.y; p.tz = msg.z;
        if (p.pos.x === undefined) { p.pos.x = msg.x; p.pos.y = msg.y; p.pos.z = msg.z; }
        p.yaw = msg.yaw; p.pitch = msg.pitch;
        p.hp = msg.hp; p.armor = msg.ar; p.weapon = msg.w; p.crouch = msg.st; p.alive = msg.al;
        p.host = msg.host;
        p.lastSeen = performance.now();
        break;
      }
      case 'shot': this.emit('shot', msg); break;
      case 'eshot': this.emit('enemyShot', msg); break;
      case 'snap': this.emit('snapshot', msg.e || []); break;
      case 'hit': this.emit('hitReport', msg); break;
      case 'dmg': if (msg.to === this.id) this.emit('takeDamage', msg); break;
      case 'kill': this.emit('killFeed', msg); break;
      case 'chat': this.emit('chat', msg); break;
      case 'obj': this.emit('objective', msg); break;
      case 'ping': this.publish('pong', { to: msg.from }); break;
      case 'pong': if (msg.to === this.id) this.ping = Math.round(performance.now() - this._pingTime); break;
    }
  }

  update(dt, player, enemyManager, game) {
    if (!this.enabled) return;
    this._lastState = player;
    this._sendAcc += dt;
    if (this._sendAcc >= this.sendRate) {
      this._sendAcc = 0;
      this.sendPlayerState({
        pos: player.pos, yaw: player.yaw, pitch: player.pitch,
        health: player.health, armor: player.armor,
        weaponId: game && game.weaponSystem ? game.weaponSystem.def.id : 'rifle',
        crouching: player.crouching, alive: player.alive,
      });
    }
    if (this.isHost && enemyManager) {
      this._snapAcc += dt;
      if (this._snapAcc >= this._snapRate) {
        this._snapAcc = 0;
        this.sendSnapshot(enemyManager.list);
      }
    }
    // interpolate remote players
    const now = performance.now();
    for (const [id, p] of this.players) {
      if (p.tx !== undefined) {
        p.pos.x += (p.tx - p.pos.x) * Math.min(1, dt * 12);
        p.pos.y += (p.ty - p.pos.y) * Math.min(1, dt * 12);
        p.pos.z += (p.tz - p.pos.z) * Math.min(1, dt * 12);
      }
      if (now - p.lastSeen > 15000) { this.players.delete(id); this.emit('playerLeave', { from: id, name: p.name }); }
    }
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r, g, b];
}
