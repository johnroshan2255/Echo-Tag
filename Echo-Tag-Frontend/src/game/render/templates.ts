/**
 * The humanoid blueprint.
 *
 * A player's avatar is a cluster of small squares, generated once from a grid template and
 * thereafter only *transformed* — never regenerated. This file owns the template; nothing
 * here runs per frame.
 *
 * The silhouette is rasterised from shape predicates rather than hand-drawn as an ASCII
 * mask. Two reasons: the cell count has to land inside the 150–250 band the tech doc
 * specifies (a hand-drawn mask makes that a counting exercise every time the pose changes),
 * and tagging each cell with the body part it belongs to falls out of the geometry for free.
 * Part tags are what let the animator move legs without knowing which cells are legs.
 *
 * Cells are emitted in a stable order, so a player's particle slice can be indexed by cell
 * index for the whole round.
 */

export const Part = {
  Head: 0,
  Eye: 1,
  Torso: 2,
  ArmL: 3,
  ArmR: 4,
  LegL: 5,
  LegR: 6,
} as const
export type Part = (typeof Part)[keyof typeof Part]

/** Grid resolution. Tuned so the filled-cell count lands mid-band; see templates.test.ts. */
export const GRID_W = 15
export const GRID_H = 21

/** Where the feet sit, in grid rows — the avatar is anchored at the ground, not its centre. */
export const GRID_GROUND = GRID_H

export interface Template {
  /** Filled cell count. Equals the particle slice size. */
  readonly count: number
  /** Grid column per cell. */
  readonly gx: Int8Array
  /** Grid row per cell. */
  readonly gy: Int8Array
  /** Body part per cell, for the animator. */
  readonly part: Uint8Array
  /** 1 when the cell has an empty neighbour — drawn a shade darker for definition. */
  readonly edge: Uint8Array
}

const HEAD_CX = (GRID_W - 1) / 2
const HEAD_CY = 3.2
const HEAD_RX = 3.6
const HEAD_RY = 3.4

const TORSO_X0 = 3
const TORSO_X1 = GRID_W - 4
const TORSO_Y0 = 7
const TORSO_Y1 = 13

const ARM_Y0 = 8
const ARM_Y1 = 13

const LEG_Y0 = 14
const LEG_Y1 = GRID_H - 1
const LEG_INNER = 1 // gap in columns between the two legs

const partAt = (x: number, y: number): Part | -1 => {
  // Head: an ellipse, with two cells knocked out as eyes.
  const hx = (x - HEAD_CX) / HEAD_RX
  const hy = (y - HEAD_CY) / HEAD_RY
  if (hx * hx + hy * hy <= 1) {
    const eyeRow = Math.round(HEAD_CY)
    if (y === eyeRow && (x === Math.round(HEAD_CX) - 2 || x === Math.round(HEAD_CX) + 2)) {
      return Part.Eye
    }
    return Part.Head
  }

  // Torso: a rectangle with the bottom corners shaved, so it reads as hips not a box.
  if (x >= TORSO_X0 && x <= TORSO_X1 && y >= TORSO_Y0 && y <= TORSO_Y1) {
    const fromBottom = TORSO_Y1 - y
    const inset = fromBottom === 0 ? 1 : 0
    if (x >= TORSO_X0 + inset && x <= TORSO_X1 - inset) return Part.Torso
  }

  // Arms: two columns either side of the torso.
  if (y >= ARM_Y0 && y <= ARM_Y1) {
    if (x >= TORSO_X0 - 2 && x <= TORSO_X0 - 1) return Part.ArmL
    if (x >= TORSO_X1 + 1 && x <= TORSO_X1 + 2) return Part.ArmR
  }

  // Legs: two blocks under the torso with a gap between them.
  if (y >= LEG_Y0 && y <= LEG_Y1) {
    const mid = HEAD_CX
    const legW = 3
    const lx1 = Math.floor(mid - LEG_INNER / 2)
    const lx0 = lx1 - legW + 1
    const rx0 = Math.ceil(mid + LEG_INNER / 2)
    const rx1 = rx0 + legW - 1
    if (x >= lx0 && x <= lx1) return Part.LegL
    if (x >= rx0 && x <= rx1) return Part.LegR
  }

  return -1
}

const build = (): Template => {
  const filled: Int8Array = new Int8Array(GRID_W * GRID_H).fill(-1)
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      filled[y * GRID_W + x] = partAt(x, y)
    }
  }

  const gx: number[] = []
  const gy: number[] = []
  const part: number[] = []
  const edge: number[] = []

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= GRID_W || y >= GRID_H ? -1 : filled[y * GRID_W + x]!

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const p = at(x, y)
      if (p < 0) continue
      gx.push(x)
      gy.push(y)
      part.push(p)
      const open =
        at(x - 1, y) < 0 || at(x + 1, y) < 0 || at(x, y - 1) < 0 || at(x, y + 1) < 0
      edge.push(open ? 1 : 0)
    }
  }

  return {
    count: gx.length,
    gx: new Int8Array(gx),
    gy: new Int8Array(gy),
    part: new Uint8Array(part),
    edge: new Uint8Array(edge),
  }
}

/** The one body template. Built at module load; there is exactly one. */
export const BODY: Template = build()

/**
 * The echo silhouette — a much coarser figure.
 *
 * Echoes are obstacles, not characters. Rendering them at body detail is both a performance
 * loss (15 echoes per player x 12 players) and, more importantly, a *readability* loss: the
 * single consistent lesson from every past-self game is that ghosts must be quieter than the
 * live actor or the screen becomes unparseable. So: a blocky torso-and-head suggestion, no
 * limbs, no eyes.
 */
export const ECHO_GRID_W = 4
export const ECHO_GRID_H = 5

export const ECHO: Template = (() => {
  const gx: number[] = []
  const gy: number[] = []
  for (let y = 0; y < ECHO_GRID_H; y++) {
    for (let x = 0; x < ECHO_GRID_W; x++) {
      // Shave the four corners so it reads as a figure rather than a brick, but keep it
      // otherwise solid. An earlier version used a 5x7 grid with a notched neck; at the size
      // an echo occupies on screen the extra detail did not read as a silhouette, it read as
      // dithering — which is worse than a plain block, because a wall has to look like a wall.
      const corner = (x === 0 || x === ECHO_GRID_W - 1) && (y === 0 || y === ECHO_GRID_H - 1)
      if (corner) continue
      gx.push(x)
      gy.push(y)
    }
  }
  return {
    count: gx.length,
    gx: new Int8Array(gx),
    gy: new Int8Array(gy),
    part: new Uint8Array(gx.length).fill(Part.Torso),
    edge: new Uint8Array(gx.length),
  }
})()
