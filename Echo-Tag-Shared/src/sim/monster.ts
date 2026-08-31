import {
  BEAM_CHARGE_MS,
  BEAM_COOLDOWN_MS,
  BEAM_FLASH_MS,
  BEAM_HALF_WIDTH,
  BEAM_RANGE,
  DOOR_SOLID_BELOW,
  MAP_TILE,
  MAX_DEPLOYED,
  MAX_PLAYERS,
  MAX_WEB_SHOTS,
  Monster,
  MONSTER_BY_MAP,
  PLAYER_RADIUS,
  TICK_MS,
  TOOL_NONE,
  TOOL_WEB,
  UNCONSCIOUS_MS,
  WEB_COOLDOWN_MS,
  WEB_PATCH_LIFE_MS,
  WEB_ROOT_MS,
  WEB_SHOT_LIFE_MS,
  WEB_SHOT_RADIUS,
  WEB_SHOT_SPEED,
} from '../constants.ts'
import { isWall } from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from './world.ts'

/**
 * Monster abilities: what replaces the echo trail on the maps whose monster is not a
 * ghost. The spider SHOOTS WEBS — a projectile that roots the first runner it touches
 * and splats into a lingering slow-patch (deployed into the shared tools pool, so the
 * wire and the slow rules come for free). The alien CHARGES A BEAM — aim locks at the
 * press, a visible telegraph, then a wall-stopped line that knocks out everything on it.
 *
 * Requests arrive like tool uses: queued as world state, consumed here on the next tick,
 * so both sides of the wire resolve identically. Bots fire from the same code path, on
 * deterministic conditions. Fixed pools, zero allocation.
 */

const WEB_LIFE_TICKS = Math.ceil(WEB_SHOT_LIFE_MS / TICK_MS)
const WEB_ROOT_TICKS = Math.ceil(WEB_ROOT_MS / TICK_MS)
const WEB_CD_TICKS = Math.ceil(WEB_COOLDOWN_MS / TICK_MS)
const WEB_PATCH_TICKS = Math.ceil(WEB_PATCH_LIFE_MS / TICK_MS)
const BEAM_CHARGE_TICKS = Math.ceil(BEAM_CHARGE_MS / TICK_MS)
const BEAM_FLASH_TICKS = Math.ceil(BEAM_FLASH_MS / TICK_MS)
const BEAM_CD_TICKS = Math.ceil(BEAM_COOLDOWN_MS / TICK_MS)
const KO_TICKS = Math.ceil(UNCONSCIOUS_MS / TICK_MS)
const WEB_HIT_SQ = (WEB_SHOT_RADIUS + PLAYER_RADIUS) ** 2
const DT = TICK_MS / 1000

/** The monster hunting on this world's map. */
export const monsterOf = (w: World): Monster => MONSTER_BY_MAP[w.map.index] ?? Monster.Ghost

/** Whether the current map's monster has an active ability (spider web / alien beam). */
export const monsterHasAbility = (w: World): boolean => {
  const m = monsterOf(w)
  return m === Monster.Spider || m === Monster.Alien
}

/**
 * Queues an ability press for the next tick. Reached through the same message the tools
 * use (invSlot 2); anything invalid simply does nothing when consumed.
 */
export const queueAbility = (w: World, slot: number): void => {
  w.abilityQueued[slot] = 1
}

/**
 * Solid for a projectile: a wall/furniture tile, or a tile carrying a CLOSED door —
 * players collide with shut doors, so webs and beams must stop at them too.
 */
const solidAt = (w: World, px: number, py: number): boolean => {
  const tx = Math.floor(px / MAP_TILE)
  const ty = Math.floor(py / MAP_TILE)
  if (isWall(w.map, tx, ty)) return true
  const doors = w.map.doors
  for (let d = 0; d * 3 < doors.length; d++) {
    if (w.doorOpen[d]! >= DOOR_SOLID_BELOW) continue
    const dx = doors[d * 3]!
    const dy = doors[d * 3 + 1]!
    const axis = doors[d * 3 + 2]!
    if ((tx === dx && ty === dy) || (axis === 0 ? tx === dx + 1 && ty === dy : tx === dx && ty === dy + 1)) {
      return true
    }
  }
  return false
}

/** Distance along a ray before it hits something solid, marched at a fixed step. */
const raycastWallDist = (w: World, x: number, y: number, angle: number, maxDist: number): number => {
  const STEP = 16
  const cx = Math.cos(angle)
  const cy = Math.sin(angle)
  for (let d = STEP; d <= maxDist; d += STEP) {
    if (solidAt(w, x + cx * d, y + cy * d)) return d - STEP
  }
  return maxDist
}

/** Splats a web patch into the shared deploy pool. Full pool: the splat just fizzles. */
const deployWebPatch = (w: World, x: number, y: number, owner: number): void => {
  for (let i = 0; i < MAX_DEPLOYED; i++) {
    if (w.depType[i] !== TOOL_NONE) continue
    w.depType[i] = TOOL_WEB
    w.depOwner[i] = owner
    w.depX[i] = x
    w.depY[i] = y
    w.depUntilTick[i] = w.tick + WEB_PATCH_TICKS
    return
  }
}

/** A runner the monster's weapons care about: live, visible, awake to consequences. */
const targetable = (w: World, s: number): boolean =>
  w.active[s] === 1 &&
  s !== w.itSlot &&
  s !== w.turningSlot &&
  w.hiddenIn[s] === NO_SLOT &&
  w.tick >= w.immuneUntilTick[s]!

export const updateMonster = (w: World): void => {
  const monster = monsterOf(w)
  const it = w.itSlot

  // A headless beam must not fire: cancel a charge whose alien stopped being It.
  if (w.beamPhase !== 0 && (it === NO_SLOT || monster !== Monster.Alien)) w.beamPhase = 0

  // ── Bots fire themselves: same rules, deterministic conditions ──
  if (
    it !== NO_SLOT &&
    w.isBot[it] === 1 &&
    (monster === Monster.Spider || monster === Monster.Alien) &&
    w.tick >= w.abilityReadyTick &&
    w.beamPhase === 0
  ) {
    // Nearest targetable runner with a clear line: aim straight at them and press.
    const range = monster === Monster.Spider ? WEB_SHOT_SPEED * WEB_SHOT_LIFE_MS * 0.00085 : BEAM_RANGE * 0.85
    let best = NO_SLOT
    let bestSq = range * range
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (!targetable(w, s)) continue
      const dx = w.x[s]! - w.x[it]!
      const dy = w.y[s]! - w.y[it]!
      const d = dx * dx + dy * dy
      if (d < bestSq) {
        bestSq = d
        best = s
      }
    }
    if (best !== NO_SLOT) {
      const aim = Math.atan2(w.y[best]! - w.y[it]!, w.x[best]! - w.x[it]!)
      if (raycastWallDist(w, w.x[it]!, w.y[it]!, aim, Math.sqrt(bestSq)) >= Math.sqrt(bestSq) - 24) {
        w.facing[it] = aim
        w.abilityQueued[it] = 1
      }
    }
  }

  // ── Consume queued presses (only the It's press means anything) ──
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const pressed = w.abilityQueued[s] === 1
    if (pressed) w.abilityQueued[s] = 0
    if (!pressed || s !== it || it === NO_SLOT) continue
    if (w.tick < w.abilityReadyTick) continue
    if (w.tick < w.unconsciousUntilTick[s]!) continue

    if (monster === Monster.Spider) {
      let shot = -1
      for (let i = 0; i < MAX_WEB_SHOTS; i++) {
        if (w.webUntilTick[i]! <= w.tick) {
          shot = i
          break
        }
      }
      if (shot < 0) continue // all shots in flight: the press fails silently
      const aim = w.facing[s]!
      w.webX[shot] = w.x[s]!
      w.webY[shot] = w.y[s]!
      w.webVX[shot] = Math.cos(aim) * WEB_SHOT_SPEED
      w.webVY[shot] = Math.sin(aim) * WEB_SHOT_SPEED
      w.webUntilTick[shot] = w.tick + WEB_LIFE_TICKS
      w.webOwner[shot] = s // the patch keeps THIS spider's immunity even across a crowning
      w.abilityReadyTick = w.tick + WEB_CD_TICKS
    } else if (monster === Monster.Alien && w.beamPhase === 0) {
      w.beamPhase = 1
      w.beamAngle = w.facing[s]!
      w.beamUntilTick = w.tick + BEAM_CHARGE_TICKS
      w.abilityReadyTick = w.tick + BEAM_CD_TICKS
    }
  }

  // ── Webs in flight ──
  for (let i = 0; i < MAX_WEB_SHOTS; i++) {
    if (w.webUntilTick[i]! <= w.tick) continue
    const owner = w.webOwner[i]!
    const nx = w.webX[i]! + w.webVX[i]! * DT
    const ny = w.webY[i]! + w.webVY[i]! * DT
    // Walls — and closed doors — stop a web dead; it splats where it stops.
    if (solidAt(w, nx, ny)) {
      deployWebPatch(w, w.webX[i]!, w.webY[i]!, owner)
      w.webUntilTick[i] = 0
      continue
    }
    w.webX[i] = nx
    w.webY[i] = ny
    let landed = false
    for (let s = 0; s < MAX_PLAYERS && !landed; s++) {
      if (!targetable(w, s)) continue
      const dx = w.x[s]! - nx
      const dy = w.y[s]! - ny
      if (dx * dx + dy * dy > WEB_HIT_SQ) continue
      w.slowedUntilTick[s] = w.tick + WEB_ROOT_TICKS
      deployWebPatch(w, nx, ny, owner)
      w.webUntilTick[i] = 0
      landed = true
    }
    if (!landed && w.webUntilTick[i]! - 1 <= w.tick) {
      // Spent: splat where it fell.
      deployWebPatch(w, nx, ny, owner)
      w.webUntilTick[i] = 0
    }
  }

  // ── The beam ──
  if (w.beamPhase === 1 && w.tick >= w.beamUntilTick && it !== NO_SLOT) {
    if (w.tick < w.unconsciousUntilTick[it]!) {
      // Trapped mid-charge: a fainted ghost tags nobody, and a fainted alien fires
      // nothing. The cooldown stays spent — the trap cost them the shot.
      w.beamPhase = 0
      return
    }
    // FIRE. The beam starts at the alien (it may have drifted during the charge; the
    // angle is what locked) and stops at the first wall or closed door.
    const ox = w.x[it]!
    const oy = w.y[it]!
    const reach = raycastWallDist(w, ox, oy, w.beamAngle, BEAM_RANGE)
    const cx = Math.cos(w.beamAngle)
    const cy = Math.sin(w.beamAngle)
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (!targetable(w, s)) continue
      if (w.tick < w.unconsciousUntilTick[s]!) continue // a body cannot be re-floored
      const rx = w.x[s]! - ox
      const ry = w.y[s]! - oy
      const along = rx * cx + ry * cy
      if (along < 0 || along > reach) continue
      const perp = Math.abs(rx * -cy + ry * cx)
      if (perp > BEAM_HALF_WIDTH + PLAYER_RADIUS) continue
      w.unconsciousUntilTick[s] = w.tick + KO_TICKS
      w.vx[s] = 0
      w.vy[s] = 0
    }
    w.beamReach = reach
    w.beamPhase = 2
    w.beamUntilTick = w.tick + BEAM_FLASH_TICKS
  } else if (w.beamPhase === 2 && w.tick >= w.beamUntilTick) {
    w.beamPhase = 0
  }
}
