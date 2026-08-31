import { MAX_PLAYERS, PORTAL_COOLDOWN_MS, PORTAL_R, TICK_MS } from '../constants.ts'
import { tileCenterX, tileCenterY } from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from './world.ts'

/**
 * Portals: linked teleport pads authored per map.
 *
 * Step onto a pad and you are standing on its twin, momentum kept — a chase can flow
 * straight through. A short per-player cooldown (all pads share it) stops ping-ponging
 * between a two-way pair. Runs after integration so the teleport is what history samples;
 * the client renders any teleport-sized jump as a snap, so nothing glides across the map.
 */

const COOLDOWN_TICKS = Math.ceil(PORTAL_COOLDOWN_MS / TICK_MS)
const R_SQ = PORTAL_R * PORTAL_R

export const updatePortals = (w: World): void => {
  const portals = w.map.portals
  if (portals.length === 0) return

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0 || w.hiddenIn[s] !== NO_SLOT) continue
    if (w.tick < w.unconsciousUntilTick[s]!) continue
    if (w.tick < w.portalCooldownUntil[s]!) continue
    for (let p = 0; p < portals.length; p += 4) {
      const px = tileCenterX(portals[p]!)
      const py = tileCenterY(portals[p + 1]!)
      const dx = w.x[s]! - px
      const dy = w.y[s]! - py
      if (dx * dx + dy * dy > R_SQ) continue
      w.x[s] = tileCenterX(portals[p + 2]!)
      w.y[s] = tileCenterY(portals[p + 3]!)
      w.portalCooldownUntil[s] = w.tick + COOLDOWN_TICKS
      w.events.portalUsed = s
      break
    }
  }
}
