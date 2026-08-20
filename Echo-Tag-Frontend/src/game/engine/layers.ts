import { Container, type Texture } from 'pixi.js'
import { createArenaLayer, layoutArena, type ArenaLayer } from '../render/arena.ts'
import { createBodyLayer, type BodyLayer } from '../render/squareBody.ts'
import { createEchoLayer, type EchoLayer } from '../render/echoRenderer.ts'
import { createFxLayer, type FxLayer } from '../render/fx.ts'
import type { Camera } from './camera.ts'

/**
 * The scene graph, and the z-order that makes the arena readable.
 *
 * Order matters for gameplay clarity, not just aesthetics:
 *   arena   — the floor, so everything else has something to sit on
 *   echoes  — *under* live players, because a player must never be hidden by an obstacle
 *   ring    — the It halo, under the bodies so it haloes rather than washes them out
 *   players — always on top; the live actors are what a player is tracking
 *
 * Five children, and the two particle containers each batch to a single draw call, so the
 * whole arena costs roughly five draws regardless of how dense it gets.
 */

export interface Layers {
  stage: Container
  arena: ArenaLayer
  echoes: EchoLayer
  fx: FxLayer
  bodies: BodyLayer
}

export const createLayers = (square: Texture, glow: Texture): Layers => {
  const stage = new Container()
  const arena = createArenaLayer()
  const echoes = createEchoLayer(square)
  const fx = createFxLayer(glow)
  const bodies = createBodyLayer(square)

  stage.addChild(arena.container)
  stage.addChild(echoes.container)
  stage.addChild(fx.container)
  stage.addChild(bodies.container)

  return { stage, arena, echoes, fx, bodies }
}

export const layoutLayers = (layers: Layers, cam: Camera): void => {
  layoutArena(layers.arena, cam)
}
