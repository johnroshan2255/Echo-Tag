import { MAP_TILE, MAP_TILES_X, MAP_W, MAP_H } from '@echo-tag/shared/constants'
import type { GameMap } from '@echo-tag/shared'
import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import {
  BAT_COUNT,
  BAT_LULL_MAX,
  BAT_LULL_MIN,
  BAT_SIZE,
  BAT_TINT,
  cosmeticRng,
  FIREFLY_COUNT,
  FIREFLY_DRIFT,
  FIREFLY_SIZE,
  FIREFLY_TINT,
  SPIDER_COUNT,
  SPIDER_SIZE,
  SPIDER_TINT,
  WREATH_COUNT,
  WREATH_SIZE,
  WREATH_TINT,
} from '../theme.ts'

/**
 * The living dark: fireflies, spiders, bats. One ParticleContainer, one draw call — every
 * creature is the same 8px square at a different size, tint and motion.
 *
 * Fireflies are the warmth; spiders and bats are the horror half of the Koira register.
 * Spiders are shadows that skitter in bursts near the walls and freeze — motion in the
 * corner of the eye. Bats pass as an occasional flock that crosses the player's general
 * area, weaving and flapping, announced by a flutter of wings (the audio director watches
 * `flockJustStarted`).
 *
 * All of it is pure set dressing: seeded per map, no collision, no gameplay meaning, and
 * everything stays dimmer or darker than any echo so nobody ever mistakes dressing for an
 * obstacle or a player.
 */

export interface AmbienceLayer {
  container: ParticleContainer
  particles: Particle[]
  /** Home position + motion phase per firefly, allocated once. */
  baseX: Float32Array
  baseY: Float32Array
  phase: Float32Array
  // Spiders: current position, heading, per-spider phase.
  spiders: Particle[]
  spX: Float32Array
  spY: Float32Array
  spHeading: Float32Array
  spPhase: Float32Array
  // Transformation wreath: bats whirling around the turning player (gameplay telegraph).
  wreath: Particle[]
  // Bats: one flock at a time.
  bats: Particle[]
  batOriginX: number
  batOriginY: number
  batDirX: number
  batDirY: number
  batStartedMs: number
  nextFlockMs: number
  flockJustStarted: boolean
  rngState: () => number
}

export const createAmbienceLayer = (texture: Texture): AmbienceLayer => {
  const container = new ParticleContainer({
    // `vertex: true` because scale lives in the vertex attribute (see squareBody.ts): the
    // bats' wingbeat and the wreath's flutter are per-frame scaleY writes, which a static
    // vertex buffer would silently ignore. ~160 particles, so the upload is noise.
    dynamicProperties: { position: true, color: true, vertex: true, rotation: false, uvs: false },
  })

  const make = (size: number, tint: number): Particle => {
    const p = new Particle({
      texture,
      x: -9999,
      y: -9999,
      scaleX: size / 8,
      scaleY: size / 8,
      anchorX: 0.5,
      anchorY: 0.5,
      tint,
      alpha: 0,
    })
    container.addParticle(p)
    return p
  }

  const particles: Particle[] = []
  for (let i = 0; i < FIREFLY_COUNT; i++) particles.push(make(FIREFLY_SIZE, FIREFLY_TINT))
  const spiders: Particle[] = []
  for (let i = 0; i < SPIDER_COUNT; i++) spiders.push(make(SPIDER_SIZE, SPIDER_TINT))
  const bats: Particle[] = []
  for (let i = 0; i < BAT_COUNT; i++) bats.push(make(BAT_SIZE, BAT_TINT))
  const wreath: Particle[] = []
  for (let i = 0; i < WREATH_COUNT; i++) wreath.push(make(WREATH_SIZE, WREATH_TINT))

  return {
    wreath,
    container,
    particles,
    baseX: new Float32Array(FIREFLY_COUNT),
    baseY: new Float32Array(FIREFLY_COUNT),
    phase: new Float32Array(FIREFLY_COUNT),
    spiders,
    spX: new Float32Array(SPIDER_COUNT),
    spY: new Float32Array(SPIDER_COUNT),
    spHeading: new Float32Array(SPIDER_COUNT),
    spPhase: new Float32Array(SPIDER_COUNT),
    bats,
    batOriginX: 0,
    batOriginY: 0,
    batDirX: 1,
    batDirY: 0,
    batStartedMs: -1,
    nextFlockMs: 9000,
    flockJustStarted: false,
    rngState: cosmeticRng(0xba7ba7),
  }
}

/** Re-seeds firefly homes and spider haunts for a map. Call on map change. */
export const seedAmbience = (layer: AmbienceLayer, map: GameMap): void => {
  const rng = cosmeticRng(0xf17ef1 + map.index * 131)
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    layer.baseX[i] = (tile % MAP_TILES_X) * MAP_TILE + rng() * MAP_TILE
    layer.baseY[i] = ((tile / MAP_TILES_X) | 0) * MAP_TILE + rng() * MAP_TILE
    layer.phase[i] = rng() * Math.PI * 2
  }
  for (let i = 0; i < SPIDER_COUNT; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    layer.spX[i] = (tile % MAP_TILES_X) * MAP_TILE + rng() * MAP_TILE
    layer.spY[i] = ((tile / MAP_TILES_X) | 0) * MAP_TILE + rng() * MAP_TILE
    layer.spHeading[i] = rng() * Math.PI * 2
    layer.spPhase[i] = rng() * 10
  }
}

/** Per-frame update. Returns nothing but sets `flockJustStarted` on bat launch frames. */
export const renderAmbience = (layer: AmbienceLayer, nowMs: number, camX: number, camY: number): void => {
  const t = nowMs * 0.001
  layer.flockJustStarted = false

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

  // Spiders: skitter-freeze. A burst of quick legwork, then dead stillness — the freeze is
  // what makes the next burst read as movement in the corner of the eye.
  for (let i = 0; i < SPIDER_COUNT; i++) {
    const p = layer.spiders[i]!
    const cycle = (t * 0.5 + layer.spPhase[i]!) % 3
    if (cycle < 0.4) {
      layer.spX[i] = layer.spX[i]! + Math.cos(layer.spHeading[i]!) * 1.6
      layer.spY[i] = layer.spY[i]! + Math.sin(layer.spHeading[i]!) * 1.6
    } else if (cycle > 2.96) {
      // Turn while frozen, occasionally reversing — spiders do not walk straight lines.
      layer.spHeading[i] = layer.spHeading[i]! + (layer.rngState() - 0.4) * 2.4
    }
    // Never wander off the map.
    if (layer.spX[i]! < 90 || layer.spX[i]! > MAP_W - 90) layer.spHeading[i] = Math.PI - layer.spHeading[i]!
    if (layer.spY[i]! < 90 || layer.spY[i]! > MAP_H - 90) layer.spHeading[i] = -layer.spHeading[i]!
    p.x = layer.spX[i]!
    p.y = layer.spY[i]!
    p.alpha = 0.8
  }

  // Bats: one flock at a time, launched on a lull timer, crossing the player's general
  // area so it is always half-seen through the fog rather than staged in front of you.
  if (layer.batStartedMs < 0 && nowMs >= layer.nextFlockMs) {
    const angle = layer.rngState() * Math.PI * 2
    layer.batDirX = Math.cos(angle)
    layer.batDirY = Math.sin(angle)
    layer.batOriginX = camX - layer.batDirX * 900 + (layer.rngState() - 0.5) * 500
    layer.batOriginY = camY - layer.batDirY * 900 + (layer.rngState() - 0.5) * 500
    layer.batStartedMs = nowMs
    layer.flockJustStarted = true
  }

  if (layer.batStartedMs >= 0) {
    const age = (nowMs - layer.batStartedMs) / 1000
    const dist = age * 430 // wing speed in world units/sec
    for (let i = 0; i < BAT_COUNT; i++) {
      const p = layer.bats[i]!
      const lag = i * 46 + Math.sin(t * 2.1 + i * 2.7) * 22 // stagger + jostle
      const weave = Math.sin(t * 3.4 + i * 1.9) * 46
      p.x = layer.batOriginX + layer.batDirX * (dist - lag) - layer.batDirY * weave
      p.y = layer.batOriginY + layer.batDirY * (dist - lag) + layer.batDirX * weave
      // The flap: vertical squash at wingbeat rate.
      p.scaleY = ((BAT_SIZE / 8) * (0.45 + Math.abs(Math.sin(t * 14 + i)))) / 1.4
      p.alpha = 0.85
    }
    if (dist > 2100) {
      layer.batStartedMs = -1
      layer.nextFlockMs = nowMs + (BAT_LULL_MIN + layer.rngState() * (BAT_LULL_MAX - BAT_LULL_MIN)) * 1000
      for (const p of layer.bats) p.alpha = 0
    }
  }
}

/**
 * The metamorphosis wreath: bats whirling around the turning player, the ring tightening
 * as the ghost forms (`progress` 0 → 1). Unlike everything else in this layer this IS
 * gameplay information — the sim telegraphs `turningSlot` exactly so this can exist.
 * Same particles, same container, zero extra draw calls.
 */
export const renderWreath = (
  layer: AmbienceLayer,
  visible: boolean,
  wx: number,
  wy: number,
  progress: number,
  nowMs: number,
): void => {
  if (!visible) {
    if (layer.wreath[0]!.alpha !== 0) {
      for (const p of layer.wreath) {
        p.alpha = 0
        p.x = -9999
        p.y = -9999
      }
    }
    return
  }

  const t = nowMs * 0.001
  // The whirl spins up as the transformation completes: wider and lazy at the touch,
  // tight and frantic at the crowning.
  const spin = 2.2 + progress * 3.4
  const radius = 52 - 26 * progress
  for (let i = 0; i < WREATH_COUNT; i++) {
    const p = layer.wreath[i]!
    const a = t * (spin + (i % 3) * 0.4) + (i * Math.PI * 2) / WREATH_COUNT
    const r = radius + Math.sin(t * 3.1 + i * 2.3) * 7
    p.x = wx + Math.cos(a) * r
    p.y = wy + Math.sin(a) * r * 0.72 - 8 + Math.sin(t * 5 + i) * 4 // elliptical orbit, hovering
    p.scaleY = ((WREATH_SIZE / 8) * (0.45 + Math.abs(Math.sin(t * 13 + i * 1.7)))) / 1.2 // wingbeat
    p.alpha = 0.7 + 0.25 * Math.sin(t * 7 + i)
  }
}
