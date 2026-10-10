import { TRACKS } from '../music/dnb.js';
import { ITEMS, ITEMS_BY_ID } from '../game/items/registry.js';
import { BRANCHES, TREE, MAX_WEAPON_LEVEL } from '../game/progression.js';
import { RECIPES, canCraft } from '../game/crafting.js';
import { ammoDef } from '../game/ammo.js';
import { t, LANGS, getLang } from './i18n.js';
import { statusName, buffName, slotName, grenadeName, revealName } from './localize.js';

const ASCII_LOGO = String.raw`
   ██████╗ ██████╗ ███████╗ ██████╗    ██████╗ ██████╗ ██╗██████╗ ███████╗ █████╗ ██╗     ██╗
   ██╔══██╗██╔══██╗██╔════╝██╔════╝   ██╔════╝ ██╔══██╗██║██╔══██╗██╔════╝██╔══██╗██║     ██║
   ██████╔╝██║  ██║███████╗██║        ██║  ███╗██████╔╝██║██║  ██║█████╗  ███████║██║     ██║
   ██╔══██╗██║  ██║╚════██║██║        ██║   ██║██╔══██╗██║██║  ██║██╔══╝  ██╔══██║██║     ██║
   ██████╔╝██████╔╝███████║╚██████╗   ╚██████╔╝██║  ██║██║██████╔╝██║     ██║  ██║███████╗███████╗
   ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝ ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝
`;

/**
 * HUD — all DOM UI: main menu, settings, live HUD, minimap, killfeed, toasts,
 * pause and death screens. Communicates with the game via callbacks supplied
 * by `bind()`.
 */
export class HUD {
  constructor(root) {
    this.root = root;
    this.cb = {};
    this._build();
    this._lastToast = '';
    this._lastKill = '';
    this.el = {
      menu: document.getElementById('menu'),
      hud: document.getElementById('hud'),
    };
  }

  bind(cb) { this.cb = cb; }

  _build() {
    const root = this.root;
    // ---- HUD layer ----
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div id="scope"><div class="lens"><div class="ticks-v"></div><div class="ticks-h"></div><div class="dot"></div></div></div>
      <div class="hud-tl" id="hud-tl"></div>
      <div class="hud-tr" id="hud-tr"></div>
      <div class="hud-bl" id="hud-bl"></div>
      <div class="hud-bc" id="hud-bc"></div>
      <div class="hud-br" id="hud-br"></div>
      <div id="crosshair">+</div>
      <div id="hitmark">✕</div>
      <div id="dmgflash"></div>
      <div id="toast"></div>
      <div id="killfeed"></div>
      <div id="objective"></div>
      <div id="netstat"></div>
      <div id="quickbar"></div>
      <div id="statuschips"></div>
      <canvas id="minimap" width="180" height="180"></canvas>
      <div id="pause"><div class="panel"><h2 style="letter-spacing:6px;color:var(--accent)" data-i18n="pause.title">PAUSED</h2>
        <div class="hint" style="margin:12px 0" data-i18n="pause.hint">Click RESUME to re-capture the mouse.</div>
        <div class="row"><button id="btn-resume" data-i18n="pause.resume">RESUME</button><button class="ghost" id="btn-arsenal" data-i18n="pause.arsenal">ARSENAL / UPGRADES</button><button class="ghost" id="btn-quit" data-i18n="pause.quit">QUIT TO MENU</button></div>
      </div></div>
      <div id="dead"><div class="panel" style="width:min(560px,92vw)">
        <h2 style="letter-spacing:8px;color:var(--accent2)" data-i18n="dead.title">SIGNAL LOST</h2>
        <div id="dead-stats" class="hint" style="margin:14px 0;font-size:13px"></div>
        <div class="row"><button id="btn-respawn" data-i18n="dead.redeploy">REDEPLOY</button><button class="ghost" id="btn-quit2" data-i18n="dead.quit">QUIT TO MENU</button></div>
      </div></div>
    `;
    root.appendChild(hud);
    this.hud = hud;

    // ---- inventory overlay ----
    const inv = document.createElement('div');
    inv.id = 'inv';
    inv.className = 'overlay';
    inv.innerHTML = `<div class="win panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 data-i18n="inv.title">INVENTORY</h2>
        <div class="hint2"><span data-i18n="inv.weight">WEIGHT</span> <b id="inv-weight">0</b> / <span id="inv-maxw">180</span> · <span data-i18n="inv.scrap">SCRAP</span> <b id="inv-scrap" style="color:var(--warn)">0</b></div>
      </div>
      <div class="tabs"><div class="tab active" data-t="items" data-i18n="inv.tab.items">ITEMS</div><div class="tab" data-t="craft" data-i18n="inv.tab.craft">CRAFT</div><div class="tab" data-t="guide" data-i18n="inv.tab.guide">ITEM GUIDE</div></div>
      <div id="inv-grid" class="inv-grid"></div>
      <div id="inv-craft" style="display:none"></div>
      <div id="inv-guide" style="display:none"></div>
      <div class="hint2" data-i18n-html="inv.hint">LEFT-CLICK a consumable to USE it · an AMMO box to LOAD that ammo · an ATTACHMENT to FIT it to your current weapon · a MATERIAL to convert to scrap. Press <b>I</b> to close.</div>
      <div class="row" style="margin-top:8px"><button id="btn-inv-close" data-i18n="inv.close">CLOSE (I)</button></div>
    </div>`;
    root.appendChild(inv);
    this.inv = inv;

    // ---- arsenal overlay ----
    const ars = document.createElement('div');
    ars.id = 'arsenal';
    ars.className = 'overlay';
    ars.innerHTML = `<div class="win panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 data-i18n="ars.title">ARSENAL</h2>
        <div class="hint2"><span data-i18n="ars.scrap">SCRAP</span> <b id="ars-scrap" style="color:var(--warn)">0</b></div>
      </div>
      <div id="ars-list"></div>
      <div class="hint2" data-i18n="ars.hint">Click an upgrade to buy a level with SCRAP. Equip attachments (owned as items) into the six slots. Weapon XP is earned by dealing damage and killing.</div>
      <div class="row" style="margin-top:8px"><button id="btn-ars-close" data-i18n="ars.close">CLOSE</button></div>
    </div>`;
    root.appendChild(ars);
    this.ars = ars;

    this._invOpen = false;
    this._arsOpen = false;
    this._invTab = 'items';
    this._bindOverlayEvents();

    // ---- MENU layer ----
    const menu = document.createElement('div');
    menu.id = 'menu';
    menu.innerHTML = `
      <div class="box panel">
        <div class="ascii-logo">${ASCII_LOGO}</div>
        <div class="hint" style="margin-bottom:14px" data-i18n="menu.tagline">${t('menu.tagline')}</div>
        <div class="row">
          <label class="field" style="flex:2"><span data-i18n="menu.callsign">${t('menu.callsign')}</span><input id="in-name" maxlength="16" value="OPERATIVE-${Math.random().toString(36).slice(2,5).toUpperCase()}"></label>
          <label class="field" style="flex:2"><span data-i18n="menu.room">${t('menu.room')}</span><input id="in-room" maxlength="24" value="ALPHA-01"></label>
        </div>
        <div class="row">
          <button class="clickable" id="btn-host" data-i18n="menu.host">${t('menu.host')}</button>
          <button class="clickable ghost" id="btn-join" data-i18n="menu.join">${t('menu.join')}</button>
          <button class="clickable ghost" id="btn-solo" data-i18n="menu.solo">${t('menu.solo')}</button>
        </div>
        <div class="row">
          <label class="field"><span data-i18n="menu.difficulty">${t('menu.difficulty')}</span>
            <select id="in-diff">
              <option value="0.8" data-i18n="menu.diff.recruit">${t('menu.diff.recruit')}</option>
              <option value="1" selected data-i18n="menu.diff.operative">${t('menu.diff.operative')}</option>
              <option value="1.35" data-i18n="menu.diff.veteran">${t('menu.diff.veteran')}</option>
              <option value="1.8" data-i18n="menu.diff.nightmare">${t('menu.diff.nightmare')}</option>
            </select>
          </label>
          <label class="field"><span data-i18n="menu.density">${t('menu.density')}</span>
            <select id="in-density">
              <option value="0.7" data-i18n="menu.density.low">${t('menu.density.low')}</option>
              <option value="1" selected data-i18n="menu.density.normal">${t('menu.density.normal')}</option>
              <option value="1.5" data-i18n="menu.density.high">${t('menu.density.high')}</option>
              <option value="2.2" data-i18n="menu.density.swarm">${t('menu.density.swarm')}</option>
            </select>
          </label>
          <label class="field"><span data-i18n="menu.track">${t('menu.track')}</span>
            <select id="in-track">${TRACKS.map((tr, i) => ({ tr, i })).filter(x => !x.tr.funOnly).map(x => `<option value="${x.i}">${x.tr.name}</option>`).join('')}</select>
          </label>
          <label class="field"><span data-i18n="menu.fun">${t('menu.fun')}</span><input type="checkbox" id="in-fun"></label>
        </div>
        <div class="row">
          <label class="field" style="flex:1"><span data-i18n="menu.cell">${t('menu.cell')}</span> <input type="range" id="in-char" min="6" max="20" value="12"></label>
          <label class="field" style="flex:1"><span data-i18n="menu.music">${t('menu.music')}</span> <input type="range" id="in-music" min="0" max="1" step="0.05" value="0.7"></label>
          <label class="field" style="flex:1"><span data-i18n="menu.sfx">${t('menu.sfx')}</span> <input type="range" id="in-sfx" min="0" max="1" step="0.05" value="0.9"></label>
        </div>
        <div class="row">
          <label class="field" style="flex:1"><span data-i18n="menu.ascii">${t('menu.ascii')}</span><input type="checkbox" id="in-ascii" checked></label>
          <label class="field" style="flex:1"><span data-i18n="menu.ramp">${t('menu.ramp')}</span>
            <select id="in-ramp">
              <option value="0" data-i18n="menu.ramp.clean">${t('menu.ramp.clean')}</option>
              <option value="1" data-i18n="menu.ramp.terminal">${t('menu.ramp.terminal')}</option>
              <option value="2" data-i18n="menu.ramp.dense">${t('menu.ramp.dense')}</option>
            </select>
          </label>
          <label class="field" style="flex:1"><span data-i18n="menu.tint">${t('menu.tint')}</span><input type="checkbox" id="in-color" checked></label>
          <label class="field" style="flex:1"><span data-i18n="menu.edge">${t('menu.edge')}</span><input type="checkbox" id="in-edge" checked></label>
          <label class="field" style="flex:1"><span data-i18n="menu.language">${t('menu.language')}</span>
            <select id="in-lang">${LANGS.map(l => `<option value="${l.id}"${l.id === getLang() ? ' selected' : ''}>${l.label}</option>`).join('')}</select>
          </label>
        </div>
        <div class="hint" id="menu-status" style="margin-top:10px" data-i18n="menu.ready">${t('menu.ready')}</div>
        <div class="hint" style="margin-top:8px" id="menu-controls" data-i18n="menu.controls">${t('menu.controls')}</div>
        <div class="hint" style="margin-top:6px;opacity:.5" data-i18n-html="menu.relayHint">${t('menu.relayHint')}</div>
      </div>
    `;
    root.appendChild(menu);
    this.menu = menu;
  }

  showMenu() { this.menu.classList.remove('hidden'); this.hud.classList.remove('on'); }
  hideMenu() { this.menu.classList.add('hidden'); this.hud.classList.add('on'); }
  setMenuStatus(t) { const e = this.menu.querySelector('#menu-status'); if (e) e.textContent = t; }
  setHudVisible(on) { this.hud.classList.toggle('on', on); }

  /** Re-apply translated labels to static chrome after a language change. */
  refreshLanguage() {
    for (const el of this.root.querySelectorAll('[data-i18n]')) {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(key);
    }
    for (const el of this.root.querySelectorAll('[data-i18n-html]')) {
      const key = el.dataset.i18nHtml;
      if (key) el.innerHTML = t(key);
    }
    document.documentElement.lang = getLang();
    if (this._invOpen && this._game) this._renderInventory(this._game);
    if (this._arsOpen && this._game) this._renderArsenal(this._game);
  }

  showPause(on) { this.hud.querySelector('#pause').classList.toggle('on', on); }
  showDead(on, stats) {
    this.hud.querySelector('#dead').classList.toggle('on', on);
    if (stats) this.hud.querySelector('#dead-stats').innerHTML = stats;
  }

  hitmark(head) {
    const h = this.hud.querySelector('#hitmark');
    h.style.color = head ? '#ff4d6d' : '#37ff8b';
    h.style.opacity = '1';
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { h.style.opacity = '0'; }, head ? 120 : 90);
  }

  damageFlash() {
    const f = this.hud.querySelector('#dmgflash');
    f.style.opacity = '1';
    clearTimeout(this._dfT);
    this._dfT = setTimeout(() => { f.style.opacity = '0'; }, 90);
  }

  toast(text) {
    if (text === this._lastToast) return;
    this._lastToast = text;
    const t = this.hud.querySelector('#toast');
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = text;
    t.appendChild(line);
    setTimeout(() => line.remove(), 3600);
  }

  killFeed(text) {
    const kf = this.hud.querySelector('#killfeed');
    const k = document.createElement('div');
    k.className = 'k';
    k.innerHTML = text;
    kf.appendChild(k);
    setTimeout(() => k.remove(), 4200);
  }

  update(game) {
    this._game = game;
    // refresh an open overlay at ~6Hz so pickups/uses reflected
    this._overlayT = (this._overlayT || 0) + 1;
    if (this._invOpen && this._overlayT % 10 === 0) this._renderInventory(game);
    if (this._arsOpen && this._overlayT % 10 === 0) this._renderArsenal(game);
    if (!this.hud.classList.contains('on')) return;
    const p = game.player;
    const w = game.weaponSystem;
    const def = w.def;
    const wstate = w.weapon;

    const hpBar = bar(p.health, p.maxHealth, 20);
    const arBar = bar(p.armor, p.maxArmor, 20);
    const shLine = p.shield > 0 ? `<div>${t('hud.sh')} <span class="bar">${bar(p.shield, p.maxShield, 20)}</span> ${Math.ceil(p.shield)}</div>` : '';
    const dname = game.district ? game.district.name : '';
    const dcol = game.district ? hex(game.district.color) : 'var(--fg)';
    const luckLine = (game.luck || game.scavenger) ? `<div style="opacity:.75">${t('hud.luckLine', { luck: (game.luck || 0).toFixed(2), scav: Math.round((game.scavenger || 0) * 100) })}</div>` : '';
    this._set('hud-tl',
      `<div style="color:var(--accent);font-size:13px">BDSC // GRIDFALL</div>
       <div style="color:${dcol};margin-top:2px">${dname}</div>
       ${game.funMode ? `<div style="color:var(--accent2)">${t('hud.funmode')}</div>` : ''}
       <div style="margin-top:6px">${t('hud.hp')} <span class="bar">${hpBar}</span> ${Math.ceil(p.health)}</div>
       <div>${t('hud.ar')} <span class="bar">${arBar}</span> ${Math.ceil(p.armor)}</div>
       ${shLine}
       <div style="margin-top:6px;opacity:.75">${t('hud.threat', { lv: game.wave, n: game.enemies.countAlive() })}</div>
       <div style="opacity:.75">${t('hud.scrap')} <b style="color:var(--warn)">${game.progression.scrap}</b></div>
       ${luckLine}`
    );
    const ad = ammoDef(w.weapon.ammoType || 'standard');
    const ammo = ad.name;
    const ammoCol = ad.color != null ? hex(ad.color) : 'var(--fg)';
    const isMelee = !!def.melee;
    const ammoLine = isMelee ? '∞' : (w.reloading ? t('hud.reload') : wstate.ammo + ' / ' + wstate.reserve);
    const typeLine = isMelee
      ? `<div style="color:var(--accent2)">${t('hud.melee')}</div>`
      : `<div style="color:${ammoCol}">◈ ${ammo}</div>`;
    this._set('hud-tr',
      `<div style="font-size:15px;color:var(--accent)">${def.name}</div>
       <div style="opacity:.8">${w.baseDef.cat} · ${t('hud.level', { lv: def.level || 1 })}</div>
       <div style="margin-top:4px;font-size:20px">${ammoLine}</div>
       ${typeLine}
       <div style="opacity:.7">FPS ${game.fps}</div>`
    );
    this._set('hud-bl',
      `<div>${t('hud.kills', { kills: game.kills, score: game.score })}</div>
       <div>${t('hud.acc', { acc: game.shots > 0 ? Math.round(game.hits / game.shots * 100) : 0, head: game.headshots })}</div>
       <div style="opacity:.7">${t('hud.grenades', { n: game.grenades, kind: grenadeName(game.grenadeKind || 'frag') })}</div>`
    );
    this._set('hud-bc',
      `<div style="opacity:.85">${w.weapons.map((ww, i) => i === w.index ? `[<span style="color:var(--accent)">${i + 1}${ww.base.name.slice(0,6)}</span>]` : `${i + 1}${ww.base.name.slice(0,3)}`).join(' ')}</div>`
    );
    this._set('hud-br', game.net && game.net.enabled
      ? t('hud.online', { room: game.net.room.toUpperCase(), ping: game.net.ping, n: game.net.players.size + 1 })
      : t('hud.offline'));

    // quickbar (Z X C V B N M)
    const keys = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
    let qb = '';
    for (let i = 0; i < 7; i++) {
      const id = game.inventory.hotbar[i];
      const def = id ? ITEMS_BY_ID[id] : null;
      qb += `<div class="qslot" data-qi="${i}">` +
        `<span class="k">${keys[i]}</span>` +
        (def ? `<span class="ico" style="color:${hex(def.rarityColor)}">${def.icon || '?'}</span><span class="n">${game.inventory.countOf(id)}</span>` : '') +
        `</div>`;
    }
    const qbe = this.hud.querySelector('#quickbar');
    if (qbe) qbe.innerHTML = qb;

    // status chips
    const chips = [];
    for (const k in p.statuses) { chips.push(`<div class="chip" style="border-color:${statusColor(k)}">${statusName(k)} <span class="t">${Math.ceil(p.statuses[k].t)}s</span></div>`); }
    for (const b of game.buffs.list()) { chips.push(`<div class="chip">${buffName(b.label)} <span class="t">${Math.ceil(b.remaining)}s</span></div>`); }
    if (game.revealActive) chips.push(`<div class="chip" style="border-color:var(--accent2)">${t('hud.reveal', { mode: revealName(game.reveal.mode) })}</div>`);
    if (w.weapon.stats.melee && w._deflect > 0.01) {
      chips.push(`<div class="chip" style="border-color:var(--accent2)">${t('hud.parry')} ${Math.round(w._deflect * 100)}%</div>`);
    }
    const sce = this.hud.querySelector('#statuschips');
    if (sce) sce.innerHTML = chips.join('');

    const obj = this.hud.querySelector('#objective');
    if (game.objectiveText) obj.innerHTML = `<div class="t">${t('hud.objective')}</div><div>${game.objectiveText}</div>`;
    const ns = this.hud.querySelector('#netstat');
    ns.textContent = game.net && game.net.enabled ? t('hud.relay', { name: game.net.broker || '' }) : '';

    // crosshair by spread
    const ch = this.hud.querySelector('#crosshair');
    const spread = def.spread * 100 + w.spreadBloom * 6;
    ch.textContent = w.ads > 0.5 ? '·' : '+';
    ch.style.fontSize = (14 + spread * 4) + 'px';

    // rifle scope overlay (any weapon with real magnification: DMR + thermal scope)
    const scopeEl = this.hud.querySelector('#scope');
    if (scopeEl) {
      const scoped = (def.scope || 1) > 1.05;
      const blend = scoped ? Math.min(1, Math.max(0, (w.ads - 0.2) / 0.5)) : 0;
      scopeEl.style.opacity = blend;
      scopeEl.classList.toggle('on', blend > 0);
      ch.style.display = blend > 0.6 ? 'none' : '';
    }

    this._drawMinimap(game);
  }

  _set(id, html) { const e = this.hud.querySelector('#' + id); if (e) e.innerHTML = html; }

  /* ---------------------- inventory & arsenal screens ---------------------- */
  _bindOverlayEvents() {
    this.inv.addEventListener('click', (e) => {
      const g = this._game;
      const slot = e.target.closest('[data-slot]');
      if (slot && g) { g.useItemId(slot.dataset.slot); this._renderInventory(g); return; }
      const tab = e.target.closest('.tab');
      if (tab) { this._invTab = tab.dataset.t; this._renderInventory(g); return; }
      const craftEl = e.target.closest('[data-craft]');
      if (craftEl && g) { g.craftRecipe(craftEl.dataset.craft); this._renderInventory(g); return; }
      if (e.target.closest('#btn-inv-close') && g) g.toggleInventory();
    });
    this.ars.addEventListener('click', (e) => {
      const g = this._game;
      if (!g) return;
      const node = e.target.closest('[data-node]');
      if (node) {
        const wid = node.dataset.wid, nid = node.dataset.node;
        if (g.progression.unlockNode(wid, nid)) {
          const w = g.weaponSystem.weapons.find(x => x.base.id === wid);
          g.weaponSystem.recompute(w);
          g.audio && g.audio.uiClick();
        } else if (g.audio) g.audio.uiError();
        this._renderArsenal(g);
        return;
      }
      const rs = e.target.closest('[data-respec]');
      if (rs) {
        const wid = rs.dataset.wid;
        if (g.progression.respec(wid)) {
          const w = g.weaponSystem.weapons.find(x => x.base.id === wid);
          g.weaponSystem.recompute(w);
          g.audio && g.audio.uiClick();
        } else if (g.audio) g.audio.uiError();
        this._renderArsenal(g);
        return;
      }
      const att = e.target.closest('[data-att]');
      if (att) {
        const wid = att.dataset.wid, slotName = att.dataset.att;
        const w = g.weaponSystem.weapons.find(x => x.base.id === wid);
        if (!w) return;
        if (w.attachments[slotName]) {
          const cur = w.attachments[slotName];
          delete w.attachments[slotName];
          g.inventory.add(cur, 1);
          g.weaponSystem.recompute(w);
          g.audio && g.audio.uiClick();
        } else {
          const owned = ITEMS.find(it => it.use && it.use.type === 'attachment' && it.use.slot === slotName && g.inventory.has(it.id));
          if (owned) {
            g.inventory.remove(owned.id, 1);
            w.attachments[slotName] = owned.id;
            g.weaponSystem.recompute(w);
            g.audio && g.audio.uiClick();
          } else if (g.audio) g.audio.uiError();
        }
        this._renderArsenal(g);
        return;
      }
      const row = e.target.closest('[data-wep]');
      if (row) {
        const i = g.weaponSystem.weapons.findIndex(x => x.base.id === row.dataset.wep);
        if (i >= 0 && g.weaponSystem.index !== i) g.weaponSystem.switchTo(i);
        this._renderArsenal(g);
        return;
      }
      if (e.target.closest('#btn-ars-close')) this.hideArsenal();
    });
  }

  toggleInventory(game) {
    this._game = game;
    this._invOpen = !this._invOpen;
    this._arsOpen = false;
    this.ars.classList.remove('on');
    this.inv.classList.toggle('on', this._invOpen);
    if (this._invOpen) this._renderInventory(game);
    return this._invOpen;
  }
  get inventoryOpen() { return this._invOpen; }

  showArsenal(game) { this._game = game; this._arsOpen = true; this.ars.classList.add('on'); this._renderArsenal(game); }
  hideArsenal() { this._arsOpen = false; this.ars.classList.remove('on'); if (this._game && this._game.state === 'paused') this.showPause(true); }
  get arsenalOpen() { return this._arsOpen; }

  _renderInventory(game) {
    if (!game) return;
    const inv = game.inventory;
    this.inv.querySelector('#inv-weight').textContent = inv.totalWeight().toFixed(0);
    this.inv.querySelector('#inv-maxw').textContent = inv.maxWeight;
    this.inv.querySelector('#inv-scrap').textContent = game.progression.scrap;
    this.inv.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.t === this._invTab));
    const grid = this.inv.querySelector('#inv-grid');
    const guide = this.inv.querySelector('#inv-guide');
    const craftEl = this.inv.querySelector('#inv-craft');
    grid.style.display = 'none'; guide.style.display = 'none'; craftEl.style.display = 'none';
    if (this._invTab === 'guide') {
      guide.style.display = 'block';
      guide.innerHTML = ITEMS.map(it => `<div class="kv"><span style="color:${hex(it.rarityColor)}">${it.icon} ${it.name} <span style="opacity:.5">· ${it.cat}</span></span><span style="opacity:.7;font-size:11px;max-width:60%;text-align:right">${it.desc}</span></div>`).join('');
      return;
    }
    if (this._invTab === 'craft') {
      craftEl.style.display = 'block';
      let h = '';
      for (const r of RECIPES) {
        const chk = canCraft(inv, game.progression.scrap, r.id);
        const out = ITEMS_BY_ID[r.out.id];
        const costItems = Object.entries(r.cost.items).map(([k, n]) => `${ITEMS_BY_ID[k] ? ITEMS_BY_ID[k].name : k}×${n}`).join(' + ');
        h += `<div class="rec ${chk.ok ? '' : 'no'}"><div style="flex:1"><b style="color:${hex(out.rarityColor)}">${out.icon} ${out.name} ×${r.out.count}</b><div class="hint2">${costItems} + ${r.cost.scrap} ${t('inv.scrap')}</div></div><div class="recbtn" data-craft="${r.id}">${t('inv.craft')}</div></div>`;
      }
      craftEl.innerHTML = h;
      return;
    }
    grid.style.display = 'grid';
    const maxName = getLang() === 'zh' ? 8 : 13;
    let html = '';
    for (let i = 0; i < inv.capacity; i++) {
      const s = inv.slots[i];
      if (!s) { html += `<div class="slot empty"></div>`; continue; }
      const def = ITEMS_BY_ID[s.id] || { name: s.id, category: '', rarity: 'common', icon: '?' };
      const nm = (def.name || '').length > maxName ? def.name.slice(0, maxName - 1) + '…' : def.name;
      html += `<div class="slot ${def.rarity}" data-slot="${s.id}" title="${def.name} — ${def.desc || ''}">${def.icon || '?'}<span class="cnt">${s.count > 1 ? s.count : ''}</span><span class="nm">${nm}</span></div>`;
    }
    grid.innerHTML = html;
  }

  _renderArsenal(game) {
    if (!game) return;
    const prog = game.progression;
    this.ars.querySelector('#ars-scrap').textContent = prog.scrap;
    const list = this.ars.querySelector('#ars-list');
    const sel = game.weaponSystem.index;
    let html = '';
    game.weaponSystem.weapons.forEach((w, i) => {
      const id = w.base.id;
      const st = prog.stateFor(id);
      const xpNeed = prog.xpToNext(st.level);
      const xpPct = st.level >= MAX_WEAPON_LEVEL ? 100 : Math.min(100, Math.round(st.xp / xpNeed * 100));
      const s = w.stats;
      html += `<div class="wep-row ${i === sel ? 'sel' : ''}" data-wep="${id}">`;
      html += `<div class="wep-head"><span>${i + 1}. <b>${w.base.name}</b> <span style="opacity:.6">${w.base.cat}</span></span>`;
      html += `<span>${t('ars.lv')} <b>${st.level}</b>${st.level >= MAX_WEAPON_LEVEL ? ' ' + t('ars.max') : ` · ${Math.round(st.xp)}/${xpNeed}`} · <b style="color:var(--accent)">${t('ars.mp', { n: st.mp })}</b></span></div>`;
      html += `<div class="xpbar"><i style="width:${xpPct}%"></i></div>`;
      html += `<div style="font-size:11px;opacity:.8">${t('ars.stats', { dmg: s.dmg.toFixed(1), rate: Math.round(s.rpm), mag: s.mag, crit: (s.crit * 100).toFixed(0), pen: ((s.pen || 0) * 100).toFixed(0) })}`;
      if (s.scavenger) html += t('ars.scav', { v: (s.scavenger * 100).toFixed(0) });
      if (s.luck) html += t('ars.luck', { v: s.luck.toFixed(2) });
      html += `</div>`;
      // branches
      html += `<div class="tree">`;
      for (const br of BRANCHES) {
        html += `<div class="branch" style="border-color:${hex(br.color)}"><div class="bhead" style="color:${hex(br.color)}">${br.icon} ${br.name}</div>`;
        html += `<div class="nodes">`;
        for (const nid in TREE) {
          const node = TREE[nid];
          if (node.branch !== br.id) continue;
          const owned = st.nodes.includes(nid);
          const reason = prog.nodeLockReason(id, nid);
          const cls = owned ? 'node owned' : reason === null ? 'node avail' : 'node locked';
          html += `<div class="${cls}" data-wid="${id}" data-node="${nid}" title="${node.desc}${reason ? ' — ' + reason : ''}">`;
          html += `<span class="tier">T${node.tier}</span> ${node.name} <span class="ncost">${owned ? '✓' : node.cost + 'MP'}</span>`;
          html += `</div>`;
        }
        html += `</div></div>`;
      }
      html += `</div>`;
      // attachments
      html += `<div class="att-row">`;
      for (const slot of ['muzzle', 'optic', 'magazine', 'underbarrel', 'grip']) {
        const cur = w.attachments[slot];
        const def = cur ? ITEMS_BY_ID[cur] : null;
        const title = cur ? t('ars.attRemove', { name: def.name }) : t('ars.attFit', { slot: slotName(slot) });
        html += `<div class="att ${cur ? 'filled' : ''}" data-wid="${id}" data-att="${slot}" title="${title}">${slotName(slot)}: ${def ? def.name : '—'}</div>`;
      }
      html += `<div class="att respec" data-wid="${id}" data-respec="1" title="${t('ars.respecTitle', { n: prog.respecCost(id) })}">${t('ars.respec', { n: prog.respecCost(id) })}</div>`;
      html += `</div>`;
      html += `</div>`;
    });
    list.innerHTML = html;
  }

  _drawMinimap(game) {
    const c = this.hud.querySelector('#minimap');
    const ctx = c.getContext('2d');
    const S = c.width;
    const range = 140; // metres shown
    const scale = S / (range * 2);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(3,8,6,0.85)';
    ctx.fillRect(0, 0, S, S);
    const px = game.player.pos.x, pz = game.player.pos.z;
    // roads/blocks grid
    const B = 54;
    const n = Math.ceil(range / B) + 1;
    const bx0 = Math.round(px / B), bz0 = Math.round(pz / B);
    ctx.fillStyle = 'rgba(55,255,139,0.10)';
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const cx = (bx0 + i) * B, cz = (bz0 + j) * B;
        const sx = (cx - px) * scale + S / 2, sz = (cz - pz) * scale + S / 2;
        const pad = (54 - 14) * scale;
        ctx.fillRect(sx - pad / 2, sz - pad / 2, pad, pad);
      }
    }
    // enemies
    for (const e of game.enemies.list) {
      if (!e.alive) continue;
      const dx = (e.pos.x - px) * scale + S / 2;
      const dz = (e.pos.z - pz) * scale + S / 2;
      if (dx < 0 || dz < 0 || dx > S || dz > S) continue;
      ctx.fillStyle = e.state === 'combat' ? '#ff4d6d' : '#ffb000';
      ctx.fillRect(dx - 2, dz - 2, 4, 4);
    }
    // remote players
    if (game.net && game.net.enabled) {
      for (const [, pl] of game.net.players) {
        if (!pl.pos) continue;
        const dx = (pl.pos.x - px) * scale + S / 2;
        const dz = (pl.pos.z - pz) * scale + S / 2;
        ctx.fillStyle = '#4de0ff';
        ctx.fillRect(dx - 2, dz - 2, 4, 4);
      }
    }
    // loot
    if (game.loot) {
      for (const l of game.loot.active) {
        const dx = (l.pos.x - px) * scale + S / 2;
        const dz = (l.pos.z - pz) * scale + S / 2;
        if (dx < 0 || dz < 0 || dx > S || dz > S) continue;
        ctx.fillStyle = 'rgba(150,200,255,0.7)';
        ctx.fillRect(dx - 1, dz - 1, 2, 2);
      }
    }
    // reveal (radar/xray) shows all hostiles regardless of range
    if (game.revealActive) {
      for (const e of game.enemies.list) {
        if (!e.alive) continue;
        const dx = (e.pos.x - px) * scale + S / 2;
        const dz = (e.pos.z - pz) * scale + S / 2;
        ctx.fillStyle = 'rgba(255,77,109,0.9)';
        ctx.fillRect(Math.max(1, Math.min(S - 3, dx)) - 1, Math.max(1, Math.min(S - 3, dz)) - 1, 3, 3);
      }
    }
    // player + facing
    ctx.fillStyle = '#fff';
    ctx.fillRect(S / 2 - 2, S / 2 - 2, 4, 4);
    const dir = game.player.getLookDir();
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(S / 2 + dir.x * scale * 12, S / 2 + dir.z * scale * 12); ctx.stroke();
  }
}

function bar(v, max, n) {
  const f = Math.max(0, Math.min(1, v / max));
  const full = Math.round(f * n);
  return `<span class="full">${'█'.repeat(full)}</span><span class="empty">${'░'.repeat(n - full)}</span>`;
}

function hex(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }
function statusColor(k) {
  const map = { burn: '#ff6a22', bleed: '#ff2a44', poison: '#66ff44', cryo: '#66ddff', shock: '#ffee55', corrode: '#ccff33', mark: '#ff44cc', weaken: '#aa88ff', stun: '#ffffff', nano: '#37ff8b' };
  return map[k] || 'var(--accent)';
}
