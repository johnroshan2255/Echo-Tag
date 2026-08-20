import { encodeInput, IDLE_INPUT } from '@echo-tag/shared'

/**
 * The floating touch joystick — the whole mobile control scheme.
 *
 * Movement is Echo Tag's only input (tagging is collision, wardrobes are walked into), so
 * one thumb is the entire interface. The stick is *floating*: it appears wherever the
 * thumb lands, which adapts to any hand size and grip and never asks a player to find a
 * fixed circle mid-panic. Spec per the design doc: ~110px base, ~55px knob, 10px dead
 * zone, 20px+ clear of screen edges (OS gesture zones), ~55% idle opacity.
 *
 * It coexists with the keyboard rather than replacing it — an iPad with a keyboard case
 * is both devices at once. Only touches engage it; the mouse never does, so desktop
 * click-drag can't steer. Taps on real UI (buttons, inputs, the lobby) are left alone.
 *
 * Raw touch events, not Pointer Events, deliberately: Chrome can emit an early pointerup
 * mid-gesture when it considers reclaiming the touch for scrolling, which killed the stick
 * a moment after it engaged — while the touchstart/touchmove/touchend stream stays correct
 * for the whole hold. preventDefault on the touch stream also suppresses scrolling and the
 * synthetic mouse events in one move.
 *
 * Visuals are two square-language DOM blocks, pointer-events: none — the stick is drawn
 * where the input already is, never in the input's way.
 */

const BASE_PX = 110
const KNOB_PX = 55
const DEAD_PX = 10
const EDGE_PX = 20

export interface Joystick {
  /** Packed input byte while engaged, IDLE_INPUT otherwise. */
  packed: number
  /** True while a thumb is down. */
  active: boolean
  destroy(): void
}

export const createJoystick = (): Joystick => {
  const base = document.createElement('div')
  const knob = document.createElement('div')
  base.id = 'joy-base'
  knob.id = 'joy-knob'
  const style = document.createElement('style')
  style.textContent = `
    #joy-base, #joy-knob { position: fixed; pointer-events: none; z-index: 4;
      display: none; transform: translate(-50%, -50%); box-sizing: border-box; }
    #joy-base { width: ${BASE_PX}px; height: ${BASE_PX}px; opacity: .5;
      border: 4px solid #6b5f8a; background: rgba(38, 32, 72, .35); }
    #joy-knob { width: ${KNOB_PX}px; height: ${KNOB_PX}px; opacity: .8;
      background: #ffc07a; box-shadow: 3px 3px 0 rgba(0,0,0,.35); }
  `
  document.body.append(style, base, knob)

  const state: Joystick = {
    packed: IDLE_INPUT,
    active: false,
    destroy(): void {
      removeEventListener('touchstart', onStart)
      removeEventListener('touchmove', onMove)
      removeEventListener('touchend', onEnd)
      removeEventListener('touchcancel', onEnd)
      style.remove()
      base.remove()
      knob.remove()
    },
  }

  let touchId = -1
  let baseX = 0
  let baseY = 0

  const show = (el: HTMLElement, x: number, y: number): void => {
    el.style.display = 'block'
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  const ours = (e: TouchEvent): Touch | null => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i]!.identifier === touchId) return e.changedTouches[i]!
    }
    return null
  }

  const onStart = (e: TouchEvent): void => {
    if (touchId !== -1) return // one thumb steers; a second is ignored
    const touch = e.changedTouches[0]!
    const t = e.target as HTMLElement | null
    if (t?.closest('button, input, a, #lobby, #menu')) return // real UI wins

    touchId = touch.identifier
    const margin = EDGE_PX + BASE_PX / 2
    baseX = Math.min(Math.max(touch.clientX, margin), innerWidth - margin)
    baseY = Math.min(Math.max(touch.clientY, margin), innerHeight - margin)
    show(base, baseX, baseY)
    show(knob, baseX, baseY)
    state.active = true
    state.packed = IDLE_INPUT
    e.preventDefault()
  }

  const onMove = (e: TouchEvent): void => {
    const touch = ours(e)
    if (!touch) return
    const dx = touch.clientX - baseX
    const dy = touch.clientY - baseY
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Knob tracks the thumb, capped at the base radius.
    const cap = Math.min(dist, BASE_PX / 2)
    const kx = dist > 0 ? baseX + (dx / dist) * cap : baseX
    const ky = dist > 0 ? baseY + (dy / dist) * cap : baseY
    show(knob, kx, ky)
    base.style.opacity = '0.65'

    if (dist < DEAD_PX) {
      state.packed = IDLE_INPUT
    } else {
      const mag = Math.min(dist / (BASE_PX / 2), 1)
      state.packed = encodeInput((dx / dist) * mag, (dy / dist) * mag)
    }
    e.preventDefault()
  }

  const onEnd = (e: TouchEvent): void => {
    if (!ours(e)) return
    touchId = -1
    state.active = false
    state.packed = IDLE_INPUT
    base.style.display = 'none'
    knob.style.display = 'none'
    base.style.opacity = '0.5'
  }

  addEventListener('touchstart', onStart, { passive: false })
  addEventListener('touchmove', onMove, { passive: false })
  addEventListener('touchend', onEnd)
  addEventListener('touchcancel', onEnd)

  return state
}
