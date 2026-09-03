# Running & Checking Echo Tag

## One-time setup

```bash
nvm use            # reads .nvmrc → Node 24.18.1
npm install
```

Node 24 runs `.ts` files natively, so there is no build step in development and no loader
to configure. `npm install` pulls Playwright, which drives the **Chrome already installed
on this machine** — no 150MB Chromium download.

## Start it

```bash
npm run dev        # Vite dev server → http://localhost:5173
```

For multiplayer, run the room server too (separate terminal):

```bash
npm run dev:server # authoritative rooms → :2567
```

Then in the game: **PLAY** is an instant local round against bots (no server needed);
**QUICK MATCH** auto-joins a public room that starts within ~2s, bots filling empty seats;
**HOST ROOM** shows a 5-letter code to share; **JOIN** takes a friend's code. Two browser
tabs + quick match is the fastest way to see yourself from the outside. Private rooms are
host-controlled: a bot stepper picks how many bots join at round start (zero is fine),
starting needs at least two humans, and rooms cap at 12 players. The room code rides the
URL (`?room=CODE`), so a refresh rejoins the same room mid-round. Multiplayer rooms have
chat from the lobby on: the pixel speech-bubble at the top left slides in a translucent
panel (players are named by their avatar colour; relay-only, nothing is ever stored).

To look at the *built* artifact rather than the dev server — which is what the checks and
Poki actually see:

```bash
npm run build
npm --workspace @echo-tag/frontend run preview   # → http://localhost:4173
```

## Check it

Three commands, cheapest first. Run them in this order; each is a superset of the problem
space of the one before.

| Command | Time | What it proves |
|---|---|---|
| `npm run verify` | ~3 s | Types compile, 78 tests hold (simulation invariants and render-template budgets), the tick path is inside its step budget and allocates nothing. |
| `npm run check` | ~15 s | Everything above, plus: the production bundle is inside its size budget, and the real artifact boots in headless Chrome on three viewports with zero console errors. |
| `npm run check:browser -- --headed` | ~15 s | Same as the browser half of `check`, with a visible window. Use when a screenshot is not enough. |
| `npm run crop [x y w h]` | ~10 s | A 1:1 device-pixel crop of the running arena. **The only way to judge anything visual.** |
| `npm run check:mp` | ~60 s | Multiplayer: a protocol probe against the real server (matchmaking pools, movement, wardrobe hide/exit mirrored across clients, the tag→lull→crowning sequence, and ghost-trail growth derived exactly as clients derive it), then a two-browser e2e (quick match pairing, cross-client movement, private-room codes). The probe's server runs with `TEST_HOOKS=true`, which arms test-only teleport/setIt room messages — never set in production. |

### Judging visuals: use `npm run crop`

A full-viewport screenshot of a 2880x1800 canvas is downscaled so far to be viewable that it
invents dither patterns that are not in the render, and hides ones that are. Every visual bug
in Phase 2 — echoes rendering at the wrong size, obstacles out-weighing the players — was
invisible in the viewport screenshots and obvious in a crop.

```bash
npm run crop              # a middling patch of arena
npm run crop 100 80 300 200
npm run crop 380 160 760 500 "nofog&map=0&at=13,4"   # review a spot with dev hooks
```

Dev review hooks (URL params, inert in normal play): `?nofog` disables the fog pass,
`?map=N` forces a map, `?at=tx,ty` teleports the local player, `?turn` stages a
metamorphosis beside the local player (`?turn=me` makes it the local player's own, for
reviewing the terror overlay) — because fog correctly hides everything worth reviewing
from a screenshot.

`npm run verify` = `typecheck` + `test` + `bench:sim`. Run it before every commit.

### What the browser check actually does

`tools/check/browser-check.ts` builds nothing itself — it serves `Echo-Tag-Frontend/dist`
with `vite preview` and drives real Chrome against it, at three viewports Poki requires
(desktop, mobile portrait, mobile landscape). Per viewport it asserts:

- boot signals ready, and how fast
- the Canvas2D preview is **composed inside the frame** — 4+ distinct colours and content
  in all four quadrants, not merely "not blank"
- both canvases are laid out at exactly the viewport size, with a backing store matching
  the device pixel ratio
- no horizontal overflow
- the Play button has a layout box fully on screen
- clicking Play loads the game chunk and brings up a WebGL2 renderer
- the render loop advances frames
- zero console errors, page errors, failed requests or 4xx responses

Screenshots land in `tools/check/screenshots/` (gitignored), one per viewport, before and
after pressing Play. **Look at them.** Every assertion above passed on a build whose
preview had two thirds of its cast off-screen — automated checks verify wiring, not
composition.

### Two things the browser check cannot tell you

1. **Real frame rate.** Headless Chrome here gets a hardware WebGL2 context through ANGLE
   (the check prints the renderer — on this machine, Apple M4 via Metal), so the fps figure
   is real, but real *for this GPU*. It is a regression signal — "did we just get 3x
   slower?" — never evidence of meeting Poki's 30/60fps bar. That is Phase 8, on real
   hardware.
2. **Real load time.** `boot ready in ~70ms` is over localhost with no network. The load
   budget is expressed in transfer bytes for exactly this reason: `npm run size` measures
   what a browser downloads, which is the part we control. See `PERFORMANCE_BUDGET.md`.

### Note for a GPU-less CI runner

The check deliberately passes **no** `--use-angle=swiftshader`. Forcing software rendering
makes the numbers meaningless *and* breaks PixiJS: a bare `canvas.getContext('webgl2')`
succeeds under SwiftShader, but Pixi's context attribute set does not. On a Linux runner
with no GPU you will need `--enable-unsafe-swiftshader` plus
`failIfMajorPerformanceCaveat: false` on the renderer, and the fps assertion should be
dropped rather than retuned.

## Current state

```
npm run verify
  78/78 tests
  mean step 0.0052 ms of a 0.4 ms budget    tick path allocation-free

npm run check
  boot      3.4 KB of  16 KB     preview + Play button, interactive alone
  engine   98.2 KB of 160 KB     PixiJS v8, WebGL path only
  total   107.6 KB of 260 KB     vs Poki's 8 MB ceiling
  83 fps, 4,896 particles, 15 echo bodies (the ghost's trail), 4 draw calls per frame
  3/3 viewports green
```

On screen today: the Canvas2D preview and Play button, then the world — one of **four fixed
maps** (Foundry, Pillars, Serpentine, Warrens — picked on the menu; solo and private rooms rotate
each round, a quick-match room keeps its map because players are matched into it), larger than the screen,
seen through **fog of war**: a warm lantern pool around your avatar, roughly one room of
visibility, and dusk beyond. Only the ghost leaves an echo trail (ADR 0013), and it is a
hazard, not a wall (ADR 0012): walk into it and you black out for 3 seconds, fully
vulnerable. Humans leave no trail — the glowing path through the dark is always the
ghost's, both its territory marker and your warning. Rooms are furnished — rugs, tables, crates, potted plants,
standing lamps whose light pools glow through the fog — and fourteen **doors** open as
anyone approaches and drift shut behind them. Everything is audible: door creaks carry to
about twice vision range (a creak in the dark means someone is moving there), footsteps pan
with direction, your heartbeat starts when It is near and quickens as they close, and a
breathing wind-and-drone bed sits under it all — every sound synthesised, no audio files.
Wardrobe keys lie on the floor as golden glyphs at seeded-random spots — walk over one to
claim it for the round (first come, first kept; the ghost cannot pick them up), and a
keyhole marker appears over the wardrobe it opens. Tools spawn the same way: goo jars
(a puddle that slows everyone else who crosses it) and snap traps (arm, then knock the
first other body out cold — the ghost included). You carry up to two in the tool belt at
the top right; tap an icon or press 1 / 2 to deploy at your feet. An edge arrow marks the
off-screen threat. Slot 0 is yours on WASD or the arrow keys; the other eleven run the
shared synthetic driver (**not** AI — that is Phase 6).

**PLAY** runs this world locally with no server. **QUICK MATCH / HOST / JOIN** run the same
`World` mirrored from the authoritative Colyseus server (`npm run dev:server`, checked by
`npm run check:mp`) — the render path is identical either way; only where the world comes
from changes.
