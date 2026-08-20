import { IT_RING_COLOR, PLAYER_RADIUS, type World } from '@echo-tag/shared'
import { Container, Sprite, type Texture } from 'pixi.js'
import { toScreenX, toScreenY, type Camera } from '../engine/camera.ts'

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

  const container = new Container()
  container.addChild(ring)
  container.addChild(core)
  return { container, ring, core }
}

export const renderFx = (
  layer: FxLayer,
  world: World,
  prevX: Float32Array,
  prevY: Float32Array,
  alpha: number,
  cam: Camera,
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
  const x = toScreenX(cam, wx)
  const y = toScreenY(cam, wy)

  // Two concentric halos rather than one. A single soft glow at low alpha disappears into a
  // busy arena; a bright tight core plus a wide slow pulse survives twelve trails crossing
  // behind it, which is the whole requirement — "parse this in under half a second".
  layer.ring.visible = true
  layer.ring.x = x
  layer.ring.y = y
  const outer = PLAYER_RADIUS * cam.scale * (6.4 + pulse * 1.8)
  layer.ring.width = outer
  layer.ring.height = outer
  layer.ring.alpha = 0.34 + pulse * 0.3

  layer.core.visible = true
  layer.core.x = x
  layer.core.y = y
  const inner = PLAYER_RADIUS * cam.scale * (2.6 + pulse * 0.35)
  layer.core.width = inner
  layer.core.height = inner
  layer.core.alpha = 0.6 + pulse * 0.25
}
