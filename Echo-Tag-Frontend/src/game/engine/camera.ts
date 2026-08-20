import { MAP_H, MAP_W, VIEW_MAX_W, VIEW_MAX_H } from '@echo-tag/shared/constants'
import type { Container } from 'pixi.js'

/**
 * The follow camera.
 *
 * This is the heart of the walk-through-a-world pivot (docs/adr/0005): the map is larger
 * than the screen, the camera tracks *your* avatar, and you learn where the others are by
 * hunting for them — not by reading a diagram. Mechanically it is three rules:
 *
 *   1. **Zoom**: `scale = max(viewW / VIEW_MAX_W, viewH / VIEW_MAX_H)` — the view never
 *      shows more than VIEW_MAX world units on either axis. `max` rather than `min` is the
 *      fairness bound: a huge monitor gets bigger pixels, not more maze. Portrait phones
 *      get a tall, narrow window — a real view, not a letterboxed postage stamp, which is
 *      what fixes the portrait problem Phase 2 carried as an open question.
 *   2. **Follow**: exponential approach toward the player plus a small velocity lookahead,
 *      so the camera leads into the direction of travel instead of dragging behind it.
 *   3. **Clamp**: the view never leaves the map, so map edges read as places, and the
 *      camera goes still as you corner — a classic cue that you are *in* a corner.
 *
 * The camera does not transform points: it transforms the ONE world-root container, once
 * per frame. Renderers write world coordinates and never know the camera exists.
 */

export interface Camera {
  /** World-space centre of the view. */
  cx: number
  cy: number
  /** Device pixels per world unit. */
  scale: number
  /** Half the view extent, in world units. Cached by resize(). */
  halfW: number
  halfH: number
}

export const createCamera = (): Camera => ({ cx: MAP_W / 2, cy: MAP_H / 2, scale: 1, halfW: 0, halfH: 0 })

/** Recomputes zoom for a new viewport. Call on resize, not per frame. */
export const resizeCamera = (cam: Camera, viewW: number, viewH: number): void => {
  cam.scale = Math.max(viewW / VIEW_MAX_W, viewH / VIEW_MAX_H)
  cam.halfW = viewW / (2 * cam.scale)
  cam.halfH = viewH / (2 * cam.scale)
}

const LOOKAHEAD_S = 0.28 // seconds of velocity the camera leads by
const FOLLOW_RATE = 4.5 // per second; higher = stiffer follow

export const followCamera = (
  cam: Camera,
  targetX: number,
  targetY: number,
  vx: number,
  vy: number,
  dtMs: number,
): void => {
  const wantX = targetX + vx * LOOKAHEAD_S
  const wantY = targetY + vy * LOOKAHEAD_S
  const k = 1 - Math.exp(-FOLLOW_RATE * (dtMs / 1000))
  cam.cx += (wantX - cam.cx) * k
  cam.cy += (wantY - cam.cy) * k

  // Clamp the view inside the map. If a view axis exceeds the map (tiny map, huge zoom-out
  // — cannot happen with current constants, but cheap to be correct about), centre it.
  cam.cx = cam.halfW * 2 >= MAP_W ? MAP_W / 2 : cam.cx < cam.halfW ? cam.halfW : cam.cx > MAP_W - cam.halfW ? MAP_W - cam.halfW : cam.cx
  cam.cy = cam.halfH * 2 >= MAP_H ? MAP_H / 2 : cam.cy < cam.halfH ? cam.halfH : cam.cy > MAP_H - cam.halfH ? MAP_H - cam.halfH : cam.cy
}

/** Snaps the camera onto a point with no easing — round start, respawn, map change. */
export const snapCamera = (cam: Camera, x: number, y: number): void => {
  cam.cx = x
  cam.cy = y
  followCamera(cam, x, y, 0, 0, 0) // reuse the clamp
}

/** Applies the camera to the world-root container. The only world→screen transform. */
export const applyCamera = (cam: Camera, worldRoot: Container, viewW: number, viewH: number): void => {
  worldRoot.scale.set(cam.scale)
  worldRoot.position.set(viewW / 2 - cam.cx * cam.scale, viewH / 2 - cam.cy * cam.scale)
}

/** True when a world point is inside the view, with `margin` world units of slack. */
export const inView = (cam: Camera, wx: number, wy: number, margin = 0): boolean =>
  Math.abs(wx - cam.cx) < cam.halfW + margin && Math.abs(wy - cam.cy) < cam.halfH + margin
