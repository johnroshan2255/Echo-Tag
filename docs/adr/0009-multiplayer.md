# ADR 0009 — Multiplayer: quick match, private rooms by code, bots as the floor

**Status:** accepted (user direction). Pulls Phase 4 forward, with prediction-lite in
place of Phase 5's full reconciliation.

## The three ways in (the menu)
- **PLAY** — the local bots round. Instant, serverless, unchanged. Poki's zero-friction path.
- **QUICK MATCH** — `joinOrCreate` into a shared public pool. The room arms a 2s clock on
  the first human, then starts with bots filling to MIN_PLAYERS. Nobody ever waits.
- **HOST ROOM / JOIN** — the host creates a room keyed by a 5-letter code (no I/L/O — codes
  get read aloud) and shares it; friends join with the code; the host presses start; bots
  fill the empty seats. Max 12 humans everywhere.

## Server
One `ArenaRoom` = one authoritative shared-sim `World` at 20Hz — authority is a thin shell
around the same `stepWorld` the client runs (ADR 0001). Humans contribute one input byte per
tick (sequence-checked); bot slots run the shared synthetic driver; a human joining a full
bot-filled room reclaims a bot seat. Cold state (roster, phase, host, scores-per-second)
rides Colyseus Schema; hot state is the hand-packed ~90-byte snapshot (ADR 0004): positions,
door bytes, hidden bits. Echo trails never touch the wire — the welcome message carries the
full history ring once (~2.9KB), then every client reconstructs echoes from the position
stream, bit-identical to the server.

Privacy is matchmaking-pool separation: `filterBy(['code'])` keys pools by the code option,
so quick-match (code '') can never route into a keyed room. NOT `setPrivate()` — that hides
the room from join-by-code too, which cost an hour. A wrong code is refused, never silently
given a fresh empty room.

## Client
The net driver keeps a *mirror* `World` filled from snapshots; because every renderer reads
a `World`, the presentation stack is identical in both modes — that was the bet of the
Phase 4 design and it paid in full. The local avatar gets prediction-lite: inputs apply
immediately through the same `integratePlayer` against mirrored geometry, with the server's
answer blended at 12%/tick and a snap only past a body-length of error. Full
rewind-and-replay reconciliation remains the Phase 5 upgrade path.

## Verified
`npm run check:mp` — a protocol probe (14 assertions: pooling, welcome/keys/history,
bot fill, input→movement, replication, code semantics, host-start) plus a two-browser e2e:
strangers pair up, keyboard movement on one screen appears on the other, round clocks agree
to the millisecond, a hosted room's on-screen code admits a friend.

## Traps recorded
- schema v4 encodes via `Symbol.metadata`; `defineTypes` + declared class fields crashes on
  first full-state encode. Use the `schema()` factory on a decorator-less runtime.
- Node's native TS runs the server unbuilt (`node src/index.ts`) — but only because the
  schema uses no decorators; type-stripping does not transform decorator syntax.
