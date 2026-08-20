import { MAP_TILE, MAP_TILES_X } from '@echo-tag/shared/constants'
import type { GameMap } from '@echo-tag/shared'
import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import { cosmeticRng, FIREFLY_COUNT, FIREFLY_DRIFT, FIREFLY_SIZE, FIREFLY_TINT } from '../theme.ts'

/**
 * Fireflies.
 *
 * The single cheapest thing that makes a dark world feel alive instead of empty: a hundred
 * warm points drifting slowly in the open spaces, each twinkling on its own phase. One
 * ParticleContainer, one draw call, reusing the 8px square texture at 3 world units — at
 * that size a square through fog reads as a glow point.
 *
 * They are pure set dressing: seeded per map, no collision, no gameplay meaning, and they
 * must stay dimmer than any echo so nobody ever mistakes one for an obstacle or a player.
 */

export interface AmbienceLayer {
  container: ParticleContainer
  particles: Particle[]
  /** Home position + motion phase per firefly, allocated once. */
  baseX: Float32Array
  baseY: Float32Array
  phase: Float32Array
}

export const createAmbienceLayer = (texture: Texture): AmbienceLayer => {
  const container = new ParticleContainer({
    dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false },
  })

  const particles: Particle[] = []
  const baseX = new Float32Array(FIREFLY_COUNT)
  const baseY = new Float32Array(FIREFLY_COUNT)
  const phase = new Float32Array(FIREFLY_COUNT)
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const p = new Particle({
      texture,
      x: -9999,
      y: -9999,
      scaleX: FIREFLY_SIZE / 8,
      scaleY: FIREFLY_SIZE / 8,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: FIREFLY_TINT,
      alpha: 0,
    })
    particles.push(p)
    container.addParticle(p)
  }

  return { container, particles, baseX, baseY, phase }
}

/** Re-seeds firefly homes for a map. Call on map change. */
export const seedAmbience = (layer: AmbienceLayer, map: GameMap): void => {
  const rng = cosmeticRng(0xf17ef1 + map.index * 131)
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    layer.baseX[i] = (tile % MAP_TILES_X) * MAP_TILE + rng() * MAP_TILE
    layer.baseY[i] = ((tile / MAP_TILES_X) | 0) * MAP_TILE + rng() * MAP_TILE
    layer.phase[i] = rng() * Math.PI * 2
  }
}

export const renderAmbience = (layer: AmbienceLayer, nowMs: number): void => {
  const t = nowMs * 0.001
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const p = layer.particles[i]!
    const ph = layer.phase[i]!
    // Slow lissajous drift around home — organic without being trackable.
    p.x = layer.baseX[i]! + Math.sin(t * 0.21 + ph) * FIREFLY_DRIFT
    p.y = layer.baseY[i]! + Math.sin(t * 0.17 + ph * 1.7) * FIREFLY_DRIFT * 0.7
    // Twinkle: mostly dim, briefly bright, never brighter than an echo.
    const tw = Math.sin(t * 0.9 + ph * 3.1)
    p.alpha = 0.05 + Math.max(0, tw) * 0.18
  }
}
