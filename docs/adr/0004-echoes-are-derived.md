# ADR 0004 — Echoes are derived on the client, never transmitted

**Status:** accepted

## Context
Each of 12 players carries 60 position samples (3s at 20Hz). Sending echo geometry in each snapshot is
~2.9KB per tick, ~57KB/s per client at 20Hz — untenable on mobile data and pointless, because an echo
is a pure function of a position stream every client already receives.

## Decision
Snapshots carry current positions only (`[tick:u16][count:u8]{id:u8,x:i16,y:i16,flags:u8}`, ~72 bytes).
Each client keeps its own 60-sample ring buffer per player and renders/collides echoes from it. On join,
the server sends the full 12×60 ring once (~2.9KB) so late joiners see an identical arena.

The server keeps the same buffers and resolves echo collisions itself — authority is unchanged. It simply
never needs to *describe* the trails.

## Consequences
- ~1.4KB/s down instead of ~57KB/s: a 40× reduction.
- Requires the shared deterministic sim (ADR 0001) — client-side reconstruction must match authority exactly.
- Quantising positions to i16 is the precision floor; it is invisible at our zoom level.
