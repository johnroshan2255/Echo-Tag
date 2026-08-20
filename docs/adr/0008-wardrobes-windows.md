# ADR 0008 — Wardrobes (hide mechanic with keys) and windows

**Status:** accepted (user direction)

## The mechanic, as designed by the owner
- Wardrobes are hiding spots. Only runners can hide — "It" holds no keys; predators do
  not hide.
- Each player is dealt keys to about **half** the map's wardrobes at round start (from the
  world RNG, deterministic). No hiding spot is safe for everyone; knowing *your* wardrobes
  is part of knowing the map.
- Inside you are invisible and untaggable — **and blind**. Nothing tells you whether the
  chaser has left: vision collapses to the door (fog closes to ~22%), the whole mix muffles
  through a master lowpass, and your own heartbeat pounds at a constant panicked rate that
  carries **no information**. Stepping out beside a waiting It is the catch it sounds like:
  there is deliberately no exit immunity, and the test suite asserts the catch.
- A used wardrobe refuses the same player for **20 seconds**; other wardrobes remain fine.
- **Added beyond the spec** (flagged to the owner): the door swings open on its own after
  10 seconds. Without a cap, "hide until the clock runs out" is the dominant strategy in a
  score-by-least-It-time game.

## Implementation choices
- Entering is movement-only — walk into a keyed, ready wardrobe — preserving the
  one-input control scheme (a Poki constraint). Exiting is any direction press after the
  door shuts (0.5s), out onto a build-time-resolved exit tile.
- Hiding state is world state (`hiddenIn`, per-pair cooldowns, keys), because a hider that
  prediction and authority disagree about is a tag dispute. All fixed-size arrays; the tick
  stays allocation-free.
- Wardrobe enter/exit **creaks like a door, audible at door range (~2x vision)**: the
  chaser hearing a wardrobe shut nearby is half of what makes hiding a gamble.
- A hider's echo trail keeps sampling the wardrobe centre; the renderer masks bodies that
  have contracted onto a hidden owner. Result: the trail leads to the wardrobe and fades
  over 3 seconds — evidence that decays, which is the fiction working as physics.
- Keyhole markers over usable wardrobes are the local player's private overlay (solid =
  ready, dimmed = cooling down, absent = no key). Never rendered for others.
- Windows are pure architecture: lit mullioned panes set into wall tiles, validated to sit
  in walls. They make the walls read as a house and glow warmly at range. No gameplay.

## Consequences
- Draw calls hold at 7 of 8 (markers batch as one Graphics; cabinets/windows are static
  arena geometry). Bundle 114.3KB brotli. 67/67 tests.
- The It-side counterplay is honest: hear the shut, camp the door, or leave and mind the
  20s window. The hider's counterplay is the eviction timer forcing rotation between
  wardrobes — which the key dealing makes finite.
- Bots ignore wardrobes until Phase 6 gives them brains.
