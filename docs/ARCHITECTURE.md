# Echo Tag — Architecture

## The one decision everything else follows from

**The simulation is a pure, deterministic module in `Echo-Tag-Shared`, and it is the only place game rules exist.**

```
                    ┌──────────────────────────────┐
                    │  @echo-tag/shared            │
                    │  stepWorld(world, inputs)     │  ← no I/O, no DOM, no node
                    │  + constants + collision      │
                    └───────┬───────────────┬──────┘
                            │               │
          ┌─────────────────▼──┐         ┌──▼────────────────────┐
          │ Server (authority) │         │ Client (prediction)   │
          │ Colyseus ArenaRoom │◄───────►│ Pixi renderer + UI    │
          │ 20Hz fixed step    │  binary │ 60fps interpolated    │
          │ + bot inputs       │snapshots│ + local reconcile     │
          └────────────────────┘         └───────────────────────┘
```

Because both sides run the *same* `stepWorld`, we get for free:
- client-side prediction that cannot drift on rules (only on packet loss),
- bots that are literally just another input source — indistinguishable on the wire,
- headless simulation for balance tests and load tests (`tools/bench`),
- the option to move authority into a host client later (Poki Netlib) without touching game logic.

Data layout in the sim is **structure-of-arrays over typed arrays**, not objects: `x: Float32Array(12)`, `y: Float32Array(12)`, etc. A tick allocates nothing, so there is no GC sawtooth on mid-range Android.

---

## Echoes are derived, never transmitted

This is the highest-leverage networking decision in the project.

An echo is *entirely* a function of a player's past position. Every client already receives every player's position stream at 20Hz. So the server sends **only current positions**, and each client keeps a 60-sample ring buffer per player and derives the trail bodies from `buffer[(head - 60 + i) % 60]`.

Only the ghost's bodies are ever *live*, and only from the crowning tick on (ADR 0013 — humans leave no trail, and a new ghost's trail starts empty and grows over 3s). The rings are still kept for **all** players; each snapshot carries `itSlot` plus a 2-byte `itAgeTicks`, so every client — late joiners included — gates the trail exactly as the server collides with it.

| | Naive (echoes on the wire) | Derived (chosen) |
|---|---|---|
| Per-snapshot payload | 12 players × 60 samples × 4B ≈ **2.9 KB** | 12 players × 6B ≈ **72 B** |
| At 20 Hz | ~57 KB/s down | **~1.4 KB/s down** |

The only time history crosses the network is **once, on join**: the server sends the full 12×60 ring so a late joiner sees the arena exactly as everyone else does. That is a single ~2.9 KB message.

Authority still lives on the server — it runs the same buffers and resolves echo collisions itself, so a modified client cannot walk through trails. It just doesn't need to *describe* them.

---

## Netcode

- **Transport:** Colyseus 0.17 over uWebSockets.js.
- **Colyseus Schema is used only for cold state** — round phase, clock, player names, colour slots, `itTimeMs`, `isBot`. It is a great fit for low-frequency, diff-tracked data.
- **Hot state bypasses Schema.** Positions go out as a hand-packed `ArrayBuffer` via `room.send`/raw broadcast: `[tick:u16][count:u8]{id:u8, x:i16, y:i16, flags:u8}`. Quantising to i16 at 1 unit precision is invisible at our zoom and avoids Schema's per-field change-tracking cost 20 times a second.
- **Client → server:** one byte of direction (16 octants + magnitude bucket) plus a `u16` sequence number, at 20Hz. Inputs are buffered so a dropped packet is recoverable.
- **Reconciliation:** on each snapshot the client rewinds the local player to the server tick, replays unacked inputs through `stepWorld`, and eases the residual visual error over ~80ms rather than snapping.
- **Remote players** are rendered `INTERP_DELAY_MS` (100ms) behind on a snapshot buffer, which also makes their echo trails perfectly smooth.

### Why Colyseus and not Poki Netlib
Netlib is P2P WebRTC with no dedicated server — free to run, and Poki prefers it. But Echo Tag's obstacles *are* movement history, which makes a cheating host able to rewrite the level for everyone. Launch authoritative on Colyseus. Because authority is a thin shell around `stepWorld`, a Netlib host-authoritative build is a later cost optimisation, not a rewrite. `src/game/net/room.ts` is the seam.

---

## Rendering

Two `ParticleContainer`s and roughly two draw calls for the entire arena.

**PixiJS v8 changes the rules here, and the tech doc predates it:** a v8 `ParticleContainer` holds `Particle` objects — not `Sprite`s — and supports **no children, no filters, no interaction**. So characters cannot be "a Container of square sprites added to a ParticleContainer."

What we do instead:

1. One `ParticleContainer` for live bodies, created with `dynamicProperties: { position: true, color: true, rotation: false, scale: true, uvs: false, vertex: false }`.
2. Each player owns a **contiguous slice** of that container's particle array (`SQUARES_PER_PLAYER = 180`, so player *n* owns `[n*180, (n+1)*180)`). Slices are allocated once at round start and never resized.
3. Animation writes `particle.x/y/scaleX/scaleY/tint` for its own slice each frame. The grid template is never re-walked, and no object is ever created.
4. A second `ParticleContainer` holds echo silhouettes (`ECHO_SQUARES = 16` each) at `ECHO_ALPHA`. Capacity covers all 180 body ids, but only the ghost's 15 bodies are ever live (ADR 0013) — the rest stay parked off-world.
5. Every particle shares **one runtime-generated 8×8 white square texture**, so batching is perfect.

Budget: `12 × 168 body + 180 × 16 echo = 4,896` particles. That is well inside v8's ParticleContainer envelope on mid-range mobile.

### The "It" glow, without pixi-filters
`GlowFilter` cannot be applied to a ParticleContainer, and filters mean an extra render target and a full-screen pass — expensive on low-end GPUs. Instead the "It" indicator is a single **additively-blended radial-gradient sprite** drawn under the player, pulsed by scaling and alpha. It reads better at small sizes, costs one quad, and lets us drop the `pixi-filters` dependency entirely.

---

## React's role (and how it stays out of the way)

React (as `preact/compat`) renders **menus, HUD, leaderboard — nothing per frame.** The rules:

- The canvas is created and driven outside React. `GameCanvas.tsx` is a `useRef` + `useEffect` mount point that receives **zero per-frame props**.
- Per-frame data never enters React state. The HUD timer is written by the engine directly to a DOM text node it owns.
- The zustand store only ever holds phase transitions and end-of-round data — a handful of updates per round, not per tick.

---

## Responsive layout: portrait cannot crop

Poki requires portrait support (it unlocks the mobile banner slot). Echo Tag's readability depends on seeing the echo maze, so **portrait scales the whole arena down rather than cropping it**. The camera fits `ARENA_BASE_W` to the viewport width and letterboxes vertically; the resulting dead space above and below is exactly where the HUD and the banner slot go. Landscape fits to height. Play area is identical in both, so no orientation has a competitive advantage.
