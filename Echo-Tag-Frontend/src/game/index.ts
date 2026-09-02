import {
  BG_COLOR,
  ECHO_BODIES_PER_PLAYER,
  EMOTE_COUNT,
  EMOTE_SHOW_MS,
  MAP_COUNT,
  MAX_PLAYERS,
  NO_SLOT,
  PLAYER_COLORS,
  RoundPhase,
  TICK_MS,
  TOOL_SLOTS,
  TRANSFORM_DELAY_MS,
  WARDROBE_MAX_HIDE_MS,
  Monster,
  MONSTER_NAMES,
  addPlayer,
  createWorld,
  enterPhase,
  enterTurning,
  leaderboard,
  monsterHasAbility,
  monsterOf,
  queueAbility,
  queueToolUse,
  setMap,
  stepWorld,
  syntheticDriver,
  type World,
} from '@echo-tag/shared'
import { createDriverState } from '@echo-tag/shared/ai'
import { createAudioDirector } from './audio/director.ts'
import { pauseMusic, playMusic, setMusicMuted } from '../platform/music.ts'
import { WebGLRenderer } from 'pixi.js'
import { applyCamera, createCamera, followCamera, resizeCamera, snapCamera } from './engine/camera.ts'
import { createLayers, setLayersMap } from './engine/layers.ts'
import { advance, createTicker } from './engine/ticker.ts'
import { fogTexture, glowTexture, squareTexture } from './engine/textures.ts'
import { createJoystick } from './input/joystick.ts'
import { createKeyboard } from './input/keyboard.ts'
import { renderAmbience, renderWreath } from './render/ambience.ts'
import { renderDoors } from './render/doors.ts'
import { renderEchoes } from './render/echoRenderer.ts'
import { renderFog } from './render/fog.ts'
import { renderFx, renderLantern } from './render/fx.ts'
import { createHudTimer } from './render/hudTimer.ts'
import { renderIndicator } from './render/indicator.ts'
import { renderInterior } from './render/interior.ts'
import { renderTerror } from './render/terror.ts'
import { renderTools } from './render/toolsRenderer.ts'
import { renderMonsterFx } from './render/monsterFx.ts'
import { CLOSE_ICON, EMOTE_ICONS, JAR_ICON, SOUND_OFF_ICON, SOUND_ON_ICON, TRAP_ICON, drawIconToCanvas } from './render/pixelIcons.ts'
import { createBanner } from './render/banner.ts'
import {
  createAnimState,
  createEmoteState,
  onTagged,
  renderEmotes,
  renderPlayers,
  triggerEmote,
} from './render/playerRenderer.ts'
import { BODY, ECHO } from './render/templates.ts'
import { renderMarkers } from './render/wardrobeMarkers.ts'
import { portalAdBreak, portalGameplayStart, portalGameplayStop } from '../platform/portal.ts'
import {
  cgHappytime,
  cgInviteLink,
  cgLeftRoom,
  cgOnSettingsChange,
  cgSettings,
  cgUpdateRoom,
  cgUserToken,
  type RoomInvite,
} from '../platform/crazygames.ts'
import { FOG_COLOR, FOG_MAX_ALPHA, HIDDEN_VISION_SCALE, VISION_CLEAR, VISION_MAX } from './theme.ts'
import { TG } from '../platform/i18nGame.ts'

/**
 * The walk-through world (docs/adr/0005).
 *
 * You are slot 0. The map is bigger than the screen; the camera follows you; the other
 * eleven slots run the shared synthetic driver until Phase 6 gives them brains. Rounds
 * rotate through the four maps.
 *
 * Still local-only: Phase 4 swaps this local `World` for a server-authoritative one, and
 * because every renderer reads a `World` in world coordinates, nothing below the world
 * swap changes when that happens.
 */

const LOCAL_SLOT = 0
const TRANSFORM_TICKS = Math.ceil(TRANSFORM_DELAY_MS / TICK_MS)

/**
 * Dev review hooks, all URL-gated and inert in normal play:
 *   ?map=N     start on map N instead of 0
 *   ?nofog     skip the fog pass — for judging maps and furnishing in crops
 *   ?at=tx,ty  teleport the local player to a tile after spawn
 *   ?turn      stage a metamorphosis next to the local player (review the effect in crops)
 *   ?turn=me   stage the local player's OWN metamorphosis (review the terror overlay)
 *   ?round=S   bots mode: shorten the round to S seconds — review the results board
 * They exist because fog (correctly) hides everything worth reviewing from a screenshot.
 */
const devParams = new URLSearchParams(globalThis.location?.search ?? '')
const DEV_NOFOG = devParams.has('nofog')
const DEV_MAP = Number(devParams.get('map') ?? -1)
const DEV_AT = devParams.get('at')?.split(',').map(Number)
const DEV_TURN = devParams.has('turn')
const DEV_TURN_ME = devParams.get('turn') === 'me'
const DEV_ROUND_S = Number(devParams.get('round') ?? 0)

export interface GameHandle {
  /** An in-game notice with an OK button (boot uses it when a friend's invite cannot be followed). */
  alert(msg: string): void
  destroy(): void
}

export type GameMode =
  | { kind: 'bots'; mapIndex?: number }
  | { kind: 'quick' }
  | { kind: 'host'; mapIndex?: number }
  | { kind: 'code'; code: string }
  /** A public room by id — how a CrazyGames friend follows you into quick match. */
  | { kind: 'id'; roomId: string }

export const startGame = async (canvas: HTMLCanvasElement, mode: GameMode = { kind: 'bots' }): Promise<GameHandle> => {
  const renderer = new WebGLRenderer()
  await renderer.init({
    canvas,
    width: canvas.width,
    height: canvas.height,
    background: BG_COLOR,
    antialias: false,
    resolution: 1, // the boot chunk already sized the canvas in device pixels
    autoDensity: false,
    powerPreference: 'high-performance',
    // No `preference: 'webgl'` — that belongs to `autoDetectRenderer`, which is precisely
    // what we are avoiding. Naming WebGLRenderer keeps WebGPU out of the bundle.
  })

  const layers = createLayers(
    squareTexture(),
    glowTexture(),
    fogTexture(FOG_COLOR, FOG_MAX_ALPHA, VISION_CLEAR / VISION_MAX),
  )
  const cam = createCamera()
  const ticker = createTicker()
  const anim = createAnimState()
  const keyboard = createKeyboard()
  // Both schemes live at once — an iPad with a keyboard case is both devices.
  const joystick = createJoystick()
  const localInput = (): number => {
    const packed = joystick.active ? joystick.packed : keyboard.packed
    // Poki's gameplayStart contract: on the first INPUT of a session, never on load.
    if (packed !== 0 && world.phase === RoundPhase.Playing) portalGameplayStart()
    return packed
  }
  const driver = createDriverState()
  // Created here — inside the Play-click call stack — so the AudioContext starts unlocked.
  const audio = createAudioDirector()
  // Mute: the player's choice persists across sessions and combines with ad-break muting,
  // so the end of a commercial never un-mutes someone who chose silence.
  let userMuted = false
  try {
    userMuted = localStorage.getItem('echoTagMuted') === '1'
  } catch {
    /* storage can be blocked (previews, private mode); default to sound on */
  }
  let breakMuted = false
  // CrazyGames' player has its own mute toggle (SDK settings) — a third, independent gate.
  let portalMuted = cgSettings().muteAudio === true
  const applyMute = (): void => {
    const m = userMuted || breakMuted || portalMuted
    audio.setMuted(m)
    setMusicMuted(m)
  }
  applyMute()
  const emoteState = createEmoteState()

  // ── World: local simulation, or a mirror of the server's ──
  // The CrazyGames user token (when signed in there) rides along; the SERVER verifies it
  // and shows the username so friends recognise each other. Everywhere else, colours.
  const cgToken = mode.kind === 'bots' ? null : await cgUserToken()
  let net: import('./net/room.ts').NetGame | null = null
  if (mode.kind !== 'bots') {
    try {
      const { connect, makeCode } = await import('./net/room.ts')
      net = await connect(
        mode.kind === 'quick'
          ? { kind: 'quick' }
          : mode.kind === 'host'
            ? { kind: 'host', code: makeCode() }
            : mode.kind === 'id'
              ? { kind: 'id', roomId: mode.roomId }
              : { kind: 'code', code: mode.code },
        cgToken ?? '',
      )
    } catch (err) {
      // A failed join must not leak what was built ahead of it: browsers cap live
      // AudioContexts, and a CrazyGames invite that misses can be retried many times.
      audio.destroy()
      renderer.destroy()
      throw err
    }
  }

  let mapIndex = DEV_MAP >= 0 ? DEV_MAP : ((mode.kind === 'bots' || mode.kind === 'host') && mode.mapIndex !== undefined) ? mode.mapIndex : 0
  const world: World = net ? net.world : createWorld(0xec07a6, mapIndex)
  let mySlot = net ? net.mySlot : LOCAL_SLOT

  if (!net) {
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(world, i !== LOCAL_SLOT)
    if (DEV_ROUND_S > 0) world.roundDurationMs = DEV_ROUND_S * 1000
    // Offline mode jumps straight to the countdown so the player isn't waiting in an
    // empty room for a network that doesn't exist.
    enterPhase(world, RoundPhase.Countdown)
    if (DEV_AT && DEV_AT.length === 2) {
      world.x[LOCAL_SLOT] = (DEV_AT[0]! + 0.5) * 80
      world.y[LOCAL_SLOT] = (DEV_AT[1]! + 0.5) * 80
    }
  }
  setLayersMap(layers, world.map)
  snapCamera(cam, world.x[mySlot]!, world.y[mySlot]!)

  // ── The tool belt: two slots, top-right, engine-owned DOM (never per-frame React) ──
  // Tap an icon (or press 1 / 2) to use that tool at your feet. The server validates
  // everything; locally the request is queued into the same deterministic sim path.
  // Deliberately built AFTER the connect resolves: earlier, a tap during the pending
  // handshake read the not-yet-initialised `net` (a TDZ crash), and a failed connect
  // left the toolbar and its keydown listener stacking up under the RETRY button.
  const useTool = (k: number): void => {
    if (net) net.useTool(k)
    else queueToolUse(world, LOCAL_SLOT, k)
  }
  // Pixel-art icons, never fonts or emoji: drawn onto small canvases at an integer scale
  // so they stay crisp and identical on every platform (see render/pixelIcons.ts).
  const TOOL_ICON = [null, JAR_ICON, TRAP_ICON] as const
  const toolbar = document.createElement('div')
  toolbar.id = 'toolbar'
  toolbar.style.cssText =
    'position:fixed;top:calc(14px + env(safe-area-inset-top));right:calc(14px + env(safe-area-inset-right));' +
    'display:flex;gap:8px;z-index:30;user-select:none;-webkit-user-select:none;'
  const slotCanvases: HTMLCanvasElement[] = []
  const slotBtns = [0, 1].map((k) => {
    const b = document.createElement('button')
    b.className = 'px-s'
    b.style.cssText =
      'width:52px;height:52px;padding:0;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(22,18,38,.72);border:1.5px solid rgba(255,243,220,.22);' +
      'touch-action:none;cursor:pointer;'
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    c.style.cssText = 'width:48px;height:48px;image-rendering:pixelated;'
    b.appendChild(c)
    slotCanvases.push(c)
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      useTool(k)
    })
    toolbar.appendChild(b)
    return b
  })
  document.body.appendChild(toolbar)
  let shownHeld = -1
  const refreshToolbar = (): void => {
    const a = world.held[mySlot * TOOL_SLOTS]!
    const b = world.held[mySlot * TOOL_SLOTS + 1]!
    const packed = a | (b << 4)
    if (packed === shownHeld) return
    shownHeld = packed
    drawIconToCanvas(slotCanvases[0]!, TOOL_ICON[a] ?? null, 4)
    drawIconToCanvas(slotCanvases[1]!, TOOL_ICON[b] ?? null, 4)
    slotBtns[0]!.style.opacity = a === 0 ? '0.28' : '1'
    slotBtns[1]!.style.opacity = b === 0 ? '0.28' : '1'
  }
  const onToolKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return // typing in chat
    if (e.code === 'Digit1') useTool(0)
    else if (e.code === 'Digit2') useTool(1)
    else if (e.code === 'Space' || e.code === 'Digit3') {
      e.preventDefault()
      useAbility()
    }
  }
  addEventListener('keydown', onToolKey)

  // ── The monster ability button: the It's web shot / beam, right-thumb zone ──
  // Shown only while YOU are the monster on a map whose monster has an active ability;
  // Space or 3 on keyboard. The sim (or server) validates everything again.
  const useAbility = (): void => {
    if (net) net.useAbility()
    else queueAbility(world, LOCAL_SLOT)
  }
  const abilityBtn = document.createElement('button')
  abilityBtn.id = 'ability-btn'
  abilityBtn.className = 'px-s'
  abilityBtn.style.cssText =
    'position:fixed;bottom:calc(84px + env(safe-area-inset-bottom));right:calc(14px + env(safe-area-inset-right));' +
    'width:64px;height:64px;padding:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(22,18,38,.78);border:2px solid rgba(157,130,234,.6);' +
    'touch-action:none;cursor:pointer;user-select:none;-webkit-user-select:none;z-index:30;'
  const abilityCanvas = document.createElement('canvas')
  abilityCanvas.width = 44
  abilityCanvas.height = 44
  abilityCanvas.style.cssText = 'width:44px;height:44px;image-rendering:pixelated;'
  abilityBtn.appendChild(abilityCanvas)
  abilityBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    useAbility()
  })
  document.body.appendChild(abilityBtn)
  // Pixel glyphs, painted once per monster: a web for the spider, a bolt for the alien.
  const paintAbilityGlyph = (monster: number): void => {
    const c = abilityCanvas.getContext('2d')!
    c.clearRect(0, 0, 44, 44)
    c.fillStyle = monster === Monster.Spider ? '#cfc8e8' : '#9fffe0'
    const px = (x: number, y: number): void => c.fillRect(x * 4, y * 4, 4, 4)
    if (monster === Monster.Spider) {
      for (let i = 1; i < 10; i++) {
        px(i, 5)
        px(5, i)
        if (i < 9) {
          px(i, i)
          px(i, 10 - i)
        }
      }
      px(5, 5)
    } else {
      for (const [x, y] of [[7, 1], [6, 2], [5, 3], [4, 4], [5, 5], [6, 5], [5, 6], [4, 7], [3, 8], [4, 6]] as const) px(x, y)
      px(6, 4)
      px(3, 9)
    }
  }
  let shownAbility = -2 // -2 forces the first paint; -1 = hidden
  const refreshAbility = (): void => {
    const mine = world.itSlot === mySlot && world.phase === RoundPhase.Playing && monsterHasAbility(world)
    const monster = mine ? monsterOf(world) : -1
    if (monster !== shownAbility) {
      shownAbility = monster
      abilityBtn.style.display = mine ? 'flex' : 'none'
      if (mine) paintAbilityGlyph(monster)
    }
    if (!mine) return
    const cd = Math.max(0, world.abilityReadyTick - world.tick)
    abilityBtn.style.opacity = cd > 0 ? '0.32' : '1'
    abilityBtn.style.borderColor = cd > 0 ? 'rgba(157,130,234,.3)' : 'rgba(157,130,234,.9)'
  }

  // ── The round banner: each arena announces itself ──
  // Only when a round is actually beginning: bots mode starts straight into play, but a
  // hosted/joined room starts in the LOBBY, where the announcement belongs to
  // onRoundSetup — a banner over the lobby card reads as a false start.
  const banner = createBanner()
  if (!net) banner.show(`${world.map.name} · ${MONSTER_NAMES[world.map.index]}`)

  // ── Hazard & portal feedback: the world's own events, one path for net and local ──
  const onHazardCaught = (slot: number): void => {
    if (slot !== mySlot) return
    // You are in its grip: input is now the struggle, and the monster knows where you
    // are. No score changes hands — being pinned in the open IS the price.
    banner.show(monsterOf(world) === Monster.Alien ? TG.bannerAbducted : TG.bannerCaught)
    audio.sting(0.9)
  }
  const onPortalUsed = (slot: number): void => {
    if (slot !== mySlot) return
    snapCamera(cam, world.x[slot]!, world.y[slot]!)
    audio.warp()
  }

  // ── Mute button: bottom-right corner, clear of the thumb arcs ──
  const CHIP_STYLE =
    'width:52px;height:52px;padding:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(22,18,38,.72);border:1.5px solid rgba(255,243,220,.22);' +
    'touch-action:none;cursor:pointer;user-select:none;-webkit-user-select:none;'
  const muteBtn = document.createElement('button')
  muteBtn.id = 'mute-btn'
  muteBtn.classList.add('px-s')
  muteBtn.style.cssText =
    CHIP_STYLE +
    'position:fixed;bottom:calc(14px + env(safe-area-inset-bottom));right:calc(14px + env(safe-area-inset-right));z-index:30;'
  const muteCanvas = document.createElement('canvas')
  muteCanvas.width = 40
  muteCanvas.height = 40
  muteCanvas.style.cssText = 'width:40px;height:40px;image-rendering:pixelated;'
  const drawMute = (): void => drawIconToCanvas(muteCanvas, userMuted ? SOUND_OFF_ICON : SOUND_ON_ICON, 4)
  drawMute()
  muteBtn.appendChild(muteCanvas)
  muteBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    userMuted = !userMuted
    try {
      localStorage.setItem('echoTagMuted', userMuted ? '1' : '0')
    } catch {
      /* fine — the choice just won't survive a reload */
    }
    applyMute()
    drawMute()
  })
  document.body.appendChild(muteBtn)

  // ── Modals: simple custom DOM dialogs ──
  // Every open modal, so destroy() can take them down with the session — a stale "host
  // left" sheet must not outlive a room switch and swallow the next room's input.
  const overlays = new Set<HTMLElement>()
  const showModal = (msg: string, isConfirm: boolean, onConfirm: () => void): void => {
    const overlay = document.createElement('div')
    overlays.add(overlay)
    const close = (): void => {
      overlays.delete(overlay)
      overlay.remove()
    }
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100;display:grid;place-content:center;padding:20px;'
    
    // Shadow on a wrapper: a same-element clip-path would clip the drop-shadow away.
    const wrap = document.createElement('div')
    wrap.style.cssText = 'filter:drop-shadow(8px 8px 0 rgba(0,0,0,0.4));'
    const box = document.createElement('div')
    box.className = 'px crt'
    box.style.cssText = 'background:#262048;border:3px solid #3a3150;padding:32px;text-align:center;'
    
    const p = document.createElement('p')
    p.style.cssText = 'font:400 12px/1.9 var(--pf);color:#f6f1ff;margin:0 0 26px;max-width:300px;text-transform:uppercase;letter-spacing:0.03em;'
    p.textContent = msg
    box.appendChild(p)
    
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:16px;justify-content:center;'
    
    const btnStyle = 'padding:14px 20px;font:400 11px/1.4 var(--pf);letter-spacing:0.03em;border:3px solid #3a3150;cursor:pointer;text-transform:uppercase;'
    
    if (isConfirm) {
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'px-s bv'
      cancelBtn.textContent = TG.cancel
      cancelBtn.style.cssText = btnStyle + 'background:#262048;color:#e9ddff;'
      cancelBtn.addEventListener('click', close)
      // Active state styling simulation
      cancelBtn.addEventListener('pointerdown', () => { cancelBtn.style.transform = 'translate(2px,2px)' })
      cancelBtn.addEventListener('pointerup', () => { cancelBtn.style.transform = 'none' })
      row.appendChild(cancelBtn)
    }
    
    const okBtn = document.createElement('button')
    okBtn.className = 'px-s bv-a'
    okBtn.textContent = isConfirm ? TG.leave : TG.ok
    okBtn.style.cssText = btnStyle + 'background:#ffc07a;color:#241505;border-color:#d49b5f;'
    okBtn.addEventListener('click', () => {
      close()
      onConfirm()
    })
    okBtn.addEventListener('pointerdown', () => { okBtn.style.transform = 'translate(2px,2px)' })
    okBtn.addEventListener('pointerup', () => { okBtn.style.transform = 'none' })
    row.appendChild(okBtn)
    
    box.appendChild(row)
    wrap.appendChild(box)
    overlay.appendChild(wrap)
    document.body.appendChild(overlay)
  }

  // ── Leave button: bottom-right corner, next to mute ──
  const leaveBtn = document.createElement('button')
  leaveBtn.id = 'leave-btn'
  leaveBtn.classList.add('px-s')
  leaveBtn.style.cssText =
    CHIP_STYLE +
    'position:fixed;bottom:calc(14px + env(safe-area-inset-bottom));right:calc(74px + env(safe-area-inset-right));z-index:30;'
  const leaveCanvas = document.createElement('canvas')
  leaveCanvas.width = 40
  leaveCanvas.height = 40
  leaveCanvas.style.cssText = 'width:40px;height:40px;image-rendering:pixelated;'
  drawIconToCanvas(leaveCanvas, CLOSE_ICON, 4)
  leaveBtn.appendChild(leaveCanvas)
  leaveBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showModal(TG.leaveConfirm, true, () => {
      cgLeftRoom(myInv)
      net?.destroy()
      location.search = ''
    })
  })
  document.body.appendChild(leaveBtn)

  // ── Emote buttons: a column under the tool belt. Tap to flash the icon over your head
  // (relayed room-wide in multiplayer, like chat — the echo is the single source of truth).
  const sendEmote = (n: number): void => {
    if (net) net.sendEmote(n)
    else triggerEmote(emoteState, LOCAL_SLOT, n, performance.now())
  }
  const emoteBar = document.createElement('div')
  emoteBar.id = 'emotes'
  emoteBar.style.cssText =
    'position:fixed;top:calc(78px + env(safe-area-inset-top));right:calc(14px + env(safe-area-inset-right));' +
    'display:flex;flex-direction:column;gap:8px;z-index:30;user-select:none;-webkit-user-select:none;'
  for (let n = 0; n < EMOTE_COUNT; n++) {
    const b = document.createElement('button')
    b.setAttribute('aria-label', `emote ${n + 1}`)
    b.style.cssText = CHIP_STYLE.replace(/width:52px;height:52px/, 'width:44px;height:44px')
    const c = document.createElement('canvas')
    c.width = 28
    c.height = 28
    c.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;'
    drawIconToCanvas(c, EMOTE_ICONS[n]!, 4)
    b.appendChild(c)
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      sendEmote(n)
    })
    emoteBar.appendChild(b)
  }
  document.body.appendChild(emoteBar)

  const inputs = new Uint8Array(MAX_PLAYERS)

  // Previous-tick positions for render interpolation. In net mode the driver owns them
  // (they roll on snapshot arrival); locally they roll per fixed step.
  const bodyCount = MAX_PLAYERS * ECHO_BODIES_PER_PLAYER
  const prevX = net ? net.prevX : new Float32Array(MAX_PLAYERS)
  const prevY = net ? net.prevY : new Float32Array(MAX_PLAYERS)
  const prevBodyX = net ? net.prevBodyX : new Float32Array(bodyCount)
  const prevBodyY = net ? net.prevBodyY : new Float32Array(bodyCount)
  prevX.set(world.x)
  prevY.set(world.y)
  prevBodyX.set(world.bodyX)
  prevBodyY.set(world.bodyY)

  // The results board's view of the local bots-mode world — the shape the server sends,
  // built here from the shared leaderboard() ranking instead.
  const localResultsView = (): import('./net/room.ts').LobbyView => ({
    phase: world.phase,
    mapIndex: world.map.index,
    humans: 1,
    bots: world.playerCount - 1,
    roundMins: Math.round(world.roundDurationMs / 60_000),
    isHost: true,
    isPrivate: true,
    code: '',
    scores: leaderboard(world),
  })

  // Net wiring: lobby overlay, tag stings, per-round camera snaps, and the room chat —
  // chat is coop-only by construction: it exists only where there is a room to relay it.
  let lobbyUi: import('./net/lobbyUi.ts').LobbyUi | null = null
  let chatUi: import('./chat.ts').ChatUi | null = null
  let cleanupNet: (() => void) | null = null
  /** The room CrazyGames was last told about by THIS session (see cgLeftRoom). */
  let myInv: RoomInvite | null = null
  // Chat is gated twice: a build flag (Poki requires prior approval for any chat/UGC, so the
  // Poki package builds with VITE_CHAT=off — docs/POKI_DEPLOY.md) and, live, the CrazyGames
  // player's own chat setting, which can flip mid-session. One mount path, re-checked after
  // the chunk import, so a disable arriving during the load wins.
  const chatBuilt = (import.meta as { env?: Record<string, string> }).env?.VITE_CHAT !== 'off'
  const mountChat = async (): Promise<void> => {
    if (!net || !chatBuilt || chatUi || cgSettings().disableChat) return
    const { createChatUi } = await import('./chat.ts')
    if (chatUi || cgSettings().disableChat) return // settings flipped during the import
    chatUi = createChatUi({
      send: (t) => net.sendChat(t),
      colorSlotOf: (slot) => world.colorSlot[slot]!,
      colorOf: (c) => PLAYER_COLORS[c % PLAYER_COLORS.length]!,
      mySlot: () => mySlot,
      nameOf: (slot) => net.nameOf(slot),
    })
  }
  if (net) {
    const { createLobbyUi } = await import('./net/lobbyUi.ts')
    lobbyUi = createLobbyUi(
      () => net.start(),
      (n) => net.setBots(n),
      (n) => net.setRoundMins(n),
      (n) => net.setMapIndex(n),
      // On CrazyGames the invite link is theirs (opens the game page straight into the
      // room, and counts for their friends feature); elsewhere it is this page + ?room=.
      (code) => cgInviteLink({ room: code }) ?? `${location.origin}${location.pathname}?room=${code}`,
    )
    // The map picked on the boot menu carries into the hosted room. Safe to send here:
    // create() resolves only after the join that made this client the host.
    if (mode.kind === 'host' && mode.mapIndex !== undefined && mode.mapIndex !== 0) {
      net.setMapIndex(mode.mapIndex)
    }
    await mountChat()
    net.onChat((slot, text) => chatUi?.push(slot, text))
    net.onEmote((slot, n) => triggerEmote(emoteState, slot, n, performance.now()))
    // CrazyGames "Online with Friends": tell their player where we are and whether a
    // friend can still follow (deduped inside the facade), and mark a won round as a
    // happy moment. Quick-match rooms are addressed by id, private rooms by code.
    let celebrated = false
    net.onLobby((view) => {
      lobbyUi!.update(view)
      myInv = view.code !== '' ? { room: view.code } : { rid: net.roomId }
      cgUpdateRoom(myInv, view.humans < MAX_PLAYERS)
      if (view.phase !== RoundPhase.Leaderboard) celebrated = false
      else if (!celebrated && view.scores.length > 1 && view.scores[0]!.slot === net.mySlot) {
        celebrated = true
        cgHappytime()
      }
    })
    net.onTag((from, to) => {
      onTagged(anim, to, performance.now())
      audio.onTag(world, (mySlot = net.mySlot), from, to)
    })
    net.onHazard(onHazardCaught)
    net.onPortal(onPortalUsed)
    net.onHostLeft(() => {
      cgLeftRoom(myInv)
      showModal(TG.hostLeft, false, () => {
        location.search = ''
      })
    })
    // Dropped by the server or the network: stop advertising the room, tell the player.
    net.onLeave(() => {
      cgLeftRoom(myInv)
      portalGameplayStop()
      showModal(TG.disconnected, false, () => {
        location.search = ''
      })
    })
    // Server-driven rounds: the phase transition arrives via snapshot; watch it for the
    // gameplayStop/ad-break moment — and for the arena banner, which belongs to the
    // moment a round actually begins. (onRoundSetup is the wrong trigger: it also fires
    // on joining a lobby and on every map flip the host makes there.)
    // Starts at Lobby so a mid-round quick-join still reads as "entering the round".
    let prevPhase: number = RoundPhase.Lobby
    const watchPhase = setInterval(() => {
      if (world.phase !== prevPhase) {
        if (prevPhase === RoundPhase.Playing) {
          void portalAdBreak(
            () => {
              breakMuted = true
              applyMute()
            },
            () => {
              breakMuted = false
              applyMute() // respects the player's own mute
            },
          )
        }
        const intoRound = world.phase === RoundPhase.Countdown || world.phase === RoundPhase.Playing
        const fromRest = prevPhase === RoundPhase.Lobby || prevPhase === RoundPhase.Leaderboard
        if (intoRound && fromRest) banner.show(`${world.map.name} · ${MONSTER_NAMES[world.map.index]}`)
        prevPhase = world.phase
      }
    }, 300)
    cleanupNet = () => {
      clearInterval(watchPhase)
      cgLeftRoom(myInv)
    }
    net.onRoundSetup(() => {
      mySlot = net.mySlot
      setLayersMap(layers, world.map)
      snapCamera(cam, world.x[mySlot]!, world.y[mySlot]!)
    })
  } else {
    // Offline gets the same results board as multiplayer, driven from the local world.
    // Created hidden: the first update carries the Countdown phase.
    const { createLobbyUi } = await import('./net/lobbyUi.ts')
    lobbyUi = createLobbyUi(() => {})
    lobbyUi.update(localResultsView())
  }

  // CrazyGames settings can change mid-session (their player's mute and chat toggles).
  const offSettings = cgOnSettingsChange((s) => {
    portalMuted = s.muteAudio === true
    applyMute()
    if (s.disableChat) {
      chatUi?.destroy()
      chatUi = null
    } else {
      void mountChat()
    }
  })

  // The round clock, in the same pixel register as the tool belt. Created after the
  // connect so a failed join never leaves it behind.
  const hudTimer = createHudTimer()

  // ── Viewport ──
  let viewW = canvas.width
  let viewH = canvas.height

  const relayout = (): void => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    viewW = Math.round(globalThis.innerWidth * dpr)
    viewH = Math.round(globalThis.innerHeight * dpr)
    if (canvas.width !== viewW || canvas.height !== viewH) {
      canvas.width = viewW
      canvas.height = viewH
    }
    renderer.resize(viewW, viewH)
    resizeCamera(cam, viewW, viewH)
  }
  relayout()
  // Rotation support: the game plays in portrait AND landscape, re-fitting live when the
  // phone turns. iOS Safari can fire resize/orientationchange while innerWidth/innerHeight
  // still describe the OLD orientation, so measure immediately and once more after the
  // rotation settles. relayout() is idempotent — a no-change call is a few comparisons.
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const relayoutSettled = (): void => {
    relayout()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(relayout, 300)
  }
  addEventListener('resize', relayoutSettled, { passive: true })
  addEventListener('orientationchange', relayoutSettled, { passive: true })
  globalThis.visualViewport?.addEventListener('resize', relayoutSettled, { passive: true })

  // Tab hidden = play stopped, for the platform's session accounting. The next input after
  // returning re-fires gameplayStart via localInput().
  const onVis = (): void => {
    if (document.hidden) portalGameplayStop()
  }
  document.addEventListener('visibilitychange', onVis)

  // ── Simulation step ──
  let simTick = 0
  let resultsShown = false
  let devTurnArmed = DEV_TURN && !net
  const stepNet = (): void => {
    // Net mode: the fixed tick only sends input (with prediction inside the driver).
    net!.sendInput(localInput())
  }
  const step = (): void => {
    prevX.set(world.x)
    prevY.set(world.y)
    prevBodyX.set(world.bodyX)
    prevBodyY.set(world.bodyY)

    inputs[LOCAL_SLOT] = localInput()
    syntheticDriver(world, inputs, simTick, driver, LOCAL_SLOT)

    if (devTurnArmed && world.phase === RoundPhase.Playing) {
      // ?turn: park slot 1 beside the local player and start its metamorphosis.
      // ?turn=me: the local player is the one turning (reviews the terror overlay).
      devTurnArmed = false
      if (DEV_TURN_ME) {
        enterTurning(world, LOCAL_SLOT)
      } else {
        world.x[1] = world.x[LOCAL_SLOT]! + 130
        world.y[1] = world.y[LOCAL_SLOT]!
        enterTurning(world, 1)
      }
    }

    const ev = stepWorld(world, inputs)
    if (ev.tagCount > 0) {
      onTagged(anim, ev.tagTo, performance.now())
      audio.onTag(world, LOCAL_SLOT, ev.tagFrom, ev.tagTo)
    }
    if (ev.hazardCaught !== NO_SLOT) onHazardCaught(ev.hazardCaught)
    if (ev.portalUsed !== NO_SLOT) onPortalUsed(ev.portalUsed)
    if (ev.roundEnded) {
      // Between rounds is the platform's ad slot; audio stays silent for its duration.
      void portalAdBreak(
        () => {
          breakMuted = true
          applyMute()
        },
        () => {
          breakMuted = false
          applyMute() // respects the player's own mute
        },
      )
    }

    // Round over: show the results board for the leaderboard window. The sim itself
    // moves Leaderboard → Lobby after LEADERBOARD_MS; that is the cue to rotate maps
    // and go again. Scores are captured at entry — the next Countdown zeroes them.
    if (world.phase === RoundPhase.Leaderboard && !resultsShown) {
      resultsShown = true
      lobbyUi?.update(localResultsView())
    }
    if (world.phase === RoundPhase.Lobby) {
      resultsShown = false
      mapIndex = (mapIndex + 1) % MAP_COUNT
      setMap(world, mapIndex)
      enterPhase(world, RoundPhase.Countdown)
      setLayersMap(layers, world.map)
      prevX.set(world.x)
      prevY.set(world.y)
      prevBodyX.set(world.bodyX)
      prevBodyY.set(world.bodyY)
      snapCamera(cam, world.x[LOCAL_SLOT]!, world.y[LOCAL_SLOT]!)
      lobbyUi?.update(localResultsView()) // phase is Countdown now — hides the board
      banner.show(`${world.map.name} · ${MONSTER_NAMES[world.map.index]}`)
    }
    simTick++
  }

  // ── Frame loop ──
  let musicPhase = -1
  let raf = 0
  let last = 0
  let frames = 0
  // Who most recently went through a metamorphosis. The crowning slam is reserved for a
  // crowning that FOLLOWED one — without this, the randomly-chosen starting ghost got the
  // full slam at every round start (enterPhase(Playing) also stamps itSinceTick).
  let lastTurnedSlot = NO_SLOT

  const frame = (now: number): void => {
    // The first frame's delta spans renderer init and shader compile; it only sets the clock.
    if (frames === 0) {
      last = now
      frames = 1
      raf = requestAnimationFrame(frame)
      return
    }

    const dt = now - last
    last = now
    frames++

    advance(ticker, dt, net ? stepNet : step)
    const a = net ? net.alpha() : ticker.alpha

    // Camera follows the interpolated local player, so it is as smooth as the avatar.
    let lx = cam.cx
    let ly = cam.cy
    if (mySlot !== NO_SLOT && prevX[mySlot] !== undefined) {
      lx = prevX[mySlot]! + (world.x[mySlot]! - prevX[mySlot]!) * a
      ly = prevY[mySlot]! + (world.y[mySlot]! - prevY[mySlot]!) * a
      followCamera(cam, lx, ly, world.vx[mySlot]!, world.vy[mySlot]!, dt)
    }
    applyCamera(cam, layers.worldRoot, viewW, viewH)

    // ── The terror: BECOMING the ghost, first-person ──
    // Ramps through your own metamorphosis and slams for a beat at the crowning. Strictly
    // this client's screen: everyone else gets the arena telegraphs, only the victim's
    // monitor shakes. Applied post-applyCamera, so it is a per-viewport pixel offset —
    // the world, the camera and the other players never know it happened.
    const turning = world.turningSlot
    const turnProgress =
      turning !== NO_SLOT
        ? 1 - Math.min(1, Math.max(0, (world.turningUntilTick - world.tick) / TRANSFORM_TICKS))
        : 0
    if (turning !== NO_SLOT) lastTurnedSlot = turning
    if (world.phase !== RoundPhase.Playing) lastTurnedSlot = NO_SLOT
    let terror = 0
    if (world.phase === RoundPhase.Playing) {
      if (turning === mySlot && world.active[mySlot] === 1) {
        terror = 0.35 + 0.65 * turnProgress
      } else if (world.itSlot === mySlot && lastTurnedSlot === mySlot) {
        const sinceCrown = world.tick - world.itSinceTick
        if (sinceCrown < 14) terror = 1 - sinceCrown / 14 // the crowning slam, decaying
      }
    }
    if (terror > 0) {
      const mag = cam.scale * (1.2 + 5 * terror)
      layers.worldRoot.x += Math.sin(now * 0.091) * mag
      layers.worldRoot.y += Math.cos(now * 0.077) * mag
    }
    renderTerror(layers.terror, terror, now, viewW, viewH)

    audio.update(world, mySlot, dt)

    // Menu/lobby music and the play-only HUD follow the phase: the lobby and the results
    // board keep the tune and hide the tool belt — it holds nothing there; the round
    // itself belongs to the game's own soundscape and shows the tools.
    if (world.phase !== musicPhase) {
      musicPhase = world.phase
      const atRest = musicPhase === RoundPhase.Lobby || musicPhase === RoundPhase.Leaderboard
      if (atRest) playMusic()
      else pauseMusic()
      toolbar.style.display = atRest ? 'none' : 'flex'
    }

    renderAmbience(layers.ambience, now, cam.cx, cam.cy)
    if (layers.ambience.flockJustStarted) audio.flutter()
    renderTools(layers.tools, world, now)
    renderMonsterFx(layers.monsterFx, world, now)
    refreshToolbar()
    refreshAbility()
    hudTimer.update(world, now)
    // The metamorphosis wreath: bats whirl around whoever is turning into the ghost.
    if (turning !== NO_SLOT && world.active[turning] === 1) {
      const tx = prevX[turning]! + (world.x[turning]! - prevX[turning]!) * a
      const ty = prevY[turning]! + (world.y[turning]! - prevY[turning]!) * a
      renderWreath(layers.ambience, true, tx, ty, turnProgress, now)
    } else {
      renderWreath(layers.ambience, false, 0, 0, 0, now)
    }
    renderDoors(layers.doors, world)
    renderEchoes(layers.echoes, world, prevBodyX, prevBodyY, a)
    renderFx(layers.fx, world, prevX, prevY, a, now)
    renderLantern(layers.fx, lx, ly, now)
    renderPlayers(layers.bodies, world, prevX, prevY, a, anim, now)
    renderEmotes(layers.bodies, world, prevX, prevY, a, emoteState, now, EMOTE_SHOW_MS)
    renderMarkers(layers.markers, world, mySlot, now)
    const hidden = world.hiddenIn[mySlot] !== NO_SLOT
    if (!DEV_NOFOG) renderFog(layers.fog, cam, lx, ly, viewW, viewH, hidden ? HIDDEN_VISION_SCALE : 1)
    else layers.fog.sprite.visible = false
    // Inside the wardrobe you are blind: the interior overlay covers the whole view, so
    // you genuinely cannot tell whether the ghost is still out there. The creak toward
    // eviction runs on SIM ticks (the sim tracks hiddenSinceTick locally; the net mirror
    // stamps it on the hide transition), so it agrees with the server's eviction clock
    // even in a throttled background tab.
    const hiddenProgress = hidden
      ? ((world.tick - world.hiddenSinceTick[mySlot]!) * TICK_MS) / WARDROBE_MAX_HIDE_MS
      : 0
    renderInterior(layers.interior, hidden, hiddenProgress, now, viewW, viewH)
    renderIndicator(layers.indicator, world, mySlot, cam, viewW, viewH, now)

    renderer.render(layers.stage)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  // ── Signals the headless check reads ──
  const root = document.documentElement
  root.dataset.game = 'running'
  root.dataset.particles = String(MAX_PLAYERS * BODY.count + bodyCount * ECHO.count)
  Object.defineProperty(globalThis, '__echoTag', {
    configurable: true,
    get: () => ({
      frames,
      ticks: ticker.ticks,
      dropped: ticker.dropped,
      phase: world.phase,
      clockMs: world.clockMs,
      itSlot: world.itSlot,
      itX: world.itSlot === NO_SLOT ? 0 : Math.round(world.x[world.itSlot]!),
      itY: world.itSlot === NO_SLOT ? 0 : Math.round(world.y[world.itSlot]!),
      turningSlot: world.turningSlot,
      ticksAsIt: world.itSlot === NO_SLOT ? 0 : world.tick - world.itSinceTick,
      // True while the local player cannot steer normally (metamorphosis stumble,
      // unconscious, or inside a wardrobe) — the browser check's touch test waits this out.
      meImpaired:
        world.turningSlot === mySlot ||
        world.tick < world.unconsciousUntilTick[mySlot]! ||
        world.hiddenIn[mySlot] !== NO_SLOT,
      liveEchoBodies: world.bodyLive.reduce((s: number, v: number) => s + v, 0),
      arena: [world.arenaW, world.arenaH],
      map: world.map.name,
      camScale: cam.scale,
      cam: [Math.round(cam.cx), Math.round(cam.cy)],
    }),
  })

  return {
    alert(msg: string): void {
      showModal(msg, false, () => {})
    },
    destroy(): void {
      portalGameplayStop() // the platform's play session ends with the game session
      for (const o of overlays) o.remove()
      overlays.clear()
      cancelAnimationFrame(raf)
      clearTimeout(settleTimer)
      removeEventListener('resize', relayoutSettled)
      removeEventListener('orientationchange', relayoutSettled)
      globalThis.visualViewport?.removeEventListener('resize', relayoutSettled)
      removeEventListener('keydown', onToolKey)
      toolbar.remove()
      abilityBtn.remove()
      muteBtn.remove()
      leaveBtn.remove()
      emoteBar.remove()
      banner.destroy()
      hudTimer.destroy()
      document.removeEventListener('visibilitychange', onVis)
      keyboard.destroy()
      joystick.destroy()
      audio.destroy()
      offSettings()
      cleanupNet?.()
      lobbyUi?.destroy()
      chatUi?.destroy()
      net?.destroy()
      renderer.destroy()
      delete root.dataset.game
    },
  }
}
