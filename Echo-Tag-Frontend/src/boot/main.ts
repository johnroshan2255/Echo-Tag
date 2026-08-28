import { drawPreview } from './preview.ts'
import { pokiInit, pokiLoadingFinished } from '../platform/poki.ts'

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
const refit = (): void => {
  fit(stage)
  if (previewLive) {
    fit(preview)
    drawPreview(preview)
  }
}
// Rotation: iOS Safari can fire resize/orientationchange while innerWidth/innerHeight
// still describe the OLD orientation — refit now and again once the rotation settles.
let settleTimer: ReturnType<typeof setTimeout> | undefined
const refitSettled = (): void => {
  refit()
  clearTimeout(settleTimer)
  settleTimer = setTimeout(refit, 300)
}
addEventListener('resize', refitSettled, { passive: true })
addEventListener('orientationchange', refitSettled, { passive: true })
globalThis.visualViewport?.addEventListener('resize', refitSettled, { passive: true })

// ── Start downloading the game immediately ───────────────────────────────────
// Kicked off before the player can possibly have pressed Play, so the engine chunk
// downloads while they are reading the button. Rejection is swallowed here and surfaced
// when Play is actually pressed — a network failure should not blank the preview.
type GameModule = typeof import('../game/index.ts')
type GameMode = import('../game/index.ts').GameMode
let gameModule: Promise<GameModule> | null = import('../game/index.ts')
gameModule.catch(() => {})

// ── The menu ─────────────────────────────────────────────────────────────────
// Four ways in, one design language: hard-cornered square buttons, the dusk palette, and
// the apricot accent. #play (bots) is the primary — instant fun, no server needed.
const menu = document.createElement('div')
menu.id = 'menu'
menu.innerHTML = `
  <h1 id="title">ECHO TAG</h1>
  <button id="play" type="button" aria-label="Play with bots">PLAY</button>
  <p id="status">Don't be It when the clock runs out.</p>
  <div id="mp">
    <button id="quick" type="button">QUICK MATCH</button>
    <button id="host" type="button">HOST ROOM</button>
    <form id="joinform"><input id="codein" maxlength="5" placeholder="CODE"
      autocomplete="off" spellcheck="false" /><button id="joinbtn" type="submit">JOIN</button></form>
  </div>`
ui.appendChild(menu)

const play = menu.querySelector('#play') as HTMLButtonElement
const status = menu.querySelector('#status') as HTMLElement
const quick = menu.querySelector('#quick') as HTMLButtonElement
const host = menu.querySelector('#host') as HTMLButtonElement
const joinForm = menu.querySelector('#joinform') as HTMLFormElement
const codeIn = menu.querySelector('#codein') as HTMLInputElement
codeIn.addEventListener('input', () => {
  codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, '')
})

let starting = false

const start = async (mode: GameMode): Promise<void> => {
  if (starting) return
  starting = true
  play.textContent = 'LOADING'
  menu.classList.add('busy')

  try {
    const mod = await (gameModule ?? import('../game/index.ts'))
    fit(stage)
    await mod.startGame(stage, mode)

    menu.remove()
    // Only now is there something behind the preview worth showing.
    previewLive = false
    preview.classList.add('gone')
    setTimeout(() => preview.remove(), 400)
  } catch (err) {
    // Never leave the player staring at a dead button.
    starting = false
    gameModule = null
    menu.classList.remove('busy')
    play.textContent = 'RETRY'
    const full = String(err).toLowerCase().includes('full')
    status.textContent =
      mode.kind === 'bots'
        ? 'Could not load the game. Check your connection.'
        : mode.kind === 'code'
          ? full
            ? 'That room is full right now — try again in a moment.'
            : 'No room with that code. Check it and try again.'
          : 'Could not reach the game server — try PLAY for a bots round.'
    // A dead room link must not keep re-triggering the rejoin on every refresh — but a
    // FULL room is a transient state, often the refresher's own seat not yet freed
    // (the server holds it briefly while the old socket closes). Keep the param then,
    // so the next refresh can rejoin automatically once the seat frees.
    if (mode.kind === 'code' && !full) {
      try {
        history.replaceState(null, '', location.pathname)
      } catch {
        /* embedded contexts may forbid history access */
      }
    }
    console.error('boot: game failed to start', err)
  }
}

// ── Refresh-rejoin ───────────────────────────────────────────────────────────
// Hosting or joining puts the room code in the URL (?room=CODE), so a refresh drops the
// player straight back into their room, mid-round included. Audio starts suspended
// without a user gesture; the engine resumes it on the first press or tap.
const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
if (/^[A-Z]{5}$/.test(roomParam)) {
  status.textContent = `Rejoining room ${roomParam}...`
  void start({ kind: 'code', code: roomParam })
}

play.addEventListener('click', () => void start({ kind: 'bots' }))
quick.addEventListener('click', () => void start({ kind: 'quick' }))
host.addEventListener('click', () => void start({ kind: 'host' }))
joinForm.addEventListener('submit', (e) => {
  e.preventDefault()
  if (codeIn.value.length === 5) void start({ kind: 'code', code: codeIn.value })
  else status.textContent = 'Room codes are five letters.'
})
// Enter/Space anywhere starts a bots round — the zero-friction path.
addEventListener('keydown', (e) => {
  if (starting || document.activeElement === codeIn) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    void start({ kind: 'bots' })
  }
})

// A marker the headless smoke check waits on, and a cheap manual sanity signal.
document.documentElement.dataset.boot = 'ready'
performance.mark('echo-tag:boot-ready')

// Poki: the menu IS the loaded state — the player can interact right now. gameplayStart
// deliberately does NOT happen here; it fires on the first in-round input (game/index.ts).
void pokiInit().then(pokiLoadingFinished)
