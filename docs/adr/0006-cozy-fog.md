# ADR 0006 — Fog-of-war vision and the cozy dusk retheme

**Status:** accepted (user direction, after playing the map-pivot build)

## Context
Owner feedback on the walk-through build: close, but you can still survey too much at once,
and the flat neon-on-charcoal look reads as a tech demo — "a simple thing no one will play."
Asked for: vision limited to roughly the room you are in, and a Koira-like cozy theme.

## Decision
1. **Fog of war.** Fully clear within 280 world units, fully fogged past 520 — about one
   room. One screen-space radial-gradient sprite centred on the player each frame; no
   shaders, no per-pixel work, one draw call. The gradient texture keeps a long solid tail
   (fade completes at 30% of radius) because the sprite must sometimes be enlarged to cover
   the screen corners, and that enlargement stretches the gradient — with a short tail the
   coverage fix silently tripled the vision radius.
2. **Cozy dusk theme**, owned entirely by `game/theme.ts`: dusk-plum ground with seeded
   leaf-litter speckles (replacing the grid), walls as dark-pine hedges with leafy interior
   clumps and mossy rims on floor-facing edges only, drifting seeded fireflies, and a warm
   flickering lantern pool on the local player that motivates the vision circle. Player
   palette softened from neon to warm pastels (shared constants — it is gameplay data).
   The boot preview and HTML shell carry the same mood from the first frame.
3. Fog is a *practical rules change*, deliberately: threats enter from fog, echoes are
   discovered rather than surveyed, map knowledge becomes a skill. The off-screen threat
   arrow (ADR 0005) is what keeps it fair — danger is always pointed at, never shown.

## Consequences
- Draw calls 5 → 6 (fireflies +1, fog +1, lantern shares the fx batch), budget 8.
- Zero new assets; both new textures are runtime canvases.
- A player fully in fog is ~3% visible — effectively hidden. A nearby It's halo bleeds
  very faintly through, which reads as approaching dread and is kept on purpose.
- Verification note: fog levels are only judgeable by pixel probe or 1:1 crop. The
  downscaled screenshot viewer *invented* a visible figure out of sub-threshold noise twice;
  a probe of the actual PNG showed nothing above fog anywhere. Measure, don't squint.
