import type { Renderer, Texture } from 'pixi.js'
import { Texture as PixiTexture } from 'pixi.js'

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

export const squareTexture = (_renderer: Renderer): Texture => {
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
