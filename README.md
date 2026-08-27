# Echo Tag

A 3-minute multiplayer browser tag game. The ghost — the player who is "It" — leaves a
**rolling 3-second echo** of its own movement behind it; walk into that trail and you black out
where you stand. Humans leave no trail. Nobody is eliminated. The only goal: **spend as little
time as "It" as possible.**

Built for Poki: no login, no lobby, interactive in under 300ms.

## Repo layout

| Path | What's in it |
|---|---|
| `Echo-Tag-Shared/` | `@echo-tag/shared` — the deterministic simulation, protocol and every tunable. Zero dependencies. |
| `Echo-Tag-Server/` | Authoritative Colyseus room server. Runs the shared sim at 20Hz. |
| `Echo-Tag-Frontend/` | PixiJS v8 (WebGL) arena inside a Preact UI shell. |
| `docs/` | Design doc, tech/platform requirements, implementation plan, ADRs. |
| `tools/` | Headless sim benchmark and the CI bundle-budget gate. |

**Status:** playable end-to-end — sim, renderer, fogged maps with doors and wardrobes,
touch input, Colyseus multiplayer, synthesised audio, and the Poki packaging pipeline.
See [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) for what remains before the ship gate.

## Start here

1. [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) — all nine phases, what each owns, and its exit gate.
2. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — locked stack and versions.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — why one shared sim, and why echoes never touch the network.
4. [`docs/PERFORMANCE_BUDGET.md`](docs/PERFORMANCE_BUDGET.md) — how "near-zero load" is achieved and enforced.
5. [`docs/COMPETITIVE_ANALYSIS.md`](docs/COMPETITIVE_ANALYSIS.md) — Curve Fever and the past-self lineage.

## Run it

```bash
nvm use && npm install
npm run dev            # → http://localhost:5173
```

Node **24.18.1** (from `.nvmrc`) runs `.ts` natively, so there is no build step in
development. npm workspaces; no other package manager needed.

## Check it

```bash
npm run verify         # ~3s   types + 78 tests (sim invariants + render templates) + step-cost/allocation gate
npm run check          # ~15s  the above + bundle budget + headless Chrome, 3 viewports
```

Full detail, and the two things the browser check deliberately cannot prove, are in
[`docs/RUNNING.md`](docs/RUNNING.md).

## All commands

```bash
npm run dev                     # Vite dev server, :5173
npm run dev:server              # Colyseus, :2567 (not needed until Phase 4)
npm run typecheck               # TypeScript 7 across project references
npm run test                    # simulation invariants (node:test)
npm run bench:sim               # 12-player 3-minute round; step cost + allocation gate
npm run verify                  # typecheck + test + bench — before every commit
npm run build                   # shared -> server -> frontend
npm run size                    # bundle budget gate
npm run check                   # build + size + headless Chrome check
npm run check:browser -- --headed   # same browser check, visible window
npm run analyze                 # treemap of what is in each chunk
```

## Two rules that keep the game fast

1. **`Echo-Tag-Frontend/src/boot/` may not import PixiJS, Preact or Colyseus.** It is the chunk that makes
   the game interactive in ~120ms; `npm run size` enforces its 16KB ceiling.
2. **No frame may allocate.** The sim uses typed arrays, the renderer uses pooled particles. A per-frame
   `new` is a bug, not a style preference.
