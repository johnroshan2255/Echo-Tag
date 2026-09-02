import { animatePreview, drawPreview } from './preview.ts'
import { armMenuAudio, menuThunder, stopMenuAudio } from './menuAudio.ts'
import { underPortal } from '../platform/portal.ts'
import { pokiInit, pokiLoadingFinished } from '../platform/poki.ts'
import {
  cgInit,
  cgInstantMultiplayer,
  cgInviteAtLoad,
  cgLoadingFinished,
  cgOnJoinRoom,
  cgOnSettingsChange,
  cgSettings,
  type RoomInvite,
} from '../platform/crazygames.ts'
import { T } from '../platform/i18n.ts'
import { MAP_COUNT, MAPS, MONSTER_NAMES } from '@echo-tag/shared'
import { drawMinimap } from './minimap.ts'

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
const stage0 = document.getElementById('stage') as HTMLCanvasElement | null
const preview = document.getElementById('preview') as HTMLCanvasElement | null
const ui = document.getElementById('ui')

if (!stage0 || !preview || !ui) throw new Error('boot: #stage, #preview or #ui missing from index.html')
// `let`: switchRoom (below) replaces the canvas when a CrazyGames invite swaps sessions.
let stage: HTMLCanvasElement = stage0

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
drawPreview(preview) // instant static first paint; the loop takes over from here
const stopPreviewAnim = animatePreview(preview, menuThunder)
armMenuAudio() // the terror bed starts on the first gesture (autoplay gate)

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

// ── Fullscreen, held for the whole session ───────────────────────────────────
// The browser header goes away at the FIRST tap or keypress and stays away: every later
// gesture re-enters fullscreen if the player ever dropped out (Esc, alt-tab). A request
// on page load is impossible — every browser hard-gates the Fullscreen API behind a user
// gesture — so the first interaction is the earliest legal moment.
// Two exemptions: portals (Poki and CrazyGames pages have their own fullscreen control
// and their QA flags games that hijack it), and the Escape key itself (re-entering on the
// very gesture that exits would trap the player in a fight with the browser).
// "Under a portal" means actually embedded in their page (the SDK script alone also loads
// on localhost and self-hosted copies — presence isn't context). Portals run games in an
// iframe; a top-level window is never their player page.
let lastFsTry = 0
const holdFullscreen = (e: Event): void => {
  if (underPortal() || document.fullscreenElement) return
  if ((e as KeyboardEvent).key === 'Escape') return
  const now = Date.now()
  if (now - lastFsTry < 700) return // one polite retry per gesture burst
  lastFsTry = now
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
  try {
    void (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {})
  } catch {
    /* iPhones have no Fullscreen API at all — the PWA meta tags are the fallback there */
  }
}
addEventListener('pointerdown', holdFullscreen)
addEventListener('keydown', holdFullscreen)

// ── Start downloading the game immediately ───────────────────────────────────
// Kicked off before the player can possibly have pressed Play, so the engine chunk
// downloads while they are reading the button. Rejection is swallowed here and surfaced
// when Play is actually pressed — a network failure should not blank the preview.
type GameModule = typeof import('../game/index.ts')
type GameMode = import('../game/index.ts').GameMode
type GameHandle = import('../game/index.ts').GameHandle
let gameModule: Promise<GameModule> | null = import('../game/index.ts')
gameModule.catch(() => {})

// ── The menu ─────────────────────────────────────────────────────────────────
// Four ways in, one design language: hard-cornered square buttons, the dusk palette, and
// the apricot accent. #play (bots) is the primary — instant fun, no server needed.
const menu = document.createElement('div')
menu.id = 'menu'
menu.innerHTML = `
  <style>
    /* The map picker: one chunky pixel frame — arrow blocks flush against the preview
       panel, hard corners everywhere. The canvas is a true miniature of the whole arena
       (20:11), so it must stay big enough to read: as wide as the menu allows, capped by
       height so landscape phones keep the Play button on screen. */
    #bmap { display: flex; align-items: stretch; justify-content: center; margin: 0 0 12px;
      gap: 0; width: min(92vw, 440px); }
    #bmap button { pointer-events: auto; cursor: pointer; border: 3px solid #3a3150;
      background: #262048; color: #e9ddff; width: 44px; flex-shrink: 0;
      font: 400 14px/1 var(--pf); }
    #bmap button:active { background: #3a3150; }
    #bmap-prev { border-right: 0; }
    #bmap-next { border-left: 0; }
    #bmap-preview { display: flex; flex-direction: column; flex: 1; min-width: 0;
      border: 3px solid #3a3150; background: #1d1830; padding: 8px; }
    #bmap-canvas { display: block; width: min(100%, calc(30vh * 20 / 11));
      aspect-ratio: 20/11; margin: 0 auto 8px; border: 2px solid #3a3150;
      background: #262038; }
    #bmap-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #bmap-name { color: #ffc07a; font: 400 9px/1.4 var(--pf);
      letter-spacing: .04em; text-shadow: none; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; }
    #bmap-pips { display: flex; gap: 5px; flex-shrink: 0; }
    #bmap-pips i { width: 9px; height: 9px; background: #3a3150; }
    #bmap-pips i.on { background: #ffc07a; }
    @media (max-height: 520px) {
      /* The frame hugs the height-capped canvas (arrows + padding + borders ≈ 114px),
         so no dead panel space flanks the map on a landscape phone. */
      #bmap { margin: 0 0 8px; width: min(92vw, calc(24vh * 20 / 11 + 114px)); }
      #bmap-canvas { width: min(100%, calc(24vh * 20 / 11)); }
    }
    /* The ⓘ chip: how-to-play, pinned to the menu's top-right corner. The rules text
       itself is a lazy chunk (boot budget stays clean); this is just the door. */
    #info { position: absolute; top: calc(12px + env(safe-area-inset-top));
      right: calc(12px + env(safe-area-inset-right)); width: 44px; height: 44px;
      border: 3px solid #3a3150; background: #262048; color: #ffc07a;
      font: 400 15px/1 var(--pf); }
    #info:active { background: #3a3150; transform: translate(2px,2px); }
  </style>
  <button id="info" type="button" class="px-s">i</button>
  <h1 id="title">ECHO TAG</h1>
  <div id="bmap" class="px-s">
    <button id="bmap-prev" type="button" aria-label="previous map">&#9664;</button>
    <div id="bmap-preview" class="crt">
      <canvas id="bmap-canvas"></canvas>
      <div id="bmap-foot">
        <span id="bmap-name">FOUNDRY</span>
        <span id="bmap-pips"></span>
      </div>
    </div>
    <button id="bmap-next" type="button" aria-label="next map">&#9654;</button>
  </div>
  <button id="play" type="button" class="px bv-a" aria-label="Play with bots">PLAY</button>
  <p id="status">Don't be It when the clock runs out.</p>
  <div id="mp">
    <button id="quick" type="button" class="px-s bv">QUICK MATCH</button>
    <button id="host" type="button" class="px-s bv">HOST ROOM</button>
    <form id="joinform" class="px-s"><input id="codein" maxlength="5" placeholder="CODE"
      autocomplete="off" spellcheck="false" /><button id="joinbtn" type="submit">JOIN</button></form>
  </div>`
ui.appendChild(menu)

const play = menu.querySelector('#play') as HTMLButtonElement
const status = menu.querySelector('#status') as HTMLElement
const quick = menu.querySelector('#quick') as HTMLButtonElement
const host = menu.querySelector('#host') as HTMLButtonElement
const joinForm = menu.querySelector('#joinform') as HTMLFormElement
const codeIn = menu.querySelector('#codein') as HTMLInputElement
const bmapPrev = menu.querySelector('#bmap-prev') as HTMLButtonElement
const bmapNext = menu.querySelector('#bmap-next') as HTMLButtonElement
const bmapName = menu.querySelector('#bmap-name') as HTMLElement
const bmapPips = menu.querySelector('#bmap-pips') as HTMLElement
const bmapCanvas = menu.querySelector('#bmap-canvas') as HTMLCanvasElement
const bmapCtx = bmapCanvas.getContext('2d')!
bmapPips.innerHTML = '<i class="px-xs"></i>'.repeat(MAP_COUNT)
codeIn.addEventListener('input', () => {
  codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, '')
})

// The menu speaks the player's language (platform/i18n.ts): labels are set here rather
// than authored per-language in the HTML, so the markup stays one file.
play.textContent = T.play
quick.textContent = T.quick
host.textContent = T.host
;(menu.querySelector('#joinbtn') as HTMLButtonElement).textContent = T.join
codeIn.placeholder = T.codePlaceholder
status.textContent = T.tagline

// The ⓘ button: HOW TO PLAY, fetched on first tap so the rules never weigh on boot.
const info = menu.querySelector('#info') as HTMLButtonElement
info.setAttribute('aria-label', T.how)
info.title = T.how
info.addEventListener('click', () => {
  void import('./howto.ts').then((m) => m.showHowTo()).catch(() => {})
})

let bmapIndex = 0
const updateBmap = () => {
  const map = MAPS[bmapIndex]
  if (!map) return
  bmapName.textContent = `${map.name.toUpperCase()} · ${MONSTER_NAMES[bmapIndex] ?? ''}`
  bmapPips.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('on', i === bmapIndex))
  // 16px per tile internally (the CSS box only ever downscales), 20:11 like the arena.
  bmapCanvas.width = 640
  bmapCanvas.height = 352
  drawMinimap(bmapCtx, map, 640, 352)
}
bmapPrev.addEventListener('click', () => {
  bmapIndex = (bmapIndex - 1 + MAP_COUNT) % MAP_COUNT
  updateBmap()
})
bmapNext.addEventListener('click', () => {
  bmapIndex = (bmapIndex + 1) % MAP_COUNT
  updateBmap()
})
updateBmap()

let starting = false
/** The running session, once there is one — the CrazyGames join listener swaps it out. */
let handle: GameHandle | null = null
/** An invite that arrived while a start was in flight; applied the moment it lands. */
let pendingInvite: RoomInvite | null = null

const start = async (mode: GameMode): Promise<void> => {
  if (starting) return
  starting = true
  // Fullscreen is already held by the session-wide gesture listener above — the tap or
  // Enter that got us here re-entered it if the player had dropped out.

  play.textContent = T.loading
  menu.classList.add('busy')

  try {
    const mod = await (gameModule ?? import('../game/index.ts'))
    fit(stage)
    handle = await mod.startGame(stage, mode)
    drainPending() // an invite that arrived while this start was connecting

    menu.remove()
    document.getElementById('howto')?.remove() // the rules sheet must not outlive the menu
    removeEventListener('keydown', onMenuKey) // the menu is gone; drop its closure too
    // Only now is there something behind the preview worth showing.
    previewLive = false
    stopPreviewAnim()
    stopMenuAudio() // the game's own audio engine owns the ears from here
    preview.classList.add('gone')
    setTimeout(() => preview.remove(), 400)
  } catch (err) {
    // Never leave the player staring at a dead button.
    starting = false
    gameModule = null
    menu.classList.remove('busy')
    play.textContent = T.retry
    const full = String(err).toLowerCase().includes('full')
    status.textContent =
      mode.kind === 'bots'
        ? T.errLoad
        : mode.kind === 'code' || mode.kind === 'id'
          ? full
            ? T.errFull
            : T.errNoRoom
          : T.errServer
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
  status.textContent = `${T.rejoining} ${roomParam}...`
  void start({ kind: 'code', code: roomParam })
}

play.addEventListener('click', () => void start({ kind: 'bots', mapIndex: bmapIndex }))
quick.addEventListener('click', () => void start({ kind: 'quick' }))
host.addEventListener('click', () => void start({ kind: 'host', mapIndex: bmapIndex }))
joinForm.addEventListener('submit', (e) => {
  e.preventDefault()
  if (codeIn.value.length === 5) void start({ kind: 'code', code: codeIn.value })
  else status.textContent = T.errCodeLen
})
// Enter/Space anywhere starts a bots round — the zero-friction path. Removed on a
// successful start, so the game doesn't keep the dead menu's closure alive.
const onMenuKey = (e: KeyboardEvent): void => {
  // The how-to overlay owns the keyboard while open (Enter/Space work its buttons).
  if (starting || document.activeElement === codeIn || document.getElementById('howto')) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    void start({ kind: 'bots', mapIndex: bmapIndex })
  }
}
addEventListener('keydown', onMenuKey)

// A marker the headless smoke check waits on, and a cheap manual sanity signal.
document.documentElement.dataset.boot = 'ready'
performance.mark('echo-tag:boot-ready')

// ── CrazyGames "Online with Friends" ─────────────────────────────────────────
// A friend's invite carries the room in the SDK's invite params (a private code, or a
// public room's id); the party leader arriving through "play with friends" has the
// instant-multiplayer flag set and expects a joinable room with no menu detour. Both
// resolve to the same start() the buttons use.
const inviteMode = (inv: RoomInvite): GameMode =>
  'room' in inv ? { kind: 'code', code: inv.room } : { kind: 'id', roomId: inv.rid }

// Accepting an invite while ALREADY playing must not reload the page (their requirement).
// The next session boots on a second canvas WHILE the current one keeps running; only once
// it is in the new room does the old session go — so a stale or full invite costs nothing
// but a notice, and there is never a moment with no game and no menu. (A fresh canvas is
// mandatory anyway: destroying a WebGL renderer loses its canvas's context for good.)
let switching = false
const drainPending = (): void => {
  const inv = pendingInvite
  if (!inv) return
  pendingInvite = null
  void switchRoom(inv)
}
const switchRoom = async (inv: RoomInvite): Promise<void> => {
  if (switching || (starting && !handle)) {
    pendingInvite = inv // a start or switch is in flight: follow it up, don't drop it
    return
  }
  if (!handle) {
    void start(inviteMode(inv)) // still on the menu: the ordinary path
    return
  }
  switching = true
  const old = handle
  const oldCanvas = stage
  const fresh = oldCanvas.cloneNode(false) as HTMLCanvasElement
  oldCanvas.after(fresh) // paints over the old arena while the new lobby connects
  fit(fresh)
  try {
    const mod = await (gameModule ?? import('../game/index.ts'))
    const next = await mod.startGame(fresh, inviteMode(inv))
    handle = next
    stage = fresh
    old.destroy()
    oldCanvas.remove()
    document.documentElement.dataset.game = 'running' // the old teardown cleared the marker
  } catch (err) {
    fresh.remove()
    console.error('boot: room switch failed', err)
    old.alert(String(err).toLowerCase().includes('full') ? T.errFull : T.errNoRoom)
  } finally {
    switching = false
    drainPending()
  }
}

// Portals: the menu IS the loaded state — the player can interact right now. gameplayStart
// deliberately does NOT happen here; it fires on the first in-round input (game/index.ts).
// The two SDKs initialise independently: the CrazyGames hooks below must be armed the
// moment THEIR SDK is ready, never behind another SDK's (possibly slow) init.
void pokiInit().then(pokiLoadingFinished)
void cgInit().then(() => {
  cgLoadingFinished()
  // CrazyGames' player has its own mute toggle; the menu's terror bed obeys it too.
  if (cgSettings().muteAudio) stopMenuAudio()
  cgOnSettingsChange((s) => {
    if (s.muteAudio) stopMenuAudio()
  })
  const inv = cgInviteAtLoad()
  if (inv) void start(inviteMode(inv))
  else if (cgInstantMultiplayer()) void start({ kind: 'host', mapIndex: bmapIndex })
  cgOnJoinRoom((next) => void switchRoom(next))
})
