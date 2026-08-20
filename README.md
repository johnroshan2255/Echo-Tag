# Echo Tag

A 3-minute multiplayer browser tag game. Every player leaves a **rolling 3-second echo** of their own
movement behind them — and those echoes are solid. The arena builds its own maze as the round runs.
Nobody is eliminated. The only goal: **spend as little time as "It" as possible.**

Built for Poki: no login, no lobby, interactive in under 300ms.

## Repo layout

| Path | What's in it |
|---|---|
| `Echo-Tag-Shared/` | `@echo-tag/shared` — the deterministic simulation, protocol and every tunable. Zero dependencies. |
| `Echo-Tag-Server/` | Authoritative Colyseus room server. Runs the shared sim at 20Hz. |
| `Echo-Tag-Frontend/` | PixiJS v8 (WebGL) arena inside a Preact UI shell. |
| `docs/` | Design doc, tech/platform requirements, implementation plan, ADRs. |
| `tools/` | Headless sim benchmark and the CI bundle-budget gate. |

**Status:** Phase 1 of 8 complete — the simulation is built, tested and benchmarked. Renderer next.

## Start here

1. [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) — all nine phases, what each owns, and its exit gate.
2. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — locked stack and versions.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — why one shared sim, and why echoes never touch the network.
4. [`docs/PERFORMANCE_BUDGET.md`](docs/PERFORMANCE_BUDGET.md) — how "near-zero load" is achieved and enforced.
5. [`docs/COMPETITIVE_ANALYSIS.md`](docs/COMPETITIVE_ANALYSIS.md) — Curve Fever and the past-self lineage.

## Requirements

Node **24.18.1** — `nvm use` picks it up from `.nvmrc`. npm workspaces; no other package
manager needed. Node 24 runs `.ts` files natively, so there is no build step in development.

## Commands

```bash
npm install            # install all three workspaces
npm run dev:server     # Colyseus, :2567
npm run dev:web        # Vite, :5173
npm run typecheck      # TypeScript 7 (tsc) across project references
npm run test           # simulation invariants (node:test)
npm run bench:sim      # headless 12-player 3-minute round; step cost + allocation gate
npm run verify         # typecheck + test + bench — run this before committing
npm run build          # shared -> server -> frontend
npm run size           # bundle budget gate — fails if load time regresses
npm run analyze        # treemap of what's in each chunk
```

## Two rules that keep the game fast

1. **`Echo-Tag-Frontend/src/boot/` may not import PixiJS, Preact or Colyseus.** It is the chunk that makes
   the game interactive in ~120ms; `npm run size` enforces its 16KB ceiling.
2. **No frame may allocate.** The sim uses typed arrays, the renderer uses pooled particles. A per-frame
   `new` is a bug, not a style preference.
