import type { Graphics } from 'pixi.js'

/**
 * Pixel-art icons, hand-authored as tiny bitmaps — one character per pixel, '.' empty.
 *
 * Everything else on screen is built from square particles and blocky tiles; a smooth
 * vector circle (or worse, a platform emoji) reads as a foreign object. These bitmaps
 * paint the same icon in both display worlds: as chunky rects onto a Pixi Graphics for
 * the arena floor, and as crisp integer-scaled pixels onto a DOM canvas for the tool
 * belt — no fonts, no assets, no anti-aliasing anywhere.
 */

export interface PixelIcon {
  rows: string[]
  palette: Record<string, number>
}

const GOLD = 0xe8c56a
const GOLD_DARK = 0xa8853c
const GLASS = 0xbfe8d2
const GOO = 0x7ccb66
const GOO_DARK = 0x4c8f3e
const CORK = 0x8a6a42
const STEEL = 0xb9b4c9
const STEEL_DARK = 0x6d6880

/** A key seen from the side: ring bow, shaft, two teeth. */
export const KEY_ICON: PixelIcon = {
  palette: { g: GOLD, d: GOLD_DARK },
  rows: [
    '.ggg........',
    'g...g.......',
    'g...gggggggg',
    'g...g...d..d',
    '.ggg....d..d',
  ],
}

/** The keyhole marker floated over a wardrobe you hold the key to. */
export const KEYHOLE_ICON: PixelIcon = {
  palette: { g: GOLD, d: GOLD_DARK },
  rows: [
    '..ggg..',
    '.ggggg.',
    '.ggdgg.',
    '..gdg..',
    '..gdg..',
    '.gdddg.',
    '.ggggg.',
  ],
}

/** A stoppered jar of goo, bubble included. */
export const JAR_ICON: PixelIcon = {
  palette: { c: CORK, w: GLASS, o: GOO, d: GOO_DARK },
  rows: [
    '..cccc..',
    '...ww...',
    '..wwww..',
    '.w....w.',
    '.w.oo.w.',
    '.wooood.',
    '.wooddw.',
    '..wwww..',
  ],
}

/** A snap trap from above: two toothed jaws around the trigger plate. */
export const TRAP_ICON: PixelIcon = {
  palette: { s: STEEL, d: STEEL_DARK },
  rows: [
    's.s..s..s.s.',
    'ssssssssssss',
    '....dddd....',
    '....dddd....',
    'ssssssssssss',
    's.s..s..s.s.',
  ],
}

const CHALK = 0xfff3dc
const CHALK_DIM = 0xa9a1c6

/** A speech bubble with two lines of pixel "text" and a tail. */
export const CHAT_ICON: PixelIcon = {
  palette: { w: CHALK, d: CHALK_DIM },
  rows: [
    '.wwwwwwwww.',
    'w.........w',
    'w.ddddddd.w',
    'w.........w',
    'w.ddddd...w',
    'w.........w',
    '.wwwwwwwww.',
    '...ww......',
    '...w.......',
  ],
}

/** A right-pointing send arrow. */
export const SEND_ICON: PixelIcon = {
  palette: { w: CHALK },
  rows: [
    '....w....',
    '....ww...',
    'wwwwwww..',
    'wwwwwwww.',
    'wwwwwww..',
    '....ww...',
    '....w....',
  ],
}

/** A chunky close cross. */
export const CLOSE_ICON: PixelIcon = {
  palette: { w: CHALK },
  rows: [
    'ww...ww',
    'www.www',
    '.wwwww.',
    '..www..',
    '.wwwww.',
    'www.www',
    'ww...ww',
  ],
}

/** Paints an icon as chunky rects onto a Graphics, centred, `cell` world units per pixel. */
export const paintIcon = (g: Graphics, icon: PixelIcon, cell: number): void => {
  const w = icon.rows[0]!.length
  const h = icon.rows.length
  const ox = (-w / 2) * cell
  const oy = (-h / 2) * cell
  for (let y = 0; y < h; y++) {
    const row = icon.rows[y]!
    for (let x = 0; x < w; x++) {
      const c = row[x]!
      if (c === '.') continue
      g.rect(ox + x * cell, oy + y * cell, cell, cell).fill({ color: icon.palette[c]! })
    }
  }
}

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

/** Draws an icon crisp onto a DOM canvas at an integer pixel scale, centred. */
export const drawIconToCanvas = (canvas: HTMLCanvasElement, icon: PixelIcon | null, px: number): void => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!icon) return
  ctx.imageSmoothingEnabled = false
  const w = icon.rows[0]!.length
  const h = icon.rows.length
  const ox = Math.floor((canvas.width - w * px) / 2)
  const oy = Math.floor((canvas.height - h * px) / 2)
  for (let y = 0; y < h; y++) {
    const row = icon.rows[y]!
    for (let x = 0; x < w; x++) {
      const c = row[x]!
      if (c === '.') continue
      ctx.fillStyle = css(icon.palette[c]!)
      ctx.fillRect(ox + x * px, oy + y * px, px, px)
    }
  }
}
