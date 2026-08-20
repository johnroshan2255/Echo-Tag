import { drawPreview } from './preview.ts'

/**
 * The boot chunk.
 *
 * HARD RULE: this file and everything it imports may not pull in PixiJS, Preact or
 * Colyseus. It is the chunk that has to be parsed and running before the player has
 * decided whether to wait, so its budget is 16KB brotli and `npm run size` enforces it.
 * Its whole job is: paint something real, put an interactive Play button on screen, and
 * start downloading the game in the background.
 *
 * Poki's requirement that `gameplayStart()` fire on first *input* rather than on load is
 * a natural fit for this shape — the SDK call lives on the Play handler, not here.
 */

// Two separate canvases. A canvas element is permanently bound to the first context type
// it returns, so the 2D preview cannot share an element with the WebGL arena — asking for
// `webgl2` on a canvas that has already handed out a `2d` context returns null, and PixiJS
// reports it as "this browser does not support WebGL". Learned the hard way; the headless
// check now guards it.
const stage = document.getElementById('stage') as HTMLCanvasElement | null
const preview = document.getElementById('preview') as HTMLCanvasElement | null
const ui = document.getElementById('ui')

if (!stage || !preview || !ui) throw new Error('boot: #stage, #preview or #ui missing from index.html')

// ── Canvas sizing ────────────────────────────────────────────────────────────
// Capped at 2x: beyond that a phone pays for pixels nobody can see, and this game is
// flat colour on flat colour.
const fit = (canvas: HTMLCanvasElement): void => {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
  const w = Math.round(globalThis.innerWidth * dpr)
  const h = Math.round(globalThis.innerHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

fit(stage)
fit(preview)
drawPreview(preview)

let previewLive = true
addEventListener(
  'resize',
  () => {
    fit(stage)
    if (previewLive) {
      fit(preview)
      drawPreview(preview)
    }
  },
  { passive: true },
)

// ── Start downloading the game immediately ───────────────────────────────────
// Kicked off before the player can possibly have pressed Play, so the engine chunk
// downloads while they are reading the button. Rejection is swallowed here and surfaced
// when Play is actually pressed — a network failure should not blank the preview.
type GameModule = typeof import('../game/index.ts')
let gameModule: Promise<GameModule> | null = import('../game/index.ts')
gameModule.catch(() => {})

// ── Play button ──────────────────────────────────────────────────────────────
const play = document.createElement('button')
play.id = 'play'
play.type = 'button'
play.textContent = 'PLAY'
play.setAttribute('aria-label', 'Play Echo Tag')
ui.appendChild(play)

const status = document.createElement('p')
status.id = 'status'
status.textContent = "Don't be It when the clock runs out."
ui.appendChild(status)

let starting = false

const start = async (): Promise<void> => {
  if (starting) return
  starting = true
  play.disabled = true
  play.textContent = 'LOADING'

  try {
    const mod = await (gameModule ?? import('../game/index.ts'))
    play.remove()
    status.remove()

    fit(stage)
    await mod.startGame(stage)

    // Only now is there something behind the preview worth showing.
    previewLive = false
    preview.classList.add('gone')
    setTimeout(() => preview.remove(), 400)
  } catch (err) {
    // Never leave the player staring at a dead button.
    starting = false
    gameModule = null
    play.disabled = false
    play.textContent = 'RETRY'
    status.textContent = 'Could not load the game. Check your connection.'
    console.error('boot: game failed to start', err)
  }
}

play.addEventListener('click', start)
// Enter/Space on a focused button already fire click; this catches a keyboard player who
// never touches the button at all.
addEventListener('keydown', (e) => {
  if (!starting && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    void start()
  }
})

// A marker the headless smoke check waits on, and a cheap manual sanity signal.
document.documentElement.dataset.boot = 'ready'
performance.mark('echo-tag:boot-ready')
