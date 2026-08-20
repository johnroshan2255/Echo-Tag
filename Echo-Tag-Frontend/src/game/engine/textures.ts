import { Texture as PixiTexture, type Texture } from 'pixi.js'

/**
 * Every texture in Echo Tag is generated here, at runtime, into a canvas.
 *
 * This is the reason the game fetches no assets at all — no PNGs, no sprite sheets, no
 * atlas, and therefore no request latency, no decode cost and no bytes in the load budget.
 * It is also what makes 12 uniquely coloured players cheap: one white square, tinted per
 * particle, instead of twelve pre-rendered variants.
 *
 * The square is 8x8 rather than 1x1 so that a tinted particle scaled up stays crisp and
 * gets a sane mip, and so every particle in the arena shares one texture source — which
 * is what lets `ParticleContainer` batch the whole arena into a single draw call.
 */

let cachedSquare: Texture | null = null

export const squareTexture = (): Texture => {
  if (cachedSquare) return cachedSquare

  const size = 8
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('textures: 2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  cachedSquare = PixiTexture.from(canvas)
  return cachedSquare
}

/**
 * A soft radial gradient, additively blended under the "It" player.
 *
 * This replaces `GlowFilter` from `pixi-filters`: a filter cannot be applied to a
 * `ParticleContainer` at all in PixiJS v8, and it would cost an extra render target plus a
 * full-screen pass — the wrong price on the low-end GPUs this game has to run on. One
 * additive quad reads better at small sizes and costs essentially nothing.
 * See docs/adr/0003-drop-gsap-and-nipplejs.md.
 */
let cachedGlow: Texture | null = null

export const glowTexture = (): Texture => {
  if (cachedGlow) return cachedGlow

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('textures: 2d context unavailable')

  const r = size / 2
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  cachedGlow = PixiTexture.from(canvas)
  return cachedGlow
}

/**
 * The fog-of-war texture: a transparent core feathering out to near-opaque dusk.
 *
 * Geometry contract with `render/fog.ts`: the clear core ends at CLEAR_STOP of the half-size
 * and the fade completes at FULL_STOP, so the renderer can convert "world units of vision"
 * into a sprite scale exactly. Everything past FULL_STOP is solid, which is what lets one
 * quad fog an entire screen — the sprite just has to be big enough that its solid region
 * reaches past the corners.
 */
export const FOG_TEX_SIZE = 1024
/**
 * The fade completes at 30% of the half-size, leaving 70% of the radius as solid fog.
 * That long solid tail is load-bearing: `render/fog.ts` must sometimes enlarge the sprite
 * so its solid region reaches past the screen corners, and enlarging stretches the gradient
 * with it. With a short tail (an earlier draft used 0.62) that coverage scale-up pushed the
 * full-fog ring off screen entirely and the "one room of vision" quietly became three.
 */
export const FOG_FULL_STOP = 0.3

let cachedFog: Texture | null = null

/** `clearFrac`: how far through the fade the fully-clear core extends (VISION_CLEAR / VISION_MAX). */
export const fogTexture = (rgb: [number, number, number], maxAlpha: number, clearFrac: number): Texture => {
  if (cachedFog) return cachedFog

  const size = FOG_TEX_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('textures: 2d context unavailable')

  const [r, g, b] = rgb
  const half = size / 2
  const clearStop = FOG_FULL_STOP * clearFrac
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(clearStop, `rgba(${r},${g},${b},0)`)
  // Ease the ramp with a midpoint so the feather is soft, not linear.
  grad.addColorStop((clearStop + FOG_FULL_STOP) / 2, `rgba(${r},${g},${b},${maxAlpha * 0.55})`)
  grad.addColorStop(FOG_FULL_STOP, `rgba(${r},${g},${b},${maxAlpha})`)
  grad.addColorStop(1, `rgba(${r},${g},${b},${maxAlpha})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  cachedFog = PixiTexture.from(canvas)
  return cachedFog
}
