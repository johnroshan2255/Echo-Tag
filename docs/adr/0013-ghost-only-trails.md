# ADR 0013 — Only the ghost leaves a trail

**Status:** accepted (owner decision)

## Context
After ADR 0012 (trails visual-only) and the transformation/unconsciousness mechanics,
every player still generated a live echo trail, and walking into ANY trail — including a
fellow runner's — knocked you unconscious. The owner ruled: "only ghosts need ghost
trails." Humans should leave nothing behind; the trail is the ghost's presence in the
world, not a general movement tax.

## Decision
- `rebuildEchoBodies` marks echo bodies live **only for `itSlot`**. Humans have no live
  trail: nothing to render, nothing to faint on, nothing for bots to read.
- **The trail is a property of being the ghost, not of having a past.** `itSinceTick`
  records the crowning tick, and only samples recorded from then on become bodies: a new
  ghost is crowned with NO trail and grows one over the next 3 seconds. Its pre-crowning
  movement — including the 5s stumble — never becomes a hazard.
- Position history is still sampled for **all** players every tick (fixed allocation,
  and the network story of ADR 0004 is unchanged). Snapshots carry `itAgeTicks` so a
  mirror — a late joiner included — gates the trail exactly as the server does.
- While someone is turning (`itSlot === NO_SLOT`) there are **no hazards in the arena at
  all** — the trail vanishes with the freed ghost. The lull plus the 3s growth ramp is
  the humans' guaranteed head start after every tag.

## Consequences
- The KO hazard is now exclusively the ghost's weapon: it can fence a corridor or cut a
  fleeing runner's line with its own past. Runners' movement leaves no evidence — hiding
  and fleeing got safer, hunting got a territorial tool.
- The arena no longer densifies into a maze over the round; the "cornered by everyone's
  past" pressure curve (already weakened by ADR 0012) is fully retired. If rounds skew
  too easy for runners, the first lever is lengthening the ghost's `ECHO_DELAY_MS`.
- Live echo bodies drop from up to 180 to at most 15 (`ECHO_BODIES_PER_PLAYER`). The
  renderer's particle capacity is unchanged (allocation-free discipline); the browser
  check fails on more than 15 bodies (a human leaking a trail) and requires exactly 15
  only once a ghost has reigned a full echo delay — mid-metamorphosis the count is
  legitimately lower.
- The metamorphosis is now fully telegraphed on screen: the turning player trembles and
  flickers toward the ghost's white at an accelerating rate, convulses in scale, carries
  a cold violet halo (distinct from the ghost's lantern-white) and a tightening whirl of
  bats, and the threat arrow points at them through the lull — the head start is spent
  running the right way, not guessing.
- Becoming the ghost is also felt first-person: the victim's OWN screen judders and
  tears with glitch bars, ramping through the metamorphosis and slamming for a beat at
  the crowning. Strictly per-viewport (a post-camera pixel offset plus a screen-space
  overlay, gated on the local slot), so in multiplayer only the victim's monitor shakes.
- The ghost still faints on its own aged trail (own-trail grace unchanged), so reckless
  hunting keeps its cost.
- ADR 0012's "fading echoes are how the hunter tracks prey" is superseded: trails no
  longer carry prey information at all. The GDD §3.1 remains historical; this ADR is the
  current rule.
