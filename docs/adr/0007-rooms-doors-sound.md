# ADR 0007 — Furnished rooms, live doors, and a synthesised soundscape

**Status:** accepted (user direction: "make room feel like room, doors + sounds, check Koira")

## Context
The fogged world read as corridors, not places. Owner asked for furnished rooms, real doors
with opening sounds, and scary/atmospheric audio — referencing Koira, whose defining trait
is being *musically driven*: a wordless game whose mood is carried by its soundtrack, cute
against "the unknown darkness lurking between the trees."

## Decision
1. **Furniture is a tile type** (`TILE_FURNITURE`): solid like a wall, painted in the map
   builders, rendered as planked timber. Solid props are gameplay (cover, chokepoints), so
   they live in map data where determinism and the eventual server get them for free. Soft
   props (rugs, potted plants, standing lamps) are a non-colliding `decor` list, drawn into
   the arena Graphics; lamps also get a warm additive light pool, so rooms glow faintly
   through the fog and act as landmarks.
2. **Doors are simulation objects.** A door fills a two-tile doorway, opens as anyone
   approaches (hysteresis against flutter), drifts shut after, blocks like two wall tiles
   while under half open, and can never close on someone standing in the frame. Both sides
   of a chase interact with them, so they are deterministic shared-sim state
   (`world.doorOpen`) — a door that prediction disagrees about is a tag dispute. Foundry has
   4, Warrens 6, Serpentine 4 (on its shortcuts — taking the fast lane announces you),
   Pillars none: it is the outdoor courtyard map.
3. **All audio is synthesised WebAudio** — oscillators, filters, envelopes; zero fetched
   assets. Voices: door creak (stick-slip vibrato saw) and shut-thud, distance-panned
   footsteps, a heartbeat that starts when It is near and accelerates as they close, a
   two-note tag sting, and an ambient bed of slow-breathing filtered wind over a 48Hz drone.
   The audio *director* derives everything from world-state transitions each frame.
4. **Sound is the second sense under fog, by design.** Doors are audible to ~1100 world
   units — roughly twice vision — so a creak in the dark is information. Footsteps carry to
   ~520. The scare register is "old house at night": low, sparse, felt more than heard.
   This is the Koira lesson applied: the soundtrack does the storytelling.

## Consequences
- Draw calls 6 → 7 of 8. Bundle 113.2KB brotli (+3KB, all synthesis code). Still zero assets.
- The AudioContext is created inside the Play-click call stack, satisfying autoplay policy
  by construction; every voice is guarded so muted/headless environments are silent no-ops.
- Phase 7 must route `commercialBreak()` through `setMuted`, and the audio director is the
  natural home for round start/end cues.
- Dev review hooks (`?nofog`, `?map=N`, `?at=tx,ty`) exist because fog correctly hides
  every furnished room from screenshots; `npm run crop` accepts a query-string argument.
- The dead-end map test caught a bed sealing a one-exit pocket on its first run —
  furnishing is now covered by the same authoring safety net as walls.
