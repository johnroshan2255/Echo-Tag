import { Container, Sprite, type Texture } from 'pixi.js'
import type { Camera } from '../engine/camera.ts'
import { FOG_FULL_STOP, FOG_TEX_SIZE } from '../engine/textures.ts'
import { VISION_MAX } from '../theme.ts'

/**
 * Fog of war (ADR 0006).
 *
 * You see the room you are in; the rest of the maze is dusk. This is the single biggest
 * feel change of the cozy pivot and it is also a *rules* change in practice: threats now
 * enter from fog, echoes are discovered rather than surveyed, and knowing a map becomes a
 * skill. The edge arrow (indicator.ts) is what keeps that fair — danger is always pointed
 * at, just not shown.
 *
 * Implementation: ONE screen-space sprite of a radial-gradient texture, centred each frame
 * on the local player's screen position. The texture's geometry contract (clear core to
 * FOG_CLEAR_STOP, feather to FOG_FULL_STOP, solid beyond) lets us convert VISION_MAX from
 * world units into a sprite scale; the solid region then just has to reach past the screen
 * corners, which `minCover` guarantees. One quad, one draw call, no shaders, no per-pixel
 * work — mobile-safe by construction.
 *
 * The fog sits in the overlay ABOVE the world but BELOW the threat arrow: the arrow must
 * never be fogged.
 */

export interface FogLayer {
  container: Container
  sprite: Sprite
}

export const createFogLayer = (texture: Texture): FogLayer => {
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  const container = new Container()
  container.addChild(sprite)
  return { container, sprite }
}

export const renderFog = (
  layer: FogLayer,
  cam: Camera,
  playerWorldX: number,
  playerWorldY: number,
  viewW: number,
  viewH: number,
  /** 1 in the open; ~0.22 inside a wardrobe — you see the door, no more. */
  visionScale = 1,
): void => {
  const s = layer.sprite

  // The player's position on screen (the camera leads with velocity, so this is not
  // simply the screen centre).
  const sx = viewW / 2 + (playerWorldX - cam.cx) * cam.scale
  const sy = viewH / 2 + (playerWorldY - cam.cy) * cam.scale

  // Scale so the texture's full-fog ring lands exactly VISION_MAX world units out…
  const visionPx = VISION_MAX * visionScale * cam.scale
  const wanted = visionPx / (FOG_FULL_STOP * (FOG_TEX_SIZE / 2))
  // …but never so small that a screen corner escapes the solid region.
  const cornerX = Math.max(sx, viewW - sx)
  const cornerY = Math.max(sy, viewH - sy)
  const minCover = (2 * Math.sqrt(cornerX * cornerX + cornerY * cornerY)) / FOG_TEX_SIZE

  s.scale.set(Math.max(wanted, minCover))
  s.x = sx
  s.y = sy
}
