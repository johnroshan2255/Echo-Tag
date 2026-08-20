import {
  BG_COLOR,
  ECHO_BODIES_PER_PLAYER,
  MAP_COUNT,
  MAX_PLAYERS,
  NO_SLOT,
  RoundPhase,
  addPlayer,
  createWorld,
  enterPhase,
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
import { renderAmbience } from './render/ambience.ts'
import { renderDoors } from './render/doors.ts'
import { renderEchoes } from './render/echoRenderer.ts'
import { renderFog } from './render/fog.ts'
import { renderFx, renderLantern } from './render/fx.ts'
import { renderIndicator } from './render/indicator.ts'
import { createAnimState, onTagged, renderPlayers } from './render/playerRenderer.ts'
import { BODY, ECHO } from './render/templates.ts'
import { renderMarkers } from './render/wardrobeMarkers.ts'
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

/**
 * Dev review hooks, all URL-gated and inert in normal play:
 *   ?map=N     start on map N instead of 0
 *   ?nofog     skip the fog pass — for judging maps and furnishing in crops
 *   ?at=tx,ty  teleport the local player to a tile after spawn
 * They exist because fog (correctly) hides everything worth reviewing from a screenshot.
 */
const devParams = new URLSearchParams(globalThis.location?.search ?? '')
const DEV_NOFOG = devParams.has('nofog')
const DEV_MAP = Number(devParams.get('map') ?? -1)
const DEV_AT = devParams.get('at')?.split(',').map(Number)

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
  const localInput = (): number => (joystick.active ? joystick.packed : keyboard.packed)
  const driver = createDriverState()
  // Created here — inside the Play-click call stack — so the AudioContext starts unlocked.
  const audio = createAudioDirector()

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

  // Net wiring: lobby overlay, tag stings, per-round camera snaps.
  let lobbyUi: import('./net/lobbyUi.ts').LobbyUi | null = null
  if (net) {
    const { createLobbyUi } = await import('./net/lobbyUi.ts')
    lobbyUi = createLobbyUi(() => net.start())
    net.onLobby((view) => lobbyUi!.update(view))
    net.onTag((from, to) => {
      onTagged(anim, to, performance.now())
      audio.onTag(world, (mySlot = net.mySlot), from, to)
    })
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

  // ── Simulation step ──
  let simTick = 0
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

    const ev = stepWorld(world, inputs)
    if (ev.tagCount > 0) {
      onTagged(anim, ev.tagTo, performance.now())
      audio.onTag(world, LOCAL_SLOT, ev.tagFrom, ev.tagTo)
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

    audio.update(world, mySlot, dt)

    renderAmbience(layers.ambience, now, cam.cx, cam.cy)
    if (layers.ambience.flockJustStarted) audio.flutter()
    renderDoors(layers.doors, world)
    renderEchoes(layers.echoes, world, prevBodyX, prevBodyY, a)
    renderFx(layers.fx, world, prevX, prevY, a, now)
    renderLantern(layers.fx, lx, ly, now)
    renderPlayers(layers.bodies, world, prevX, prevY, a, anim, now)
    renderMarkers(layers.markers, world, mySlot, now)
    const hidden = world.hiddenIn[mySlot] !== NO_SLOT
    if (!DEV_NOFOG) renderFog(layers.fog, cam, lx, ly, viewW, viewH, hidden ? HIDDEN_VISION_SCALE : 1)
    else layers.fog.sprite.visible = false
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
      keyboard.destroy()
      joystick.destroy()
      audio.destroy()
      lobbyUi?.destroy()
      net?.destroy()
      renderer.destroy()
      delete root.dataset.game
    },
  }
}
