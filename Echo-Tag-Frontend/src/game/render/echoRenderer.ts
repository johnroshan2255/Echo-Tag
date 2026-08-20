import {
  ECHO_ALPHA,
  ECHO_BODIES_PER_PLAYER,
  ECHO_RADIUS,
  ECHO_VISUAL_SCALE,
  MAX_PLAYERS,
  PLAYER_COLORS,
  type World,
} from '@echo-tag/shared'
import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import { ECHO, ECHO_GRID_H, ECHO_GRID_W } from './templates.ts'

/**
 * Echo silhouettes.
 *
 * 12 players x 15 solid bodies x 29 squares = 5,220 particles in one container, and this is
 * the single biggest thing on screen at 2:30. Two decisions keep it affordable and, more
 * importantly, *legible*:
 *
 *   1. Echoes use a 29-cell blocky silhouette, not the 168-cell avatar. Every game that has
 *      shipped a past-self mechanic converges on the same lesson: ghosts must be visually
 *      quieter and coarser than the live actor, or the screen turns to soup. This is a
 *      readability decision that happens to also be a performance win.
 *   2. Alpha ramps with age, so the freshest echo behind a player is the most solid-looking
 *      and the three-second-old one is nearly gone. That gradient is what tells a player
 *      which way an echo trail is *moving*, which is the difference between this and a
 *      static maze.
 *
 * Echo positions come from `world.bodyX/bodyY`, which the shared simulation derives from the
 * position rings. Nothing about echoes is networked — see docs/adr/0004.
 */

const PARKED = -9999
/**
 * Drawn width per cell. Note the ECHO_VISUAL_SCALE factor: echoes are rendered wider than
 * they collide, so a trail reads as the continuous wall that collision already treats it as.
 * The reasoning, and why generous is the safe direction, is in constants.ts.
 */
const CELL_WORLD = (ECHO_RADIUS * 2 * ECHO_VISUAL_SCALE) / ECHO_GRID_W
/** Particle scale for one echo cell at world size (8px texture). Camera handles zoom. */
const WORLD_SCALE = CELL_WORLD / 8

export interface EchoLayer {
  container: ParticleContainer
  particles: Particle[]
  /** Particles per echo body. */
  stride: number
  /** Echo bodies in total, across all players. */
  bodies: number
}

export const createEchoLayer = (texture: Texture): EchoLayer => {
  const stride = ECHO.count
  const bodies = MAX_PLAYERS * ECHO_BODIES_PER_PLAYER
  const container = new ParticleContainer({
    // `vertex: true` because scale lives in the vertex attribute — see the note in
    // squareBody.ts. Echo scale only changes on resize, so this could be static plus a
    // `container.update()` on resize; it is dynamic because 2,880 extra vertex uploads a
    // frame measured as free here, and a static buffer that silently keeps a stale scale is
    // exactly the bug that cost us an afternoon.
    dynamicProperties: {
      position: true,
      vertex: true,
      color: true, // alpha ramps with echo age
      rotation: false,
      uvs: false,
    },
  })

  const particles: Particle[] = []
  for (let b = 0; b < bodies; b++) {
    const owner = (b / ECHO_BODIES_PER_PLAYER) | 0
    const tint = PLAYER_COLORS[owner % PLAYER_COLORS.length]!
    for (let i = 0; i < stride; i++) {
      const particle = new Particle({
        texture,
        x: PARKED,
        y: PARKED,
        scaleX: WORLD_SCALE,
        scaleY: WORLD_SCALE,
        anchorX: 0.5,
        anchorY: 0.5,
        tint,
        alpha: ECHO_ALPHA,
      })
      particles.push(particle)
      container.addParticle(particle)
    }
  }

  return { container, particles, stride, bodies }
}

export const renderEchoes = (
  layer: EchoLayer,
  world: World,
  prevBodyX: Float32Array,
  prevBodyY: Float32Array,
  alpha: number,
): void => {
  const { particles, stride, bodies } = layer
  const scale = WORLD_SCALE

  for (let b = 0; b < bodies; b++) {
    const base = b * stride

    if (world.bodyLive[b] === 0) {
      for (let i = 0; i < stride; i++) {
        particles[base + i]!.x = PARKED
        particles[base + i]!.y = PARKED
      }
      continue
    }

    // Interpolate: each tick a body advances one ring sample along its owner's old path, so
    // lerping between ticks walks that path smoothly rather than stepping at 20Hz.
    const wx = prevBodyX[b]! + (world.bodyX[b]! - prevBodyX[b]!) * alpha
    const wy = prevBodyY[b]! + (world.bodyY[b]! - prevBodyY[b]!) * alpha

    // Age 4..60 samples. The oldest end of the trail fades almost out, which is what tells
    // a player which way a trail is travelling — the single most important piece of
    // information an echo carries, and the thing that separates this from a static maze.
    const ageFrac = world.bodyAge[b]! / (ECHO_BODIES_PER_PLAYER * 4)
    const a = ECHO_ALPHA * (1 - ageFrac * 0.82)

    const owner = world.bodyOwner[b]!
    const tint = PLAYER_COLORS[world.colorSlot[owner]! % PLAYER_COLORS.length]!

    for (let i = 0; i < stride; i++) {
      const particle = particles[base + i]!
      particle.x = wx + (ECHO.gx[i]! - (ECHO_GRID_W - 1) / 2) * CELL_WORLD
      particle.y = wy + (ECHO.gy[i]! - (ECHO_GRID_H - 1) / 2) * CELL_WORLD
      particle.scaleX = scale
      particle.scaleY = scale
      particle.alpha = a
      particle.tint = tint
    }
  }
}
