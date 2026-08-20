import { Container, type Texture } from 'pixi.js'
import { createArenaLayer, layoutArena, type ArenaLayer } from '../render/arena.ts'
import { createBodyLayer, type BodyLayer } from '../render/squareBody.ts'
import { createEchoLayer, type EchoLayer } from '../render/echoRenderer.ts'
import { createFxLayer, type FxLayer } from '../render/fx.ts'
import { createIndicatorLayer, type IndicatorLayer } from '../render/indicator.ts'
import type { GameMap } from '@echo-tag/shared'

/**
 * The scene graph.
 *
 * Two roots with different coordinate systems:
 *
 *   worldRoot — everything that exists *in the world*, in world units. The follow camera
 *   transforms this one container per frame; nothing inside it knows the camera exists.
 *   Z-order inside is a gameplay-clarity ruling: floor, then echoes (an obstacle must never
 *   hide a live player), then the It halo (under bodies so it haloes rather than washes),
 *   then players on top — the live actors are what a player is tracking.
 *
 *   overlay — screen-space UI drawn by the engine (the off-screen threat arrow). Fixed to
 *   the viewport, untouched by the camera.
 *
 * Six children total; the two particle containers each batch to one draw call.
 */

export interface Layers {
  stage: Container
  worldRoot: Container
  overlay: Container
  arena: ArenaLayer
  echoes: EchoLayer
  fx: FxLayer
  bodies: BodyLayer
  indicator: IndicatorLayer
}

export const createLayers = (square: Texture, glow: Texture): Layers => {
  const stage = new Container()
  const worldRoot = new Container()
  const overlay = new Container()

  const arena = createArenaLayer()
  const echoes = createEchoLayer(square)
  const fx = createFxLayer(glow)
  const bodies = createBodyLayer(square)
  const indicator = createIndicatorLayer()

  worldRoot.addChild(arena.container)
  worldRoot.addChild(echoes.container)
  worldRoot.addChild(fx.container)
  worldRoot.addChild(bodies.container)
  overlay.addChild(indicator.container)

  stage.addChild(worldRoot)
  stage.addChild(overlay)

  return { stage, worldRoot, overlay, arena, echoes, fx, bodies, indicator }
}

/** Rebuilds the map drawing. Call on map change. */
export const setLayersMap = (layers: Layers, map: GameMap): void => {
  layoutArena(layers.arena, map)
}
