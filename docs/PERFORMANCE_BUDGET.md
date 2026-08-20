# Load Time & Performance Budget

Poki's bar: **initial load 1–4s, initial download <8MB, 30fps floor / 60fps target on mid-range phones.**
Our bar is much harder, because "near-zero loading" was the requirement: **interactive in under 300ms, fully playable under ~250KB brotli, and zero asset requests.**

## How "near-zero" is achieved

The trick isn't making one small bundle — it's making the *first* bundle small enough to be interactive on its own, and downloading the rest while the player is already looking at a Play button.

```
0ms      HTML (≈3KB, critical CSS inlined) arrives
~120ms   boot chunk (<16KB) parses → Canvas2D arena preview + Play button painted
         ├─ engine/net/game chunks stream in parallel (modulepreload)
         └─ websocket handshake starts NOW, not after the game chunk lands
~600ms   engine ready, preview cross-fades into the live PixiJS arena
first tap → PokiSDK.gameplayStart()  ← Poki requires this on first input, not on load
```

The player can press Play at ~120ms. Whether the engine arrived yet is invisible: the tap queues the join, and matchmaking's own budget is 2s anyway.

### The eight rules that keep it there

1. **Zero fetched assets.** No PNGs, no sprite sheets, no audio files, no webfonts. The square texture and the glow gradient are drawn into an `OffscreenCanvas` at boot; type is `system-ui`. Nothing in `public/` but a favicon.
   *This resolves a contradiction in the tech doc: §1 lists Aseprite sprite sheets and `AnimatedSprite`, while §3–4 specify code-generated squares with procedural animation. We go all-in on procedural — sprite sheets would reintroduce the asset pipeline the square approach exists to eliminate.*
2. **Two-stage boot.** `src/boot/` may not import PixiJS, React, or Colyseus. Enforced by the size gate.
3. **Preact via alias** instead of React DOM: same JSX, same hooks, ~40KB brotli cheaper. Reverting is a two-line change in `vite.config.ts` + `tsconfig.json` if a React-only library ever becomes necessary.
4. **PixiJS imported explicitly, WebGL only.** `new Application()` pulls in the WebGPU adapter and the `Assets` loader; we construct a `WebGLRenderer` directly and never touch `Assets`. Expect ~110–140KB brotli — measure with `npm run analyze` and keep it under the 160KB engine budget.
5. **No gsap** (~70KB for easing we can write in 30 lines) and **no nipplejs** (a floating joystick is ~2KB of pointer handling). Both are listed in the tech stack; both are cut. See `docs/adr/0003-drop-gsap-and-nipplejs.md`.
6. **No pixi-filters.** See the "It" glow section in `ARCHITECTURE.md`.
7. **Precompressed brotli + immutable hashed filenames**, so a returning player's load is a few 304s.
8. **CI gate.** `npm run size` fails the build on regression. A load-time budget that isn't enforced is a wish.

## Budget table (brotli)

| Chunk | Budget | Contents |
|---|---|---|
| `index.html` + inline CSS | 4 KB | shell, critical CSS, SDK tag |
| `boot` | 16 KB | preview render, Play button, input capture, dynamic import |
| `ui` | 12 KB | preact/compat + zustand + HUD/leaderboard |
| `net` | 25 KB | @colyseus/sdk |
| `game` | 40 KB | shared sim + renderers + animation + input |
| `engine` | 160 KB | PixiJS v8, WebGL path only |
| **Total** | **260 KB** | vs Poki's 8 MB ceiling |

## Runtime budget (per frame, 16.6ms at 60fps)

| Item | Budget | Note |
|---|---|---|
| Draw calls | ≤ 8 | 2 particle containers + arena + rings + HUD |
| Particles transformed | 7,200 | 12×180 live + 180×28 echo |
| Sim step | 0.4 ms | 20Hz, so only every 3rd frame |
| Allocations | **0** | typed arrays + pooled particles; any per-frame `new` is a bug |
| GC pauses | 0 visible | verified in the Chrome perf panel on a throttled profile |

## Verification, not vibes

- `npm run analyze` → treemap of what's actually in each chunk.
- `npm run bench:sim` → headless 12-player, 3-minute round; asserts step cost and zero-allocation.
- Chrome DevTools 4× CPU throttle + "Slow 4G" as the standing dev profile.
- Real-device pass on a mid-range Android (target: a ~2022 Snapdragon 6-series or equivalent) **before** the Poki Inspector run, not after.
