import { IT_RING_COLOR, PLAYER_RADIUS, type World } from '@echo-tag/shared'
import { Container, Sprite, type Texture } from 'pixi.js'
import { LANTERN_ALPHA, LANTERN_RADIUS, LANTERN_TINT } from '../theme.ts'

/**
 * The "It" indicator.
 *
 * A single additively-blended radial-gradient sprite under the It player, pulsed by scale
 * and alpha. This is what replaces `GlowFilter` from `pixi-filters`, for three reasons: a
 * filter cannot be applied to a `ParticleContainer` at all in PixiJS v8; a filter pass means
 * an extra render target plus a full-screen shader, which is the wrong price on the low-end
 * GPUs Poki's audience actually uses; and at the size an avatar occupies on a phone a soft
 * additive halo simply reads better than an outline glow.
 *
 * The design brief for this element is "can a player parse this in under half a second in a
 * busy arena" — so it pulses, because motion is what the eye finds first.
 */

export interface FxLayer {
  container: Container
  /** Wide, slow halo — visible from across the arena. */
  ring: Sprite
  /** Tight bright core — survives a crowded foreground. */
  core: Sprite
  /** The local player's lantern: warm light that justifies the vision circle. */
  lantern: Sprite
}

export const createFxLayer = (glow: Texture): FxLayer => {
  const make = (): Sprite => {
    const s = new Sprite(glow)
    s.anchor.set(0.5)
    s.blendMode = 'add'
    s.visible = false
    s.tint = IT_RING_COLOR
    return s
  }
  const ring = make()
  const core = make()
  // The lantern shares the glow texture and additive blend, so the fx layer stays one
  // draw call. It renders under the halo: light first, marking on top.
  const lantern = make()
  lantern.tint = LANTERN_TINT

  const container = new Container()
  container.addChild(lantern)
  container.addChild(ring)
  container.addChild(core)
  return { container, ring, core, lantern }
}

/** Places the warm pool of light under the local player. World coordinates. */
export const renderLantern = (layer: FxLayer, wx: number, wy: number, nowMs: number): void => {
  const l = layer.lantern
  l.visible = true
  l.x = wx
  l.y = wy
  const size = LANTERN_RADIUS * 2
  l.width = size
  l.height = size
  // Two incommensurate sines make a gentle flicker that never reads as a loop.
  l.alpha = LANTERN_ALPHA + 0.018 * Math.sin(nowMs * 0.0013) + 0.012 * Math.sin(nowMs * 0.0041)
}

export const renderFx = (
  layer: FxLayer,
  world: World,
  prevX: Float32Array,
  prevY: Float32Array,
  alpha: number,
  nowMs: number,
): void => {
  const it = world.itSlot
  if (it < 0 || world.active[it] === 0) {
    layer.ring.visible = false
    layer.core.visible = false
    return
  }

  const wx = prevX[it]! + (world.x[it]! - prevX[it]!) * alpha
  const wy = prevY[it]! + (world.y[it]! - prevY[it]!) * alpha

  const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.007)
  const x = wx
  const y = wy

  // Two concentric halos rather than one. A single soft glow at low alpha disappears into a
  // busy arena; a bright tight core plus a wide slow pulse survives twelve trails crossing
  // behind it, which is the whole requirement — "parse this in under half a second".
  layer.ring.visible = true
  layer.ring.x = x
  layer.ring.y = y
  const outer = PLAYER_RADIUS * (6.4 + pulse * 1.8)
  layer.ring.width = outer
  layer.ring.height = outer
  layer.ring.alpha = 0.34 + pulse * 0.3

  layer.core.visible = true
  layer.core.x = x
  layer.core.y = y
  const inner = PLAYER_RADIUS * (2.6 + pulse * 0.35)
  layer.core.width = inner
  layer.core.height = inner
  layer.core.alpha = 0.6 + pulse * 0.25
}
