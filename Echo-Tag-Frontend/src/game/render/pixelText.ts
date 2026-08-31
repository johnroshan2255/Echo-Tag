/**
 * The pixel text renderer: a hand-authored 3x5 (variable-width) uppercase font drawn
 * onto DOM canvases at an integer scale. Same rules as the pixel icons — no browser
 * fonts, no anti-aliasing, so the timer, the map banner and every future label read as
 * part of the same square world on every platform.
 */

/** Rows per glyph, 'x' lit, '.' empty. Width varies: M/W get 5 columns, N gets 4. */
export const GLYPHS: Record<string, string[]> = {
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
  A: ['xxx', 'x.x', 'xxx', 'x.x', 'x.x'],
  B: ['xx.', 'x.x', 'xx.', 'x.x', 'xx.'],
  C: ['xxx', 'x..', 'x..', 'x..', 'xxx'],
  D: ['xx.', 'x.x', 'x.x', 'x.x', 'xx.'],
  E: ['xxx', 'x..', 'xx.', 'x..', 'xxx'],
  F: ['xxx', 'x..', 'xx.', 'x..', 'x..'],
  G: ['xxx', 'x..', 'x.x', 'x.x', 'xxx'],
  H: ['x.x', 'x.x', 'xxx', 'x.x', 'x.x'],
  I: ['xxx', '.x.', '.x.', '.x.', 'xxx'],
  J: ['..x', '..x', '..x', 'x.x', 'xxx'],
  K: ['x.x', 'x.x', 'xx.', 'x.x', 'x.x'],
  L: ['x..', 'x..', 'x..', 'x..', 'xxx'],
  M: ['x...x', 'xx.xx', 'x.x.x', 'x...x', 'x...x'],
  N: ['x..x', 'xx.x', 'x.xx', 'x..x', 'x..x'],
  O: ['xxx', 'x.x', 'x.x', 'x.x', 'xxx'],
  P: ['xxx', 'x.x', 'xxx', 'x..', 'x..'],
  Q: ['xxx', 'x.x', 'x.x', 'xxx', '..x'],
  R: ['xxx', 'x.x', 'xx.', 'x.x', 'x.x'],
  S: ['xxx', 'x..', 'xxx', '..x', 'xxx'],
  T: ['xxx', '.x.', '.x.', '.x.', '.x.'],
  U: ['x.x', 'x.x', 'x.x', 'x.x', 'xxx'],
  V: ['x.x', 'x.x', 'x.x', 'x.x', '.x.'],
  W: ['x...x', 'x...x', 'x.x.x', 'x.x.x', '.x.x.'],
  X: ['x.x', 'x.x', '.x.', 'x.x', 'x.x'],
  Y: ['x.x', 'x.x', '.x.', '.x.', '.x.'],
  Z: ['xxx', '..x', '.x.', 'x..', 'xxx'],
  ':': ['.', 'x', '.', 'x', '.'],
  '!': ['x', 'x', 'x', '.', 'x'],
  '-': ['...', '...', 'xxx', '...', '...'],
  '+': ['...', '.x.', 'xxx', '.x.', '...'],
  '·': ['.', '.', 'x', '.', '.'],
  ' ': ['..', '..', '..', '..', '..'],
}

/** Text width in canvas pixels at scale `px` (glyph widths + one-cell gaps). */
export const measurePixelText = (text: string, px: number): number => {
  let w = 0
  for (const ch of text) w += (GLYPHS[ch] ?? GLYPHS[' ']!)[0]!.length * px + px
  return Math.max(0, w - px)
}

/**
 * Draws `text` onto `canvas`, resizing it to fit exactly. Unknown characters render as
 * spaces. Returns nothing; the caller owns layout.
 */
export const drawPixelText = (canvas: HTMLCanvasElement, text: string, px: number, color: string): void => {
  const w = measurePixelText(text, px)
  const h = 5 * px
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
    const rows = GLYPHS[ch] ?? GLYPHS[' ']!
    for (let y = 0; y < 5; y++) {
      const row = rows[y]!
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 'x') ctx.fillRect(ox + x * px, y * px, px, px)
      }
    }
    ox += rows[0]!.length * px + px
  }
}
