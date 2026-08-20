# ADR 0012 — Ghost trails are visual only

**Status:** accepted (owner decision, choosing between three explicitly offered variants)

## Context
The founding design made every player's 3-second echo trail SOLID — "your past becomes
walls" was the original core mechanic and the game's name. The design has since pivoted,
at the owner's direction, into a fogged horror hide-and-seek: a ghost hunts players through
a dark furnished maze with doors, wardrobes and sound. Asked to verify colliders, we found
the owner's mental model ("people and ghost have colliders, but not the ghost trails") no
longer matched the code. Offered: (a) keep solid, (b) visual only, (c) solid only to the
ghost. The owner chose **(b): visual only**.

## Decision
- No one collides with echo trails. They remain fully rendered and networked-derived
  exactly as before — but as *information*: the hunter tracks prey by their fading echoes
  through the fog, and prey read the ghost's trail the same way.
- The echo resolver is retired from the tick but deliberately kept one call-site away
  (sim/player.ts), because the three variants were a live design question and re-enabling
  must stay a toggle, not a project.
- **No-tag-backs rule added**: retiring trail solidity exposed a masked gap — the old and
  new "It" overlap at the moment of transfer (bodies pass through each other), and
  immunity only protected the new It, so the new It could return the tag instantly. The
  previous It is now untouchable BY the new It for the immunity window. A failing test
  caught this within minutes of the collision change.

## Consequences
- Colliders now: walls/furniture/doors solid to all; bodies pass-through (touch = tag);
  trails non-solid for everyone.
- Two emergent quirks of solid trails vanish: a standing player's echo pile no longer makes
  them a de-facto wall (now regression-tested), and the echo replay wave can no longer
  bulldoze its owner.
- Tag rate on the bench drops from ~28-49 to ~12 per round — trails no longer funnel
  players into each other. Still a tag per ~15s; real tuning happens with Phase 6 bots.
- The original one-line pitch ("cornered by your own past") is retired with this; the
  game's identity is now the fogged hunt. COMPETITIVE_ANALYSIS.md and the GDD describe the
  earlier design and are superseded on this point by this ADR.
