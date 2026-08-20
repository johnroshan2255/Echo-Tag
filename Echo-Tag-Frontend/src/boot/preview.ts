import { BG_COLOR, ECHO_ALPHA, PLAYER_COLORS } from '@echo-tag/shared/constants'

/**
 * The arena preview, drawn with plain Canvas2D.
 *
 * This exists so the player sees the game — not a spinner — within a few hundred
 * milliseconds. It is deliberately *not* PixiJS: the whole point is that it runs before the
 * engine chunk has finished downloading, so it may not import anything heavy. It shows a
 * still frame of the mechanic (avatars each dragging a fading trail) which doubles as the
 * clearest one-glance explanation of what the game is.
 *
 * Cost budget: a few hundred microseconds, once. No animation loop.
 *
 * Note it sizes everything from *CSS* pixels, not the canvas backing-store size. The canvas
 * is sized in device pixels for sharpness, so measuring from `canvas.width` makes every
 * square three times too big on a phone — which is exactly the bug the first version had.
 */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

interface Actor {
  /** Position as a fraction of the frame. Kept within 0.12–0.88 so trails stay in shot. */
  x: number
  y: number
  /** Heading the actor is travelling in; the trail is laid down behind it. */
  angle: number
  color: number
}

/**
 * A fixed, hand-picked arrangement rather than something random, so the very first frame a
 * player ever sees is always a good one. Headings fan outward from the middle so no trail
 * points off-frame.
 */
const CAST: readonly Actor[] = [
  { x: 0.30, y: 0.30, angle: -2.3, color: 0 },
  { x: 0.70, y: 0.26, angle: -0.7, color: 1 },
  { x: 0.82, y: 0.54, angle: 0.2, color: 2 },
  { x: 0.68, y: 0.78, angle: 1.0, color: 3 },
  { x: 0.34, y: 0.76, angle: 2.2, color: 4 },
  { x: 0.16, y: 0.52, angle: 3.0, color: 5 },
  // Kept clear of the middle: the Play button and tagline sit there, and an avatar behind
  // the button reads as a rendering glitch rather than as gameplay.
  { x: 0.40, y: 0.16, angle: -1.4, color: 6 },
  { x: 0.62, y: 0.90, angle: 1.7, color: 7 },
]

const ECHOES = 7

export const drawPreview = (canvas: HTMLCanvasElement): void => {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  // Device pixels per CSS pixel, so sizes below can be expressed in CSS pixels.
  const scale = w / (canvas.clientWidth || w)

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

  const body = 13 * scale
  const step = body * 1.45

  for (const a of CAST) {
    const color = hex(PLAYER_COLORS[a.color % PLAYER_COLORS.length]!)
    const cx = a.x * w
    const cy = a.y * h
    // Trail trails *behind* the heading.
    const dx = -Math.cos(a.angle) * step
    const dy = -Math.sin(a.angle) * step

    ctx.fillStyle = color

    // Oldest and faintest first, so the live body draws cleanly over its own trail.
    for (let i = ECHOES; i >= 1; i--) {
      ctx.globalAlpha = ECHO_ALPHA * (1 - (i - 1) / ECHOES)
      const s = body * (1 - (i / ECHOES) * 0.25) // taper slightly with age
      ctx.fillRect(cx + dx * i - s / 2, cy + dy * i - s / 2, s, s)
    }

    ctx.globalAlpha = 1
    ctx.fillRect(cx - body / 2, cy - body / 2, body, body)
  }

  // A warm pool of light in the middle and dusk at the edges — the game's actual mood,
  // promised on the very first frame.
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
