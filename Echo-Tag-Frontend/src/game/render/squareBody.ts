import { MAX_PLAYERS, PLAYER_RADIUS, PLAYER_COLORS } from '@echo-tag/shared/constants'
import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import { BODY, GRID_GROUND, GRID_W } from './templates.ts'

/**
 * Allocation of live-player particles.
 *
 * PixiJS v8's `ParticleContainer` holds `Particle` objects — not sprites — and supports no
 * children, no filters and no interaction. So an avatar cannot be "a container of squares";
 * instead every avatar owns a **contiguous slice** of one shared container, and the
 * renderer writes into that slice. Player `p` owns `[p * BODY.count, (p+1) * BODY.count)`.
 *
 * Slices are allocated once, here, and never resized. Joining mid-round claims an existing
 * slot, so its slice already exists — a leaver's squares are parked off-screen rather than
 * removed, because adding or removing a particle forces Pixi to re-upload the container's
 * static buffers.
 */

/** Grid cells per world unit: the avatar is two player-radii wide. */
export const CELL_WORLD = (PLAYER_RADIUS * 2) / GRID_W

/** Texture is 8px square; scale maps it onto one world-unit cell. */
const TEXTURE_PX = 8
/** Particle scale that renders one body cell at world size. Camera handles zoom. */
export const WORLD_SCALE = CELL_WORLD / TEXTURE_PX

export interface BodyLayer {
  container: ParticleContainer
  particles: Particle[]
  /** One flattened ground-shadow particle per player. Allocated FIRST in the container,
   * so every shadow draws under every body — same texture, same draw call. */
  shadows: Particle[]
  /** Particles per player. Derived from the template, not hardcoded. */
  stride: number
}

export const createBodyLayer = (texture: Texture): BodyLayer => {
  const stride = BODY.count
  const container = new ParticleContainer({
    // TRAP: `dynamicProperties` is typed `ParticleProperties & Record<string, boolean>`, so
    // an invalid key is silently accepted and does nothing. There is no `scale` property —
    // a particle's scale and anchor are baked into its **vertex** attribute, so per-frame
    // scaling requires `vertex: true`. Passing `scale: true` type-checks, runs, and leaves
    // every square stuck at whatever scale it was constructed with.
    //
    // We need per-frame vertex updates for squash-and-stretch and for the blink, and
    // per-frame colour for the It flash and edge shading. Rotation and UVs never change:
    // every square shares one texture and squares do not spin.
    dynamicProperties: {
      position: true,
      vertex: true,
      color: true,
      rotation: false,
      uvs: false,
    },
  })

  // Shadows first: insertion order is draw order inside a ParticleContainer, and a shadow
  // over a face is worse than no shadow at all. A hard-edged flattened square fits the
  // game's pixel register better than a soft ellipse would.
  const shadows: Particle[] = []
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const s = new Particle({
      texture,
      x: -9999,
      y: -9999,
      scaleX: WORLD_SCALE,
      scaleY: WORLD_SCALE,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: 0x0a0816,
      alpha: 0.3,
    })
    shadows.push(s)
    container.addParticle(s)
  }

  const particles: Particle[] = []
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const tint = PLAYER_COLORS[p % PLAYER_COLORS.length]!
    for (let i = 0; i < stride; i++) {
      const particle = new Particle({
        texture,
        x: -9999, // parked until the first frame places it
        y: -9999,
        scaleX: WORLD_SCALE,
        scaleY: WORLD_SCALE,
        anchorX: 0.5,
        anchorY: 0.5,
        tint,
      })
      particles.push(particle)
      container.addParticle(particle)
    }
  }

  return { container, particles, shadows, stride }
}

/** Grid-space to avatar-local world offset. The avatar is anchored at its feet. */
export const cellOffsetX = (gx: number): number => (gx - (GRID_W - 1) / 2) * CELL_WORLD
export const cellOffsetY = (gy: number): number => (gy - GRID_GROUND) * CELL_WORLD
