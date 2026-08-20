# Echo Tag — Phase Plan

Nine phases to a Poki-submittable MVP. Each has a **scope**, the **files it owns**, and an
**exit gate** that must be green before the next phase starts. Gates are commands, not
opinions — if it isn't checkable, it isn't a gate.

| Phase | | Est. | Status |
|---|---|---|---|
| 0 | Foundation & toolchain | 0.5 d | ✅ done |
| 1 | Deterministic simulation, headless | 2 d | ✅ done |
| 2 | Renderer & feel | 3 d | next |
| 3 | Input | 1 d | |
| 4 | Server authority | 2 d | |
| 5 | Prediction & smoothing | 2 d | |
| 6 | Bots & matchmaking | 1.5 d | |
| 7 | UI & Poki integration | 2 d | |
| 8 | Ship gate | 1.5 d | |
| | | **~15.5 d** | |

Running order is deliberate: **the two riskiest unknowns come first.** Phase 1 answers
"is the echo mechanic even simulable at 12 players?" and Phase 2 answers "is it
*readable*?" Both are cheaper to kill or reshape now than after a server exists.

---

## Phase 0 — Foundation & toolchain ✅

Workspace layout, verified-latest dependency set, TS 7 project references, CI with the
bundle-budget gate wired before there is any code to regress.

**Gate:** `npm run typecheck` clean on all three workspaces. ✅

**Settled here:**
- Node **24.18.1** (`.nvmrc`), which runs `.ts` files natively — no build step in dev, and
  the server's `start` script is just `node src/index.ts`.
- TypeScript **7.0.2**, the native compiler. It ships as **`tsc`**, not `tsgo` — the
  `@typescript/native-preview` package name from the preview period is gone.
- Imports carry explicit `.ts` extensions (`allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions`), because Node's native TS loader requires them.
- `@types/react`/`@types/react-dom` dropped: `preact/compat` ships its own React types.

---

## Phase 1 — Deterministic simulation, headless ✅

`@echo-tag/shared` only. No renderer, no server, no network, no DOM.

**Built:**

| File | Role |
|---|---|
| `constants.ts` | every tunable, single source of truth |
| `math/vec2.ts` `math/rng.ts` | allocation-free helpers; seeded xorshift32 |
| `math/spatial-hash.ts` | counting-sort uniform grid over echo bodies |
| `math/collision.ts` | circle-vs-circle, slide along contact normal |
| `sim/world.ts` | SoA `World` over typed arrays; spawn, join, leave |
| `sim/input.ts` | one-byte input codec (16 headings x 3 magnitudes) |
| `sim/echo.ts` | 3s ring buffers, derived solid bodies, join-blob codec |
| `sim/tag.ts` | tag transfer, immunity, tag-back cooldown |
| `sim/player.ts` | per-player integration |
| `sim/step.ts` | **the** tick; phase machine |
| `sim/leaderboard.ts` | ranking by It-time |
| `sim/sim.test.ts` | 22 invariant tests |
| `tools/bench/sim-bench.ts` | the gate |

**Gate:** `npm run test` (22/22) and `npm run bench:sim`. ✅

```
PASS A  step cost
  mean 0.0052 ms   p50 0.0051 ms   p95 0.0062 ms   p99 0.0087 ms
  budget 0.4000 ms/tick  →  1.3% used at the mean
  21.6 ms to simulate 181.5s of play (8407x realtime)

PASS B  allocation — scavenges over 120,000 ticks, 1MB young gen
  floor      7   (input driver only)
  real       9   (+ stepWorld)          → 2 above floor
  control   35   (+ 1 object / tick)   → 28 above floor, gate is sensitive
```

**Design questions this phase answered:**

- *Is the mechanic simulable at 12 players?* Comfortably. 180 solid echo bodies, 78x under
  the step budget, ~8400x realtime. Server cost per room is negligible; the constraint
  will be rendering and bandwidth, not simulation.
- *Does the round produce a real spread of It-time?* Yes — 37 tags in 3 minutes, best
  player 0.0s as It, worst 90.2s. The scoring discriminates, which is what makes a
  leaderboard worth showing.
- *What shape is an echo, exactly?* Settled: the last 3 seconds of a player's path,
  sampled every 4th tick into 15 solid bodies. The ring rolls each tick, so the maze
  shifts continuously with no per-echo state — this is what "ghosts are not frozen"
  (GDD §3.1) means mechanically.

**Two allocation bugs the gate caught** — both worth knowing about, because the same
mistake is easy to repeat in Phase 2's renderer:

1. **Module-scope `let` doubles box a HeapNumber on every write.** `resolveEchoCollisions`
   was first written as `forEachNear(hash, x, y, visit)` with the working position and
   velocity in module-scope `let`s so the visitor callback could reach them. Module
   variables live in the module context rather than in registers, so each write of a
   double allocated. Cost: ~175 bytes/tick. Fixed by inlining the 3x3 cell walk so
   px/py/vx/vy are true function locals.
2. **A local that is sometimes a Smi and sometimes a double gets boxed too.** The arena
   clamp read a float out of `Float32Array` into a `let`, then conditionally assigned the
   integer bound to it. That mixed representation cost ~45 bytes/tick. Fixed by writing
   the bound straight into the typed array instead of through a local.

Neither is visible in `heapUsed` — which drifts by hundreds of KB from JIT bookkeeping —
and neither is visible to `performance.now()` instrumentation, because **`performance.now()`
itself allocates ~128 bytes per call**. Hence the bench's two-pass design, and its
self-test: the control mode must register, or the gate is not to be trusted.

---

## Phase 2 — Renderer & feel `~3 days`  ← next

**Scope:** the arena on screen at 60fps, and the avatars feeling good to move.

1. `engine/textures.ts` — generate an 8x8 white square and a soft radial gradient into an
   `OffscreenCanvas`. These are the only "assets" the game has; nothing is fetched.
2. `engine/app.ts` — construct a `WebGLRenderer` directly. Do **not** use `new Application()`
   (drags in the WebGPU adapter) and never touch `Assets`.
3. `render/templates.ts` — humanoid masks as flat `Uint8Array` grids, ~180 filled cells, for
   idle / walk-a / walk-b / tagged.
4. `render/squareBody.ts` + `engine/layers.ts` — two `ParticleContainer`s; each player owns a
   contiguous 180-particle slice allocated once at round start.
   **v8 constraint:** a `ParticleContainer` holds `Particle` objects, supports no children,
   no filters, no interaction. Characters are *not* nested containers.
5. `render/playerRenderer.ts` / `echoRenderer.ts` — per-frame writes to `x/y/scaleX/scaleY/tint`
   only. Never re-walk a template, never construct a `Particle` mid-round.
6. `anim/procedural.ts` — idle bob, walk cycle, squash-stretch on acceleration, eye-look on
   heading, tagged scatter-and-snap.
7. `render/fx.ts` — the "It" ring as an additive radial sprite, pulsed by scale and alpha.
8. `engine/camera.ts` — fit 16:9; portrait scales the whole arena down rather than cropping,
   HUD and banner live in the letterbox.
9. `engine/ticker.ts` — fixed-step accumulator for the sim, variable-step render interpolation.

**Gate:** 60fps with 12 players at full echo density on a 4x-CPU-throttled profile, and
≤8 draw calls in the Pixi devtool. Extend `tools/bench` with a draw-call assertion.

**The real question this phase answers:** at 2:30 with 12 players there are 180 echo
silhouettes on screen. Is that readable, or is it soup? `ECHO_STRIDE` and `ECHO_ALPHA` exist
in `constants.ts` to be tuned here. If it is unreadable, cap bodies-per-player — do *not*
shorten the 3-second window, which is the game's identity.

---

## Phase 3 — Input `~1 day`

- `input/detect.ts` — pointer-type + coarse-media detection. Keyboard and touch stay live
  simultaneously (iPad with a keyboard case must work without a mode switch).
- `input/keyboard.ts` — WASD **and** arrows at once, normalised to a direction vector.
- `input/joystick.ts` — floating joystick: 110px base, 55px knob, 10px dead zone, 20px
  safe-area inset clear of the iOS home bar and Android back gesture, ~55% idle opacity.
- `input/inputBuffer.ts` — ring buffer of unacked input bytes for Phase 5.

**Gate:** on a real phone, a full round played on touch with no mis-taps at the screen
edges, in both orientations. This one is hands-on; there is no substitute.

---

## Phase 4 — Server authority `~2 days`

- `rooms/ArenaRoom.ts` — owns a `World`, drives it from `setSimulationInterval(TICK_MS)`.
- `rooms/state/*` — Colyseus Schema for **cold state only**: phase, clock, names, colour
  slots, `itTimeMs`, `isBot`. Positions do **not** go through Schema.
- Binary snapshot: `[tick:u16][count:u8]{id:u8, x:i16, y:i16, flags:u8}` ≈ 72 bytes at 20Hz.
- On join: one `writeHistoryBlob` (~2.9KB) so a late arrival sees the identical maze.
- `matchmaking/filter.ts` — accept joins only in Lobby or early Playing; nobody should drop
  into a dense arena at 2:40.
- `net/antiCheat.ts` — clamp input magnitude, reject stale sequence numbers, cap per-tick
  position delta.

**Colyseus 0.17 API notes:** `Room<{ state: S }>` (one generic object), `onLeave(client, code: number)`,
`seatReservationTimeout` as a property, `defineServer({ rooms: { arena: defineRoom(ArenaRoom) }, transport, express })`,
uWS transport needs `uwebsockets-express@^2` with Express 5.

**Gate:** 12 clients via `@colyseus/loadtest` hold a full round; measured downstream stays
under 2 KB/s per client.

---

## Phase 5 — Prediction & smoothing `~2 days`

- `net/prediction.ts` — apply local input immediately through the *same* `stepWorld`.
- `net/reconcile.ts` — on each snapshot, rewind the local player to the server tick, replay
  buffered inputs, ease the residual error out over ~80ms rather than snapping.
- `net/interpolation.ts` — remotes rendered `INTERP_DELAY_MS` (100ms) behind a snapshot
  buffer, which also smooths their trails.

**Gate:** playable and fair at 150ms RTT with 3% loss (DevTools throttling, verified with
`@colyseus/loadtest`). Specifically: no rubber-banding through echo walls, and a tag that
looks like a hit is a hit.

**Watch for:** reconciliation replays `stepWorld` up to N times in one frame, so Phase 1's
allocation-free property is what keeps this from causing GC hitches. Re-run `npm run bench:sim`
after any sim change made during this phase.

---

## Phase 6 — Bots & matchmaking `~1.5 days`

- `ai/bot.ts` + `ai/steering.ts` — bots emit the same input bytes as humans: seek when It,
  flee when not, avoid echoes via a short raycast fan, with a deliberately capped reaction
  time so humans can out-play them.
- `matchmaking/botFill.ts` — start after `MAX_LOBBY_WAIT_MS` (2s), fill to `MIN_PLAYERS`.

**Gate:** a human of average skill finishes mid-table against 11 bots, not first and not
last, across 10 rounds. Bots that win are worse than bots that are obvious.

**Open question:** `MIN_PLAYERS = 8` makes an off-peak round feel busy but also visibly
bot-heavy. Revisit with real numbers here.

---

## Phase 7 — UI & Poki integration `~2 days`

- `ui/Landing` — arena preview plus Play. `boot/` stays under 16KB and must not import
  PixiJS, Preact or Colyseus.
- `ui/Hud` — round clock, and **your own rising It-time bar**. A number in a corner is not
  enough: "minimise It-time" is less immediately legible than "survive", so the cost of
  being It has to be felt continuously.
- `ui/Leaderboard` — ranking, plus the last-place gag (playful, never punishing).
- `platform/poki.ts` — `init()` → `gameLoadingFinished()` → **`gameplayStart()` on first
  input, never on load** → `gameplayStop()` at round end and on tab blur →
  `commercialBreak()` between rounds, before the next `gameplayStart()`. Audio and input
  muted during breaks.
- `platform/auds.ts` — settings and personal best via AUDS, wrapped so it always resolves
  and never blocks play.
- `platform/visibility.ts` — blur/focus to `gameplayStop`/`gameplayStart` plus an input
  flush, so backgrounding cannot desync.

**Gate:** `npm run build && npm run size` under 260KB brotli, with `boot` under 16KB.

---

## Phase 8 — Ship gate `~1.5 days`

- Real mid-range Android and iOS Safari, portrait and landscape.
- Strip dev artefacts: `/playground`, `/monitor`, `DEV_TOOLS`, all logging.
- Poki Inspector run.
- Walk `Echo_Tag_Tech_Theme_Poki_Requirements.md` §8 line by line.

**Gate:** the §8 checklist, every box, on real hardware.

---

## Standing rules

1. **`Echo-Tag-Frontend/src/boot/` may not import PixiJS, Preact or Colyseus.** Enforced by
   `npm run size`.
2. **No frame may allocate.** Typed arrays in the sim, pooled particles in the renderer. A
   per-frame `new` is a bug. `npm run bench:sim` guards the sim; Phase 2 adds the renderer's
   equivalent.
3. **Game rules live only in `@echo-tag/shared`.** If the server and client can disagree
   about a rule, prediction is broken by construction.
4. **`npm run verify` before every commit** — typecheck, tests, bench.
