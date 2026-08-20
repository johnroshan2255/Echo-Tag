# ADR 0010 — Mobile playability and the horror dressing

**Status:** accepted (user direction: "check everything is suited for mobile" + "make it
horror like Koira: webs, spiders, bats")

## Mobile (Phase 3, delivered)
- **Floating touch joystick** — the entire mobile scheme, since movement is the game's only
  input. Appears wherever the thumb lands (clamped 20px+ off edges for OS gesture zones),
  110px base / 55px knob / 10px dead zone / ~55% idle opacity, square-language visuals that
  never intercept pointer events. Coexists with the keyboard (iPad + keyboard case is both);
  the mouse never engages it; taps on real UI are left alone.
- **Raw touch events, not Pointer Events, deliberately**: Chrome emits an early `pointerup`
  mid-gesture when it considers reclaiming the touch for scrolling, which killed the stick
  an instant after it engaged. The `touchstart/move/end` stream stays correct for the whole
  hold, and preventDefault on it also suppresses scrolling and synthetic mouse events.
- **Proven, not assumed**: the browser check's mobile viewports now synthesize CDP touch
  drags and assert the avatar moves >100 world units. First honest failure: the drag headed
  *into a border wall next to the spawn* and scraped 11 units — the assertion now tries up
  to four headings, since direction is not what is under test.
- Menu, lobby overlay and results are thumb-sized and fit both orientations (already
  asserted by the viewport/overflow checks).

## Horror dressing (all cosmetic, zero gameplay effect)
- **Cobwebs** strung across inside wall corners — corners are *found* (open tile with two
  solid orthogonal neighbours on a diagonal), not authored, and picked at a seeded stride so
  each map dresses identically every visit. Three sagging concentric arcs + anchor threads
  in the arena Graphics: no extra draw call.
- **Spiders**: ten shadow-dark squares that skitter in short bursts and freeze — the freeze
  is what makes the next burst read as motion in the corner of the eye. They live in the
  ambience ParticleContainer with the fireflies: still one draw call.
- **Bats**: a staggered, weaving flock of six crosses the player's general area every
  16-36s, wingbeat rendered as vertical squash at flap rate, announced by a synthesised
  leathery flutter. Same container.
- **The house settles**: a low detuned groan every 25-55s at a random pan, deliberately
  information-free — it exists so the quiet is never quite trustworthy. This plus the
  heartbeat, door creaks and fog is the Koira register: cute against an untrustworthy dark,
  never a jump scare.

## Cost
Draw calls unchanged at 7 of 8. +16 particles. 148.2KB brotli total. Still zero assets.
