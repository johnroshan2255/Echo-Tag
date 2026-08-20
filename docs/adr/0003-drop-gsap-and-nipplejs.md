# ADR 0003 — Drop gsap, nipplejs, and pixi-filters

**Status:** accepted

## Context
The tech doc lists `gsap` for leaderboard tweening, `nipplejs` for the mobile joystick, and `pixi-filters`
(`GlowFilter`, `BloomFilter`) for the "It" indicator. Together they are well over 100KB brotli — around
40% of the load budget — for three narrow uses.

Two of them also don't fit PixiJS v8: filters cannot be applied to a `ParticleContainer` at all, and a
filter pass means an extra render target plus a full-screen shader pass, which is exactly the wrong cost
on the low-end GPUs Poki's audience actually uses.

## Decision
- **gsap → `anim/easing.ts`**: the six curves we use, ~30 lines, driven by the Pixi ticker.
- **nipplejs → `input/joystick.ts`**: a floating joystick is pointer events plus a vector clamp, ~2KB,
  and we need exact control over dead zone, safe-area inset and idle opacity anyway.
- **pixi-filters → an additive radial-gradient sprite** under the "It" player, pulsed via scale and alpha.
  One quad, no render target, and it reads better at small on-screen sizes than a glow filter.

## Consequences
- ~100KB brotli saved; no filter render targets on mobile.
- We own three small pieces of code we'd otherwise get for free. All three are ones we'd have needed to
  configure heavily regardless.
