import {
  BG_COLOR,
  ECHO_BODIES_PER_PLAYER,
  MAP_COUNT,
  MAX_PLAYERS,
  NO_SLOT,
  PLAYER_COLORS,
  RoundPhase,
  TICK_MS,
  TOOL_SLOTS,
  TRANSFORM_DELAY_MS,
  WARDROBE_MAX_HIDE_MS,
  addPlayer,
  createWorld,
  enterPhase,
  enterTurning,
  queueToolUse,
  setMap,
  stepWorld,
  syntheticDriver,
  type World,
} from '@echo-tag/shared'
import { createDriverState } from '@echo-tag/shared/ai'
import { createAudioDirector } from './audio/director.ts'
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
import { renderIndicator } from './render/indicator.ts'
import { renderInterior } from './render/interior.ts'
import { renderTerror } from './render/terror.ts'
import { renderTools } from './render/toolsRenderer.ts'
import { JAR_ICON, TRAP_ICON, drawIconToCanvas } from './render/pixelIcons.ts'
import { createAnimState, onTagged, renderPlayers } from './render/playerRenderer.ts'
import { BODY, ECHO } from './render/templates.ts'
import { renderMarkers } from './render/wardrobeMarkers.ts'
import { pokiCommercialBreak, pokiGameplayStart, pokiGameplayStop } from '../platform/poki.ts'
import { FOG_COLOR, FOG_MAX_ALPHA, HIDDEN_VISION_SCALE, VISION_CLEAR, VISION_MAX } from './theme.ts'

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
 * They exist because fog (correctly) hides everything worth reviewing from a screenshot.
 */
const devParams = new URLSearchParams(globalThis.location?.search ?? '')
const DEV_NOFOG = devParams.has('nofog')
const DEV_MAP = Number(devParams.get('map') ?? -1)
const DEV_AT = devParams.get('at')?.split(',').map(Number)
const DEV_TURN = devParams.has('turn')
const DEV_TURN_ME = devParams.get('turn') === 'me'

export interface GameHandle {
  destroy(): void
}

export type GameMode =
  | { kind: 'bots' }
  | { kind: 'quick' }
  | { kind: 'host' }
  | { kind: 'code'; code: string }

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
    if (packed !== 0 && world.phase === RoundPhase.Playing) pokiGameplayStart()
    return packed
  }
  const driver = createDriverState()
  // Created here — inside the Play-click call stack — so the AudioContext starts unlocked.
  const audio = createAudioDirector()

  // ── The tool belt: two slots, top-right, engine-owned DOM (never per-frame React) ──
  // Tap an icon (or press 1 / 2) to use that tool at your feet. The server validates
  // everything; locally the request is queued into the same deterministic sim path.
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
    b.style.cssText =
      'width:52px;height:52px;padding:0;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(22,18,38,.72);border:1.5px solid rgba(255,243,220,.22);' +
      'border-radius:10px;touch-action:none;cursor:pointer;'
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
  }
  addEventListener('keydown', onToolKey)

  // ── World: local simulation, or a mirror of the server's ──
  const net = mode.kind === 'bots' ? null : await (await import('./net/room.ts')).connect(
    mode.kind === 'quick'
      ? { kind: 'quick' }
      : mode.kind === 'host'
        ? { kind: 'host', code: (await import('./net/room.ts')).makeCode() }
        : { kind: 'code', code: mode.code },
  )

  let mapIndex = DEV_MAP >= 0 ? DEV_MAP : 0
  const world: World = net ? net.world : createWorld(0xec07a6, mapIndex)
  let mySlot = net ? net.mySlot : LOCAL_SLOT

  if (!net) {
    for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(world, i !== LOCAL_SLOT)
    enterPhase(world, RoundPhase.Countdown)
    if (DEV_AT && DEV_AT.length === 2) {
      world.x[LOCAL_SLOT] = (DEV_AT[0]! + 0.5) * 80
      world.y[LOCAL_SLOT] = (DEV_AT[1]! + 0.5) * 80
    }
  }
  setLayersMap(layers, world.map)
  snapCamera(cam, world.x[mySlot]!, world.y[mySlot]!)

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

  // Net wiring: lobby overlay, tag stings, per-round camera snaps, and the room chat —
  // chat is coop-only by construction: it exists only where there is a room to relay it.
  let lobbyUi: import('./net/lobbyUi.ts').LobbyUi | null = null
  let chatUi: import('./chat.ts').ChatUi | null = null
  let cleanupNet: (() => void) | null = null
  if (net) {
    const { createLobbyUi } = await import('./net/lobbyUi.ts')
    lobbyUi = createLobbyUi(
      () => net.start(),
      (n) => net.setBots(n),
    )
    const { createChatUi } = await import('./chat.ts')
    chatUi = createChatUi({
      send: (t) => net.sendChat(t),
      colorSlotOf: (slot) => world.colorSlot[slot]!,
      colorOf: (c) => PLAYER_COLORS[c % PLAYER_COLORS.length]!,
      mySlot: () => mySlot,
    })
    net.onChat((slot, text) => chatUi!.push(slot, text))
    net.onLobby((view) => lobbyUi!.update(view))
    net.onTag((from, to) => {
      onTagged(anim, to, performance.now())
      audio.onTag(world, (mySlot = net.mySlot), from, to)
    })
    net.onTag // (tag handling above)
    // Server-driven rounds: the phase transition arrives via snapshot; watch it for the
    // gameplayStop/ad-break moment.
    let prevPhase = world.phase
    const watchPhase = setInterval(() => {
      if (world.phase !== prevPhase) {
        if (prevPhase === RoundPhase.Playing) {
          void pokiCommercialBreak(() => audio.setMuted(true), () => audio.setMuted(false))
        }
        prevPhase = world.phase
      }
    }, 300)
    cleanupNet = () => clearInterval(watchPhase)
    net.onRoundSetup(() => {
      mySlot = net.mySlot
      setLayersMap(layers, world.map)
      snapCamera(cam, world.x[mySlot]!, world.y[mySlot]!)
    })
  }

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
  addEventListener('resize', relayout, { passive: true })

  // Tab hidden = play stopped, for the platform's session accounting. The next input after
  // returning re-fires gameplayStart via localInput().
  const onVis = (): void => {
    if (document.hidden) pokiGameplayStop()
  }
  document.addEventListener('visibilitychange', onVis)

  // ── Simulation step ──
  let simTick = 0
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
    if (ev.roundEnded) {
      // Between rounds is the platform's ad slot; audio stays silent for its duration.
      void pokiCommercialBreak(() => audio.setMuted(true), () => audio.setMuted(false))
    }

    // Round over: rotate to the next map and go again. (Phase 7 puts the leaderboard here.)
    if (world.phase === RoundPhase.Leaderboard) {
      mapIndex = (mapIndex + 1) % MAP_COUNT
      setMap(world, mapIndex)
      enterPhase(world, RoundPhase.Countdown)
      setLayersMap(layers, world.map)
      prevX.set(world.x)
      prevY.set(world.y)
      prevBodyX.set(world.bodyX)
      prevBodyY.set(world.bodyY)
      snapCamera(cam, world.x[LOCAL_SLOT]!, world.y[LOCAL_SLOT]!)
    }
    simTick++
  }

  // ── Frame loop ──
  let raf = 0
  let last = 0
  let frames = 0
  let hiddenAtMs = -1 // when the local player slipped into a wardrobe, for the door creak

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
    const lx = prevX[mySlot]! + (world.x[mySlot]! - prevX[mySlot]!) * a
    const ly = prevY[mySlot]! + (world.y[mySlot]! - prevY[mySlot]!) * a
    followCamera(cam, lx, ly, world.vx[mySlot]!, world.vy[mySlot]!, dt)
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
    let terror = 0
    if (world.phase === RoundPhase.Playing) {
      if (turning === mySlot && world.active[mySlot] === 1) {
        terror = 0.35 + 0.65 * turnProgress
      } else if (world.itSlot === mySlot) {
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

    renderAmbience(layers.ambience, now, cam.cx, cam.cy)
    if (layers.ambience.flockJustStarted) audio.flutter()
    renderTools(layers.tools, world, now)
    refreshToolbar()
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
    renderMarkers(layers.markers, world, mySlot, now)
    const hidden = world.hiddenIn[mySlot] !== NO_SLOT
    if (!DEV_NOFOG) renderFog(layers.fog, cam, lx, ly, viewW, viewH, hidden ? HIDDEN_VISION_SCALE : 1)
    else layers.fog.sprite.visible = false
    // Inside the wardrobe you are blind: the interior overlay covers the whole view, so
    // you genuinely cannot tell whether the ghost is still out there. Time from entry is
    // tracked here (the mirror does not carry hiddenSinceTick) to creak the door open
    // toward the eviction.
    if (hidden && hiddenAtMs < 0) hiddenAtMs = now
    if (!hidden) hiddenAtMs = -1
    renderInterior(layers.interior, hidden, hidden ? (now - hiddenAtMs) / WARDROBE_MAX_HIDE_MS : 0, now, viewW, viewH)
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
    destroy(): void {
      cancelAnimationFrame(raf)
      removeEventListener('resize', relayout)
      removeEventListener('keydown', onToolKey)
      toolbar.remove()
      document.removeEventListener('visibilitychange', onVis)
      keyboard.destroy()
      joystick.destroy()
      audio.destroy()
      cleanupNet?.()
      lobbyUi?.destroy()
      chatUi?.destroy()
      net?.destroy()
      renderer.destroy()
      delete root.dataset.game
    },
  }
}
