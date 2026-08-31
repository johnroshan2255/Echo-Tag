import { BG_COLOR, ECHO_ALPHA, PLAYER_COLORS } from '@echo-tag/shared/constants'

/**
 * The menu backdrop, drawn with plain Canvas2D.
 *
 * This exists so the player sees the game — not a spinner — within a few hundred
 * milliseconds, and it now shows the game's whole CAST: the white-sheeted ghost dragging
 * its echo trail after a fleeing runner, the nest spider descending on its thread, the
 * UFO with its tractor beam, the alien watching from the dusk. One glance says "monsters
 * chase people here", which is the entire pitch.
 *
 * Deliberately NOT PixiJS: it runs before the engine chunk finishes downloading, so it
 * may import nothing heavy. Cost budget: a few hundred microseconds, once. No loop.
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

export const drawPreview = (canvas: HTMLCanvasElement): void => {
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

  // Fireflies: seeded warm motes in the dark.
  let seed = 11
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 22; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.2
    ctx.fillStyle = '#ffe9b0'
    const s = (rnd() < 0.3 ? 3 : 2) * scale
    ctx.fillRect(rnd() * w, rnd() * h, s, s)
  }
  ctx.globalAlpha = 1

  // ── THE CHASE: the ghost, its echo trail, a runner one step ahead ──
  // Landscape keeps it lower-left of the menu column; portrait phones move it to the
  // free strip along the bottom, where the menu never reaches.
  const portrait = h > w
  const gX = portrait ? 0.24 : 0.21
  const gY = portrait ? 0.9 : 0.64
  const rX = portrait ? 0.5 : 0.335
  const rY = portrait ? 0.875 : 0.575
  glow(gX, gY + 0.02, cssMin * 0.34 * scale, '255,217,163', 0.16) // the ghost's lantern
  // The trail curves in from the far left — the mechanic, promised on frame one.
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = ECHO_ALPHA * ((i + 1) / 6)
    ctx.fillStyle = '#cfc5e8'
    const s = px * 2.6 * (0.75 + (i / 6) * 0.25)
    const ty = (portrait ? 0.965 : 0.78) - i * (portrait ? 0.012 : 0.021)
    ctx.fillRect((portrait ? 0.03 : 0.045) * w + i * px * 3.4 - s / 2, ty * h - s / 2, s, s)
  }
  ctx.globalAlpha = 1
  blit(GHOST, gX, gY, px * 1.25, 1, { d: '#bdb3dc' })
  // The runner, mid-flee, with their own dust of colour.
  blit(RUNNER, rX, rY, px * 0.85, 1)
  ctx.fillStyle = hex(PLAYER_COLORS[1]!)
  ctx.globalAlpha = 0.35
  ctx.fillRect((rX - 0.035) * w, (rY + 0.025) * h, px * 1.4, px * 1.4)
  ctx.fillRect((rX - 0.05) * w, (rY + 0.04) * h, px, px)
  ctx.globalAlpha = 1

  // ── The spider, descending on its silk (top-right) ──
  ctx.strokeStyle = 'rgba(207,200,232,0.4)'
  ctx.lineWidth = Math.max(1, px * 0.35)
  ctx.beginPath()
  ctx.moveTo(0.84 * w, 0)
  ctx.lineTo(0.84 * w, 0.175 * h)
  ctx.stroke()
  blit(SPIDER, 0.84, 0.21, px * 0.9, 1)

  // ── The UFO, sweeping its beam (top-left) ──
  glow(0.14, 0.22, cssMin * 0.2 * scale, '47,212,184', 0.1)
  const ux = 0.14 * w
  const uy = 0.115 * h
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#9fffe0'
  const beamTop = px * 3.2
  const beamBot = px * 9
  const beamH = 0.16 * h
  ctx.beginPath()
  ctx.moveTo(ux - beamTop, uy)
  ctx.lineTo(ux + beamTop, uy)
  ctx.lineTo(ux + beamBot, uy + beamH)
  ctx.lineTo(ux - beamBot, uy + beamH)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  blit(UFO, 0.14, 0.1, px, 1)

  // ── The alien, just watching (bottom-right) ──
  blit(ALIEN, portrait ? 0.88 : 0.865, portrait ? 0.62 : 0.75, px * 0.95, 0.85)

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

  ctx.globalAlpha = 1
}
