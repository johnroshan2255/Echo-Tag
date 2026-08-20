/**
 * World-to-screen mapping.
 *
 * The arena is a fixed 16:9 rectangle in world units, identical for every player in a room —
 * it has to be, because it is server-authoritative state and two clients on different
 * screens must agree about where the walls are. So the camera never crops: it scales the
 * whole arena to fit and letterboxes the remainder.
 *
 * That is the honest consequence of a landscape arena on a portrait phone: a 1600x900 arena
 * in a 390x844 viewport becomes a 390x220 band. Everyone still sees the entire arena, which
 * is what fairness requires, but portrait is visibly the lesser view — hence the rotate hint
 * below. Poki requires portrait to *work* (it unlocks the mobile banner slot), not to be the
 * primary experience.
 */

export interface Camera {
  /** Screen pixels per world unit. */
  scale: number
  /** Screen offset of world origin, in device pixels. */
  ox: number
  oy: number
  /** Arena extent in device pixels. */
  w: number
  h: number
}

export const createCamera = (): Camera => ({ scale: 1, ox: 0, oy: 0, w: 0, h: 0 })

export const fitCamera = (
  cam: Camera,
  arenaW: number,
  arenaH: number,
  viewW: number,
  viewH: number,
): void => {
  const scale = Math.min(viewW / arenaW, viewH / arenaH)
  cam.scale = scale
  cam.w = arenaW * scale
  cam.h = arenaH * scale
  cam.ox = Math.round((viewW - cam.w) / 2)
  cam.oy = Math.round((viewH - cam.h) / 2)
}

export const toScreenX = (cam: Camera, wx: number): number => cam.ox + wx * cam.scale
export const toScreenY = (cam: Camera, wy: number): number => cam.oy + wy * cam.scale

/**
 * True when the arena has been squeezed so far that the player should be nudged to rotate.
 * Threshold is the fraction of the viewport's shorter axis the arena ends up occupying.
 */
export const wantsRotate = (cam: Camera, viewW: number, viewH: number): boolean =>
  viewH > viewW && cam.h / viewH < 0.45
