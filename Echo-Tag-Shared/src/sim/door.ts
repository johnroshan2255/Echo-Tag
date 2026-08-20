import {
  DOOR_CLOSE_RATE,
  DOOR_OPEN_RATE,
  DOOR_RELEASE_R,
  DOOR_TRIGGER_R,
  MAP_TILE,
  MAX_PLAYERS,
} from '../constants.ts'
import { doorCenterX, doorCenterY } from '../maps/index.ts'
import type { World } from './world.ts'

/**
 * Doors.
 *
 * A door opens itself as anyone comes near and drifts shut once everyone has left. That
 * makes it three things at once:
 *   - an obstacle with a rhythm (a closed door costs you the opening delay — meaningful in
 *     a chase measured in tenths of a second),
 *   - an information channel: a door creaking beyond your vision tells you *someone is
 *     there*, which under fog of war is the whole sensory game,
 *   - and a courtesy: it can never close on a player standing in the frame.
 *
 * Deterministic (a pure function of player positions), allocation-free, and part of the
 * shared simulation because both predator and prey interact with it — and because a door
 * that client prediction disagrees about is a tag dispute waiting to happen.
 *
 * Openness lives in `world.doorOpen[d]` as 0..1. Collision treats a door as two wall tiles
 * while openness < DOOR_SOLID_BELOW (see math/collision.ts). Hysteresis between trigger and
 * release radii keeps a player idling at the threshold from making it flutter.
 */

const TRIGGER_SQ = DOOR_TRIGGER_R * DOOR_TRIGGER_R
const RELEASE_SQ = DOOR_RELEASE_R * DOOR_RELEASE_R
/** "Standing in the frame" = within a tile's reach of the door centre. */
const OCCUPIED_SQ = MAP_TILE * MAP_TILE

export const updateDoors = (w: World): void => {
  const map = w.map
  const count = map.doors.length / 3

  for (let d = 0; d < count; d++) {
    const cx = doorCenterX(map, d)
    const cy = doorCenterY(map, d)

    let near = false
    let holding = false
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (w.active[s] === 0) continue
      const dx = w.x[s]! - cx
      const dy = w.y[s]! - cy
      const dSq = dx * dx + dy * dy
      if (dSq < OCCUPIED_SQ) holding = true
      if (w.doorOpen[d]! > 0 ? dSq < RELEASE_SQ : dSq < TRIGGER_SQ) near = true
      if (near && holding) break
    }

    if (near || holding) {
      const o = w.doorOpen[d]! + DOOR_OPEN_RATE
      w.doorOpen[d] = o > 1 ? 1 : o
    } else {
      const o = w.doorOpen[d]! - DOOR_CLOSE_RATE
      w.doorOpen[d] = o < 0 ? 0 : o
    }
  }
}
