# ADR 0011 — The decayed look, and Poki deployability

**Status:** accepted (user direction: "cracked rooms and walls, not square, scary like
Koira — and make sure it deploys on Poki")

## Decay (visual only; collision stays on the tile grid)
The square-room read came from three regularities, each now broken:
1. **Eroded edges** — every wall-floor edge is four seeded segments of varying thickness,
   the wall occasionally slumping a few units outward, so no silhouette is a straight line.
2. **Crumbled corners** — every convex wall corner has a floor-coloured bite and spilled
   rubble beside it. No room has four intact corners any more; this kills the CAD feel hardest.
3. **Cracks** — jagged seeded fissures across floors (with a faint catch-light lip) and
   pale cracks across the wall mass, plus rubble scatter.

Discipline: visual erosion never exceeds ~8 world units past a tile line (PLAYER_RADIUS is
18), so nothing ever looks passable that is not, or blocked that is not. All of it rides
the one arena Graphics — draw calls unchanged at 7 of 8, and the whole game is still ~180KB
because decay is code, not textures.

## Poki deployability
- `npm run package` → `echo-tag-poki.zip` (~180KB): dist minus sourcemaps and precompressed
  variants, all URLs **relative** (`base: './'` — Poki serves from CDN subpaths where
  absolute paths 404).
- SDK contract wired and guarded (see `platform/poki.ts`): init + gameLoadingFinished when
  the menu is usable; **gameplayStart on the first input of a session** (keyboard or touch,
  only while Playing); gameplayStop on round end and tab-hide; commercialBreak between
  rounds bracketed by a hard audio mute. Absent SDK = identical game.
- Multiplayer on Poki: PLAY (bots) is submittable with zero backend; QUICK MATCH/HOST/JOIN
  need the Colyseus server behind **wss** with `VITE_WS_ORIGIN` baked at build. Steps and
  the §8 checklist live in `docs/POKI_DEPLOY.md`.
- Check hygiene learned here: the *live* SDK boots inside the headless check and its ad
  stack makes third-party calls that abort under test — network assertions now apply to our
  own origin only, and known SDK console grumbles (COOP on http, sandboxed ad frames) are
  filtered as environmental.
