import { drawPixelText } from './pixelText.ts'

/**
 * The round banner: the map's name in big pixel letters, centre-screen, at round start.
 * Each arena gets an identity ("THE WARRENS") instead of just being the next maze. Pure
 * DOM, faded by CSS; shows for a beat and gets out of the way before play matters.
 */

const SHOW_MS = 2200
const PX = 6

export interface Banner {
  /** Shows `text` centred for ~2 seconds. Any pending banner is replaced. */
  show(text: string): void
  destroy(): void
}

export const createBanner = (): Banner => {
  const chip = document.createElement('div')
  chip.id = 'round-banner'
  chip.style.cssText =
    'position:fixed;top:32%;left:50%;transform:translate(-50%,-50%);' +
    'padding:14px 22px;background:rgba(22,18,38,.78);border:2px solid rgba(255,243,220,.25);' +
    'box-shadow:5px 5px 0 rgba(0,0,0,.4);z-index:29;pointer-events:none;user-select:none;' +
    'opacity:0;transition:opacity .3s ease-out;'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;image-rendering:pixelated;'
  chip.appendChild(canvas)
  document.body.appendChild(chip)

  let hideTimer: ReturnType<typeof setTimeout> | undefined

  return {
    show(text: string): void {
      drawPixelText(canvas, text.toUpperCase(), PX, '#ffc07a')
      chip.style.opacity = '1'
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        chip.style.opacity = '0'
      }, SHOW_MS)
    },
    destroy(): void {
      clearTimeout(hideTimer)
      chip.remove()
    },
  }
}
