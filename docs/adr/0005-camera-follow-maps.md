# ADR 0005 — Fixed authored maps and a follow camera, replacing the one-screen arena

**Status:** accepted (user direction, after playtesting the Phase 2 build)

## Context
The Phase 2 build showed the entire arena on one screen, every player visible at all times.
Playtesting verdict from the project owner: the character reads well, but the god-view kills
the game's feel — they asked for a Koira/Limbo-style *place*: a fixed world larger than the
screen that you walk through, four maps, camera following your character, same tag/echo rules.
Given both references are side-view games, the fork "side-view platformer vs top-down with a
follow camera" was put to the owner explicitly; they chose top-down.

## Decision
- **Four fixed, authored maps** (Foundry, Pillars, Serpentine, Warrens), all on one 40x22
  grid of 80-unit tiles (3200x1760), one-tile border wall, rounds rotating through them.
  Maps are *painted in code* with rect/wall/door helpers — no image or JSON assets, exact
  dimensions by construction — and validated by tests: 12 open well-spread spawns, full
  connectivity, no cell with fewer than two exits (an echo trail can seal a one-exit pocket
  for its owner's whole 3-second loop).
- **Follow camera**: `scale = max(view / VIEW_MAX)` so no device ever sees more than
  1280x820 world units — bigger screens get bigger pixels, not more maze. Exponential
  follow with velocity lookahead, clamped to the map. The camera transforms one world-root
  container per frame; renderers write world coordinates and never know it exists.
- **Wall collision** in the shared sim: circle-vs-tile AABB with slide-along-normal, after
  echo resolution (an echo may not push a player inside a wall).
- **Off-screen threat arrow**: the compensating control for no longer seeing everyone. Not
  It → arrow points at It (danger, white). It → arrow points at the nearest taggable player
  (prey, their colour). Hidden whenever the target is on screen.
- The arena-scales-with-headcount rule from the GDD is retired; the map defines the space.

## Consequences
- Portrait phones get a real tall view instead of a 21%-height letterbox — the open question
  carried out of Phase 2 is resolved by this pivot, not worked around.
- Echo trails become corridor-blocking tactical objects rather than abstract maze-fill;
  authored chokepoints give them somewhere to matter.
- Being It on a big map needs the prey arrow, or it is aimless wandering; tag rate on the
  bench stayed healthy (41 tags/round on Serpentine with the placeholder driver).
- Networking cost is unchanged: the map is one byte of round metadata; everything else was
  already positions.
- The thumbnail/trailer story changes: the hook is now "hunted through a maze by your own
  past", shown from one player's view.
