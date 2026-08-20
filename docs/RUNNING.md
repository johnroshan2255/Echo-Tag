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

That is all you need today. The Colyseus server is not on the critical path until Phase 4;
when it is:

```bash
npm run dev:server # Colyseus → :2567   (separate terminal)
npm run dev:web    # same as `npm run dev`
```

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
| `npm run verify` | ~3 s | Types compile, 22 simulation invariants hold, the tick path is inside its step budget and allocates nothing. |
| `npm run check` | ~15 s | Everything above, plus: the production bundle is inside its size budget, and the real artifact boots in headless Chrome on three viewports with zero console errors. |
| `npm run check:browser -- --headed` | ~15 s | Same as the browser half of `check`, with a visible window. Use when a screenshot is not enough. |
| `npm run crop [x y w h]` | ~10 s | A 1:1 device-pixel crop of the running arena. **The only way to judge anything visual.** |

### Judging visuals: use `npm run crop`

A full-viewport screenshot of a 2880x1800 canvas is downscaled so far to be viewable that it
invents dither patterns that are not in the render, and hides ones that are. Every visual bug
in Phase 2 — echoes rendering at the wrong size, obstacles out-weighing the players — was
invisible in the viewport screenshots and obvious in a crop.

```bash
npm run crop              # a middling patch of arena
npm run crop 100 80 300 200
```

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
  32/32 tests
  mean step 0.0052 ms of a 0.4 ms budget    tick path allocation-free

npm run check
  boot      3.4 KB of  16 KB     preview + Play button, interactive alone
  engine   98.2 KB of 160 KB     PixiJS v8, WebGL path only
  total   107.6 KB of 260 KB     vs Poki's 8 MB ceiling
  83 fps, 4,896 particles, 180 echo bodies, 4 draw calls per frame
  3/3 viewports green
```

On screen today: the Canvas2D preview and Play button, then the world — one of **four fixed
maps** (Foundry, Pillars, Serpentine, Warrens, rotating each round), larger than the screen,
seen through **fog of war**: a warm lantern pool around your avatar, roughly one room of
visibility, and dusk beyond. Hedge-maze theme with fireflies and leaf-litter; an edge arrow
marks the off-screen threat (It when you are prey, your nearest target when you are It — with
fog, that arrow is load-bearing). 12 avatars of 168 squares, 180 solid echo bodies. Slot 0 is
yours on WASD or the arrow keys; the other eleven run the shared synthetic driver (**not**
AI — that is Phase 6).

There is no server yet. The world is local, the round loops, and nothing is networked; Phase 4
swaps the local `World` for a server-authoritative one without touching the render path.
