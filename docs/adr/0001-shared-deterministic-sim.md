# ADR 0001 — One deterministic simulation, shared by client and server

**Status:** accepted

## Context
Echo Tag needs server authority (echo trails are the level, so a cheating client could rewrite the map),
client-side prediction (240 units/sec movement at 100ms+ RTT is unplayable without it), bots that behave
like players, and a way to balance-test 3-minute rounds without playing them.

## Decision
Game rules live in exactly one place: `@echo-tag/shared`, a dependency-free, DOM-free, IO-free module
exposing `stepWorld(world, inputs)`. The server wraps it for authority. The client wraps it for prediction.
Bots feed it input frames. The benchmark runs it headless.

World state is structure-of-arrays over typed arrays; a tick allocates nothing.

## Consequences
- Prediction can only ever diverge from packet loss, never from rule drift.
- Bots are indistinguishable from humans on the wire, because they *are* input frames.
- Authority can later move into a host client (Poki Netlib) without touching game logic.
- Cost: the sim may not use browser or node APIs, and its data layout is less ergonomic than plain objects.
