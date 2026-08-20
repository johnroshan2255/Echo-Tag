import { MAX_PLAYERS, ECHO_BODIES_PER_PLAYER, PLAYER_RADIUS, ECHO_RADIUS } from '../constants.ts'

/**
 * Uniform-grid broadphase for echo bodies, built with a counting sort.
 *
 * Rebuilt from scratch every tick — which sounds wasteful but is the cheapest option
 * here: every echo body moves every tick (the ring buffer rolls), so incremental
 * updates would touch every cell anyway. Two Int32Array passes over ~180 bodies is
 * well under 20µs and allocates nothing.
 *
 * Layout: `cellStart[c]` .. `cellStart[c+1]` indexes into `items`, which holds echo
 * body ids. A body id encodes its owner and its ring offset: `slot * bodies + k`.
 */

/** Query radius: the largest distance at which a player can touch an echo. */
export const CONTACT_RADIUS = PLAYER_RADIUS + ECHO_RADIUS

/** One cell comfortably covers a contact query, so a 3x3 neighbourhood always suffices. */
export const CELL_SIZE = Math.ceil(CONTACT_RADIUS * 2)

export const MAX_BODIES = MAX_PLAYERS * ECHO_BODIES_PER_PLAYER

export interface SpatialHash {
  cols: number
  rows: number
  cellCount: number
  /** Prefix-summed cell offsets, length cellCount + 1. */
  cellStart: Int32Array
  /** Scratch counter reused each rebuild, length cellCount + 1. */
  counts: Int32Array
  /** Body ids sorted by cell, length MAX_BODIES. */
  items: Int32Array
  /** How many entries of `items` are live this tick. */
  itemCount: number
}

export const createSpatialHash = (arenaW: number, arenaH: number): SpatialHash => {
  const cols = Math.ceil(arenaW / CELL_SIZE) + 1
  const rows = Math.ceil(arenaH / CELL_SIZE) + 1
  const cellCount = cols * rows
  return {
    cols,
    rows,
    cellCount,
    cellStart: new Int32Array(cellCount + 1),
    counts: new Int32Array(cellCount + 1),
    items: new Int32Array(MAX_BODIES),
    itemCount: 0,
  }
}

const cellOf = (h: SpatialHash, x: number, y: number): number => {
  let cx = (x / CELL_SIZE) | 0
  let cy = (y / CELL_SIZE) | 0
  if (cx < 0) cx = 0
  else if (cx >= h.cols) cx = h.cols - 1
  if (cy < 0) cy = 0
  else if (cy >= h.rows) cy = h.rows - 1
  return cy * h.cols + cx
}

/**
 * Rebuilds the grid from `bodyX`/`bodyY`, considering only ids where `bodyLive[id]` is 1.
 * Counting sort: count per cell, prefix sum, then scatter.
 */
export const rebuild = (
  h: SpatialHash,
  bodyX: Float32Array,
  bodyY: Float32Array,
  bodyLive: Uint8Array,
  bodyCount: number,
): void => {
  const { counts, cellStart, items, cellCount } = h
  counts.fill(0, 0, cellCount + 1)

  for (let id = 0; id < bodyCount; id++) {
    if (bodyLive[id] === 0) continue
    counts[cellOf(h, bodyX[id]!, bodyY[id]!)]!++
  }

  let running = 0
  for (let c = 0; c <= cellCount; c++) {
    cellStart[c] = running
    running += counts[c]!
    counts[c] = cellStart[c]! // reuse `counts` as the per-cell write cursor
  }
  h.itemCount = running

  for (let id = 0; id < bodyCount; id++) {
    if (bodyLive[id] === 0) continue
    const c = cellOf(h, bodyX[id]!, bodyY[id]!)
    items[counts[c]!++] = id
  }
}

/**
 * Calls `visit` once per body id in the 3x3 cell neighbourhood around (x, y).
 * The callback is a plain function reference held by the caller — do not pass a
 * closure created inside the tick, or this stops being allocation-free.
 */
export const forEachNear = (
  h: SpatialHash,
  x: number,
  y: number,
  visit: (id: number) => void,
): void => {
  const cx = (x / CELL_SIZE) | 0
  const cy = (y / CELL_SIZE) | 0
  const x0 = cx > 0 ? cx - 1 : 0
  const y0 = cy > 0 ? cy - 1 : 0
  const x1 = cx < h.cols - 1 ? cx + 1 : h.cols - 1
  const y1 = cy < h.rows - 1 ? cy + 1 : h.rows - 1

  for (let gy = y0; gy <= y1; gy++) {
    const rowBase = gy * h.cols
    for (let gx = x0; gx <= x1; gx++) {
      const c = rowBase + gx
      const end = h.cellStart[c + 1]!
      for (let i = h.cellStart[c]!; i < end; i++) visit(h.items[i]!)
    }
  }
}
