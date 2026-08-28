import { RoundPhase, type World } from '@echo-tag/shared'

/**
 * The round timer: M:SS in hand-authored pixel digits, top-centre, engine-owned DOM.
 *
 * Same rules as the tool belt and the chat bubble: a chunky chip over the arena, pixel
 * glyphs drawn onto a small canvas at an integer scale — no fonts, no anti-aliasing, so
 * it reads as part of the same square world on every platform (see render/pixelIcons.ts).
 *
 * Shown through Countdown (full time, frozen) and Playing (ticking down); hidden in the
 * lobby and over the results board. Chalk normally, apricot inside the last 30 seconds,
 * ember-red with a heartbeat blink inside the last 10 — the ghost's favourite moment.
 */

const CHALK = '#fff3dc'
const APRICOT = '#ffc07a'
const EMBER = '#ff6a5e'

/** 3x5 pixel digit font. One string per row, 'x' lit, '.' empty. Colon is 1 wide. */
const GLYPHS: Record<string, string[]> = {
  '0': ['xxx', 'x.x', 'x.x', 'x.x', 'xxx'],
  '1': ['.x.', 'xx.', '.x.', '.x.', 'xxx'],
  '2': ['xxx', '..x', 'xxx', 'x..', 'xxx'],
  '3': ['xxx', '..x', 'xxx', '..x', 'xxx'],
  '4': ['x.x', 'x.x', 'xxx', '..x', '..x'],
  '5': ['xxx', 'x..', 'xxx', '..x', 'xxx'],
  '6': ['xxx', 'x..', 'xxx', 'x.x', 'xxx'],
  '7': ['xxx', '..x', '.x.', '.x.', '.x.'],
  '8': ['xxx', 'x.x', 'xxx', 'x.x', 'xxx'],
  '9': ['xxx', 'x.x', 'xxx', '..x', 'xxx'],
  ':': ['.', 'x', '.', 'x', '.'],
}

const PX = 4 // integer pixel scale, same as the tool belt icons
const GAP = PX // one pixel-cell of air between glyphs

export interface HudTimer {
  /** Cheap per-frame call: redraws only when the displayed second (or colour) changes. */
  update(w: World, nowMs: number): void
  destroy(): void
}

export const createHudTimer = (): HudTimer => {
  const chip = document.createElement('div')
  chip.id = 'hud-timer'
  chip.style.cssText =
    'position:fixed;top:calc(14px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);' +
    'padding:10px 14px;background:rgba(22,18,38,.72);border:1.5px solid rgba(255,243,220,.22);' +
    'border-radius:10px;z-index:30;pointer-events:none;user-select:none;display:none;'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;image-rendering:pixelated;'
  chip.appendChild(canvas)
  document.body.appendChild(chip)

  let shown = false
  let drawnText = ''
  let drawnColor = ''

  const draw = (text: string, color: string): void => {
    drawnText = text
    drawnColor = color
    let w = 0
    for (const ch of text) w += GLYPHS[ch]![0]!.length * PX + GAP
    w -= GAP
    const h = 5 * PX
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = color
    let ox = 0
    for (const ch of text) {
      const rows = GLYPHS[ch]!
      for (let y = 0; y < 5; y++) {
        const row = rows[y]!
        for (let x = 0; x < row.length; x++) {
          if (row[x] === 'x') ctx.fillRect(ox + x * PX, y * PX, PX, PX)
        }
      }
      ox += rows[0]!.length * PX + GAP
    }
  }

  return {
    update(w: World, nowMs: number): void {
      const visible = w.phase === RoundPhase.Countdown || w.phase === RoundPhase.Playing
      if (visible !== shown) {
        shown = visible
        chip.style.display = visible ? 'block' : 'none'
      }
      if (!visible) return

      const leftMs = Math.max(0, w.roundDurationMs - w.clockMs)
      const secs = Math.ceil(leftMs / 1000)
      const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
      // Countdown: an apricot heartbeat — "get ready". Last 10 seconds: ember beat.
      const color =
        w.phase === RoundPhase.Countdown
          ? nowMs % 600 < 300
            ? APRICOT
            : CHALK
          : secs <= 10
            ? nowMs % 1000 < 500
              ? EMBER
              : APRICOT
            : secs <= 30
              ? APRICOT
              : CHALK
      if (text !== drawnText || color !== drawnColor) draw(text, color)
    },
    destroy(): void {
      chip.remove()
    },
  }
}
