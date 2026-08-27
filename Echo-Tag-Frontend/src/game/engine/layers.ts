import { Container, type Texture } from 'pixi.js'
import { createArenaLayer, layoutArena, type ArenaLayer } from '../render/arena.ts'
import { createBodyLayer, type BodyLayer } from '../render/squareBody.ts'
import { createEchoLayer, type EchoLayer } from '../render/echoRenderer.ts'
import { createDoorLayer, type DoorLayer } from '../render/doors.ts'
import { createFxLayer, setLampsFromMap, type FxLayer } from '../render/fx.ts'
import { createIndicatorLayer, type IndicatorLayer } from '../render/indicator.ts'
import { createMarkerLayer, type MarkerLayer } from '../render/wardrobeMarkers.ts'
import { createAmbienceLayer, seedAmbience, type AmbienceLayer } from '../render/ambience.ts'
import { createFogLayer, type FogLayer } from '../render/fog.ts'
import { createTerrorLayer, type TerrorLayer } from '../render/terror.ts'
import { createInteriorLayer, type InteriorLayer } from '../render/interior.ts'
import { createToolsLayer, type ToolsLayer } from '../render/toolsRenderer.ts'
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
  ambience: AmbienceLayer
  tools: ToolsLayer
  doors: DoorLayer
  echoes: EchoLayer
  fx: FxLayer
  bodies: BodyLayer
  markers: MarkerLayer
  fog: FogLayer
  interior: InteriorLayer
  terror: TerrorLayer
  indicator: IndicatorLayer
}

export const createLayers = (square: Texture, glow: Texture, fogTex: Texture): Layers => {
  const stage = new Container()
  const worldRoot = new Container()
  const overlay = new Container()

  const arena = createArenaLayer()
  const ambience = createAmbienceLayer(square)
  const tools = createToolsLayer()
  const doors = createDoorLayer(square)
  const echoes = createEchoLayer(square)
  const fx = createFxLayer(glow)
  const bodies = createBodyLayer(square)
  const markers = createMarkerLayer()
  const fog = createFogLayer(fogTex)
  const interior = createInteriorLayer(square)
  const terror = createTerrorLayer(square)
  const indicator = createIndicatorLayer()

  worldRoot.addChild(arena.container)
  worldRoot.addChild(tools.container) // puddles, traps and pickups sit ON the floor
  worldRoot.addChild(doors.container) // doors are architecture: above floor, below actors
  worldRoot.addChild(ambience.container) // fireflies drift under everything that matters
  worldRoot.addChild(echoes.container)
  worldRoot.addChild(fx.container)
  worldRoot.addChild(bodies.container)
  worldRoot.addChild(markers.container) // your keyholes float above everything in-world
  // Fog is screen-space, above the whole world — the arrow alone pierces it.
  overlay.addChild(fog.container)
  overlay.addChild(interior.container) // hiding blinds you: wardrobe darkness over everything
  overlay.addChild(terror.container) // the victim's glitch bars tear over everything but the arrow
  overlay.addChild(indicator.container)

  stage.addChild(worldRoot)
  stage.addChild(overlay)

  return { stage, worldRoot, overlay, arena, ambience, tools, doors, echoes, fx, bodies, markers, fog, interior, terror, indicator }
}

/** Rebuilds the map drawing and re-seeds the set dressing. Call on map change. */
export const setLayersMap = (layers: Layers, map: GameMap): void => {
  layoutArena(layers.arena, map)
  seedAmbience(layers.ambience, map)
  setLampsFromMap(layers.fx, map)
}
