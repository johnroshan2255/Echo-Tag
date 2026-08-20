import {
  COLLISION_PASSES,
  DOOR_SOLID_BELOW,
  ECHO_BODIES_PER_PLAYER,
  ECHO_GRACE_SAMPLES,
  MAP_TILE,
  MAP_TILES_X,
  MAP_TILES_Y,
  MAX_PLAYERS,
  PLAYER_RADIUS,
  SLIDE_FRICTION,
} from '../constants.ts'
import { CELL_SIZE, CONTACT_RADIUS } from './spatial-hash.ts'
import type { World } from '../sim/world.ts'

/**
 * Player-vs-echo resolution — RETIRED from the tick by ADR 0012.
 *
 * The owner's final ruling: ghost trails are visual only — breadcrumbs the hunter reads,
 * never geometry. This resolver is deliberately kept, tested-adjacent and one call-site
 * away (sim/player.ts), because the design explored three variants (solid to all, solid
 * to none, solid only to the ghost) and may yet revisit; deleting it would turn a design
 * toggle back into an engineering task.
 *
 * Live players do not collide with each other either. Bodies would let a player wall off
 * a corridor by standing in it, and would make tag contact ambiguous — the design wants
 * tags decided by overlap, not by physics.
 *
 * PERFORMANCE, and the reason this function is one long inlined loop instead of a tidy
 * visitor callback:
 *
 *   The obvious implementation is `forEachNear(hash, x, y, visit)` with the working
 *   position/velocity held in module-scope `let`s so the callback can reach them. That
 *   version measured ~175 bytes of garbage per tick. Module-scope `let`s live in the
 *   module context rather than in registers, so every write of a *double* to one boxes a
 *   fresh V8 HeapNumber — and this path writes four of them several times per contact.
 *   Keeping px/py/vx/vy as true function locals lets V8 hold them in registers and the
 *   allocation disappears entirely. `tools/bench/sim-bench.ts` guards the regression.
 */

const CONTACT_SQ = CONTACT_RADIUS * CONTACT_RADIUS

/**
 * Resolves `slot` against every nearby echo body, writing the corrected position and
 * velocity back into the world. Returns the contact count (the renderer uses it for a
 * scrape effect, and it is a useful density metric in the benchmark).
 */
export const resolveEchoCollisions = (w: World, slot: number): number => {
  // Hoisted to locals so the inner loop indexes registers, not property lookups.
  // Note: NOT destructured from an object literal — that would allocate one per call.
  const hash = w.hash
  const cols = hash.cols
  const rows = hash.rows
  const cellStart = hash.cellStart
  const items = hash.items
  const bodyX = w.bodyX
  const bodyY = w.bodyY
  const bodyLive = w.bodyLive
  const bodyOwner = w.bodyOwner
  const bodyAge = w.bodyAge

  let px = w.x[slot]!
  let py = w.y[slot]!
  let pvx = w.vx[slot]!
  let pvy = w.vy[slot]!
  let contacts = 0

  // A couple of passes settles a corner (two bodies pushing at once) without the jitter
  // a single pass produces. More than two is wasted work.
  for (let pass = 0; pass < COLLISION_PASSES; pass++) {
    const before = contacts

    const cx = (px / CELL_SIZE) | 0
    const cy = (py / CELL_SIZE) | 0
    const gx0 = cx > 0 ? cx - 1 : 0
    const gy0 = cy > 0 ? cy - 1 : 0
    const gx1 = cx < cols - 1 ? cx + 1 : cols - 1
    const gy1 = cy < rows - 1 ? cy + 1 : rows - 1

    for (let gy = gy0; gy <= gy1; gy++) {
      const rowBase = gy * cols
      for (let gx = gx0; gx <= gx1; gx++) {
        const cell = rowBase + gx
        const end = cellStart[cell + 1]!

        for (let i = cellStart[cell]!; i < end; i++) {
          const id = items[i]!
          if (bodyLive[id] === 0) continue

          // Your own freshest echoes don't collide with you: at 240 units/sec the newest
          // samples are still inside your own body, so without this you would be
          // permanently welded to your own tail. Older self-echoes are fully solid —
          // that part is the game.
          if (bodyOwner[id] === slot && bodyAge[id]! <= ECHO_GRACE_SAMPLES) continue

          const dx = px - bodyX[id]!
          const dy = py - bodyY[id]!
          const dSq = dx * dx + dy * dy
          if (dSq >= CONTACT_SQ || dSq === 0) continue

          const d = Math.sqrt(dSq)
          const nx = dx / d
          const ny = dy / d

          // Push out to exactly touching.
          const push = CONTACT_RADIUS - d
          px += nx * push
          py += ny * push

          // Remove the velocity component heading into the obstacle, damp the rest.
          const into = pvx * nx + pvy * ny
          if (into < 0) {
            pvx = (pvx - nx * into) * SLIDE_FRICTION
            pvy = (pvy - ny * into) * SLIDE_FRICTION
          }
          contacts++
        }
      }
    }

    if (contacts === before) break
  }

  w.x[slot] = px
  w.y[slot] = py
  w.vx[slot] = pvx
  w.vy[slot] = pvy
  return contacts
}

/**
 * Circle-vs-tile-grid wall resolution.
 *
 * Walks the 3x3 tiles around the player; for each wall tile, finds the closest point on the
 * tile's AABB to the player's centre and pushes the player out along that axis. Because the
 * push is axis-aligned per contact, sliding along a wall falls out for free — the component
 * of motion parallel to the wall is untouched, which is the same "walls redirect, never
 * stop" feel rule the echo collision follows.
 *
 * Runs after echo resolution, and wins: an echo may not shove a player inside a wall. All
 * state stays in function locals and typed-array writes for the same allocation reasons
 * documented above.
 */
export const resolveWallCollisions = (w: World, slot: number): number => {
  const walls = w.map.walls
  const r = PLAYER_RADIUS
  let px = w.x[slot]!
  let py = w.y[slot]!
  let contacts = 0

  const doors = w.map.doors
  const doorCount = doors.length / 3

  // Two passes settle a corner (two tiles pushing at once) without jitter.
  for (let pass = 0; pass < 2; pass++) {
    const before = contacts
    const tx0 = ((px - r) / MAP_TILE) | 0
    const ty0 = ((py - r) / MAP_TILE) | 0
    const tx1 = ((px + r) / MAP_TILE) | 0
    const ty1 = ((py + r) / MAP_TILE) | 0

    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= MAP_TILES_Y) continue
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || tx >= MAP_TILES_X) continue
        if (walls[ty * MAP_TILES_X + tx] === 0) continue

        const x0 = tx * MAP_TILE
        const y0 = ty * MAP_TILE
        // Closest point on the tile AABB to the player's centre.
        const cx = px < x0 ? x0 : px > x0 + MAP_TILE ? x0 + MAP_TILE : px
        const cy = py < y0 ? y0 : py > y0 + MAP_TILE ? y0 + MAP_TILE : py
        const dx = px - cx
        const dy = py - cy
        const dSq = dx * dx + dy * dy
        if (dSq >= r * r) continue
        contacts++

        if (dSq > 0.0001) {
          // Push out along the contact normal.
          const d = Math.sqrt(dSq)
          const push = r - d
          px += (dx / d) * push
          py += (dy / d) * push
          // Kill only the into-wall velocity component.
          const nx = dx / d
          const ny = dy / d
          const into = w.vx[slot]! * nx + w.vy[slot]! * ny
          if (into < 0) {
            w.vx[slot] = w.vx[slot]! - nx * into
            w.vy[slot] = w.vy[slot]! - ny * into
          }
        } else {
          // Centre is inside the tile (teleport/reconcile edge case): eject along the
          // shallowest axis rather than guessing a normal.
          const midX = x0 + MAP_TILE / 2
          const midY = y0 + MAP_TILE / 2
          if (Math.abs(px - midX) > Math.abs(py - midY)) {
            px = px > midX ? x0 + MAP_TILE + r : x0 - r
            w.vx[slot] = 0
          } else {
            py = py > midY ? y0 + MAP_TILE + r : y0 - r
            w.vy[slot] = 0
          }
        }
      }
    }
    // Closed doors block exactly like their two wall tiles would. Openness comes from the
    // deterministic door update, so prediction and authority always agree about whether a
    // doorway was passable on a given tick.
    for (let d = 0; d < doorCount; d++) {
      if (w.doorOpen[d]! >= DOOR_SOLID_BELOW) continue
      const base = d * 3
      const axis = doors[base + 2]!
      for (let leaf = 0; leaf < 2; leaf++) {
        const tx = doors[base]! + (axis === 0 ? leaf : 0)
        const ty = doors[base + 1]! + (axis === 1 ? leaf : 0)
        const x0 = tx * MAP_TILE
        const y0 = ty * MAP_TILE
        const cx = px < x0 ? x0 : px > x0 + MAP_TILE ? x0 + MAP_TILE : px
        const cy = py < y0 ? y0 : py > y0 + MAP_TILE ? y0 + MAP_TILE : py
        const dx = px - cx
        const dy = py - cy
        const dSq = dx * dx + dy * dy
        if (dSq >= r * r || dSq < 0.0001) continue
        contacts++
        const dd = Math.sqrt(dSq)
        px += (dx / dd) * (r - dd)
        py += (dy / dd) * (r - dd)
        const nx = dx / dd
        const ny = dy / dd
        const into = w.vx[slot]! * nx + w.vy[slot]! * ny
        if (into < 0) {
          w.vx[slot] = w.vx[slot]! - nx * into
          w.vy[slot] = w.vy[slot]! - ny * into
        }
      }
    }

    if (contacts === before) break
  }

  w.x[slot] = px
  w.y[slot] = py
  return contacts
}

/**
 * Keeps a player inside the arena rectangle, killing the outward velocity component.
 *
 * `integratePlayer` inlines this same logic for the tick path; this copy exists for
 * callers outside it (bot probing, tests, tools). Both write the bound directly into the
 * typed array instead of through a local — see the note in `sim/player.ts`.
 */
export const clampToArena = (w: World, slot: number): void => {
  const r = PLAYER_RADIUS
  const maxX = w.arenaW - r
  const maxY = w.arenaH - r

  if (w.x[slot]! < r) {
    w.x[slot] = r
    if (w.vx[slot]! < 0) w.vx[slot] = 0
  } else if (w.x[slot]! > maxX) {
    w.x[slot] = maxX
    if (w.vx[slot]! > 0) w.vx[slot] = 0
  }

  if (w.y[slot]! < r) {
    w.y[slot] = r
    if (w.vy[slot]! < 0) w.vy[slot] = 0
  } else if (w.y[slot]! > maxY) {
    w.y[slot] = maxY
    if (w.vy[slot]! > 0) w.vy[slot] = 0
  }
}

/** Total addressable echo body ids. Exported for the renderer's particle slicing. */
export const TOTAL_BODY_IDS = MAX_PLAYERS * ECHO_BODIES_PER_PLAYER
