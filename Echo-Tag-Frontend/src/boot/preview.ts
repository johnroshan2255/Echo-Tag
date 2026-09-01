import { BG_COLOR, ECHO_ALPHA, PLAYER_COLORS } from '@echo-tag/shared/constants'

/**
 * The menu backdrop, drawn with plain Canvas2D — and alive.
 *
 * This exists so the player sees the game — not a spinner — within a few hundred
 * milliseconds, and it shows the game's whole CAST in motion: the white-sheeted ghost
 * bobbing after a fleeing runner, the nest spider yo-yoing on its thread, the UFO
 * sweeping its beam, the alien watching (and blinking). Around them, the night itself:
 * twinkling star pixels, drifting ash, fireflies — and every so often a pixel lightning
 * bolt cracks the sky. One glance says "monsters chase people here", which is the pitch.
 *
 * Deliberately NOT PixiJS: it runs before the engine chunk finishes downloading, so it
 * may import nothing heavy. The loop is throttled to ~30fps, skips hidden tabs, respects
 * prefers-reduced-motion (static frame), and each frame costs well under a millisecond.
 *
 * Sizes come from *CSS* pixels (the canvas backing store is device pixels for sharpness).
 * The cast hugs the frame's edges: the menu card owns the middle column.
 */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

// ── The cast, as compact pixel grids ('.' = empty; letters index a tiny palette) ──────
const GHOST = [
  '..wwwwwwww..',
  '.wwwwwwwwww.',
  'wwwwwwwwwwww',
  'wwwkkwwwkkww',
  'wwwkkwwwkkww',
  'wwwwwwwwwwww',
  'wwwwwwwwwwww',
  'wwwwwwwwwwww',
  '.wwwwwwwwww.',
  '..dwwwwwwd..',
  '...dwwwwd...',
  '....dwwd....',
  '.....dd.....',
]
const SPIDER = [
  '..l......l..',
  '.l.dddddd.l.',
  'l.dddddddd.l',
  '..deeddeed..',
  'l.dddddddd.l',
  '.l.dddddd.l.',
  '..l..dd..l..',
]
const UFO = [
  '....gggg....',
  '...gggggg...',
  'hhhhhhhhhhhh',
  '.hhtthhtthh.',
]
const ALIEN = [
  '..aaaa..',
  '.aaaaaa.',
  '.akkakk.',
  '.aaaaaa.',
  '..aaaa..',
  '...aa...',
  '.aaaaaa.',
  'a.aaaa.a',
  '..a..a..',
  '..a..a..',
]
const RUNNER = [
  '..pppp..',
  '..pppp..',
  '.pkppkp.',
  '..pppp..',
  'pppppppp',
  '..pppp..',
  '..p..p..',
]
const PALETTE: Record<string, string> = {
  w: '#f2eefc', // ghost sheet
  d: '#322947', // spider body / ghost hem shade (context decides via override)
  e: '#ff5040', // spider eyes
  l: '#4a3f66', // spider legs
  h: '#8fa4c4', // UFO hull
  g: '#bfffe8', // UFO dome
  t: '#2fd4b8', // UFO lights
  a: '#a8d890', // alien skin
  k: '#241f38', // dark eyes
  p: '#ff85ad', // the fleeing runner
}

/**
 * The lightning schedule, shared with the thunder in menuAudio via the onFlash callback:
 * a double-pulse flash every ~11s. Returns [flash strength 0..1, flash ordinal].
 */
const flashAt = (t: number): [number, number] => {
  // Offset so the static first paint (t=0) and the first seconds are calm.
  const n = Math.floor((t + 7) / 11)
  const c = (t + 7) % 11
  // Two quick pulses, the second brighter — the classic strobe of a near strike.
  const p1 = c < 0.12 ? 1 - c / 0.12 : 0
  const p2 = c > 0.2 && c < 0.55 ? 1 - (c - 0.2) / 0.35 : 0
  return [Math.max(p1, p2 * 0.85), n]
}

const drawFrame = (canvas: HTMLCanvasElement, t: number): void => {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  // Device pixels per CSS pixel, so sizes below can be expressed in CSS pixels.
  const scale = w / (canvas.clientWidth || w)
  const cssMin = Math.min(w, h) / scale

  ctx.fillStyle = hex(BG_COLOR)
  ctx.fillRect(0, 0, w, h)

  // Faint grid, purely to give the space a floor and a sense of scale.
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'
  ctx.lineWidth = Math.max(1, Math.round(scale * 0.5))
  const cell = 56 * scale
  ctx.beginPath()
  for (let x = (w % cell) / 2; x < w; x += cell) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, h)
  }
  for (let y = (h % cell) / 2; y < h; y += cell) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(w, Math.round(y) + 0.5)
  }
  ctx.stroke()

  const blit = (grid: readonly string[], fx: number, fy: number, px: number, alpha: number, override?: Record<string, string>): void => {
    const gw = grid[0]!.length * px
    const gh = grid.length * px
    const ox = fx * w - gw / 2
    const oy = fy * h - gh / 2
    ctx.globalAlpha = alpha
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]!
      for (let q = 0; q < row.length; q++) {
        const ch = row[q]!
        if (ch === '.') continue
        ctx.fillStyle = override?.[ch] ?? PALETTE[ch]!
        ctx.fillRect(ox + q * px, oy + r * px, px, px)
      }
    }
    ctx.globalAlpha = 1
  }
  const glow = (fx: number, fy: number, r: number, rgb: string, a: number): void => {
    const grad = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, r)
    grad.addColorStop(0, `rgba(${rgb},${a})`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  // Pixel unit: readable on phones, restrained on desktops.
  const px = Math.max(3, Math.min(5.5, cssMin / 120)) * scale

  // One seeded stream per frame: the same sequence every frame, so every mote keeps its
  // identity and only its time-based drift moves it.
  let seed = 11
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647

  // Stars: a sky full of cold pixels, each twinkling on its own clock.
  ctx.fillStyle = '#cfd6ff'
  for (let i = 0; i < 64; i++) {
    const sx = rnd() * w
    const sy = rnd() * h
    const ph = rnd() * 6.28
    const tw = Math.sin(t * (0.6 + rnd() * 1.2) + ph)
    ctx.globalAlpha = 0.03 + Math.max(0, tw) * 0.16
    const s = (rnd() < 0.15 ? 2 : 1) * scale
    ctx.fillRect(sx, sy, s, s)
  }

  // Ash: slow violet flecks sinking through the dark, wrapping at the floor.
  ctx.fillStyle = '#b9a6e8'
  for (let i = 0; i < 26; i++) {
    const bx = rnd()
    const by = rnd()
    const sp = 0.008 + rnd() * 0.014
    const ax = (bx + Math.sin(t * 0.4 + i) * 0.012) * w
    const ay = ((by + t * sp) % 1.04 - 0.02) * h
    ctx.globalAlpha = 0.1 + rnd() * 0.14
    ctx.fillRect(ax, ay, 2 * scale, 2 * scale)
  }

  // Fireflies: seeded warm motes, drifting and breathing.
  ctx.fillStyle = '#ffe9b0'
  for (let i = 0; i < 22; i++) {
    const bx = rnd()
    const by = rnd()
    const ph = rnd() * 6.28
    ctx.globalAlpha = 0.06 + Math.max(0, Math.sin(t * 0.9 + ph * 3)) * 0.22
    const s = (rnd() < 0.3 ? 3 : 2) * scale
    const fx = (bx + Math.sin(t * 0.13 + ph) * 0.02) * w
    const fy = (by + Math.sin(t * 0.1 + ph * 1.7) * 0.015) * h
    ctx.fillRect(fx, fy, s, s)
  }
  ctx.globalAlpha = 1

  // ── THE CHASE: the ghost, its echo trail, a runner one step ahead ──
  // Landscape keeps it lower-left of the menu column; portrait phones move it to the
  // free strip along the bottom, where the menu never reaches.
  const portrait = h > w
  const lunge = Math.sin(t * 1.1) // the ghost gains, the runner pulls away, forever
  const gX = (portrait ? 0.24 : 0.21) + lunge * 0.008
  const gY = (portrait ? 0.9 : 0.64) + Math.sin(t * 2.1) * 0.007
  const rX = (portrait ? 0.5 : 0.335) + lunge * 0.004
  const rY = (portrait ? 0.875 : 0.575) + Math.sin(t * 3.4) * 0.005
  glow(gX, gY + 0.02, cssMin * 0.34 * scale, '255,217,163', 0.14 + 0.04 * Math.sin(t * 2.1))
  // The trail curves in from the far left — the mechanic, promised on frame one — with a
  // pulse of light forever travelling up it toward the ghost.
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = ECHO_ALPHA * ((i + 1) / 6) * (0.65 + 0.35 * Math.sin(t * 3 + i * 1.1))
    ctx.fillStyle = '#cfc5e8'
    const s = px * 2.6 * (0.75 + (i / 6) * 0.25)
    const ty = (portrait ? 0.965 : 0.78) - i * (portrait ? 0.012 : 0.021) + Math.sin(t * 1.6 + i) * 0.004
    ctx.fillRect((portrait ? 0.03 : 0.045) * w + i * px * 3.4 - s / 2, ty * h - s / 2, s, s)
  }
  ctx.globalAlpha = 1
  // Every few seconds the ghost's eyes catch the light — red, briefly.
  const eyesRed = (t + 2) % 7.3 < 0.9
  blit(GHOST, gX, gY, px * 1.25, 1, eyesRed ? { d: '#bdb3dc', k: '#ff5040' } : { d: '#bdb3dc' })
  // The runner, mid-flee, with their own dust of colour.
  blit(RUNNER, rX, rY, px * 0.85, 1)
  ctx.fillStyle = hex(PLAYER_COLORS[1]!)
  ctx.globalAlpha = 0.35
  ctx.fillRect((rX - 0.035) * w, (rY + 0.025) * h, px * 1.4, px * 1.4)
  ctx.fillRect((rX - 0.05) * w, (rY + 0.04) * h, px, px)
  ctx.globalAlpha = 1

  // ── The spider, yo-yoing on its silk (top-right) ──
  const sY = 0.15 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.5)) + 0.006 * Math.sin(t * 3.7)
  const sX = 0.84 + Math.sin(t * 0.8) * 0.004
  ctx.strokeStyle = 'rgba(207,200,232,0.4)'
  ctx.lineWidth = Math.max(1, px * 0.35)
  ctx.beginPath()
  ctx.moveTo(sX * w, 0)
  ctx.lineTo(sX * w, (sY - 0.035) * h)
  ctx.stroke()
  blit(SPIDER, sX, sY, px * 0.9, 1)

  // ── The UFO, hovering and sweeping its beam (top-left) ──
  const uX = 0.14 + Math.sin(t * 0.31) * 0.012
  const uY = 0.1 + Math.sin(t * 1.3) * 0.008
  glow(uX, uY + 0.12, cssMin * 0.2 * scale, '47,212,184', 0.08 + 0.04 * Math.sin(t * 5))
  const ux = uX * w
  const uy = (uY + 0.015) * h
  const sweep = Math.sin(t * 0.9) * px * 3 // the beam foot swings like a searchlight
  ctx.globalAlpha = 0.12 + 0.06 * Math.sin(t * 5)
  ctx.fillStyle = '#9fffe0'
  const beamTop = px * 3.2
  const beamBot = px * 9
  const beamH = 0.16 * h
  ctx.beginPath()
  ctx.moveTo(ux - beamTop, uy)
  ctx.lineTo(ux + beamTop, uy)
  ctx.lineTo(ux + beamBot + sweep, uy + beamH)
  ctx.lineTo(ux - beamBot + sweep, uy + beamH)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  blit(UFO, uX, uY, px, 1)

  // ── The alien, just watching (bottom-right) — and blinking, which is worse ──
  const blink = t % 3.9 < 0.16
  blit(
    ALIEN,
    (portrait ? 0.88 : 0.865) + Math.sin(t * 0.7) * 0.003,
    (portrait ? 0.62 : 0.75) + Math.sin(t * 1.7) * 0.004,
    px * 0.95,
    0.85,
    blink ? { k: '#a8d890' } : undefined,
  )

  // A warm pool of light in the middle and dusk at the edges — the game's actual mood.
  const glowR = Math.min(w, h) * 0.5
  const warm = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, glowR)
  warm.addColorStop(0, 'rgba(255,217,163,0.10)')
  warm.addColorStop(1, 'rgba(255,217,163,0)')
  ctx.fillStyle = warm
  ctx.fillRect(0, 0, w, h)

  const dusk = ctx.createRadialGradient(w / 2, h / 2, glowR * 0.7, w / 2, h / 2, Math.hypot(w, h) / 2)
  dusk.addColorStop(0, 'rgba(15,11,26,0)')
  dusk.addColorStop(1, 'rgba(15,11,26,0.8)')
  ctx.fillStyle = dusk
  ctx.fillRect(0, 0, w, h)

  // ── Lightning: a pixel bolt and a sky flash, on the shared schedule ──
  const [fa, fn] = flashAt(t)
  if (fa > 0) {
    // The bolt: jagged pixel steps from the sky, seeded by the flash ordinal so each
    // strike lands somewhere new but holds still for its own duration.
    let bseed = fn * 7919 + 13
    const brnd = (): number => (bseed = (bseed * 16807) % 2147483647) / 2147483647
    let bx = (0.3 + brnd() * 0.4) * w
    let by = 0
    ctx.fillStyle = '#eee6ff'
    ctx.globalAlpha = Math.min(1, fa * 1.3)
    const step = h * 0.045
    for (let i = 0; i < 12 && by < h * 0.55; i++) {
      const nx = bx + (brnd() - 0.5) * w * 0.06
      ctx.fillRect(Math.min(bx, nx), by, Math.abs(nx - bx) + px, px)
      ctx.fillRect(nx, by, px, step)
      bx = nx
      by += step
    }
    ctx.globalAlpha = 1
    // The flash itself: the whole night blinks violet-white.
    ctx.fillStyle = `rgba(205,195,255,${(fa * 0.16).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  }
}

/** One static frame — the instant first paint, and the reduced-motion fallback. */
export const drawPreview = (canvas: HTMLCanvasElement): void => drawFrame(canvas, 0)

/**
 * The living menu: ~30fps, skips hidden tabs, static under prefers-reduced-motion.
 * `onFlash` fires once per lightning strike so the thunder can answer the bolt.
 * Returns a stop function.
 */
export const animatePreview = (canvas: HTMLCanvasElement, onFlash?: () => void): (() => void) => {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {}
  let raf = 0
  let last = 0
  let lastFlash = -1
  const t0 = performance.now()
  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop)
    if (document.hidden || now - last < 31) return
    last = now
    const t = (now - t0) / 1000
    drawFrame(canvas, t)
    const [fa, fn] = flashAt(t)
    if (fa > 0 && fn !== lastFlash) {
      lastFlash = fn
      onFlash?.()
    }
  }
  raf = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(raf)
}
