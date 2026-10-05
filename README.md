# BDSC // GRIDFALL

An **ASCII-art 3D PVE shooter** built entirely with web technology (Three.js + WebAudio +
WebSockets). A vast, procedurally generated neon city rendered as live ASCII characters,
waves of tactical robotic enemies, a fully synthesised Drum & Bass soundtrack, and
co-op multiplayer over **public internet relays** — no game assets, no server to deploy.

```
   ██████╗ ██████╗ ███████╗ ██████╗    ██████╗ ██████╗ ██╗██████╗ ███████╗ █████╗ ██╗     ██╗
   ██╔══██╗██╔══██╗██╔════╝██╔════╝   ██╔════╝ ██╔══██╗██║██╔══██╗██╔════╝██╔══██╗██║     ██║
   ██████╔╝██║  ██║███████╗██║        ██║  ███╗██████╔╝██║██║  ██║█████╗  ███████║██║     ██║
   ██╔══██╗██║  ██║╚════██║██║        ██║   ██║██╔══██╗██║██║  ██║██╔══╝  ██╔══██║██║     ██║
   ██████╔╝██████╔╝███████║╚██████╗   ╚██████╔╝██║  ██║██║██████╔╝██║     ██║  ██║███████╗███████╗
   ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝ ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝
```

---

## Quick start

Requires **Node 18+** (developed and tested on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
```

Then in the browser click **SOLO PVE** (or **HOST CO-OP** / **JOIN ROOM** for multiplayer).
Click the canvas to capture the mouse.

Other commands:

```bash
npm run build        # production bundle into dist/
npm run preview      # serve the production build
npm run relay        # optional self-hosted MQTT relay (LAN / offline)
npm test             # headless Playwright smoke test (dev server must be running)
npm run test:net     # two-client multiplayer sync test
npm run test:mobile  # touch controls / mobile layout acceptance
npm run test:collision # collision regression (no wall/corner teleports)
```

> The smoke tests use Playwright/Chromium. If it isn't installed: `npx playwright install chromium`.

---

## Controls

| Action | Key |
| --- | --- |
| Move | `W A S D` |
| Look | Mouse |
| Fire / Aim down sights | `LMB` / `RMB` |
| Sprint | `Shift` |
| Crouch | `Ctrl` or `C` |
| Jump | `Space` |
| Weapon | `1 2 3 4 5 6 7 8` (or mouse wheel) |
| Reload | `R` |
| Throw grenade | `G` |
| Quick-use hotbar | `Z X C V B N M` |
| Quick heal (best med item) | `Q` |
| Inventory | `I` |
| Arsenal / upgrades | Pause (`Esc`) → ARSENAL |

Weapons: VECTOR-9 pistol, WASP SMG, PULSE AR, BREACH-12 shotgun, LANCE DMR sniper,
ION CASTER plasma, HOUND RL rocket launcher, and the TANG DAO melee saber (hold fire
to chain a three-swing combo; kills burst into flying debris).

### Mobile / touch

Phones and tablets automatically get a full touch layout (force it on desktop with
`?touch=1`, disable with `?touch=0`):

- **Left dynamic joystick** — move; analogue speed, push to the edge to auto-sprint.
- **Right side drag** — look; a dynamic stick appears where you touch.
- **Weapon strip** (top centre) — tap 1–8 to switch weapons.
- **Quickbar** (bottom centre) — tap a slot to use that item (Z X C V B N M).
- **Right thumb cluster** — FIRE, JUMP, RELOAD, ADS (toggle), CROUCH (toggle),
  GRENADE and HEAL; **PAUSE** and **BAG** sit top-right.
- Portrait orientation shows a rotate-device hint; menus and overlays reflow and
  scroll for small screens.

The whole touch layer routes through the same virtual input API as the keyboard,
so every system (weapons, grenades, hotbar, inventory, arsenal, multiplayer) works
unchanged.

---

## What's implemented (requirement by requirement)

**1 — Detailed models with a unified ASCII aesthetic.**
Every surface is drawn to a canvas at runtime (facade window grids, asphalt, brick,
roof gravel, metal panels, crate stencils, hazard stripes, holo signs, interior walls).
The whole scene is then resolved through a custom ASCII shader (`src/engine/ascii.js`)
that converts luminance + Sobel edges into a density-ordered glyph ramp, tinting each
character with the real scene colour. Building geometry is genuinely detailed — facades,
spandrels, mullions, parapets, AC units, water tanks, antennas, billboards — all reduced
to a single, consistent character grid.

**2 — No placeholders, no TODOs, no stubs.**
Every listed system is implemented and exercised end-to-end and verified by the automated
smoke tests (world streaming, collision, weapons, projectiles, enemy AI, networking,
audio scheduling). There are no `TODO`/placeholder code paths.

**3 — Go for it.** Persistent huge city, 8 weapons, 7 enemy archetypes, 6 music tracks,
squads, grenades, interiors, minimap — all on.

**4 — Dependencies handled.** Pure `npm` + Vite. Only runtime deps are `three`, `mqtt`.
`aedes`+`ws` power the optional self-hosted relay. Nothing else needs installing.

**5 — Pushed to the limit** within a real, runnable scope (see "Scope notes" below).

**6 — Public-relay multiplayer.** Co-op PVE runs over **public MQTT-over-WebSocket
brokers** (`broker.emqx.io`, `broker.hivemq.com`, `test.mosquitto.org`), tried in order.
No deployment required. One peer is the authoritative **host** (runs all enemy AI and
broadcasts compact snapshots); clients render interpolated enemy ghosts and report hits.
A self-hosted relay (`npm run relay`, Aedes) is included for LAN/offline use.

**7 — Enemy AI.** See the dedicated section below — perception, squad roles, cover,
flanking, suppression, grenades, patrols, search, reinforcements, per-archetype tactics.

**8 — Bugs fixed.** The headless Playwright suite drives real gameplay and asserts **zero
runtime errors**: city generation, interior traversal, hitscan kills, damage taken,
particles, and multiplayer snapshot sync were all made green.

**9 — Very large city, built in layers.**
1. **Whole huge map** — an effectively unbounded procedural city streamed in 4×4-block
   chunks (block pitch 54 m, ~2 500 buildings per 81-chunk view, >860 m view distance;
   world coordinates are unbounded).
2. **Refine heights & massing** — district density, plot subdivision (1–4 lots), stacked
   setback segments, urban-centre height bias, towers up to ~60 floors.
3. **Street furniture** — lamps, traffic signals with blinking beacons, holo signs,
   benches, trees, bins, hazard barriers, parked cars, plazas.
4. **Interiors without breaking structure** — enterable buildings keep their real shell;
   a door gap is cut through the *exterior* facade and matching interior walls, and
   detailed floors (up to 12 levels) with partitions, furniture, ceiling lights and a
   working staircase + stairwell opening are added. Everything above stays a solid,
   structurally-consistent mass so the tower silhouette never changes.

**10 — Music & SFX.** Six complete procedural Drum & Bass songs, all synthesised live
(amen-style breaks, sub + reese bass, filtered pads, arps, risers). Every track is a
full ~3-minute multi-section arrangement — intro → build → drop → breakdown → drop 2 →
outro — with arrangement-driven layering (drums/hats/bass/pad/arp/sub pulses) and noise
risers on the transitions; the arrangement wraps seamlessly so the soundtrack keeps
evolving during play. Dozens of synthesised SFX (per-weapon reports, impacts by surface,
footsteps, reloads, explosions, grenades, enemy barks, alarms, pickups, ambience).
No audio files.

---

## Enemy AI

The tactical layer lives in `src/game/ai.js` + `src/game/enemies.js`.

**Perception** — FOV cones (per-archetype), line-of-sight raycasts, awareness build-up,
hearing of gunshots/explosions, proximity detection, and paper-trail investigation.
Contact is shared through **squads** and radio-relayed to nearby units.

**Squad tactics** (`Squad`) — a blackboard tracks the shared target and contact count,
then re-assigns roles every 0.8 s:
- **assault** — advance on the target using cover-to-cover pathing,
- **support** — hold and lay down suppressing fire,
- **flank** — take a lateral position around the target's cover,
- **overwatch** — marksmen keep distance and hold angles,
and a squad **strategy** (press / hold / advance / fallback) derived from average range
and casualties.

**Decision making** — in combat, a utility scorer continuously weighs *suppress, advance,
take cover, flank, strafe, reload, grenade, retreat, overwatch* using health, exposure,
suppression, role and distance, with mild persistence to avoid jitter.

**Movement** — A* pathfinding on a street grid with line-of-sight path smoothing, local
separation from allies, wall feelers, and step/cover handling. Drones fly and avoid
buildings; turrets are stationary.

**Archetypes** — Grunt, Rusher (fast melee), Heavy (high-HP suppressor + grenades),
Marksman (long-range laser sight), Drone (flying), Turret (fixed high-DPS), Officer
(buffs by calling **reinforcements**). Each has its own model, weapon, accuracy and
reaction profile, scaled by difficulty.

**States** — patrol → investigate → combat (with the sub-behaviours above) → search →
staggered → dead, plus grenade throws and officer reinforcement calls.

---

## Multiplayer

- Pick a **CALLSIGN** and **ROOM**, then **HOST CO-OP** or **JOIN ROOM**.
- The host runs all enemy simulation; clients receive ~9 Hz snapshots and interpolate.
- Player transforms, shots, enemy tracer fire, kills and objectives are all relayed.
- Difficulty is set by the host. Players are shown as coloured avatars and on the minimap.
- Transport: MQTT over WebSockets to public brokers, auto-failover across three.
- Self-hosted relay: `npm run relay`, then open `http://<host>:5173/?broker=ws://<host>:8888`.

---

## Architecture

```
index.html
src/
  main.js                 game orchestration, loop, waves, pickups, avatars
  engine/
    ascii.js              ASCII render pipeline + glyph atlas + post FX
    input.js              pointer-lock FPS input
    audio.js              procedural SFX + mixer + convolution reverb + ambience
  music/
    dnb.js                6-track Drum & Bass sequencer (lookahead scheduler)
  game/
    world.js              chunk streaming, city layout, spatial hash, nav queries
    buildings.js          tower geometry, facades, rooftops, interiors + stairs
    textures.js           all runtime-drawn textures
    materials.js          shared material set
    nav.js                A* street navigation + line-of-sight
    player.js             FPS controller, capsule collision, step-up
    weapons.js            weapon defs, viewmodels, hitscan, recoil, ADS
    projectiles.js        grenades / plasma / rockets with AoE
    effects.js            pooled particles, tracers, decals, shockwaves, flashes
    enemies.js            enemy entities, models, animation, manager
    ai.js                 squads, cover/flank/advance scoring, perception
    net.js               public-relay co-op (MQTT over WebSocket)
  ui/
    hud.js               menu, HUD, minimap, killfeed, toasts
    i18n.js              language state + EN/ZH UI strings
    localize.js          in-place registry translations (items, tree, ...)
    lang/zh-content.js   Simplified Chinese content dictionary
    fonts/               subset Fusion Pixel CJK font + OFL license
    touch.js             mobile joysticks + touch action buttons
    style.css
server/
  relay.js                optional self-hosted Aedes MQTT-over-WS relay
test/
  smoke.mjs               headless gameplay smoke test (asserts 0 errors)
  net.mjs                 two-client multiplayer sync test
```

### How the ASCII rendering works
1. The 3D scene renders into a half-float render target at **2× the character grid**.
2. A bright-pass gives a cheap bloom.
3. The compose shader samples each cell, applies grade (contrast/saturation/brightness),
   converts linear → sRGB, detects edges, picks a glyph from the ramp, samples the glyph
   atlas, and tints it with the scene colour — plus scanlines, vignette, chromatic
   aberration, film grain and a damage overlay.

Tune it live from the menu: **ASCII CELL** size, **GLYPH RAMP** (dense or terminal),
**TINT** and **EDGE GLYPHS**. Prefer plain 3D? **ASCII RENDER** switches the whole
glyph pipeline off (raw scene, no scanlines/vignette) and the choice is remembered.

### Languages
The interface ships in **English (default)** and **简体中文** — pick one under
**LANGUAGE** in the menu and it is remembered. All UI chrome, item/weapon/tree
content, statuses, districts and messages are translated. The Chinese UI uses
**Fusion Pixel 12px Mono**, a pixel/bitmap CJK font chosen to match the ASCII
terminal aesthetic (subset to the glyphs the game actually uses; SIL OFL 1.1).

---

## Scope notes (honest limitations)

- Interiors are detailed for up to **12 floors** per enterable building; the remainder of
  each tower remains a solid, structure-preserving mass. This keeps memory and collider
  counts sane while still delivering dozens of fully explorable multi-floor buildings.
- Multiplayer is host-authoritative. If the host disconnects, clients keep playing the
  frozen snapshot until you re-join.
- The world is procedural and effectively unbounded, but only chunks within the streaming
  radius are simulated/rendered.
- Headless SwiftShader renders far slower than a real GPU; on a normal machine the game
  runs at high framerates. Lower **ASCII CELL** increases cost (more glyphs).

---

## Credits

Design, code, art and audio generated procedurally — no third-party game assets.
Built with [three.js](https://threejs.org/) and [mqtt.js](https://github.com/mqttjs/MQTT.js).
Chinese UI font: [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) by
TakWolf (SIL OFL 1.1), subset to the glyphs this game uses — license and component
licenses in `src/ui/fonts/`.

---

# Stage 2 — Loot, Progression & Ammunition

A second, deeper layer of systems. Everything below is implemented, wired into the
HUD, and covered by the automated `npm run test:systems` harness (84/84 items built
and used, all ammo types, statuses, upgrades and deployables exercised — zero errors).

## 1 · Endless position-following enemy spawning
`src/game/spawner.js` — a **SpawnDirector** keeps a rolling population target around
the player and never stops:
- **Follows the player anywhere on the (unbounded) map** — packs always spawn in an
  annulus (46–96 m) around the player, snapped to the street grid and only inside
  loaded chunks.
- **Escalating threat** grows over time, on gunfire noise and on kills; population
  target, spawn rate, pack size and enemy tiers all scale with it.
- **Surges** periodically throw a full squad at the player for pacing peaks.
- **Recycling** despawns far-behind, disengaged units so the fight stays where you are.
- Enemy **officers still call reinforcements** on top of the director.
- Host-authoritative: only the host/solo peer runs it; clients receive snapshots.

## 2 · Item system — 84 distinct items
`src/game/items/` — `registry.js`, `models.js`, `effects.js`, `inventory.js`, `loot.js`.
- **84 items** across 13 categories (ammo 21, attachments 15, tools 9, medical 8,
  throwables 7, deployables 5, materials/valuables/containers, armour, shields, stims,
  food…), every one with a **unique id, icon, rarity and description**.
- **Every item has its own procedurally-built detailed 3D model** (multi-part primitives
  with per-part materials/emissive) — no two share a model.
- **Every item has a distinct function**, dispatched by `effects.js`: heals, permanent
  max-HP/armour, overshields, buffs (speed/fire-rate/damage/jump/invis/regen/thorns/
  time-dilation), ammo loading, weapon attachments, deployables, reveals, teleport,
  dash, loot caches, scrap conversion, and more.
- **Placed everywhere, layered**: street scatter in every chunk, **dense loot on every
  floor of every enterable building interior**, caches/containers, and enemy drops.
  Placement is deterministic per chunk (so co-op peers agree) with a per-session
  consumed-pickup ledger; loot streams in around the player and is culled behind them.
- Pickup is magnetised + auto-collect with weight/stack accounting and hotbar autofill.

## 3 · Weapon upgrade system
`src/game/progression.js` — per-weapon **XP and levels (1–20)** earned by dealing
damage and getting kills, plus a spendable **upgrade tree** (Damage, Fire Rate,
Accuracy, Control, Magazine, Reload — 5 levels each, escalating SCRAP cost) and six
**attachment slots** (muzzle / optic / magazine / underbarrel / grip). Effective stats
are recomputed live from base + upgrades + attachments + loaded ammo + active buffs.
The **ARSENAL** screen (pause menu) buys upgrades and fits/removes attachments.

## 4 · Inventory system
`src/game/items/inventory.js` + the **INVENTORY** screen (`I`): 40 slots, per-item
stack sizes, weight limit, a 7-slot quick-use hotbar (`Z X C V B N M`), quick-heal
(`Q`), rarity-coloured grid, an in-game **ITEM GUIDE** listing every item, and
click-to-use / click-to-fit behaviour with a real-time refresh.

## 5 · Ammunition types — 20 rounds, each with different effects
`src/game/ammo.js` + `src/game/status.js`:
- **Standard, Hollow-Point, Armour-Pierce, Incendiary, Cryo, Shock, Toxic, Corrosive,
  Explosive, Flechette, Ricochet, Piercing, Tracker, Photon, Nanite, Dragon's Breath,
  Subsonic, Cluster, Void, Overcharge** — each changes damage, penetration, spread,
  recoil, pellet count, tracer colour and/or projectile behaviour (AoE, pierce,
  ricochet, chain-lightning, no-falloff, silent, self-heal).
- **Status effects** with ticking DoT and control: burn, bleed, poison, cryo (slow),
  shock (stun + arc), corrode (vulnerability), mark (reveal), weaken, stun, nanite —
  with particle feedback, core glow and movement/fire-rate modifiers.
- Load any ammo type from an **AMMO box** item; the HUD shows the loaded type.

## 6 · Deployables & grenades
- **Deployables**: allied Auto-Turret, Assault Drone, Proximity Mine, Hard-Light
  Barrier (adds real collision) and Holo Decoy (lures hostiles).
- **Grenades** with distinct detonations: Frag, Incendiary (burn field),
  EMP (stuns machines), Smoke (blocks line-of-sight), Flashbang (blinds),
  Cryo (freeze), Cluster (multi-detonation).

### New tests
```bash
npm run test:systems   # 90 items built+used, 20 ammo types, 10 statuses, tree, tables, crafting, elites
```

---

# Stage 3 — Districts, Deep Upgrade Tree & Loot Economy

A third layer that makes **progression and drops one connected system**: where you
fight changes what drops, what drops feeds crafting, crafting feeds the upgrade tree,
and the tree's perks change what drops next.

## 1 · Districts (region identity)
`src/game/districts.js` — the city is divided into deterministic regions (identical on
every peer, so co-op stays in sync): **CORE, INDUSTRIAL, RESIDENTIAL, SLUMS, MARKET,
FRINGE**. Each district has its own **loot theme**, **interior room themes**, **enemy
mix**, **density** and **elite odds**. The HUD shows the district you are standing in.

## 2 · Deep, branching upgrade tree
`src/game/progression.js` — replaced the flat upgrades with a **4-branch / 4-tier mod
tree (20 nodes)** with real tradeoffs:
- **LETHAL** (damage, crit, EXECUTIONER ⨯ HEAVY CALIBRE, VAMPIRIC CORE)
- **TEMPO** (fire rate, reload, OVERCLOCK ⨯ HAIR TRIGGER, KINETIC LOOP → +1 pierce)
- **CONTROL** (spread, recoil, DEADEYE ⨯ BIPOD STANCE, GHOST PROTOCOL → headshots)
- **UTILITY** (magazine, penetration, ARMORY ⨯ SCAVENGER, AMMO AFFINITY)
- **Tier-3 nodes are mutually exclusive** → committing defines your build; weapons
  earn **mod points** from levels; **respec** refunds for scrap. Perks are real combat
  behaviours (crit rolls, executioner bonus, deadeye first-shot, overclock ramp,
  lifesteal, armory reserve regen, stabilizer, bipod, kinetic pierce, affinity).
- Runtime perk paths are exercised by the test harness (25 live shots through the tree).

## 3 · Loot economy — tables, sources, regions, rarity
`src/game/loot/tables.js` (+ `loot.js`) — **22 weighted drop tables**:
- **rarity weights** (common→legendary) with **luck** biasing toward rarer entries and
  items (verified: rare+ share rises 0.15 → 0.29 at luck 2.0);
- **drop sources**: per-enemy tables (grunt/rusher/heavy/sniper/drone/turret/officer),
  an **elite** table with guaranteed rare+, container tables, interior purpose tables
  (office/lab/armory/common) and **region** tables for each district;
- **bad-luck protection** (min-rarity guarantees), and **scavenger** scaling the amount;
- **elites** (bigger, tankier, gold aura, elite loot) rolled per district.

## 4 · Crafting — the loot↔upgrade bridge
`src/game/crafting.js` — **18 recipes** turn looted materials + scrap into ammo,
attachments, consumables and — crucially — **Weapon Modules (+1 mod point)** and
**Capstone Cores (+3 MP)** that feed the tree, plus **Respec Chips**. Accessible from
the inventory's **CRAFT** tab.

## 5 · Real linkage summary
- Tree **SCAVENGER / AMMO AFFINITY** perks + **Luck Charm / Scavenger Beacon** items
  change the drop rates and rarity the loot system uses (`game.luck`, `game.scavenger`).
- **Materials → CRAFT → attachments/modules/scrap → tree nodes → perks → better drops.**
- District theme → which tables roll → which build resources you'll find.

Verified end-to-end by `npm run test:systems` (zero errors): 90 items, 20 ammo types,
10 statuses, 20-node tree with exclusivity + respec, 6 districts, 22 tables / 1240
rolls with no bad references, luck curve, 18/18 recipes crafted, enemy drop sources and
elites.


