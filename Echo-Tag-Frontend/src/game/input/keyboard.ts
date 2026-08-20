import { encodeInput, IDLE_INPUT } from '@echo-tag/shared'

/**
 * Keyboard input.
 *
 * WASD *and* the arrow keys, both live simultaneously — the tech doc is explicit that
 * players should not have to discover which one this game chose. Diagonals are normalised so
 * moving north-east is not 1.41x faster than moving north, which is the oldest bug in
 * top-down movement.
 *
 * Phase 3 adds the touch joystick and capability detection alongside this; the two schemes
 * are designed to coexist rather than to be switched between, because an iPad with a
 * keyboard case is both.
 */

export interface Keyboard {
  /** Current packed input byte, ready to hand to the simulation. */
  packed: number
  /** True once the player has pressed anything — Poki's gameplayStart hook. */
  everPressed: boolean
  destroy(): void
}

const LEFT = new Set(['ArrowLeft', 'KeyA'])
const RIGHT = new Set(['ArrowRight', 'KeyD'])
const UP = new Set(['ArrowUp', 'KeyW'])
const DOWN = new Set(['ArrowDown', 'KeyS'])

export const createKeyboard = (target: EventTarget = globalThis): Keyboard => {
  let l = false
  let r = false
  let u = false
  let d = false

  const state: Keyboard = {
    packed: IDLE_INPUT,
    everPressed: false,
    destroy(): void {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }

  const recompute = (): void => {
    const dx = (r ? 1 : 0) - (l ? 1 : 0)
    const dy = (d ? 1 : 0) - (u ? 1 : 0)
    if (dx === 0 && dy === 0) {
      state.packed = IDLE_INPUT
      return
    }
    // Normalise so diagonals are not faster than the cardinals.
    const len = Math.sqrt(dx * dx + dy * dy)
    state.packed = encodeInput(dx / len, dy / len)
  }

  const set = (code: string, down: boolean): boolean => {
    if (LEFT.has(code)) return ((l = down), true)
    if (RIGHT.has(code)) return ((r = down), true)
    if (UP.has(code)) return ((u = down), true)
    if (DOWN.has(code)) return ((d = down), true)
    return false
  }

  const onDown = (e: Event): void => {
    const ke = e as KeyboardEvent
    if (ke.repeat) return
    if (!set(ke.code, true)) return
    // Arrow keys scroll the page inside an iframe otherwise, which on Poki means the whole
    // game shifts under the player mid-round.
    ke.preventDefault()
    state.everPressed = true
    recompute()
  }

  const onUp = (e: Event): void => {
    const ke = e as KeyboardEvent
    if (!set(ke.code, false)) return
    ke.preventDefault()
    recompute()
  }

  // Losing focus mid-key would otherwise leave the player walking into a wall forever.
  const onBlur = (): void => {
    l = r = u = d = false
    recompute()
  }

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)

  return state
}
