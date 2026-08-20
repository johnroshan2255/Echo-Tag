# Similar Ideas & Games — What to Borrow, What to Avoid

## The closest mechanical relative: Curve Fever / Achtung, die Kurve!

Curve Fever (and its ancestor *Achtung, die Kurve!*, 1995) is the game Echo Tag is most likely to be compared to, because it shares the core loop: **players' own movement history becomes solid geometry, and the arena strangles itself over the round.** It has been validated commercially for 30 years across Flash, Curve Fever Pro, and curvefever.io.

What Echo Tag changes, and why each change matters:

| | Curve Fever | Echo Tag |
|---|---|---|
| Trail lifetime | Permanent for the round | **Rolling 3s replay** — trails *move*, so the maze is never static |
| Failure state | Hit a trail → eliminated | Hit an echo → blocked. **No elimination** |
| Objective | Survive last | Minimise time as "It" |
| Dead time | High — early death = spectating | **Zero** — everyone plays all 180s |

The elimination difference is the strategic one. Curve Fever's weakness on an ad-supported portal is that a player eliminated at second 20 has nothing to do for the rest of the round, and portal players churn out rather than watch. Echo Tag's "no elimination, minimise It-time" scoring keeps all 12 engaged to the final second — which is also what makes the 3-minute round match Poki's session cadence instead of fighting it.

The moving-echo twist is the mechanical hook: in Curve Fever the level is a fixed drawing you route around; in Echo Tag it's a *loop* you have to time. That's genuinely new in this space, and it's what makes the thumbnail legible.

## Past-self-as-obstacle, single-player lineage

Worth studying for feel, not for structure — these all prove the mechanic reads well to players who've never seen it:

- **The Misadventures of P.B. Winterbottom** — recorded clones as platforms; the clearest prior art for "your recording is physical."
- **Super Time Force** — layered replays of your own runs; nails the readability problem of many simultaneous ghosts.
- **Cursor\*10** — ten sequential selves cooperating; taught the genre that ghosts need to be visually *quieter* than the live actor.
- **Braid**, **Chronotron**, **Time Donkey** — time-echo puzzle designs.
- **Trackmania / racing ghosts** — the mainstream reference point most players actually have for "a translucent past me."

The consistent lesson across all of them: **ghosts must be lower-contrast and lower-detail than live players, or the screen becomes unparseable.** That's already reflected in the plan (28-square silhouettes at 35% alpha vs 180-square live bodies) and it's the single thing most likely to make or break playtests.

## The .io portal cohort (business/UX model, not mechanics)

Slither.io, Paper.io, Curve Fever, Venge.io, Bloxd.io, LOL Beans, Narrow One. What Echo Tag copies from them deliberately:

- **No login, no lobby screen, no tutorial.** Bot-fill so a round always starts inside ~2s (Echo Tag's plan caps it at `MAX_LOBBY_WAIT_MS = 2000`).
- **Instant requeue.** The leaderboard *is* the lobby; "Play Again" is the only button that matters.
- **One-input control scheme.** Movement only, tagging by collision — the reason mobile needs a joystick and nothing else.
- **Silhouette-first art.** Readable at thumbnail size, which is where portal traffic is actually won.

## Direct competition on Poki today

Poki's `.io` category runs 35+ titles, and its tag/chase slots are held by 3D or team-based games (Bloxd.io modes, LOL Beans, Venge.io, Narrow One) — not by a 2D trail-obstacle game. **Curve Fever itself is not currently a Poki-catalogue fixture**, which leaves the "trails become the level" niche open on the platform. That gap is the submission pitch.

## Risks this analysis surfaces

1. **Echo readability at 2:30 with 12 players** is the make-or-break unknown. 180 echo bodies is a lot of screen. Mitigation: `ECHO_STRIDE` and `ECHO_ALPHA` are tunables in `constants.ts` precisely so this can be dialled during playtest, and the sim supports capping echo bodies per player if density proves unreadable.
2. **"Minimise It-time" is less immediately legible than "survive."** Needs the HUD to make *your* accumulating It-time impossible to miss — a rising bar, not a number in a corner.
3. **Being blocked feels worse than dying** if collision response is a hard stop. Slide-along-normal resolution (already specified in `math/collision.ts`) is not a polish item; it's core feel.
4. **Comparisons will be made to Curve Fever.** That's fine, and useful for discovery — but the trailer must show a trail *moving* in the first two seconds, or the differentiation is invisible.
