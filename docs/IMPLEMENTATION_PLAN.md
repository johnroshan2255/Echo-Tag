# Echo Tag — Implementation Plan

**Status:** skeleton scaffolded, ready to build.
**Companion docs:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`PERFORMANCE_BUDGET.md`](PERFORMANCE_BUDGET.md) · [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) · [`adr/`](adr/)

---

## 1. Locked stack (verified latest, August 2026)

| Layer | Package | Version | Notes |
|---|---|---|---|
| Renderer | `pixi.js` | **8.19.0** | WebGL2 path only; v8 `ParticleContainer` + `Particle` API |
| Build | `vite` | **8.2.2** | Rolldown bundler + LightningCSS. Needs Node `^20.19` \|\| `>=22.12` |
| Language | `typescript` | **7.0.2** | the native compiler; `tsgo` for typecheck. Vite transpiles, TS only types |
| UI | `preact` 10.28 via `preact/compat` | | React 19.2.8 API, ~40KB brotli cheaper — [ADR 0002](adr/0002-preact-alias.md) |
| UI state | `zustand` | **5.0.15** | menus/leaderboard only, never per-frame |
| Server | `colyseus` / `@colyseus/core` | **0.17.10 / 0.17.50** | `defineServer`/`defineRoom` API |
| Schema | `@colyseus/schema` | **4.0.31** | cold state only |
| Client SDK | `@colyseus/sdk` | **0.17.43** | replaces the old `colyseus.js` package |
| Transport | `@colyseus/uwebsockets-transport` + `uwebsockets-express` | 0.17.21 / 2.0.4 | uWS needs `uwebsockets-express@^2` with Express 5 |
| Web server | `express` | **5.2.1** | |
| Platform | Poki HTML5 SDK v2 + AUDS | script tag | `https://game-cdn.poki.com/scripts/v2/poki-sdk.js` |
| Package manager | npm workspaces | npm 10.8 | no extra tooling to install |

**Dropped from the original tech doc, deliberately:** `pixi-filters`, `gsap`, `nipplejs`, Aseprite sprite sheets, `react-dom`. Each is replaced by a few KB of our own code. Reasons in [ADR 0003](adr/0003-drop-gsap-and-nipplejs.md) and `PERFORMANCE_BUDGET.md`.

**Colyseus 0.17 API notes** (it changed a lot; these will bite otherwise):
- `Room<{ state: MyState }>` — one generic object, not `Room<State, Metadata>`.
- `onLeave(client, code: number)` — a close code now, not a `consented` boolean.
- `setSeatReservationTime()` → the `seatReservationTimeout` property.
- Room `protected` members are now private; reach them via `this['name']()` if you must.
- Bootstrap is `defineServer({ rooms: { arena: defineRoom(ArenaRoom) }, transport, express })`.

---

## 2. Folder structure (created)

```
Echo-Tag/
├─ package.json                  npm workspaces root + scripts
├─ tsconfig.base.json / tsconfig.json    TS 7 project references
├─ .nvmrc  .gitignore  .editorconfig
│
├─ docs/                         ← design + plan + ADRs (source docs moved here)
│
├─ Echo-Tag-Shared/              @echo-tag/shared — ZERO dependencies
│  └─ src/
│     ├─ constants.ts            every tunable, single source of truth
│     ├─ types.ts
│     ├─ math/                   vec2 · rng · collision · spatial-hash
│     ├─ sim/                    world · player · echo · tag · step · input
│     ├─ ai/                     bot · steering        (bots feed the same input path)
│     └─ protocol/               messages · encode     (binary snapshot codec)
│
├─ Echo-Tag-Server/              @echo-tag/server
│  ├─ app.config.ts              defineServer bootstrap
│  └─ src/
│     ├─ index.ts
│     ├─ rooms/ArenaRoom.ts      owns a shared-sim World at 20Hz
│     ├─ rooms/state/            ArenaState · PlayerState (cold state only)
│     ├─ matchmaking/            filter (join-early-rounds-only) · botFill
│     ├─ net/                    rate-limit · antiCheat
│     └─ config/env.ts
│
├─ Echo-Tag-Frontend/            @echo-tag/frontend
│  ├─ index.html  vite.config.ts
│  └─ src/
│     ├─ boot/                   ← TINY. may not import pixi/preact/colyseus
│     ├─ app/                    mount · store
│     ├─ game/
│     │  ├─ GameCanvas.tsx       React↔Pixi seam, zero per-frame props
│     │  ├─ engine/              app · ticker · camera · layers · textures
│     │  ├─ render/              templates · squareBody · playerRenderer · echoRenderer · arena · fx
│     │  ├─ anim/                easing · procedural
│     │  ├─ net/                 room · prediction · reconcile · interpolation
│     │  └─ input/               detect · keyboard · joystick · inputBuffer
│     ├─ ui/                     Landing · Hud · Leaderboard · Overlay
│     ├─ platform/               poki · auds · visibility
│     └─ styles/
│
├─ tools/
│  ├─ bench/                     headless sim benchmark
│  └─ ci/size-check.mjs          bundle budget gate (fails the build)
└─ .github/workflows/ci.yml
```

Why the shared package earns its keep: it is the reason prediction, bots, and load tests are cheap instead of three separate implementations of the same rules. It must stay dependency-free and DOM-free.

---

## 3. Build order

### Phase 0 — Foundation `~0.5 day`
Install, wire project references, confirm `tsgo` typecheck + `vite build` + `npm run size` all run green on the empty skeleton. Get the CI gate passing *before* there's code to regress.

### Phase 1 — The sim, headless `~2 days`  ← highest risk, do it first
`Echo-Tag-Shared` only. No renderer, no server, no network.
- SoA `World` over typed arrays; fixed 20Hz `stepWorld(world, inputs)`.
- Echo ring buffers (`ECHO_SAMPLES = 60`), echo bodies at `ECHO_STRIDE`.
- Collision: circle-vs-circle via spatial hash, **slide along the contact normal** — a hard stop makes being blocked feel like a bug.
- Tag transfer, `TAG_IMMUNITY_MS`, per-player `itTimeMs` accumulation.
- `ECHO_GRACE_MS` so your freshest echoes don't trap you against yourself.
- **Exit gate:** `npm run bench:sim` runs a full 12-player 180s round headlessly, asserts step cost <0.4ms and **zero allocations** after warmup.

*Why first:* if 3-second rolling echoes at 12 players produce an unplayable arena, that's a design problem, and it is far cheaper to discover it in a benchmark than after building a renderer for it.

### Phase 2 — Renderer & feel `~3 days`
- Runtime textures (8×8 white square, radial gradient) into `OffscreenCanvas`. No files.
- `templates.ts`: humanoid masks as flat `Uint8Array` (~180 filled cells) for idle / walk-a / walk-b / tagged.
- Two `ParticleContainer`s, per-player contiguous slices, allocated once. Animation writes `x/y/scale/tint` only — **never** re-walk the template or create a `Particle` mid-round.
- Procedural animation: idle bob (sine), walk cycle (leg-square offsets), squash-stretch on accel, eye-look on direction, tagged scatter-and-snap.
- Echo silhouettes at 28 squares / `ECHO_ALPHA`.
- "It" ring as an additive radial sprite, pulsed — **not** `GlowFilter`.
- Camera: fit 16:9, portrait scales down (never crops), HUD in the letterbox.
- **Exit gate:** 60fps with 12 dummy players + full echo density on a 4×-throttled profile; ≤8 draw calls in the Pixi devtool.

### Phase 3 — Input `~1 day`
Keyboard (WASD **and** arrows, both live at once) + floating joystick (110/55px, 10px dead zone, 20px safe-area inset, ~55% idle opacity). Capability-detected, both schemes simultaneously active for iPad-with-keyboard. Input frames into a ring buffer for reconciliation.

### Phase 4 — Server authority `~2 days`
`ArenaRoom` running the shared sim on `setSimulationInterval(TICK_MS)`. Cold state in Schema; hot positions in the binary codec. Round lifecycle: `LOBBY → COUNTDOWN → PLAYING → LEADERBOARD`. On join: send the one-time 12×60 history ring so late joiners see the same maze. Anti-cheat = clamp input magnitude, reject stale sequence numbers, cap per-tick position delta.

### Phase 5 — Prediction & smoothing `~2 days`
Predict the local player, interpolate remotes 100ms behind, reconcile by rewind-and-replay with error eased over ~80ms. **Exit gate:** playable and fair at 150ms RTT with 3% packet loss (throttle in DevTools; verify with `@colyseus/loadtest`).

### Phase 6 — Bots & matchmaking `~1.5 days`
Bot brains emitting the same input frames as humans: seek when It, flee when not, avoid echoes via a short raycast fan, with a deliberately capped reaction time so humans out-play them. `MAX_LOBBY_WAIT_MS = 2000` then fill to `MIN_PLAYERS`. Rooms only accept joins in `LOBBY`/early `PLAYING` so nobody drops into a dense arena at 2:40.

### Phase 7 — UI, Poki integration, polish `~2 days`
- Landing (arena preview + Play), HUD (round clock + **your rising It-time bar** — see risk #2 in the competitive analysis), leaderboard with the last-place gag.
- `PokiSDK.init()` → `gameLoadingFinished()` → **`gameplayStart()` on first input, never on load** → `gameplayStop()` at round end / tab blur → `commercialBreak()` between rounds, before the next `gameplayStart()`. Audio and input muted during breaks.
- AUDS for settings/best It-time, wrapped so it always resolves and never blocks play.
- Tab visibility → `gameplayStop` + input flush, so backgrounding can't desync.

### Phase 8 — Ship gate `~1.5 days`
Real mid-range Android + iOS Safari pass, portrait and landscape. Strip all dev code (`/playground`, `/monitor`, logs). Poki Inspector run. Walk `docs/Echo_Tag_Tech_Theme_Poki_Requirements.md` §8 line by line.

**Total: ~15–16 working days** to a submittable MVP.

---

## 4. Open questions worth deciding early

1. **Echo density at 2:30.** Playtest gate at the end of Phase 2. `ECHO_STRIDE`/`ECHO_ALPHA` exist to be tuned; if 180 echo bodies is unreadable, cap bodies-per-player rather than shortening the 3s window — the 3 seconds is the identity of the game.
2. **Hosting cost.** Colyseus needs a real server (a small VPS handles many 12-player rooms; positions are only ~1.4KB/s per client). Poki Netlib P2P is the zero-cost path but hands the level geometry to a host client. Launch authoritative; keep `net/room.ts` as the swap seam.
3. **Do we need the 8-player minimum?** `MIN_PLAYERS = 8` bot-fills to a busy arena, which is good for feel and bad for how obviously bot-y an off-peak round looks. Revisit after Phase 6.
4. **Round-end ad cadence.** `commercialBreak()` between every round is the revenue-maximal read of the SDK docs, but Poki decides actual fill; verify pacing doesn't fight the "instant requeue" loop.
