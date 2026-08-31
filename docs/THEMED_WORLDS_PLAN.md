# Themed Worlds, Monsters & Hazards — Implementation Plan

> **STATUS: IMPLEMENTED** (all four phases, 2026-08-31). Themes: `theme.ts` THEMES +
> `render/arena.ts` + `boot/minimap.ts` (kept pass-for-pass in sync). Portals/nests:
> `maps/index.ts` data + `sim/portal.ts` / `sim/nest.ts`. Monsters: `sim/monster.ts`
> (web shot + beam via MSG.Use invSlot 2), costumes in `render/playerRenderer.ts`
> (FORM_* tables), moving parts in `render/monsterFx.ts`. Wire: `protocol/encode.ts`
> (+~40B worst case, round-trip test in `protocol/encode.test.ts`). Mechanics tests:
> `sim/monsters.test.ts`. Deviation from the plan: the wraith is a pure visual variant
> (full-length trail) so the canonical trail tests on map 1 keep their meaning.

The ask: maps must stop being "same theme, different rooms." Each map becomes a world —
pixelated forest, spider cave, alien hive — with its own monster (the It player's form)
and its own ability, plus environmental hazards (NPC spiders that catch and kill) and
teleporters. Score stays time-based: hazard deaths add penalty seconds.

Everything below is phased so each phase ships alone, keeps the deterministic shared-sim
architecture (ADR 0001), stays inside the budgets (boot 16KB, 8 draw calls, zero
per-tick allocations), and extends — never breaks — the existing tests.

---

## The four worlds (proposal — names/pairings are knobs)

| Map | World theme | Monster (the It) | Monster ability | Hazards |
|---|---|---|---|---|
| 0 Foundry | Haunted manor (current dusk look, polished) | **Ghost** | Echo trails (exists today) + lantern | 2 nest spiders |
| 1 Pillars | **Pixel forest** — grass floor, trees for pillars, bushes, fireflies | **Wraith** (ghost variant, green, shorter trails) | Echo trails, faster decay | 3 nest spiders |
| 2 Serpentine | **Spider cave** — stone, webs, egg sacs, stalagmites | **Spider** | **Web shot**: projectile that roots/slows a runner (reuses `slowedUntilTick`) | none (the It *is* the spider) |
| 3 Warrens | **Alien hive** — metal floor, glowing panels, teal glow | **Alien** | **Beam**: telegraphed line attack that knocks out (reuses `unconsciousUntilTick`) | none (beam is strong enough) |

Teleporters: 1–2 linked pairs on every map.

---

## Phase 1 — Per-map visual themes (client-only, zero protocol risk)

Today `game/theme.ts` is one global palette and `render/arena.ts` + `boot/minimap.ts`
read its constants directly.

- Introduce `interface MapTheme` holding every environmental colour + dressing knobs
  (speckle colour/count, wall style: `hedge | trees | stone | metal`, crack colours,
  web density, glow accents). Export `THEMES: MapTheme[]` indexed by map, defaulting to
  the current dusk values.
- `layoutArena(layer, map)` and `drawMinimap(ctx, map, …)` take the theme from
  `THEMES[map.index]`. The dressing passes become parametric:
  - *forest*: wall tiles draw as canopy blobs + trunk bases instead of hedge fill; floor
    speckles become grass tufts (2-3px verticals) + occasional flowers; floor cracks
    become dirt paths.
  - *cave*: stone fill with pale strata lines; web pass density ×3; egg-sac decor.
  - *hive*: flat metal with panel seams (grid lines at tile edges), glowing conduit
    accents (additive), teal windows.
- Player colours, fog, and It glow are untouched — legibility rules stay.
- **Budget watch**: `minimap.ts` is in the boot chunk; the theme table adds ~1-2KB
  source. Boot is at 48% — fine, but `npm run size` gates it.
- Tests: existing draw-call budget in `check:browser`; add screenshots per map to the
  check crops.

Effort: the largest *artistic* phase, smallest risk. No server deploy needed.

## Phase 2 — Teleporters (small sim + map data)

- Map data: `portals: Int16Array` of (tx, ty, destTx, destTy) quads, ≤4 per map,
  authored in `Echo-Tag-Shared/src/maps/index.ts` next to doors/wardrobes.
  `maps.test.ts` gains invariants: both ends open tiles, dest not inside a nest radius,
  reachability preserved.
- Sim (`sim/portal.ts`): standing on a portal tile with cooldown elapsed teleports the
  player to the paired tile; per-player `portalCooldownUntilTick` (~2s) prevents
  ping-pong. Deterministic, fixed arrays, zero alloc.
- Wire: **no snapshot change** — positions simply jump, and the client already snaps
  teleport-sized deltas (the >60-unit guard added for the audio fix zeroes velocity and
  interpolation). A warp sound triggers client-side when a player's own position jumps
  while on a portal tile.
- Render: animated pixel portal (concentric square ring, additive shimmer) in the fx
  layer; portals drawn on the minimap.
- Bots: `ai/bot.ts` treats portals as passable goals opportunistically (v1: bots simply
  may stumble through them; smart routing is a later knob).

## Phase 3 — Nest spiders (hazard NPCs + score penalty)

- Map data: `nests: Int16Array` of (tx, ty) — the spider's home. Authored in dead-ends.
- Sim (`sim/nest.ts`), fixed pool `MAX_NESTS = 4`:
  - State per nest: home x/y, spider x/y, state (lurk / lunge / drag-back), target slot,
    cooldown. Runner enters `NEST_RADIUS` (~1.5 tiles) → lunge at `NEST_SPEED`; touch
    for `NEST_KILL_MS` (~400ms, escapable) → **kill**:
    - victim respawns at the spawn point farthest from the nest (deterministic pick
      from the existing spawn list),
    - `itTimeMs[victim] += NEST_PENALTY_MS` (**+5s** proposed — score *is* time, lower
      wins, so a spider death directly hurts the score),
    - spider drags back to its nest and rests `NEST_REST_TICKS`.
  - The It is ignored (monsters don't fear spiders); brief post-respawn immunity reuses
    `immuneUntilTick`.
- Wire: +~6 bytes per active nest in the snapshot (spider x/y quantised i16 + state
  byte); kill events derive from the victim's teleport-respawn + a penalty flag. Budget:
  snapshot grows ~24 bytes worst case — nothing at 20Hz.
- Fairness/legibility: nest territory is telegraphed on the floor (web carpet ring), the
  spider is drawn 2× the ambient cosmetic spiders, kill = sting + flash + "+5s" floater,
  and the map preview shows nests.
- Bots: steering adds a repulsion field around nests so bots don't feed the spider.
- Tests: sim tests for lunge/kill/respawn/penalty determinism; bench re-run (still
  zero-alloc).

## Phase 4 — Monsters with distinct abilities (the big one)

- `MONSTER_BY_MAP: readonly Monster[]` in shared constants: `Ghost | Wraith | Spider |
  Alien`. The It player's *form* is the map's monster.
- **Ability input**: reuse the validated `MSG.Use` path with `invSlot = 2` = monster
  ability (server-validated: only the It, only when off cooldown). No input-byte change,
  prediction untouched.
- **Ghost / Wraith** — today's kit (echo trails). Wraith: trail decays faster, slightly
  higher speed — a tuning row, not new code.
- **Spider (web shot)** — `sim/webshot.ts`, pool of ≤4 live shots (x, y, vx, vy, ttl):
  travels in facing direction, stops at walls; on hit → `slowedUntilTick` (root-grade
  slow, ~2.5s) — the *exact* mechanic goo tools already use, so mirrors, HUD and
  prediction already understand it. Landed shots leave a web patch (~3s) that slows
  runners crossing it: the spider's area-denial answer to the ghost's trails. Echo
  trails OFF for the spider.
- **Alien (beam)** — `sim/beam.ts`: press → 0.5s charge with a visible telegraph line
  along facing; on fire, everyone on the line within `BEAM_RANGE` gets
  `unconsciousUntilTick` (the trap KO, again already mirrored + rendered); ~6s cooldown.
  Echo trails OFF.
- Wire: snapshot += web-shot pool (≤4 × 5 bytes) + beam state (slot, angle byte, phase
  byte). Both sides share `encode.ts`, deploy client+server together as always.
- Render: monsters stay square-people inside the single bodies ParticleContainer
  (insertion-order rule, 8-draw-call budget): spider = wide 8-legged silhouette
  template, alien = tall dome-head template — new grids in `render/templates.ts`, same
  pipeline. Web shots/patches and the beam telegraph ride the existing fx/tools layers.
- Audio: per-monster footstep rate + sting variant; heartbeat unchanged (it's the
  universal dread channel).
- Bots: It-bot fires web/beam when the target is within a cone (few lines in the
  synthetic driver); runner-bots dodge the beam telegraph.
- UI text: "least time as the ghost wins" → "least time as the monster wins"; lobby map
  preview footer names the world *and* its monster ("SERPENTINE · SPIDER").
- Tests: mechanics tests per ability (hit, cooldown, wall block, KO/slow durations),
  wire round-trip test for the new snapshot fields.

---

## Knobs I chose (change freely)

- Spider-death penalty: **+5s** to itTimeMs; killed-by-spider also shows in results.
- Nest kill takes 400ms of contact — a brush past the web ring is escapable.
- Portals: 2s per-player cooldown, 1-2 pairs per map.
- Web root: 2.5s; beam KO: same duration as trap KO; beam cooldown 6s.
- Hazard spiders only on Manor + Forest (a nest spider on the spider-monster map reads
  as friendly-fire confusion; the hive's beam is its danger).

## Order & why

1 (themes) → 2 (portals) → 3 (nests) → 4 (monsters). Visual identity lands first and
is pure client; each sim phase is one new file + one snapshot bump; the monster phase
reuses the status effects proven in phases before it. Every phase ends green on:
`npm run typecheck && npm test && npm run build && npm run size && npm run check:browser`
plus the tools/stress load + leak run for the sim phases.
