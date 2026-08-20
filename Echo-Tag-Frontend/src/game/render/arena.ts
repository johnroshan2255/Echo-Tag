import { Container, Graphics } from 'pixi.js'
import type { Camera } from '../engine/camera.ts'

/**
 * The arena floor and boundary.
 *
 * Drawn once into a single `Graphics` and only rebuilt on resize — one draw call for the
 * entire playfield. It is deliberately understated: the arena's job is to be a legible
 * *floor* that makes the neon avatars and echoes pop, and to make the boundary unmistakable
 * so a player never wonders whether they can keep running.
 */

export interface ArenaLayer {
  container: Container
  graphics: Graphics
}

export const createArenaLayer = (): ArenaLayer => {
  const graphics = new Graphics()
  const container = new Container()
  container.addChild(graphics)
  return { container, graphics }
}

/** Rebuilds the floor for the current camera. Call on resize, not per frame. */
export const layoutArena = (layer: ArenaLayer, cam: Camera): void => {
  const g = layer.graphics
  g.clear()

  // Floor, a touch lighter than the page background so the boundary reads without a border
  // heavy enough to compete with the players.
  g.rect(cam.ox, cam.oy, cam.w, cam.h).fill({ color: 0x171a25 })

  // Grid, for a sense of speed and scale. Spacing is in screen pixels so it stays readable
  // at every zoom rather than becoming moiré on a phone.
  const step = Math.max(28, Math.round(Math.min(cam.w, cam.h) / 14))
  for (let x = cam.ox + step; x < cam.ox + cam.w; x += step) {
    g.moveTo(Math.round(x), cam.oy).lineTo(Math.round(x), cam.oy + cam.h)
  }
  for (let y = cam.oy + step; y < cam.oy + cam.h; y += step) {
    g.moveTo(cam.ox, Math.round(y)).lineTo(cam.ox + cam.w, Math.round(y))
  }
  g.stroke({ color: 0xffffff, alpha: 0.045, width: 1 })

  // Boundary.
  g.rect(cam.ox, cam.oy, cam.w, cam.h).stroke({ color: 0x3a4260, alpha: 0.9, width: 2 })
}
